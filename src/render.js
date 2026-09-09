/* Rogue Shuttle — rendu canvas 2D avec une caméra perspective derrière le joueur. */
(function (root) {
  'use strict';
  const P = root.Physics;
  const COURT = P.COURT;
  const RS = root.RogueShuttle;

  const SHOT_COLORS = { clear: '#7dd3ff', drop: '#c6ff8a', smash: '#ff6b6b', drive: '#ffd166', serve: '#ffffff' };
  const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = 0; this.h = 0; this.dpr = 1;
      this.area = { top: 0, bottom: 0 };
      this.shakeX = 0; this.shakeY = 0;
      this.time = 0;
    }

    resize(w, h, area) {
      this.w = w; this.h = h;
      this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.area = area;
      this.setupCamera();
    }

    setupCamera() {
      const portrait = this.h > this.w;
      this.cam = portrait
        ? { pos: { x: 0, y: 9.0, z: -13.5 }, look: { x: 0, y: 0.3, z: 0.8 } }
        : { pos: { x: 0, y: 7.5, z: -14.0 }, look: { x: 0, y: 0.5, z: 0.6 } };
      const c = this.cam.pos, l = this.cam.look;
      const f = norm({ x: l.x - c.x, y: l.y - c.y, z: l.z - c.z });
      const r = norm(cross(f, { x: 0, y: 1, z: 0 }));
      const u = cross(r, f);
      this.basis = { f, r, u };
      // Ajuste la focale pour que le terrain (avec marge) tienne dans la zone réservée.
      const pts = [];
      for (const x of [-3.6, 3.6]) for (const z of [-7.6, 7.3]) pts.push({ x, y: 0, z });
      pts.push({ x: 0, y: 2.6, z: 7.0 }); pts.push({ x: 0, y: 2.0, z: -3.5 });
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
      const margin = 6;
      const availW = this.w - 2 * margin;
      const availH = Math.max(120, this.area.bottom - this.area.top - 2 * margin);
      const fx = availW / 2 / maxRx;
      const fy = availH / (maxRy - minRy);
      this.f = Math.min(fx, fy);
      this.cx = this.w / 2;
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

    poly(pts, fill, stroke, lw) {
      const ctx = this.ctx;
      ctx.beginPath();
      pts.forEach((p, i) => { const q = this.project(p[0], p[1], p[2]); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
    }

    line(a, b, color, lw) {
      const ctx = this.ctx;
      const p = this.project(a[0], a[1], a[2]), q = this.project(b[0], b[1], b[2]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
      ctx.strokeStyle = color; ctx.lineWidth = lw || 2; ctx.stroke();
    }

    /* ------------------------------------------------------------------ frame */
    draw(game, dt) {
      this.time += dt;
      const ctx = this.ctx;
      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      if (game.shake > 0) { const k = game.shake * 30; this.shakeX = (Math.random() - 0.5) * k; this.shakeY = (Math.random() - 0.5) * k; }
      else { this.shakeX = 0; this.shakeY = 0; }

      this.drawBackground();
      this.drawCourt();
      const inMatch = game.state !== 'menu';
      if (inMatch) {
        if (game.assist && game.pred && game.state === 'rally' && game.lastHitter && game.lastHitter.isAI && !game.pred.net) this.drawLanding(game.pred.landing, game.player.color);
        const s = game.shuttle;
        this.drawShadow(s);
        this.drawArmedRing(game.player);
        this.drawRobot(game.bot, game);
        if (s.z >= 0) { this.drawTrail(s); this.drawShuttle(s); }
        this.drawNet();
        if (s.z < 0) { this.drawTrail(s); this.drawShuttle(s); }
        this.drawRobot(game.player, game);
        this.drawFx(game);
        this.drawMessage(game);
      } else {
        this.drawNet();
      }
      ctx.restore();
    }

    drawBackground() {
      const ctx = this.ctx;
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, '#0a0d1c'); g.addColorStop(0.5, '#121a33'); g.addColorStop(1, '#0b0f1e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
      // sol de la salle : tout ce qui est sous l'horizon
      const hz = this.project(0, 0, 60);
      ctx.fillStyle = '#151c33'; ctx.fillRect(0, hz.y, this.w, this.h - hz.y);
      // ligne d'horizon lumineuse
      const g2 = ctx.createLinearGradient(0, hz.y - 60, 0, hz.y + 10);
      g2.addColorStop(0, 'rgba(90,120,255,0)'); g2.addColorStop(1, 'rgba(90,120,255,0.18)');
      ctx.fillStyle = g2; ctx.fillRect(0, hz.y - 60, this.w, 70);
    }

    drawCourt() {
      const L = COURT.halfLength, W = COURT.halfWidthDoubles, Ws = COURT.halfWidthSingles;
      // tapis autour du terrain
      this.poly([[-W - 1.2, 0, -L - 1.4], [W + 1.2, 0, -L - 1.4], [W + 1.2, 0, L + 1.4], [-W - 1.2, 0, L + 1.4]], '#1d3a4a');
      this.poly([[-W, 0, -L], [W, 0, -L], [W, 0, L], [-W, 0, L]], '#2a8f6c');
      const c = 'rgba(255,255,255,0.92)';
      const lw = 2;
      // contour double
      this.poly([[-W, 0, -L], [W, 0, -L], [W, 0, L], [-W, 0, L]], null, c, lw);
      // lignes de côté simple
      this.line([-Ws, 0, -L], [-Ws, 0, L], c, lw);
      this.line([Ws, 0, -L], [Ws, 0, L], c, lw);
      // lignes de service court / long double
      for (const sgn of [-1, 1]) {
        this.line([-W, 0, sgn * COURT.shortService], [W, 0, sgn * COURT.shortService], c, lw);
        this.line([-W, 0, sgn * COURT.longServiceDoubles], [W, 0, sgn * COURT.longServiceDoubles], c, lw);
        this.line([0, 0, sgn * COURT.shortService], [0, 0, sgn * L], c, lw);
      }
      // ligne du filet au sol
      this.line([-W, 0, 0], [W, 0, 0], 'rgba(255,255,255,0.35)', 1);
    }

    drawNet() {
      const ctx = this.ctx;
      const W = COURT.halfWidthDoubles, H = COURT.netHeight;
      this.poly([[-W, 0, 0], [W, 0, 0], [W, H, 0], [-W, H, 0]], 'rgba(220,230,255,0.16)');
      // mailles
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
      for (let x = -W; x <= W + 0.01; x += 0.5) this.line([x, 0.02, 0], [x, H, 0], 'rgba(255,255,255,0.12)', 1);
      for (let y = 0.25; y < H; y += 0.25) this.line([-W, y, 0], [W, y, 0], 'rgba(255,255,255,0.10)', 1);
      // bande blanche
      this.line([-W, H, 0], [W, H, 0], '#ffffff', 4);
      // poteaux
      for (const x of [-W, W]) this.line([x, 0, 0], [x, H + 0.05, 0], '#c9d2ff', 4);
    }

    drawLanding(l, color) {
      const ctx = this.ctx;
      const p = this.project(l.x, 0, l.z);
      const r = 0.3 * p.s;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    drawShadow(s) {
      const ctx = this.ctx;
      const p = this.project(s.x, 0, s.z);
      const sc = Math.max(p.s, 40);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.45 * clamp(1 - s.y / 5, 0.15, 1)).toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.12 * sc, 0.05 * sc, 0, 0, Math.PI * 2); ctx.fill();
    }

    drawArmedRing(r) {
      if (!r.armed) return;
      const ctx = this.ctx;
      const p = this.project(r.x, 0, r.z - r.side * RS.SWEET);
      const col = SHOT_COLORS[r.armed.shot] || '#fff';
      ctx.save();
      ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.45 * p.s, 0.45 * p.s * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    drawTrail(s) {
      if (s.trail.length < 2) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < s.trail.length; i++) {
        const a = this.project(s.trail[i - 1].x, s.trail[i - 1].y, s.trail[i - 1].z);
        const b = this.project(s.trail[i].x, s.trail[i].y, s.trail[i].z);
        ctx.strokeStyle = 'rgba(255,200,120,' + (0.6 * i / s.trail.length).toFixed(2) + ')';
        ctx.lineWidth = 1 + 4 * i / s.trail.length;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }

    drawShuttle(s) {
      const ctx = this.ctx;
      const p = this.project(s.x, s.y, s.z);
      const sc = Math.max(p.s, 58);
      const sp = Math.hypot(s.vx, s.vy, s.vz);
      let ang = -Math.PI / 2;
      if (sp > 0.5) {
        const q = this.project(s.x + s.vx / sp * 0.3, s.y + s.vy / sp * 0.3, s.z + s.vz / sp * 0.3);
        ang = Math.atan2(q.y - p.y, q.x - p.x);
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      // jupe (plumes)
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(80,80,110,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0.02 * sc, -0.045 * sc); ctx.lineTo(-0.17 * sc, -0.12 * sc); ctx.lineTo(-0.17 * sc, 0.12 * sc); ctx.lineTo(0.02 * sc, 0.045 * sc);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,120,150,0.5)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-0.16 * sc, -0.06 * sc); ctx.moveTo(0, 0); ctx.lineTo(-0.16 * sc, 0.06 * sc); ctx.stroke();
      // bouchon
      ctx.fillStyle = '#f2e6c8'; ctx.strokeStyle = '#6b5a3a';
      ctx.beginPath(); ctx.arc(0.05 * sc, 0, 0.05 * sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    roundRect(x, y, w, h, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    drawRobot(r, game) {
      const ctx = this.ctx;
      const p = this.project(r.x, 0, r.z);
      const s = p.s;
      const front = r.side > 0;            // le bot nous fait face
      const col = r.color || r.chassis.color, acc = r.accent || r.chassis.accent;
      const heat = r.heat / 100;
      const over = r.overheat > 0;
      const body = front ? '#3b3f52' : '#4a4f66';
      const dark = '#20232f';

      // ombre au sol
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.42 * s, 0.15 * s, 0, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      if (over) { ctx.shadowColor = 'rgba(255,60,40,0.9)'; ctx.shadowBlur = 18 + 8 * Math.sin(this.time * 20); }
      else if (heat > 0.7) { ctx.shadowColor = 'rgba(255,140,40,' + ((heat - 0.7) * 2).toFixed(2) + ')'; ctx.shadowBlur = 12; }

      const moving = Math.hypot(r.vx, r.vz) > 0.4;
      const ph = r.walk * Math.PI * 2;
      // jambes
      for (const i of [-1, 1]) {
        const lift = moving ? Math.max(0, Math.sin(ph + (i > 0 ? 0 : Math.PI))) * 0.10 * s : 0;
        const lx = p.x + i * 0.19 * s;
        ctx.fillStyle = dark;
        this.roundRect(lx - 0.09 * s, p.y - 0.62 * s, 0.18 * s, 0.62 * s - lift, 0.05 * s); ctx.fill();
        ctx.fillStyle = col;
        this.roundRect(lx - 0.11 * s, p.y - 0.10 * s - lift, 0.22 * s, 0.10 * s, 0.03 * s); ctx.fill();
      }
      // torse
      const bob = moving ? Math.abs(Math.sin(ph)) * 0.03 * s : 0;
      const ty = p.y - 1.32 * s - bob;
      const g = ctx.createLinearGradient(p.x - 0.3 * s, 0, p.x + 0.3 * s, 0);
      g.addColorStop(0, body); g.addColorStop(0.5, '#6a7090'); g.addColorStop(1, body);
      ctx.fillStyle = g;
      this.roundRect(p.x - 0.32 * s, ty, 0.64 * s, 0.72 * s, 0.10 * s); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, 0.02 * s);
      this.roundRect(p.x - 0.32 * s, ty, 0.64 * s, 0.72 * s, 0.10 * s); ctx.stroke();
      if (front) {
        // poitrine lumineuse
        ctx.fillStyle = col;
        this.roundRect(p.x - 0.12 * s, ty + 0.12 * s, 0.24 * s, 0.10 * s, 0.03 * s); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        this.roundRect(p.x - 0.22 * s, ty + 0.32 * s, 0.44 * s, 0.28 * s, 0.05 * s); ctx.fill();
      } else {
        // radiateur dorsal (chauffe)
        const hc = over ? '#ff3b3b' : heat > 0.5 ? `rgb(255,${Math.round(190 - 150 * (heat - 0.5) * 2)},60)` : '#5a6178';
        ctx.fillStyle = hc;
        for (let i = 0; i < 4; i++) { this.roundRect(p.x - 0.20 * s + i * 0.11 * s, ty + 0.16 * s, 0.07 * s, 0.4 * s, 0.02 * s); ctx.fill(); }
      }
      // tête
      const hy = ty - 0.36 * s;
      ctx.fillStyle = body;
      this.roundRect(p.x - 0.21 * s, hy, 0.42 * s, 0.32 * s, 0.08 * s); ctx.fill();
      ctx.strokeStyle = col; this.roundRect(p.x - 0.21 * s, hy, 0.42 * s, 0.32 * s, 0.08 * s); ctx.stroke();
      if (front) {
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = 8;
        this.roundRect(p.x - 0.15 * s, hy + 0.10 * s, 0.30 * s, 0.09 * s, 0.03 * s); ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = acc; ctx.lineWidth = Math.max(1, 0.02 * s);
        ctx.beginPath(); ctx.moveTo(p.x + 0.12 * s, hy); ctx.lineTo(p.x + 0.16 * s, hy - 0.18 * s); ctx.stroke();
        ctx.fillStyle = over ? '#ff3b3b' : col;
        ctx.beginPath(); ctx.arc(p.x + 0.16 * s, hy - 0.2 * s, 0.035 * s, 0, Math.PI * 2); ctx.fill();
      }
      // bras libre
      const offSide = front ? 1 : -1;
      ctx.fillStyle = dark;
      this.roundRect(p.x + offSide * 0.34 * s, ty + 0.08 * s, 0.11 * s, 0.5 * s, 0.04 * s); ctx.fill();

      // bras raquette
      const shoulderX = p.x - offSide * 0.36 * s, shoulderY = ty + 0.10 * s;
      let ang; // 0 = vers le bas, angles en écran (sens horaire positif)
      const mirror = front ? -1 : 1;
      if (r.swing > 0) {
        const u = 1 - r.swing / 0.3;
        const e = 1 - Math.pow(1 - u, 3);
        const low = r.swingShot === 'drop' || r.swingShot === 'serve';
        ang = low ? (-20 + 110 * e) : (-170 + 210 * e);
      } else if (r.armed) {
        ang = -160;
      } else {
        ang = -45 + Math.sin(this.time * 3) * 4;
      }
      ctx.save();
      ctx.translate(shoulderX, shoulderY);
      ctx.rotate(mirror * ang * Math.PI / 180);
      ctx.fillStyle = dark;
      this.roundRect(-0.055 * s, 0, 0.11 * s, 0.42 * s, 0.04 * s); ctx.fill();
      // raquette
      ctx.strokeStyle = '#d9dcf0'; ctx.lineWidth = Math.max(1.5, 0.035 * s);
      ctx.beginPath(); ctx.moveTo(0, 0.42 * s); ctx.lineTo(0, 0.78 * s); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.ellipse(0, 0.98 * s, 0.17 * s, 0.22 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, 0.035 * s); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 0.06 * s, 0.78 * s); ctx.lineTo(i * 0.06 * s, 1.18 * s); ctx.stroke(); }
      ctx.restore();
      ctx.restore();

      // nom / état au-dessus
      if (over) {
        ctx.fillStyle = '#ff4040'; ctx.font = `bold ${Math.max(11, 0.16 * s)}px system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('OVERHEAT', p.x, hy - 0.3 * s);
      }
    }

    drawFx(game) {
      const ctx = this.ctx;
      for (const f of game.fx) {
        const p = this.project(f.x, f.y, f.z);
        const u = f.t / f.life;
        const pop = u < 0.12 ? 1 + (0.12 - u) * 4 : 1;
        ctx.save();
        ctx.globalAlpha = 1 - Math.pow(u, 2);
        ctx.font = `900 ${Math.round(f.size * pop)}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(f.text, p.x, p.y - u * 40);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, p.x, p.y - u * 40);
        ctx.restore();
      }
    }

    drawMessage(game) {
      const m = game.message;
      if (!m) return;
      const ctx = this.ctx;
      const y = this.area.top + (this.area.bottom - this.area.top) * 0.42;
      const pop = m.t < 0.15 ? 0.7 + m.t * 2 : 1;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.round(34 * pop)}px system-ui, -apple-system, sans-serif`;
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(m.text, this.cx, y);
      ctx.fillStyle = m.good === undefined ? '#ffffff' : m.good ? '#5dff7a' : '#ff5e5e';
      ctx.fillText(m.text, this.cx, y);
      if (m.sub) {
        ctx.font = `600 15px system-ui, -apple-system, sans-serif`;
        ctx.lineWidth = 4; ctx.strokeText(m.sub, this.cx, y + 26);
        ctx.fillStyle = '#dfe6ff'; ctx.fillText(m.sub, this.cx, y + 26);
      }
      ctx.restore();
    }
  }

  root.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
