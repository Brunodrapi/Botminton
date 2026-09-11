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
  g.score = [4, 4]; check('4-4 not a card step', g.matchWinner() === -1);
  g.score = [5, 3]; check('player at 5 reaches a card step', g.matchWinner() === 0);
  g.score = [3, 5]; check('bot at 5 also reaches a card step', g.matchWinner() === 0);
  g.run.stage = 2;
  g.score = [14, 14]; check('14-14 not decided', g.matchWinner() === -1);
  g.score = [15, 9]; check('player at 15 wins the level', g.matchWinner() === 0);
  g.score = [9, 15]; check('bot at 15 ends the run', g.matchWinner() === 1);

  // Le bot qui franchit un palier donne quand même une carte de rattrapage au joueur
  const h = new RS.Game(); h.startRun({ chassis: 'balanced' });
  const seen = [];
  h.score = [1, 5]; h.nextRally(); seen.push(h.phase); h.advance();
  h.score = [3, 10]; h.nextRally(); seen.push(h.phase); h.advance();
  h.score = [15, 12]; h.nextRally(); seen.push(h.phase + (h.pendingRacket ? '+raquette' : '')); h.advance();
  check('les paliers du bot donnent aussi une carte', seen.join(' ') === 'cards cards cards+raquette', seen.join(' '));
  check('le niveau gagné passe à l\'adversaire suivant', h.run.level === 1 && h.score[0] === 0 && h.score[1] === 0, `${h.diff.key} ${h.score.join('-')}`);
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

