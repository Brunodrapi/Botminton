/* Rogue Shuttle — logique de jeu : robots, frappes, qualité, IA, score, Heat. */
(function (root) {
  'use strict';
  const P = root.Physics;
  const COURT = P.COURT;

  const CHASSIS = {
    light:    { key: 'light',    name: 'LIGHT',    speed: 7.6, accel: 80, smash: 0.85, heatMul: 1.35, cool: 5.0, reach: 1.20, color: '#5ef2ff', accent: '#b8fbff',
                desc: ['🟢 rapide', '🔴 chauffe vite', '🔴 smash faible'] },
    balanced: { key: 'balanced', name: 'BALANCED', speed: 6.4, accel: 70, smash: 1.0,  heatMul: 1.0,  cool: 6.5, reach: 1.25, color: '#7dff9a', accent: '#d6ffe0',
                desc: ['⚪ tout moyen'] },
    heavy:    { key: 'heavy',    name: 'HEAVY',    speed: 5.4, accel: 55, smash: 1.25, heatMul: 0.75, cool: 9.0, reach: 1.35, color: '#ffb35e', accent: '#ffe0b8',
                desc: ['🟢 énorme smash', '🟢 refroidissement', '🔴 lent'] },
  };

  const DIFFICULTY = {
    rookie: { key: 'rookie', name: 'ROOKIE', tempo: 0.78, speed: 4.8, reaction: 0.40, aggression: 0.35, errorRate: 0.38, aimNoise: 1.0, posNoise: 0.45, judge: 0.5, chassis: 'balanced', color: '#f2c230', sheet: 'bw-01', tint: false },
    pro:    { key: 'pro',    name: 'PRO',    tempo: 0.92, speed: 6.0, reaction: 0.24, aggression: 0.6,  errorRate: 0.2,  aimNoise: 0.55, posNoise: 0.25, judge: 0.8, chassis: 'balanced', color: '#ff5e8a', sheet: 'rg-b1', tint: true },
    elite:  { key: 'elite',  name: 'ELITE',  tempo: 1.06, speed: 7.6, reaction: 0.14, aggression: 0.8,  errorRate: 0.09, aimNoise: 0.3,  posNoise: 0.12, judge: 0.95, chassis: 'heavy', color: '#4a9cf0', sheet: 'rg-03', tint: false, hover: true },
  };
  const DIFF_ORDER = ['rookie', 'pro', 'elite'];

  const SHOT_NAMES = { clear: 'DÉGAGÉ', attack: 'DÉGAGÉ COURT', drop: 'AMORTI', smash: 'SMASH', drive: 'DRIVE', serve: 'SERVICE' };
  const LEVEL_NAMES = ['FAIBLE', 'OK', 'PARFAIT'];
  const LEVEL_COLORS = ['#ff5252', '#ffd54a', '#5dff7a'];

  const SWEET = 0.35;          // le point idéal de frappe est 35 cm devant le robot
  const CHARGE_TIME = 0.3;     // maintenir A au moins 0,3 s avant l'impact = smash préparé
  const JUMP_REACH = 3.3;      // hauteur max atteignable en sautant pour smasher
  const JUMP_TIME = 0.45;
  const MAX_HEAT = 100;
  const OVERHEAT_TIME = 3.0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function makeRobot(side, chassisKey, isAI) {
    return {
      side, isAI, chassis: CHASSIS[chassisKey], color: CHASSIS[chassisKey].color, accent: CHASSIS[chassisKey].accent,
      x: 0, z: side * 3.5, vx: 0, vz: 0, moveX: 0, moveZ: 0, walk: 0,
      heat: 0, overheat: 0, overheats: 0,
      armed: null, swing: 0, swingShot: null, swingLevel: 1, jumpT: 0,
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
      this.hitStop = 0;
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
      this.robots[0].sheet = 'rg-b1'; this.robots[0].tint = this.chassisKey !== 'balanced';
      this.robots[1].sheet = this.diff.sheet || 'rg-b1'; this.robots[1].tint = this.diff.tint !== false; this.robots[1].hover = !!this.diff.hover;
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
      this.pointWinner = null;
      this.serveTimer = srv.isAI ? rnd(0.9, 1.5) : 0;
      this.message = srv.isAI ? { text: 'SERVICE DU BOT', sub: '', t: 0 } : { text: 'À TOI DE SERVIR', sub: 'A COURT  B LONG', t: 0 };
    }

    /* ------------------------------------------------------------------ update */
    update(dt, input) {
      if (this.state === 'menu' || this.state === 'paused' || this.state === 'end') return;
      if (this.hitStop > 0) { this.hitStop -= dt; return; }
      this.time += dt;
      this.matchTime += dt;
      if (this.message) this.message.t += dt;

      const gdt = dt * (this.diff.tempo || 1);   // tempo du niveau : tout le jeu ralentit ou accélère
      this.updatePlayerInput(input);
      this.updateAI(dt);
      for (const r of this.robots) { this.moveRobot(r, gdt); this.updateHeat(r, dt); if (r.swing > 0) r.swing -= dt; if (r.jumpT > 0) r.jumpT -= dt; }

      const s = this.shuttle;
      if (this.state === 'serve') {
        const srv = this.server;
        // le volant suit la main du serveur
        s.x = srv.x + 0.15 * (-srv.side); s.z = srv.z - srv.side * 0.45; s.y = 1.0;
        if (srv.isAI) {
          this.serveTimer -= dt;
          if (this.serveTimer <= 0) this.serve(srv, Math.random() < 0.45 ? 'drop' : 'clear');
        } else if (input.just.length) {
          const btn = input.just[input.just.length - 1];
          this.serve(srv, btn === 'A' ? 'drop' : 'clear');
        }
      } else if (this.state === 'rally') {
        const n = Math.max(1, Math.ceil(gdt / (1 / 120)));
        const h = gdt / n;
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
        if (s.y > 0) { s.vy -= P.G * gdt; s.y = Math.max(0, s.y + s.vy * gdt); s.x += s.vx * gdt; s.z += s.vz * gdt; }
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
      // Croix 8 directions façon Game Boy : vitesse pleine, direction quantifiée à 45°.
      let mx = 0, mz = 0;
      const mag = Math.hypot(input.stick.x, input.stick.y);
      if (mag > 0.2) {
        const a = Math.round(Math.atan2(input.stick.y, input.stick.x) / (Math.PI / 4)) * (Math.PI / 4);
        mx = Math.cos(a); mz = Math.sin(a);
        if (Math.abs(mx) < 1e-6) mx = 0;
        if (Math.abs(mz) < 1e-6) mz = 0;
      }
      p.aimX = mx;
      p.dirZ = mz;          // croix vers le haut (+1) = vers le filet, vers le bas (-1) = vers le fond
      if (this.state !== 'rally') { p.armed = null; p.moveX = mx; p.moveZ = mz; return; }
      for (const btn of input.just) if (btn === 'A' || btn === 'B') p.armed = { btn, t0: this.time, lastD: null };
      if (p.armed && !input.held[p.armed.btn]) p.armed = null;
      // Bouton maintenu : le robot se fige, la croix ne sert plus qu'à orienter la frappe.
      if (p.armed) { p.moveX = 0; p.moveZ = 0; } else { p.moveX = mx; p.moveZ = mz; }
    }

    /** Traduit bouton + croix + hauteur du volant en type de frappe (schéma Game Boy). */
    resolveShot(r, btn, charged) {
      const y = this.shuttle.y;
      const up = (r.dirZ || 0) > 0.5;
      if (btn === 'B') return up ? 'attack' : 'clear';
      if (charged && y >= 1.75) return 'smash';   // seule frappe qui demande une préparation
      return up ? 'drop' : 'drive';
    }

    /** Un robot prêt à smasher (A maintenu assez longtemps) peut sauter pour aller chercher un volant plus haut. */
    smashReady(r) {
      if (!r.armed) return false;
      const wantsSmash = r.isAI ? r.armed.shot === 'smash' : r.armed.btn === 'A';
      return wantsSmash && (this.time - r.armed.t0) >= CHARGE_TIME && r.overheat <= 0;
    }

    /** Point d'interception atteignable sur la trajectoire prédite (ou null). */
    interceptFor(r) {
      const s = this.shuttle, side = r.side;
      const speed = r.isAI ? this.diff.speed : r.chassis.speed;
      let best = null, fallback = null;
      for (const p of this.pred.path) {
        if (p.t <= s.t) continue;
        if (p.z * side < 0.35) continue;
        if (p.y > 2.3 || p.y < 0.15) continue;
        if (p.vy > 0 && p.y > 0.9) continue;
        const dist = Math.hypot(p.x - r.x, p.z + side * SWEET - r.z);
        if (dist / speed <= (p.t - s.t) + 0.03) { best = p; break; }
        fallback = p;
      }
      return best || fallback;
    }

    moveRobot(r, dt) {
      let maxS = r.isAI ? this.diff.speed : r.chassis.speed;
      if (r.overheat > 0) maxS *= 0.7;
      const accel = r.isAI ? 60 : r.chassis.accel;
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
        const maxY = this.smashReady(r) ? JUMP_REACH : 2.6;
        const inReach = dr <= r.chassis.reach && s.y <= maxY && s.y > 0.12;
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
      const place = d <= 0.6 ? 2 : d <= 1.05 ? 1 : 0;
      const charged = hold >= CHARGE_TIME;
      let level = place;                       // la qualité ne dépend que du placement…
      if (r.isAI) level = this.aiLevel(level);

      let shot = r.isAI ? a.shot : this.resolveShot(r, a.btn, charged);
      let note = null;
      if (shot === 'smash' && !charged) { shot = 'drive'; note = 'PRÉCIPITÉ'; }   // …sauf le smash, qui exige la préparation
      if (shot === 'smash' && s.y < 1.75) { shot = 'drive'; note = 'TROP BAS → DRIVE'; }
      const jump = shot === 'smash' && s.y > 2.5;
      if (jump) { r.jumpT = JUMP_TIME; note = 'JUMP SMASH!'; }

      const spec = this.shotSpec(r, shot, level);
      if (jump && spec.mode === 'speed') spec.speed *= 1.1;
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
      if (shot === 'smash') { r.stats.smashes++; this.addHeat(r, level === 0 ? 8 : 15); if (level === 2) { this.shake = Math.max(this.shake, 0.22); this.hitStop = 0.07; } }
      else if (shot === 'drive') this.addHeat(r, 5);
      else if (shot === 'drop') this.addHeat(r, -6);
      else if (shot === 'clear') this.addHeat(r, -4);
      else if (shot === 'attack') this.addHeat(r, 0);

      const label = note || (level === 2 ? 'PARFAIT!' : level === 0 ? 'FAIBLE' : SHOT_NAMES[shot]);
      this.addFx(label, s.x, s.y + 0.3, s.z, jump ? '#f8f8f0' : LEVEL_COLORS[level], r.isAI ? 0.8 : 1.1, r.isAI ? 15 : 22);
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
        case 'attack': { // dégagé court : plus tendu, plus rapide, tombe mi-court
          const tz = [3.6, 4.4, 5.0][level];
          const angle = level === 0 ? 50 : (y > 1.6 ? 24 : 34);
          spec = { mode: 'angle', angle, target: { x: tx, z: far * tz }, clearance: level === 0 ? 0.9 : 0.5 };
          break;
        }
        case 'drop': {
          const tz = [2.7, 1.5, 0.75][level];
          const overhead = y > COURT.netHeight + 0.15;
          const angle = level === 0 ? 30 : overhead ? -8 : 30;
          spec = { mode: 'angle', angle, target: { x: tx, z: far * tz }, clearance: [0.55, 0.28, 0.12][level] };
          break;
        }
        case 'smash': {
          if (level === 0) {
            spec = { mode: 'angle', angle: 18, target: { x: tx, z: far * 4.8 }, clearance: 0.45 };
          } else {
            let speed = (level === 2 ? 27 : 22) * r.chassis.smash;
            spec = { mode: 'speed', speed, target: { x: tx, z: far * (level === 2 ? 3.3 : 4.3) }, clearance: level === 2 ? 0.1 : 0.3 };
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
      const sp = Math.hypot(this.shuttle.vx, this.shuttle.vy, this.shuttle.vz);
      // un smash surprend : réaction plus lente
      r.ai.reactAt = this.time + d.reaction * rnd(0.8, 1.25) * (sp > 16 ? 1.4 : 1);
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
        const target = this.interceptFor(ai);
        if (target) {
          tx = target.x + ai.ai.noiseX;
          tz = target.z + side * SWEET;
          if (!ai.ai.shot) ai.ai.shot = this.aiChooseShot(ai, target);
          const dToSweet = Math.hypot(s.x - ai.x, s.z - (ai.z - side * SWEET));
          if (!ai.armed && s.z * side > -0.3 && dToSweet < 3.2) ai.armed = { shot: ai.ai.shot, t0: this.time, lastD: null };
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
      if (h >= 1.9) return r < 0.45 ? 'drop' : r < 0.75 ? 'clear' : 'attack';
      if (h >= 1.15) return r < 0.35 ? 'drive' : r < 0.65 ? 'clear' : r < 0.85 ? 'attack' : 'drop';
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
      this.pointWinner = winner;
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

  root.RogueShuttle = { Game, CHASSIS, DIFFICULTY, DIFF_ORDER, SHOT_NAMES, LEVEL_NAMES, LEVEL_COLORS, SWEET, CHARGE_TIME, JUMP_TIME };
})(typeof window !== 'undefined' ? window : globalThis);
