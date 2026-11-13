// Turns dist-single/index.html into an artifact page: title + meta + styles first,
// no <html>/<head>/<body> wrappers (the artifact host adds its own skeleton).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('dist-single/index.html', 'utf8');
const pick = (re) => [...html.matchAll(re)].map(m => m[0]).join('\n');
const title = pick(/<title>[\s\S]*?<\/title>/g);
const metas = pick(/<meta name="(?:claude:viewport-fit-sides|theme-color)"[^>]*>/g);
const links = pick(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts[^>]*>/g);
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const script = pick(/<script type="module"[^>]*>[\s\S]*?<\/script>/g);
const THREE = 'https://cdn.jsdelivr.net/npm/three@0.186.1';
const importmap = `<script type="importmap">${JSON.stringify({ imports: { three: `${THREE}/build/three.module.min.js`, 'three/examples/jsm/': `${THREE}/examples/jsm/` } })}</script>`;
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/ronda-de-noche.html', [title, metas, links, styles, body.trim(), importmap, script].join('\n'));
console.log('artifact/ronda-de-noche.html', (readFileSync('artifact/ronda-de-noche.html').length / 1024).toFixed(0) + ' KB');
