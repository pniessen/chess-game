export const BOARD_THEMES = [
  { id: 'classic', label: 'Classic', light: '#f0d9b5', dark: '#b58863' },
  { id: 'green', label: 'Green', light: '#eeeed2', dark: '#769656' },
  { id: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'slate', label: 'Slate', light: '#d9dce1', dark: '#7d8594' },
] as const

export type BoardTheme = (typeof BOARD_THEMES)[number]

export function boardTheme(id: string): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0]
}
