// Builds the Netlify publish directory (dist/):
//   - the existing static site, copied as-is from the repo root
//   - the compiled portal app under dist/portal-app/
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const out = 'dist'
const skip = new Set(['portal', 'scripts', 'supabase', 'node_modules', 'dist', '.git', '.github', 'docs', 'netlify.toml', 'package.json', 'package-lock.json', '.gitignore'])

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

for (const name of readdirSync('.')) {
  if (skip.has(name) || name.startsWith('.env')) continue
  cpSync(name, join(out, name), { recursive: statSync(name).isDirectory() })
}

const app = join('portal', 'dist')
if (!existsSync(app)) throw new Error('portal/dist missing: build the portal first')
cpSync(app, join(out, 'portal-app'), { recursive: true })
console.log('Assembled', out)
