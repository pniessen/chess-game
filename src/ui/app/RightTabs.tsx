import type { ComponentProps } from 'react'
import { Tabs } from '../panels/Tabs'
import { MoveList } from '../panels/MoveList'
import { Explorer } from '../panels/Explorer'
import { ReviewPanel } from '../review/ReviewPanel'
import { HistoryPanel } from '../history/HistoryPanel'

/** Task 13 adds the 'history' tab. */
export type RightTab = 'moves' | 'explorer' | 'review' | 'history'

/** The right-hand tab group: Moves, Explorer, Review, History — each panel's props passed straight through. */
export function RightTabs({
  active,
  onChange,
  moves,
  explorer,
  review,
  history,
}: {
  active: RightTab
  onChange: (tab: RightTab) => void
  moves: ComponentProps<typeof MoveList>
  explorer: ComponentProps<typeof Explorer>
  review: ComponentProps<typeof ReviewPanel>
  history: ComponentProps<typeof HistoryPanel>
}) {
  return (
    <Tabs
      active={active}
      onChange={(id) => onChange(id as RightTab)}
      tabs={[
        {
          id: 'moves',
          label: 'Moves',
          content: <MoveList {...moves} />,
        },
        {
          id: 'explorer',
          label: 'Explorer',
          content: <Explorer {...explorer} />,
        },
        {
          id: 'review',
          label: 'Review',
          content: <ReviewPanel {...review} />,
        },
        {
          id: 'history',
          label: 'History',
          content: <HistoryPanel {...history} />,
        },
      ]}
    />
  )
}
