/* Rogue Shuttle — jeu en ligne.
 *
 * Tout passe par la présence de la capacité `room` : c'est le seul canal de la plateforme prévu
 * pour du haut débit (coalescé et diffusé une trentaine de fois par seconde), et il n'exige aucune
 * autorisation particulière — n'importe quel spectateur peut publier la sienne, là où les évènements
 * sont réservés aux personnes qui peuvent éditer. Aucun `emit`, donc aucun topic à ouvrir.
 *
 * Un joueur héberge : il simule la partie et publie l'état complet. Les autres publient leurs
 * entrées et rejouent l'état reçu. Rien n'est conservé : si la page se recharge, la table disparaît.
 *
 * Hors de claude.ai la capacité n'existe pas : on retombe alors sur `RoomRTC`, qui offre la même
 * surface au-dessus de WebRTC. La couche ci-dessous ne sait pas lequel des deux la porte.
 */
(function (root) {
  'use strict';

  const PROTO = 1;
  const SEATS = { duel: 2, coop: 2 };        // nombre d'humains attendus par mode
  /* Cadence de publication. Soixante images par seconde d'état complet, c'est plus que ce qu'un
   * lien mobile transporte — et la plateforme regroupe de toute façon les présences autour de
   * trente. On s'aligne dessus, sauf pour un appui ou un relâchement, qui partent sur-le-champ. */
  const NET_HZ = 30;
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
      // Identité que ce joueur publie lui-même. Les transports n'étiquettent pas les pairs de la
      // même façon, et l'un d'eux peut ne jamais nous dire lequel nous sommes : on ne le leur
      // demande plus. Tant qu'on ne se reconnaît pas dans la table, on refuse de jouer.
      this.pid = newPid();
      this.creator = false;      // a ouvert la table : c'est lui qui hébergera
      this.roster = null;        // composition figée au coup d'envoi : [pid, …], hôte en tête
      this.slot = -1;            // sa place dans cette composition
      this.hosting = false;
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
      this.warn = null;          // refus de présence : la liaison est ouverte mais rien ne passe
      this.pressSeq = 0;
      this.relSeq = 0;
      this.seenPress = {};
      this.seenRel = {};
      this.seenN = {};           // dernière image reçue de chaque joueur, pour ignorer les retardataires
      this.outN = 0;             // numéro de l'image que cet invité publie
      this.sentAtMs = 0;         // dernière publication, pour tenir la cadence
      this.goneSince = 0;        // début d'une absence, pour ne pas couper sur un simple hoquet
      this.sentAt = {};          // numéro d'instantané → date d'envoi, pour mesurer l'aller-retour
      this.lastEvent = 0;
      this.phase = null;         // 'choose' pendant le choix des cartes, 'ready' une fois choisi
      this.kind = null;          // 'room' sur claude.ai, 'rtc' partout ailleurs
      this.rtc = null;
    }

    /** Le transport propose-t-il un annuaire des tables ouvertes ? Seul `room` le peut. */
    canBrowse() { return this.kind === 'room'; }

    /** Se connecte au meilleur transport disponible : la capacité `room` sur claude.ai, sinon WebRTC.
     *  Résout false quand aucun des deux n'est possible — le jeu reste alors purement solo. */
    async connect() {
      if (this.room) return true;
      let r = null;
      if (root.claude && typeof root.claude.use === 'function') {
        try { r = await root.claude.use('room'); } catch (_) { r = null; }
      }
      if (r) this.kind = 'room';
      else if (root.RoomRTC && root.RoomRTC.available()) { r = this.rtc = new root.RoomRTC(); this.kind = 'rtc'; }
      if (!r) return false;
      this.room = r;
      r.onPeers((change) => {
        this.peers = change.peers;
        this.onChange();
      }, (e) => { this.error = e.code; this.room = null; this.onChange(); });
      r.onConnection(() => this.onChange(), () => {});
      return true;
    }

    connected() { return !!this.room && this.room.connected(); }

    /* ------------------------------------------------------------------ salon */

    /** Ce que ce joueur publie tant qu'il est au salon. */
    lobbyPresence() {
      return { v: PROTO, t: this.table, m: this.mode, g: this.game, ch: this.chassis, pid: this.pid,
               hs: this.creator ? 1 : 0,
               nm: this.name || null, rd: this.ready ? 1 : 0, st: this.state, ph: this.phase || null };
    }

    push(extra) {
      if (!this.room) return;
      const p = Object.assign(this.lobbyPresence(), extra || {});
      // La plateforme ne demande son accord au spectateur qu'au premier appel : un refus arrive ici,
      // pas au `use()`. On le traite comme une absence de salon plutôt que de l'avaler en silence.
      this.room.presence(p).then(
        () => { if (this.warn) { this.warn = null; this.onChange(); } },
        (e) => {
          const code = (e && e.code) || 'erreur';
          if (code === 'not_granted' || code === 'revoked' || code === 'capability_disabled'
              || code === 'capability_removed' || code === 'not_permitted') {
            this.error = code; this.room = null; this.state = 'off'; this.table = null;
            this.onChange();
          // Un refus d'une autre nature — instantané trop gros, valeur refusée — ne se voyait nulle
          // part : la partie continuait en silence sans que rien ne circule. On le dit maintenant.
          } else if (this.warn !== code) { this.warn = code; this.onChange(); }
        });
    }

    /** Pairs valides d'une table, dans l'ordre qui décide des places et de l'hôte.
     *  La plateforme retire un pair dès qu'il s'en va, donc la seule présence suffit à le compter :
     *  `updatedAt` ne bouge qu'au changement, il ne dirait rien d'un joueur prêt qui attend sans agir. */
    members(table) {
      return this.peers
        .filter((p) => p.kind === 'viewer' && p.presence && p.presence.v === PROTO
                       && p.presence.t === table && p.presence.pid)
        .slice()
        // Le même ordre sur les deux écrans : celui qui a ouvert la table passe devant — il héberge —
        // puis les autres par identité. Trier des étiquettes de transport ne disait rien au joueur et
        // pouvait désigner comme hôte celui qui venait d'arriver.
        .sort((a, b) => {
          const ha = a.presence.hs ? 0 : 1, hb = b.presence.hs ? 0 : 1;
          if (ha !== hb) return ha - hb;
          return a.presence.pid < b.presence.pid ? -1 : a.presence.pid > b.presence.pid ? 1 : 0;
        });
    }

    /** Tables ouvertes, pour la liste du salon. */
    tables() {
      const by = new Map();
      for (const p of this.peers) {
        const q = p.presence;
        if (p.kind !== 'viewer' || !q || q.v !== PROTO || !q.t) continue;
        if (!by.has(q.t)) by.set(q.t, { code: q.t, mode: q.m, game: q.g, players: [], playing: false });
        const t = by.get(q.t);
        t.players.push({ peer: q.pid, name: q.nm, chassis: q.ch, ready: !!q.rd, me: q.pid === this.pid });
        if (q.st === 'playing') t.playing = true;
      }
      for (const t of by.values()) t.players.sort((a, b) => (a.peer < b.peer ? -1 : 1));   // par identité
      return [...by.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
    }

    host(table) { const m = this.members(table || this.table); return m.length ? m[0].presence.pid : null; }

    /** Place canonique de ce joueur : 0 pour l'hôte, 1 pour celui qui l'a rejoint.
     *  −1 quand on ne s'est pas encore reconnu dans la table : personne ne doit alors se croire à
     *  une place. Une réponse par défaut faisait tomber les deux joueurs sur la même. */
    mySlot() {
      if (this.roster) return this.slot;
      return this.members(this.table).findIndex((p) => p.presence.pid === this.pid);
    }
    /** Une fois la partie lancée, la composition est figée : les rôles ne peuvent plus changer en
     *  cours de route parce qu'une présence a hoqueté — et les deux écrans en disent la même chose. */
    isHost() { return this.roster ? this.hosting : this.mySlot() === 0; }
    /** Le pair qui tient la place `i`. */
    at(i) {
      const m = this.members(this.table);
      if (!this.roster) return m[i] || null;
      return m.find((p) => p.presence.pid === this.roster[i]) || null;
    }
    seats() { return SEATS[this.mode] || 2; }

    /** Ouvre une table. En WebRTC il faut d'abord prendre le code auprès de l'annuaire : si le code
     *  est déjà pris on en retire un autre, et on remonte l'échec plutôt que d'ouvrir un salon mort. */
    async create(mode, game, chassis, name) {
      this.mode = mode; this.game = game; this.chassis = chassis; this.name = name;
      this.ready = false; this.state = 'lobby'; this.error = null; this.creator = true;
      for (let i = 0; i < 4; i++) {
        const code = newCode();
        if (!this.rtc) { this.table = code; this.push(); return code; }
        try { await this.rtc.claim(code, true); this.table = code; this.push(); return code; }
        catch (e) {
          if (String(e.message) !== 'code déjà pris') { this.state = 'off'; this.error = e.message; throw e; }
        }
      }
      this.state = 'off'; this.error = 'annuaire saturé';
      throw new Error(this.error);
    }

    async join(code, chassis, name) {
      const t = this.tables().find((x) => x.code === code);
      if (t) { this.mode = t.mode; this.game = t.game; }
      this.chassis = chassis; this.name = name; this.ready = false; this.state = 'lobby'; this.error = null;
      this.creator = false;
      if (this.rtc) {
        try { await this.rtc.claim(code, false); }
        catch (e) { this.state = 'off'; this.error = e.message; throw e; }
      }
      this.table = code;
      this.push();
      // En WebRTC la formule vient de l'hôte : on l'adopte dès que sa présence arrive.
      return code;
    }

    /** La formule annoncée par l'hôte fait foi : l'invité s'y range. */
    adoptHost() {
      const m = this.members(this.table);
      const h = m[0] && m[0].presence;
      if (!h || h.pid === this.pid) return false;
      if ((h.m && h.m !== this.mode) || (h.g && h.g !== this.game)) {
        this.mode = h.m || this.mode; this.game = h.g || this.game;
        this.push();
        return true;
      }
      return false;
    }

    leave() {
      this.table = null; this.ready = false; this.state = 'off'; this.map = null; this.flip = false;
      this.creator = false; this.roster = null; this.slot = -1; this.hosting = false;
      this.warn = null; this.goneSince = 0;
      if (this.room) this.room.presence({ v: null, t: null, m: null, g: null, ch: null, nm: null, rd: null, st: null, s: null, i: null, dk: null, pid: null, hs: null, n: null }).catch(() => {});
      // Une table WebRTC n'existe que par sa connexion : on la referme en partant.
      if (this.rtc) { this.rtc.close(); this.rtc.error = null; }
    }

    setReady(v) { this.ready = !!v; this.push(); }
    setPhase(v) { this.phase = v; this.push(); }
    /** Tout le monde a fini de choisir sa carte : l'hôte peut lancer la manche suivante. */
    allChosen() { return this.members(this.table).every((p) => (p.presence || {}).ph === 'ready'); }
    setChassis(c) { this.chassis = c; this.push(); }

    /** La table est complète et tout le monde est prêt. */
    canStart() {
      const m = this.members(this.table);
      // Tant qu'on ne se voit pas soi-même dans la table, on ne lance rien : sans place connue les
      // deux joueurs piloteraient le même robot et aucun des deux n'arbitrerait.
      return m.length === this.seats() && m.every((p) => p.presence.rd)
        && m.some((p) => p.presence.pid === this.pid);
    }

    /* ------------------------------------------------------------------ partie */

    /** Composition à passer au moteur, vue par ce joueur : il occupe toujours la place 0. */
    seating() {
      const mine = this.mySlot();
      const humans = {};
      for (let i = 0; i < this.seats(); i++) {
        const p = this.at(i);
        const local = i === mine ? 0 : 1;
        humans[local] = { chassis: (p && p.presence && p.presence.ch) || 'balanced',
                          name: (p && p.presence && p.presence.nm) || null };
      }
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

    /** Coup d'envoi : la composition est relevée une fois pour toutes. Les deux écrans la relèvent
     *  au même moment et dans le même ordre, et plus rien ensuite ne peut la faire changer d'avis. */
    begin() {
      this.roster = this.members(this.table).map((p) => p.presence.pid);
      this.slot = this.roster.indexOf(this.pid);
      this.hosting = this.slot === 0;
      this.state = 'playing'; this.seq = 0; this.sentAt = {}; this.seenPress = {}; this.seenRel = {};
      this.seenN = {}; this.outN = 0; this.lastSeq = -1; this.sentAtMs = 0; this.goneSince = 0;
      this.lastSnapAt = now();
      this.push();
    }

    /* --------------------------------------------------------- hôte : diffuser */

    /** Publie l'état de la partie et lit les entrées des autres. À appeler une fois par image. */
    hostTick(game) {
      if (!this.room || !this.isHost()) return;
      for (let i = 1; i < this.seats(); i++) {
        const mem = this.at(i);
        if (!mem) continue;
        const q = mem.presence || {};
        const r = this.robotFor(game, i);
        if (!r) continue;
        // Aller-retour mesuré sur l'instantané que ce joueur vient d'accuser.
        const ackAt = this.sentAt[q.ack];
        if (ackAt) r.netLag = Math.max(0.01, Math.min(0.3, (performance.now() - ackAt) / 2000));
        if (q.dk) this.applyDeck(game, r, q.dk);
        const inp = q.i;
        if (!Array.isArray(inp) || inp.length < 6) continue;
        // Le canal WebRTC n'est ni fiable ni ordonné : une image d'entrées peut arriver après une
        // plus récente. La rejouer ferait repartir un appui déjà relâché — le geste se déclenchait
        // puis s'annulait, et la frappe ne partait jamais. On ne lit donc que ce qui avance.
        const key = q.pid, n = typeof q.n === 'number' ? q.n : null;
        if (n !== null) {
          const seen = this.seenN[key];
          if (seen !== undefined && n <= seen && n > seen - 120) continue;
          this.seenN[key] = n;
        }
        const f = this.mode === 'duel' ? -1 : 1;     // l'invité parle dans son repère, retourné en duel
        game.netAim(r, inp[0] * f, inp[1] * f);
        const press = inp[2], rel = inp[3], btn = inp[4] === 2 ? 'B' : 'A';
        if (this.seenPress[key] === undefined) { this.seenPress[key] = press; this.seenRel[key] = rel; continue; }
        if (press !== this.seenPress[key]) { this.seenPress[key] = press; game.netPress(r, btn, r.netLag || 0); }
        if (rel !== this.seenRel[key]) {
          this.seenRel[key] = rel;
          game.netRelease(r, btn, inp[5], inp[6] * f, inp[7] * f, r.netLag || 0);
        }
      }
      const t = now();
      if (t - this.sentAtMs < 1000 / NET_HZ) return;
      this.sentAtMs = t;
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
      const h = this.at(0);
      const snap = h && h.presence && h.presence.s;
      let got = null;
      // Même raison : un instantané plus ancien que le dernier appliqué ferait reculer la partie.
      // On le laisse passer seulement s'il repart de loin en arrière — c'est alors une manche neuve.
      const fresh = Array.isArray(snap) && (snap[0] > this.lastSeq || snap[0] < this.lastSeq - 120);
      if (fresh) {
        this.lastSeq = snap[0];
        this.lastSnapAt = now();
        got = game.applySnapshot(snap, this.map, this.flip, true, this.lag);
        if (got) this.lag = got.lag || this.lag;
      }
      const p = game.player;
      const edge = game.netOut.length > 0;
      for (const e of game.netOut) {
        if (e.k === 'p') { this.pressSeq = (this.pressSeq + 1) % 1000; this.lastBtn = e.btn; }
        else { this.relSeq = (this.relSeq + 1) % 1000; this.lastBtn = e.btn; this.lastHeld = e.held; this.lastUx = e.ux; this.lastUz = e.uz; }
      }
      game.netOut.length = 0;
      const t = now();
      // Un appui ou un relâchement part tout de suite : c'est le seul message qu'on ne peut pas
      // retarder sans que la frappe paraisse molle. Le reste suit la cadence.
      if (!edge && t - this.sentAtMs < 1000 / NET_HZ) {
        if (got && got.event && got.event.n !== this.lastEvent) { this.lastEvent = got.event.n; return got.event; }
        return null;
      }
      this.sentAtMs = t;
      this.push({
        ack: this.lastSeq || 0,
        n: ++this.outN,
        i: [r2(p.aimX || 0), r2(p.dirZ || 0), this.pressSeq, this.relSeq,
            this.lastBtn === 'B' ? 2 : 1, r2(this.lastHeld || 0), r2(this.lastUx || 0), r2(this.lastUz || 0)],
        dk: { cards: game.deck(0).cards, racket: game.deck(0).racket },
        s: null,
      });
      if (got && got.event && got.event.n !== this.lastEvent) { this.lastEvent = got.event.n; return got.event; }
      return null;
    }

    /** Le pair a-t-il disparu ? On coupe la partie plutôt que de laisser un robot figé — mais pas
     *  au premier battement de cil : sur un lien mobile une présence s'éclipse et revient, et couper
     *  là-dessus mettait fin à des parties qui se portaient bien. On attend qu'elle reste absente. */
    lostPeers() {
      if (this.state !== 'playing') { this.goneSince = 0; return false; }
      if (this.members(this.table).length >= this.seats()) { this.goneSince = 0; return false; }
      if (!this.goneSince) this.goneSince = now();
      return now() - this.goneSince > 4000;
    }

    /** Depuis combien de temps l'hôte ne dit plus rien, côté invité. Une liaison qui se tait laissait
     *  l'invité bouger son robot dans une partie où plus rien n'arrivait : il le sait maintenant. */
    silence() {
      if (this.state !== 'playing' || this.isHost() || !this.lastSnapAt) return 0;
      return (now() - this.lastSnapAt) / 1000;
    }

    /** Ce qu'on affiche pendant une partie en ligne : le rôle, le trajet, et ce qui cloche. */
    status() {
      if (this.state !== 'playing') return '';
      if (this.warn) return 'LIAISON REFUSÉE';
      if (this.mySlot() < 0) return 'PLACE INCONNUE';
      const q = this.silence();
      if (q > 2) return 'LIAISON PERDUE';
      const ms = Math.round((this.lag || 0) * 1000);
      return (this.isHost() ? 'HÔTE' : 'INVITÉ') + (ms ? ' · ' + ms + ' ms' : '');
    }
  }

  const r2 = (v) => Math.round(v * 100) / 100;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** Identité tirée au sort, publiée dans la présence : elle ne dépend d'aucun transport. */
  const newPid = () => now().toString(36).replace('.', '') + Math.random().toString(36).slice(2, 8);

  root.RogueNet = Net;
})(typeof window !== 'undefined' ? window : globalThis);
