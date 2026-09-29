import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../storage/storage'
import { SettingsPopover } from './SettingsPopover'

const FAKE = 'fake-owner-token-for-tests'

function open(ownerToken?: { isSet: boolean; onSave: (v: string) => void; onClear: () => void }) {
  const r = render(<SettingsPopover settings={DEFAULT_SETTINGS} onChange={() => {}} ownerToken={ownerToken} />)
  fireEvent.click(screen.getByTestId('settings-toggle'))
  return r
}

describe('SettingsPopover owner token', () => {
  // Red if the field shows on a build without coaching (no ownerToken prop).
  test('absent when the app passes no ownerToken (coaching off for the build)', () => {
    open()
    expect(screen.queryByTestId('owner-token')).toBeNull()
  })

  test('a password input that saves what was typed and then empties itself', () => {
    const onSave = vi.fn()
    open({ isSet: false, onSave, onClear: vi.fn() })
    const input = screen.getByTestId('owner-token') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(screen.getByTestId('owner-token-status')).toHaveTextContent('not set')
    fireEvent.change(input, { target: { value: FAKE } })
    fireEvent.click(screen.getByTestId('owner-token-save'))
    expect(onSave).toHaveBeenCalledWith(FAKE)
    expect(input.value).toBe('')
  })

  test('Enter in the field saves too', () => {
    const onSave = vi.fn()
    open({ isSet: false, onSave, onClear: vi.fn() })
    const input = screen.getByTestId('owner-token')
    fireEvent.change(input, { target: { value: FAKE } })
    fireEvent.submit(input.closest('form')!)
    expect(onSave).toHaveBeenCalledWith(FAKE)
  })

  test('Save is disabled while the field is empty', () => {
    open({ isSet: false, onSave: vi.fn(), onClear: vi.fn() })
    expect(screen.getByTestId('owner-token-save')).toBeDisabled()
  })

  // Red if the stored value is ever rendered back into the DOM.
  test('once set it says "set", offers Clear, and the token text is nowhere in the DOM', () => {
    localStorage.setItem('chess.ownerToken', FAKE)
    const onClear = vi.fn()
    const { container } = open({ isSet: true, onSave: vi.fn(), onClear })
    expect(screen.getByTestId('owner-token-status')).toHaveTextContent(/^set$/)
    expect((screen.getByTestId('owner-token') as HTMLInputElement).value).toBe('')
    expect(container.innerHTML).not.toContain(FAKE)
    fireEvent.click(screen.getByTestId('owner-token-clear'))
    expect(onClear).toHaveBeenCalled()
    localStorage.clear()
  })

  test('no Clear while nothing is set', () => {
    open({ isSet: false, onSave: vi.fn(), onClear: vi.fn() })
    expect(screen.queryByTestId('owner-token-clear')).toBeNull()
  })
})
