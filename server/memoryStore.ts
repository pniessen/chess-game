import type { CoachStore } from '../netlify/lib/limits'

/**
 * A Map-backed `CoachStore` for the local relay, where nothing needs to
 * outlive the process. Values round-trip through JSON, as a real blob store's do.
 */
export function memoryStore(): CoachStore {
  const data = new Map<string, string>()
  return {
    get: async (key) => {
      const v = data.get(key)
      return v === undefined ? null : JSON.parse(v)
    },
    setJSON: async (key, value) => {
      data.set(key, JSON.stringify(value))
    },
  }
}
