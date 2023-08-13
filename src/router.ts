import { strict as assert } from 'node:assert'
import express from 'express'
import path from 'path'
import { OctokitResponse } from '@octokit/types'
import { Octokit } from 'octokit'
import { newOctokit } from './octokit.js'

const verbosity = parseInt(process.env.VERBOSITY) || 0

function nowString() {
  return new Date().toISOString()
}

function maxBy<T, U>(xs: T[], f: (x: T) => U): T {
  assert(xs.length > 0)
  let choice = xs[0]
  let k = f(choice)
  for (let i = 1; i < xs.length; ++i) {
    const xi = xs[i]
    const ki = f(xi)
    if (ki > k) {
      choice = xi
    }
  }
  return choice
}

const MIME_TYPES = {
  '.txt': 'text/plain',
  '.py': 'text/x-python',
  '.tgz': 'application/gzip',
}

function unbase64(input) {
  return Buffer.from(input, 'base64').toString('ascii')
}

class HttpError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message)
  }
}

class BadRequest extends HttpError {
  constructor(message: string) {
    super(400, message)
  }
}

class Forbidden extends HttpError {
  constructor(message: string) {
    super(403, message)
  }
}

class NotFound extends HttpError {
  constructor(message: string) {
    super(404, message)
  }
}

class BadGateway extends HttpError {
  constructor(message: string) {
    super(502, message)
  }
}

class Conflict extends HttpError {
  constructor(message: string) {
    super(409, message)
  }
}

function parseBearer(req) {
  const header = req.get('Authorization')
  if (!header) {
    throw new BadRequest('Missing header: Authorization')
  }
  const m1 = header.match(/Bearer (.+)/)
  if (!m1) {
    throw new BadRequest('Malformed header: Authorization')
  }
  const userpass = unbase64(m1[1])
  const m2 = userpass.match(/([^:]+):(.+)/)
  if (!m2) {
    throw new BadRequest('Malformed header: Authorization')
  }
  const user = m2[1]
  const auth = m2[2]
  return { user, auth }
}

type ReleaseParameters = {
  owner: string
  repo: string
  tag: string
  [key: string]: any
}

function parseRelease(req): ReleaseParameters {
  const repo = req.params.package
  const root: any = {}
  const version = req.params.version
  const host = req.params.host
  const owner = req.params.owner
  root.reference = `${repo}/${version}@${host}/${owner}`
  let reference = root.reference
  let suffix = ''
  const rrev = req.params.rrev

  if (rrev && rrev !== '0') {
    suffix += '#' + rrev
    reference += '#' + rrev
  }
  if (req.params.pkgid) {
    // `:` is not valid in a Git tag name.
    // Two tags cannot coexist when one is a prefix of the other,
    // followed immediately by a directory separator (`/`).
    suffix += '@' + req.params.pkgid
    reference += ':' + req.params.pkgid
    if (req.params.prev) {
      suffix += '#' + req.params.prev
      reference += '#' + req.params.prev
    }
  }

  const match = host.match(/(.*)github(.*)/)
  if (!match) {
    throw new Forbidden(`Not a GitHub package: '${reference}'`)
  }

  root.tag = match[1] + version + match[2]
  const tag = root.tag + suffix

  return { repo, tag, host, owner, rrev, reference, root }
}

/** Return a list of asset names for the requested release. */
async function getFiles(req, res) {
  const { repo, tag, owner, reference } = parseRelease(req)

  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })

  const r1 = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  })
  if (r1.status !== 200) {
    return res.status(404).send(`Recipe not found: ${reference}`)
  }

  const files = {}
  for (const asset of r1.data.assets) {
    files[asset.name] = {}
  }
  return res.send({ files })
}

/** Return a redirect for the requested file. */
function getFile(req, res) {
  const { repo, tag, owner } = parseRelease(req)
  const filename = req.params.filename
  // TODO: Do we need to look up the download URL or can we assume its form?
  return res.redirect(
    301,
    `https://github.com/${owner}/${repo}/releases/download/${tag}/${filename}`,
  )
}

function parseJsonPrefix(text: string) {
  try {
    return JSON.parse(text)
  } catch (error) {
    const match = error.message.match(/position\s+(\d+)/)
    if (!match) {
      throw error
    }
    text = text.substr(0, match[1])
  }
  return JSON.parse(text)
}

