/**
 * Renders the app icons from the same fonts and materials as the app: the
 * SHYST tape strip on concrete under the work light.
 *
 *   node --import tsx scripts/icons.ts
 *
 * Writes web/public/icon-{32,180,192,512}.png and icon-maskable-512.png
 * (content kept inside the 80% safe zone for Android adaptive icons).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');

const root = new URL('../web/public/', import.meta.url).pathname;
const paperGrain =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .32 0 0 0 0 .27 0 0 0 0 .2 0 0 0 .22 0'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23p)'/%3E%3C/svg%3E\")";
const grain =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

function page(safe: number) {
  return `<!doctype html><html><head><style>
@font-face { font-family: S; src: url('file://${root}fonts/big-shoulders-stencil.woff'); font-weight: 100 900; }
html, body { margin: 0; width: 512px; height: 512px; overflow: hidden; }
body {
  display: grid; place-items: center;
  background:
    radial-gradient(120% 70% at 50% -10%, rgba(245, 162, 58, 0.22), transparent 62%),
    radial-gradient(110% 90% at 50% 45%, transparent 55%, rgba(0, 0, 0, 0.6) 100%),
    ${grain},
    linear-gradient(180deg, #161512, #0a0a09);
}
.tape {
  width: ${Math.round(440 * safe)}px;
  padding: ${Math.round(44 * safe)}px 0 ${Math.round(34 * safe)}px;
  display: grid; justify-items: center; line-height: 0.86;
  font-family: S; font-weight: 800; letter-spacing: 0.05em;
  color: #1b1813;
  background: linear-gradient(180deg, rgba(255,255,255,.24), rgba(255,255,255,0) 45%, rgba(0,0,0,.08)), ${paperGrain}, #d3ccb9;
  transform: rotate(-6deg);
  clip-path: polygon(0 10%, 2% 0, 30% 2%, 62% 0, 98% 2%, 100% 14%, 98.6% 34%, 100% 52%, 98.2% 70%, 100% 88%, 97% 100%, 58% 97%, 24% 100%, 3% 98%, 1% 82%, 0 64%, 1.6% 44%, 0 26%);
}
.tape b { font-size: ${Math.round(148 * safe)}px; font-weight: 800; }
.tape span { font-size: ${Math.round(150 * safe)}px; }
</style></head><body><div class="tape"><b>SHYST</b></div></body></html>`;
}

const dir = mkdtempSync(join(tmpdir(), 'icons-'));
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 512, height: 512 } });
for (const [name, safe, sizes] of [
  ['icon', 1, [32, 180, 192, 512]],
  ['icon-maskable', 0.78, [512]],
] as const) {
  const html = join(dir, `${name}.html`);
  writeFileSync(html, page(safe));
  await p.goto(`file://${html}`);
  await p.waitForTimeout(300);
  const png = await p.screenshot({ type: 'png' });
  const big = join(dir, `${name}.png`);
  writeFileSync(big, png);
  for (const size of sizes) {
    const out = size === 512 && name === 'icon-maskable' ? `${root}icon-maskable-512.png` : `${root}icon-${size}.png`;
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${png.toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`);
    await p.waitForTimeout(80);
    await p.screenshot({ path: out });
    await p.setViewportSize({ width: 512, height: 512 });
    console.log('wrote', out);
  }
}
await browser.close();
