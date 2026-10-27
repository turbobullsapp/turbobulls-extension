// Fails when a source file holds an invisible or text-direction character. Such characters can
// make code read differently from how it runs ("Trojan Source"); write them as escapes instead.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['src']
const EXTENSIONS = /\.(ts|tsx|js|mjs|html|css|json)$/
// Bidirectional controls, zero-width and invisible characters (some are valid in variable names),
// the BOM, tag characters, and the no-break spaces that look like spaces.
const FORBIDDEN = /[\u202a-\u202e\u2066-\u2069\u200b-\u200f\u2028\u2029\ufeff\u00a0\u202f\u2007\u2009\u2060-\u2064\u180e\u3164\u115f\u1160\uffa0\u{e0000}-\u{e007f}]/u

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (EXTENSIONS.test(name)) yield path
  }
}

let problems = 0
for (const root of ROOTS) {
  for (const path of files(root)) {
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const match = FORBIDDEN.exec(line)
        if (match) {
          problems++
          console.error(`${path}:${i + 1}: U+${match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} (write it as an escape)`)
        }
      })
  }
}
if (problems > 0) process.exit(1)
