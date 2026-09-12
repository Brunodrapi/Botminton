// node tools/stamp.mjs — appose une empreinte de contenu sur chaque fichier chargé par index.html.
//
// GitHub Pages sert tout avec `cache-control: max-age=600`, et un téléphone garde volontiers les
// scripts plus longtemps encore. Comme leurs adresses ne changeaient jamais d'une version à l'autre,
// un joueur pouvait recharger la page et continuer de jouer l'ancien code sans le savoir — et sans
// qu'on puisse le distinguer d'un bug pas corrigé. Chaque fichier porte donc maintenant l'empreinte
// de son contenu : une adresse inédite à chaque changement, donc plus aucun ancien script possible.
//
// L'empreinte globale est écrite dans <meta name="build"> et affichée dans le jeu : on peut dire
// d'un coup d'œil, sur le téléphone, quelle version tourne vraiment.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const short = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

let html = readFileSync('index.html', 'utf8');
const parts = [];

// `?v=` sur les scripts locaux et sur la feuille de style.
html = html.replace(/(<script src="|<link rel="stylesheet" href=")((?:src\/)?[\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"/g,
  (_, head, file) => {
    const h = short(readFileSync(file, 'utf8'));
    parts.push(file + ':' + h);
    return `${head}${file}?v=${h}"`;
  });

const build = short(parts.join('|'));
html = html.replace(/<meta name="build" content="[0-9a-f]*">\n?/, '');
html = html.replace('</title>', `</title>\n<meta name="build" content="${build}">`);
writeFileSync('index.html', html);
console.log(`build ${build} — ${parts.length} fichiers estampillés`);
