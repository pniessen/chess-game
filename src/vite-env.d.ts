/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "on" in a local production build (npm start) that offers Claude vs Claude; unset in the public builds. */
  readonly VITE_CLAUDE_GAMES?: string
}
