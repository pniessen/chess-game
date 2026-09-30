/**
 * The key/value store the games rules run on. `get` and `setJSON` are
 * structurally the coach's `CoachStore` in netlify/lib/limits.ts (defined here
 * so `server/` does not import from `netlify/`); `keys` is the games' own
 * addition, for reading the saved games back (the head-to-head record).
 */
export interface GameStore {
  get(key: string, opts: { type: 'json' }): Promise<unknown>
  setJSON(key: string, value: unknown): Promise<void>
  /**
   * The keys one level under `prefix` (a `/`-separated path; the trailing `/`
   * is optional), sorted: `keys('games/saved/')` lists `games/saved/<id>` but
   * not `games/saved/<id>/more`. An unknown prefix lists nothing.
   */
  keys(prefix: string): Promise<string[]>
}