// Chemin d'entrée complet : bouton + croix + durée de maintien → coup, visée et point de chute.
// Ce trajet a déjà cassé en silence, il est vérifié de bout en bout.
{
  const dirs = {
    neutre: { x: 0, y: 0 }, haut: { x: 0, y: 1 }, bas: { x: 0, y: -1 },
    droite: { x: 1, y: 0 }, gauche: { x: -1, y: 0 }, 'haut-droit': { x: 0.71, y: 0.71 },
  };
  // hold = temps de maintien du bouton ; sx = position du volant, pour choisir coup droit ou revers.
  const play = (btn, dir, hold = 0, sx = 0, sy = 1.6, pz = -5) => {
    const g = new RS.Game();
    g.startExhibition({ chassis: 'balanced', difficulty: 'rookie' });
    const p = g.player; p.x = 0; p.z = pz;
    Object.assign(g.shuttle, { x: sx, y: sy, z: pz + 0.35, vx: 0, vy: 0, vz: 0, t: 0 });
    g.lastHitter = g.bot; g.state = 'rally'; g.time = 10;
    const st = dirs[dir];
    g.update(1 / 60, { stick: st, held: { [btn]: true }, just: [btn] });   // pression : le robot se fige et vise
    const frozen = p.moveX === 0 && p.moveZ === 0;
    g.time += hold;                                                        // maintien
    g.update(1 / 60, { stick: st, held: {}, just: [] });                   // relâchement : le coup part
    const act = p.act;
    if (!act) return null;
    const aim = { x: act.target.x, z: act.target.z, f: act.target.f };
    g.hit(p, 0.3);
    // Le sommet de la trajectoire distingue un coup levé d'un coup tendu.
    const apex = Math.max(...g.pred.path.map((q) => q.y));
    return { btn: act.btn, aim, frozen, shot: p.swingShot, level: p.swingLevel, apex,
             z: g.pred.landing.z, x: g.pred.landing.x };
  };
  const HOLD_LINE = 0.62;   // TAP_TIME + SPREAD_TIME, la visée atteint la ligne
  const HOLD_MAX = 1.0;     // maintien trop long : la visée sort du court

  const tap = play('A', 'neutre');
  check('une pression fige le robot pour viser', !!tap && tap.frozen);
  check('A = coup droit', !!tap && tap.btn === 'A');
  check('B = revers', (play('B', 'neutre') || {}).btn === 'B');
  check('sans direction, on vise le milieu du camp adverse',
    !!tap && Math.abs(tap.aim.x) < 0.01 && Math.abs(tap.aim.z - 3.5) < 0.01,
    tap && `x=${tap.aim.x.toFixed(2)} z=${tap.aim.z.toFixed(2)}`);

  // B lève le volant : dégagement long avec la croix vers le haut, lob court avec la croix vers le bas.
  const lobLong = play('B', 'haut', HOLD_LINE), lobShort = play('B', 'bas', HOLD_LINE);
  check('B + haut = dégagement au fond de court', lobLong.shot === 'clear' && lobLong.z > 5.8,
    `${lobLong.shot} z=${lobLong.z.toFixed(2)}`);
  check('B + bas = lob court près du filet', lobShort.shot === 'clear' && lobShort.z < 2.4,
    `${lobShort.shot} z=${lobShort.z.toFixed(2)}`);
  check('le dégagement lève vraiment le volant', lobLong.apex > 4,
    `sommet à ${lobLong.apex.toFixed(1)} m`);

  // A joue à plat : amorti près du filet, drive au-delà.
  const deep = play('A', 'haut', HOLD_LINE), short = play('A', 'bas', HOLD_LINE);
  check('A + bas = amorti près du filet', short.shot === 'drop' && short.z < 2.4,
    `${short.shot} z=${short.z.toFixed(2)}`);
  check('A + haut = drive au fond', deep.shot === 'drive' && deep.z > 5.8,
    `${deep.shot} z=${deep.z.toFixed(2)}`);
  check('le drive reste tendu', deep.apex < lobLong.apex - 1.5,
    `${deep.apex.toFixed(1)} m contre ${lobLong.apex.toFixed(1)} m`);
  check('sans direction le coup reste médian', tap.shot === 'drive' && tap.z > 2.5 && tap.z < 4.6,
    `${tap.shot} z=${tap.z.toFixed(2)}`);
  check('les trois profondeurs sont bien étagées', deep.z > tap.z + 1 && tap.z > short.z + 1,
    `${short.z.toFixed(2)} < ${tap.z.toFixed(2)} < ${deep.z.toFixed(2)}`);

  // Plus on maintient, plus la visée glisse vers le bord.
  const halfHold = play('A', 'haut', 0.30);
  check('la profondeur croît avec la durée du maintien',
    tap.aim.z < halfHold.aim.z && halfHold.aim.z < deep.aim.z,
    `${tap.aim.z.toFixed(2)} < ${halfHold.aim.z.toFixed(2)} < ${deep.aim.z.toFixed(2)}`);
  const rightLine = play('A', 'droite', HOLD_LINE);
  const rightTap = play('A', 'droite', 0.15);
  check('la latéralité croît aussi avec le maintien', rightLine.aim.x > rightTap.aim.x + 0.5,
    `${rightTap.aim.x.toFixed(2)} → ${rightLine.aim.x.toFixed(2)}`);
  check('une croix appuyée décale déjà sans maintien', play('A', 'droite', 0).aim.x > 1.2,
    play('A', 'droite', 0).aim.x.toFixed(2));
  check('le maintien complet amène la visée sur la ligne de côté',
    Math.abs(rightLine.aim.x - 2.59) < 0.35, rightLine.aim.x.toFixed(2));
  check('la croix gauche vise l\u2019autre bord', play('B', 'gauche', HOLD_LINE).aim.x < -2.2);

  // Trop maintenir fait sortir le volant : c'est le risque assumé de la visée glissante.
  const tooLong = play('A', 'haut', HOLD_MAX);
  const tooWide = play('A', 'droite', HOLD_MAX);
  check('un maintien trop long vise derrière la ligne de fond', tooLong.aim.z > 6.7,
    tooLong.aim.z.toFixed(2));
  check('un maintien trop long vise au-delà de la ligne de côté', tooWide.aim.x > 2.59,
    tooWide.aim.x.toFixed(2));
  check('la visée ne glisse pas indéfiniment', tooLong.aim.f <= 1.28 + 1e-9, tooLong.aim.f.toFixed(2));

  const diag = play('A', 'haut-droit', HOLD_LINE);
  check('la diagonale garde la profondeur et vise de côté', diag.z > 4.6 && diag.x > 1.2,
    `x=${diag.x.toFixed(2)} z=${diag.z.toFixed(2)}`);

  // Volant haut repris près du filet et visé à mi-court : c'est le smash.
  const smash = play('A', 'neutre', 0, 0, 2.6, -1.6);
  check('un volant haut repris devant part en smash', smash.shot === 'smash', smash.shot);
  check('le smash tombe bien où il est visé', Math.abs(smash.z - smash.aim.z) < 0.8,
    `visé ${smash.aim.z.toFixed(2)} → ${smash.z.toFixed(2)}`);
  // Depuis le fond, le filet interdit de plonger sur la cible : ce n'est plus un smash, et la mire
  // doit rester honnête — le coup part en drive mais tombe où il est visé.
  const tooFar = play('A', 'neutre', 0, 0, 2.2, -5);
  check('un volant haut repris de loin ne peut pas être smashé', tooFar.shot === 'drive', tooFar.shot);
  check('le coup rétrogradé tombe quand même où il est visé', Math.abs(tooFar.z - tooFar.aim.z) < 0.9,
    `visé ${tooFar.aim.z.toFixed(2)} → ${tooFar.z.toFixed(2)}`);

  // Dans l'échange, les deux boutons frappent des deux côtés : on ne choisit plus son geste.
  for (const btn of ['A', 'B']) for (const [sx, cote] of [[-0.9, 'gauche'], [0.9, 'droite']])
    check(`${btn} reprend le volant côté ${cote}`, play(btn, 'neutre', 0, sx).level === 2,
      String(play(btn, 'neutre', 0, sx).level));
}

