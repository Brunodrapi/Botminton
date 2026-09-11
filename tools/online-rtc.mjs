// node tools/online-rtc.mjs — deux navigateurs jouent via WebRTC, comme sur GitHub Pages.
// Rien n'est simulé ici : pas de faux salon, la vraie bibliothèque et le vrai annuaire public.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
// L'annuaire public n'est pas joignable depuis ce bac à sable : on en monte un local, avec la
// vraie bibliothèque PeerJS et le vrai protocole. C'est l'intégration complète qui est exercée,
// seul le point de rendez-vous change — exactement ce que le réglage ROGUE_SHUTTLE_RTC permet.
const LIBFILE = process.env.PEERJS_LIB;      // peerjs.min.js à servir localement
let sig = null, sigPort = 0;
try {
  const { PeerServer } = require(process.env.PEER_PKG || 'peer');
  sigPort = 9000 + Math.floor(Math.random() * 500);
  await new Promise((resolve, reject) => {
    sig = PeerServer({ host: '127.0.0.1', port: sigPort, path: '/' }, () => resolve());
    setTimeout(resolve, 3000);
  });
  console.log('annuaire local sur le port', sigPort);
} catch (e) { console.log('pas d\'annuaire local :', e.message); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/peerjs.js' && LIBFILE) {
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(readFileSync(LIBFILE)); return;
  }
  const p = join(root, u === '/' ? 'index.html' : u);
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
const out = process.argv[2] || '/tmp/rtc';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
if (sigPort) await ctx.addInitScript(`window.ROGUE_SHUTTLE_RTC = ${JSON.stringify({
  lib: LIBFILE ? '/peerjs.js' : undefined,
  peer: { host: '127.0.0.1', port: sigPort, path: '/', secure: false },
})};`);
const errors = [];
const mk = async (tag) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_RESET|favicon/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.mouse.click(195, 400);      // l'écran d'accueil précède le menu
  await page.waitForTimeout(200);
  return page;
};
const A = await mk('A'), B = await mk('B');
const MODE = process.env.MODE || 'duel';

// --- A crée la table ---
await A.click('#onlineBtn'); await A.waitForTimeout(800);
console.log('transport côté A :', await A.evaluate(() => window.__rogueShuttle.net.kind));
console.log('état A :', await A.textContent('#onlineState'));
await A.click(`#netMode .card >> nth=${MODE === 'coop' ? 1 : 0}`);
await A.fill('#netName', 'ALICE');
await A.click('#netCreate');
await A.waitForSelector('#lobby:not(.hidden)', { timeout: 30000 }).catch(() => {});
const code = (await A.textContent('#lobbyCode').catch(() => '')).trim();
console.log('code de table :', code || '(échec : ' + (await A.textContent('#onlineState')) + ')');
if (!code) { console.log('errors:', errors); await browser.close(); server.close(); process.exit(1); }

// --- B rejoint en tapant le code ---
await B.click('#onlineBtn'); await B.waitForTimeout(800);
await B.fill('#netName', 'BOB');
await B.fill('#netCode', code);
await B.click('#netJoin');
await B.waitForSelector('#lobby:not(.hidden)', { timeout: 30000 }).catch(() => {});
const joined = await B.evaluate(() => !document.getElementById('lobby').classList.contains('hidden'));
console.log('B a rejoint :', joined, joined ? '' : await B.textContent('#onlineState'));
await A.waitForTimeout(1200);
console.log('vus par A :', await A.evaluate(() => window.__rogueShuttle.net.members(window.__rogueShuttle.net.table).length));
console.log('vus par B :', await B.evaluate(() => window.__rogueShuttle.net.members(window.__rogueShuttle.net.table).length));
console.log('formule adoptée par B :', await B.evaluate(() => window.__rogueShuttle.net.mode + '/' + window.__rogueShuttle.net.game));
await A.screenshot({ path: `${out}/1-lobby-a.png` });
await B.screenshot({ path: `${out}/2-lobby-b.png` });

await A.click('#lobbyReady'); await A.waitForTimeout(400);
await B.click('#lobbyReady'); await B.waitForTimeout(1500);
console.log('états :', await Promise.all([A, B].map((p) => p.evaluate(() => window.__rogueShuttle.net.state))));

const DRIVE = readFileSync(new URL('./drive.js', import.meta.url), 'utf8');
await A.evaluate(DRIVE); await B.evaluate(DRIVE);
for (let i = 0; i < Number(process.env.ROUNDS || 50); i++) {
  await A.waitForTimeout(500);
  for (const p of [A, B]) await p.evaluate(() => {
    const c = document.querySelector('#choice:not(.hidden) .choice'); if (c) c.click();
    const m = document.querySelector('#malus:not(.hidden) #malusBtn'); if (m) m.click();
  });
}
const read = (p) => p.evaluate(() => {
  const g = window.__rogueShuttle.game, n = window.__rogueShuttle.net;
  return { score: g.score.map((v) => +v.toFixed(2)), state: g.state, role: n.isHost() ? 'hôte' : 'invité',
           lag: Math.round((n.lag || 0) * 1000), robots: g.robots.length,
           hits: g.robots.map((r) => r.stats.hits), longest: g.longestRally, doubles: g.doubles };
});
const [ra, rb] = await Promise.all([read(A), read(B)]);
console.log('A :', JSON.stringify(ra));
console.log('B :', JSON.stringify(rb));
await A.screenshot({ path: `${out}/3-jeu-a.png` });
await B.screenshot({ path: `${out}/4-jeu-b.png` });
console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();
server.close();
if (sig && typeof sig.close === "function") sig.close(); else process.exit(0);
