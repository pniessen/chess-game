import { useSyncExternalStore } from 'react'
import type { MatchController } from '../match/controller'
import type { MatchSnapshot } from '../match/types'

export function useMatch(controller: MatchController): MatchSnapshot {
  return useSyncExternalStore(
    (onChange) => controller.subscribe(() => onChange()),
    () => controller.snapshot(),
  )
}
