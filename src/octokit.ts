import { Octokit } from 'octokit'

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

export function newOctokit(options): Octokit {
  return new Proxy(new Octokit(options), traps)
}
