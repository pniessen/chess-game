// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { NON_PRODUCTION_REFUSAL, PUBLIC_BUILD_REFUSAL, publicBuildRefusal } from './publicBuildGuard'

/** A production build as `vite build` makes it with nothing set. */
const prod = { mode: 'production', nodeEnvs: ['production'] }

describe('publicBuildRefusal: VITE_CLAUDE_GAMES=on never reaches a public build', () => {
  test('a plain local build with the flag is allowed (npm run start:claude)', () => {
    expect(publicBuildRefusal({ ...prod, claudeGamesFlag: 'on' }, {})).toBeNull()
  })

  test('a deploy build without the flag is allowed', () => {
    expect(publicBuildRefusal({ ...prod, claudeGamesFlag: undefined }, { NETLIFY: 'true', CONTEXT: 'production' })).toBeNull()
    expect(publicBuildRefusal({ ...prod, claudeGamesFlag: undefined }, { GITHUB_ACTIONS: 'true' })).toBeNull()
    // Only the exact value the app honours turns the UI on.
    expect(publicBuildRefusal({ ...prod, claudeGamesFlag: 'off' }, { NETLIFY: 'true' })).toBeNull()
    // NODE_ENV unset anywhere (Vite then defaults it) is fine too.
    expect(publicBuildRefusal({ mode: 'production', nodeEnvs: [undefined, ''] }, { NETLIFY: 'true' })).toBeNull()
  })

  // Red if any deploy build that would ship the Claude UI is let through.
  test.each([
    ['Netlify CI (NETLIFY=true)', { NETLIFY: 'true' }],
    // netlify-cli `deploy --build` sets NETLIFY_LOCAL, CONTEXT, DEPLOY_URL, not NETLIFY.
    ['netlify-cli build (NETLIFY_LOCAL=true)', { NETLIFY_LOCAL: 'true' }],
    ['Netlify CONTEXT', { CONTEXT: 'production' }],
    ['Netlify DEPLOY_URL', { DEPLOY_URL: 'https://abc--site.netlify.app' }],
    ['GitHub Actions (Pages)', { GITHUB_ACTIONS: 'true' }],
  ])('%s with the flag on is refused', (_name, env) => {
    expect(publicBuildRefusal({ ...prod, claudeGamesFlag: 'on' }, env)).toBe(PUBLIC_BUILD_REFUSAL)
  })

  test('the message says what to do', () => {
    expect(PUBLIC_BUILD_REFUSAL).toMatch(/VITE_CLAUDE_GAMES=on must never reach a public build; remove it from \.env/)
  })
})

// NODE_ENV=development (shell, .env, Netlify UI) makes Vite's DEV true in
// `vite build`; a non-production mode changes MODE. Either could put dev-only
// UI in a public bundle, so a deploy build must be a plain production build.
describe('publicBuildRefusal: a deploy build must be a production build', () => {
  test.each([
    ['NODE_ENV=development (shell or Netlify UI)', { mode: 'production', nodeEnvs: ['development'] }],
    ['NODE_ENV=development from .env', { mode: 'production', nodeEnvs: ['production', 'development'] }],
    ['NODE_ENV=test', { mode: 'production', nodeEnvs: ['test'] }],
    ['--mode development', { mode: 'development', nodeEnvs: ['production'] }],
    ['--mode staging', { mode: 'staging', nodeEnvs: [] }],
  ])('%s in a deploy build is refused', (_name, build) => {
    for (const env of [{ NETLIFY: 'true' }, { NETLIFY_LOCAL: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
      expect(publicBuildRefusal(build, env)).toBe(NON_PRODUCTION_REFUSAL)
    }
  })

  test('outside a deploy build it is allowed (local experiments stay possible)', () => {
    expect(publicBuildRefusal({ mode: 'development', nodeEnvs: ['development'] }, {})).toBeNull()
  })

  test('the message says what to do', () => {
    expect(NON_PRODUCTION_REFUSAL).toMatch(/production/)
    expect(NON_PRODUCTION_REFUSAL).toMatch(/NODE_ENV/)
  })
})
