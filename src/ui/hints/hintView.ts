import { nudgeText, type HintStage, type HintSuggestion } from '../../coach/hints'
import type { Annotation } from '../Board/annotations'

export function hintAnnotations(stage: HintStage, s: HintSuggestion | null): Annotation[] {
  if (!s || stage === 0) return []
  const nudge: Annotation = { kind: 'square', square: s.from, tone: 'hint' }
  if (stage === 1) return [nudge]
  return [nudge, { kind: 'arrow', from: s.from, to: s.to, tone: 'hint' }]
}

export function hintText(stage: HintStage, s: HintSuggestion | null, reasoning: string | null): string {
  if (!s || stage === 0) return ''
  if (stage === 1) return nudgeText(s.piece)
  if (stage === 2) return `${nudgeText(s.piece)} Try ${s.san}.`
  return reasoning ?? ''
}

const LABELS = ['Hint', 'Show move', 'Explain', 'Explained'] as const

export function hintButtonLabel(stage: HintStage, pending: boolean): string {
  return pending ? 'Thinking…' : LABELS[stage]
}
