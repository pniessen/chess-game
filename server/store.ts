/**
 * The two-method key/value store the games rules run on. Structurally the
 * same as the coach's `CoachStore` in netlify/lib/limits.ts (either satisfies
 * the other), but defined here so `server/` does not import from `netlify/`.
 */
export interface GameStore {
  get(key: string, opts: { type: 'json' }): Promise<unknown>
  setJSON(key: string, value: unknown): Promise<void>
}
