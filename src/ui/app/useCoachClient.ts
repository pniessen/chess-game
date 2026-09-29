import { useEffect, useState } from 'react'
import { CoachClient, type CoachSnapshot } from '../../coach/client'
import { useCoach } from '../useCoach'

/**
 * VITE_COACH=off (set in .github/workflows/pages.yml) builds with coaching
 * disabled: GitHub Pages has no coach server, so CoachClient must not issue
 * a request that can never succeed. Unset (dev, preview, npm start, e2e)
 * keeps today's behaviour: the client probes the server as usual.
 *
 * Read at call time, never cached, so tests can stub it (mirrors assetUrl.ts).
 */
function coachEnabled(): boolean {
  return import.meta.env.VITE_COACH !== 'off'
}

/** One coach client per app; it owns the offline badge and the one-time notice. */
export function useCoachClient(): { coach: CoachClient; coachState: CoachSnapshot } {
  const [coach] = useState(() => new CoachClient({ enabled: coachEnabled() }))
  const coachState = useCoach(coach)
  useEffect(() => {
    void coach.checkHealth()
  }, [coach])
  return { coach, coachState }
}
