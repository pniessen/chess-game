// @vitest-environment node
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gamesDirFor, LISTEN_HOST, startServer, typesafeEnvFileFor, typesafeKeyFor } from './index'

let server: Server | null = null

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

test('LISTEN_HOST is always loopback', () => {
  expect(LISTEN_HOST).toBe('127.0.0.1')
})

test('binds to loopback even when a HOST env var asks for every interface', async () => {
  // The relay is unauthenticated and holds the API key: a generic HOST env
  // var (common in shells/containers/CI, or a .env file) must never widen
  // the bind address beyond this machine.
  // No TypeSafe file: a test never reads the owner's real key.
  server = await startServer({ PORT: '0', HOST: '0.0.0.0', TYPESAFE_ENV_FILE: '/nonexistent/typesafe-env' } as NodeJS.ProcessEnv)
  const address = server.address() as AddressInfo
  expect(address.address).toBe('127.0.0.1')
})

// One ledger for every checkout: a per-worktree directory would give each
// worktree its own $20 cap.
test('the games ledger lives under the home directory by default, shared by every worktree', () => {
  expect(gamesDirFor({}, '/Users/someone')).toBe('/Users/someone/.chess-game/claude-games')
})

test('CLAUDE_GAMES_DIR overrides the ledger directory; a blank one is ignored', () => {
  expect(gamesDirFor({ CLAUDE_GAMES_DIR: '/tmp/ledger' }, '/Users/someone')).toBe('/tmp/ledger')
  expect(gamesDirFor({ CLAUDE_GAMES_DIR: '  ' }, '/Users/someone')).toBe('/Users/someone/.chess-game/claude-games')
})

describe('the TypeSafe key for Jev', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'typesafe-env-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const file = (name = 'env') => join(dir, name)

  test('TYPESAFE_API_KEY in the environment wins; the file is not read', async () => {
    await writeFile(file(), 'export TYPESAFE_API_KEY=from-file\n')
    expect(typesafeKeyFor({ TYPESAFE_API_KEY: ' from-env ' }, file())).toBe('from-env')
  })

  test.each([
    ["export TYPESAFE_API_KEY='quoted-single'\n", 'quoted-single'],
    ['export TYPESAFE_API_KEY="quoted-double"\n', 'quoted-double'],
    ['TYPESAFE_API_KEY=bare\n', 'bare'],
    ['# a comment\nOTHER=1\n  export TYPESAFE_API_KEY=later  \n', 'later'],
  ])('unset, it is read from the env file: %j', async (text, key) => {
    await writeFile(file(), text)
    expect(typesafeKeyFor({}, file())).toBe(key)
    expect(typesafeKeyFor({ TYPESAFE_API_KEY: '  ' }, file())).toBe(key)
  })

  test('like a shell: the last assignment wins, and an unquoted value ends at a comment', async () => {
    await writeFile(file(), 'export TYPESAFE_API_KEY=first\nexport TYPESAFE_API_KEY=second\n')
    expect(typesafeKeyFor({}, file())).toBe('second')
    await writeFile(file(), 'export TYPESAFE_API_KEY=abc # rotated in September\n')
    expect(typesafeKeyFor({}, file())).toBe('abc')
    await writeFile(file(), "export TYPESAFE_API_KEY='a#b' # note\n")
    expect(typesafeKeyFor({}, file())).toBe('a#b')
    await writeFile(file(), 'export TYPESAFE_API_KEY=crlf\r\n')
    expect(typesafeKeyFor({}, file())).toBe('crlf')
  })

  test('no file, no such line or an empty value is no key', async () => {
    expect(typesafeKeyFor({}, file('missing'))).toBeNull()
    await writeFile(file(), 'OTHER=1\n# TYPESAFE_API_KEY=commented\n')
    expect(typesafeKeyFor({}, file())).toBeNull()
    await writeFile(file(), "export TYPESAFE_API_KEY=''\n")
    expect(typesafeKeyFor({}, file())).toBeNull()
  })

  test('the file is ~/.config/typesafe/env unless TYPESAFE_ENV_FILE names another', () => {
    expect(typesafeEnvFileFor({}, '/Users/someone')).toBe('/Users/someone/.config/typesafe/env')
    expect(typesafeEnvFileFor({ TYPESAFE_ENV_FILE: '/tmp/x' }, '/Users/someone')).toBe('/tmp/x')
  })
})
