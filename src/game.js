/* Rogue Shuttle — logique de jeu : robots, frappes, qualité, IA, score, jauge SUPER. */
(function (root) {
  'use strict';
  const P = root.Physics;
  const COURT = P.COURT;

  const CHASSIS = {
    light:    { key: 'light',    name: 'LIGHT',    speed: 7.6, accel: 80, smash: 0.85, energyMul: 1.2,  reach: 1.20, color: '#5ef2ff', accent: '#b8fbff',
                desc: ['🟢 rapide', '🟢 jauge SUPER rapide', '🔴 smash faible'] },
    balanced: { key: 'balanced', name: 'BALANCED', speed: 6.4, accel: 70, smash: 1.0,  energyMul: 1.0,  reach: 1.25, color: '#7dff9a', accent: '#d6ffe0',
                desc: ['⚪ tout moyen'] },
    heavy:    { key: 'heavy',    name: 'HEAVY',    speed: 5.4, accel: 55, smash: 1.25, energyMul: 0.85, reach: 1.35, color: '#ffb35e', accent: '#ffe0b8',
                desc: ['🟢 énorme smash', '🔴 jauge SUPER lente', '🔴 lent'] },
  };

  const DIFFICULTY = {
    rookie: { key: 'rookie', name: 'ROOKIE', tempo: 0.78, speed: 4.8, reaction: 0.40, aggression: 0.35, errorRate: 0.38, aimNoise: 1.0, posNoise: 0.45, judge: 0.5, chassis: 'balanced', color: '#f2c230', sheet: 'bw-01', tint: false, dive: 0.25 },
    pro:    { key: 'pro',    name: 'PRO',    tempo: 0.92, speed: 6.0, reaction: 0.24, aggression: 0.6,  errorRate: 0.2,  aimNoise: 0.55, posNoise: 0.25, judge: 0.8, chassis: 'balanced', color: '#f2622a', sheet: 'rg-02', tint: false, dive: 0.5 },
    elite:  { key: 'elite',  name: 'ELITE',  tempo: 1.06, speed: 7.6, reaction: 0.14, aggression: 0.8,  errorRate: 0.09, aimNoise: 0.3,  posNoise: 0.12, judge: 0.95, chassis: 'heavy', color: '#4a9cf0', sheet: 'rg-03', tint: false, hover: true, dive: 0.75 },
    boss:   { key: 'boss',   name: 'BOSS',   tempo: 1.12, speed: 7.8, reaction: 0.11, aggression: 0.9,  errorRate: 0.05, aimNoise: 0.22, posNoise: 0.08, judge: 0.98, chassis: 'heavy', color: '#a052ff', sheet: 'zg-04', tint: false, hover: true, reach: 1.65, dive: 0.9 },
  };
  const DIFF_ORDER = ['rookie', 'pro', 'elite', 'boss'];

  const SHOT_NAMES = { clear: 'DÉGAGÉ', drop: 'AMORTI', smash: 'SMASH', drive: 'DRIVE', serve: 'SERVICE' };
  const LEVEL_COLORS = ['#ff5252', '#ffd54a', '#5dff7a'];
  const MATE_COLORS = [null, '#f8d848', '#58e8f8', '#ff9ad8'];   // teintes des autres humains en ligne
  const STATES = ['serve', 'rally', 'point', 'paused', 'end', 'menu'];
  const REASONS = ['POINT !', 'POINT BOT', 'POINT ADVERSE', 'OUT', 'RATÉ', 'FILET', 'FAUTE DE SERVICE'];
  const PHASES = ['cards', 'won', 'lost'];
  const SHOTS = ['clear', 'drop', 'smash', 'drive', 'serve'];
  const r2 = (v) => Math.round(v * 100) / 100;

  const SWEET = 0.35;          // le point idéal de frappe est 35 cm devant le robot
  const STROKE_OFF = 0.28;     // le point idéal se décale du côté de la raquette (coup droit) ou de l'autre (revers)
  // Visée : une pression courte envoie au centre du camp adverse, un maintien fait glisser
  // la cible vers le bord choisi à la croix, jusqu'à sortir du terrain.
  const TAP_TIME = 0.08;
  const SPREAD_TIME = 0.55;    // maintien nécessaire pour amener la visée sur la ligne
  const SPREAD_EASE = 2.4;     // courbe de la visée : d'autant plus freinée près de la ligne
  const SPREAD_OUT = 0.28;     // vitesse résiduelle au-delà de la ligne : sortir demande d'insister
  const SPREAD_MAX = 1.28;     // au-delà de 1, on vise dehors
  const AIM_DEPTH = 3.5;       // profondeur du centre du camp adverse
  const AIM_SPAN_Z = 3.05;
  const AIM_SPAN_X = 2.62;
  // Dispersion en mètres selon la qualité de la frappe : un coup parfait va chercher la ligne,
  // un coup mal calé part à peu près n'importe où. C'est le vrai prix du tempo.
  const SPREAD_BY_LEVEL = [1.7, 0.7, 0.22];
  const SMASH_H = 1.85;        // au-dessus, un coup visé mi-court part en smash
  const SMASH_TOL = 0.8;       // au-delà de cet écart à la cible, la trajectoire n'est plus un smash
  const NET_BACK = 0.12;       // recul maximal appliqué au geste d'un joueur distant (compensation de latence)
  const NET_WIDEN = 0.05;      // élargissement maximal de sa fenêtre de contact, pour la gigue restante
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
    { key: 'legs',     icon: '🦿', name: 'VÉRIN DE JAMBE',     desc: (n) => `La visée glisse ${18 * n} % plus vite vers les bords` },
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

  const NO_UP = { cards: {}, racket: {} };   // un robot piloté par la machine n'a pas de deck

  function makeRobot(side, chassisKey, isAI, slot) {
    return {
      side, isAI, slot: slot == null ? -1 : slot, up: NO_UP, court: 1,
      chassis: CHASSIS[chassisKey], color: CHASSIS[chassisKey].color, accent: CHASSIS[chassisKey].accent,
      x: 0, z: side * 3.5, vx: 0, vz: 0, moveX: 0, moveZ: 0, walk: 0,
      energy: 0,
      hold: null, act: null, swing: 0, swingShot: null, swingLevel: 1, jumpT: 0, dive: null,
      stats: { hits: 0, perfect: 0, smashes: 0, supers: 0, whiffs: 0 },
      ai: { reactAt: 0, target: null, noiseX: 0, judgedOut: false, willDive: false, swingErr: 0 },
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
      this.netOut = [];          // appuis et relâchements à transmettre à l'hôte
      this.netEvent = null;
      this.doubles = false;
      this.seating = null;
      this.score = [0, 0];
      this.run = { level: 0, stage: 0, decks: [], handicap: null, levels: 0 };
      this.phase = null;
    }

    /** Match libre contre l'adversaire choisi, sans cartes ni protocole. */
    startExhibition(opts) {
      this.chassisKey = opts.chassis || 'balanced';
      this.assist = !!opts.assist;
      this.seating = { doubles: !!opts.doubles, humans: opts.humans || null };
      this.startMatch({ chassis: this.chassisKey, difficulty: opts.difficulty || 'rookie', assist: this.assist,
                        doubles: this.seating.doubles, humans: this.seating.humans });
    }

    /** Démarre une run complète : quatre niveaux de trois manches. */
    startRun(opts) {
      // startLevel n'existe que pour les outils de capture : une run normale commence toujours au niveau 1.
      const start = clamp(Math.floor(opts.startLevel || 0), 0, DIFF_ORDER.length - 1);
      this.run = { level: start, stage: 0, decks: [], handicap: null, levels: 0 };
      this.chassisKey = opts.chassis || 'balanced';
      this.assist = !!opts.assist;
      this.seating = { doubles: !!opts.doubles, humans: opts.humans || null };
      this.startRound();
    }

    /** Manche suivante : même adversaire tant que le niveau n'est pas fini. */
    startRound() {
      // Dernier niveau : le boss impose un protocole tiré au sort.
      if (this.run.level >= DIFF_ORDER.length - 1 && !this.run.handicap) this.run.handicap = HANDICAPS[Math.floor(Math.random() * HANDICAPS.length)];
      const seat = this.seating || {};
      this.startMatch({ chassis: this.chassisKey, difficulty: DIFF_ORDER[Math.min(this.run.level, DIFF_ORDER.length - 1)],
                        assist: this.assist, keepRun: true, doubles: !!seat.doubles, humans: seat.humans || null });
    }

    /** Après le choix des cartes : on reprend le même match, ou on passe à l'adversaire suivant. */
    advance() {
      this.roundSeq = (this.roundSeq || 0) + 1;
      const r = this.run;
      if (r.stage >= CARD_STEPS.length - 1) { r.stage = 0; r.level++; r.levels++; this.startRound(); }
      else { r.stage++; this.winner = null; this.phase = null; this.setupServe(); }
    }

    /** Palier de points à atteindre avant la prochaine carte (l'exhibition se joue d'une traite). */
    nextStep() { return this.run.solo ? LEVEL_TARGET : CARD_STEPS[Math.min(this.run.stage, CARD_STEPS.length - 1)]; }
    handicapIs(k) { return !!(this.run.handicap && this.run.handicap.key === k); }
    /** Le volant survolté avance plus vite que le reste du jeu. */
    shuttleRate() { return this.handicapIs('fast') ? 1.3 : 1; }

    /* ------------------------------------------------------------------ camps */
    /** 0 = le camp du joueur local (z < 0), 1 = le camp d'en face. */
    teamOf(r) { return r.side < 0 ? 0 : 1; }
    sideOfTeam(t) { return t === 0 ? -1 : 1; }
    teamRobots(t) { const sd = this.sideOfTeam(t); return this.robots.filter((r) => r.side === sd); }
    foes(r) { return this.robots.filter((o) => o.side !== r.side); }
    /** Le coéquipier, ou null en simple. */
    partner(r) { return this.robots.find((o) => o !== r && o.side === r.side) || null; }

    /* --------------------------------------------------- améliorations acquises */
    /** Deck d'un emplacement humain : chaque joueur garde ses propres cartes. */
    deck(slot) {
      const d = this.run.decks || (this.run.decks = []);
      return d[slot] || (d[slot] = { cards: {}, racket: {} });
    }
    /** Les robots pilotés par la machine n'ont pas de deck : tout y vaut 0. */
    cardLv(r, k) { return r.up.cards[k] || 0; }
    racketLv(r, k) { return r.up.racket[k] || 0; }
    /** Niveau effectif de l'optique du joueur local : sa carte, ou l'aide activée dans le menu. */
    eyesLv() { return Math.max(this.cardLv(this.player, 'eyes'), this.assist ? 1 : 0); }
    /** Fraction de la visée déjà glissée vers le bord : 0 au centre, 1 sur la ligne, au-delà dehors. */
    spreadF(r, held) {
      const t = SPREAD_TIME * (1 - 0.18 * this.cardLv(r, 'legs'));
      const u = Math.max(0, (held - TAP_TIME) / t);
      // La mire quitte le centre d'un coup et freine en arrivant sur la ligne : un appui bref
      // décale déjà nettement, viser le bord exact demande de tenir, et dépasser demande d'insister.
      if (u >= 1) return Math.min(SPREAD_MAX, 1 + (u - 1) * SPREAD_OUT);
      return 1 - Math.pow(1 - u, SPREAD_EASE);
    }
    /** Cible d'un coup d'échange : centre du camp adverse, décalée vers le bord choisi. */
    rallyTarget(r, ux, uz, held) {
      const far = -r.side, f = this.spreadF(r, held);
      return { x: ux * f * AIM_SPAN_X, z: far * (AIM_DEPTH + uz * f * AIM_SPAN_Z), f };
    }
    /** Cible d'un service : même principe, centré sur la boîte de service adverse. */
    serveTarget(r, ux, uz, held) {
      const far = -r.side, f = this.spreadF(r, held), b = this.serveBoxSign;
      return { x: b * 1.3 + ux * f * 1.25, z: far * (4.0 + uz * f * 2.15), f };
    }
    /** Dispersion attendue, en mètres : elle dépend du placement et du cordage. */
    spreadOf(r, level, good) {
      const base = SPREAD_BY_LEVEL[level];
      const k = r.isAI ? this.diff.aimNoise : Math.max(0.1, 1 - 0.3 * this.racketLv(r, 'precision'));
      return base * k * (good ? 1 : 1.5);
    }
    /** Le volant est-il du côté de la raquette ? A = coup droit (à droite), B = revers (à gauche). */
    goodStroke(r, btn) {
      const d = this.shuttle.x - r.x;
      return btn === 'B' ? d < 0.15 : d > -0.15;
    }
    /** Famille de trajectoire déduite de la cible et de la hauteur du volant. */
    familyFor(y, tz) {
      const depth = Math.abs(tz);
      if (depth <= 2.2) return 'drop';
      if (depth >= 5.0) return 'clear';
      return y >= SMASH_H ? 'smash' : 'drive';
    }
    jumpReach(r) { return JUMP_REACH + 0.25 * this.cardLv(r, 'thruster'); }
    /** Fenêtre de contact. Un joueur distant la reçoit un peu plus large : sa frappe a voyagé,
     *  et la gigue du réseau ne doit pas lui coûter des volants qu'il avait bien lus. */
    hitWindow(r) {
      const w = 0.03 * this.racketLv(r, 'window');
      const j = r.netLag ? Math.min(NET_WIDEN, r.netLag * 0.5) : 0;
      return [SWING_HIT0 - w * 0.5 - j, SWING_HIT1 + w + j];
    }

    /** Trois cartes tirées au hasard parmi celles qui ne sont pas au maximum. */
    offer(list, owned) {
      const pool = list.filter((c) => (owned[c.key] || 0) < UP_MAX);
      const out = [];
      while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      return out;
    }
    offerCards(slot) { return this.offer(CARDS, this.deck(slot || 0).cards); }
    offerRackets(slot) { return this.offer(RACKETS, this.deck(slot || 0).racket); }
    takeCard(k, slot) { const c = this.deck(slot || 0).cards; c[k] = (c[k] || 0) + 1; }
    takeRacket(k, slot) { const c = this.deck(slot || 0).racket; c[k] = (c[k] || 0) + 1; }

    startMatch(opts) {
      this.chassisKey = opts.chassis || 'balanced';
      this.diffKey = opts.difficulty || 'rookie';
      this.diff = DIFFICULTY[this.diffKey];
      this.assist = !!opts.assist;
      if (!opts.keepRun) this.run = { level: Math.max(0, DIFF_ORDER.indexOf(this.diffKey)), stage: 0, decks: [], handicap: null, levels: 0, solo: true };
      this.phase = null;
      this.doubles = !!opts.doubles;
      // Emplacements humains : 0 = joueur local, puis les éventuels coéquipiers ou adversaires en ligne.
      const humans = opts.humans || { 0: { chassis: this.chassisKey } };
      this.robots = [];
      const seats = this.doubles ? [[-1, 0], [1, 2], [-1, 1], [1, 3]] : [[-1, 0], [1, 1]];
      for (const [side, slot] of seats) {
        const h = humans[slot];
        const r = makeRobot(side, h ? h.chassis || 'balanced' : this.diff.chassis, !h, h ? slot : -1);
        if (h) { r.up = this.deck(slot); r.sheet = 'rg-b1'; r.tint = (h.chassis || 'balanced') !== 'balanced'; r.name = h.name || null; }
        else { r.color = this.diff.color; r.accent = '#ffd6e6'; r.sheet = this.diff.sheet || 'rg-b1'; r.tint = this.diff.tint !== false; r.hover = !!this.diff.hover; }
        this.robots.push(r);
      }
      // Le coéquipier humain se distingue du joueur local par sa teinte.
      for (const r of this.robots) if (!r.isAI && r.slot > 0) { r.color = MATE_COLORS[r.slot] || r.color; r.tint = true; }
      for (const r of this.robots) r.court = this.robots.indexOf(r) < 2 ? 1 : -1;
      this.score = [0, 0];
      this.servedLast = [null, null];
      this.server = this.robots[0];
      this.lastHitter = null;
      this.pred = null;
      this.rallyHits = 0;
      this.longestRally = 0;
      this.fx = [];
      this.events = [];
      this.matchTime = 0;
      this.winner = null;
      this.netOut = [];
      this.netEvent = null;
      this.setupServe();
    }

    get player() { return this.robots[0]; }
    /** Le premier robot d'en face : celui que le HUD et les tests désignent comme « le bot ». */
    get bot() { return this.robots.find((r) => r.side > 0); }

    /** Abscisse du carré de service d'un robot : son camp et son côté donnent la place. */
    courtX(r) { return -r.side * r.court * 1.1; }

    /** Limites du carré de service d'un robot, dans son propre camp. Tant que le service n'est pas
     *  parti, serveur et receveur y sont tenus : c'est ce qui donne son sens à l'obligation de croiser. */
    serveZone(r) {
      const w = (this.doubles ? COURT.halfWidthDoubles : COURT.halfWidthSingles) - 0.12;
      const back = (this.doubles ? COURT.longServiceDoubles : COURT.halfLength) - 0.12;
      const sx = Math.sign(this.courtX(r)) || 1;
      const zA = r.side * (COURT.shortService + 0.12), zB = r.side * back;
      return { x0: sx > 0 ? 0.14 : -w, x1: sx > 0 ? w : -0.14,
               z0: Math.min(zA, zB), z1: Math.max(zA, zB) };
    }

    /** Le robot est-il tenu à son carré de service ? Seuls le serveur et son vis-à-vis le sont. */
    penned(r) {
      if (this.state !== 'serve' || !this.server) return false;
      if (r === this.server) return true;
      return this.teamOf(r) !== this.teamOf(this.server) && r.court === this.server.court;
    }

    setupServe() {
      const srv = this.server, st = this.teamOf(srv);
      this.servedLast[st] = srv;
      // Score pair : on sert du carré droit ; impair : du carré gauche. Le coéquipier prend l'autre.
      srv.court = this.score[st] % 2 === 0 ? 1 : -1;
      const mate = this.partner(srv);
      if (mate) mate.court = -srv.court;
      const foes = this.foes(srv);
      // En simple, l'unique receveur suit le serveur : il se place toujours en diagonale de lui.
      // En double la paire receveuse garde ses places — elle a déjà un robot dans chaque carré.
      if (foes.length === 1) foes[0].court = srv.court;
      // Le receveur est celui qui fait face au serveur en diagonale : même `court`, camp opposé.
      const rcv = foes.find((r) => r.court === srv.court) || foes[0];
      for (const r of this.robots) { r.vx = r.vz = 0; r.hold = r.act = null; r.dive = null; }
      for (const r of this.robots) {
        r.x = this.courtX(r);
        // Le serveur avance, son coéquipier couvre le fond ; en face, le receveur avance et l'autre recule.
        r.z = r.side * (r === srv ? 3.2 : r === rcv ? 3.6 : r.side === srv.side ? 4.8 : 4.4);
      }
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
      this.message = null;        // les consignes sont écrites sous les boutons, pas en surimpression
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
          if (this.serveTimer <= 0) {                       // le bot vise court ou long, un peu au hasard
            const uz = Math.random() < 0.45 ? -1 : 1, ux = rnd(-1, 1);
            this.serve(srv, 'A', this.serveTarget(srv, ux, uz, TAP_TIME + SPREAD_TIME * rnd(0.45, 0.85)));
          }
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
        if (a && !a.dive && this.time - a.t0 > this.hitWindow(r)[1]) this.whiff(r);
      }

      for (const f of this.fx) f.t += dt;
      this.fx = this.fx.filter((f) => f.t < f.life);
      this.shake = Math.max(0, this.shake - dt);
    }

    updatePlayerInput(input) { this.driveHuman(this.player, input); }

    /** Applique une manette à un robot humain — le sien en local, ceux des autres chez l'hôte.
     *  En mode prédiction (invité d'une partie en ligne), on ne décide rien : on bouge, on vise,
     *  on joue le geste pour l'œil, et on note l'appui et le relâchement à envoyer à l'hôte. */
    driveHuman(p, input, predict) {
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
      p.dirZ = mz;          // croix vers le haut (+1) : on court vers le filet, on vise le fond adverse
      if (p.dive) { p.moveX = 0; p.moveZ = 0; return; }        // plongeon en cours : plus aucune commande
      const serving = this.state === 'serve' && this.server === p;
      if (this.state !== 'rally' && !serving) { p.hold = null; p.act = null; p.moveX = mx; p.moveZ = mz; return; }
      p.moveX = mx; p.moveZ = mz;

      // Une pression ne frappe pas : elle fige le robot et fait glisser la visée vers le bord choisi.
      for (const btn of input.just) {
        if (btn !== 'A' && btn !== 'B') continue;
        if (!serving && !predict) {
          const t = this.diveTarget(p);
          if (t) { this.startDive(p, t.x, t.z); p.hold = null; return; }
        }
        p.hold = { btn, t0: this.time };
        if (predict) this.netOut.push({ k: 'p', btn, ux: mx, uz: mz });
      }
      // Le coup part au relâchement, vers la cible atteinte par la visée.
      if (p.hold && !input.held[p.hold.btn]) {
        const h = p.hold; p.hold = null;
        const held = this.time - h.t0;
        if (predict) {
          // L'hôte tranchera : ici on ne fait que lancer le geste pour que la main suive l'œil.
          this.netOut.push({ k: 'r', btn: h.btn, held, ux: mx, uz: mz });
          if (p.swing <= 0) {
            p.swing = SWING_TIME; p.swingLevel = 1;
            p.swingShot = this.familyFor(this.shuttle.y, this.rallyTarget(p, mx, mz, held).z);
          }
        } else if (serving) this.serve(p, h.btn, this.serveTarget(p, mx, mz, held));
        else if (!p.act && p.swing <= 0) this.startSwing(p, { btn: h.btn, target: this.rallyTarget(p, mx, mz, held) });
      }
      // Viser cloue le robot sur place : c'est ce qui rend la croix utilisable comme mire.
      if (this.isCommitted(p)) { p.moveX = 0; p.moveZ = 0; }
    }

    /* ------------------------------------------------------- entrées venues du réseau */
    /** Début de maintien annoncé par un joueur distant. `ago` rattrape le temps de transit. */
    netPress(r, btn, ago) {
      if (r.dive) return;
      const serving = this.state === 'serve' && this.server === r;
      if (!serving) {
        if (this.state !== 'rally') return;
        const t = this.diveTarget(r);
        if (t) { this.startDive(r, t.x, t.z); r.hold = null; return; }
      }
      r.hold = { btn, t0: this.time - Math.max(0, Math.min(ago || 0, 2)) };
    }

    /** Relâchement annoncé par un joueur distant : il transmet la durée qu'il a réellement tenue,
     *  si bien que la visée ne dépend pas de la latence — seul le tempo du contact en souffre. */
    netRelease(r, btn, held, ux, uz, lag) {
      const h = r.hold; r.hold = null;
      if (r.dive) return;
      const serving = this.state === 'serve' && this.server === r;
      if (serving) { this.serve(r, btn, this.serveTarget(r, ux, uz, held)); return; }
      if (this.state !== 'rally' || !h) return;
      if (!r.act && r.swing <= 0) this.startSwing(r, { btn, target: this.rallyTarget(r, ux, uz, held), back: lag });
    }

    /** Déplacement et visée d'un joueur distant, envoyés en continu. */
    netAim(r, ux, uz) {
      r.aimX = ux; r.dirZ = uz;
      if (r.dive || this.isCommitted(r)) { r.moveX = 0; r.moveZ = 0; return; }
      r.moveX = ux; r.moveZ = uz;
    }

    /** Le robot est engagé dans un coup : il tient un bouton ou son geste n'a pas fini sa fenêtre de contact. */
    isCommitted(r) {
      if (r.dive) return false;
      if (r.hold) return true;
      return !!(r.act && !r.act.dive && this.time - r.act.t0 <= SWING_PLANT);
    }

    /** Lance un coup de raquette. Il ne touchera que si le volant passe dans sa fenêtre de contact. */
    startSwing(r, opt) {
      const far = -r.side;
      const target = opt.target || { x: 0, z: far * AIM_DEPTH };
      // `back` remonte le début du geste : le coup d'un joueur distant est arrivé avec du retard,
      // on le rejoue à l'instant où il l'a lancé pour que sa fenêtre de contact tombe juste.
      const back = Math.max(0, Math.min(opt.back || 0, NET_BACK));
      r.act = { btn: opt.btn || 'A', target, t0: this.time - back, dive: !!opt.dive, lastD: null };
      // La famille exacte se décide au contact (elle dépend de la hauteur du volant) ; on devine pour l'animation.
      const guess = opt.dive ? 'clear' : this.familyFor(this.shuttle.y, target.z);
      r.swing = SWING_TIME - back; r.swingShot = guess; r.swingLevel = 1;
      this.events.push({ type: 'swing', robot: r, shot: guess });
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
      return r.chassis.speed * (1 + 0.12 * this.cardLv(r, 'speed')) * (this.handicapIs('slow') ? 0.75 : 1);
    }
    reachOf(r) {
      if (r.isAI) return this.diff.reach || r.chassis.reach;
      return r.chassis.reach + 0.18 * this.racketLv(r, 'reach');
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
      this.startSwing(r, { dive: true, btn: 'A', target: { x: 0, z: -r.side * 5.0 } });
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
      // Au service, on ne sort pas de son couloir : ni le serveur, ni celui qui lui fait face.
      if (this.penned(r)) {
        const z = this.serveZone(r);
        const nx = clamp(r.x, z.x0, z.x1), nz = clamp(r.z, z.z0, z.z1);
        if (nx !== r.x) r.vx = 0;
        if (nz !== r.z) r.vz = 0;
        r.x = nx; r.z = nz;
      }
      r.walk += Math.hypot(r.vx, r.vz) * dt * 2.2;
    }

    /** La jauge SUPER monte sur les bons coups : placement parfait, smash, sauvetage. */
    addEnergy(r, amount) {
      const before = r.energy;
      r.energy = clamp(r.energy + amount * r.chassis.energyMul, 0, MAX_ENERGY);
      if (before < MAX_ENERGY && r.energy >= MAX_ENERGY) this.events.push({ type: 'full', robot: r });
    }

    /* ------------------------------------------------------------------ service */
    serve(srv, btn, target) {
      const s = this.shuttle;
      const depth = Math.abs(target.z);
      const spread = this.spreadOf(srv, 2, true) * 0.6;
      const tgt = { x: target.x + rnd(-spread, spread), z: target.z + rnd(-spread, spread) };
      // Court : trajectoire tendue qui rase la bande. Long : cloche qui retombe au fond.
      const long = depth > 4.6;
      const spec = { mode: 'angle', angle: long ? 58 : depth > 3.2 ? 40 : 22, target: tgt,
                     clearance: long ? 1.0 : 0.14, from: { x: s.x, y: s.y, z: s.z } };
      const plan = P.planShot(spec);
      s.vx = plan.v.vx; s.vy = plan.v.vy; s.vz = plan.v.vz; s.t = 0;
      s.px = s.x; s.py = s.y; s.pz = s.z;
      this.lastHitter = srv;
      this.pred = P.predict(s);
      this.serveInFlight = true;
      this.state = 'rally';
      this.message = null;
      srv.swing = SWING_TIME; srv.swingShot = 'serve'; srv.swingLevel = 1;
      srv.stats.hits++;
      this.onHitForTeam(1 - this.teamOf(srv));
      this.events.push({ type: 'hit', shot: 'serve', level: 1, robot: srv });
    }

    /* ------------------------------------------------------------------ contacts */
    checkContacts() {
      const s = this.shuttle;
      for (const r of this.robots) {
        const a = r.act;
        if (!a || this.lastHitter === r) continue;
        const age = this.time - a.t0;
        const [w0, w1] = this.hitWindow(r);
        if (a.dive) { if (r.dive && r.dive.t > DIVE_LUNGE) continue; }
        else if (age < w0 || age > w1) continue;                   // hors de la fenêtre de contact
        if (s.z * r.side < -0.25) { a.lastD = null; continue; }
        // Le point idéal se décale du côté de la raquette : coup droit à droite, revers à gauche.
        const sweetX = r.x + (a.btn === 'B' ? -STROKE_OFF : STROKE_OFF);
        const sweetZ = r.z - r.side * SWEET;
        const d = Math.hypot(s.x - sweetX, s.z - sweetZ);
        const dr = Math.hypot(s.x - r.x, s.z - r.z);
        const maxY = this.jumpReach(r);
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
      // Un joueur distant place son robot avec un aller simple de retard : à sa vitesse de course,
      // cela fait exactement `vitesse × latence` mètres de retard sur le point qu'il visait. On lui
      // élargit la zone de qualité d'autant, sinon le réseau lui coûterait le tempo qu'il a eu.
      const late = r.netLag ? Math.min(0.55, this.speedOf(r) * r.netLag * 0.8) : 0;
      const wide = 0.09 * this.racketLv(r, 'window') + late;
      const place = d <= 0.55 + wide ? 2 : d <= 1.0 + wide ? 1 : 0;
      const good = a.dive || this.goodStroke(r, a.btn);
      let level = good ? place : Math.min(place, 1);     // frapper du mauvais côté interdit le coup parfait
      if (r.isAI) level = this.aiLevel(level);

      // La cible visée reçoit sa dispersion : c'est elle qui décide de la famille de trajectoire.
      const spread = this.spreadOf(r, level, good);
      const tx = clamp(a.target.x + rnd(-spread, spread), -3.6, 3.6);
      const tz = a.target.z + rnd(-spread, spread);
      let shot = a.dive ? 'clear' : this.familyFor(s.y, tz);
      let note = null;
      if (a.dive) { level = Math.min(level, 1); note = 'SAUVETAGE!'; }
      else if (!good) note = a.btn === 'B' ? 'REVERS FORCÉ' : 'COUP DROIT FORCÉ';

      // La trajectoire est calculée avant d'être nommée : c'est elle qui dit si le coup est jouable.
      const planFor = (kind, lv, sup) => {
        const spec = this.shotSpec(r, kind, lv, { x: tx, z: tz }, sup);
        spec.from = { x: s.x, y: s.y, z: s.z };
        let plan = P.planShot(spec);
        // Un coup correct ne doit pas finir dans le filet par pure géométrie (amorti très court joué de loin) :
        // on recule la cible jusqu'à ce qu'il passe. Les frappes faibles gardent le droit de faire faute.
        for (let i = 0; i < 8 && plan.net && lv > 0; i++) {
          spec.target.z += Math.sign(spec.target.z || 1) * 0.45;
          plan = P.planShot(spec);
        }
        return plan;
      };
      let plan = planFor(shot, level, false);
      // Un smash pris trop bas ou trop loin du filet ne peut pas plonger sur la cible : le filet
      // l'oblige à partir à plat et il la dépasse. Ce n'est alors pas un smash mais un drive,
      // qui, lui, tombe là où le joueur a visé. La mire ne doit jamais mentir.
      if (shot === 'smash' && Math.abs(plan.landing.z - tz) > SMASH_TOL) {
        shot = 'drive'; note = note || 'TROP BAS';
        plan = planFor(shot, level, false);
      }

      const jump = shot === 'smash' && s.y > 2.5;
      const sup = shot === 'smash' && r.energy >= MAX_ENERGY;
      if (sup) {
        r.energy = 0; r.stats.supers++; level = 2; note = 'SUPER SMASH!';
        // Le super smash ne troque jamais sa précision contre sa vitesse : s'il dépasse, il garde le smash placé.
        const boom = planFor(shot, 2, true);
        plan = Math.abs(boom.landing.z - tz) <= SMASH_TOL ? boom : planFor(shot, 2, false);
      } else if (jump) note = note || 'JUMP SMASH!';
      if (jump) r.jumpT = JUMP_TIME;

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
      this.netEvent = { n: (this.netEvent ? this.netEvent.n : 0) + 1, k: 1,
                       a: this.robots.indexOf(r), b: SHOTS.indexOf(shot), c: level + (sup ? 10 : 0) };
      this.events.push({ type: 'hit', shot, level, robot: r, sup });
      this.onHitForTeam(1 - this.teamOf(r));
    }

    /** Forme de trajectoire pour atteindre la cible déjà décidée par la visée. */
    shotSpec(r, shot, level, target, sup) {
      const y = this.shuttle.y;
      const pw = 1 + 0.15 * this.cardLv(r, 'power');
      switch (shot) {
        case 'clear': {
          const angle = level === 0 ? 58 : (y > 1.6 ? 42 : 50);
          return { mode: 'angle', angle, target, clearance: level === 0 ? 1.2 : 0.7 };
        }
        case 'drop': {
          const overhead = y > COURT.netHeight + 0.15;
          const angle = level === 0 ? 30 : overhead ? -8 : 30;
          return { mode: 'angle', angle, target, clearance: [0.55, 0.28, 0.12][level] };
        }
        case 'smash': {
          if (sup) return { mode: 'speed', speed: 34 * r.chassis.smash * pw, target, clearance: 0.08 };
          if (level === 0) return { mode: 'angle', angle: 18, target, clearance: 0.45 };
          return { mode: 'speed', speed: (level === 2 ? 27 : 22) * r.chassis.smash * pw, target, clearance: level === 2 ? 0.1 : 0.3 };
        }
        default: {
          const angle = level === 0 ? 32 : (y > 1.4 ? 6 : 14);
          return { mode: 'angle', angle, target, clearance: [0.6, 0.3, 0.15][level] };
        }
      }
    }

    /** Tout le camp qui va devoir renvoyer le volant se remet en alerte. */
    onHitForTeam(t) { for (const r of this.teamRobots(t)) this.onHitFor(r); }

    /** Appelé quand `r` va devoir renvoyer le volant. */
    onHitFor(r) {
      if (!r.isAI) return;
      const d = this.diff;
      const sp = Math.hypot(this.shuttle.vx, this.shuttle.vy, this.shuttle.vz);
      // un smash surprend : réaction plus lente
      r.ai.reactAt = this.time + d.reaction * rnd(0.8, 1.25) * (sp > 16 ? 1.4 : 1);
      r.ai.noiseX = rnd(-1, 1) * d.posNoise;
      const out = this.pred && !this.pred.net && !this.inCourt(this.pred.landing.x, this.pred.landing.z, -0.1);
      r.ai.judgedOut = out && Math.random() < d.judge;
      r.ai.willDive = Math.random() < (d.dive || 0);   // décidé une fois par échange, pas à chaque image
      r.ai.swingErr = rnd(-1, 1) * d.errorRate * 0.35; // décalage du geste : c'est ce qui fait rater le bot
      r.ai.target = null;
    }

    /* ------------------------------------------------------------------ IA */
    updateAI(dt) { for (const r of this.robots) if (r.isAI) this.driveAI(r, dt); }

    /** En double, un seul des deux robots va chercher le volant : celui qui arrive le plus vite. */
    aiTakesIt(ai, point) {
      const mate = this.partner(ai);
      if (!mate || !mate.isAI || mate.dive) return true;
      const cost = (r) => Math.hypot(point.x - r.x, point.z + r.side * SWEET - r.z) / this.speedOf(r);
      const mine = cost(ai), theirs = cost(mate);
      // À égalité, c'est celui qui est du même côté que le volant qui prend, pour ne pas se croiser.
      if (Math.abs(mine - theirs) < 0.05) return Math.sign(ai.x || 1) === Math.sign(point.x || 1);
      return mine <= theirs;
    }

    driveAI(ai, dt) {
      const s = this.shuttle;
      const side = ai.side;
      let tx = 0, tz = side * 3.2;
      if (ai.dive) { ai.moveX = 0; ai.moveZ = 0; return; }      // plongeon en cours
      const incoming = this.state === 'rally' && this.lastHitter !== ai && this.pred;

      const mate = this.partner(ai);
      if (incoming && this.time >= ai.ai.reactAt && !ai.ai.judgedOut) {
        const info = this.interceptInfo(ai);
        let target = info && info.point;
        // Le coéquipier qui ne prend pas le volant couvre le reste du camp au lieu de le suivre.
        if (target && !this.aiTakesIt(ai, target)) {
          tx = clamp(-target.x * 0.7, -2.2, 2.2); tz = ai.side * (Math.abs(target.z) > 4 ? 2.6 : 4.8);
          target = null;
          if (ai.act && !ai.act.dive) ai.act = null;
        }
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
          if (!ai.ai.target) ai.ai.target = this.aiAim(ai, target);
          // Le geste est déclenché pour que sa fenêtre de contact tombe sur l'arrivée du volant.
          if (!ai.act && ai.swing <= 0 && s.z * side > -0.3) {
            const near = Math.hypot(target.x - ai.x, tz - ai.z) < this.reachOf(ai) * 2;
            const start = (target.t - s.t) / this.shuttleRate() - (SWING_HIT0 + SWING_HIT1) / 2 + ai.ai.swingErr;
            if (near && start <= 0) this.startSwing(ai, { btn: target.x >= ai.x ? 'A' : 'B', target: ai.ai.target });
          }
        }
      } else {
        // repli : légèrement du côté où se trouve le volant
        if (this.state === 'rally' && this.lastHitter === ai && this.pred) tx = clamp(this.pred.landing.x * 0.25, -0.8, 0.8);
        if (ai.act && !incoming && !ai.act.dive) ai.act = null;
      }
      // En double, on ne se marche pas dessus : celui qui ne porte pas le coup s'écarte.
      if (mate && !ai.act && Math.hypot(mate.x - tx, mate.z - tz) < 1.2) tx += Math.sign(ai.x - mate.x || 1) * 1.2;

      if (this.isCommitted(ai)) { ai.moveX = ai.moveZ = 0; return; }   // même contrainte que le joueur
      const dx = tx - ai.x, dz = tz - ai.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) { ai.moveX = ai.moveZ = 0; }
      else {
        const k = Math.min(1, dist / 0.35);
        ai.moveX = dx / dist * k; ai.moveZ = dz / dist * k;
      }
    }

    /** Le bot choisit une zone plutôt qu'un type de coup : la trajectoire en découle. */
    aiAim(ai, p) {
      const d = this.diff, far = -ai.side, opps = this.foes(ai);
      // On vise à l'opposé du barycentre adverse : en double, c'est le trou entre les deux.
      const mid = opps.reduce((a, o) => a + o.x, 0) / (opps.length || 1);
      const away = mid > 0.35 ? -1 : mid < -0.35 ? 1 : (Math.random() < 0.5 ? -1 : 1);
      const h = p.y, r = Math.random();
      let uz;
      if (h >= 1.9 && (ai.energy >= MAX_ENERGY || r < d.aggression)) uz = rnd(-0.2, 0.2);        // smash mi-court
      else if (h >= 1.9) uz = r < 0.45 ? rnd(-0.95, -0.65) : rnd(0.6, 0.95);                     // amorti ou dégagé
      else if (h >= 1.15) uz = r < 0.35 ? rnd(-0.25, 0.25) : r < 0.7 ? rnd(0.6, 0.95) : rnd(-0.95, -0.6);
      else uz = r < 0.75 ? rnd(0.65, 0.95) : rnd(-0.9, -0.6);
      const f = clamp(1.05 - d.aimNoise * 0.5, 0.55, 1);      // un bon bot ose viser près des lignes
      const ux = away * rnd(0.3, 1);
      return { x: ux * f * AIM_SPAN_X, z: far * (AIM_DEPTH + uz * f * AIM_SPAN_Z) };
    }

    aiLevel(level) {
      const e = this.diff.errorRate;
      const r = Math.random();
      if (r < e * 0.4) return 0;
      if (r < e) return Math.min(level, 1);
      return level;
    }

    /* ------------------------------------------------------ instantané réseau */
    /** État complet de la partie, en nombres courts : c'est ce que l'hôte diffuse 30 fois par seconde.
     *  Tout est absolu — un instantané perdu n'a aucune conséquence, le suivant redit tout. */
    snapshot(seq) {
      const s = this.shuttle, out = [
        seq, STATES.indexOf(this.state), this.robots.indexOf(this.server),
        r2(this.score[0]), r2(this.score[1]), this.robots.length,
        this.robots.indexOf(this.lastHitter), this.serveInFlight ? 1 : 0, r2(s.t), this.longestRally, this.roundSeq || 0,
        this.run.handicap ? HANDICAPS.indexOf(this.run.handicap) : -1,
        PHASES.indexOf(this.phase), this.pendingRacket ? 1 : 0, this.winner == null ? -1 : this.winner,
        this.run.stage || 0, this.run.level || 0,
        r2(s.x), r2(s.y), r2(s.z), r2(s.vx), r2(s.vy), r2(s.vz),
      ];
      for (const r of this.robots) {
        out.push(r2(r.x), r2(r.z), r2(r.vx), r2(r.vz), r.court,
                 Math.round(r.energy), r2(r.swing), SHOTS.indexOf(r.swingShot), r.swingLevel,
                 r2(r.jumpT), r.dive ? r2(r.dive.t) : -1,
                 r.hold ? (r.hold.btn === 'B' ? 2 : 1) : 0, r.hold ? r2(this.time - r.hold.t0) : 0,
                 r2(r.aimX || 0), r2(r.dirZ || 0), r.act ? 1 : 0, Math.round((r.netLag || 0) * 1000),
                 r.stats.hits, r.stats.perfect, r.stats.smashes, r.stats.whiffs, r.stats.supers);
      }
      const e = this.netEvent;
      out.push(e ? e.n : 0, e ? e.k : 0, e ? e.a : 0, e ? e.b : 0, e ? e.c : 0);
      return out;
    }

    /** Applique un instantané de l'hôte. `map` traduit l'ordre local vers l'ordre de l'hôte,
     *  `flip` retourne le terrain pour le joueur qui, chez lui, joue toujours en bas. */
    applySnapshot(a, map, flip, keepOwn, lead) {
      if (!a || a.length < 23) return;
      const f = flip ? -1 : 1;
      const st = STATES[a[1]];
      if (st) this.state = st;
      this.score = [a[3], a[4]];
      const n = a[5] | 0;
      const srvCanon = a[2];
      const s = this.shuttle;
      const hitCanon = a[6];
      this.serveInFlight = !!a[7];
      this.longestRally = a[9];
      this.hostRound = a[10];
      // Le protocole du boss est tiré au sort par l'hôte : sans cela chaque écran aurait le sien.
      const hc = a[11] >= 0 ? HANDICAPS[a[11]] : null;
      if (this.run && this.run.handicap !== hc) this.run.handicap = hc;
      // La phase dit à l'invité s'il doit montrer un choix de carte ou l'écran de fin : sans elle,
      // il afficherait la fin d'une run que l'hôte, lui, veut simplement continuer.
      this.phase = PHASES[a[12]] || null;
      this.pendingRacket = !!a[13];
      this.winner = a[14] < 0 ? null : a[14];
      this.run.stage = a[15]; this.run.level = a[16];
      s.px = s.x; s.py = s.y; s.pz = s.z;
      const ovx = s.vx, ovy = s.vy, ovz = s.vz;
      s.t = a[8];                         // horloge de l'échange : l'interception s'y réfère
      s.x = a[17] * f; s.y = a[18]; s.z = a[19] * f;
      s.vx = a[20] * f; s.vy = a[21]; s.vz = a[22] * f;
      // L'instantané décrit un passé vieux d'un aller simple : on le rejoue en avant jusqu'au
      // présent de l'hôte, sinon l'invité viserait toujours là où le volant n'est plus.
      const ahead = Math.max(0, Math.min(lead || 0, 0.3));
      const moved = Math.abs(ovx - s.vx) + Math.abs(ovy - s.vy) + Math.abs(ovz - s.vz) > 0.05;
      if (ahead && this.state === 'rally') {
        const n = Math.max(1, Math.ceil(ahead / (1 / 120)));
        for (let i = 0; i < n; i++) { P.step(s, ahead / n); s.t += ahead / n; }
      }
      // La trajectoire prédite ne se recalcule qu'au changement de vitesse : c'est là qu'on a frappé.
      if (moved || !this.pred) {
        this.pred = P.predict(s);
        // Elle repart de l'instant courant : on la recale sur l'horloge de l'échange.
        for (const q of this.pred.path) q.t += s.t;
        this.pred.landing.t += s.t;
      }
      const W = 22;
      this.lastHitter = null;
      for (let li = 0; li < this.robots.length && li < n; li++) {
        const ci = map ? map[li] : li;
        if (ci === hitCanon) this.lastHitter = this.robots[li];
      }
      for (let li = 0; li < this.robots.length && li < n; li++) {
        const r = this.robots[li], o = 23 + (map ? map[li] : li) * W;
        if (map && map[li] === srvCanon) this.server = r;
        const own = keepOwn && r === this.player;
        const nx = a[o] * f, nz = a[o + 1] * f;
        if (own) {
          // Notre propre robot est prédit en local : on le ramène doucement vers l'autorité
          // au lieu de le téléporter, sinon chaque instantané ferait sauter l'image.
          // Un plongeon n'est pas prédit en local : on recale d'un coup, sinon le robot traîne derrière.
          const gap = Math.hypot(nx - r.x, nz - r.z);
          const k = gap > 1.5 || r.dive || a[o + 10] >= 0 ? 1 : 0.18;
          r.x += (nx - r.x) * k; r.z += (nz - r.z) * k;
        } else {
          r.vx = a[o + 2] * f; r.vz = a[o + 3] * f;
          r.x = clamp(nx + r.vx * ahead, -3.4, 3.4); r.z = nz + r.vz * ahead;
          r.aimX = a[o + 13] * f; r.dirZ = a[o + 14] * f;
          const hb = a[o + 11];
          r.hold = hb ? { btn: hb === 2 ? 'B' : 'A', t0: this.time - a[o + 12] } : null;
          r.act = a[o + 15] ? (r.act || { btn: 'A', target: { x: 0, z: 0 }, t0: this.time, dive: false, lastD: null }) : null;
        }
        r.court = a[o + 4];
        r.energy = a[o + 5];
        r.swing = a[o + 6];
        r.swingShot = SHOTS[a[o + 7]] || null;
        r.swingLevel = a[o + 8];
        r.jumpT = a[o + 9];
        const dv = a[o + 10];
        r.dive = dv >= 0 ? (r.dive ? (r.dive.t = dv, r.dive) : { t: dv, dx: 0, dz: 0, sp: 0 }) : null;
        r.stats.hits = a[o + 17]; r.stats.perfect = a[o + 18];
        r.stats.smashes = a[o + 19]; r.stats.whiffs = a[o + 20]; r.stats.supers = a[o + 21];
      }
      const own = this.robots.indexOf(this.player);
      const lag = own >= 0 ? a[23 + (map ? map[own] : own) * W + 16] / 1000 : 0;
      return { seq: a[0], lag, event: { n: a[a.length - 5], k: a[a.length - 4], a: a[a.length - 3], b: a[a.length - 2], c: a[a.length - 1] } };
    }

    /** Côté invité : on n'arbitre rien, on prolonge la simulation entre deux instantanés.
     *  Le volant suit la même intégration que chez l'hôte, donc l'extrapolation reste fidèle. */
    updateRemote(dt, input, gdt) {
      this.time += dt;
      this.matchTime += dt;
      if (this.message) this.message.t += dt;
      if (this.state === 'serve' || this.state === 'rally') this.driveHuman(this.player, input, true);
      for (const r of this.robots) {
        if (r.dive) { r.dive.t += dt; if (r.dive.t >= DIVE_TOTAL) r.dive = null; }
        if (r === this.player) this.moveRobot(r, gdt);
        else { r.x = clamp(r.x + r.vx * gdt, -3.4, 3.4); r.z += r.vz * gdt; r.walk += Math.hypot(r.vx, r.vz) * gdt * 2.2; }
        if (r.swing > 0) r.swing -= dt;
        if (r.jumpT > 0) r.jumpT -= dt;
      }
      const s = this.shuttle;
      if (this.state === 'rally') {
        const sdt = gdt * this.shuttleRate();
        const n = Math.max(1, Math.ceil(sdt / (1 / 120)));
        for (let i = 0; i < n; i++) { s.px = s.x; s.py = s.y; s.pz = s.z; P.step(s, sdt / n); s.t += sdt / n; }
        const sp = Math.hypot(s.vx, s.vy, s.vz);
        if (sp > 11) { s.trail.push({ x: s.x, y: s.y, z: s.z }); if (s.trail.length > 10) s.trail.shift(); }
        else if (s.trail.length) s.trail.shift();
      } else if (s.trail.length) s.trail.shift();
      for (const f of this.fx) f.t += dt;
      this.fx = this.fx.filter((f) => f.t < f.life);
      this.shake = Math.max(0, this.shake - dt);
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
          this.endPoint(1 - this.teamOf(this.lastHitter), 'FILET');
          return;
        }
      }
      if (s.y <= 0) { s.y = 0; s.vx = s.vy = s.vz = 0; this.resolveLanding(); }
    }

    resolveLanding() {
      const s = this.shuttle;
      const hitter = this.lastHitter;
      // Un volant qui touche le sol sans que personne l'ait frappé n'est le point de personne :
      // on remet simplement l'échange en place.
      if (!hitter) { this.setupServe(); return; }
      const mine = this.teamOf(hitter), theirs = 1 - mine;
      const landSide = s.z < 0 ? -1 : 1;
      if (!this.inCourt(s.x, s.z)) this.endPoint(theirs, 'OUT');
      else if (landSide === hitter.side) this.endPoint(theirs, 'RATÉ');
      else if (this.serveInFlight && !this.inServiceBox(s.x, s.z)) this.endPoint(theirs, 'FAUTE DE SERVICE');
      else this.endPoint(mine, mine === 0 ? 'POINT !' : this.teamRobots(mine).every((r) => r.isAI) ? 'POINT BOT' : 'POINT ADVERSE');
    }

    /** Limites du terrain : le double est plus large que le simple. */
    inCourt(x, z, tol) {
      const w = this.doubles ? COURT.halfWidthDoubles : COURT.halfWidthSingles;
      const t = tol == null ? 0.03 : tol;
      return Math.abs(x) <= w + t && Math.abs(z) <= COURT.halfLength + t;
    }
    /** Boîte de service adverse : plus large mais moins profonde en double. */
    inServiceBox(x, z) {
      if (x * this.serveBoxSign < 0) return false;
      if (Math.abs(z) < COURT.shortService) return false;
      const back = this.doubles ? COURT.longServiceDoubles : COURT.halfLength;
      return Math.abs(z) <= back + 0.03 && Math.abs(x) <= (this.doubles ? COURT.halfWidthDoubles : COURT.halfWidthSingles) + 0.03;
    }

    /** `t` est l'indice du camp qui marque : 0 le camp du joueur local, 1 celui d'en face. */
    endPoint(t, reason) {
      // Le volant lesté fait rapporter davantage : on retient le meilleur exemplaire du camp.
      const bonus = Math.max(0, ...this.teamRobots(t).map((r) => this.cardLv(r, 'shuttle')));
      this.score[t] += 1 + 0.25 * bonus;
      this.state = 'point';
      this.pointTimer = 1.5;
      this.pointWinner = t;
      // Le camp qui marque sert : le même robot s'il tenait déjà le service, l'autre sinon.
      const win = this.teamRobots(t);
      if (this.server && this.teamOf(this.server) === t) { /* il garde le service */ }
      else this.server = win.find((r) => r !== this.servedLast[t]) || win[0];
      for (const r of this.robots) { r.hold = null; r.act = null; }
      const good = t === 0;
      this.message = { text: reason, sub: good ? 'Point pour toi' : 'Point pour eux', t: 0, good };
      this.netEvent = { n: (this.netEvent ? this.netEvent.n : 0) + 1, k: 2, a: t, b: REASONS.indexOf(reason), c: 0 };
      this.events.push({ type: 'point', winner: t, reason });
    }

    /** −1 : on continue. 0 : palier franchi (carte). 1 : le bot a fait 15, la run s'arrête. */
    matchWinner() {
      if (this.score[1] >= LEVEL_TARGET) return 1;
      // Le palier tombe dès que l'un des deux l'atteint : une carte de rattrapage si le bot mène.
      if (Math.max(this.score[0], this.score[1]) >= this.nextStep()) return 0;
      return -1;
    }

    nextRally() {
      const w = this.matchWinner();
      if (w < 0) { this.setupServe(); return; }
      this.winner = w;
      this.state = 'end';
      if (w === 1) this.phase = 'lost';                                   // le bot a atteint 15 : la run s'arrête
      else if (this.run.solo) this.phase = 'won';                         // exhibition : le match s'arrête là
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

  root.RogueShuttle = { Game, CHASSIS, DIFFICULTY, DIFF_ORDER, SHOT_NAMES, LEVEL_COLORS, SHOTS, REASONS, SWEET, STROKE_OFF, TAP_TIME, SPREAD_TIME, SPREAD_MAX, SPREAD_BY_LEVEL, SMASH_H, SWING_TIME, SWING_HIT0, SWING_HIT1, MAX_ENERGY, JUMP_TIME, CARDS, RACKETS, HANDICAPS, CARD_STEPS, LEVEL_TARGET, UP_MAX, fmtScore, DIVE_LUNGE, DIVE_GROUND, DIVE_RISE, DIVE_TOTAL };
})(typeof window !== 'undefined' ? window : globalThis);
