import { useSyncExternalStore } from 'react'
import type { CoachClient, CoachSnapshot } from '../coach/client'

export function useCoach(client: CoachClient): CoachSnapshot {
  return useSyncExternalStore(client.subscribe, client.getSnapshot)
}
