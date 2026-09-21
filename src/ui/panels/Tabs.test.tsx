import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Tabs } from './Tabs'

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
