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

  /* ------------------------------------------------------------------ atlas RG-B1 */
  const ATLAS = root.SPRITE_ATLAS;
  // Sprites en l'air : l'ancre « pieds » n'a pas de sens, on centre horizontalement.
  const CENTER_ANCHOR = { jump: true, smash_hit: true };
  const SHUTTLE_ANGLES = 16;

  function hslOf(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    return [h / 6, sat, l];
  }
  function rgbOf(h, sat, l) {
    if (sat === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
  }

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
      this.atlases = {};                                   // une planche par robot : { img, frames, tints }
      this.shuttleFrames = null;
      for (const key in (ATLAS || {})) {
        const img = new Image();
        img.onload = () => { this.atlases[key] = { img, frames: ATLAS[key].frames, tints: new Map() }; if (key === 'rg-b1') this.buildShuttleFrames(); };
        img.src = ATLAS[key].png;
      }
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
      this.scale = h > w ? w / 192 : h / 192;
      this.bw = Math.round(w / this.scale); this.bh = Math.ceil(h / this.scale);
      this.buf.width = this.bw; this.buf.height = this.bh;
      this.area = { top: area.top / this.scale, bottom: area.bottom / this.scale };
      this.setupCamera();
      this.courtDirty = true;
    }

    setupCamera() {
      // Fausse perspective façon Game Boy : profondeur écrasée, léger rétrécissement vers le fond,
      // hauteur du volant en pixels fixes. Les personnages gardent la même taille partout.
      const L = COURT.halfLength;
      const portrait = this.bh > this.bw;
      const areaH = Math.max(80, this.area.bottom - this.area.top);
      const maxW = portrait ? this.bw - 14 : this.bw * 0.5;          // en paysage, la croix et les boutons sont sur les côtés
      this.KX = maxW / 2 / COURT.halfWidthDoubles;                  // px par mètre en largeur (ligne de fond proche)
      this.SHRINK = 0.14;                                           // rétrécissement de la ligne de fond éloignée
      const depthPx = areaH - 56;                                   // 24 px pour tribunes + tête du bot, 32 px pour le robot proche
      this.KZ = Math.min(depthPx / (2 * L + 2.6), this.KX * 0.6);   // px par mètre en profondeur
      this.KY = Math.max(6, Math.round(this.KZ * 1.2));             // px par mètre en hauteur
      this.cx = Math.floor(this.bw / 2);
      const courtPx = (2 * L + 2.6) * this.KZ;
      this.baseY = Math.round(this.area.top + 24 + (areaH - 56 - courtPx) / 2 + courtPx); // y écran de z = -L-1.3
    }

    project(x, y, z) {
      const L = COURT.halfLength;
      const t = clamp((z + L) / (2 * L), -0.3, 1.3);
      const d = 1 - this.SHRINK * t;
      const s = this.KX * d;
      return { x: this.cx + x * s + this.shakeX, y: this.baseY - (z + L + 1.3) * this.KZ - y * this.KY + this.shakeY, s };
    }
    px(x, y, z) { const p = this.project(x, y, z); return { x: Math.round(p.x), y: Math.round(p.y), s: p.s }; }

    /* ---------------------------------------------------------------- atlas : teintes et volant */
    /** Copie de l'atlas où les verts du châssis prennent la teinte demandée (le bot, ou un autre châssis). */
    tinted(sheet, color) {
      const a = this.atlases[sheet];
      if (!color) return a.img;
      let c = a.tints.get(color);
      if (c) return c;
      c = document.createElement('canvas'); c.width = a.img.width; c.height = a.img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(a.img, 0, 0);
      const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
      const n = parseInt(color.slice(1), 16);
      const [th, ts] = hslOf((n >> 16) & 255, (n >> 8) & 255, n & 255);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const [h, sat, l] = hslOf(d[i], d[i + 1], d[i + 2]);
        if (sat < 0.1 || h < 0.18 || h > 0.5) continue;      // seuls les verts du châssis changent
        const [r, g, b] = rgbOf(th, Math.min(1, Math.max(sat, ts * 0.55)), Math.min(0.8, l * 1.1));
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      ctx.putImageData(id, 0, 0);
      a.tints.set(color, c);
      return c;
    }

    /** Copie blanche de l'atlas : sert à faire briller un robot (charge prête, jauge pleine). */
    silhouette(sheet) {
      const a = this.atlases[sheet];
      if (!a) return null;
      if (a.glow) return a.glow;
      const c = document.createElement('canvas'); c.width = a.img.width; c.height = a.img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(a.img, 0, 0);
      const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 128) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 245; } }
      ctx.putImageData(id, 0, 0);
      a.glow = c;
      return c;
    }

    buildShuttleFrames() {
      const a = this.atlases['rg-b1'];
      const f = a.frames.shuttle;
      const base = document.createElement('canvas'); base.width = f.w; base.height = f.h;
      const bctx = base.getContext('2d');
      bctx.translate(f.w, 0); bctx.scale(-1, 1);            // le sprite pointe à gauche → base pointant à droite
      bctx.drawImage(a.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      const size = Math.ceil(Math.hypot(f.w, f.h)) + 2;
      this.shuttleFrames = [];
      for (let i = 0; i < SHUTTLE_ANGLES; i++) {
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.translate(size / 2, size / 2); ctx.rotate(i / SHUTTLE_ANGLES * Math.PI * 2);
        ctx.drawImage(base, -f.w / 2, -f.h / 2);
        this.shuttleFrames.push(c);
      }
      this.shuttleSize = size;
    }

    /** Comme drawSprite, mais incliné : pivot à mi-hauteur du corps (plongeon). */
    drawSpriteRot(sheet, name, x, y, flip, src, ang) {
      const a = this.atlases[sheet];
      const f = a && a.frames[name];
      if (!f) return;
      const b = this.bctx;
      const ax = CENTER_ANCHOR[name] ? Math.round(f.w / 2) : f.ax;
      b.save();
      b.translate(Math.round(x), Math.round(y - f.h / 2));
      b.rotate(ang);
      if (flip) b.scale(-1, 1);
      b.drawImage(src || a.img, f.x, f.y, f.w, f.h, flip ? -(f.w - ax) : -ax, -f.h / 2, f.w, f.h);
      b.restore();
    }

    /** Dessine un sprite de l'atlas, ancre (pieds) en (x, y). flip = miroir horizontal. */
    drawSprite(sheet, name, x, y, flip, src) {
      const a = this.atlases[sheet];
      const f = a && a.frames[name];
      if (!f) return;
      const b = this.bctx;
      const ax = CENTER_ANCHOR[name] ? Math.round(f.w / 2) : f.ax;
      const img = src || a.img;
      if (flip) {
        b.save(); b.translate(x, 0); b.scale(-1, 1);
        b.drawImage(img, f.x, f.y, f.w, f.h, -(f.w - ax), y - f.ay, f.w, f.h);
        b.restore();
      } else {
        b.drawImage(img, f.x, f.y, f.w, f.h, x - ax, y - f.ay, f.w, f.h);
      }
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
        this.drawRobot(game.bot, game);
        if (s.z >= 0) { this.drawTrail(s); this.drawShuttle(s); }
        b.drawImage(this.netLayer, this.shakeX, this.shakeY);
        if (s.z < 0) { this.drawTrail(s); this.drawShuttle(s); }
        this.drawRobot(game.player, game);
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
      ctx.fillStyle = PAL.stand; ctx.fillRect(0, hz.y - 18, this.bw, 18);
      ctx.fillStyle = PAL.outline; ctx.fillRect(0, hz.y - 19, this.bw, 1);
      for (let y = hz.y - 16; y < hz.y - 2; y += 4) {
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
      // Filet de badminton : la maille pend depuis la bande blanche et s'arrête bien au-dessus du sol
      // (760 mm de chute réglementaires), contrairement à un filet de tennis qui touche le sol.
      const n = this.netLayer; n.width = this.bw; n.height = this.bh;
      const nctx = n.getContext('2d');
      const NET_DROP = 0.76;
      const xl = this.px(-W, 0, 0).x, xr = this.px(W, 0, 0).x;
      const yTop = this.px(0, COURT.netHeight, 0).y;
      const yMesh = this.px(0, Math.max(0, COURT.netHeight - NET_DROP), 0).y;
      const yGround = this.px(0, 0, 0).y;
      // maille fine : un point sombre un pixel sur deux, le terrain reste lisible au travers
      for (let y = yTop + 2; y <= yMesh; y++) {
        for (let x = xl; x <= xr; x++) {
          if ((x + y) % 2) continue;
          nctx.fillStyle = '#252b33';
          nctx.fillRect(x, y, 1, 1);
        }
      }
      // bande blanche du haut, bordée de sombre
      nctx.fillStyle = PAL.outline; nctx.fillRect(xl - 1, yTop - 2, xr - xl + 3, 1);
      nctx.fillStyle = PAL.white; nctx.fillRect(xl, yTop - 1, xr - xl + 1, 3);
      nctx.fillStyle = PAL.outline; nctx.fillRect(xl, yTop + 2, xr - xl + 1, 1);
      // poteaux : eux descendent jusqu'au sol
      for (const q of [xl, xr]) {
        nctx.fillStyle = PAL.outline; nctx.fillRect(q - 1, yTop - 3, 3, yGround - yTop + 4);
        nctx.fillStyle = PAL.post; nctx.fillRect(q, yTop - 3, 1, yGround - yTop + 3);
      }
    }

    /** Zone d'arrivée du volant (carte Optique prédictive) : large et floue au premier niveau, précise au troisième. */
    drawLanding(l, lv) {
      const b = this.bctx;
      const p = this.px(l.x, 0, l.z);
      const rm = [0, 1.1, 0.7, 0.35][Math.min(3, lv)];
      const rx = rm * this.KX, ry = rm * this.KZ;
      b.save();
      b.strokeStyle = lv >= 3 ? '#68f878' : '#f8d848';
      b.globalAlpha = 0.5 + 0.25 * Math.sin(this.time * 6);
      b.lineWidth = 1;
      b.beginPath(); b.ellipse(p.x + 0.5, p.y + 0.5, Math.max(2, rx), Math.max(1, ry), 0, 0, Math.PI * 2); b.stroke();
      if (lv >= 3) { b.globalAlpha = 1; b.fillStyle = '#68f878'; b.fillRect(p.x - 2, p.y, 5, 1); b.fillRect(p.x, p.y - 1, 1, 3); }
      b.restore();
    }

    drawShadow(s) {
      const b = this.bctx;
      const p = this.px(s.x, 0, s.z);
      b.fillStyle = PAL.shadow;
      b.fillRect(p.x - 2, p.y - 1, 5, 1); b.fillRect(p.x - 3, p.y, 7, 1); b.fillRect(p.x - 2, p.y + 1, 5, 1);
    }

    drawSweet(r) {
      const st = r.hold || r.act;
      if (!st) return;
      const b = this.bctx;
      const p = this.px(r.x, 0, r.z - r.side * RS.SWEET);
      b.fillStyle = SHOT_COLORS[st.shot] || (st.btn === 'B' ? SHOT_COLORS.clear : SHOT_COLORS.drive);
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
      if (!this.shuttleFrames) { b.fillStyle = PAL.white; b.fillRect(p.x - 2, p.y - 2, 5, 5); return; }
      const sp = Math.hypot(s.vx, s.vy, s.vz);
      let ang = Math.PI / 2;                                  // immobile : bouchon vers le bas
      if (sp > 0.5) {
        const q = this.project(s.x + s.vx / sp * 0.5, s.y + s.vy / sp * 0.5, s.z + s.vz / sp * 0.5);
        const pp = this.project(s.x, s.y, s.z);
        ang = Math.atan2(q.y - pp.y, q.x - pp.x);
      }
      const i = ((Math.round(ang / (Math.PI * 2) * SHUTTLE_ANGLES) % SHUTTLE_ANGLES) + SHUTTLE_ANGLES) % SHUTTLE_ANGLES;
      const half = Math.floor(this.shuttleSize / 2);
      b.drawImage(this.shuttleFrames[i], p.x - half, p.y - half);
    }

    /** Choisit le sprite et son orientation selon l'état du robot. */
    robotPose(r, game) {
      const front = r.side > 0;                     // le bot nous fait face, le joueur est vu de dos
      const swingU = r.swing > 0 ? 1 - r.swing / 0.3 : -1;
      let name = null, flip = false;
      const t = this.time;
      if (game.state === 'point' && game.pointWinner) {
        name = game.pointWinner === r ? 'win' : 'miss';
        if (game.pointWinner === r && Math.floor(t * 4) % 2) name = 'idle';
      } else if (game.state === 'end' && game.winner != null) {
        name = (game.winner === 0) === !r.isAI ? 'win' : 'lose';
      } else if (swingU >= 0) {
        const sh = r.swingShot;
        if (sh === 'smash') name = r.jumpT > 0 ? (swingU < 0.35 ? 'jump' : swingU < 0.75 ? 'smash_hit' : 'land') : (swingU < 0.6 ? 'smash_hit' : 'land');
        else if (sh === 'serve') name = 'serve';
        else if (sh === 'drop') name = swingU < 0.55 ? 'hit_low' : 'follow';
        else if (sh === 'drive') name = swingU < 0.55 ? 'hit_mid' : 'follow';
        else name = swingU < 0.55 ? 'hit_high' : 'follow';
        flip = !front;                              // joueur : raquette côté droit
      } else if (r.hold) {
        name = game.chargeOf(r) >= 0 ? 'smash_prep' : 'prep';
        flip = !front;
      } else if (game.state === 'serve' && game.server === r) {
        name = front ? 'idle' : 'back';
      } else {
        const sp = Math.hypot(r.vx, r.vz);
        if (sp > 0.5) {
          const lateral = Math.abs(r.vx) > 0.3 * Math.abs(r.vz);
          const fast = sp > 5.2;
          const ph = Math.floor(r.walk * 3) % 2;
          if (lateral || front) { name = (fast ? 'run' : 'walk') + (ph ? '1' : '2'); flip = r.vx < 0; if (!lateral && front) flip = r.vz > 0; }
          else name = 'back';
        } else name = front ? 'idle' : 'back';
      }
      return { name, flip };
    }

    drawRobot(r, game) {
      const b = this.bctx;
      const p = this.px(r.x, 0, r.z);
      // ombre au sol
      b.fillStyle = PAL.shadow;
      b.fillRect(p.x - 6, p.y - 1, 13, 1); b.fillRect(p.x - 8, p.y, 17, 1); b.fillRect(p.x - 6, p.y + 1, 13, 1);
      const sheet = r.sheet || 'rg-b1';
      if (!this.atlases[sheet]) return;

      // plongeon : détente inclinée, puis le robot reste au sol avant de se relever
      if (r.dive) {
        const d = r.dive, L = RS.DIVE_LUNGE, G = RS.DIVE_GROUND;
        const flip = d.dx < 0;
        const sign = flip ? -1 : 1;
        let ang, air, name;
        if (d.t < L) { const u = d.t / L; ang = Math.min(1, u * 1.7) * Math.PI / 2; air = Math.round(Math.sin(Math.PI * u) * 7); name = 'hit_low'; }
        else if (d.t < L + G) { ang = Math.PI / 2; air = 0; name = 'lose'; }
        else { ang = Math.PI / 2 * (1 - (d.t - L - G) / RS.DIVE_RISE); air = 0; name = 'lose'; }
        const srcD = this.tinted(sheet, r.tint ? r.color : null);
        this.drawSpriteRot(sheet, name, p.x, p.y - air, flip, srcD, ang * sign * (flip ? -1 : 1));
        if (d.t >= L && Math.floor(this.time * 8) % 2) this.text('!', p.x, p.y - 26, PAL.white, 8, true);
        return;
      }

      const jump = r.jumpT > 0 ? Math.round(Math.sin(Math.PI * (1 - r.jumpT / RS.JUMP_TIME)) * 14) : 0;
      let bob = (!r.hold && r.swing <= 0 && Math.hypot(r.vx, r.vz) > 0.5 && r.side < 0) ? (Math.floor(r.walk * 3) % 2) : 0;
      if (r.hover) bob += Math.round(Math.sin(this.time * 6) * 1.5) + 2;   // vol stationnaire
      const { name, flip } = this.robotPose(r, game);
      const src = this.tinted(sheet, r.tint ? r.color : null);
      const sy = p.y - jump - bob;
      const charge = game.chargeOf(r);
      // Jauge SUPER pleine : aura discrète. Smash chargé à bloc : le robot clignote en blanc.
      if (r.energy >= RS.MAX_ENERGY) {
        const g = this.silhouette(sheet);
        b.save(); b.globalAlpha = 0.18 + 0.14 * Math.sin(this.time * 7);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) this.drawSprite(sheet, name, p.x + dx, sy + dy, flip, g);
        b.restore();
      }
      this.drawSprite(sheet, name, p.x, sy, flip, src);
      if (charge >= 1 && Math.floor(this.time * 12) % 2) {
        const g = this.silhouette(sheet);
        b.save(); b.globalAlpha = 0.75;
        this.drawSprite(sheet, name, p.x, sy, flip, g);
        b.restore();
      }

      // barre de charge du smash (joueur) : n'apparaît qu'une fois le temps mort passé
      if (!r.isAI && charge >= 0) {
        b.fillStyle = PAL.outline; b.fillRect(p.x - 8, p.y + 3, 16, 4);
        b.fillStyle = charge >= 1 ? LEVEL_COLORS[2] : LEVEL_COLORS[1]; b.fillRect(p.x - 7, p.y + 4, Math.round(14 * charge), 2);
      }
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
