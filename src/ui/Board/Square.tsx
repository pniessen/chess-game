import type { ReactNode } from 'react'
import type { Square as SquareName } from '../../game-core/types'
import { isLightSquare } from './squares'

export function Square({
  name,
  classes,
  onClick,
  children,
}: {
  name: SquareName
  classes: string[]
  onClick: (square: SquareName) => void
  children?: ReactNode
}) {
  const className = ['square', isLightSquare(name) ? 'light' : 'dark', ...classes].join(' ')
  return (
    <div
      className={className}
      data-square={name}
      role="gridcell"
      aria-label={name}
      onClick={() => onClick(name)}
    >
      {children}
    </div>
  )
}
