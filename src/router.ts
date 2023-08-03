import express from 'express'
import path from 'path'
import { newOctokit } from './octokit.js'

const MIME_TYPES = {
  '.txt': 'text/plain',
  '.py': 'text/x-python',
  '.tgz': 'application/gzip',
}

const router = express.Router()

function unbase64(input) {
  return Buffer.from(input, 'base64').toString('ascii')
}

class HttpError {
  constructor(public code: number, public message: string) {}
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

function httpErrorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.code).send(err.message)
  }
  return res.status(500).send(err.message)
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
  owner: string,
  repo: string,
  tag: string,
  [key: string]: any,
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
    // `:` is not valid in a Git tag name.
    suffix += '/' + rrev
    reference += ':' + rrev
  }
  if (req.params.pkgid) {
    suffix += '#' + req.params.pkgid
    reference += '#' + req.params.pkgid
    if (req.params.prev) {
      suffix += '/' + req.params.prev
      reference += ':' + req.params.prev
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

async function getFiles(req, res) {
  const { repo, tag, owner, reference } = parseRelease(req)

  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })

  const response = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  })
  if (response.status !== 200) {
    return res.status(404).send(`Recipe not found: ${reference}`)
  }

  const files = {}
  for (const asset of response.data.assets) {
    files[asset.name] = {}
  }
  return res.send({ files })
}

function getFile(req, res) {
  const { repo, tag, owner } = parseRelease(req)
  const filename = req.params.filename
  // TODO: Do we need to look up the download URL or can we assume its form?
  return res.redirect(301, `https://github.com/${owner}/${repo}/releases/download/${tag}/${filename}`)
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

class ReferenceMetadata {
  constructor(public params: ReleaseParameters, public json: object, private prefix: string, private suffix: string) {}
}

function getReferenceMetadata(octokit: Octokit, params: ReleaseParameters, force = False) {
  let response = await octokit.rest.repos.getReleaseByTag({
    owner: params.owner,
    repo: params.repo,
    tag: params.root.tag,
  })

  let json = {}
  let prefix = ''
  let suffix = ''

  if (response.status !== 200) {
    if (!force) {
      throw new NotFound(`Recipe not found: '${reference}'`)
    }
    response = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
    })

  } else {
    assert(typeof response.data.body === 'string')
    let match = response.data.body.match(/(.*)<!--\s*redirectory\s*(.*?)\s*-->(.*)/)
    if (match) {
      prefix = match[1]
      suffix = match[3]
      let comment = match[2]
      comment = comment.substring(comment.indexOf('{'))
      try {
        json = parseJsonPrefix(comment)
      } catch (error) {
        throw new BadGateway(`Bad metadata comment: ${params.root.reference}`)
      }
    }
  }

  return new ReferenceMetadata(params, json, prefix, suffix)
}

router.get('/v1/ping', (req, res) => {
  res
    .set('X-Conan-Server-Capabilities', 'complex_search,revisions')
    .send()
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
    return res.status(400).send('Missing header: Authorization')
  }
  const match = header.match(/Basic (.+)/)
  if (!match) {
    return res.status(400).send('Malformed header: Authorization')
  }
  res.type('text/plain').send(match[1])
})

router.get('/:api/users/check_credentials', async (req, res) => {
  const { user, auth } = parseBearer(req)
  const client = req.get('X-Client-Id')
  if (user !== client) {
    console.warn(`Bearer token (${user}) does not match X-Client-Id (${client})`)
  }
  // This function is called many times.
  // For now, we disable the call to GitHub to save on traffic costs.
  /*
  const octokit = newOctokit({ auth })
  const response = await octokit.rest.users.getAuthenticated()
  if (response.status !== 200) {
    return res.status(401).send('Invalid GitHub token')
  }
  const login = response.data.login
  if (login !== user) {
    console.warn(`Bearer token (${user}) does not match GitHub token (${login})`)
  }
  */
  return res.send(user)
})

router.get('/:api/conans/:package/:version/:host/:owner/latest', (req, res) => {
  return res.send({revision: '0', time: new Date().toISOString()})
})

router.get('/:api/conans/:package/:version/:host/:owner/revisions', (req, res) => {
  return res.send({revisions: [{revision: '0', time: new Date().toISOString()}]})
})

router.get('/:api/conans/:package/:version/:host/:owner/download_urls', async (req, res) => {
  const { repo, tag, owner, reference } = parseRelease(req)

  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })

  // TODO: Factor out release search.
  let response = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  })
  if (response.status !== 200) {
    return res.status(404).send(`Recipe not found: '${reference}'`)
  }

  const data = {}
  const filenames = ['conanmanifest.txt', 'conanfile.py', 'conan_export.tgz', 'conan_sources.tgz']
  for (const filename of filenames) {
    data[filename] = `https://github.com/${owner}/${repo}/releases/download/${tag}/${filename}`
  }
  return res.send(data)
})