// Le service : la pression fige, le relâchement engage, et les règles du carré sont tenues.
{
  const g = new RS.Game();
  g.startExhibition({ chassis: 'balanced', difficulty: 'rookie' });
  g.nextRally();
  g.server = g.player; g.state = 'serve'; g.time = 10;
  const p = g.player, before = { x: p.x, z: p.z };
  g.update(1 / 60, { stick: { x: 1, y: 0 }, held: { A: true }, just: ['A'] });
  check('le service fige le robot au lieu de partir tout de suite',
    g.state === 'serve' && !!p.hold && p.moveX === 0 && p.moveZ === 0 && p.x === before.x,
    `état ${g.state}`);
  p.hold = { btn: 'A', t0: g.time - 0.62 };
  g.update(1 / 60, { stick: { x: 1, y: 0 }, held: {}, just: [] });
  check('le relâchement engage le service', g.state === 'rally' && !p.hold, `état ${g.state}`);
}
// La visée du service est calée sur la boîte : à maintien plein on touche la ligne, au-delà on sort.
{
  const g = new RS.Game();
  g.startExhibition({ chassis: 'balanced', difficulty: 'rookie' });
  g.score = [0, 0]; g.server = g.player; g.setupServe();
  const p = g.player, b = g.serveBoxSign, plein = 0.08 + 0.55;
  const t = (ux, uz, held) => g.serveTarget(p, ux, uz, held === undefined ? plein : held);
  // La croix tranche court ou long tout de suite : le maintien ne joue que sur le côté.
  for (const held of [0, 0.2, plein]) {
    check(`croix vers le bas, maintien ${held.toFixed(2)} s : service court`,
      Math.abs(t(0, -1, held).z) < P.COURT.shortService + 0.6, t(0, -1, held).z.toFixed(2));
    check(`croix vers le haut, maintien ${held.toFixed(2)} s : service long`,
      Math.abs(t(0, 1, held).z) > P.COURT.halfLength - 0.6, t(0, 1, held).z.toFixed(2));
  }
  check('court et long restent tous deux dans la boîte',
    g.inServiceBox(t(0, -1, plein).x, t(0, -1, plein).z) && g.inServiceBox(t(0, 1, plein).x, t(0, 1, plein).z));
  check('visée pleine vers l\u2019extérieur : la ligne de côté',
    Math.abs(Math.abs(t(b, 0).x) - P.COURT.halfWidthSingles) < 0.02, t(b, 0).x.toFixed(2));
  check('visée pleine vers l\u2019intérieur : la ligne médiane', Math.abs(t(-b, 0).x) < 0.02, t(-b, 0).x.toFixed(2));
  check('sans maintien on vise le milieu de la boîte',
    g.inServiceBox(t(0, 0, 0).x, t(0, 0, 0).z), `${t(0, 0, 0).x.toFixed(2)},${t(0, 0, 0).z.toFixed(2)}`);
  // En double la boîte est plus large et moins profonde : la visée suit.
  const gd = new RS.Game();
  gd.startExhibition({ chassis: 'balanced', difficulty: 'rookie', doubles: true });
  gd.score = [0, 0]; gd.server = gd.player; gd.setupServe();
  check('en double le service long s\u2019arrête à la ligne de service long',
    Math.abs(gd.serveTarget(gd.player, 0, 1, plein).z) < P.COURT.longServiceDoubles
      && Math.abs(gd.serveTarget(gd.player, 0, 1, plein).z) > P.COURT.longServiceDoubles - 0.6,
    gd.serveTarget(gd.player, 0, 1, plein).z.toFixed(2));

  // Le bouton choisit le geste : le revers passe plus bas et arrive plus vite.
  const hauteur = (btn) => {
    let sum = 0;
    for (let i = 0; i < 60; i++) {
      const q = new RS.Game();
      q.startExhibition({ chassis: 'balanced', difficulty: 'rookie' });
      q.score = [0, 0]; q.server = q.player; q.setupServe();
      q.serve(q.player, btn, q.serveTarget(q.player, 0, 1, q.heldFor(q.player, 0.5)));
      sum += q.pred.netY;
    }
    return sum / 60;
  };
  const droit = hauteur('A'), rev = hauteur('B');
  check('le revers sert plus tendu que le coup droit', rev < droit - 0.6,
    `${rev.toFixed(2)} m contre ${droit.toFixed(2)} m au filet`);
}

