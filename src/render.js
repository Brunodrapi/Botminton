/* Rogue Shuttle — rendu pixel art façon Game Boy Color : petit tampon basse résolution
 * dessiné à l'échelle entière, sprites de robots, police pixel, caméra quasi orthographique. */
(function (root) {
  'use strict';
  const P = root.Physics;
  const COURT = P.COURT;
  const RS = root.RogueShuttle;

  const FONT = '"Press Start 2P", monospace';
  const PAL = {
    hall: '#1c2438', hallDark: '#141a2c', stand: '#2a3450', crowdA: '#5a6a90', crowdB: '#8898c0', crowdC: '#c8b060',
    apron: '#2c7048', court: '#48b060', courtLight: '#58c070', line: '#f8f0d8',
    net: '#f0f0e0', post: '#f8f0d8', shadow: '#1e4030', outline: '#101420', white: '#f8f8f0',
  };
  const SHOT_COLORS = { clear: '#78d0f8', drop: '#c8f880', smash: '#f86868', drive: '#f8d060', serve: '#f8f8f0' };
  const LEVEL_COLORS = ['#f85858', '#f8d848', '#68f878'];

  const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ------------------------------------------------------------------ sprites */
  const HEAD_BACK = [
    '....kkkkkk....',
    '...kllllllk...',
    '...kggggggk...',
    '...kgggggkk...',
    '...kkkkkkkk...',
  ];
  const HEAD_FRONT = [
    '....kkkkkk....',
    '...kggggggk...',
    '...kvvvvvvk...',
    '...kggggggk...',
    '...kkkkkkkk...',
  ];
  const TORSO_BACK = [
    '....kddddk....',
    '..kkbbbbbbkk..',
    '.kbkbbbbbbkbk.',
    '.kbkbhhhhbkbk.',
    '.kbkbhhhhbkbk.',
    '.kbkbbbbbbkbk.',
    '.kkkbbbbbbkkk.',
    '...kbbbbbbk...',
    '...kkkkkkkk...',
  ];
  const TORSO_FRONT = [
    '....kddddk....',
    '..kkbbbbbbkk..',
    '.kbkbbbbbbkbk.',
    '.kbkbbllbbkbk.',
    '.kbkbbllbbkbk.',
    '.kbkbbbbbbkbk.',
    '.kkkbbbbbbkkk.',
    '...kbbbbbbk...',
    '...kkkkkkkk...',
  ];
  const LEGS_IDLE = [
    '..kddk..kddk..',
    '..kddk..kddk..',
    '..kddk..kddk..',
    '..kddk..kddk..',
    '.kbbbk..kbbbk.',
    '.kkkkk..kkkkk.',
  ];
  const LEGS_RUN_A = [
    '..kddk..kddk..',
    '..kddk..kddk..',
    '.kbbbk..kddk..',
    '.kkkkk..kddk..',
    '........kbbbk.',
    '........kkkkk.',
  ];
  const LEGS_RUN_B = LEGS_RUN_A.map((r) => r.split('').reverse().join(''));
  const RACKET_UP = [
    '..kkkkk..',
    '.krsrsrk.',
    '.krrrrrk.',
    '.krsrsrk.',
    '..kkkkk..',
    '....k....',
    '...knk...',
    '...knk...',
    '....k....',
  ];
  const SHUTTLE_DOWN = [
    '.kkkkk.',
    'klllllk',
    'klllllk',
    '.kklkk.',
    '..kck..',
    '..kck..',
    '...k...',
  ];
  const SHUTTLE_UP = SHUTTLE_DOWN.slice().reverse();

  function rotate90(rows) { // sens horaire
    const h = rows.length, w = rows[0].length;
    const out = [];
    for (let x = 0; x < w; x++) { let s = ''; for (let y = h - 1; y >= 0; y--) s += rows[y][x]; out.push(s); }
    return out;
  }
  const RACKET_RIGHT = rotate90(RACKET_UP);
  const RACKET_DOWN = rotate90(RACKET_RIGHT);
  const RACKET_LEFT = rotate90(RACKET_DOWN);

  function hexMul(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * k)), g = Math.min(255, Math.round(((n >> 8) & 255) * k)), b = Math.min(255, Math.round((n & 255) * k));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.buf = document.createElement('canvas');
      this.bctx = this.buf.getContext('2d');
      this.netLayer = document.createElement('canvas');
      this.courtLayer = document.createElement('canvas');
      this.w = 0; this.h = 0; this.dpr = 1; this.scale = 2;
      this.area = { top: 0, bottom: 0 };
      this.spriteCache = new Map();
      this.shakeX = 0; this.shakeY = 0;
      this.time = 0;
      this.fontReady = false;
      if (document.fonts && document.fonts.load) document.fonts.load('8px "Press Start 2P"').then(() => { this.fontReady = true; this.courtDirty = true; }).catch(() => {});
    }

    resize(w, h, area) {
      this.w = w; this.h = h;
      this.dpr = Math.min(3, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      const areaH = Math.max(120, area.bottom - area.top);
      this.scale = clamp(Math.round(Math.min(w / 190, areaH / 250)), 2, 6);
      this.bw = Math.ceil(w / this.scale); this.bh = Math.ceil(h / this.scale);
      this.buf.width = this.bw; this.buf.height = this.bh;
      this.area = { top: area.top / this.scale, bottom: area.bottom / this.scale };
      this.setupCamera();
      this.courtDirty = true;
    }

    setupCamera() {
      const portrait = this.bh > this.bw;
      this.cam = portrait
        ? { pos: { x: 0, y: 30, z: -34 }, look: { x: 0, y: 0.2, z: 0.6 } }
        : { pos: { x: 0, y: 26, z: -36 }, look: { x: 0, y: 0.4, z: 0.4 } };
      const c = this.cam.pos, l = this.cam.look;
      const f = norm({ x: l.x - c.x, y: l.y - c.y, z: l.z - c.z });
      const r = norm(cross({ x: 0, y: 1, z: 0 }, f)); // droite = +x monde à droite de l'écran
      const u = cross(f, r);
      this.basis = { f, r, u };
      const pts = [];
      for (const x of [-3.5, 3.5]) for (const z of [-7.4, 7.2]) pts.push({ x, y: 0, z });
      pts.push({ x: 0, y: 3.2, z: 7.2 }); pts.push({ x: 0, y: 1.2, z: -7.4 });
      let maxRx = 0, maxRy = -Infinity, minRy = Infinity;
      for (const p of pts) {
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
        const zc = dx * f.x + dy * f.y + dz * f.z;
        const xc = dx * r.x + dy * r.y + dz * r.z;
        const yc = dx * u.x + dy * u.y + dz * u.z;
        maxRx = Math.max(maxRx, Math.abs(xc / zc));
        maxRy = Math.max(maxRy, yc / zc);
        minRy = Math.min(minRy, yc / zc);
      }
      const margin = 3;
      const availW = this.bw - 2 * margin;
      const availH = Math.max(60, this.area.bottom - this.area.top - 2 * margin);
      this.f = Math.min(availW / 2 / maxRx, availH / (maxRy - minRy));
      this.cx = this.bw / 2;
      const extra = availH - this.f * (maxRy - minRy);
      this.cy = this.area.top + margin + extra / 2 + this.f * maxRy;
    }

    project(x, y, z) {
      const c = this.cam.pos, b = this.basis;
      const dx = x - c.x, dy = y - c.y, dz = z - c.z;
      const zc = dx * b.f.x + dy * b.f.y + dz * b.f.z;
      const xc = dx * b.r.x + dy * b.r.y + dz * b.r.z;
      const yc = dx * b.u.x + dy * b.u.y + dz * b.u.z;
      const s = this.f / Math.max(0.5, zc);
      return { x: this.cx + xc * s + this.shakeX, y: this.cy - yc * s + this.shakeY, s };
    }
    px(x, y, z) { const p = this.project(x, y, z); return { x: Math.round(p.x), y: Math.round(p.y), s: p.s }; }

    /* ---------------------------------------------------------------- sprites */
    sprite(key, rows, palette, flip) {
      const id = key + '|' + (flip ? 'f' : 'n') + '|' + Object.values(palette).join(',');
      let c = this.spriteCache.get(id);
      if (c) return c;
      const h = rows.length, w = rows[0].length;
      c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        ctx.fillStyle = palette[ch] || '#ff00ff';
        ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
      }
      this.spriteCache.set(id, c);
      return c;
    }

    robotPalette(r) {
      const col = r.color || r.chassis.color;
      const heat = r.heat / 100;
      const hot = r.overheat > 0 ? '#f83030' : heat > 0.5 ? (heat > 0.8 ? '#f87030' : '#f8c040') : hexMul(col, 0.5);
      return { k: PAL.outline, b: col, d: hexMul(col, 0.55), l: '#f4f4e8', g: '#a0a8bc', v: r.accent || '#f8f870', h: hot };
    }

    /* ---------------------------------------------------------------- frame */
    draw(game, dt) {
      this.time += dt;
      this.gameTime = game.time;
      const b = this.bctx;
      b.imageSmoothingEnabled = false;
      if (game.shake > 0) { const k = game.shake * 12; this.shakeX = Math.round((Math.random() - 0.5) * k); this.shakeY = Math.round((Math.random() - 0.5) * k); }
      else { this.shakeX = 0; this.shakeY = 0; }
      if (this.courtDirty) { this.buildCourt(); this.courtDirty = false; }

      b.drawImage(this.courtLayer, this.shakeX, this.shakeY);
      if (game.state !== 'menu') {
        const s = game.shuttle;
        if (game.assist && game.pred && game.state === 'rally' && game.lastHitter && game.lastHitter.isAI && !game.pred.net) this.drawLanding(game.pred.landing);
        this.drawShadow(s);
        this.drawSweet(game.player);
        this.drawRobot(game.bot);
        if (s.z >= 0) { this.drawTrail(s); this.drawShuttle(s); }
        b.drawImage(this.netLayer, this.shakeX, this.shakeY);
        if (s.z < 0) { this.drawTrail(s); this.drawShuttle(s); }
        this.drawRobot(game.player);
        this.drawFx(game);
        this.drawMessage(game);
      } else {
        b.drawImage(this.netLayer, 0, 0);
      }

      const ctx = this.ctx;
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PAL.hallDark;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.buf, 0, 0, this.bw * this.scale * this.dpr, this.bh * this.scale * this.dpr);
    }

    fillPoly(ctx, pts, fill, stroke) {
      ctx.beginPath();
      pts.forEach((p, i) => { const q = this.px(p[0], p[1], p[2]); if (i) ctx.lineTo(q.x + 0.5, q.y + 0.5); else ctx.moveTo(q.x + 0.5, q.y + 0.5); });
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }
    pxLine(ctx, a, b, color) {
      const p = this.px(a[0], a[1], a[2]), q = this.px(b[0], b[1], b[2]);
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x + 0.5, p.y + 0.5); ctx.lineTo(q.x + 0.5, q.y + 0.5); ctx.stroke();
    }

    buildCourt() {
      const c = this.courtLayer; c.width = this.bw; c.height = this.bh;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const L = COURT.halfLength, W = COURT.halfWidthDoubles, Ws = COURT.halfWidthSingles;
      ctx.fillStyle = PAL.hallDark; ctx.fillRect(0, 0, this.bw, this.bh);
      // tribunes derrière le fond de court adverse
      const hz = this.px(0, 0, L + 1.3);
      ctx.fillStyle = PAL.stand; ctx.fillRect(0, hz.y - 24, this.bw, 24);
      ctx.fillStyle = PAL.outline; ctx.fillRect(0, hz.y - 25, this.bw, 1);
      for (let y = hz.y - 22; y < hz.y - 2; y += 4) {
        for (let x = (y / 4) % 2 ? 1 : 3; x < this.bw; x += 4) {
          ctx.fillStyle = [PAL.crowdA, PAL.crowdB, PAL.crowdC][((x * 7 + y * 13) >> 2) % 3];
          ctx.fillRect(x, y, 2, 2);
        }
      }
      ctx.fillStyle = PAL.hall; ctx.fillRect(0, hz.y, this.bw, this.bh - hz.y);
      this.fillPoly(ctx, [[-W - 1.2, 0, -L - 1.3], [W + 1.2, 0, -L - 1.3], [W + 1.2, 0, L + 1.3], [-W - 1.2, 0, L + 1.3]], PAL.apron, PAL.outline);
      this.fillPoly(ctx, [[-W, 0, -L], [W, 0, -L], [W, 0, L], [-W, 0, L]], PAL.court);
      // bandes claires alternées, façon gazon tondu
      for (let z = -L; z < L; z += 2.68) {
        if (Math.round((z + L) / 2.68) % 2) this.fillPoly(ctx, [[-W, 0, z], [W, 0, z], [W, 0, Math.min(L, z + 2.68)], [-W, 0, Math.min(L, z + 2.68)]], PAL.courtLight);
      }
      const ln = PAL.line;
      this.fillPoly(ctx, [[-W, 0, -L], [W, 0, -L], [W, 0, L], [-W, 0, L]], null, ln);
      this.pxLine(ctx, [-Ws, 0, -L], [-Ws, 0, L], ln);
      this.pxLine(ctx, [Ws, 0, -L], [Ws, 0, L], ln);
      for (const sgn of [-1, 1]) {
        this.pxLine(ctx, [-W, 0, sgn * COURT.shortService], [W, 0, sgn * COURT.shortService], ln);
        this.pxLine(ctx, [-W, 0, sgn * COURT.longServiceDoubles], [W, 0, sgn * COURT.longServiceDoubles], ln);
        this.pxLine(ctx, [0, 0, sgn * COURT.shortService], [0, 0, sgn * L], ln);
      }
      // filet (calque séparé, dessiné entre les deux robots)
      const n = this.netLayer; n.width = this.bw; n.height = this.bh;
      const nctx = n.getContext('2d');
      const a = this.px(-W, 0, 0), bb = this.px(W, 0, 0), t = this.px(-W, COURT.netHeight, 0), t2 = this.px(W, COURT.netHeight, 0);
      const top = Math.min(t.y, t2.y), bottom = Math.max(a.y, bb.y);
      for (let y = top; y <= bottom; y++) {
        const k = (y - top) / Math.max(1, bottom - top);
        const xl = Math.round(t.x + (a.x - t.x) * k), xr = Math.round(t2.x + (bb.x - t2.x) * k);
        for (let x = xl; x <= xr; x++) if ((x + y) % 2 === 0) { nctx.fillStyle = PAL.net; nctx.fillRect(x, y, 1, 1); }
      }
      nctx.fillStyle = PAL.white; nctx.fillRect(t.x, top - 1, t2.x - t.x + 1, 2);
      nctx.fillStyle = PAL.outline; nctx.fillRect(t.x, top - 2, t2.x - t.x + 1, 1);
      for (const q of [t, t2]) { nctx.fillStyle = PAL.outline; nctx.fillRect(q.x - 1, top - 3, 3, bottom - top + 4); nctx.fillStyle = PAL.post; nctx.fillRect(q.x, top - 3, 1, bottom - top + 3); }
    }

    drawLanding(l) {
      const b = this.bctx;
      const p = this.px(l.x, 0, l.z);
      if (Math.floor(this.time * 6) % 2) return;
      b.fillStyle = '#f8f8f0';
      b.fillRect(p.x - 3, p.y, 7, 1); b.fillRect(p.x, p.y - 2, 1, 5);
    }

    drawShadow(s) {
      const b = this.bctx;
      const p = this.px(s.x, 0, s.z);
      b.fillStyle = PAL.shadow;
      b.fillRect(p.x - 2, p.y - 1, 5, 1); b.fillRect(p.x - 3, p.y, 7, 1); b.fillRect(p.x - 2, p.y + 1, 5, 1);
    }

    drawSweet(r) {
      if (!r.armed) return;
      const b = this.bctx;
      const p = this.px(r.x, 0, r.z - r.side * RS.SWEET);
      b.fillStyle = SHOT_COLORS[r.armed.shot] || PAL.white;
      b.fillRect(p.x - 2, p.y, 5, 1); b.fillRect(p.x, p.y - 2, 1, 5);
    }

    drawTrail(s) {
      if (s.trail.length < 3) return;
      const b = this.bctx;
      for (let i = 0; i < s.trail.length - 1; i += 2) {
        const t = s.trail[i];
        const p = this.px(t.x, t.y, t.z);
        b.fillStyle = i < s.trail.length / 2 ? '#f8d060' : '#f8f0a0';
        b.fillRect(p.x - 1, p.y - 1, 3, 3);
      }
    }

    drawShuttle(s) {
      const b = this.bctx;
      const p = this.px(s.x, s.y, s.z);
      const rows = s.vy < -0.5 ? SHUTTLE_DOWN : SHUTTLE_UP;
      const img = this.sprite(s.vy < -0.5 ? 'shD' : 'shU', rows, { l: PAL.white, k: PAL.outline, c: '#e8c890' }, false);
      b.drawImage(img, p.x - 3, p.y - 3);
    }

    drawRobot(r) {
      const b = this.bctx;
      const p = this.px(r.x, 0, r.z);
      const front = r.side > 0;
      const pal = this.robotPalette(r);
      // ombre
      b.fillStyle = PAL.shadow;
      b.fillRect(p.x - 5, p.y - 1, 11, 1); b.fillRect(p.x - 6, p.y, 13, 1); b.fillRect(p.x - 5, p.y + 1, 11, 1);

      const moving = Math.hypot(r.vx, r.vz) > 0.5;
      const frame = moving ? (Math.floor(r.walk * 3) % 2 ? LEGS_RUN_A : LEGS_RUN_B) : LEGS_IDLE;
      const rows = (front ? HEAD_FRONT : HEAD_BACK).concat(front ? TORSO_FRONT : TORSO_BACK, frame);
      const key = (front ? 'F' : 'B') + (moving ? (frame === LEGS_RUN_A ? 'a' : 'b') : 'i');
      const img = this.sprite(key, rows, pal, false);
      const ox = p.x - 7, oy = p.y - 20;
      if (r.overheat > 0 && Math.floor(this.time * 10) % 2) b.globalAlpha = 0.6;
      b.drawImage(img, ox, oy);
      b.globalAlpha = 1;

      // raquette : main droite = à droite du sprite pour le joueur (vu de dos), à gauche pour le bot (de face)
      const dir = front ? -1 : 1;
      const handX = p.x + dir * 6, handY = oy + 10;
      let rk, rx, ry;
      const rpal = { k: PAL.outline, r: '#f0f0e8', s: '#8890a8', n: '#6a4a30' };
      if (r.swing > 0) {
        const u = 1 - r.swing / 0.3;
        const low = r.swingShot === 'drop' || r.swingShot === 'serve';
        if (low) { rk = u < 0.5 ? RACKET_DOWN : (dir > 0 ? RACKET_RIGHT : RACKET_LEFT); rx = handX + dir * (u < 0.5 ? 0 : 3) - 4; ry = u < 0.5 ? handY + 2 : handY - 2; }
        else if (u < 0.3) { rk = RACKET_UP; rx = handX - 4; ry = oy - 9; }
        else if (u < 0.65) { rk = dir > 0 ? RACKET_RIGHT : RACKET_LEFT; rx = handX + dir * 4 - 4; ry = oy - 2; }
        else { rk = RACKET_DOWN; rx = handX + dir * 2 - 4; ry = handY + 1; }
      } else if (r.armed) {
        rk = RACKET_UP; rx = handX + dir * 2 - 4; ry = oy - 8 + (Math.floor(this.time * 8) % 2);
      } else {
        rk = dir > 0 ? RACKET_RIGHT : RACKET_LEFT; rx = handX + dir * 3 - 4; ry = handY + 3;
      }
      const rkey = rk === RACKET_UP ? 'rU' : rk === RACKET_DOWN ? 'rD' : rk === RACKET_RIGHT ? 'rR' : 'rL';
      b.drawImage(this.sprite(rkey, rk, rpal, false), Math.round(rx), Math.round(ry));

      // barre de charge pendant l'armement
      if (r.armed && !r.isAI) {
        const k = clamp((this.gameTime - r.armed.t0) / RS.CHARGE_TIME, 0, 1);
        b.fillStyle = PAL.outline; b.fillRect(p.x - 7, p.y + 3, 14, 4);
        b.fillStyle = k >= 1 ? LEVEL_COLORS[2] : LEVEL_COLORS[1]; b.fillRect(p.x - 6, p.y + 4, Math.round(12 * k), 2);
      }
      if (r.overheat > 0) this.text('OVERHEAT', p.x, oy - 12, '#f83030', 8, true);
    }

    text(str, x, y, color, size, center, outline) {
      const b = this.bctx;
      b.font = `${size}px ${FONT}`;
      b.textBaseline = 'top';
      b.textAlign = center ? 'center' : 'left';
      x = Math.round(x); y = Math.round(y);
      if (outline !== false) {
        b.fillStyle = PAL.outline;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) b.fillText(str, x + dx, y + dy);
      }
      b.fillStyle = color;
      b.fillText(str, x, y);
    }

    drawFx(game) {
      for (const f of game.fx) {
        const p = this.px(f.x, f.y, f.z);
        const u = f.t / f.life;
        if (u > 0.7 && Math.floor(u * 30) % 2) continue; // clignote avant de disparaître
        const size = f.size >= 20 ? 8 : 8;
        this.text(f.text, p.x, p.y - Math.round(u * 14) - 8, f.color, size, true);
      }
    }

    drawMessage(game) {
      const m = game.message;
      if (!m) return;
      const y = Math.round(this.area.top + (this.area.bottom - this.area.top) * 0.42);
      const col = m.good === undefined ? PAL.white : m.good ? LEVEL_COLORS[2] : LEVEL_COLORS[0];
      const b = this.bctx;
      b.font = `8px ${FONT}`;
      const w = Math.ceil(Math.max(b.measureText(m.text).width, m.sub ? b.measureText(m.sub).width : 0)) + 12;
      b.fillStyle = PAL.outline; b.fillRect(Math.round(this.cx - w / 2) - 1, y - 6, w + 2, m.sub ? 30 : 20);
      b.fillStyle = '#f0e6c8'; b.fillRect(Math.round(this.cx - w / 2), y - 5, w, m.sub ? 28 : 18);
      this.text(m.text, this.cx, y, col === PAL.white ? PAL.outline : col, 8, true, col !== PAL.outline && col !== PAL.white);
      if (m.sub) this.text(m.sub, this.cx, y + 12, PAL.outline, 8, true, false);
    }
  }

  root.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
