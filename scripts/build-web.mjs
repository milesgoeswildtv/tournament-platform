/**
 * Builds the web app with esbuild (used where Vite isn't installed; CI may use
 * either — both read web/index.html, web/public and the same sources).
 *
 *   node scripts/build-web.mjs            # production build → web/dist
 *   VITE_API_URL=https://api.example node scripts/build-web.mjs
 *
 * Fails if any Decode answer or Speedrun task answer appears in the bundle:
 * the browser must only ever see rules text.
 */
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'web/dist');
const dev = process.argv.includes('--dev');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'web/public'), out, { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(root, 'web/src/main.tsx')],
  bundle: true,
  minify: !dev,
  sourcemap: true,
  format: 'esm',
  splitting: false,
  target: ['es2020', 'safari15'],
  outdir: join(out, 'assets'),
  entryNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
  loader: { '.module.css': 'local-css', '.css': 'css', '.svg': 'text' },
  alias: { '@shared': join(root, 'shared/src') },
  external: ['/fonts/*'],
  jsx: 'automatic',
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL ?? ''),
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
  },
  metafile: true,
  logLevel: 'warning',
});

const outputs = Object.keys(result.metafile.outputs).map((p) => p.replace(/^.*web\/dist/, ''));
const js = outputs.find((p) => p.endsWith('.js'));
const css = outputs.find((p) => p.endsWith('.css'));
let html = readFileSync(join(root, 'web/index.html'), 'utf8');
html = html.replace(/<script type="module" src="\/src\/main.tsx"><\/script>/, `<script type="module" src="${js}"></script>`);
if (css) html = html.replace('</head>', `  <link rel="stylesheet" href="${css}" />\n  </head>`);
writeFileSync(join(out, 'index.html'), html);

// ---- leak check: no answers in the client bundle
const require = createRequire(import.meta.url);
const bundle = readFileSync(join(out, js), 'utf8').toLowerCase();
const lib = readFileSync(join(root, 'shared/src/games/decodeLibrary.ts'), 'utf8');
const tasks = readFileSync(join(root, 'shared/src/games/speedrunTasks.ts'), 'utf8');
const answers = [...lib.matchAll(/answer: '([^']+)'/g)].map((m) => m[1]);
const probes = [...answers, ...[...tasks.matchAll(/prompt: '([^']{24,})'/g)].map((m) => m[1])].map((s) => s.toLowerCase());
const leaked = probes.filter((p) => bundle.includes(p));
if (leaked.length) {
  console.error(`✗ game secrets leaked into the web bundle: ${leaked.slice(0, 3).join(' | ')}`);
  process.exit(1);
}
void require;
const size = (p) => (readFileSync(join(out, p)).length / 1024).toFixed(1);
console.log(`✓ web/dist built: ${js} (${size(js)} KB)${css ? `, ${css} (${size(css)} KB)` : ''}; no game secrets in bundle (${probes.length} probes)`);
if (!existsSync(join(out, 'index.html'))) process.exit(1);
