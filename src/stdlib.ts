import { strict as assert } from 'node:assert'

export function nowString() {
  return new Date().toISOString()
}

export interface Item<T> {
  value: T,
  index: number,
}

export function maxBy<T, K>(xs: T[], f: (x: T) => K): Item<T> {
  assert(xs.length > 0)
  let index = 0;
  let value = xs[index]
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

/**
 * Parse JSON at the start of a string, after any whitespace.
 */
export function parseJsonPrefix(text: string) {
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
