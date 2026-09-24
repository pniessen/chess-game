import { assetUrl } from '../assetUrl'
import { parseOpeningsData, type OpeningsData } from './data'

export interface OpeningEntry {
  id: number
  eco: string
  name: string
  moves: readonly string[]
}

/** Read-only queries over the pre-built index. React-free and chess.js-free. */
export class OpeningBook {
  readonly maxPly: number
  readonly all: readonly OpeningEntry[]
  private readonly positions: OpeningsData['positions']

  constructor(data: OpeningsData) {
    this.maxPly = data.maxPly
    this.positions = data.positions
    this.all = data.openings.map(([eco, name, san], id) => ({
      id,
      eco,
      name,
      moves: san.length > 0 ? san.split(' ') : [],
    }))
  }

  private at(epd: string): [number, string[]] | undefined {
    return Object.hasOwn(this.positions, epd) ? this.positions[epd] : undefined
  }

  named(epd: string): OpeningEntry | null {
    const id = this.at(epd)?.[0] ?? -1
    return id >= 0 ? (this.all[id] ?? null) : null
  }

  /** Distinct UCI moves the dataset plays from this position (the engine's book). */
  continuations(epd: string): readonly string[] {
    return this.at(epd)?.[1] ?? []
  }

  /** The latest named position in `epdsByPly` (index = ply), walking back from the end. */
  identify(epdsByPly: readonly string[]): OpeningEntry | null {
    for (let i = epdsByPly.length - 1; i >= 0; i--) {
      const epd = epdsByPly[i]
      const hit = epd === undefined ? null : this.named(epd)
      if (hit) return hit
    }
    return null
  }

  search(query: string, limit = 100): OpeningEntry[] {
    const q = query.trim().toLowerCase()
    const hits =
      q.length === 0
        ? this.all
        : this.all.filter((e) => e.name.toLowerCase().includes(q) || e.eco.toLowerCase() === q)
    return hits.slice(0, limit)
  }
}

let cached: Promise<OpeningBook | null> | null = null

/** Fetch the index once per page. A failed load is not cached, so a later call retries. */
export function loadOpeningBook(
  fetchImpl: (url: string) => Promise<Response> = (url) => fetch(url),
  url = assetUrl('openings/openings.json'),
): Promise<OpeningBook | null> {
  cached ??= fetchImpl(url)
    .then((res) => (res.ok ? res.json() : null))
    .then((raw: unknown) => {
      const data = parseOpeningsData(raw)
      return data ? new OpeningBook(data) : null
    })
    .catch(() => null)
    .then((book) => {
      if (!book) cached = null
      return book
    })
  return cached
}

export function resetOpeningBookCache(): void {
  cached = null
}
