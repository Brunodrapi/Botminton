// node tests/match.test.mjs — simule des matchs complets (joueur scripté contre l'IA) sans navigateur.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['physics.js', 'game.js']) vm.runInContext(readFileSync(new URL('../src/' + f, import.meta.url), 'utf8'), ctx);
const RS = ctx.RogueShuttle, P = ctx.Physics;

function scriptedInput(game, skill) {
  // Contrôleur simple pour le joueur humain : va vers le point d'interception, arme une frappe au bon moment.
  const p = game.player, s = game.shuttle;
  const held = {}, just = [];
  let stick = { x: 0, y: 0 };
  if (game.state === 'serve' && game.server === p) {
    just.push(Math.random() < 0.5 ? 'A' : 'B');
    return { stick, held, just };
  }
  if (game.state === 'rally' && game.lastHitter !== p && game.pred) {
    let target = null;
    for (const q of game.pred.path) {
      if (q.t <= s.t || q.z > -0.35 || q.y > 2.3 || q.y < 0.15) continue;
      if (q.vy > 0 && q.y > 0.9) continue;
      target = q; break;
    }
    if (!target) target = game.pred.landing;
    const tx = target.x + (Math.random() - 0.5) * (1 - skill) * 1.2, tz = target.z - RS.SWEET;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d > 0.05) stick = { x: dx / d * Math.min(1, d / 0.3), y: dz / d * Math.min(1, d / 0.3) };
    const near = Math.hypot(s.x - p.x, s.z - (p.z + RS.SWEET)) < 1.6 && s.z < 0.3;
    if (near) {
      const btn = s.y > 1.9 ? (Math.random() < 0.7 ? 'A' : 'B') : s.y > 1.1 ? 'A' : 'B';
      if (!p.armed) just.push(btn);
      held[p.armed ? p.armed.btn : btn] = true;
    }
  }
  return { stick, held, just };
}

let fails = 0;
const check = (n, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!c) fails++; };

for (const diff of ['rookie', 'pro', 'elite']) {
  for (const chassis of ['light', 'balanced', 'heavy']) {
    const g = new RS.Game();
    g.startMatch({ chassis, difficulty: diff, assist: false });
    const reasons = {};
    let steps = 0, hits = 0, perfect = 0, errors = null;
    const dt = 1 / 60;
    try {
      while (g.state !== 'end' && steps < 60 * 60 * 30) {
        g.update(dt, scriptedInput(g, 0.85));
        for (const e of g.events) {
          if (e.type === 'point') reasons[e.reason] = (reasons[e.reason] || 0) + 1;
          if (e.type === 'hit' && !e.robot.isAI && e.shot !== 'serve') { hits++; if (e.level === 2) perfect++; }
        }
        g.events.length = 0;
        steps++;
      }
    } catch (e) { errors = e; }
    const mins = (steps / 60 / 60).toFixed(1);
    check(`${diff}/${chassis}: match ends without error`, !errors && g.state === 'end', errors ? String(errors.stack) : `score ${g.score.join('-')} in ${mins} min, longest rally ${g.longestRally}, player hits ${hits} (perfect ${perfect}), reasons ${JSON.stringify(reasons)}`);
    check(`${diff}/${chassis}: rallies happen`, g.longestRally >= 4 && hits > 10);
  }
}

// Vérifie la règle de fin : 15 avec 2 d'écart, plafond 20
{
  const g = new RS.Game(); g.startMatch({});
  g.score = [15, 14]; check('15-14 not finished', g.matchWinner() === -1);
  g.score = [16, 14]; check('16-14 finished', g.matchWinner() === 0);
  g.score = [19, 20]; check('19-20 bot wins', g.matchWinner() === 1);
}
console.log(fails ? `\n${fails} test(s) failed` : '\nall good');
process.exit(fails ? 1 : 0);
