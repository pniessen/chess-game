import { useEffect, useState } from 'react'
import { MatchController, type EngineLike } from '../../match/controller'
import { EngineClient, createWorkerTransport } from '../../engine/client'
import { EngineSupervisor } from '../../engine/supervisor'
import { loadSettings } from '../../storage/storage'
import { timeControlFor } from './matchConfig'

/**
 * Build the real MatchController, wired to a real Stockfish worker — but
 * never let a missing/broken worker (no `Worker` in this environment, the
 * asset failing to load, etc.) take the whole game down. On failure we fall
 * back to a controller backed by a stub engine that always rejects, and the
 * caller disables every engine-dependent control.
 *
 * This only catches SYNCHRONOUS construction failures (e.g. no `Worker`
 * global at all, as in Vitest/jsdom). A worker that loads but then fails
 * asynchronously (a 404 on the engine asset, a bad deploy base path, a
 * network failure, or a hung handshake) is a separate case: the
 * `EngineSupervisor` replaces a dead worker (within its restart cap) and
 * reports its health — see `useEngineHealth`.
 */
function buildController(): {
  controller: MatchController
  engine: EngineSupervisor | null
  engineAvailable: boolean
} {
  try {
    const engine = new EngineSupervisor({ createClient: () => new EngineClient(createWorkerTransport()) })
    return { controller: new MatchController({ engine }), engine, engineAvailable: true }
  } catch {
    const stub: EngineLike = {
      waitReady: () => Promise.reject(new Error('engine unavailable')),
      configure: () => {},
      newGame: () => {},
      setPosition: () => {},
      search: () => Promise.reject(new Error('engine unavailable')),
      stop: () => {},
      dispose: () => {},
    }
    return { controller: new MatchController({ engine: stub }), engine: null, engineAvailable: false }
  }
}

export type ControllerBundle = ReturnType<typeof buildController>

function createControllerBundle(): ControllerBundle {
  const bundle = buildController()
  bundle.controller.start({
    white: { kind: 'human' },
    black: { kind: 'human' },
    timeControl: timeControlFor(loadSettings().timeControlId),
  })
  return bundle
}

/**
 * Owns the lifecycle of the one `MatchController` (and the real Stockfish
 * `Worker` its `EngineSupervisor` keeps alive — replacing it after a crash,
 * never running two at once) for the whole app.
 *
 * This can't be `useState(() => createControllerBundle())`: React Strict
 * Mode's development-only double-render calls a `useState` lazy initializer
 * TWICE, and — unlike the state value itself, of which only one of the two
 * results is kept — the *side effects* of both calls still happen. That was
 * the original bug: two Stockfish workers spawned on every mount, and one
 * was permanently orphaned (never terminated).
 *
 * Building the bundle inside a `useEffect` instead avoids that: an effect
 * body runs once per real mount. Strict Mode still double-invokes *effects*
 * on the initial mount (mount -> cleanup -> mount, synchronously, before
 * the user can interact), but that's a paired create/dispose cycle here —
 * each invocation of this effect owns exactly the bundle it created,
 * closed over by its own cleanup — so the dance nets out to: a first
 * bundle is created and immediately disposed, a second one is created and
 * stays live until the component actually unmounts. At every point in that
 * sequence at most one worker is alive, and every worker that was ever
 * created eventually gets `dispose()`d. In production (no Strict Mode
 * replay) the effect simply runs once.
 *
 * The trade-off is that `controller` isn't available for the very first
 * render (effects run after the initial commit), so this returns null (and
 * `App` renders nothing) until the effect has fired — in practice a single,
 * imperceptible tick.
 */
export function useControllerBundle(): ControllerBundle | null {
  const [bundle, setBundle] = useState<ControllerBundle | null>(null)

  useEffect(() => {
    const b = createControllerBundle()
    setBundle(b)
    return () => {
      b.controller.dispose()
    }
  }, [])

  return bundle
}
