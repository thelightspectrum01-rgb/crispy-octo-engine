// Bundle the game into ONE self-contained HTML file (dist/desk-coaster.html) that runs from file://
// with no network access: three.js + the game are minified and inlined.
//   node scripts/build.mjs
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'desk-coaster.html');

const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});

let js = result.outputFiles[0].text;
// keep the HTML parser happy inside an inline <script>
js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/<!-- importmap-start -->[\s\S]*?<!-- importmap-end -->\s*/, '');
const tag = '<script type="module" src="./src/main.js"></script>';
if (!html.includes(tag)) throw new Error('index.html: entry <script> tag not found');
html = html.replace(tag, () => `<script>${js}</script>`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
const kb = Math.round(statSync(out).size / 1024);
console.log(`dist/desk-coaster.html  ${kb} kB`);
