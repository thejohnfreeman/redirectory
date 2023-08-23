import { Octokit } from 'octokit'

const verbosity = parseInt(process.env.VERBOSITY) || 0

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

export function newOctokit(options): Octokit {
  return new Proxy(new Octokit(options), traps)
}
