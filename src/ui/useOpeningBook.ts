import { useEffect, useState } from 'react'
import { loadOpeningBook, type OpeningBook } from '../openings/book'

export function useOpeningBook(): { book: OpeningBook | null; failed: boolean } {
  const [state, setState] = useState<{ book: OpeningBook | null; failed: boolean }>({ book: null, failed: false })
  useEffect(() => {
    let live = true
    void loadOpeningBook().then((book) => {
      if (live) setState({ book, failed: book === null })
    })
    return () => {
      live = false
    }
  }, [])
  return state
}
