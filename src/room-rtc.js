/* Rogue Shuttle — salon de secours en WebRTC, pour les pages hébergées hors de claude.ai.
 *
 * La capacité `room` n'existe que dans un artefact claude.ai. Partout ailleurs — GitHub Pages, un
 * fichier ouvert en local — il faut bien que les deux navigateurs se trouvent tout seuls. On passe
 * donc par WebRTC : les données de jeu voyagent directement d'un appareil à l'autre, et un annuaire
 * public (le broker PeerJS) ne sert qu'à les présenter l'un à l'autre au moment de rejoindre.
 *
 * Ce module expose exactement la même surface que la capacité `room` — presence / peers / onPeers /
 * onConnection / connected — si bien que la couche réseau du jeu ne sait pas lequel des deux la porte.
 *
 * Deux limites à connaître : l'annuaire est un service public gratuit, il peut être lent ou
 * indisponible ; et sans serveur de relais, deux connexions derrière des réseaux très fermés
 * peuvent ne jamais s'établir. Le jeu le dit alors au lieu d'attendre indéfiniment.
 */
(function (root) {
  'use strict';

  const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js';
  const PREFIX = 'rogue-shuttle-v1-';
  /** Réglages facultatifs, à poser avant le chargement du jeu :
   *  `window.ROGUE_SHUTTLE_RTC = { lib: '…/peerjs.min.js', peer: { host, port, path, secure } }`.
   *  Sans eux on prend la bibliothèque sur cdnjs et l'annuaire public de PeerJS ; avec, on peut
   *  pointer son propre serveur de signalisation, qui ne voit jamais que des mises en relation. */
  const cfg = () => root.ROGUE_SHUTTLE_RTC || {};
  const OPEN_TIMEOUT = 12000;     // au-delà, l'annuaire ne répond pas
  const DIAL_TIMEOUT = 15000;     // au-delà, la table n'existe pas ou le pair est injoignable

  let libPromise = null;
  function loadLib() {
    if (root.Peer) return Promise.resolve(root.Peer);
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = cfg().lib || LIB;
      s.onload = () => (root.Peer ? resolve(root.Peer) : reject(new Error('peerjs absent')));
      s.onerror = () => reject(new Error('peerjs introuvable'));
      document.head.appendChild(s);
    }).catch((e) => { libPromise = null; throw e; });
    return libPromise;
  }

  class RoomRTC {
    constructor() {
      this.peer = null;
      this.conns = [];
      this.mine = {};
      this.others = new Map();      // étiquette → { presence, updatedAt }
      this.label = null;
      this.peerHandlers = [];
      this.connHandlers = [];
      this.open = false;
      this.error = null;
    }

    /** L'étiquette de l'hôte commence par 0, celle des invités par 1 : le tri qu'applique la couche
     *  réseau pour désigner l'hôte tombe donc toujours sur celui qui a créé la table. */
    static labelFor(code, asHost) {
      return (asHost ? '0-' : '1-') + code + '-' + Math.random().toString(36).slice(2, 8);
    }

    /** Ouvre la table `code` : en hôte on prend l'identifiant, en invité on l'appelle. */
    async claim(code, asHost) {
      await loadLib();
      this.close();
      this.label = RoomRTC.labelFor(code, asHost);
      const id = PREFIX + code;
      const peer = new root.Peer(asHost ? id : undefined, Object.assign({ debug: 0 }, cfg().peer));
      this.peer = peer;

      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('annuaire injoignable')), OPEN_TIMEOUT);
        peer.on('open', () => { clearTimeout(t); resolve(); });
        peer.on('error', (e) => {
          clearTimeout(t);
          // « identifiant déjà pris » veut dire que ce code de table existe déjà.
          reject(new Error(e && e.type === 'unavailable-id' ? 'code déjà pris' : (e && e.type) || 'erreur'));
        });
      });

      peer.on('error', (e) => {
        const t = e && e.type;
        if (t === 'peer-unavailable') this.fail('table introuvable');
        else if (t === 'network' || t === 'server-error' || t === 'socket-error') this.fail('annuaire injoignable');
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) { /* on réessaiera */ } });

      if (asHost) {
        peer.on('connection', (c) => this.wire(c));
      } else {
        const c = peer.connect(id, { reliable: false, serialization: 'json' });
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('table introuvable')), DIAL_TIMEOUT);
          c.on('open', () => { clearTimeout(t); resolve(); });
          c.on('error', () => { clearTimeout(t); reject(new Error('table introuvable')); });
        });
        this.wire(c);
      }
      this.open = true;
      this.fire();
      for (const h of this.connHandlers) h(true);
      return code;
    }

    /** Branche une connexion : on se présente, puis chaque message remplace la présence du pair. */
    wire(c) {
      this.conns.push(c);
      c.on('open', () => { this.send(c, this.mine); this.fire(); });
      if (c.open) this.send(c, this.mine);
      c.on('data', (d) => {
        if (!d || typeof d !== 'object' || typeof d.from !== 'string') return;
        // La présence est renvoyée entière à chaque image : un message perdu se répare tout seul.
        this.others.set(d.from, { presence: d.p && typeof d.p === 'object' ? d.p : {}, updatedAt: Date.now() });
        // L'hôte fait suivre aux autres, pour que tout le monde voie tout le monde.
        for (const o of this.conns) if (o !== c && o.open) { try { o.send(d); } catch (_) { /* ignore */ } }
        this.fire();
      });
      const gone = () => {
        this.conns = this.conns.filter((x) => x !== c);
        for (const [k, v] of this.others) if (v.conn === c) this.others.delete(k);
        // Sans annuaire des étiquettes, on purge celles qui ne sont plus portées par une connexion.
        if (!this.conns.length) this.others.clear();
        this.fire();
      };
      c.on('close', gone);
      c.on('error', gone);
    }

    send(c, presence) {
      if (!c || !c.open) return;
      try { c.send({ from: this.label, p: presence }); } catch (_) { /* la prochaine image réessaiera */ }
    }

    fail(msg) {
      this.error = msg;
      this.open = false;
      for (const h of this.connHandlers) h(false);
      this.fire();
    }

    /* ---------------------------------------------- surface identique à la capacité `room` */

    presence(patch) {
      for (const k in patch) { if (patch[k] === null) delete this.mine[k]; else this.mine[k] = patch[k]; }
      for (const c of this.conns) this.send(c, this.mine);
      this.fire();
      return Promise.resolve();
    }

    peers() {
      const list = [{ peer: this.label, by: null, isMe: true, sameTab: true, kind: 'viewer',
                      presence: this.mine, updatedAt: Date.now() }];
      for (const [k, v] of this.others)
        list.push({ peer: k, by: null, isMe: false, sameTab: false, kind: 'viewer',
                    presence: v.presence, updatedAt: v.updatedAt });
      return list;
    }

    fire() {
      const p = this.peers();
      for (const h of this.peerHandlers) h({ peers: p, joined: p, left: [], updated: [] });
    }

    onPeers(h) {
      this.peerHandlers.push(h);
      setTimeout(() => h({ peers: this.peers(), joined: this.peers(), left: [], updated: [] }), 0);
      return () => { this.peerHandlers = this.peerHandlers.filter((x) => x !== h); };
    }

    onConnection(h) {
      this.connHandlers.push(h);
      setTimeout(() => h(this.open), 0);
      return () => { this.connHandlers = this.connHandlers.filter((x) => x !== h); };
    }

    connected() { return this.open && this.conns.some((c) => c.open); }

    close() {
      for (const c of this.conns) { try { c.close(); } catch (_) { /* ignore */ } }
      this.conns = [];
      this.others.clear();
      if (this.peer) { try { this.peer.destroy(); } catch (_) { /* ignore */ } }
      this.peer = null;
      this.open = false;
    }
  }

  RoomRTC.available = () => typeof RTCPeerConnection !== 'undefined';
  root.RoomRTC = RoomRTC;
})(typeof window !== 'undefined' ? window : globalThis);
