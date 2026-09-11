// Vérifie la couche réseau sans réseau : un hôte simule, un invité ne reçoit que des instantanés
// et doit rester collé à la partie de l'hôte, terrain retourné compris.
import { readFileSync } from 'node:fs';
for (const f of ['physics', 'game']) new Function(readFileSync(new URL(`../src/${f}.js`, import.meta.url), 'utf8')).call(globalThis);
const RS = globalThis.RogueShuttle;

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

const HUMANS = { 0: { chassis: 'balanced' }, 1: { chassis: 'light' } };
const idle = () => ({ stick: { x: 0, y: 0 }, held: {}, just: [] });

// ---------------------------------------------------------------- aller-retour de l'instantané
{
  const g = new RS.Game();
  g.startExhibition({ chassis: 'balanced', difficulty: 'pro', doubles: true });
  for (let i = 0; i < 600; i++) g.update(1 / 60, idle());
  const snap = g.snapshot(7);
  check('l’instantané tient dans la limite de présence',
    JSON.stringify(snap).length < 3000, `${JSON.stringify(snap).length} octets`);
  check('l’instantané ne contient que des nombres finis', snap.every(Number.isFinite));

  const copy = new RS.Game();
  copy.startExhibition({ chassis: 'balanced', difficulty: 'pro', doubles: true });
  const got = copy.applySnapshot(snap, [0, 1, 2, 3], false, false);
  check('le numéro de séquence revient', got.seq === 7);
  check('le volant est restitué au centimètre',
    Math.abs(copy.shuttle.x - g.shuttle.x) < 0.011 && Math.abs(copy.shuttle.y - g.shuttle.y) < 0.011
      && Math.abs(copy.shuttle.z - g.shuttle.z) < 0.011,
    `${copy.shuttle.z.toFixed(2)} vs ${g.shuttle.z.toFixed(2)}`);
  check('le score et l’état sont restitués',
    copy.score[0] === g.score[0] && copy.score[1] === g.score[1] && copy.state === g.state,
    `${copy.score.join('-')} ${copy.state}`);
  check('le serveur est restitué', copy.robots.indexOf(copy.server) === g.robots.indexOf(g.server));
  check('les quatre robots sont restitués',
    g.robots.every((r, i) => Math.abs(copy.robots[i].x - r.x) < 0.011 && Math.abs(copy.robots[i].z - r.z) < 0.011));
}

