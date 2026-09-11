/* Pilote scripté partagé par les harnais en ligne : il court sur le volant, vise et relâche. */
(() => {
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
})();
