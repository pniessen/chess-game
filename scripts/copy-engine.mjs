import { copyFileSync, mkdirSync } from 'node:fs'

const FILES = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']

mkdirSync('public/engine', { recursive: true })
for (const f of FILES) {
  copyFileSync(`node_modules/stockfish/bin/${f}`, `public/engine/${f}`)
  console.log(`copied ${f}`)
}
