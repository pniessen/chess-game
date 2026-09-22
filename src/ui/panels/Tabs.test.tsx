import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Tabs, type TabSpec } from './Tabs'

test('shows the active panel, hides (but keeps) the others, and reports clicks', () => {
  const onChange = vi.fn()
  render(
    <Tabs
      active="a"
      onChange={onChange}
      tabs={[
        { id: 'a', label: 'Alpha', content: <p>first</p> },
        { id: 'b', label: 'Beta', content: <p>second</p> },
      ]}
    />,
  )
  expect(screen.getByTestId('tab-a')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('first')).toBeVisible()
  expect(screen.getByText('second')).not.toBeVisible()
  fireEvent.click(screen.getByTestId('tab-b'))
  expect(onChange).toHaveBeenCalledWith('b')
})

test('the active tab has tabIndex 0 and the others -1 (roving tabindex)', () => {
  render(
    <Tabs
      active="b"
      onChange={vi.fn()}
      tabs={[
        { id: 'a', label: 'Alpha', content: <p>first</p> },
        { id: 'b', label: 'Beta', content: <p>second</p> },
        { id: 'c', label: 'Gamma', content: <p>third</p> },
      ]}
    />,
  )
  expect(screen.getByTestId('tab-a')).toHaveAttribute('tabindex', '-1')
  expect(screen.getByTestId('tab-b')).toHaveAttribute('tabindex', '0')
  expect(screen.getByTestId('tab-c')).toHaveAttribute('tabindex', '-1')
})

/** A controlled wrapper, since Tabs is a controlled component and real
 *  keyboard navigation must both move focus AND change the active tab. */
function ControlledTabs({ initial, tabs }: { initial: string; tabs: readonly TabSpec[] }) {
  const [active, setActive] = useState(initial)
  return <Tabs active={active} onChange={setActive} tabs={tabs} />
}

const THREE_TABS: TabSpec[] = [
  { id: 'a', label: 'Alpha', content: <p>first</p> },
  { id: 'b', label: 'Beta', content: <p>second</p> },
  { id: 'c', label: 'Gamma', content: <p>third</p> },
]

test('ArrowRight moves focus and selection to the next tab', () => {
  render(<ControlledTabs initial="a" tabs={THREE_TABS} />)
  const tabA = screen.getByTestId('tab-a')
  tabA.focus()
  fireEvent.keyDown(tabA, { key: 'ArrowRight' })
  const tabB = screen.getByTestId('tab-b')
  expect(tabB).toHaveAttribute('aria-selected', 'true')
  expect(tabB).toHaveAttribute('tabindex', '0')
  expect(tabA).toHaveAttribute('aria-selected', 'false')
  expect(tabA).toHaveAttribute('tabindex', '-1')
  expect(document.activeElement).toBe(tabB)
})

test('ArrowRight wraps from the last tab to the first', () => {
  render(<ControlledTabs initial="c" tabs={THREE_TABS} />)
  const tabC = screen.getByTestId('tab-c')
  tabC.focus()
  fireEvent.keyDown(tabC, { key: 'ArrowRight' })
  const tabA = screen.getByTestId('tab-a')
  expect(tabA).toHaveAttribute('aria-selected', 'true')
  expect(document.activeElement).toBe(tabA)
})

test('ArrowLeft moves focus and selection to the previous tab', () => {
  render(<ControlledTabs initial="b" tabs={THREE_TABS} />)
  const tabB = screen.getByTestId('tab-b')
  tabB.focus()
  fireEvent.keyDown(tabB, { key: 'ArrowLeft' })
  const tabA = screen.getByTestId('tab-a')
  expect(tabA).toHaveAttribute('aria-selected', 'true')
  expect(document.activeElement).toBe(tabA)
})

test('ArrowLeft wraps from the first tab to the last', () => {
  render(<ControlledTabs initial="a" tabs={THREE_TABS} />)
  const tabA = screen.getByTestId('tab-a')
  tabA.focus()
  fireEvent.keyDown(tabA, { key: 'ArrowLeft' })
  const tabC = screen.getByTestId('tab-c')
  expect(tabC).toHaveAttribute('aria-selected', 'true')
  expect(document.activeElement).toBe(tabC)
})

test('Home moves focus and selection to the first tab', () => {
  render(<ControlledTabs initial="c" tabs={THREE_TABS} />)
  const tabC = screen.getByTestId('tab-c')
  tabC.focus()
  fireEvent.keyDown(tabC, { key: 'Home' })
  const tabA = screen.getByTestId('tab-a')
  expect(tabA).toHaveAttribute('aria-selected', 'true')
  expect(document.activeElement).toBe(tabA)
})

test('End moves focus and selection to the last tab', () => {
  render(<ControlledTabs initial="a" tabs={THREE_TABS} />)
  const tabA = screen.getByTestId('tab-a')
  tabA.focus()
  fireEvent.keyDown(tabA, { key: 'End' })
  const tabC = screen.getByTestId('tab-c')
  expect(tabC).toHaveAttribute('aria-selected', 'true')
  expect(document.activeElement).toBe(tabC)
})

test('ArrowUp and ArrowDown do nothing (horizontal orientation)', () => {
  const onChange = vi.fn()
  render(<Tabs active="b" onChange={onChange} tabs={THREE_TABS} />)
  const tabB = screen.getByTestId('tab-b')
  tabB.focus()
  fireEvent.keyDown(tabB, { key: 'ArrowUp' })
  fireEvent.keyDown(tabB, { key: 'ArrowDown' })
  expect(onChange).not.toHaveBeenCalled()
  expect(tabB).toHaveAttribute('aria-selected', 'true')
})

test('disabled tabs are skipped when navigating with arrow keys', () => {
  const tabsWithDisabled: TabSpec[] = [
    { id: 'a', label: 'Alpha', content: <p>first</p> },
    { id: 'b', label: 'Beta', content: <p>second</p>, disabled: true },
    { id: 'c', label: 'Gamma', content: <p>third</p> },
  ]
  render(<ControlledTabs initial="a" tabs={tabsWithDisabled} />)
  const tabA = screen.getByTestId('tab-a')
  tabA.focus()
  fireEvent.keyDown(tabA, { key: 'ArrowRight' })
  const tabC = screen.getByTestId('tab-c')
  expect(tabC).toHaveAttribute('aria-selected', 'true')
  expect(document.activeElement).toBe(tabC)
})
