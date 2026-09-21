// @vitest-environment node
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, expect, test } from 'vitest'
import { LISTEN_HOST, startServer } from './index'

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
  server = await startServer({ PORT: '0', HOST: '0.0.0.0' } as NodeJS.ProcessEnv)
  const address = server.address() as AddressInfo
  expect(address.address).toBe('127.0.0.1')
})
