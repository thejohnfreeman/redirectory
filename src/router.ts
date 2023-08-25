import { strict as assert } from 'node:assert'
import express from 'express'
import path from 'path'
import { OctokitResponse } from '@octokit/types'
import { Octokit } from 'octokit'
import { newOctokit } from './octokit.js'
import { release } from 'node:process'

function nowString() {
  return new Date().toISOString()
}

interface Item<T> {
  value: T,
  index: number,
}

function maxBy<T, K>(xs: T[], f: (x: T) => K): Item<T> {
  assert(xs.length > 0)
  let index = 0;
  let value = xs[0]
  let key = f(value)
  for (let i = 1; i < xs.length; ++i) {
    const xi = xs[i]
    const ki = f(xi)
    if (ki > key) {
      index = i
      value = xi
      key = ki
    }
  }
  return { value, index }
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
  const m1 = header.match(/^Bearer\s+(\S+?)\s*$/)
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

interface RecipeParameters {
  name: string
  version: string
  user: string
  channel: string
  reference: string
}

interface RecipeRevisionParameters extends RecipeParameters {
  rrev: string
}

interface PackageParameters extends RecipeRevisionParameters {
  pid: string
}

interface PackageRevisionParamaters extends PackageParameters {
  prev: string
}

// TODO: Rename (host, owner) to (user, channel).
// TODO: Introduce host !== 'github' => tag = channel.
function parseRecipeParameters(req: express.Request): RecipeParameters {
  const name = req.params.package
  const version = req.params.version
  const user = req.params.host
  const channel = req.params.owner
  const reference = `${name}/${version}@${user}/${channel}`
  if (user !== 'github') {
    throw new Forbidden(`Not a GitHub package: '${reference}'`)
  }
  return { name, version, user, channel, reference }
}

function parseReleaseParameters(req: express.Request): ReleaseParameters {
  const repo = req.params.package
  const version = req.params.version
  const host = req.params.host
  const owner = req.params.owner
  const rrev = req.params.rrev
  const pkgid = req.params.pkgid
  const prev = req.params.prev

  let tag = version
  let reference = `${repo}/${version}@${host}/${owner}`
  if (rrev && rrev !== '0') {
    tag += '#' + rrev
    reference += '#' + rrev
  }
  if (pkgid) {
    // `:` is not valid in a Git tag name.
    // Two tags cannot coexist when one is a prefix of the other,
    // followed immediately by a directory separator (`/`).
    tag += '@' + pkgid
    reference += ':' + pkgid
    if (prev) {
      tag += '#' + prev
      reference += '#' + prev
    }
  }

  if (host !== 'github') {
    throw new Forbidden(`Not a GitHub package: '${reference}'`)
  }

  return { repo, tag, owner, reference }
}

function parseParams(req): ReleaseParameters {
  const repo = req.params.package
  const root: any = {}
  const version = req.params.version
  const host = req.params.host
  const owner = req.params.owner
  root.reference = `${repo}/${version}@${host}/${owner}`
  let reference = root.reference
  let suffix = ''
  const rrev = req.params.rrev
  const pkgid = req.params.pkgid
  const prev = req.params.prev

  if (rrev && rrev !== '0') {
    suffix += '#' + rrev
    reference += '#' + rrev
  }
  if (pkgid) {
    // `:` is not valid in a Git tag name.
    // Two tags cannot coexist when one is a prefix of the other,
    // followed immediately by a directory separator (`/`).
    suffix += '@' + pkgid
    reference += ':' + pkgid
    if (prev) {
      suffix += '#' + prev
      reference += '#' + prev
    }
  }

  const match = host.match(/(.*)github(.*)/)
  if (!match) {
    throw new Forbidden(`Not a GitHub package: '${reference}'`)
  }

  root.tag = match[1] + version + match[2]
  const tag = root.tag + suffix

  return { repo, tag, host, owner, rrev, pkgid, prev, reference, root }
}

/** Return a list of asset names for the requested release. */
async function getFiles(req: express.Request, res) {
  const { repo, tag, owner, reference } = parseParams(req)

  const { auth } = parseBearer(req)
  const octokit = newOctokit({ auth })

  const r1 = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  })
  if (r1.status !== 200) {
    throw new NotFound(`Recipe not found: ${reference}`)
  }

  const files = {}
  for (const asset of r1.data.assets) {
    files[asset.name] = {}
  }
  return res.send({ files })
}

/** Return a redirect for the requested file. */
function getFile(req: express.Request, res) {
  const { repo, tag, owner } = parseReleaseParameters(req)
  const filename = req.params.filename
  // It seems we can assume the download URL.
  return res.redirect(
    301,
    `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/${filename}`,
  )
}

/**
 * Parse JSON at the start of a string, after any whitespace.
 */
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

