// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { PUBLIC_BUILD_REFUSAL, publicBuildRefusal } from './publicBuildGuard'

describe('publicBuildRefusal: VITE_CLAUDE_GAMES=on never reaches a public build', () => {
  test('a plain local build with the flag is allowed (npm run start:claude)', () => {
    expect(publicBuildRefusal('on', {})).toBeNull()
  })

  test('a deploy build without the flag is allowed', () => {
    expect(publicBuildRefusal(undefined, { NETLIFY: 'true', CONTEXT: 'production' })).toBeNull()
    expect(publicBuildRefusal(undefined, { GITHUB_ACTIONS: 'true' })).toBeNull()
    // Only the exact value the app honours turns the UI on.
    expect(publicBuildRefusal('off', { NETLIFY: 'true' })).toBeNull()
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
    expect(publicBuildRefusal('on', env)).toBe(PUBLIC_BUILD_REFUSAL)
  })

  test('the message says what to do', () => {
    expect(PUBLIC_BUILD_REFUSAL).toMatch(/VITE_CLAUDE_GAMES=on must never reach a public build; remove it from \.env/)
  })
})
