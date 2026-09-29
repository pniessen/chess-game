// The owner's token for the Claude-vs-Claude endpoints, kept in localStorage.
// Every access is guarded: private mode and blocked site data make it throw.
// The value is a credential, so nothing here ever logs it.

const KEY = 'chess.ownerToken'

export function getOwnerToken(): string | null {
  try {
    const v = localStorage.getItem(KEY)
    return v ? v : null
  } catch {
    return null
  }
}

/** Null or empty removes the key. A storage failure is swallowed: the token just is not remembered. */
export function setOwnerToken(v: string | null): void {
  try {
    if (v) localStorage.setItem(KEY, v)
    else localStorage.removeItem(KEY)
  } catch {
    // Nothing to do; getOwnerToken will read as unset.
  }
}