interface PackageRevisionMetadata {
  revision: string
  time: string
  release: {
    id: number
    origin: string
  }
}

interface PackageMetadata {
  id: string,
  revisions: PackageRevisionMetadata[]
}

interface RecipeRevisionMetadata {
    revision: string
    time: string
    release?: {
      id: number
      origin: string
    }
    packages: PackageMetadata[]
  }

interface RecipeMetadata {
  revisions: RecipeRevisionMetadata[]
}

namespace RecipeMetadata {
  export function serialize(metadata: RecipeMetadata): string {
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
    public conan: RecipeMetadata,
    private prefix: string,
    private suffix: string,
  ) {}

  static async open(
    octokit: Octokit,
    params: ReleaseParameters,
    { force = false } = {},
  ): Promise<RootRelease> {
    let github
    let conan: RecipeMetadata = {
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
        body: prefix + RecipeMetadata.serialize(conan),
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
    const body = this.prefix + RecipeMetadata.serialize(this.conan) + this.suffix
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

class RecipeDatabase {
  constructor(
    private octokit: Octokit,
    public readonly rparams: RecipeParameters,
    public root: RootRelease,
  ) {}

  static async open(
    req: express.Request,
    { force = false } = {},
  ): Promise<RecipeDatabase> {
    const rparams = parseRecipeParameters(req)
    const { auth } = parseBearer(req)
    const octokit = newOctokit({ auth })
    const root = await RootRelease.open(
      octokit,
      { owner: rparams.channel, repo: rparams.name, tag: rparams.version },
      { force },
    )
    return new RecipeDatabase(octokit, rparams, root)
  }

  getLatestRevision(type: string, md: RecipeMetadata): Item<RecipeRevisionMetadata>
  getLatestRevision(type: string, md: PackageMetadata): Item<PackageRevisionMetadata>
  getLatestRevision(type: string, md) {
    if (md.revisions.length === 0) {
      throw new NotFound(`${type} not found: ${this.rparams.reference}`)
    }
    return maxBy(md.revisions, ({ time }) => time)
  }

  getRecipeRevision(md: RecipeMetadata, rrev: string): Item<RecipeRevisionMetadata> {
    const index = md.revisions.findIndex((r) => r.revision === rrev)
    if (index < 0) {
      throw new NotFound(`Revision not found: ${this.rparams.reference}#${rrev}`)
    }
    return { value: md.revisions[index], index }
  }

  getPackage(md: RecipeRevisionMetadata, pid: string): Item<PackageMetadata> {
    const index = md.packages.findIndex(p => p.id === pid)
    if (index < 0) {
      // TODO: Add `reference` to `Item`.
      throw new NotFound(`Package not found: ${this.rparams.reference}:${pid}`)
    }
    return { value: md.packages[index], index }
  }

  // TODO: Rethink references.
  getPackageRevision(md: PackageMetadata, prev: string): Item<PackageRevisionMetadata> {
    const index = md.revisions.findIndex((p) => p.revision === prev)
    if (index < 0) {
      throw new NotFound(`Revision not found: ${this.rparams.reference}#${prev}`)
    }
    return { value: md.revisions[index], index }
  }

  async deletePackages($rrev: RecipeRevisionMetadata) {
    for (const $package of $rrev.packages) {
      for (const $prev of $package.revisions) {
        await this.octokit.rest.repos.deleteRelease({
          owner: this.rparams.channel,
          repo: this.rparams.name,
          release_id: $prev.release.id,
        })
        // TODO: Skip 404, throw !2xx.
      }
    }
  }

  async deleteRecipeRevision($rrev: RecipeRevisionMetadata) {
    if ($rrev.revision === '0') {
      // We should never delete the root release, even if we created it.
      // We should still delete the special assets.
      for (const asset of this.root.github.assets) {
        // TODO: Filter for just Conan assets?
        await this.octokit.rest.repos.deleteReleaseAsset({
          owner: this.rparams.channel,
          repo: this.rparams.name,
          asset_id: asset.id,
        })
        // TODO: Skip 404, throw !2xx.
      }
    } else {
      await this.octokit.rest.repos.deleteRelease({
        owner: this.rparams.channel,
        repo: this.rparams.name,
        release_id: $rrev.release.id,
      })
      // TODO: Skip 404, throw !2xx.
    }
  }

}


namespace PATHS {
  // TODO: Rename to recipe.
  export const reference = '/:api/conans/:package/:version/:host/:owner'
  export const rrev = `${reference}/revisions/:rrev`
  // TODO: Rename to package.
  export const pkgid = `${rrev}/packages/:pkgid`
  export const prev = `${pkgid}/revisions/:prev`
}

const router = express.Router()

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

router.get(`${PATHS.reference}`, async (req, res) => {
  // Return 404 if there are no revisions.
  // Return 200 and {filename: digest, ...} if there is.
})

router.get(`${PATHS.reference}/latest`, async (req, res) => {
  const db = await RecipeDatabase.open(req)
  const { revision, time } = db.getLatestRevision('Recipe', db.root.conan).value
  return res.send({ revision, time })
})

router.get(`${PATHS.reference}/revisions`, async (req, res) => {
  const db = await RecipeDatabase.open(req)
  if (db.root.conan.revisions.length === 0) {
    throw new NotFound(`Recipe not found: '${db.rparams.reference}'`)
  }
  return res.send({
    revisions: db.root.conan.revisions.map(({ revision, time }) => ({
      revision,
      time,
    })),
  })
})

router.get(`${PATHS.reference}/download_urls`, async (req, res) => {
  const db = await RecipeDatabase.open(req)
  const data = {}
  for (const asset of db.root.github.assets) {
    data[asset.name] = asset.browser_download_url
  }
  return res.send(data)
})

router.get(`${PATHS.pkgid}/download_urls`, (req, res) => {
  // TODO: Implement binary uploads.
  return res.status(501).send()
})

router.delete(`${PATHS.reference}`, async (req, res) => {
  const db = await RecipeDatabase.open(req)

  for (const $rrev of db.root.conan.revisions) {
    db.deletePackages($rrev)
    db.deleteRecipeRevision($rrev)
  }
  db.root.conan.revisions = []
  await db.root.save()

  return res.send()
})

router.delete(`${PATHS.rrev}`, async (req, res) => {
  const db = await RecipeDatabase.open(req)
  const rrev = req.params.rrev
  const item = db.getRecipeRevision(db.root.conan, rrev)

  db.deleteRecipeRevision(item.value)
  db.root.conan.revisions.splice(item.index, 1)
  await db.root.save()

  return res.send()
})

router.get(`${PATHS.rrev}/files`, getFiles)

router.get(`${PATHS.rrev}/files/:filename`, getFile)

router.put(`${PATHS.rrev}/files/:filename`, async (req, res) => {
  const params = parseParams(req)
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
    await root.save()
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
  if (r1.status !== 201) {
    return res.status(r1.status).send(r1.text())
  }

  return res.status(201).send()
})

router.delete(`${PATHS.rrev}/packages`, async (req, res) => {
  const db = await RecipeDatabase.open(req)
  const rrev = req.params.rrev
  const $rrev = db.getRecipeRevision(db.root.conan, rrev).value

  db.deletePackages($rrev)
  $rrev.packages = []
  await db.root.save()

  return res.send()
})

router.get(`${PATHS.pkgid}/latest`, async (req, res) => {
  const db = await RecipeDatabase.open(req)
  const rrev = req.params.rrev
  const pid = req.params.pkgid
  const $rrev = db.getRecipeRevision(db.root.conan, rrev).value
  const $package = db.getPackage($rrev, pid).value
  const { revision, time } = db.getLatestRevision('Package', $package).value
  return res.send({ revision, time })
})

router.get(`${PATHS.prev}/files`, getFiles)

router.get(`${PATHS.prev}/files/:filename`, getFile)

router.put(`${PATHS.prev}/files/:filename`, async (req, res) => {
  const params = parseParams(req)
  const { repo, tag, owner } = params
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
      ref: params.root.tag,
      mediaType: { format: 'sha' },
    })
    if (r2.status !== 200) {
      return res.status(422).send(`Release not found: '${params.root.reference}'`)
    }
    const target_commitish = r2.data as any as string
    r1 = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      target_commitish,
    })
    if (r1.status !== 201) {
      return res.status(422).send(`Cannot create release: '${params.reference}'`)
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
  if (r3.status !== 201) {
    return res.status(r3.status).send(r3.text())
  }

  if (filename === 'conanmanifest.txt') {
    const { rrev, pkgid, prev } = params
    const root = await RootRelease.open(octokit, params)
    let recipe = root.conan.revisions.find(r => r.revision === rrev)
    if (!recipe) {
      recipe = { revision: rrev, time: nowString(), packages: [] }
      root.conan.revisions.push(recipe)
    }
    let pkg = recipe.packages.find(p => p.id === pkgid)
    if (!pkg) {
      pkg = { id: pkgid, revisions: [] }
      recipe.packages.push(pkg)
    }
    const build_ = {
      revision: prev,
      time: nowString(),
      release: { id: release_id, origin },
    }
    const build = pkg.revisions.find(r => r.revision === prev)
    if (!build) {
      pkg.revisions.push(build_)
    } else {
      Object.assign(build, build_)
    }
    await root.save()
  }
  return res.status(201).send()
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