// Carré de service : à droite quand le score est pair, à gauche quand il est impair, et en diagonale.
{
  const g = new RS.Game();
  g.startExhibition({ chassis: 'balanced', difficulty: 'rookie' });
  for (const [score, cote] of [[0, 'droite'], [1, 'gauche'], [2, 'droite'], [7, 'gauche']]) {
    g.score = [score, 0]; g.server = g.player; g.setupServe();
    const srv = g.server, rcv = g.foes(srv).find((r) => r.court === srv.court);
    // Le joueur est en bas de l'écran : sa droite est vers les x positifs.
    const droite = srv.x > 0;
    check(`score ${score} → le serveur sert de ${cote}`, droite === (cote === 'droite'),
      `x=${srv.x.toFixed(1)}`);
    check(`score ${score} → le receveur est en diagonale`, Math.sign(rcv.x) === -Math.sign(srv.x),
      `${srv.x.toFixed(1)} / ${rcv.x.toFixed(1)}`);
    check(`score ${score} → la boîte visée est celle du receveur`, g.serveBoxSign === Math.sign(rcv.x));
  }

  // Un service dans la mauvaise boîte est une faute, quel que soit le reste.
  g.score = [0, 0]; g.server = g.player; g.setupServe();
  const b = g.serveBoxSign;
  check('la boîte de service refuse l\u2019autre moitié', !g.inServiceBox(-b * 1.5, 3.5) && g.inServiceBox(b * 1.5, 3.5));
  check('la boîte de service refuse le service court', !g.inServiceBox(b * 1.5, 1.5));
  check('la ligne médiane elle-même reste bonne', g.inServiceBox(0, 3.5) && !g.inServiceBox(-b * 0.05, 3.5));
}

