// Exports title badges from the app's own Badge component (web/src/components/badges) as
// static SVGs in site/assets/badges/, so the site shows exactly what the app shows.
//   node site/tools/export-badges.mjs        (needs web/node_modules)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.resolve(here, '../../web')
const OUT = path.resolve(here, '../assets/badges')

// what the site uses: [title, level]; each comes out full (<title>-<level>.svg) and in the
// app's small-size variant (<title>-<level>-s.svg), which drops detail that turns to mush
const WANT = [['kol', 4], ['diamond', 5], ['shiller', 2], ['raider', 3]]

const require = createRequire(path.join(web, 'package.json'))
const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href)

const ENTRY = '\0badges'
const bundle = await rolldown({
  input: ENTRY,
  platform: 'node',
  cwd: web,
  transform: { jsx: 'react-jsx' },
  resolve: { alias: { '@': path.join(web, 'src') } },
  logLevel: 'warn',
  plugins: [{
    name: 'badges',
    resolveId: (id) => (id === ENTRY ? id : null),
    load(id) {
      if (id === ENTRY) return `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { Badge } from '@/components/badges/Badge'
        export const render = (title, level, size) => renderToStaticMarkup(createElement(Badge, { title, level, size, label: false }))`
      // CSS modules: the class names are dropped below, so any string will do
      if (id.endsWith('.module.css')) return { code: 'export default new Proxy({}, { get: (_, k) => String(k) })', moduleType: 'js' }
      return null
    },
  }],
})
const { output } = await bundle.generate({ format: 'esm' })
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'badges-')), 'badges.mjs')
fs.writeFileSync(tmp, output[0].code)
const { render } = await import(pathToFileURL(tmp).href)

fs.mkdirSync(OUT, { recursive: true })
for (const [title, level] of WANT) {
  for (const [suffix, size] of [['', 120], ['-s', 24]]) {
    const svg = render(title, level, size)
      .replace(/ class="[^"]*"/g, '')
      .replace(/^<svg[^>]*>/, (tag) => tag.replace(/ (width|height)="\d+"/g, '')) // the root only: a <rect> needs its size
      .replace(/ aria-hidden="true"| focusable="false"/g, '')
      .replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
      // the app sets the numeral in its UI font; an SVG shown as an <img> can't load web fonts
      .replace(/<text /g, '<text font-family="Geist, Helvetica Neue, Arial, sans-serif" font-weight="700" font-size="13" ')
    fs.writeFileSync(path.join(OUT, `${title}-${level}${suffix}.svg`), svg + '\n')
  }
}
fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
console.log(`${WANT.length * 2} badges -> ${path.relative(process.cwd(), OUT)}`)
