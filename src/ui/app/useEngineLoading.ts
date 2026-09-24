import { useEffect, useState } from 'react'

/**
 * The one thing this hook needs from the engine: a promise that settles
 * once its current worker's first UCI handshake is done. `waitReady()` is a
 * passive read with no side effect on the worker — it sends nothing, it is
 * already public on `EngineSupervisor`, and every caller (EngineLane, this
 * hook, or none at all) gets the SAME promise back, resolved exactly once
 * by the real `readyok` — so watching it here is the same kind of read as
 * `health()`/`onHealth()`, not a new command competing with EngineLane's
 * queue.
 */
export interface ReadySource {
  waitReady(): Promise<void>
}

/**
 * True from mount until the engine's very first handshake settles — by
 * succeeding, or by that first worker dying before it ever got there (a
 * dead-on-arrival or early-crashing engine is `useEngineHealth`'s job to
 * report; this hook just stops claiming to be "loading" once it knows
 * either way). `engine === null` (construction failed synchronously) means
 * there is nothing to wait for.
 *
 * Deliberately watches only the CURRENT `engine` prop's first settle, not
 * every later restart: `EngineSupervisor` swaps its worker internally
 * without ever handing out a new `EngineSupervisor` instance, so a restart
 * already has its own, separate signal (`engineHealth.kind ===
 * 'restarting'` — see useEngineHealth) and re-arming this on every swap
 * would just duplicate that.
 */
export function useEngineLoading(engine: ReadySource | null): boolean {
  const [loading, setLoading] = useState(() => engine !== null)

  useEffect(() => {
    if (!engine) {
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    engine.waitReady().then(
      () => {
        if (!cancelled) setLoading(false)
      },
      () => {
        if (!cancelled) setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [engine])

  return loading
}
