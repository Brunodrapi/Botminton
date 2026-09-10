// node tools/screenshot.mjs — lance un serveur statique, joue quelques secondes et capture des écrans iPhone.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;
const out = process.argv[2] || '/tmp/shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ ...devices['iPhone 13'], hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/1-menu.png` });
await page.click('#playBtn');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/2-serve.png` });
// service long puis on laisse l'échange se dérouler avec un joueur scripté
await page.keyboard.press('b');
await page.evaluate(() => {
  const { game, input } = window.__rogueShuttle;
  const RS = window.RogueShuttle;
  // joueur scripté : injecte un stick + frappes via les touches virtuelles
  setInterval(() => {
    const p = game.player, s = game.shuttle;
    if (game.state === 'serve' && game.server === p) { input.just.push('B'); return; }
    input.keys = {};
    if (game.state !== 'rally' || game.lastHitter === p || !game.pred) return;
    let t = null;
    for (const q of game.pred.path) { if (q.t <= s.t || q.z > -0.35 || q.y > 2.3 || q.y < 0.15) continue; if (q.vy > 0 && q.y > 0.9) continue; t = q; break; }
    if (!t) t = game.pred.landing;
    const dx = t.x - p.x, dz = t.z - RS.SWEET - p.z;
    input.keys = { arrowright: dx > 0.1, arrowleft: dx < -0.1, arrowup: dz > 0.1, arrowdown: dz < -0.1 };
    const near = Math.hypot(s.x - p.x, s.z - (p.z + RS.SWEET)) < 1.6 && s.z < 0.3;
    if (near && !p.armed) { const btn = s.y > 1.1 ? 'A' : 'B'; input.just.push(btn); input.held[btn] = true; }
    if (!near) for (const k in input.held) input.held[k] = false;
  }, 33);
});
const shots = [];
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => { const g = window.__rogueShuttle.game; return { state: g.state, z: g.shuttle.z, y: g.shuttle.y, hits: g.rallyHits, score: g.score.join('-') }; });
  if (st.state === 'rally' && st.hits >= 1 && shots.length < 4) { await page.screenshot({ path: `${out}/3-rally-${shots.length}.png` }); shots.push(st); }
  if (st.state === 'point' && !shots.point) { shots.point = true; await page.screenshot({ path: `${out}/4-point.png` }); }
}
console.log('captured', JSON.stringify(shots));
// paysage
const page2 = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await page2.goto(url); await page2.click('#playBtn'); await page2.waitForTimeout(300);
await page2.screenshot({ path: `${out}/5-landscape.png` });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
server.close();
