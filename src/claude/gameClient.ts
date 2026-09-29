import { CLAUDE_SESSION_IDLE_MS, type ClaudeModelKey } from './models'

export type BeginResult =
  | { ok: true; budgetLeftUsd: number }
  | { ok: false; kind: 'busy' | 'budget' | 'forbidden' | 'unavailable' }

export type ClaudeMoveResult =
  | { ok: true; san: string; why: string; costUsd: number; gameSpentUsd: number }
  /**
   * 'lost': the server no longer knows this game — its per-process secret
   * changed, i.e. the local server restarted — so the game cannot go on.
   */
  | { ok: false; kind: 'retry' | 'budget' | 'fatal' | 'lost' }

export interface GameRecord {
  pgn: string
  fallbacks: { w: number; b: number }
}

/** What the match controller needs from a Claude opponent. */
export interface ClaudeMover {
  begin(white: ClaudeModelKey, black: ClaudeModelKey): Promise<BeginResult>
  move(req: { startFen?: string; history: string[] }, signal?: AbortSignal): Promise<ClaudeMoveResult>
  end(record: GameRecord): Promise<void>
  /**
   * Whether the begun session can still be trusted to hold the server lock:
   * false before begin, after end, and once CLAUDE_SESSION_IDLE_MS have
   * passed without server contact. Optional: a mover without it is always fresh.
   */
  sessionFresh?(): boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function errorKindOf(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload['error'])) return null
  const kind = payload['error']['kind']
  return typeof kind === 'string' ? kind : null
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null // Not our JSON, e.g. a proxy's error page.
  }
}

/**
 * The browser's door to the local server's `/api/game/*` endpoints. Like the coach
 * client it never throws: every failure is a result the controller can act on.
 * The gameId and per-game token from `begin` are held here, never exposed.
 */
export class GameClient implements ClaudeMover {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private game: { gameId: string; token: string } | null = null
  /** When the server last heard from this session: the send time of the last request it answered. */
  private lastContactAt: number | null = null

  constructor(opts: { fetch?: typeof fetch; now?: () => number } = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
    this.now = opts.now ?? Date.now
  }

  sessionFresh(): boolean {
    return this.game !== null && this.lastContactAt !== null && this.now() - this.lastContactAt <= CLAUDE_SESSION_IDLE_MS
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json' }
  }

  async begin(white: ClaudeModelKey, black: ClaudeModelKey): Promise<BeginResult> {
    const sentAt = this.now()
    let res: Response
    try {
      res = await this.fetchImpl('/api/game/start', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ white, black }),
      })
    } catch {
      return { ok: false, kind: 'unavailable' }
    }
    const payload = await readJson(res)
    if (res.ok && isRecord(payload) && typeof payload['gameId'] === 'string' && typeof payload['token'] === 'string') {
      this.game = { gameId: payload['gameId'], token: payload['token'] }
      this.lastContactAt = sentAt
      const left = payload['budgetLeftUsd']
      return { ok: true, budgetLeftUsd: typeof left === 'number' ? left : 0 }
    }
    const kind = errorKindOf(payload)
    if (kind === 'busy' || kind === 'budget' || kind === 'forbidden') return { ok: false, kind }
    return { ok: false, kind: 'unavailable' }
  }

  async move(req: { startFen?: string; history: string[] }, signal?: AbortSignal): Promise<ClaudeMoveResult> {
    if (!this.game) return { ok: false, kind: 'fatal' }
    if (signal?.aborted) return { ok: false, kind: 'retry' }
    // The server extends its lock when it authorises a move, i.e. after this
    // send: dating the contact from the send errs on the early (safe) side.
    const sentAt = this.now()
    let res: Response
    try {
      res = await this.fetchImpl('/api/game/move', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          gameId: this.game.gameId,
          token: this.game.token,
          ...(req.startFen !== undefined ? { startFen: req.startFen } : {}),
          history: req.history,
        }),
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      // A caller abort says nothing about the server; Task 6 drops the stale reply anyway.
      // fetch rejects with a TypeError on a network failure (a Wi-Fi blip, a
      // dropped connection): worth another try, not the end of a paid game.
      // At worst the server charged a reply that was lost, and the retry pays twice.
      if (signal?.aborted || err instanceof TypeError) return { ok: false, kind: 'retry' }
      return { ok: false, kind: 'fatal' }
    }
    // Any answer is contact, even a refusal. Only the game that sent it counts.
    if (this.game) this.lastContactAt = sentAt
    const payload = await readJson(res)
    if (
      res.ok &&
      isRecord(payload) &&
      typeof payload['san'] === 'string' &&
      typeof payload['why'] === 'string' &&
      typeof payload['costUsd'] === 'number' &&
      typeof payload['gameSpentUsd'] === 'number'
    ) {
      return {
        ok: true,
        san: payload['san'],
        why: payload['why'],
        costUsd: payload['costUsd'],
        gameSpentUsd: payload['gameSpentUsd'],
      }
    }
    // 502 (illegal-reply, timeout, upstream, rate-limited) and 500 are worth another try;
    // 402 ends the Claude game on budget. 403 on a begun game is its token
    // refused: the local server restarted under a new secret and the game is
    // lost (no retry can bring it back). 409 (the ply cap) is only the server's
    // backstop — the controller adjudicates the game before asking at the cap —
    // so reaching it is not a budget matter: fatal, like everything else here.
    if (res.status === 502 || res.status === 500) return { ok: false, kind: 'retry' }
    if (res.status === 402) return { ok: false, kind: 'budget' }
    if (res.status === 403) return { ok: false, kind: 'lost' }
    return { ok: false, kind: 'fatal' }
  }

  /** Best effort and idempotent: never throws, and forgets the game either way. */
  async end(record: GameRecord): Promise<void> {
    const game = this.game
    if (!game) return
    this.game = null
    this.lastContactAt = null
    try {
      await this.fetchImpl('/api/game/end', {
        method: 'POST',
        headers: this.headers(),
        // keepalive lets the request outlive a page unload.
        keepalive: true,
        body: JSON.stringify({ gameId: game.gameId, token: game.token, pgn: record.pgn, fallbacks: record.fallbacks }),
      })
    } catch {
      // The server's lock lapses on its own.
    }
  }
}

export function createGameClient(opts: { fetch?: typeof fetch; now?: () => number } = {}): ClaudeMover {
  return new GameClient(opts)
}

/**
 * This month's remaining Claude games budget in dollars, or null on any
 * failure — the local server not running, or running without a key (503).
 */
export async function fetchBudget(opts: { fetch?: typeof fetch } = {}): Promise<number | null> {
  const f = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  try {
    const res = await f('/api/game/budget')
    if (!res.ok) return null
    const payload = await readJson(res)
    const left = isRecord(payload) ? payload['budgetLeftUsd'] : null
    return typeof left === 'number' ? left : null
  } catch {
    return null
  }
}
