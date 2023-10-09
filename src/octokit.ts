import { Octokit } from 'octokit'
import { badRequest } from './http.js'

function unbase64(input) {
  return Buffer.from(input, 'base64').toString('ascii')
}

/**
 * In the Authorization header, the bearer token is the base64-encoded string
 * `{user}:{auth}`.
 */
export function parseBearer(req) {
  const header = req.get('Authorization')
  if (!header) {
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

export class Client {
  constructor(
    public readonly auth: string,
    public readonly owner: string,
    public readonly repo: string,
    private octokit: Octokit,
  ) {}

  static new(req) {
    const { auth } = parseBearer(req)
    const owner = req.params.channel
    const repo = req.params.name
    const octokit = new Octokit({ auth })
    return new Client(auth, owner, repo, octokit)
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
