// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { ADJUDICATION_CP, adjudicate } from './adjudicate'

describe('adjudicate: the final position at the ply cap', () => {
  test('|eval| >= 300 cp wins for the side ahead; scores are from the side to move', () => {
    expect(ADJUDICATION_CP).toBe(300)
    expect(adjudicate({ cp: 300 }, 'w')).toMatchObject({ result: '1-0', winner: 'w', evalCp: 300, mate: null })
    expect(adjudicate({ cp: 300 }, 'b')).toMatchObject({ result: '0-1', winner: 'b', evalCp: -300 })
    expect(adjudicate({ cp: -450 }, 'w')).toMatchObject({ result: '0-1', winner: 'b', evalCp: -450 })
    expect(adjudicate({ cp: -450 }, 'b')).toMatchObject({ result: '1-0', winner: 'w', evalCp: 450 })
  })

  test('under 300 cp either way is a draw', () => {
    expect(adjudicate({ cp: 299 }, 'w')).toMatchObject({ result: '1/2-1/2', winner: null, evalCp: 299 })
    expect(adjudicate({ cp: -299 }, 'b')).toMatchObject({ result: '1/2-1/2', winner: null, evalCp: 299 })
    expect(adjudicate({ cp: 0 }, 'w')).toMatchObject({ result: '1/2-1/2', winner: null })
  })

  test('a forced mate wins for the side that mates, however far off', () => {
    expect(adjudicate({ mate: 12 }, 'w')).toMatchObject({ result: '1-0', winner: 'w', mate: 12, evalCp: null })
    expect(adjudicate({ mate: 3 }, 'b')).toMatchObject({ result: '0-1', winner: 'b', mate: -3 })
    expect(adjudicate({ mate: -2 }, 'w')).toMatchObject({ result: '0-1', winner: 'b', mate: -2 })
    expect(adjudicate({ mate: -2 }, 'b')).toMatchObject({ result: '1-0', winner: 'w', mate: 2 })
  })
})
