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
if (process.env.DIFF) await page.evaluate((d) => { const s = window.__rogueShuttle.settings; s.difficulty = d; s.startLevel = ['rookie', 'pro', 'elite', 'boss'].indexOf(d); }, process.env.DIFF);
await page.screenshot({ path: `${out}/1-menu.png` });
await page.click('#playBtn');
await page.waitForTimeout(200);
await page.click('#chassisGo');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/2-serve.png` });
// service long puis on laisse l'échange se dérouler avec un joueur scripté
await page.keyboard.press('b');
await page.evaluate(() => {
  const { game, input } = window.__rogueShuttle;
  const RS = window.RogueShuttle;
  let hold = null;                                           // { btn, until, aim } : maintien en cours
  const HOLD = 0.34;                                         // durée de visée du joueur scripté
  setInterval(() => {
    const p = game.player, s = game.shuttle;
    input.keys = {};
    for (const k in input.held) input.held[k] = false;
    // Un maintien en cours : on garde le bouton et la croix jusqu'à l'heure du relâchement.
    if (hold) {
      if (game.time < hold.until) {
        input.held[hold.btn] = true;
        input.keys = { arrowup: hold.aim > 0, arrowdown: hold.aim < 0 };
        return;
      }
      hold = null; return;                                   // image de relâchement : le coup part
    }
    if (game.state === 'serve' && game.server === p) {
      input.just.push('A'); input.held.A = true;
      hold = { btn: 'A', until: game.time + HOLD, aim: 1 };
      return;
    }
    if (game.state !== 'rally' || p.dive || game.lastHitter === p || !game.pred) return;
    const info = game.interceptInfo(p);
    const t = info ? info.point : game.pred.landing;
    const dx = t.x - p.x, dz = t.z - RS.SWEET - p.z;
    input.keys = { arrowright: dx > 0.1, arrowleft: dx < -0.1, arrowup: dz > 0.1, arrowdown: dz < -0.1 };
    const tContact = (t.t || 0) - s.t, mid = (RS.SWING_HIT0 + RS.SWING_HIT1) / 2;
    // On presse assez tôt pour que le maintien de visée finisse pile sur la fenêtre de contact.
    if (!p.act && p.swing <= 0 && tContact <= mid + HOLD && tContact > -0.05) {
      const b = t.x >= p.x ? 'A' : 'B';                       // coup droit à droite, revers à gauche
      const wait = Math.max(0, Math.min(HOLD, tContact - mid));
      input.just.push(b); input.held[b] = true;
      hold = { btn: b, until: game.time + wait, aim: s.y > 1.1 ? 1 : -1 };
    }
  }, 16);
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
