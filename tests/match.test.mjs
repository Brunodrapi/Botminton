// node tests/match.test.mjs — simule des matchs complets (joueur scripté contre l'IA) sans navigateur.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['physics.js', 'game.js']) vm.runInContext(readFileSync(new URL('../src/' + f, import.meta.url), 'utf8'), ctx);
const RS = ctx.RogueShuttle, P = ctx.Physics;

let pressed = null;    // bouton maintenu par le joueur scripté (relâché à l'image suivante)

function scriptedInput(game, skill) {
  // Contrôleur simple : rejoint le point d'interception, appuie puis relâche à l'image suivante
  // pour que la fenêtre de contact tombe sur l'arrivée du volant.
  const p = game.player, s = game.shuttle;
  const held = {}, just = [];
  let stick = { x: 0, y: 0 };
  const release = () => { pressed = null; return { stick, held, just }; };

  if (game.state === 'serve' && game.server === p) {
    if (pressed) return release();
    const b = Math.random() < 0.5 ? 'A' : 'B';
    just.push(b); pressed = b; held[b] = true;
    return { stick, held, just };
  }
  if (game.state !== 'rally' || p.dive) return release();

  if (game.lastHitter !== p && game.pred) {
    const info = game.interceptInfo(p);
    const target = info ? info.point : game.pred.landing;
    const tx = target.x + (Math.random() - 0.5) * (1 - skill) * 1.2, tz = target.z - RS.SWEET;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d > 0.05) stick = { x: dx / d * Math.min(1, d / 0.3), y: dz / d * Math.min(1, d / 0.3) };
    if (pressed) return release();
    const tContact = (target.t || 0) - s.t;
    const mid = (RS.SWING_HIT0 + RS.SWING_HIT1) / 2;
    if (!p.act && p.swing <= 0 && tContact <= mid + 0.02 && tContact > -0.05) {
      const b = s.y > 1.1 ? 'A' : 'B';
      just.push(b); pressed = b; held[b] = true;
    }
    return { stick, held, just };
  }
  return release();
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

// Manche courte : premier à 5 points
{
  const g = new RS.Game(); g.startMatch({});
  g.score = [4, 3]; check('4-3 not finished', g.matchWinner() === -1);
  g.score = [5, 3]; check('5-3 finished', g.matchWinner() === 0);
  g.score = [2, 5]; check('2-5 bot wins', g.matchWinner() === 1);
}

// Progression de la run : 3 manches par niveau, cartes après chacune, raquette à la troisième
{
  const g = new RS.Game(); g.startRun({ chassis: 'balanced' });
  const seen = [];
  for (let i = 0; i < 6; i++) {
    g.score = [RS.POINTS_TO_WIN, 0];
    g.nextRally();
    seen.push(`${g.run.level + 1}-${g.run.round + 1}:${g.phase}${g.pendingRacket ? '+raquette' : ''}`);
    g.advance();
  }
  check('run advances through levels', seen.join(' ') === '1-1:cards 1-2:cards 1-3:cards+raquette 2-1:cards 2-2:cards 2-3:cards+raquette', seen.join(' '));
}

// Effet des cartes
{
  const g = new RS.Game(); g.startRun({ chassis: 'balanced' });
  const base = g.speedOf(g.player);
  g.takeCard('speed'); g.takeCard('speed');
  check('speed card raises movement', Math.abs(g.speedOf(g.player) - base * 1.24) < 1e-6, `${base.toFixed(2)} → ${g.speedOf(g.player).toFixed(2)}`);
  g.takeCard('shuttle');
  g.score = [0, 0]; g.endPoint(g.player, 'POINT !');
  check('shuttle card gives 1.25 point', g.score[0] === 1.25, String(g.score[0]));
  const charge = g.chargeTime(); g.takeCard('legs');
  check('legs card shortens charge', g.chargeTime() < charge);
  const reach = g.reachOf(g.player); g.takeRacket('reach');
  check('racket lengthens reach', g.reachOf(g.player) > reach);
  const [w0, w1] = g.hitWindow(); g.takeRacket('window');
  check('racket widens hit window', g.hitWindow()[1] > w1 && g.hitWindow()[0] < w0);
}
console.log(fails ? `\n${fails} test(s) failed` : '\nall good');
process.exit(fails ? 1 : 0);
