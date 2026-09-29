/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "on" only in the local production build `npm run start:claude` makes; unset in npm start and the public builds. */
  readonly VITE_CLAUDE_GAMES?: string
}
