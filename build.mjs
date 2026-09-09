// node build.mjs — assemble une version mono-fichier (dist/index.html) : CSS et JS inclus, aucun chargement externe.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

let html = readFileSync('index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${readFileSync('style.css', 'utf8')}\n</style>`);
html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '');
html = html.replace('<link rel="apple-touch-icon" href="icon.svg">\n', '');
html = html.replace(/<script src="(src\/[^"]+)"><\/script>/g, (_, f) => `<script>\n${readFileSync(f, 'utf8')}\n</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
