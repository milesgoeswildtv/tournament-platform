/**
 * Design-system guard, run by the web build:
 *
 *  1. Every CSS-module class a component uses (s.foo) must exist in that
 *     module. A typo silently renders unstyled, so it fails the build.
 *  2. No inline style objects (style={{ … }}) except data-driven positions.
 *     Visual decisions live in tokens and component stylesheets; a component
 *     may only pass computed values (CSS variables via vars(), or a `left`
 *     percentage for a value plotted on an axis).
 *  3. No raw hex colours in component stylesheets outside tokens.css, except
 *     a short allow-list of physical-object shades (flap faces, card ink).
 *
 *   node scripts/check-css.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const src = join(root, 'web/src');
const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(src);
const classesIn = new Map();
function classes(cssPath) {
  if (!classesIn.has(cssPath)) {
    const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '');
    classesIn.set(cssPath, new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1])));
  }
  return classesIn.get(cssPath);
}

for (const file of files.filter((f) => f.endsWith('.tsx'))) {
  const code = readFileSync(file, 'utf8');
  const rel = relative(root, file);

  // 1. module classes
  for (const m of code.matchAll(/import\s+(\w+)\s+from\s+'([^']+\.module\.css)'/g)) {
    const [, alias, spec] = m;
    const known = classes(resolve(dirname(file), spec));
    for (const use of code.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_]\\w*)`, 'g'))) {
      if (!known.has(use[1])) problems.push(`${rel}: ${alias}.${use[1]} is not defined in ${spec}`);
    }
    for (const use of code.matchAll(new RegExp(`\\b${alias}\\[\`([a-zA-Z]+)_\\$\\{`, 'g'))) {
      if (![...known].some((c) => c.startsWith(`${use[1]}_`))) problems.push(`${rel}: no ${use[1]}_* classes in ${spec}`);
    }
  }
  // also layoutStyles / fieldStyles re-exports
  for (const m of code.matchAll(/(layoutStyles|fieldStyles)\s+as\s+(\w+)/g)) {
    const known = classes(join(src, 'ui', m[1] === 'layoutStyles' ? 'layout.module.css' : 'controls.module.css'));
    for (const use of code.matchAll(new RegExp(`\\b${m[2]}\\.([A-Za-z_]\\w*)`, 'g'))) {
      if (!known.has(use[1])) problems.push(`${rel}: ${m[2]}.${use[1]} is not defined in ${m[1]}`);
    }
  }
  for (const use of code.matchAll(/\bfieldStyles\.([A-Za-z_]\w*)/g)) {
    if (!classes(join(src, 'ui/controls.module.css')).has(use[1])) problems.push(`${rel}: fieldStyles.${use[1]} is not defined`);
  }

  // 2. inline style objects
  for (const m of code.matchAll(/style=\{\{([^}]*)\}\}/g)) {
    if (!/^\s*left:\s*pct\(/.test(m[1])) problems.push(`${rel}: inline style {{${m[1].trim()}}}; move it into the component stylesheet`);
  }
}

// 3. raw colours outside tokens
const ALLOWED = new Set(['#000', '#fff', '#ffb24f', '#23221e', '#0d0d0c', '#191815', '#3b3933', '#4b4841', '#c8352a', '#151513', '#120908', '#0a0d09', '#0e0e0c', '#090908']);
for (const file of files.filter((f) => f.endsWith('.css') && !f.endsWith('tokens.css'))) {
  const css = readFileSync(file, 'utf8').replace(/url\([^)]*\)/g, '');
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    if (!ALLOWED.has(m[0].toLowerCase())) problems.push(`${relative(root, file)}: raw colour ${m[0]}; use a token from tokens.css`);
  }
}

if (problems.length) {
  console.error(`✗ design-system check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ design system: ${files.filter((f) => f.endsWith('.tsx')).length} components use only defined classes, no inline style objects, colours from tokens`);