router.get('/:api/conans/:package/:version/:host/:owner/packages/:pkgid/download_urls', (req, res) => {
  // TODO: Implement binary uploads.
  return res.status(404).send()
})

router.delete('/:api/conans/:package/:version/:host/:owner/revisions/:rrev', async (req, res) => {
  const { repo, tag, owner, reference } = parseRelease(req)

  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })

  let response = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  })
  if (response.status !== 200) {
    return res.status(404).send(`Package not found: '${reference}'`)
  }

  for (const asset of response.data.assets) {
    await octokit.rest.repos.deleteReleaseAsset({
      owner,
      repo,
      asset_id: asset.id
    })
    // TODO: Handle errors.
  }

  // TODO: If rrev !== 0, delete release and change metadata

  return res.send()
})

router.get('/:api/conans/:package/:version/:host/:owner/revisions/:rrev/files', getFiles)

router.get('/:api/conans/:package/:version/:host/:owner/revisions/:rrev/files/:filename', getFile)

router.put('/:api/conans/:package/:version/:host/:owner/revisions/:rrev/files/:filename', async (req, res) => {
  const { repo, tag, owner, rrev, reference } = parseRelease(req)

  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })

  let response = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  })
  if (response.status !== 200) {
    return res.status(422).send(`Package not found: '${reference}'`)
  }

  const release_id = response.data.id
  const origin = new URL(response.data.upload_url).origin

  const filename = req.params.filename
  const extension = path.extname(filename)
  const mimeType = MIME_TYPES[extension] || 'application/octet-stream'

  response = await fetch(`${origin}/repos/${owner}/${repo}/releases/${release_id}/assets?name=${filename}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${auth}`,
      'Content-Type': mimeType,
      'Content-Length': req.get('Content-Length'),
      'X-GitHub-Api-Version': '2022-11-28',
    },
    duplex: 'half',
    body: req,
  } as any)
  if (response.status !== 200) {
    return res.status(response.status).send()
  }

  if (filename === 'conanmanifest.txt' && rrev !== '0') {
    // TODO: Add rrev metadata to root
  }
  return res.send()
})

router.get('/:api/conans/:package/:version/:host/:owner/revisions/:rrev/packages/:pkgid/latest', (req, res) => {
  // TODO: Read from root release metadata
  return res.status(404).send()
})

router.get('/:api/conans/:package/:version/:host/:owner/revisions/:rrev/packages/:pkgid/revisions/:prev/files', getFiles)

router.get('/:api/conans/:package/:version/:host/:owner/revisions/:rrev/packages/:pkgid/revisions/:prev/files/:filename', getFile)

router.put('/:api/conans/:package/:version/:host/:owner/revisions/:rrev/packages/:pkgid/revisions/:prev/files/:filename', async (req, res) => {
  const { repo, tag, owner, reference, root } = parseRelease(req)

  const { user, auth } = parseBearer(req)
  const octokit = newOctokit({ auth })

  let response = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  })
  if (response.status !== 200) {
    response = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: root.tag,
      mediaType: { format: 'sha' },
    })
    if (response.status !== 200) {
      return res.status(422).send(`Release not found: '${root.reference}'`)
    }
    const target_commitish = response.data.sha
    response = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      target_commitish,
    })
    if (response.status !== 200) {
      return res.status(422).send(`Cannot create release: '${reference}'`)
    }
  }

  const release_id = response.data.id
  const origin = new URL(response.data.upload_url).origin

  const filename = req.params.filename
  const extension = path.extname(filename)
  const mimeType = MIME_TYPES[extension] || 'application/octet-stream'

  // TODO: See if octokit.request works.
  response = await fetch(`${origin}/repos/${owner}/${repo}/releases/${release_id}/assets?name=${filename}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${auth}`,
      'Content-Type': mimeType,
      'Content-Length': req.get('Content-Length'),
      'X-GitHub-Api-Version': '2022-11-28',
    },
    duplex: 'half',
    body: req,
  } as any)
  if (response.status !== 200) {
    return res.status(response.status).send()
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
  const response = await octokit.rest.search.repos({
    q: `${query} in:name topic:redirectory`,
    sort: 'stars',
    order: 'desc',
  })
  if (response.status !== 200) {
    return res.send({ results })
  }

  for (const result of response.data.items) {
    const owner = result.owner.login
    const repo = result.name
    const response = await octokit.rest.repos.listReleases({ owner, repo })
    if (response.status !== 200) {
      continue
    }
    for (const release of response.data) {
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

router.use(httpErrorHandler)

export default router
