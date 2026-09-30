import type { GameStore } from './store'

/**
 * A Map-backed `GameStore` for the local relay, where nothing needs to
 * outlive the process. Values round-trip through JSON, as a real blob store's do.
 */
export function memoryStore(): GameStore {
  const data = new Map<string, string>()
  return {
    get: async (key) => {
      const v = data.get(key)
      return v === undefined ? null : JSON.parse(v)
    },
    setJSON: async (key, value) => {
      data.set(key, JSON.stringify(value))
    },
    keys: async (prefix) => {
      const base = prefix.endsWith('/') ? prefix : `${prefix}/`
      return [...data.keys()].filter((k) => k.startsWith(base) && !k.slice(base.length).includes('/')).sort()
    },
  }
}
