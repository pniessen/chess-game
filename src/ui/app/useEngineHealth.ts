import { useEffect, useState } from 'react'
import type { EngineHealth } from '../../engine/supervisor'

/** The part of EngineSupervisor this hook reads. */
export interface HealthSource {
  health(): EngineHealth
  onHealth(cb: (h: EngineHealth) => void): () => void
}

/**
 * The engine can also fail *after* construction: a 404 on the asset, a
 * network failure, a hung handshake, or a lost bestmove all arrive
 * asynchronously and can't be caught by buildController()'s try/catch.
 * The supervisor restarts the worker (status "Engine restarting…", the
 * game carries on); only once its restart budget is spent does it report
 * 'dead', which we fold into the same "engine unavailable" degradation a
 * synchronous failure produces (warning banner, engine modes disabled).
 *
 * `engineConstructed`: whether the engine was built successfully at
 * construction time (a *synchronous* outcome).
 */
export function useEngineHealth(
  engine: HealthSource | null,
  engineConstructed: boolean,
): { engineHealth: EngineHealth; engineAvailable: boolean } {
  const [engineHealth, setEngineHealth] = useState<EngineHealth>(() => engine?.health() ?? { kind: 'ok' })
  useEffect(() => {
    if (!engine) return
    setEngineHealth(engine.health())
    return engine.onHealth(setEngineHealth)
  }, [engine])
  const engineAvailable = engineConstructed && engineHealth.kind !== 'dead'
  return { engineHealth, engineAvailable }
}