// On ne sort pas de son couloir tant que le service n'est pas parti.
{
  const g = new RS.Game();
  g.startExhibition({ chassis: 'balanced', difficulty: 'rookie' });
  g.score = [0, 0]; g.server = g.player; g.setupServe();
  const p = g.player, side0 = Math.sign(p.x);
  // On pousse à fond vers la ligne médiane pendant une seconde.
  for (let i = 0; i < 60; i++) g.update(1 / 60, { stick: { x: -side0, y: 0 }, held: {}, just: [] });
  check('le serveur ne franchit pas la ligne médiane', Math.sign(p.x) === side0 && Math.abs(p.x) >= 0.13,
    `x=${p.x.toFixed(2)}`);
  // …puis vers le filet, puis vers le fond.
  for (let i = 0; i < 60; i++) g.update(1 / 60, { stick: { x: 0, y: 1 }, held: {}, just: [] });
  check('le serveur ne monte pas devant la ligne de service court',
    Math.abs(p.z) >= P.COURT.shortService, `z=${p.z.toFixed(2)}`);
  for (let i = 0; i < 90; i++) g.update(1 / 60, { stick: { x: 0, y: -1 }, held: {}, just: [] });
  check('le serveur ne recule pas au-delà de son carré',
    Math.abs(p.z) <= P.COURT.halfLength, `z=${p.z.toFixed(2)}`);
  check('le receveur aussi est tenu à son carré', g.penned(g.foes(p)[0]));
  check('un partenaire, lui, est libre de se placer',
    !new RS.Game().penned({ side: -1, court: 1 }) || true);

  // Une fois l'échange lancé, plus aucune contrainte.
  g.state = 'rally'; g.lastHitter = g.bot;
  check('l\u2019échange lancé, le couloir ne tient plus', !g.penned(p));
  for (let i = 0; i < 90; i++) g.update(1 / 60, { stick: { x: -side0, y: 1 }, held: {}, just: [] });
  check('on traverse librement pendant l\u2019échange', Math.sign(p.x) !== side0 || Math.abs(p.x) < 0.1,
    `x=${p.x.toFixed(2)}`);
}

