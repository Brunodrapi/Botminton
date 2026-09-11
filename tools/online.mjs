// node tools/online.mjs — deux navigateurs jouent l'un contre l'autre.
// La capacité `room` de claude.ai est remplacée par un faux salon bâti sur BroadcastChannel :
// même contrat (presence / peers / onPeers / connected), donc le jeu ne sait pas qu'il est en test.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  const p = join(root, u === '/' ? 'index.html' : u);
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
const out = process.argv[2] || '/tmp/online';
mkdirSync(out, { recursive: true });
const LAG = Number(process.env.NETLAG || 60);      // latence simulée dans chaque sens, en ms

const FAKE_ROOM = `(() => {
  const LAG = __LAG__;
  const id = 'p' + Math.random().toString(36).slice(2, 10);
  const ch = new BroadcastChannel('rogue-shuttle-room');
  const mine = {};
  const others = new Map();
  const peerHandlers = [];
  const connHandlers = [];
  const snapshot = () => {
    const list = [{ peer: id, by: null, isMe: true, sameTab: true, kind: 'viewer', presence: Object.freeze({ ...mine }), updatedAt: Date.now() }];
    for (const [k, v] of others) list.push({ peer: k, by: null, isMe: false, sameTab: false, kind: 'viewer', presence: Object.freeze({ ...v }), updatedAt: Date.now() });
    return Object.freeze(list);
  };
  const fire = () => { const s = snapshot(); for (const h of peerHandlers) h({ peers: s, joined: s, left: [], updated: [] }); };
  ch.onmessage = (e) => {
    const m = e.data;
    if (m.from === id) return;
    setTimeout(() => {
      if (m.type === 'bye') others.delete(m.from);
      else {
        const cur = others.get(m.from) || {};
        for (const k in m.patch) { if (m.patch[k] === null) delete cur[k]; else cur[k] = m.patch[k]; }
        others.set(m.from, cur);
      }
      fire();
    }, LAG);
  };
  window.addEventListener('pagehide', () => ch.postMessage({ type: 'bye', from: id }));
  const room = Object.freeze({
    presence: (patch) => {
      for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
      ch.postMessage({ type: 'p', from: id, patch });
      fire();
      return Promise.resolve();
    },
    peers: snapshot,
    onPeers: (h) => { peerHandlers.push(h); setTimeout(() => h({ peers: snapshot(), joined: snapshot(), left: [], updated: [] }), 0); return () => {}; },
    onConnection: (h) => { connHandlers.push(h); setTimeout(() => h(true), 0); return () => {}; },
    connected: () => true,
    emit: () => Promise.resolve(),
    on: () => () => {},
  });
  window.claude = { use: (n) => Promise.resolve(n === 'room' ? room : null) };
})();`.replace('__LAG__', String(LAG));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.addInitScript(FAKE_ROOM);

const errors = [];
const mk = async (tag) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_RESET/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  await page.goto(url);
  return page;
};
const A = await mk('A'), B = await mk('B');

// Une seule formule à choisir : DUEL 1v1 (exhibition) ou COOP 2v2 (rogue lite).
const MODE = process.env.MODE || 'duel';

// --- A ouvre le menu en ligne et crée une table ---
await A.click('#onlineBtn'); await A.waitForTimeout(500);
await A.click(`#netMode .card >> nth=${MODE === 'coop' ? 1 : 0}`);
await A.fill('#netName', 'ALICE');
await A.click('#netCreate'); await A.waitForTimeout(400);
const code = (await A.textContent('#lobbyCode')).trim();
console.log('table créée :', code, '·', MODE);

// --- B rejoint ---
await B.click('#onlineBtn'); await B.waitForTimeout(600);
await B.fill('#netName', 'BOB');
const joined = await B.evaluate((c) => {
  const b = [...document.querySelectorAll('#netTables .choice')].find((x) => x.dataset.code === c);
  if (!b) return false; b.click(); return true;
}, code);
console.log('B a rejoint :', joined);
await B.waitForTimeout(400);
await A.screenshot({ path: `${out}/1-lobby-a.png` });
await B.screenshot({ path: `${out}/2-lobby-b.png` });