// ---------------------------------------------------------------- duel : l'invité joue en bas, chez lui
{
  const host = new RS.Game();
  host.startExhibition({ chassis: 'balanced', difficulty: 'pro', humans: HUMANS });
  const guest = new RS.Game();
  guest.startExhibition({ chassis: 'light', difficulty: 'pro', humans: { 0: { chassis: 'light' }, 1: { chassis: 'balanced' } } });
  const MAP = [1, 0];   // chez l'invité, le robot 0 est le robot 1 de l'hôte

  check('chacun se voit dans son camp', host.player.side === -1 && guest.player.side === -1);
  check('les châssis suivent leur joueur',
    host.player.chassis.key === 'balanced' && guest.player.chassis.key === 'light'
      && host.robots[1].chassis.key === 'light' && guest.robots[1].chassis.key === 'balanced');

  // Une manette scriptée : elle court sur le point d'interception, appuie, tient, relâche.
  const brain = (HOLD) => {
    let hold = null;
    return (g, r) => {
      const inp = idle();
      const aim = (t) => ({ x: Math.abs(t.x - r.x) > 0.15 ? Math.sign(t.x - r.x) : 0,
                            y: Math.abs(t.z - RS.SWEET * r.side - r.z) > 0.15 ? Math.sign(t.z - RS.SWEET * r.side - r.z) : 0 });
      if (hold) {
        if (g.time < hold.until) { inp.held[hold.btn] = true; return inp; }
        hold = null; return inp;                       // image de relâchement
      }
      if (g.state === 'serve' && g.server === r) {
        inp.just.push('A'); inp.held.A = true; hold = { btn: 'A', until: g.time + HOLD }; return inp;
      }
      if (g.state !== 'rally' || !g.pred || g.lastHitter === r || r.dive) return inp;
      const info = g.interceptInfo(r);
      const t = (info && info.point) || g.pred.landing;
      inp.stick = aim(t);
      const tc = (t.t || 0) - g.shuttle.t, mid = (RS.SWING_HIT0 + RS.SWING_HIT1) / 2;
      if (r.swing <= 0 && tc <= mid + HOLD && tc > -0.05) {
        const btn = t.x >= r.x ? 'A' : 'B';
        inp.just.push(btn); inp.held[btn] = true;
        hold = { btn, until: g.time + Math.max(0, Math.min(HOLD, tc - mid)) };
      }
      return inp;
    };
  };
  const brainH = brain(0.28), brainG = brain(0.28);   // mêmes réflexes des deux côtés : l'écart mesure le réseau

  let seq = 0, worstShuttle = 0, worstSelf = 0, worstFoe = 0, samples = 0;
  const errs = [], selfErrs = [];
  const LAG = Number(process.env.NETLAG == null ? 5 : process.env.NETLAG);   // images de latence dans chaque sens
  const toHost = [], toGuest = [];
  // NETDEBUG=1 détaille pourquoi les points tombent : c'est par là qu'on règle la compensation.
  const dbg = process.env.NETDEBUG ? { why: {}, land: [], swings: 0, rels: 0 } : null;
  if (dbg) {
    const ep = host.endPoint.bind(host);
    host.endPoint = (t, why) => { const k = `${why} → ${t === 0 ? 'hôte' : 'invité'}`; dbg.why[k] = (dbg.why[k] || 0) + 1; return ep(t, why); };
    const hi = host.hit.bind(host);
    host.hit = (r, d) => { const o = hi(r, d); if (r === host.robots[1]) dbg.land.push(`${host.robots[1].swingShot}@(${host.pred.landing.x.toFixed(1)},${host.pred.landing.z.toFixed(1)})${host.pred.net ? 'NET' : ''}`); return o; };
    const ss = host.startSwing.bind(host);
    host.startSwing = (r, o) => { if (r === host.robots[1]) dbg.swings++; return ss(r, o); };
    const nr = host.netRelease.bind(host);
    host.netRelease = (...a) => { dbg.rels++; return nr(...a); };
  }

  for (let f = 0; f < 5400; f++) {
    // --- l'invité joue chez lui et envoie ce qu'il a fait ---
    const gi = brainG(guest, guest.player);
    guest.netOut.length = 0;
    guest.updateRemote(1 / 60, gi, (1 / 60) * (guest.diff.tempo || 1));
    const ux = -guest.player.aimX, uz = -guest.player.dirZ;      // repère de l'hôte : terrain retourné
    toHost.push({ at: f + LAG, ax: ux, az: uz, evts: guest.netOut.slice() });

    // --- l'hôte simule ---
    for (const m of toHost) {
      if (m.at !== f) continue;
      const r = host.robots[1];
      r.netLag = LAG / 60;
      host.netAim(r, m.ax, m.az);
      for (const e of m.evts) {
        if (e.k === 'p') host.netPress(r, e.btn, LAG / 60);
        else host.netRelease(r, e.btn, e.held, -e.ux, -e.uz, LAG / 60);
      }
    }
    host.update(1 / 60, brainH(host, host.player));
    if (f % 2 === 0) toGuest.push({ at: f + LAG, s: host.snapshot(++seq) });

    // --- l'invité reçoit ---
    for (const m of toGuest) if (m.at === f) guest.applySnapshot(m.s, MAP, true, true, LAG / 60);

    if (host.state === 'rally' && f > LAG * 4) {
      samples++;
      const ds = Math.hypot(guest.shuttle.x + host.shuttle.x, guest.shuttle.z + host.shuttle.z);
      errs.push(ds);
      worstShuttle = Math.max(worstShuttle, ds);
      const dm = Math.hypot(guest.player.x + host.robots[1].x, guest.player.z + host.robots[1].z);
      selfErrs.push(dm); worstSelf = Math.max(worstSelf, dm);
      worstFoe = Math.max(worstFoe, Math.hypot(guest.robots[1].x + host.player.x, guest.robots[1].z + host.player.z));
    }
  }
  check('le duel en ligne produit de vrais échanges', host.longestRally >= 3 && host.score[0] + host.score[1] >= 3,
    `${host.score.join('-')} · échange max ${host.longestRally}`);
  check('l\u2019invité voit le même score', guest.score[0] === host.score[0] && guest.score[1] === host.score[1],
    `${guest.score.join('-')} vs ${host.score.join('-')}`);
  // Le pic est irréductible : juste après une frappe, l'invité prolonge encore l'ancienne trajectoire
  // le temps d'un aller simple. Ce qui compte est que l'écart soit bref, donc on mesure la queue.
  errs.sort((a, b) => a - b);
  const pct = (q) => errs[Math.floor(errs.length * q)] || 0;
  check('l\u2019invité voit le volant au bon endroit', pct(0.5) < 0.2 && pct(0.9) < 0.8,
    `médiane ${pct(0.5).toFixed(2)} m · 90e ${pct(0.9).toFixed(2)} m · 99e ${pct(0.99).toFixed(2)} m · pic ${worstShuttle.toFixed(2)} m sur ${samples} images`);
  selfErrs.sort((a, b) => a - b);
  const spct = (q) => selfErrs[Math.floor(selfErrs.length * q)] || 0;
  check('l\u2019invité voit son propre robot au bon endroit', spct(0.5) < 0.2 && spct(0.95) < 0.8,
    `médiane ${spct(0.5).toFixed(2)} m · 95e ${spct(0.95).toFixed(2)} m · pic ${worstSelf.toFixed(2)} m`);
  check('l\u2019invité voit l\u2019adversaire au bon endroit', worstFoe < 0.9, `écart max ${worstFoe.toFixed(2)} m`);
  check('l\u2019invité a bien frappé le volant', host.robots[1].stats.hits > 5, `${host.robots[1].stats.hits} frappes`);
  check('les deux joueurs marquent', host.score[0] > 0 && host.score[1] > 0, host.score.join('-'));
  // Le réseau ne doit pas écarter l'invité du jeu : il doit frapper presque autant que l'hôte.
  const hh = host.player.stats.hits, gh = host.robots[1].stats.hits;
  check('l\u2019invité joue autant que l\u2019hôte', Math.abs(hh - gh) / Math.max(hh, gh) < 0.25,
    `${hh} frappes contre ${gh}`);
  check('les ratés restent comparables des deux côtés',
    host.robots[1].stats.whiffs <= host.player.stats.whiffs + 11,
    `${host.player.stats.whiffs} contre ${host.robots[1].stats.whiffs}`);
  if (dbg) {
    console.log('   · hôte  ', JSON.stringify(host.player.stats));
    console.log('   · invité', JSON.stringify(host.robots[1].stats), `${dbg.rels} relâchements → ${dbg.swings} gestes`);
    console.log('   · points', JSON.stringify(dbg.why));
    console.log('   · chutes', dbg.land.slice(0, 18).join(' '));
  }
}

