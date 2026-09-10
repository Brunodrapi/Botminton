/* Rogue Shuttle — logique de jeu : robots, frappes, qualité, IA, score, jauge SUPER. */
(function (root) {
  'use strict';
  const P = root.Physics;
  const COURT = P.COURT;

  const CHASSIS = {
    light:    { key: 'light',    name: 'LIGHT',    speed: 7.6, accel: 80, smash: 0.85, energyMul: 1.2,  reach: 1.20, color: '#5ef2ff', accent: '#b8fbff',
                desc: ['🟢 rapide', '🟢 charge vite', '🔴 smash faible'] },
    balanced: { key: 'balanced', name: 'BALANCED', speed: 6.4, accel: 70, smash: 1.0,  energyMul: 1.0,  reach: 1.25, color: '#7dff9a', accent: '#d6ffe0',
                desc: ['⚪ tout moyen'] },
    heavy:    { key: 'heavy',    name: 'HEAVY',    speed: 5.4, accel: 55, smash: 1.25, energyMul: 0.85, reach: 1.35, color: '#ffb35e', accent: '#ffe0b8',
                desc: ['🟢 énorme smash', '🔴 charge lente', '🔴 lent'] },
  };

  const DIFFICULTY = {
    rookie: { key: 'rookie', name: 'ROOKIE', tempo: 0.78, speed: 4.8, reaction: 0.40, aggression: 0.35, errorRate: 0.38, aimNoise: 1.0, posNoise: 0.45, judge: 0.5, chassis: 'balanced', color: '#f2c230', sheet: 'bw-01', tint: false, dive: 0.25 },
    pro:    { key: 'pro',    name: 'PRO',    tempo: 0.92, speed: 6.0, reaction: 0.24, aggression: 0.6,  errorRate: 0.2,  aimNoise: 0.55, posNoise: 0.25, judge: 0.8, chassis: 'balanced', color: '#f2622a', sheet: 'rg-02', tint: false, dive: 0.5 },
    elite:  { key: 'elite',  name: 'ELITE',  tempo: 1.06, speed: 7.6, reaction: 0.14, aggression: 0.8,  errorRate: 0.09, aimNoise: 0.3,  posNoise: 0.12, judge: 0.95, chassis: 'heavy', color: '#4a9cf0', sheet: 'rg-03', tint: false, hover: true, dive: 0.75 },
    boss:   { key: 'boss',   name: 'BOSS',   tempo: 1.12, speed: 7.8, reaction: 0.11, aggression: 0.9,  errorRate: 0.05, aimNoise: 0.22, posNoise: 0.08, judge: 0.98, chassis: 'heavy', color: '#a052ff', sheet: 'zg-04', tint: false, hover: true, reach: 1.65, dive: 0.9 },
  };
  const DIFF_ORDER = ['rookie', 'pro', 'elite', 'boss'];

  const SHOT_NAMES = { clear: 'DÉGAGÉ', attack: 'DÉGAGÉ COURT', drop: 'AMORTI', smash: 'SMASH', drive: 'DRIVE', serve: 'SERVICE' };
  const LEVEL_NAMES = ['FAIBLE', 'OK', 'PARFAIT'];
  const LEVEL_COLORS = ['#ff5252', '#ffd54a', '#5dff7a'];

  const SWEET = 0.35;          // le point idéal de frappe est 35 cm devant le robot
  const TAP_TIME = 0.10;       // temps mort avant que la charge du smash ne démarre
  const CHARGE_TIME = 0.42;    // maintenir A jusque-là : smash prêt, le robot brille
  // Le coup part au relâchement du bouton : la raquette balaie et ne touche que dans sa fenêtre de contact.
  const SWING_TIME = 0.30;
  const SWING_HIT0 = 0.04;
  const SWING_HIT1 = 0.20;
  const SWING_PLANT = 0.10;   // le temps où le robot est planté sur ses appuis pendant le geste
  const JUMP_REACH = 3.3;      // hauteur max atteignable en sautant pour smasher
  const JUMP_TIME = 0.45;
  // Plongeon (sauvetage) : détente rapide avec allonge, puis un temps au sol avant de se relever.
  const DIVE_LUNGE = 0.30;     // détente : le robot glisse et peut frapper
  const DIVE_GROUND = 0.45;    // au sol, immobile
  const DIVE_RISE = 0.22;      // il se relève
  const DIVE_TOTAL = DIVE_LUNGE + DIVE_GROUND + DIVE_RISE;
  const DIVE_SPEED = 1.9;      // multiplicateur de vitesse pendant la détente
  const DIVE_REACH = 0.85;     // allonge supplémentaire pendant la détente
  const DIVE_MIN_SPEED = 1.5;  // il faut être lancé pour plonger
  const DIVE_RANGE = 2.7;      // distance maximale rattrapable en plongeant

  const MAX_ENERGY = 100;      // jauge SUPER : se remplit sur les bons coups, se vide sur un super smash

  /* --------------------------------------------------------------- roguelite */
  // Un niveau se joue en 15 points contre le même adversaire. Le score se cumule :
  // une carte est offerte à chaque palier, et le quinzième point ouvre l'adversaire suivant.
  const CARD_STEPS = [5, 10, 15];
  const LEVEL_TARGET = CARD_STEPS[CARD_STEPS.length - 1];
  const UP_MAX = 3;            // une amélioration se cumule trois fois au plus

  // Cartes : pièces du robot, tirées trois par trois après chaque manche gagnée.
  const CARDS = [
    { key: 'speed',    icon: '🦾', name: 'SERVO DE COURSE',    desc: (n) => `+${12 * n} % de vitesse de déplacement` },
    { key: 'power',    icon: '💥', name: 'BRAS HYDRAULIQUE',   desc: (n) => `+${15 * n} % de puissance de smash` },
    { key: 'eyes',     icon: '👁', name: 'OPTIQUE PRÉDICTIVE', desc: (n) => ['', 'Zone d\'arrivée du volant', 'Zone d\'arrivée resserrée', 'Point d\'arrivée précis'][n] },
    { key: 'legs',     icon: '🦿', name: 'VÉRIN DE JAMBE',     desc: (n) => `−${18 * n} % de temps de charge du smash` },
    { key: 'thruster', icon: '🚀', name: 'PROPULSEUR DORSAL',  desc: (n) => `+${(0.25 * n).toFixed(2)} m de hauteur de smash` },
    { key: 'shuttle',  icon: '🏸', name: 'VOLANT LESTÉ',       desc: (n) => `+${(0.25 * n).toFixed(2)} point par point gagné` },
  ];
  // Modificateurs de raquette : le bonus de fin de niveau.
  const RACKETS = [
    { key: 'reach',     icon: '📏', name: 'MANCHE ALLONGÉ', desc: (n) => `+${(0.18 * n).toFixed(2)} m d'allonge` },
    { key: 'precision', icon: '🎯', name: 'CORDAGE TENDU',  desc: (n) => `−${30 * n} % de dispersion` },
    { key: 'window',    icon: '🪶', name: 'TAMIS ÉLARGI',   desc: (n) => `+${Math.round(30 * n)} ms de fenêtre de frappe` },
  ];

  // Protocole du boss : un handicap tiré au sort pour le dernier niveau.
  const HANDICAPS = [
    { key: 'fast',    icon: '💨', name: 'VOLANT SURVOLTÉ',    desc: 'Le volant file 30 % plus vite' },
    { key: 'slow',    icon: '🐌', name: 'SERVOS BRIDÉS',      desc: 'Ta course est ralentie de 25 %' },
    { key: 'mono',    icon: '🌑', name: 'CAPTEUR MONOCHROME', desc: 'Le monde passe en noir et blanc' },
    { key: 'sepia',   icon: '📜', name: 'ARCHIVE SÉPIA',      desc: 'Le monde passe en sépia' },
    { key: 'flip',    icon: '🙃', name: 'GYROSCOPE INVERSÉ',  desc: 'Le terrain est à l\'envers' },
    { key: 'dark',    icon: '🕶', name: 'PANNE DE LUMIÈRE',   desc: 'On ne voit que le volant et les raquettes' },
    { key: 'nolines', icon: '🚫', name: 'LIGNES EFFACÉES',    desc: 'Le terrain n\'a plus aucune ligne' },
  ];

  /** Affiche un score qui peut être fractionnaire (carte Volant lesté). */
  function fmtScore(v) {
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function makeRobot(side, chassisKey, isAI) {
    return {
      side, isAI, chassis: CHASSIS[chassisKey], color: CHASSIS[chassisKey].color, accent: CHASSIS[chassisKey].accent,
      x: 0, z: side * 3.5, vx: 0, vz: 0, moveX: 0, moveZ: 0, walk: 0,
      energy: 0,
      hold: null, act: null, swing: 0, swingShot: null, swingLevel: 1, jumpT: 0, dive: null,
      stats: { hits: 0, perfect: 0, smashes: 0, supers: 0, whiffs: 0 },
      ai: { reactAt: 0, shot: null, noiseX: 0, judgedOut: false, willDive: false, swingErr: 0 },
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
      this.run = { level: 0, round: 0, cards: {}, racket: {} };
      this.phase = null;
    }

    /** Démarre une run complète : quatre niveaux de trois manches. */
    startRun(opts) {
      const start = DIFF_ORDER.indexOf(opts.difficulty);
      this.run = { level: start > 0 ? start : 0, stage: 0, cards: {}, racket: {}, handicap: null, levels: 0 };
      this.chassisKey = opts.chassis || 'balanced';
      this.assist = !!opts.assist;
      this.runTime = 0;
      this.startRound();
    }

    /** Manche suivante : même adversaire tant que le niveau n'est pas fini. */
    startRound() {
      // Dernier niveau : le boss impose un protocole tiré au sort.
      if (this.run.level >= DIFF_ORDER.length - 1 && !this.run.handicap) this.run.handicap = HANDICAPS[Math.floor(Math.random() * HANDICAPS.length)];
      this.startMatch({ chassis: this.chassisKey, difficulty: DIFF_ORDER[Math.min(this.run.level, DIFF_ORDER.length - 1)], assist: this.assist, keepRun: true });
    }

    /** Après le choix des cartes : on reprend le même match, ou on passe à l'adversaire suivant. */
    advance() {
      const r = this.run;
      if (r.stage >= CARD_STEPS.length - 1) { r.stage = 0; r.level++; r.levels++; this.startRound(); }
      else { r.stage++; this.winner = null; this.phase = null; this.setupServe(); }
    }

    /** Palier de points à atteindre avant la prochaine carte. */
    nextStep() { return CARD_STEPS[Math.min(this.run.stage, CARD_STEPS.length - 1)]; }
    handicapIs(k) { return !!(this.run.handicap && this.run.handicap.key === k); }
    /** Le volant survolté avance plus vite que le reste du jeu. */
    shuttleRate() { return this.handicapIs('fast') ? 1.3 : 1; }

    /* --------------------------------------------------- améliorations acquises */
    cardLv(k) { return this.run.cards[k] || 0; }
    racketLv(k) { return this.run.racket[k] || 0; }
    /** Niveau effectif de l'optique : la carte, ou l'aide activée dans le menu. */
    eyesLv() { return Math.max(this.cardLv('eyes'), this.assist ? 1 : 0); }
    chargeTime() { return CHARGE_TIME * (1 - 0.18 * this.cardLv('legs')); }
    jumpReach() { return JUMP_REACH + 0.25 * this.cardLv('thruster'); }
    hitWindow() { const w = 0.03 * this.racketLv('window'); return [SWING_HIT0 - w * 0.5, SWING_HIT1 + w]; }

    /** Trois cartes tirées au hasard parmi celles qui ne sont pas au maximum. */
    offer(list, owned) {
      const pool = list.filter((c) => (owned[c.key] || 0) < UP_MAX);
      const out = [];
      while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      return out;
    }
    offerCards() { return this.offer(CARDS, this.run.cards); }
    offerRackets() { return this.offer(RACKETS, this.run.racket); }
    takeCard(k) { this.run.cards[k] = (this.run.cards[k] || 0) + 1; }
    takeRacket(k) { this.run.racket[k] = (this.run.racket[k] || 0) + 1; }

    startMatch(opts) {
      this.chassisKey = opts.chassis || 'balanced';
      this.diffKey = opts.difficulty || 'rookie';
      this.diff = DIFFICULTY[this.diffKey];
      this.assist = !!opts.assist;
      if (!opts.keepRun) this.run = { level: Math.max(0, DIFF_ORDER.indexOf(this.diffKey)), stage: 0, cards: {}, racket: {}, handicap: null, levels: 0, solo: true };
      this.phase = null;
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
      srv.x = serverX; srv.z = srv.side * 3.2; srv.vx = srv.vz = 0; srv.hold = srv.act = null; srv.dive = null;
      rcv.x = -serverX; rcv.z = rcv.side * 3.6; rcv.vx = rcv.vz = 0; rcv.hold = rcv.act = null; rcv.dive = null;
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
      for (const r of this.robots) {
        if (r.dive) {
          r.dive.t += dt;
          if (r.dive.t >= DIVE_LUNGE && r.act) r.act = null;   // la détente passée, on ne frappe plus
          if (r.dive.t >= DIVE_TOTAL) r.dive = null;
        }
        this.moveRobot(r, gdt);
        if (r.swing > 0) r.swing -= dt;
        if (r.jumpT > 0) r.jumpT -= dt;
      }

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
        const sdt = gdt * this.shuttleRate();
        const n = Math.max(1, Math.ceil(sdt / (1 / 120)));
        const h = sdt / n;
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

      // Un coup dont la fenêtre de contact est passée sans toucher : frappe dans le vide.
      for (const r of this.robots) {
        const a = r.act;
        if (a && !a.dive && this.time - a.t0 > (r.isAI ? SWING_HIT1 : this.hitWindow()[1])) this.whiff(r);
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
      if (p.dive) { p.moveX = 0; p.moveZ = 0; return; }        // plongeon en cours : plus aucune commande
      if (this.state !== 'rally') { p.hold = null; p.act = null; p.moveX = mx; p.moveZ = mz; return; }
      p.moveX = mx; p.moveZ = mz;

      // Une pression n'arme rien : soit elle déclenche un plongeon, soit elle commence à charger.
      for (const btn of input.just) {
        if (btn !== 'A' && btn !== 'B') continue;
        const t = this.diveTarget(p);
        if (t) { this.startDive(p, t.x, t.z); p.hold = null; return; }
        p.hold = { btn, t0: this.time };
      }
      // Le coup part au relâchement : smash si la charge est pleine, sinon coup normal.
      if (p.hold && !input.held[p.hold.btn]) {
        const h = p.hold; p.hold = null;
        if (!p.act && p.swing <= 0) {
          const charged = h.btn === 'A' && this.time - h.t0 >= this.chargeTime();
          this.startSwing(p, charged ? 'smash' : this.resolveShot(h.btn, mz), { aim: mx, dirZ: mz });
        }
      }
      // Frapper ou charger cloue le robot sur place : c'est ce qui rend la visée à la croix précise.
      if (this.isCommitted(p)) { p.moveX = 0; p.moveZ = 0; }
    }

    /** Traduit bouton + croix en type de frappe (le smash est traité à part, par la charge). */
    /** Le robot est engagé dans un coup : il tient un bouton ou son geste n'a pas fini sa fenêtre de contact. */
    isCommitted(r) {
      if (r.dive) return false;
      if (r.hold) return true;
      return !!(r.act && !r.act.dive && this.time - r.act.t0 <= SWING_PLANT);
    }

    /** Profondeur visée : 0 court, 1 mi-court, 2 fond. Les diagonales comptent (croix quantifiée : ±0,71). */
    depthOf(dirZ) { return dirZ < -0.5 ? 0 : dirZ > 0.5 ? 2 : 1; }

    /** Le bouton donne la famille de trajectoire, la croix la profondeur. */
    resolveShot(btn, dirZ) {
      const d = this.depthOf(dirZ);
      if (btn === 'B') return d === 0 ? 'attack' : 'clear';
      return d === 0 ? 'drop' : 'drive';
    }

    /** Progression de la charge du smash (0 à 1), ou −1 si le robot ne charge pas. */
    chargeOf(r) {
      const h = r.hold;
      if (!h || h.btn !== 'A') return -1;
      const held = this.time - h.t0;
      if (held < TAP_TIME) return -1;
      const full = r.isAI ? CHARGE_TIME : this.chargeTime();
      return clamp((held - TAP_TIME) / (full - TAP_TIME), 0, 1);
    }

    /** Lance un coup de raquette. Il ne touchera que si le volant passe dans sa fenêtre de contact. */
    startSwing(r, shot, opt) {
      opt = opt || {};
      r.act = { shot, t0: this.time, aim: opt.aim || 0, depth: opt.depth == null ? 1 : opt.depth, dive: !!opt.dive, lastD: null };
      r.swing = SWING_TIME; r.swingShot = shot; r.swingLevel = 1;
      this.events.push({ type: 'swing', robot: r, shot });
    }

    /** Coup dans le vide : la fenêtre s'est refermée sans contact. */
    whiff(r) {
      const shot = r.act.shot;
      r.act = null;
      r.stats.whiffs++;
      this.events.push({ type: 'whiff', robot: r, shot });
      const s = this.shuttle;
      // On ne le signale que si le volant était vraiment à côté : sinon c'est juste une frappe anticipée.
      if (!r.isAI && s.z * r.side > -0.5 && Math.hypot(s.x - r.x, s.z - r.z) < 3)
        this.addFx('DANS LE VIDE', r.x, 1.9, r.z, '#9aa4c0', 0.7, 15);
    }

    speedOf(r) {
      if (r.isAI) return this.diff.speed * (1 + 0.04 * (this.run.stage || 0));   // le bot durcit d'un palier à l'autre
      return r.chassis.speed * (1 + 0.12 * this.cardLv('speed')) * (this.handicapIs('slow') ? 0.75 : 1);
    }
    reachOf(r) {
      if (r.isAI) return this.diff.reach || r.chassis.reach;
      return r.chassis.reach + 0.18 * this.racketLv('reach');
    }

    /** Point d'interception sur la trajectoire prédite, et s'il est atteignable en courant. */
    interceptInfo(r) {
      const s = this.shuttle, side = r.side;
      const speed = this.speedOf(r);
      let fallback = null;
      for (const p of this.pred.path) {
        if (p.t <= s.t) continue;
        if (p.z * side < 0.35) continue;
        if (p.y > 2.3 || p.y < 0.15) continue;
        if (p.vy > 0 && p.y > 0.9) continue;
        const dist = Math.hypot(p.x - r.x, p.z + side * SWEET - r.z);
        if (dist / speed <= (p.t - s.t) + 0.03) return { point: p, reachable: true };
        fallback = p;
      }
      return fallback ? { point: fallback, reachable: false } : null;
    }

    /** Point d'interception atteignable sur la trajectoire prédite (ou null). */
    interceptFor(r) {
      const i = this.interceptInfo(r);
      return i && i.point;
    }

    /** Point à rattraper en plongeant, ou null : il faut être lancé, hors de portée, mais pas trop loin. */
    diveTarget(r) {
      if (this.state !== 'rally' || this.lastHitter === r || !this.pred || r.dive) return null;
      if (Math.hypot(r.vx, r.vz) < DIVE_MIN_SPEED) return null;
      const info = this.interceptInfo(r);
      if (!info || info.reachable) return null;              // à portée en courant : pas besoin de plonger
      const p = info.point;
      const tz = p.z + r.side * SWEET;
      const gap = Math.hypot(p.x - r.x, tz - r.z);
      const dt = p.t - this.shuttle.t;
      if (dt < 0.05 || dt > 0.9) return null;                // ni trop tôt ni désespéré
      if (gap <= this.reachOf(r) * 0.9 || gap > DIVE_RANGE) return null;
      return { x: p.x, z: tz };
    }

    /** Détente vers (tx, tz) : le robot glisse, frappe s'il touche, puis reste au sol. */
    startDive(r, tx, tz) {
      const dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz) || 1;
      // La détente est calibrée sur la distance à couvrir : un plongeon court ne projette pas le robot au bout du terrain.
      const maxS = this.speedOf(r);
      const sp = clamp(d / (0.7 * DIVE_LUNGE), maxS, maxS * DIVE_SPEED);
      r.dive = { t: 0, dx: dx / d, dz: dz / d, sp };
      this.startSwing(r, 'clear', { dive: true });
      r.vx = dx / d * sp; r.vz = dz / d * sp;
      this.events.push({ type: 'dive', robot: r });
    }

    moveRobot(r, dt) {
      let maxS = this.speedOf(r);
      if (r.dive) {
        const d = r.dive;
        if (d.t < DIVE_LUNGE) {
          const sp = d.sp * (0.4 + 0.6 * (1 - d.t / DIVE_LUNGE));                 // la détente s'essouffle
          r.vx = d.dx * sp; r.vz = d.dz * sp;
        } else { r.vx *= 0.8; r.vz *= 0.8; }                                      // au sol : on glisse et on s'arrête
        r.x = clamp(r.x + r.vx * dt, -3.4, 3.4);
        const zN = r.side * 0.45, zF = r.side * 7.6;
        r.z = clamp(r.z + r.vz * dt, Math.min(zN, zF), Math.max(zN, zF));
        return;
      }
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

    /** La jauge SUPER monte sur les bons coups : placement parfait, smash, sauvetage. */
    addEnergy(r, amount) {
      const before = r.energy;
      r.energy = clamp(r.energy + amount * r.chassis.energyMul, 0, MAX_ENERGY);
      if (before < MAX_ENERGY && r.energy >= MAX_ENERGY) this.events.push({ type: 'full', robot: r });
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
      let plan = P.planShot(spec);
      // Un coup correct ne doit pas finir dans le filet par pure géométrie (amorti très court joué de loin) :
      // on recule la cible jusqu'à ce qu'il passe. Les frappes faibles gardent le droit de faire faute.
      for (let i = 0; i < 8 && plan.net && level > 0; i++) {
        spec.target.z += Math.sign(spec.target.z || 1) * 0.45;
        plan = P.planShot(spec);
      }
      s.vx = plan.v.vx; s.vy = plan.v.vy; s.vz = plan.v.vz; s.t = 0;
      s.px = s.x; s.py = s.y; s.pz = s.z;
      this.lastHitter = srv;
      this.pred = P.predict(s);
      this.serveInFlight = true;
      this.state = 'rally';
      this.message = null;
      srv.swing = SWING_TIME; srv.swingShot = 'serve'; srv.swingLevel = 1;
      srv.stats.hits++;
      this.onHitFor(this.other(srv));
      this.events.push({ type: 'hit', shot: 'serve', level: 1, robot: srv });
    }

    /* ------------------------------------------------------------------ contacts */
    checkContacts() {
      const s = this.shuttle;
      for (const r of this.robots) {
        const a = r.act;
        if (!a || this.lastHitter === r) continue;
        const age = this.time - a.t0;
        const [w0, w1] = r.isAI ? [SWING_HIT0, SWING_HIT1] : this.hitWindow();
        if (a.dive) { if (r.dive && r.dive.t > DIVE_LUNGE) continue; }
        else if (age < w0 || age > w1) continue;                   // hors de la fenêtre de contact
        if (s.z * r.side < -0.25) { a.lastD = null; continue; }
        const sweetZ = r.z - r.side * SWEET;
        const d = Math.hypot(s.x - r.x, s.z - sweetZ);
        const dr = Math.hypot(s.x - r.x, s.z - r.z);
        const maxY = a.shot === 'smash' ? (r.isAI ? JUMP_REACH : this.jumpReach()) : 2.6;
        let reach = this.reachOf(r);
        if (r.dive) reach += DIVE_REACH;
        const inReach = dr <= reach && s.y <= maxY && s.y > 0.12;
        if (!inReach) { a.lastD = null; continue; }
        const closest = a.lastD !== null && d >= a.lastD;
        const passing = (s.z - r.z) * r.side > 0.3;
        const low = s.y < 0.25;
        const ending = !a.dive && age >= w1 - 0.03;                 // dernière chance avant la fin du geste
        a.lastD = d;
        if (d <= 0.25 || closest || passing || low || ending) { this.hit(r, d); return; }
      }
    }

    hit(r, d) {
      const s = this.shuttle;
      const a = r.act; r.act = null; r.hold = null;
      const wide = r.isAI ? 0 : 0.09 * this.racketLv('window');
      const place = d <= 0.6 + wide ? 2 : d <= 1.05 + wide ? 1 : 0;
      let level = place;                       // la qualité tient au placement ; le timing décide déjà si on touche
      if (r.isAI) level = this.aiLevel(level);

      let shot = a.shot, note = null;
      if (a.dive) { shot = 'clear'; level = Math.min(level, 1); note = 'SAUVETAGE!'; }
      else if (shot === 'smash' && s.y < 1.75) { shot = 'drive'; note = 'TROP BAS'; }
      const jump = shot === 'smash' && s.y > 2.5;
      const sup = shot === 'smash' && r.energy >= MAX_ENERGY;
      if (sup) { r.energy = 0; r.stats.supers++; level = 2; note = 'SUPER SMASH!'; }
      else if (jump) note = 'JUMP SMASH!';
      if (jump) r.jumpT = JUMP_TIME;

      const spec = this.shotSpec(r, shot, level, r.isAI ? 0 : a.aim, sup, a.depth);
      if (jump && spec.mode === 'speed') spec.speed *= 1.1;
      spec.from = { x: s.x, y: s.y, z: s.z };
      let plan = P.planShot(spec);
      // Un coup correct ne doit pas finir dans le filet par pure géométrie (amorti très court joué de loin) :
      // on recule la cible jusqu'à ce qu'il passe. Les frappes faibles gardent le droit de faire faute.
      for (let i = 0; i < 8 && plan.net && level > 0; i++) {
        spec.target.z += Math.sign(spec.target.z || 1) * 0.45;
        plan = P.planShot(spec);
      }
      s.vx = plan.v.vx; s.vy = plan.v.vy; s.vz = plan.v.vz; s.t = 0;
      s.px = s.x; s.py = s.y; s.pz = s.z;
      this.lastHitter = r;
      this.pred = P.predict(s);
      this.serveInFlight = false;
      this.rallyHits++;
      this.longestRally = Math.max(this.longestRally, this.rallyHits);

      r.swing = SWING_TIME; r.swingShot = shot; r.swingLevel = level;
      r.stats.hits++;
      if (level === 2) r.stats.perfect++;
      if (shot === 'smash') r.stats.smashes++;

      if (sup) { this.shake = Math.max(this.shake, 0.35); this.hitStop = 0.11; }
      else {
        // la jauge monte sur ce qui est bien joué
        let gain = [0, 1, 3][level];
        if (shot === 'smash') gain += 3;
        if (jump) gain += 2;
        if (a.dive) gain += 5;
        this.addEnergy(r, gain);
        if (shot === 'smash' && level === 2) { this.shake = Math.max(this.shake, 0.22); this.hitStop = 0.07; }
      }

      const label = note || (level === 2 ? 'PARFAIT!' : level === 0 ? 'FAIBLE' : SHOT_NAMES[shot]);
      const color = sup ? '#f8d848' : (a.dive || jump) ? '#f8f8f0' : LEVEL_COLORS[level];
      this.addFx(label, s.x, s.y + 0.3, s.z, color, r.isAI ? 0.8 : 1.1, r.isAI ? 15 : 22);
      this.events.push({ type: 'hit', shot, level, robot: r, sup });
      this.onHitFor(this.other(r));
    }

    shotSpec(r, shot, level, aim, sup, depth) {
      const s = this.shuttle;
      const far = -r.side;
      const opp = this.other(r);
      let aimX;
      if (r.isAI) {
        const away = opp.x > 0.35 ? -1 : opp.x < -0.35 ? 1 : (Math.random() < 0.5 ? -1 : 1);
        aimX = away * rnd(1.0, 2.0);
        if (shot === 'drop' && Math.random() < 0.5) aimX = -Math.sign(s.x || 1) * rnd(0.6, 1.8);
      } else {
        aimX = (aim || 0) * 2.1;
      }
      const noise = [1.3, 0.5, 0.15][level] * (r.isAI ? this.diff.aimNoise : Math.max(0, 1 - 0.3 * this.racketLv('precision')));
      const tx = clamp(aimX, -2.2, 2.2) + rnd(-noise, noise);
      const y = s.y;
      let spec;
      switch (shot) {
        case 'clear': {   // croix neutre : dégagé mi-court ; croix haut : dégagé au fond
          const deep = depth >= 2;
          const tz = (deep ? [5.3, 6.0, 6.45] : [4.0, 4.7, 5.2])[level];
          const angle = level === 0 ? 60 : (deep ? (y > 1.6 ? 42 : 50) : (y > 1.6 ? 38 : 46));
          spec = { mode: 'angle', angle, target: { x: tx, z: far * tz }, clearance: level === 0 ? 1.2 : 0.7 };
          break;
        }
        case 'attack': { // croix bas : dégagé court, tendu, il tombe devant
          const tz = [3.0, 3.6, 4.1][level];
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
          if (sup) { spec = { mode: 'speed', speed: 34 * r.chassis.smash * (r.isAI ? 1 : 1 + 0.15 * this.cardLv('power')), target: { x: tx, z: far * 2.9 }, clearance: 0.08 }; break; }
          if (level === 0) {
            spec = { mode: 'angle', angle: 18, target: { x: tx, z: far * 4.8 }, clearance: 0.45 };
          } else {
            let speed = (level === 2 ? 27 : 22) * r.chassis.smash * (r.isAI ? 1 : 1 + 0.15 * this.cardLv('power'));
            spec = { mode: 'speed', speed, target: { x: tx, z: far * (level === 2 ? 3.3 : 4.3) }, clearance: level === 2 ? 0.1 : 0.3 };
          }
          break;
        }
        default: {        // drive — croix neutre : mi-court ; croix haut : jusqu'au fond
          const deep = depth >= 2;
          const tz = (deep ? [4.8, 5.6, 6.1] : [3.4, 4.2, 4.8])[level];
          const angle = level === 0 ? 32 : (y > 1.4 ? (deep ? 6 : 2) : (deep ? 18 : 12));
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
      r.ai.willDive = Math.random() < (d.dive || 0);   // décidé une fois par échange, pas à chaque image
      r.ai.swingErr = rnd(-1, 1) * d.errorRate * 0.35; // décalage du geste : c'est ce qui fait rater le bot
      r.ai.target = null;
    }

    /* ------------------------------------------------------------------ IA */
    updateAI(dt) {
      const ai = this.bot;
      const s = this.shuttle;
      const side = ai.side;
      let tx = 0, tz = side * 3.2;
      if (ai.dive) { ai.moveX = 0; ai.moveZ = 0; return; }      // plongeon en cours
      const incoming = this.state === 'rally' && this.lastHitter !== ai && this.pred;

      if (incoming && this.time >= ai.ai.reactAt && !ai.ai.judgedOut) {
        const info = this.interceptInfo(ai);
        const target = info && info.point;
        if (target && info.reachable === false && ai.ai.willDive && Math.hypot(ai.vx, ai.vz) >= DIVE_MIN_SPEED) {
          const gx = target.x, gz = target.z + side * SWEET;
          const gap = Math.hypot(gx - ai.x, gz - ai.z), dtp = target.t - s.t;
          if (gap > this.reachOf(ai) * 0.9 && gap <= DIVE_RANGE && dtp > 0.05 && dtp < 0.9) {
            this.startDive(ai, gx, gz, { shot: 'clear', t0: this.time, released: this.time, dive: true, lastD: null });
            return;
          }
        }
        if (target) {
          tx = target.x + ai.ai.noiseX;
          tz = target.z + side * SWEET;
          if (!ai.ai.shot) {
            ai.ai.shot = this.aiChooseShot(ai, target);
            ai.ai.depth = ai.ai.shot === 'clear' ? (Math.random() < 0.65 ? 2 : 1) : (Math.random() < 0.45 ? 2 : 1);
          }
          // Le geste est déclenché pour que sa fenêtre de contact tombe sur l'arrivée du volant.
          if (!ai.act && ai.swing <= 0 && s.z * side > -0.3) {
            const near = Math.hypot(target.x - ai.x, tz - ai.z) < this.reachOf(ai) * 2;
            const start = (target.t - s.t) / this.shuttleRate() - (SWING_HIT0 + SWING_HIT1) / 2 + ai.ai.swingErr;
            if (near && start <= 0) this.startSwing(ai, ai.ai.shot, { depth: ai.ai.depth });
          }
        }
      } else {
        // repli : légèrement du côté où se trouve le volant
        if (this.state === 'rally' && this.lastHitter === ai && this.pred) tx = clamp(this.pred.landing.x * 0.25, -0.8, 0.8);
        if (ai.act && !incoming && !ai.act.dive) ai.act = null;
      }

      if (this.isCommitted(ai)) { ai.moveX = ai.moveZ = 0; return; }   // même contrainte que le joueur
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
      const canSmash = h >= 1.9 && depth <= 5.2;
      if (canSmash && (ai.energy >= MAX_ENERGY || r < d.aggression)) return 'smash';
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
      // Le volant lesté fait rapporter davantage chaque point gagné par le joueur.
      this.score[idx] += idx === 0 ? 1 + 0.25 * this.cardLv('shuttle') : 1;
      this.state = 'point';
      this.pointTimer = 1.5;
      this.pointWinner = winner;
      this.server = winner;
      for (const r of this.robots) { r.hold = null; r.act = null; }
      const good = idx === 0;
      this.message = { text: reason, sub: good ? 'Point pour toi' : 'Point pour le bot', t: 0, good };
      this.events.push({ type: 'point', winner: idx, reason });
    }

    matchWinner() {
      if (this.score[1] >= LEVEL_TARGET) return 1;
      if (this.score[0] >= this.nextStep()) return 0;
      return -1;
    }

    nextRally() {
      const w = this.matchWinner();
      if (w < 0) { this.setupServe(); return; }
      this.winner = w;
      this.state = 'end';
      if (w === 1) this.phase = 'lost';                                   // le bot a atteint 15 : la run s'arrête
      else {
        const lastStep = this.run.stage >= CARD_STEPS.length - 1;
        const lastLevel = this.run.level >= DIFF_ORDER.length - 1;
        this.pendingRacket = lastStep;
        this.phase = (lastStep && lastLevel) ? 'won' : 'cards';
      }
      this.events.push({ type: 'end', winner: w, phase: this.phase });
    }

    /* ------------------------------------------------------------------ effets */
    addFx(text, x, y, z, color, life, size) {
      this.fx.push({ text, x, y, z, color, t: 0, life: life || 1, size: size || 20 });
    }

    pause() { if (this.state !== 'menu' && this.state !== 'end') { this.prevState = this.state; this.state = 'paused'; } }
    resume() { if (this.state === 'paused') this.state = this.prevState || 'serve'; }
  }

  root.RogueShuttle = { Game, CHASSIS, DIFFICULTY, DIFF_ORDER, SHOT_NAMES, LEVEL_NAMES, LEVEL_COLORS, SWEET, TAP_TIME, CHARGE_TIME, SWING_TIME, SWING_HIT0, SWING_HIT1, MAX_ENERGY, JUMP_TIME, CARDS, RACKETS, HANDICAPS, CARD_STEPS, LEVEL_TARGET, UP_MAX, fmtScore, DIVE_LUNGE, DIVE_GROUND, DIVE_RISE, DIVE_TOTAL };
})(typeof window !== 'undefined' ? window : globalThis);
