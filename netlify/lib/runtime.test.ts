// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'

const blobs = vi.hoisted(() => ({
  getStore: vi.fn((opts: unknown) => ({ kind: 'global', opts })),
  getDeployStore: vi.fn((opts: unknown) => ({ kind: 'deploy', opts })),
}))
vi.mock('@netlify/blobs', () => blobs)

import { coachStore, gamesStore } from './runtime'

const PROD = 'https://chess.example.netlify.app/api/game/move'
const DRAFT = 'https://deploy-preview-12--chess.example.netlify.app/api/game/move'
const PERMALINK = 'https://66f0aa11bb22cc33dd44ee55--chess.example.netlify.app/api/game/move'

describe('runtime stores', () => {
  beforeEach(() => {
    blobs.getStore.mockClear()
    blobs.getDeployStore.mockClear()
  })

  test('the games ledger is the one global strong store on every deploy', () => {
    // gamesStore takes no request URL, so no host (production, draft,
    // permalink) can select a deploy-scoped store; the coach's does split.
    expect(gamesStore()).toEqual({ kind: 'global', opts: { name: 'chess-games', consistency: 'strong' } })
    expect(gamesStore.length).toBe(0)
    expect(blobs.getDeployStore).not.toHaveBeenCalled()
  })

  test('the coach keeps its production/deploy-scoped split', () => {
    expect(coachStore(DRAFT)).toMatchObject({ kind: 'deploy' })
    expect(coachStore(PERMALINK)).toMatchObject({ kind: 'deploy' })
    expect(coachStore(PROD)).toMatchObject({ kind: 'global' })
  })
})
