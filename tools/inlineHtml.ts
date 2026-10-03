/**
 * Post-build step for `npm run build:single`: folds the single JS bundle and stylesheet into the
 * HTML so dist-single/crownshire.html needs no other files (works from file:// and as an artifact).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-single';
let html = readFileSync(join(dir, 'index.html'), 'utf8');
const assets = join(dir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`expected one script bundle, found ${js.join(', ')}`);
// drop the external tags, then inline
html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>\s*/g, '').replace(/<link[^>]*rel="stylesheet"[^>]*>\s*/g, '').replace(/<link[^>]*rel="modulepreload"[^>]*>\s*/g, '');
const styles = css.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const script = readFileSync(join(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
html = html.replace('</head>', `<style>${styles}</style>\n</head>`);
html = html.replace('</body>', `<script type="module">${script}</script>\n</body>`);
writeFileSync(join(dir, 'crownshire.html'), html);
console.log(`dist-single/crownshire.html ${(html.length / 1e6).toFixed(2)} MB`);

// Artifact variant: the host wraps pages in its own document skeleton (doctype, head with charset and
// viewport, body), so emit only the title, styles and body content.
const title = html.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Crownshire</title>';
const bodyInner = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('</body>'));
const artifact = `${title}
<style>:root { color-scheme: dark; } html, body { background: #1a1420; height: 100%; }</style>
<style>${styles}</style>
${bodyInner}`;
writeFileSync(join(dir, 'crownshire-artifact.html'), artifact);
console.log(`dist-single/crownshire-artifact.html ${(artifact.length / 1e6).toFixed(2)} MB`);