interface RootMetadata {
  revisions: {
    revision: string
    time: string
    release?: {
      id: number
      origin: string
    }
    packages: {
      revision: string
      time: string
      release: {
        id: number
        origin: string
      }
    }[]
  }[]
}

namespace RootMetadata {
  export function serialize(metadata: RootMetadata): string {
    return (
      '<!--redirectory\n' +
      'Do not edit or remove this comment.\n' +
      JSON.stringify(metadata, null, 2) +
      '\n-->'
    )
  }
}

class RootRelease {
  constructor(
    private octokit: Octokit,
    private params: ReleaseParameters,
    public readonly github: {
      id: number
      upload_url: string
      assets: { id: number; name: string; browser_download_url: string }[]
    },
    public conan: RootMetadata,
    private prefix: string,
    private suffix: string,
  ) {}

  static async open(
    octokit: Octokit,
    params: ReleaseParameters,
    { force = false } = {},
  ): Promise<RootRelease> {
    let github
    let conan: RootMetadata = {
      revisions: [{ revision: '0', time: nowString(), packages: [] }],
    }
    // If the body is entirely an HTML comment, GitHub will show it.
    // Use a non-whitespace HTML string that renders as whitespace
    // to hide the comment.
    let prefix = '&nbsp;\n'
    let suffix = ''

    const r1 = await octokit.rest.repos.getReleaseByTag({
      owner: params.owner,
      repo: params.repo,
      tag: params.root.tag,
    })
    if (r1.status !== 200) {
      if (!force) {
        throw new NotFound(`Package not found: '${params.reference}'`)
      }

      // This will create the root tag,
      // pointing at the tip of the default branch,
      // if it does not exist.
      const r2 = await octokit.rest.repos.createRelease({
        owner: params.owner,
        repo: params.repo,
        tag_name: params.root.tag,
        body: prefix + RootMetadata.serialize(conan),
      })
      if (r2.status !== 201) {
        throw new HttpError(r2.status, r2.data.body)
      }

      github = r2.data
    } else {
      github = r1.data

      const body = r1.data.body || prefix
      let match = body.match(
        /([\s\S]*)<!--\s*redirectory\s*([\s\S]*?)\s*-->([\s\S]*)/,
      )
      if (match) {
        prefix = match[1]
        suffix = match[3]
        let comment = match[2]
        comment = comment.substring(comment.indexOf('{'))
        try {
          conan = parseJsonPrefix(comment)
        } catch (error) {
          throw new BadGateway(`Bad metadata comment: ${params.root.reference}`)
        }
      } else {
        prefix = body
        conan = { revisions: [] }
      }
    }

    return new RootRelease(octokit, params, github, conan, prefix, suffix)
  }

  async save() {
    const body = this.prefix + RootMetadata.serialize(this.conan) + this.suffix
    const r1 = await this.octokit.rest.repos.updateRelease({
      owner: this.params.owner,
      repo: this.params.repo,
      release_id: this.github.id,
      body,
    })
    if (r1.status !== 200) {
      throw new BadGateway(
        `Failed to update metadata: ${this.params.reference}`,
      )
    }
  }
}

namespace PATHS {
  export const reference = '/:api/conans/:package/:version/:host/:owner'
  export const rrev = `${reference}/revisions/:rrev`
  export const pkgid = `${rrev}/packages/:pkgid`
  export const prev = `${pkgid}/revisions/:prev`
}

const router = express.Router()

if (verbosity > 0) {
  console.log('logging enabled')
  router.use((req, res, next) => {
    console.log(req.method, req.url)
    res.on('finish', () => {
      const type = res.get('Content-Type')
      console.log(res.statusCode, req.url, type)
    })
    next()
  })
}

router.get('/:api/ping', (req, res) => {
  res.set('X-Conan-Server-Capabilities', 'complex_search,revisions').send()
})

/**
 * Return the Basic token right back to the Conan client.
 * That token is a base64 encoding of `user:password`.
 * Conan passes whatever is returned as a Bearer token on future requests.
 * If users use their GitHub Personal Access Token as their password,
 * then we'll have what we need.
 */
