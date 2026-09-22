import { useEffect, useState } from 'react'
import { CoachClient, type CoachSnapshot } from '../../coach/client'
import { useCoach } from '../useCoach'

/** One coach client per app; it owns the offline badge and the one-time notice. */
export function useCoachClient(): { coach: CoachClient; coachState: CoachSnapshot } {
  const [coach] = useState(() => new CoachClient())
  const coachState = useCoach(coach)
  useEffect(() => {
    void coach.checkHealth()
  }, [coach])
  return { coach, coachState }
}
