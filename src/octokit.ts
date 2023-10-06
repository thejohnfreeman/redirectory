import { Octokit } from 'octokit'
import { badRequest } from './http.js'

const verbosity = parseInt(process.env.VERBOSITY) || 0

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

const traps = {
  get(target, property) {
    return new Proxy(Reflect.get(target, property), traps)
  },
  async apply(target, self, args) {
    try {
      return await Reflect.apply(target, self, args)
    } catch (error) {
      return error.response
    }
  },
}

if (verbosity > 1) {
  const apply = traps.apply
  traps.apply = async (target, self, args) => {
    const response = apply(target, self, args)
    console.debug(await response)
    return response
  }
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
    // const octokit = new Proxy(new Octokit({ auth }), traps)
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
