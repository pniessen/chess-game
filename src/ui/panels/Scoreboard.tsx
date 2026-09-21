import type { MatchScore } from '../../storage/storage'

export function Scoreboard({ score }: { score: MatchScore }) {
  return (
    <div className="scoreboard" data-testid="scoreboard">
      <span className="scoreboard-label">Score</span>
      <span className="scoreboard-value">
        {score.wins}–{score.losses}–{score.draws}
      </span>
    </div>
  )
}
