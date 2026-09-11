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
    check(`${diff}/${chassis}: rallies happen`, g.longestRally >= 3 && hits >= 5);
  }
}

// Exhibition : un seul palier, à 15 points
{
  const g = new RS.Game(); g.startMatch({});
  check('exhibition target is 15', g.nextStep() === RS.LEVEL_TARGET);
  g.score = [14, 3]; check('14-3 not finished', g.matchWinner() === -1);
  g.score = [15, 3]; check('15 points wins the exhibition', g.matchWinner() === 0);
}

// Rogue lite : paliers de cartes tous les 5 points, run perdue si le bot atteint 15
{
  const g = new RS.Game(); g.startRun({ chassis: 'balanced' });
  g.score = [4, 3]; check('4-3 not a card step', g.matchWinner() === -1);
  g.score = [5, 3]; check('5 points reaches a card step', g.matchWinner() === 0);
  g.score = [2, 15]; check('bot at 15 ends the run', g.matchWinner() === 1);
}

// Progression de la run : 3 manches par niveau, cartes après chacune, raquette à la troisième
{
  const g = new RS.Game(); g.startRun({ chassis: 'balanced' });
  const seen = [];
  for (let i = 0; i < 6; i++) {
    g.score = [g.nextStep(), 0];
    g.nextRally();
    seen.push(`n${g.run.level + 1}@${g.nextStep()}:${g.phase}${g.pendingRacket ? '+raquette' : ''}`);
    g.advance();
  }
  const want = 'n1@5:cards n1@10:cards n1@15:cards+raquette n2@5:cards n2@10:cards n2@15:cards+raquette';
  check('run advances through card steps', seen.join(' ') === want, seen.join(' '));
}

// Le boss impose un protocole, et le score repart de zéro au niveau suivant
{
  const g = new RS.Game(); g.startRun({ chassis: 'balanced', startLevel: 3 });
  check('boss level draws a handicap', !!g.run.handicap, g.run.handicap && g.run.handicap.name);
  const g2 = new RS.Game(); g2.startRun({ chassis: 'balanced' });
  check('early levels have no handicap', !g2.run.handicap);
  const g3 = new RS.Game(); g3.startExhibition({ chassis: 'balanced', difficulty: 'boss' });
  const g4 = new RS.Game(); g4.startRun({ chassis: 'balanced', difficulty: 'boss' });
  check('a run always starts at level 1', g4.run.level === 0 && g4.diff.key === 'rookie', `${g4.run.level} ${g4.diff.key}`);
  check('exhibition honours the chosen opponent', g3.diff.key === 'boss');
  for (let i = 0; i < 3; i++) { g2.score = [g2.nextStep(), 4]; g2.nextRally(); g2.advance(); }
  check('next opponent starts at 0', g2.score[0] === 0 && g2.score[1] === 0 && g2.run.level === 1, `${g2.score.join('-')} niveau ${g2.run.level}`);
}

// Chemin d'entrée complet : croix + bouton → type de coup, profondeur et point de chute.
// Ce trajet a déjà cassé en silence, il est vérifié de bout en bout.
{
  const dirs = { bas: { x: 0, y: -1 }, neutre: { x: 0, y: 0 }, haut: { x: 0, y: 1 }, 'haut-droit': { x: 1, y: 1 } };
  const play = (btn, dir) => {
    const g = new RS.Game();
    g.startExhibition({ chassis: 'balanced', difficulty: 'rookie' });
    const p = g.player; p.x = 0; p.z = -5;
    Object.assign(g.shuttle, { x: 0, y: 1.6, z: -4.65, vx: 0, vy: 0, vz: 0, t: 0 });
    g.lastHitter = g.bot; g.state = 'rally'; g.time = 10;
    g.update(1 / 60, { stick: dirs[dir], held: {}, just: [btn] });   // pression
    g.update(1 / 60, { stick: dirs[dir], held: {}, just: [] });      // relâchement : le coup part
    const act = p.act;
    if (!act) return null;
    g.hit(p, 0.3);
    return { shot: act.shot, depth: act.depth, z: g.pred.landing.z, x: g.pred.landing.x };
  };
  const cases = [
    ['B', 'bas', 'attack', 0], ['B', 'neutre', 'clear', 1], ['B', 'haut', 'clear', 2],
    ['A', 'bas', 'drop', 0], ['A', 'neutre', 'drive', 1], ['A', 'haut', 'drive', 2],
  ];
  for (const [btn, dir, shot, depth] of cases) {
    const r = play(btn, dir);
    check(`${btn} + ${dir} → ${shot} profondeur ${depth}`, !!r && r.shot === shot && r.depth === depth,
      r ? `${r.shot} ${r.depth} (z=${r.z.toFixed(2)})` : 'aucun coup');
  }
  const deep = play('B', 'haut'), mid = play('B', 'neutre'), short = play('B', 'bas');
  check('les trois profondeurs sont bien étagées', deep.z > mid.z + 0.8 && mid.z > short.z + 0.8,
    `${short.z.toFixed(2)} < ${mid.z.toFixed(2)} < ${deep.z.toFixed(2)}`);
  check('le dégagé haut atteint le fond de court', deep.z > 6, deep.z.toFixed(2));
  const diag = play('B', 'haut-droit');
  check('la diagonale garde la profondeur et vise de côté', diag.depth === 2 && diag.x > 1, `x=${diag.x.toFixed(2)} z=${diag.z.toFixed(2)}`);
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
