/* Rogue Shuttle — logique de jeu : robots, frappes, qualité, IA, score, Heat. */
(function (root) {
  'use strict';
  const P = root.Physics;
  const COURT = P.COURT;

  const CHASSIS = {
    light:    { key: 'light',    name: 'LIGHT',    speed: 7.0, accel: 34, smash: 0.85, heatMul: 1.35, cool: 5.0, reach: 1.10, color: '#5ef2ff', accent: '#b8fbff',
                desc: ['🟢 rapide', '🔴 chauffe vite', '🔴 smash faible'] },
    balanced: { key: 'balanced', name: 'BALANCED', speed: 5.9, accel: 26, smash: 1.0,  heatMul: 1.0,  cool: 6.5, reach: 1.15, color: '#7dff9a', accent: '#d6ffe0',
                desc: ['⚪ tout moyen'] },
    heavy:    { key: 'heavy',    name: 'HEAVY',    speed: 4.9, accel: 19, smash: 1.25, heatMul: 0.75, cool: 9.0, reach: 1.25, color: '#ffb35e', accent: '#ffe0b8',
                desc: ['🟢 énorme smash', '🟢 refroidissement', '🔴 lent'] },
  };

  const DIFFICULTY = {
    rookie: { key: 'rookie', name: 'ROOKIE', speed: 4.4, reaction: 0.42, aggression: 0.35, errorRate: 0.38, aimNoise: 1.0, posNoise: 0.45, judge: 0.5, chassis: 'balanced', color: '#ff7a5e' },
    pro:    { key: 'pro',    name: 'PRO',    speed: 5.5, reaction: 0.26, aggression: 0.6,  errorRate: 0.2,  aimNoise: 0.55, posNoise: 0.25, judge: 0.8, chassis: 'balanced', color: '#ff5e8a' },
    elite:  { key: 'elite',  name: 'ELITE',  speed: 6.3, reaction: 0.15, aggression: 0.8,  errorRate: 0.09, aimNoise: 0.3,  posNoise: 0.12, judge: 0.95, chassis: 'heavy', color: '#d05eff' },
  };
  const DIFF_ORDER = ['rookie', 'pro', 'elite'];

  const SHOT_NAMES = { clear: 'DÉGAGÉ', drop: 'AMORTI', smash: 'SMASH', drive: 'DRIVE', serve: 'SERVICE' };
  const LEVEL_NAMES = ['FAIBLE', 'OK', 'PARFAIT'];
  const LEVEL_COLORS = ['#ff5252', '#ffd54a', '#5dff7a'];

  const SWEET = 0.35;          // le point idéal de frappe est 35 cm devant le robot
  const MAX_HEAT = 100;
  const OVERHEAT_TIME = 3.0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function makeRobot(side, chassisKey, isAI) {
    return {
      side, isAI, chassis: CHASSIS[chassisKey], color: CHASSIS[chassisKey].color, accent: CHASSIS[chassisKey].accent,
      x: 0, z: side * 3.5, vx: 0, vz: 0, moveX: 0, moveZ: 0, walk: 0,
      heat: 0, overheat: 0, overheats: 0,
      armed: null, swing: 0, swingShot: null, swingLevel: 1,
      stats: { hits: 0, perfect: 0, smashes: 0, maxHeat: 0 },
      ai: { reactAt: 0, shot: null, noiseX: 0, judgedOut: false, target: null },
    };
  }

  class Game {
    constructor() {
      this.state = 'menu';
      this.time = 0;
      this.events = [];
      this.fx = [];
      this.assist = false;
      this.message = null;
      this.shuttle = { x: 0, y: 1, z: -3, vx: 0, vy: 0, vz: 0, t: 0, px: 0, py: 1, pz: -3, trail: [] };
      this.shake = 0;
      this.robots = [];
      this.score = [0, 0];
    }

    startMatch(opts) {
      this.chassisKey = opts.chassis || 'balanced';
      this.diffKey = opts.difficulty || 'rookie';
      this.diff = DIFFICULTY[this.diffKey];
      this.assist = !!opts.assist;
      this.robots = [makeRobot(-1, this.chassisKey, false), makeRobot(1, this.diff.chassis, true)];
      this.robots[1].color = this.diff.color; this.robots[1].accent = '#ffd6e6';
      this.score = [0, 0];
      this.server = this.robots[0];
      this.lastHitter = null;
      this.pred = null;
      this.rallyHits = 0;
      this.longestRally = 0;
      this.fx = [];
      this.events = [];
      this.matchTime = 0;
      this.winner = null;
      this.setupServe();
    }

    other(r) { return r === this.robots[0] ? this.robots[1] : this.robots[0]; }
    get player() { return this.robots[0]; }
    get bot() { return this.robots[1]; }

    setupServe() {
      const srv = this.server, rcv = this.other(srv);
      const even = this.score[srv === this.robots[0] ? 0 : 1] % 2 === 0;
      const serverX = -srv.side * (even ? 1 : -1) * 1.1;
      srv.x = serverX; srv.z = srv.side * 3.2; srv.vx = srv.vz = 0; srv.armed = null;
      rcv.x = -serverX; rcv.z = rcv.side * 3.6; rcv.vx = rcv.vz = 0; rcv.armed = null;
      this.serveBoxSign = Math.sign(rcv.x) || 1;
      const s = this.shuttle;
      s.x = srv.x + 0.15 * (-srv.side); s.y = 1.0; s.z = srv.z - srv.side * 0.45;
      s.vx = s.vy = s.vz = 0; s.t = 0; s.trail.length = 0;
      this.lastHitter = null;
      this.pred = null;
      this.serveInFlight = false;
      this.rallyHits = 0;
      this.state = 'serve';
      this.serveTimer = srv.isAI ? rnd(0.9, 1.5) : 0;
      this.message = srv.isAI ? { text: 'SERVICE DU BOT', sub: '', t: 0 } : { text: 'À TOI DE SERVIR', sub: 'A = long  ·  B = court', t: 0 };
    }

    /* ------------------------------------------------------------------ update */
    update(dt, input) {
      if (this.state === 'menu' || this.state === 'paused' || this.state === 'end') return;
      this.time += dt;
      this.matchTime += dt;
      if (this.message) this.message.t += dt;

      this.updatePlayerInput(input);
      this.updateAI(dt);
      for (const r of this.robots) { this.moveRobot(r, dt); this.updateHeat(r, dt); }

      const s = this.shuttle;
      if (this.state === 'serve') {
        const srv = this.server;
        // le volant suit la main du serveur
        s.x = srv.x + 0.15 * (-srv.side); s.z = srv.z - srv.side * 0.45; s.y = 1.0;
        if (srv.isAI) {
          this.serveTimer -= dt;
          if (this.serveTimer <= 0) this.serve(srv, Math.random() < 0.45 ? 'drop' : 'clear');
        } else if (input.just.length) {
          const shot = input.just[input.just.length - 1];
          this.serve(srv, shot === 'drop' ? 'drop' : 'clear');
        }
      } else if (this.state === 'rally') {
        const n = Math.max(1, Math.ceil(dt / (1 / 120)));
        const h = dt / n;
        for (let i = 0; i < n; i++) {
          s.px = s.x; s.py = s.y; s.pz = s.z;
          P.step(s, h);
          s.t += h;
          this.checkContacts();
          if (this.state !== 'rally') break;
          this.checkNetAndGround();
          if (this.state !== 'rally') break;
        }
        const sp = Math.hypot(s.vx, s.vy, s.vz);
        if (sp > 11) { s.trail.push({ x: s.x, y: s.y, z: s.z }); if (s.trail.length > 10) s.trail.shift(); }
        else if (s.trail.length) s.trail.shift();
      } else if (this.state === 'point') {
        if (s.y > 0) { s.vy -= P.G * dt; s.y = Math.max(0, s.y + s.vy * dt); s.x += s.vx * dt; s.z += s.vz * dt; }
        if (s.trail.length) s.trail.shift();
        this.pointTimer -= dt;
        if (this.pointTimer <= 0) this.nextRally();
      }

      for (const f of this.fx) f.t += dt;
      this.fx = this.fx.filter((f) => f.t < f.life);
      this.shake = Math.max(0, this.shake - dt);
    }

    updatePlayerInput(input) {
      const p = this.player;
      p.moveX = input.stick.x;
      p.moveZ = input.stick.y;       // stick vers le haut = vers le filet (+z pour le joueur)
      p.aimX = Math.abs(input.stick.x) > 0.25 ? input.stick.x : 0;
      if (this.state !== 'rally') { p.armed = null; return; }
      for (const shot of input.just) p.armed = { shot, t0: this.time, lastD: null };
      if (p.armed && !input.held[p.armed.shot]) p.armed = null;
    }

    moveRobot(r, dt) {
      let maxS = r.isAI ? this.diff.speed : r.chassis.speed;
      if (r.overheat > 0) maxS *= 0.7;
      const accel = r.isAI ? 30 : r.chassis.accel;
      let mx = r.moveX, mz = r.moveZ;
      const m = Math.hypot(mx, mz);
      if (m > 1) { mx /= m; mz /= m; }
      const dvx = mx * maxS - r.vx, dvz = mz * maxS - r.vz;
      const dv = Math.hypot(dvx, dvz), maxDv = accel * dt;
      if (dv > maxDv) { r.vx += dvx / dv * maxDv; r.vz += dvz / dv * maxDv; } else { r.vx += dvx; r.vz += dvz; }
      r.x = clamp(r.x + r.vx * dt, -3.4, 3.4);
      const zNear = r.side * 0.45, zFar = r.side * 7.6;
      r.z = clamp(r.z + r.vz * dt, Math.min(zNear, zFar), Math.max(zNear, zFar));
      r.walk += Math.hypot(r.vx, r.vz) * dt * 2.2;
      if (r.swing > 0) r.swing -= dt;
    }

    updateHeat(r, dt) {
      if (r.overheat > 0) {
        r.overheat -= dt;
        r.heat = Math.max(40, r.heat - 20 * dt);
      } else {
        r.heat = Math.max(0, r.heat - r.chassis.cool * dt);
      }
      r.stats.maxHeat = Math.max(r.stats.maxHeat, r.heat);
    }

    addHeat(r, amount) {
      if (r.overheat > 0) return;
      r.heat = clamp(r.heat + amount * r.chassis.heatMul, 0, MAX_HEAT);
      if (r.heat >= MAX_HEAT) {
        r.overheat = OVERHEAT_TIME;
        r.overheats++;
        this.events.push({ type: 'overheat', robot: r });
        this.addFx('⚠ OVERHEAT', r.x, 2.2, r.z, '#ff3b3b', 1.4, 30);
      }
    }

    /* ------------------------------------------------------------------ service */
    serve(srv, kind) {
      const s = this.shuttle;
      const rcv = this.other(srv);
      const far = -srv.side;
      const boxSign = this.serveBoxSign;
      let spec;
      const noise = srv.isAI ? this.diff.aimNoise * 0.4 : 0.25;
      if (kind === 'drop') {
        spec = { mode: 'angle', angle: 22, target: { x: boxSign * rnd(0.5, 2.0) + rnd(-noise, noise), z: far * rnd(2.45, 2.9) }, clearance: 0.12 };
      } else {
        spec = { mode: 'angle', angle: 58, target: { x: boxSign * rnd(0.4, 2.1) + rnd(-noise, noise), z: far * rnd(5.7, 6.3) }, clearance: 1.0 };
      }
      spec.from = { x: s.x, y: s.y, z: s.z };
      const plan = P.planShot(spec);
      s.vx = plan.v.vx; s.vy = plan.v.vy; s.vz = plan.v.vz; s.t = 0;
      s.px = s.x; s.py = s.y; s.pz = s.z;
      this.lastHitter = srv;
      this.pred = P.predict(s);
      this.serveInFlight = true;
      this.state = 'rally';
      this.message = null;
      srv.swing = 0.3; srv.swingShot = 'serve'; srv.swingLevel = 1;
      srv.stats.hits++;
      this.onHitFor(this.other(srv));
      this.events.push({ type: 'hit', shot: 'serve', level: 1, robot: srv });
    }

    /* ------------------------------------------------------------------ contacts */
    checkContacts() {
      const s = this.shuttle;
      for (const r of this.robots) {
        if (!r.armed || this.lastHitter === r) continue;
        if (s.z * r.side < -0.25) { r.armed.lastD = null; continue; }
        const sweetZ = r.z - r.side * SWEET;
        const d = Math.hypot(s.x - r.x, s.z - sweetZ);
        const dr = Math.hypot(s.x - r.x, s.z - r.z);
        const inReach = dr <= r.chassis.reach && s.y <= 2.6 && s.y > 0.02;
        if (!inReach) { r.armed.lastD = null; continue; }
        const a = r.armed;
        const closest = a.lastD !== null && d >= a.lastD;
        const passing = (s.z - r.z) * r.side > 0.3;
        const low = s.y < 0.25;
        a.lastD = d;
        if (d <= 0.22 || closest || passing || low) { this.hit(r, d); return; }
      }
    }

    hit(r, d) {
      const s = this.shuttle;
      const a = r.armed; r.armed = null;
      const hold = this.time - a.t0;
      const place = d <= 0.45 ? 2 : d <= 0.9 ? 1 : 0;
      const timing = hold <= 0.45 ? 2 : 1;
      let level = Math.min(place, timing);
      if (r.isAI) level = this.aiLevel(level);

      let shot = a.shot;
      let note = null;
      if (shot === 'smash' && s.y < 1.75) { shot = 'drive'; note = 'TROP BAS → DRIVE'; }

      const spec = this.shotSpec(r, shot, level);
      spec.from = { x: s.x, y: s.y, z: s.z };
      const plan = P.planShot(spec);
      s.vx = plan.v.vx; s.vy = plan.v.vy; s.vz = plan.v.vz; s.t = 0;
      s.px = s.x; s.py = s.y; s.pz = s.z;
      this.lastHitter = r;
      this.pred = P.predict(s);
      this.serveInFlight = false;
      this.rallyHits++;
      this.longestRally = Math.max(this.longestRally, this.rallyHits);

      r.swing = 0.3; r.swingShot = shot; r.swingLevel = level;
      r.stats.hits++;
      if (level === 2) r.stats.perfect++;
      if (shot === 'smash') { r.stats.smashes++; this.addHeat(r, level === 0 ? 8 : 15); if (level === 2) this.shake = Math.max(this.shake, 0.22); }
      else if (shot === 'drive') this.addHeat(r, 5);
      else if (shot === 'drop') this.addHeat(r, -6);
      else if (shot === 'clear') this.addHeat(r, -4);

      const label = note || (SHOT_NAMES[shot] + (level === 2 ? ' PARFAIT' : level === 0 ? ' FAIBLE' : ''));
      this.addFx(label, s.x, s.y + 0.3, s.z, LEVEL_COLORS[level], r.isAI ? 0.8 : 1.1, r.isAI ? 15 : 22);
      this.events.push({ type: 'hit', shot, level, robot: r });
      this.onHitFor(this.other(r));
    }

    shotSpec(r, shot, level) {
      const s = this.shuttle;
      const far = -r.side;
      const opp = this.other(r);
      let aimX;
      if (r.isAI) {
        const away = opp.x > 0.35 ? -1 : opp.x < -0.35 ? 1 : (Math.random() < 0.5 ? -1 : 1);
        aimX = away * rnd(1.0, 2.0);
        if (shot === 'drop' && Math.random() < 0.5) aimX = -Math.sign(s.x || 1) * rnd(0.6, 1.8);
      } else {
        aimX = (r.aimX || 0) * 2.1;
      }
      const noise = [1.3, 0.5, 0.15][level] * (r.isAI ? this.diff.aimNoise : 1);
      const tx = clamp(aimX, -2.2, 2.2) + rnd(-noise, noise);
      const y = s.y;
      let spec;
      switch (shot) {
        case 'clear': {
          const tz = [4.3, 5.6, 6.35][level];
          const angle = level === 0 ? 60 : (y > 1.6 ? 42 : 50);
          spec = { mode: 'angle', angle, target: { x: tx, z: far * tz }, clearance: level === 0 ? 1.2 : 0.7 };
          break;
        }
        case 'drop': {
          const tz = [2.7, 1.6, 0.95][level];
          const overhead = y > COURT.netHeight + 0.15;
          const angle = level === 0 ? 30 : overhead ? -8 : 30;
          spec = { mode: 'angle', angle, target: { x: tx, z: far * tz }, clearance: [0.55, 0.28, 0.12][level] };
          break;
        }
        case 'smash': {
          if (level === 0) {
            spec = { mode: 'angle', angle: 18, target: { x: tx, z: far * 4.8 }, clearance: 0.45 };
          } else {
            let speed = (level === 2 ? 24 : 20) * r.chassis.smash;
            spec = { mode: 'speed', speed, target: { x: tx, z: far * (level === 2 ? 3.8 : 4.6) }, clearance: level === 2 ? 0.12 : 0.3 };
          }
          break;
        }
        default: { // drive
          const tz = [4.0, 5.2, 5.9][level];
          const angle = level === 0 ? 32 : (y > 1.4 ? 2 : 14);
          spec = { mode: 'angle', angle, target: { x: tx, z: far * tz }, clearance: [0.6, 0.3, 0.15][level] };
        }
      }
      // Frappe faible : une fois sur trois, c'est carrément une faute.
      if (level === 0 && Math.random() < 0.33) {
        if (Math.random() < 0.5) spec = { mode: 'angle', angle: -10, target: { x: tx, z: far * 0.8 }, clearance: -9 };
        else spec = { mode: 'angle', angle: 24, target: { x: tx + Math.sign(tx || 1) * 1.2, z: far * rnd(7.4, 8.2) }, clearance: 0.6 };
      }
      return spec;
    }

    /** Appelé quand `r` va devoir renvoyer le volant. */
    onHitFor(r) {
      if (!r.isAI) return;
      const d = this.diff;
      r.ai.reactAt = this.time + d.reaction * rnd(0.8, 1.25);
      r.ai.shot = null;
      r.ai.noiseX = rnd(-1, 1) * d.posNoise;
      const out = this.pred && !this.pred.net && !P.inSingles(this.pred.landing.x, this.pred.landing.z, -0.1);
      r.ai.judgedOut = out && Math.random() < d.judge;
      r.ai.target = null;
    }

    /* ------------------------------------------------------------------ IA */
    updateAI(dt) {
      const ai = this.bot;
      const s = this.shuttle;
      const side = ai.side;
      let tx = 0, tz = side * 3.2;
      const incoming = this.state === 'rally' && this.lastHitter !== ai && this.pred;

      if (incoming && this.time >= ai.ai.reactAt && !ai.ai.judgedOut) {
        const path = this.pred.path;
        const now = s.t;
        let best = null, fallback = null;
        for (const p of path) {
          if (p.t <= now) continue;
          if (p.z * side < 0.35) continue;
          if (p.y > 2.3 || p.y < 0.15) continue;
          if (p.vy > 0 && p.y > 0.9) continue;
          const rz = p.z + side * SWEET;
          const dist = Math.hypot(p.x - ai.x, rz - ai.z);
          const travel = dist / this.diff.speed;
          if (travel <= (p.t - now) + 0.03) { best = p; break; }
          fallback = p;
        }
        const target = best || fallback;
        if (target) {
          tx = target.x + ai.ai.noiseX;
          tz = target.z + side * SWEET;
          if (!ai.ai.shot) ai.ai.shot = this.aiChooseShot(ai, target);
          const dToSweet = Math.hypot(s.x - ai.x, s.z - (ai.z - side * SWEET));
          if (!ai.armed && s.z * side > -0.3 && dToSweet < 1.7) ai.armed = { shot: ai.ai.shot, t0: this.time, lastD: null };
        }
      } else {
        // repli : légèrement du côté où se trouve le volant
        if (this.state === 'rally' && this.lastHitter === ai && this.pred) tx = clamp(this.pred.landing.x * 0.25, -0.8, 0.8);
        if (ai.armed && !incoming) ai.armed = null;
      }

      const dx = tx - ai.x, dz = tz - ai.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) { ai.moveX = ai.moveZ = 0; }
      else {
        const k = Math.min(1, dist / 0.35);
        ai.moveX = dx / dist * k; ai.moveZ = dz / dist * k;
      }
    }

    aiChooseShot(ai, p) {
      const d = this.diff;
      const h = p.y, depth = Math.abs(p.z);
      const r = Math.random();
      const canSmash = ai.heat < 85 && h >= 1.9 && depth <= 5.2;
      if (canSmash && r < d.aggression) return 'smash';
      if (h >= 1.9) return Math.random() < 0.5 ? 'drop' : 'clear';
      if (h >= 1.15) return r < 0.4 ? 'drive' : r < 0.75 ? 'clear' : 'drop';
      if (depth < 2.6) return r < 0.5 ? 'drop' : 'clear';
      return r < 0.8 ? 'clear' : 'drive';
    }

    aiLevel(level) {
      const e = this.diff.errorRate;
      const r = Math.random();
      if (r < e * 0.4) return 0;
      if (r < e) return Math.min(level, 1);
      return level;
    }

    /* ------------------------------------------------------------------ fin d'échange */
    checkNetAndGround() {
      const s = this.shuttle;
      if ((s.pz < 0) !== (s.z < 0)) {
        const f = s.pz / (s.pz - s.z);
        const y = s.py + (s.y - s.py) * f;
        if (y < COURT.netHeight && Math.abs(s.x) < COURT.halfWidthDoubles + 0.1) {
          s.z = s.pz < 0 ? -0.04 : 0.04;
          s.y = y;
          s.vx *= 0.05; s.vz = (s.pz < 0 ? -1 : 1) * 0.3; s.vy = Math.min(0, s.vy * 0.1);
          this.endPoint(this.other(this.lastHitter), 'FILET');
          return;
        }
      }
      if (s.y <= 0) { s.y = 0; s.vx = s.vy = s.vz = 0; this.resolveLanding(); }
    }

    resolveLanding() {
      const s = this.shuttle;
      const hitter = this.lastHitter, other = this.other(hitter);
      const inCourt = P.inSingles(s.x, s.z);
      const landSide = s.z < 0 ? -1 : 1;
      if (!inCourt) this.endPoint(other, 'OUT');
      else if (landSide === hitter.side) this.endPoint(other, 'RATÉ');
      else if (this.serveInFlight && (Math.abs(s.z) < COURT.shortService || s.x * this.serveBoxSign < 0)) this.endPoint(other, 'FAUTE DE SERVICE');
      else this.endPoint(hitter, hitter.isAI ? 'POINT BOT' : 'POINT !');
    }

    endPoint(winner, reason) {
      const idx = winner === this.robots[0] ? 0 : 1;
      this.score[idx]++;
      this.state = 'point';
      this.pointTimer = 1.5;
      this.server = winner;
      for (const r of this.robots) r.armed = null;
      const good = idx === 0;
      this.message = { text: reason, sub: good ? 'Point pour toi' : 'Point pour le bot', t: 0, good };
      this.events.push({ type: 'point', winner: idx, reason });
    }

    matchWinner() {
      const [a, b] = this.score;
      if ((a >= 15 && a - b >= 2) || a === 20) return 0;
      if ((b >= 15 && b - a >= 2) || b === 20) return 1;
      return -1;
    }

    nextRally() {
      const w = this.matchWinner();
      if (w >= 0) {
        this.winner = w;
        this.state = 'end';
        this.events.push({ type: 'end', winner: w });
        return;
      }
      this.setupServe();
    }

    /* ------------------------------------------------------------------ effets */
    addFx(text, x, y, z, color, life, size) {
      this.fx.push({ text, x, y, z, color, t: 0, life: life || 1, size: size || 20 });
    }

    pause() { if (this.state !== 'menu' && this.state !== 'end') { this.prevState = this.state; this.state = 'paused'; } }
    resume() { if (this.state === 'paused') this.state = this.prevState || 'serve'; }
  }

  root.RogueShuttle = { Game, CHASSIS, DIFFICULTY, DIFF_ORDER, SHOT_NAMES, LEVEL_NAMES, LEVEL_COLORS, SWEET };
})(typeof window !== 'undefined' ? window : globalThis);