// ---------------------------------------------------------------- coop : deux humains du même côté
{
  const host = new RS.Game();
  host.startExhibition({ chassis: 'balanced', difficulty: 'pro', doubles: true, humans: HUMANS });
  const guest = new RS.Game();
  guest.startExhibition({ chassis: 'light', difficulty: 'pro', doubles: true,
                          humans: { 0: { chassis: 'light' }, 1: { chassis: 'balanced' } } });
  const MAP = [2, 1, 0, 3];   // l'invité occupe la place 1, donc le robot 2 de l'hôte
  check('la coop met les deux humains du même côté',
    host.robots.filter((r) => !r.isAI).every((r) => r.side === -1) && host.robots.filter((r) => r.isAI).length === 2);
  check('chacun se voit en robot 0 dans son camp', guest.player.side === -1 && guest.player.chassis.key === 'light');
  for (let f = 0; f < 900; f++) {
    host.update(1 / 60, idle());
    if (f % 2 === 0) guest.applySnapshot(host.snapshot(f), MAP, false, true, 0);
    guest.updateRemote(1 / 60, idle(), 1 / 60);
  }
  const pairs = [[0, 2], [1, 1], [2, 0], [3, 3]];
  const worst = Math.max(...pairs.map(([li, ci]) => Math.hypot(guest.robots[li].x - host.robots[ci].x, guest.robots[li].z - host.robots[ci].z)));
  check('la table de correspondance place chaque robot', worst < 0.8, `écart max ${worst.toFixed(2)} m`);
  check('l’invité suit le volant en coop',
    Math.hypot(guest.shuttle.x - host.shuttle.x, guest.shuttle.z - host.shuttle.z) < 1.2);
}

console.log(fails ? `\n${fails} test(s) failed` : '\nall good');
process.exit(fails ? 1 : 0);
