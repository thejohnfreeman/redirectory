import { Octokit } from '@octokit/core'
import express from 'express'
import getRawBody from 'raw-body'

const port = 9494

const app = express()

function unbase64(input) {
  return Buffer.from(input, 'base64').toString('ascii')
}

class HttpError {
  constructor(code, message) {
    self.code = code
    self.message = message
  }
}

class BadRequest extends HttpError {
  constructor(message) {
    super(400, message)
  }
}

function httpErrorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.code).send(err.message)
  }
  next(err)
}

app.use(httpErrorHandler)

function bearer(req) {
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

app.get('/v1/ping', (req, res) => {
  res
    .set('X-Conan-Server-Capabilities', 'complex_search,revisions')
    .send()
})

/**
 * Called during `conan user`.
 *
 * Return the Basic token right back to the Conan client.
 * Conan will pass whatever is returned as the Bearer token on future
 * requests.
 * That token is a base64 encoding of `user:ghtoken`.
 */
app.get('/:api/users/authenticate', (req, res) => {
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

/**
 * Redirect to GitHub.
 *
 * Called during `conan install`.
 * Artifactory returns URLs of this form in the response to a `download_urls`
 * request, but we can just return GitHub URLs directly.
 *
 * Called during `conan upload` for `conanmanifest.txt`.
 * If it returns 404, then Conan proceeds to call `check_credentials` and then
 * `files`.
 */
app.get('/:api/conans/:pkg/:version/:host/:owner/revisions/:revision/files/:file', (req, res) => {
  const pkg = req.params.pkg
  const version = req.params.version
  const host = req.params.host
  const owner = req.params.owner
  const ref = `${pkg}/${version}@${host}/${owner}`

  if (host !== 'github') {
    return res.status(403).send(`Not a GitHub pkg: '${ref}'`)
  }

  const file = req.params.file
  return res.redirect(301, `https://github.com/${owner}/${pkg}/releases/download/${version}/${file}`)
})

app.get('/:api/users/check_credentials', async (req, res) => {
  const { user, auth } = bearer(req)
  const client = req.get('X-Client-Id')
  if (user !== client) {
    console.warn(`Bearer token (${user}) does not match X-Client-Id (${client})`)
  }
  const octokit = new Octokit({ auth })
  try {
    const response = await octokit.rest.users.getAuthenticated()
    const login = response.data.login
    if (login !== user) {
      console.warn(`Bearer token (${user}) does not match GitHub token (${login})`)
    }
  } catch (error) {
    return res.status(401).send('Invalid GitHub token')
  }
  return res.send(user)
})

/**
 * Called during `conan upload`.
 * If it returns 404, then Conan uploads assets.
 * If it returns 200, then the package exists.
 */
app.get('/:api/conans/:pkg/:version/:host/:owner/revisions/:revision/files', async (req, res) => {
  const pkg = req.params.pkg
  const version = req.params.version
  const host = req.params.host
  const owner = req.params.owner
  const ref = `${pkg}/${version}@${host}/${owner}`

  if (host !== 'github') {
    return res.status(403).send(`Not a GitHub pkg: '${ref}'`)
  }

  const { user, auth } = bearer(req)
  const octokit = new Octokit({ auth })
  // TODO: Catch every exception and return error.response instead.
  try {
    const response = await octokit.rest.repos.getReleaseByTag({
      owner,
      repo: pkg,
      tag: version
    })

    const files = {}
    for (const asset of response.data.assets) {
      files[asset.name] = {}
    }
    return res.send({ files })
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).send(`Recipe not found: ${ref}`)
    }
    console.warn(error)
  }
})

/** This may be impossible to implement. */
app.get('/:api/conans/search', (req, res) => {
  const pkg = req.query.q
  // TODO: Get list of releases, or check for specific release
  return res.send({results: [`${pkg}/1.2.13@github/thejohnfreeman`]})
})

/**
 * Called as the first step of `conan install`.
 */
app.get('/:api/conans/:pkg/:version/:host/:owner/download_urls', (req, res) => {
  const pkg = req.params.pkg
  const version = req.params.version
  const host = req.params.host
  const owner = req.params.owner
  const ref = `${pkg}/${version}@${host}/${owner}`

  if (host !== 'github') {
    return res.status(403).send(`Not a GitHub package: '${ref}'`)
  }

  // TODO: Check if the release exists.
  const found = true
  if (!found) {
    return res.status(404).send(`Recipe not found: '${ref}'`)
  }

  const data = {}
  const files = ['conanmanifest.txt', 'conanfile.py', 'conan_export.tgz', 'conan_sources.tgz']
  for (const file of files) {
    data[file] = `https://github.com/${owner}/${pkg}/releases/download/${version}/${file}`
  }
  return res.send(data)
})

app.get('/:api/conans/:pkg/:version/:host/:owner/packages/:pid/download_urls', (req, res) => {
  return res.status(404).send()
})

/**
 * Called during `conan upload`.
 */
app.put('/:api/conans/:pkg/:version/:host/:owner/revisions/:revision/files/:file', async (req, res) => {
  const pkg = req.params.pkg
  const version = req.params.version
  const host = req.params.host
  const owner = req.params.owner
  const ref = `${pkg}/${version}@${host}/${owner}`

  if (host !== 'github') {
    return res.status(403).send(`Not a GitHub package: '${ref}'`)
  }

  const { user, auth } = bearer(req)
  const octokit = new Octokit({ auth })

  let release_id, origin
  try {
    const response = await octokit.rest.repos.getReleaseByTag({
      owner,
      repo: pkg,
      tag: version,
    })
    release_id = response.data.id
    // TODO: Extract origin from the `download_url`.
    origin = 'uploads.github.com'
  } catch (error) {
    if (error.status !== 404) {
      return res.status(403).send(`Cannot find release: '${ref}'`)
    }

    try {
      const response = await octokit.rest.repos.getReleaseByTag({
        owner,
        repo: pkg,
        tag_name: `v${version}`,
      })
      release_id = response.data.id
      origin = 'uploads.github.com'
    } catch (error) {
      return res.status(403).send(`Cannot find release: '${ref}'`)
    }
  }

  try {
    const data = await getRawBody(req)
    // TODO: Handle missing header, and malformed header.
    const length = parseInt(req.get('Content-Length'))
    if (data.length !== length) {
      return res.status(400).send(`Content length does not match header: ${data.length} != ${length}`)
    }

    await octokit.rest.repos.uploadReleaseAsset({
      origin,
      owner,
      repo: pkg,
      release_id,
      name: req.params.file,
      data,
    })

    return res.send()
  } catch (error) {
    console.error(error)
    return res.status(error.status)
  }
})

/**
 * Called during `conan remove`.
 */
app.get('/:api/conans/:pkg/:version/:host/:owner/revisions', (req, res) => {
  const pkg = req.params.pkg
  const version = req.params.version
  const host = req.params.host
  const owner = req.params.owner
  const ref = `${pkg}/${version}@${host}/${owner}`

  if (host !== 'github') {
    return res.status(403).send(`Not a GitHub pkg: '${ref}'`)
  }

  return res.send({revisions: [{revision: '0', time: new Date().toISOString()}]})
})

/**
 * Called during `conan remove`.
 */
app.delete('/:api/conans/:pkg/:version/:host/:owner/revisions/:revision', async (req, res) => {
  const pkg = req.params.pkg
  const version = req.params.version
  const host = req.params.host
  const owner = req.params.owner
  const ref = `${pkg}/${version}@${host}/${owner}`

  if (host !== 'github') {
    return res.status(403).send(`Not a GitHub pkg: '${ref}'`)
  }

  const { user, auth } = bearer(req)
  const octokit = new Octokit({ auth })

  let response
  try {
    response = await octokit.rest.repos.getReleaseByTag({
      owner,
      repo: pkg,
      tag: version
    })
  } catch (error) {
    return res.status(403).send(`Cannot find release: '${ref}'`)
  }

  for (const asset of response.data.assets) {
    try {
      await octokit.rest.repos.deleteReleaseAsset({
        owner,
        repo: pkg,
        asset_id: asset.id
      })
    } catch (error) {
      console.error(error)
    }
  }

  return res.send()
})

app.all('*', (req, res) => {
  console.log(req.method, req.originalUrl)
  res.status(501).send()
})

app.listen(port, () => {
  console.log(`listening on port ${port}`)
})
