// Prints the extension id Chrome derives from the dev public key in src/dev-key.ts.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/dev-key.ts', import.meta.url), 'utf8')
const key = /DEV_PUBLIC_KEY =\s*'([^']+)'/.exec(source)?.[1]
if (!key) throw new Error('DEV_PUBLIC_KEY not found in src/dev-key.ts')
const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
console.log([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(''))