router.get('/:api/users/authenticate', (req, res) => {
  const header = req.get('Authorization')
  if (!header) {
    throw new BadRequest('Missing header: Authorization')
  }
  const match = header.match(/Basic (.+)/)
  if (!match) {
    throw new BadRequest('Malformed header: Authorization')
  }
  res.type('text/plain').send(match[1])
})

router.get('/:api/users/check_credentials', async (req, res) => {
  const { user, auth } = parseBearer(req)
  const client = req.get('X-Client-Id')
  if (user !== client) {
    console.warn(
      `Bearer token (${user}) does not match X-Client-Id (${client})`,
    )
  }
  // This function is called many times.
  // For now, we disable the call to GitHub to save on traffic costs.
  /*
  const octokit = newOctokit({ auth })
  const r1 = await octokit.rest.users.getAuthenticated()
  if (r1.status !== 200) {
    return res.status(401).send('Invalid GitHub token')
  }
  const login = r1.data.login
  if (login !== user) {
    console.warn(`Bearer token (${user}) does not match GitHub token (${login})`)
  }
  */
  return res.send(user)
})

router.get(`${PATHS.reference}/latest`, async (req, res) => {
  const params = parseRelease(req)
  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })
  const root = await RootRelease.open(octokit, params)
  if (root.conan.revisions.length === 0) {
    return res.status(404).send(`Recipe not found: ${params.reference}`)
  }
  const { revision, time } = maxBy(root.conan.revisions, ({ time }) => time)
  return res.send({ revision, time })
})

router.get(`${PATHS.reference}/revisions`, async (req, res) => {
  const params = parseRelease(req)
  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })
  const root = await RootRelease.open(octokit, params)
  if (root.conan.revisions.length === 0) {
    return res.status(404).send(`Recipe not found: ${params.reference}`)
  }
  return res.send({
    revisions: root.conan.revisions.map(({ revision, time }) => ({
      revision,
      time,
    })),
  })
})

router.get(`${PATHS.reference}/download_urls`, async (req, res) => {
  const params = parseRelease(req)
  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })
  const root = await RootRelease.open(octokit, params)
  const data = {}
  for (const asset of root.github.assets) {
    data[asset.name] = asset.browser_download_url
  }
  return res.send(data)
})

router.get(`${PATHS.pkgid}/download_urls`, (req, res) => {
  // TODO: Implement binary uploads.
  return res.status(501).send()
})

router.delete(`${PATHS.rrev}`, async (req, res) => {
  const params = parseRelease(req)
  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })
  const root = await RootRelease.open(octokit, params)
  const index = root.conan.revisions.findIndex(
    (r) => r.revision === params.rrev,
  )
  // TODO: Handle missing revision.
  const recipe = root.conan.revisions[index]

  if (params.rrev === '0') {
    // We should never delete the root release, even if we created it.
    // We should still delete the special assets.
    for (const asset of root.github.assets) {
      // TODO: Filter for special assets.
      await octokit.rest.repos.deleteReleaseAsset({
        owner: params.owner,
        repo: params.repo,
        asset_id: asset.id,
      })
      // TODO: Handle error.
    }
  } else {
    await octokit.rest.repos.deleteRelease({
      owner: params.owner,
      repo: params.repo,
      release_id: recipe.release.id,
    })
    // TODO: Handle error.
  }

  for (const pkg of recipe.packages) {
    await octokit.rest.repos.deleteRelease({
      owner: params.owner,
      repo: params.repo,
      release_id: pkg.release.id,
    })
    // TODO: Handle error.
  }

  root.conan.revisions.splice(index, 1)
  await root.save()

  return res.send()
})

router.get(`${PATHS.rrev}/files`, getFiles)

router.get(`${PATHS.rrev}/files/:filename`, getFile)