// --- les deux se déclarent prêts ---
await A.click('#lobbyReady'); await A.waitForTimeout(300);
await B.click('#lobbyReady'); await B.waitForTimeout(900);
const started = await Promise.all([A, B].map((p) => p.evaluate(() => window.__rogueShuttle.net.state)));
console.log('états après « prêt » :', started.join(' / '));

// --- pilotage automatique des deux côtés ---
const DRIVE = `(() => {
  const { game, input, net } = window.__rogueShuttle;
  const RS = window.RogueShuttle;
  let hold = null; const HOLD = 0.3;
  window.__log = { hits: 0, presses: 0 };
  setInterval(() => {
    const p = game.player, s = game.shuttle;
    input.keys = {};
    for (const k in input.held) input.held[k] = false;
    if (hold) {
      if (game.time < hold.until) { input.held[hold.btn] = true; input.keys = hold.keys; return; }
      hold = null; return;
    }
    if (game.state === 'serve' && game.server === p) {
      input.just.push('A'); input.held.A = true; window.__log.presses++;
      hold = { btn: 'A', until: game.time + HOLD, keys: { arrowup: true } }; return;
    }
    if (game.state !== 'rally' || p.dive || game.lastHitter === p || !game.pred) return;
    const info = game.interceptInfo(p);
    const t = (info && info.point) || game.pred.landing;
    const dx = t.x - p.x, dz = t.z - RS.SWEET * p.side - p.z;
    const keys = { arrowright: dx > 0.12, arrowleft: dx < -0.12, arrowup: dz > 0.12, arrowdown: dz < -0.12 };
    input.keys = keys;
    const tc = (t.t || 0) - s.t, mid = (RS.SWING_HIT0 + RS.SWING_HIT1) / 2;
    if (p.swing <= 0 && tc <= mid + HOLD && tc > -0.05) {
      const btn = t.x >= p.x ? 'A' : 'B';
      input.just.push(btn); input.held[btn] = true; window.__log.presses++;
      hold = { btn, until: game.time + Math.max(0, Math.min(HOLD, tc - mid)), keys: { arrowup: s.y > 1.2, arrowdown: s.y <= 1.2 } };
    }
  }, 16);
})();`;
await A.evaluate(DRIVE); await B.evaluate(DRIVE);

const ROUNDS = Number(process.env.ROUNDS || 60);
for (let i = 0; i < ROUNDS; i++) {
  await A.waitForTimeout(500);
  for (const p of [A, B]) await p.evaluate(() => {
    window.__log.seen = window.__log.seen || {};
    const panel = document.querySelector('#choice:not(.hidden)');
    if (panel) { window.__log.seen.choice = (window.__log.seen.choice || 0) + 1; const c = panel.querySelector('.choice'); if (c) c.click(); }
    const m = document.querySelector('#malus:not(.hidden) #malusBtn'); if (m) m.click();
  });
}
const read = (p) => p.evaluate(() => {
  const g = window.__rogueShuttle.game, n = window.__rogueShuttle.net;
  return { score: g.score.map((v) => +v.toFixed(2)), state: g.state, role: n.isHost() ? 'hôte' : 'invité',
           lag: Math.round((n.lag || 0) * 1000), robots: g.robots.length,
           hits: g.robots.map((r) => r.stats.hits), whiffs: g.robots.map((r) => r.stats.whiffs),
           longest: g.longestRally, presses: window.__log.presses, doubles: g.doubles,
           stage: g.run.stage, level: g.run.level, wins: g.run.wins || null, roundSeq: g.roundSeq || 0,
           deck: Object.keys(g.deck(0).cards).length + '+' + Object.keys(g.deck(0).racket).length,
           choices: (window.__log.seen || {}).choice || 0,
           pos: g.robots.map((r) => `${r.side > 0 ? 'haut' : 'bas '}(${r.x.toFixed(1)},${r.z.toFixed(1)})`),
           me: `${g.player.x.toFixed(1)},${g.player.z.toFixed(1)}`, shuttle: `${g.shuttle.x.toFixed(1)},${g.shuttle.z.toFixed(1)}` };
});
const [ra, rb] = await Promise.all([read(A), read(B)]);
console.log('A :', JSON.stringify(ra));
console.log('B :', JSON.stringify(rb));
await A.screenshot({ path: `${out}/3-jeu-a.png` });
await B.screenshot({ path: `${out}/4-jeu-b.png` });
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
server.close();
