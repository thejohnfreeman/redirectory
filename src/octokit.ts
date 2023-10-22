import fs from 'fs'
import { Octokit } from 'octokit'
import { badRequest } from './http.js'
import { createOAuthAppAuth } from '@octokit/auth-oauth-app'

const verbose = parseInt(process.env.VERBOSE) || 0

function unbase64(input) {
  return Buffer.from(input, 'base64').toString('ascii')
}

const DEFAULT_OCTOKIT = (() => {
  let contents
  try {
    contents = fs.readFileSync('oauth.json')
  } catch (cause) {
    console.error('cannot read oauth.json', cause)
    return
  }
  const auth = JSON.parse(contents)
  const kit = new Octokit({ authStrategy: createOAuthAppAuth, auth })
  return kit
})()

/**
 * In the Authorization header, the bearer token is the base64-encoded string
 * `{user}:{auth}`.
 */
export function parseBearer(req) {
  const header = req.get('Authorization')
  if (!header) {
    const { user, auth } = req.query
    if (user && auth) {
      return { user, auth }
    }
    throw badRequest('Missing header: Authorization')
  }
  const m1 = header.match(/^Bearer\s+(\S+?)\s*$/)
  if (!m1) {
    throw badRequest('Malformed header: Authorization')
  }
  const userpass = unbase64(m1[1])
  const m2 = userpass.match(/([^:]+):(.+)/)
  if (!m2) {
    throw badRequest('Malformed header: Authorization')
  }
  const user = m2[1]
  const auth = m2[2]
  return { user, auth }
}

// TODO: What is the type of an Octokit exception?
export function getResponse(error) {
  return error.response
}

export interface Repository {
  owner: string
  name: string
}

export function parseRepository(req): Repository {
  return {
    owner: req.params.channel,
    name: req.params.name,
  }
}

class Traps {
  constructor(private path: string) {}

  get(target, property) {
    return new Proxy(
      Reflect.get(target, property),
      new Traps(this.path + '.' + property),
    )
  }

  async apply(target, self, args) {
    try {
      const response = await Reflect.apply(target, self, args)
      console.debug(this.path, args)
      console.debug(response)
      return response
    } catch (error) {
      console.debug(this.path, args)
      console.debug(error)
      throw error
    }
  }
}

export function newOctokit(req, write = false) {
  let user = '<anonymous>'
  let auth = undefined
  try {
    ({ user, auth } = parseBearer(req))
  } catch (cause) {
    if (write) {
      throw cause
    }
  }
  let octokit = auth ? new Octokit({ auth }) : DEFAULT_OCTOKIT
  if (verbose > 1) {
    octokit = new Proxy(octokit, new Traps('octokit'))
  }
  return { user, auth, octokit }
}

export class Client {
  constructor(
    public readonly owner: string,
    public readonly repo: string,
    private octokit: Octokit,
    public readonly auth?: string,
  ) {}

  static new(req, write = false) {
    const { owner, name: repo } = parseRepository(req)
    const { auth, octokit } = newOctokit(req, write)
    return new Client(owner, repo, octokit, auth)
  }

  getRelease(id: number) {
    return this.octokit.rest.repos.getRelease({
      owner: this.owner,
      repo: this.repo,
      release_id: id,
    })
  }

  getReleaseByTag(tag: string) {
    return this.octokit.rest.repos.getReleaseByTag({
      owner: this.owner,
      repo: this.repo,
      tag: tag,
    })
  }

  createRelease(tag: string, parameters: object = {}) {
    return this.octokit.rest.repos.createRelease({
      owner: this.owner,
      repo: this.repo,
      tag_name: tag,
      ...parameters,
    })
  }

  deleteRelease(id: number) {
    return this.octokit.rest.repos.deleteRelease({
      owner: this.owner,
      repo: this.repo,
      release_id: id,
    })
  }

  updateRelease(id: number, parameters: object) {
    return this.octokit.rest.repos.updateRelease({
      owner: this.owner,
      repo: this.repo,
      release_id: id,
      ...parameters,
    })
  }

  deleteAsset(id: number) {
    return this.octokit.rest.repos.deleteReleaseAsset({
      owner: this.owner,
      repo: this.repo,
      asset_id: id,
    })
  }
}