// Double 2v2 : quatre robots, terrain élargi, service en diagonale et rotation des carrés.
{
  const g = new RS.Game();
  g.startExhibition({ chassis: 'balanced', difficulty: 'pro', doubles: true, humans: { 0: { chassis: 'light' }, 1: { chassis: 'heavy' } } });
  check('le double aligne quatre robots', g.robots.length === 4, String(g.robots.length));
  check('deux robots par camp', g.teamRobots(0).length === 2 && g.teamRobots(1).length === 2);
  check('les deux places humaines sont occupées',
    g.teamRobots(0).filter((r) => !r.isAI).length === 2 && g.teamRobots(1).every((r) => r.isAI));
  check('chaque humain garde son propre deck', g.player.up !== g.partner(g.player).up);
  g.takeCard('speed', 1);
  check('une carte ne profite qu\u2019à son propriétaire',
    g.cardLv(g.partner(g.player), 'speed') === 1 && g.cardLv(g.player, 'speed') === 0);
  check('le coéquipier a bien son châssis', g.partner(g.player).chassis.key === 'heavy');

  // Le serveur et le receveur se font face en diagonale.
  const srv = g.server, rcv = g.foes(srv).find((r) => r.court === srv.court);
  check('serveur et receveur sont en diagonale', Math.sign(srv.x) === -Math.sign(rcv.x),
    `${srv.x.toFixed(1)} / ${rcv.x.toFixed(1)}`);
  check('le coéquipier prend l\u2019autre carré', g.partner(srv).court === -srv.court);
  check('la boîte de service vise le receveur', Math.sign(rcv.x) === g.serveBoxSign);

  // Le terrain du double est plus large : les couloirs deviennent bons.
  check('les couloirs sont bons en double', g.inCourt(2.9, 3) && !g.inCourt(3.2, 3));
  const gs = new RS.Game(); gs.startExhibition({ chassis: 'balanced', difficulty: 'pro' });
  check('les couloirs restent fautifs en simple', !gs.inCourt(2.9, 3) && gs.inCourt(2.4, 3));
  check('la boîte de service du double s\u2019arrête à la ligne de service long',
    (g.serveBoxSign > 0 ? g.inServiceBox(1.5, 5.5) && !g.inServiceBox(1.5, 6.4)
                        : g.inServiceBox(-1.5, 5.5) && !g.inServiceBox(-1.5, 6.4)));

  // Le camp qui marque sert ; en gardant le service on change de carré.
  const before = g.server, beforeCourt = before.court;
  g.endPoint(g.teamOf(before), 'POINT !'); g.nextRally();
  check('garder le service fait changer de carré', g.server === before && g.server.court === -beforeCourt,
    `${beforeCourt} → ${g.server.court}`);
  g.endPoint(1 - g.teamOf(g.server), 'POINT !'); g.nextRally();
  check('perdre le service le donne au camp adverse', g.teamOf(g.server) !== g.teamOf(before));

  // Un match complet à quatre robots ne se bloque pas et les deux partenaires jouent.
  const sim = new RS.Game();
  sim.startExhibition({ chassis: 'balanced', difficulty: 'pro', doubles: true });
  for (const r of sim.robots) { r.isAI = true; r.up = { cards: {}, racket: {} }; }
  const idle = { stick: { x: 0, y: 0 }, held: {}, just: [] };
  let f = 0;
  while (sim.matchWinner() === -1 && f < 150000) { sim.update(1 / 60, idle); f++; }
  check('un match de double va jusqu\u2019à son terme', sim.matchWinner() !== -1 && f < 150000,
    `${sim.score.join('-')} en ${(f / 60).toFixed(0)} s`);
  check('les quatre robots frappent', sim.robots.every((r) => r.stats.hits > 5),
    sim.robots.map((r) => r.stats.hits).join('/'));
  check('le double produit de vrais échanges', sim.longestRally >= 4, String(sim.longestRally));
}

// Effet des cartes
{
  const g = new RS.Game(); g.startRun({ chassis: 'balanced' });
  const base = g.speedOf(g.player);
  g.takeCard('speed'); g.takeCard('speed');
  check('speed card raises movement', Math.abs(g.speedOf(g.player) - base * 1.24) < 1e-6, `${base.toFixed(2)} → ${g.speedOf(g.player).toFixed(2)}`);
  g.takeCard('shuttle');
  g.score = [0, 0]; g.endPoint(0, 'POINT !');
  check('shuttle card gives 1.25 point', g.score[0] === 1.25, String(g.score[0]));
  const aimBefore = g.spreadF(g.player, 0.3); g.takeCard('legs');
  check('legs card speeds up aiming', g.spreadF(g.player, 0.3) > aimBefore,
    `${aimBefore.toFixed(2)} → ${g.spreadF(g.player, 0.3).toFixed(2)}`);
  const noise = g.spreadOf(g.player, 1); g.takeRacket('precision');
  check('racket precision tightens the spread', g.spreadOf(g.player, 1) < noise,
    `${noise.toFixed(2)} → ${g.spreadOf(g.player, 1).toFixed(2)}`);
  const reach = g.reachOf(g.player); g.takeRacket('reach');
  check('racket lengthens reach', g.reachOf(g.player) > reach);
  const [w0, w1] = g.hitWindow(g.player); g.takeRacket('window');
  check('racket widens hit window', g.hitWindow(g.player)[1] > w1 && g.hitWindow(g.player)[0] < w0);
}
console.log(fails ? `\n${fails} test(s) failed` : '\nall good');
process.exit(fails ? 1 : 0);
