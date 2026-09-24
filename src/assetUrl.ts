/**
 * URLs for the files we ship in `public/` (engine, pieces, openings,
 * puzzles).
 *
 * They cannot be written as root-absolute strings: on GitHub Pages the app
 * lives under `/chess-game/`, so `/pieces/wK.svg` would point at the domain
 * root and 404. Vite rewrites module imports and CSS `url()`s for us, but a
 * path that only exists as a string in our own code it cannot see — hence
 * this helper, which prefixes the deploy base Vite compiled in
 * (`import.meta.env.BASE_URL`, always slash-terminated, '/' by default).
 *
 * Read at call time, never cached, so tests can stub the base.
 */
export function assetUrl(path: string): string {
  // `?? '/'` is for the build scripts under scripts/, which import these
  // modules under plain Node, where there is no `import.meta.env`.
  const base = import.meta.env?.BASE_URL ?? '/'
  return `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\/+/, '')}`
}
