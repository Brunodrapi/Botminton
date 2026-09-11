/* Rogue Shuttle — jeu en ligne.
 *
 * Tout passe par la présence de la capacité `room` : c'est le seul canal de la plateforme prévu
 * pour du haut débit (coalescé et diffusé une trentaine de fois par seconde), et il n'exige aucune
 * autorisation particulière — n'importe quel spectateur peut publier la sienne, là où les évènements
 * sont réservés aux personnes qui peuvent éditer. Aucun `emit`, donc aucun topic à ouvrir.
 *
 * Un joueur héberge : il simule la partie et publie l'état complet. Les autres publient leurs
 * entrées et rejouent l'état reçu. Rien n'est conservé : si la page se recharge, la table disparaît.
 */
(function (root) {
  'use strict';

  const PROTO = 1;
  const SEATS = { duel: 2, coop: 2 };        // nombre d'humains attendus par mode
  const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const newCode = () => Array.from({ length: 4 }, () => CODE[Math.floor(Math.random() * CODE.length)]).join('');

  class Net {
    constructor() {
      this.room = null;
      this.state = 'off';        // off | lobby | playing
      this.table = null;         // code de la table rejointe
      this.mode = 'duel';        // duel | coop
      this.game = 'exhib';       // exhib | run
      this.chassis = 'balanced';
      this.name = '';
      this.ready = false;
      this.seq = 0;
      this.lag = 0;              // aller simple estimé, en secondes
      this.map = null;           // ordre local → ordre de l'hôte
      this.flip = false;
      this.onChange = () => {};
      this.onStart = () => {};
      this.lastSnapAt = 0;
      this.lastSeq = -1;
      this.lastBtn = "A";
      this.lastHeld = 0;
      this.lastUx = 0;
      this.lastUz = 0;
      this.peers = [];
      this.error = null;
      this.myPeer = null;
      this.pressSeq = 0;
      this.relSeq = 0;
      this.seenPress = {};
      this.seenRel = {};
      this.sentAt = {};          // numéro d'instantané → date d'envoi, pour mesurer l'aller-retour
      this.lastEvent = 0;
      this.phase = null;         // 'choose' pendant le choix des cartes, 'ready' une fois choisi
    }

    /** Se connecte si la plateforme le permet. Résout false hors de claude.ai : le jeu reste solo. */
    async connect() {
      if (this.room) return true;
      if (typeof root.claude === 'undefined' || !root.claude || typeof root.claude.use !== 'function') return false;
      let r = null;
      try { r = await root.claude.use('room'); } catch (_) { r = null; }
      if (!r) return false;
      this.room = r;
      r.onPeers((change) => {
        this.peers = change.peers;
        const me = change.peers.find((p) => p.isMe && p.sameTab);
        if (me) this.myPeer = me.peer;
        this.onChange();
      }, (e) => { this.error = e.code; this.room = null; this.onChange(); });
      r.onConnection(() => this.onChange(), () => {});
      return true;
    }

    connected() { return !!this.room && this.room.connected(); }

    /* ------------------------------------------------------------------ salon */

    /** Ce que ce joueur publie tant qu'il est au salon. */
    lobbyPresence() {
      return { v: PROTO, t: this.table, m: this.mode, g: this.game, ch: this.chassis,
               nm: this.name || null, rd: this.ready ? 1 : 0, st: this.state, ph: this.phase || null };
    }

    push(extra) {
      if (!this.room) return;
      const p = Object.assign(this.lobbyPresence(), extra || {});
      // La plateforme ne demande son accord au spectateur qu'au premier appel : un refus arrive ici,
      // pas au `use()`. On le traite comme une absence de salon plutôt que de l'avaler en silence.
      this.room.presence(p).catch((e) => {
        const code = e && e.code;
        if (code === 'not_granted' || code === 'revoked' || code === 'capability_disabled'
            || code === 'capability_removed' || code === 'not_permitted') {
          this.error = code; this.room = null; this.state = 'off'; this.table = null;
          this.onChange();
        }
      });
    }

    /** Pairs valides d'une table, triés par identifiant : l'ordre décide des places et de l'hôte.
     *  La plateforme retire un pair dès qu'il s'en va, donc la seule présence suffit à le compter :
     *  `updatedAt` ne bouge qu'au changement, il ne dirait rien d'un joueur prêt qui attend sans agir. */
    members(table) {
      return this.peers
        .filter((p) => p.kind === 'viewer' && p.presence && p.presence.v === PROTO && p.presence.t === table)
        .slice()
        .sort((a, b) => (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
    }

    /** Tables ouvertes, pour la liste du salon. */
    tables() {
      const by = new Map();
      for (const p of this.peers) {
        const q = p.presence;
        if (p.kind !== 'viewer' || !q || q.v !== PROTO || !q.t) continue;
        if (!by.has(q.t)) by.set(q.t, { code: q.t, mode: q.m, game: q.g, players: [], playing: false });
        const t = by.get(q.t);
        t.players.push({ peer: p.peer, name: q.nm, chassis: q.ch, ready: !!q.rd, me: p.isMe && p.sameTab });
        if (q.st === 'playing') t.playing = true;
      }
      for (const t of by.values()) t.players.sort((a, b) => (a.peer < b.peer ? -1 : 1));
      return [...by.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
    }

    host(table) { const m = this.members(table || this.table); return m.length ? m[0].peer : null; }
    isHost() { return !!this.myPeer && this.host() === this.myPeer; }
    /** Place canonique de ce joueur : 0 pour l'hôte, 1 pour celui qui l'a rejoint. */
    mySlot() { return Math.max(0, this.members(this.table).findIndex((p) => p.peer === this.myPeer)); }
    seats() { return SEATS[this.mode] || 2; }

    create(mode, game, chassis, name) {
      this.mode = mode; this.game = game; this.chassis = chassis; this.name = name;
      this.table = newCode(); this.ready = false; this.state = 'lobby';
      this.push();
      return this.table;
    }

    join(code, chassis, name) {
      const t = this.tables().find((x) => x.code === code);
      if (t) { this.mode = t.mode; this.game = t.game; }
      this.table = code; this.chassis = chassis; this.name = name; this.ready = false; this.state = 'lobby';
      this.push();
    }

    leave() {
      this.table = null; this.ready = false; this.state = 'off'; this.map = null; this.flip = false;
      if (this.room) this.room.presence({ v: null, t: null, m: null, g: null, ch: null, nm: null, rd: null, st: null, s: null, i: null, dk: null }).catch(() => {});
    }

    setReady(v) { this.ready = !!v; this.push(); }
    setPhase(v) { this.phase = v; this.push(); }
    /** Tout le monde a fini de choisir sa carte : l'hôte peut lancer la manche suivante. */
    allChosen() { return this.members(this.table).every((p) => (p.presence || {}).ph === 'ready'); }
    setChassis(c) { this.chassis = c; this.push(); }

    /** La table est complète et tout le monde est prêt. */
    canStart() {
      const m = this.members(this.table);
      return m.length === this.seats() && m.every((p) => p.presence.rd);
    }

    /* ------------------------------------------------------------------ partie */

    /** Composition à passer au moteur, vue par ce joueur : il occupe toujours la place 0. */
    seating() {
      const m = this.members(this.table);
      const mine = this.mySlot();
      const humans = {};
      m.forEach((p, i) => {
        const local = i === mine ? 0 : 1;
        humans[local] = { chassis: (p.presence && p.presence.ch) || 'balanced', name: (p.presence && p.presence.nm) || null };
      });
      // Table de correspondance vers l'ordre de l'hôte. En duel les deux camps sont inversés pour
      // l'invité : il joue toujours en bas de son écran, donc son terrain est le miroir de celui de l'hôte.
      if (this.mode === 'duel') {
        this.flip = mine !== 0;
        this.map = mine === 0 ? [0, 1] : [1, 0];
        return { doubles: false, humans };
      }
      this.flip = false;
      this.map = mine === 0 ? [0, 1, 2, 3] : [2, 1, 0, 3];
      return { doubles: true, humans };
    }

    begin() { this.state = 'playing'; this.seq = 0; this.sentAt = {}; this.seenPress = {}; this.seenRel = {}; this.push(); }

    /* --------------------------------------------------------- hôte : diffuser */

    /** Publie l'état de la partie et lit les entrées des autres. À appeler une fois par image. */
    hostTick(game) {
      if (!this.room || !this.isHost()) return;
      const m = this.members(this.table);
      for (let i = 1; i < m.length; i++) {
        const q = m[i].presence || {};
        const r = this.robotFor(game, i);
        if (!r) continue;
        // Aller-retour mesuré sur l'instantané que ce joueur vient d'accuser.
        const ackAt = this.sentAt[q.ack];
        if (ackAt) r.netLag = Math.max(0.01, Math.min(0.3, (performance.now() - ackAt) / 2000));
        if (q.dk) this.applyDeck(game, r, q.dk);
        const inp = q.i;
        if (!Array.isArray(inp) || inp.length < 6) continue;
        const f = this.mode === 'duel' ? -1 : 1;     // l'invité parle dans son repère, retourné en duel
        game.netAim(r, inp[0] * f, inp[1] * f);
        const key = m[i].peer;
        const press = inp[2], rel = inp[3], btn = inp[4] === 2 ? 'B' : 'A';
        if (this.seenPress[key] === undefined) { this.seenPress[key] = press; this.seenRel[key] = rel; continue; }
        if (press !== this.seenPress[key]) { this.seenPress[key] = press; game.netPress(r, btn, r.netLag || 0); }
        if (rel !== this.seenRel[key]) {
          this.seenRel[key] = rel;
          game.netRelease(r, btn, inp[5], inp[6] * f, inp[7] * f, r.netLag || 0);
        }
      }
      this.seq++;
      this.sentAt[this.seq] = performance.now();
      for (const k in this.sentAt) if (this.seq - k > 200) delete this.sentAt[k];
      this.push({ s: game.snapshot(this.seq), i: null });
    }

    /** Le robot de la place canonique `slot`, dans la partie de l'hôte. */
    robotFor(game, slot) {
      if (this.mode === 'duel') return game.robots[slot === 0 ? 0 : 1];
      return game.robots[slot === 0 ? 0 : 2];
    }

    applyDeck(game, r, dk) {
      if (!dk || typeof dk !== 'object') return;
      const up = r.up;
      for (const k of ['cards', 'racket']) {
        const src = dk[k];
        if (!src || typeof src !== 'object') continue;
        for (const n in src) {
          const v = src[n];
          if (typeof v === 'number' && v >= 0 && v <= 3) up[k][n] = Math.floor(v);
        }
      }
    }

    /* ------------------------------------------------------- invité : recevoir */

    /** Publie les entrées locales et applique le dernier état reçu. Renvoie l'évènement à jouer. */
    guestTick(game) {
      if (!this.room || this.isHost()) return null;
      const h = this.members(this.table)[0];
      const snap = h && h.presence && h.presence.s;
      let got = null;
      if (Array.isArray(snap) && snap[0] !== this.lastSeq) {
        this.lastSeq = snap[0];
        got = game.applySnapshot(snap, this.map, this.flip, true, this.lag);
        if (got) this.lag = got.lag || this.lag;
      }
      const p = game.player;
      for (const e of game.netOut) {
        if (e.k === 'p') { this.pressSeq = (this.pressSeq + 1) % 1000; this.lastBtn = e.btn; }
        else { this.relSeq = (this.relSeq + 1) % 1000; this.lastBtn = e.btn; this.lastHeld = e.held; this.lastUx = e.ux; this.lastUz = e.uz; }
      }
      game.netOut.length = 0;
      this.push({
        ack: this.lastSeq || 0,
        i: [r2(p.aimX || 0), r2(p.dirZ || 0), this.pressSeq, this.relSeq,
            this.lastBtn === 'B' ? 2 : 1, r2(this.lastHeld || 0), r2(this.lastUx || 0), r2(this.lastUz || 0)],
        dk: { cards: game.deck(0).cards, racket: game.deck(0).racket },
        s: null,
      });
      if (got && got.event && got.event.n !== this.lastEvent) { this.lastEvent = got.event.n; return got.event; }
      return null;
    }

    /** Le pair a-t-il disparu ? On coupe la partie plutôt que de laisser un robot figé. */
    lostPeers() { return this.state === 'playing' && this.members(this.table).length < this.seats(); }
  }

  const r2 = (v) => Math.round(v * 100) / 100;

  root.RogueNet = Net;
})(typeof window !== 'undefined' ? window : globalThis);
