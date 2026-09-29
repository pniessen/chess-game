// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'

const blobs = vi.hoisted(() => ({
  getStore: vi.fn((opts: unknown) => ({ kind: 'global', opts })),
  getDeployStore: vi.fn((opts: unknown) => ({ kind: 'deploy', opts })),
}))
vi.mock('@netlify/blobs', () => blobs)

import { coachStore } from './runtime'

const PROD = 'https://chess.example.netlify.app/api/hint'
const DRAFT = 'https://deploy-preview-12--chess.example.netlify.app/api/hint'
const PERMALINK = 'https://66f0aa11bb22cc33dd44ee55--chess.example.netlify.app/api/hint'

describe('runtime stores', () => {
  beforeEach(() => {
    blobs.getStore.mockClear()
    blobs.getDeployStore.mockClear()
  })

  test('the coach keeps its production/deploy-scoped split', () => {
    expect(coachStore(DRAFT)).toMatchObject({ kind: 'deploy' })
    expect(coachStore(PERMALINK)).toMatchObject({ kind: 'deploy' })
    expect(coachStore(PROD)).toMatchObject({ kind: 'global' })
  })
})
