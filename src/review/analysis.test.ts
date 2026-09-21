import { describe, expect, test } from 'vitest'
import { classifyLoss, classifyMove, gameAccuracy, moveAccuracy, moverWinPercent, THRESHOLDS } from './analysis'

describe('classification (Lichess win% thresholds)', () => {
  test('thresholds are inclusive at 10 / 20 / 30', () => {
    expect(classifyLoss(9.99)).toBe('ok')
    expect(classifyLoss(10)).toBe('inaccuracy')
    expect(classifyLoss(19.99)).toBe('inaccuracy')
    expect(classifyLoss(20)).toBe('mistake')
    expect(classifyLoss(30)).toBe('blunder')
  })

  test('win% is taken from the mover\'s side', () => {
    expect(moverWinPercent({ kind: 'cp', cp: 0 }, 'b')).toBe(50)
    expect(moverWinPercent({ kind: 'mate', mate: 2 }, 'b')).toBe(0)
    expect(moverWinPercent({ kind: 'result', winner: 'b' }, 'b')).toBe(100)
  })

  test('allowing mate is a blunder; the engine\'s own move is best', () => {
    const blunder = classifyMove({
      before: { kind: 'cp', cp: 50 }, // White +0.5, Black to move
      after: { kind: 'mate', mate: 1 }, // now White mates
      mover: 'b',
      playedUci: 'g8f6',
      bestUci: 'g7g6',
    })
    expect(blunder.classification).toBe('blunder')
    expect(blunder.loss).toBeCloseTo(45.4104, 3)

    expect(
      classifyMove({
        before: { kind: 'mate', mate: 1 },
        after: { kind: 'result', winner: 'w' },
        mover: 'w',
        playedUci: 'h5f7',
        bestUci: 'h5f7',
      }),
    ).toEqual({ classification: 'best', loss: 0 })
  })

  test('an improvement is never a loss', () => {
    expect(
      classifyMove({ before: { kind: 'cp', cp: 0 }, after: { kind: 'cp', cp: 300 }, mover: 'w', playedUci: 'a', bestUci: 'b' }),
    ).toEqual({ classification: 'ok', loss: 0 })
  })

  test('a mover already lost (win% near 0) drifting further does not become a false blunder', () => {
    // White is already almost certainly lost (cp clamps near -1000 either side); staying
    // lost must not register as a ~50-point (mate-vs-cp) or rounding-driven blunder.
    const stillLosing = classifyMove({
      before: { kind: 'cp', cp: -950 },
      after: { kind: 'cp', cp: -1200 }, // clamps to -1000, same as -950's clamp region
      mover: 'w',
      playedUci: 'a1a2',
      bestUci: 'b2b3',
    })
    expect(stillLosing.classification).toBe('ok')
    expect(stillLosing.loss).toBeLessThan(THRESHOLDS.inaccuracy)

    // Already-mated-in-N to already-mated-in-fewer-N: mover's win% is 0 both sides, loss must be exactly 0.
    const alreadyLost = classifyMove({
      before: { kind: 'mate', mate: -3 },
      after: { kind: 'mate', mate: -1 },
      mover: 'w',
      playedUci: 'a1a2',
      bestUci: 'b2b3',
    })
    expect(alreadyLost).toEqual({ classification: 'ok', loss: 0 })
  })
})

describe('accuracy (Lichess)', () => {
  test('per-move accuracy', () => {
    expect(moveAccuracy(50, 50)).toBe(100)
    expect(moveAccuracy(40, 60)).toBe(100)
    expect(moveAccuracy(60, 50)).toBeCloseTo(64.5798, 3)
    expect(moveAccuracy(50, 10)).toBeCloseTo(15.909, 3)
    expect(moveAccuracy(90, 0)).toBe(0) // clamped
  })

  test('game accuracy: a known sequence', () => {
    // Moves: W 50->40 (loss 10), B 60->55 (loss 5), W 45->30 (loss 15), B 70->30 (loss 40).
    const acc = gameAccuracy([50, 40, 45, 30, 70], 'w')
    expect(acc.w).toBeCloseTo(57.0302, 3)
    expect(acc.b).toBeCloseTo(26.8422, 3)
  })

  test('game accuracy: perfect play by one side, one blunder by the other', () => {
    const acc = gameAccuracy([50, 50, 90], 'w')
    expect(acc.w).toBe(100)
    expect(acc.b).toBeCloseTo(15.909, 3)
  })

  test('sides with no moves get null', () => {
    expect(gameAccuracy([50], 'w')).toEqual({ w: null, b: null })
    const one = gameAccuracy([50, 40], 'w')
    expect(one.w).toBeCloseTo(64.5798, 3)
    expect(one.b).toBeNull()
  })

  test('a Black-first game assigns the first move to Black', () => {
    const acc = gameAccuracy([50, 60, 60], 'b') // Black's move: White 50->60 = Black 50->40
    expect(acc.b).toBeCloseTo(64.5798, 3)
    expect(acc.w).toBe(100)
  })
})
