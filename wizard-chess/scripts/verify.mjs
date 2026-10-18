#!/usr/bin/env node
// Static checks of the web bundle and Android wrapper (no browser or Android SDK needed):
// module imports resolve, DOM ids referenced by the scripts exist, assets referenced by the
// page and stylesheet exist, and the app asks for no permission beyond vibration.
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join, dirname, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const errors = [];
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

const scripts = walk(join(web, 'js')).filter(f => f.endsWith('.js'));
for (const file of scripts) {
  try { execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'}); } catch (e) { errors.push(`${relative(root, file)}: ${e.stderr}`); }
  const source = readFileSync(file, 'utf8');
  for (const [, spec] of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (spec === 'three') continue;
    if (spec.startsWith('.') && !existsSync(resolve(dirname(file), spec))) errors.push(`${relative(root, file)}: missing module ${spec}`);
  }
  for (const [, spec] of source.matchAll(/new URL\('([^']+)', import\.meta\.url\)/g)) {
    if (!existsSync(resolve(dirname(file), spec))) errors.push(`${relative(root, file)}: missing worker ${spec}`);
  }
}

const html = readFileSync(join(web, 'index.html'), 'utf8');
const css = readFileSync(join(web, 'style.css'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) errors.push('duplicate DOM ids: ' + [...new Set(dupes)].join(', '));
const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
if (!existsSync(join(web, map.imports.three))) errors.push('import map target for three is missing');
for (const [, path] of [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g), ...css.matchAll(/url\('(\.\/[^']+)'\)/g)]) {
  if (!existsSync(join(web, path))) errors.push('missing asset ' + path);
}
for (const file of ['ui.js', 'main.js']) {
  const source = readFileSync(join(web, 'js', file), 'utf8');
  for (const [, id] of source.matchAll(/(?:\$|getElementById)\('([a-z0-9-]+)'\)/g)) if (!ids.includes(id)) errors.push(`${file}: unknown DOM id ${id}`);
}

const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const permissions = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map(m => m[1]);
if (permissions.join() !== 'android.permission.VIBRATE') errors.push('unexpected Android permissions: ' + permissions.join(', '));
for (const xml of walk(join(root, 'android/app/src/main/res'))) {
  const text = readFileSync(xml, 'utf8');
  if (!text.startsWith('<?xml')) errors.push('not an XML resource: ' + relative(root, xml));
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`PASS: ${scripts.length} modules parse and resolve, ${ids.length} DOM ids consistent, assets present, offline permission set.`);