router.put(`${PATHS.rrev}/files/:filename`, async (req, res) => {
  const params = parseRelease(req)
  const { owner, repo, rrev } = params
  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })
  const root = await RootRelease.open(octokit, params, { force: true })

  let release_id: number
  let origin: string
  const index = root.conan.revisions.findIndex((r) => r.revision === rrev)
  if (index < 0) {
    if (rrev === '0') {
      release_id = root.github.id
      origin = new URL(root.github.upload_url).origin
    } else {
      // Do not create tags for recipe revisions, only package revisions.
      const r1 = await octokit.rest.repos.createRelease({
        owner,
        repo,
        tag_name: params.tag,
      })
      // TODO: Handle error.
      release_id = r1.data.id
      origin = new URL(r1.data.upload_url).origin
    }
    root.conan.revisions.push({
      revision: rrev,
      time: nowString(),
      release: {
        id: release_id,
        origin,
      },
      packages: [],
    })
    root.save()
  } else {
    if (rrev === '0') {
      release_id = root.github.id
      origin = new URL(root.github.upload_url).origin
    } else {
      const recipe = root.conan.revisions[index]
      release_id = recipe.release.id
      origin = recipe.release.origin
    }
  }

  const filename = req.params.filename
  const extension = path.extname(filename)
  const mimeType = MIME_TYPES[extension] || 'application/octet-stream'

  const r1 = await fetch(
    `${origin}/repos/${owner}/${repo}/releases/${release_id}/assets?name=${filename}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${auth}`,
        'Content-Type': mimeType,
        'Content-Length': req.get('Content-Length'),
        'X-GitHub-Api-Version': '2022-11-28',
      },
      duplex: 'half',
      body: req,
    } as any,
  )
  if (r1.status !== 200) {
    return res.status(r1.status).send(r1.text())
  }

  return res.send()
})

router.get(`${PATHS.pkgid}/latest`, (req, res) => {
  // TODO: Read from root release metadata
  return res.status(404).send()
})

router.get(`${PATHS.prev}/files`, getFiles)

router.get(`${PATHS.prev}/files/:filename`, getFile)

router.put(`${PATHS.prev}/files/:filename`, async (req, res) => {
  const { repo, tag, owner, reference, root } = parseRelease(req)
  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })

  let r1: { status: number; data: { id: number; upload_url: string } } =
    await octokit.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag,
    })
  if (r1.status !== 200) {
    const r2 = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: root.tag,
      mediaType: { format: 'sha' },
    })
    if (r2.status !== 200) {
      return res.status(422).send(`Release not found: '${root.reference}'`)
    }
    const target_commitish = r2.data.sha
    r1 = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      target_commitish,
    })
    if (r1.status !== 200) {
      return res.status(422).send(`Cannot create release: '${reference}'`)
    }
  }

  const release_id = r1.data.id
  const origin = new URL(r1.data.upload_url).origin

  const filename = req.params.filename
  const extension = path.extname(filename)
  const mimeType = MIME_TYPES[extension] || 'application/octet-stream'

  // TODO: See if octokit.request works.
  const r3 = await fetch(
    `${origin}/repos/${owner}/${repo}/releases/${release_id}/assets?name=${filename}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${auth}`,
        'Content-Type': mimeType,
        'Content-Length': req.get('Content-Length'),
        'X-GitHub-Api-Version': '2022-11-28',
      },
      duplex: 'half',
      body: req,
    } as any,
  )
  if (r3.status !== 200) {
    return res.status(r3.status).send()
  }

  if (filename === 'conanmanifest.txt') {
    // TODO: Add rrev, pkgid, prev to root release metadata
  }
})

/** This may be impossible to implement. */
router.get('/:api/conans/search', async (req, res) => {
  const query = req.query.q
  // TODO: Split name from version. For now, assume just name.

  const results = []

  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })
  const r1 = await octokit.rest.search.repos({
    q: `${query} in:name topic:redirectory`,
    sort: 'stars',
    order: 'desc',
  })
  if (r1.status !== 200) {
    return res.send({ results })
  }

  for (const result of r1.data.items) {
    const owner = result.owner.login
    const repo = result.name
    const r2 = await octokit.rest.repos.listReleases({ owner, repo })
    if (r2.status !== 200) {
      continue
    }
    for (const release of r2.data) {
      const tag = release.tag_name
      // TODO: Good way to translate backwards from release to reference?
      results.push(`${repo}/${tag}@github/${owner}`)
    }
  }

  return res.send({ results })
})

router.all('*', (req, res) => {
  console.log(req.method, req.originalUrl)
  res.status(501).send()
})

router.use((err, req, res, next) => {
  console.error(err)
  if (err instanceof HttpError) {
    return res.status(err.code).send(err.message)
  }
  return res.status(500).send(err.message)
})

export default router
