/* Rogue Shuttle — amorçage : DOM, boucle, HUD, menus. */
(function () {
  'use strict';
  const RS = window.RogueShuttle;
  const $ = (id) => document.getElementById(id);

  const canvas = $('c');
  const renderer = new window.Renderer(canvas);
  const game = new RS.Game();
  const sfx = new window.Sfx();
  const input = new window.Input({
    dpad: $('dpad'), dpadZone: $('dpadZone'),
    buttons: document.querySelectorAll('#buttons .btn'),
    onAny: () => sfx.unlock(),
  });

  const settings = { chassis: 'balanced', difficulty: 'rookie', assist: false, name: '' };
  const net = new window.RogueNet();
  try {
    const saved = JSON.parse(localStorage.getItem('rogue-shuttle-settings') || 'null');
    if (saved) Object.assign(settings, saved);
  } catch (_) { /* ignore */ }
  const saveSettings = () => { try { localStorage.setItem('rogue-shuttle-settings', JSON.stringify(settings)); } catch (_) { /* ignore */ } };

  /* ---------------------------------------------------------------- menus */
  function buildCards(container, defs, key, onPick) {
    container.innerHTML = '';
    for (const k of Object.keys(defs)) {
      const d = defs[k];
      const b = document.createElement('button');
      b.className = 'card' + (settings[key] === k ? ' selected' : '');
      b.style.setProperty('--card-color', d.color);
      b.innerHTML = `<div class="title">${d.name}</div><div class="desc">${(d.desc || []).join('<br>')}</div>`;
      b.addEventListener('click', () => {
        settings[key] = k; saveSettings();
        for (const c of container.children) c.classList.remove('selected');
        b.classList.add('selected');
        if (onPick) onPick(k);
      });
      container.appendChild(b);
    }
  }
  buildCards($('chassisCards'), RS.CHASSIS, 'chassis');
  $('assistToggle').checked = !!settings.assist;
  $('assistToggle').addEventListener('change', (e) => { settings.assist = e.target.checked; saveSettings(); });
  const panels = ['splash', 'menu', 'solo', 'options', 'help', 'pause', 'end', 'choice', 'malus', 'opponents', 'chassis', 'online', 'lobby'];
  const LOBBY = ['splash', 'menu', 'solo', 'options', 'help', 'chassis', 'opponents', 'online', 'lobby'];
  function showPanel(name) {
    for (const p of panels) $(p).classList.toggle('hidden', p !== name);
    const playing = !name;
    $('hud').classList.toggle('hidden', LOBBY.indexOf(name) >= 0);
    $('pad').classList.toggle('hidden', !playing);
    layout();
  }

  function startRun() {
    sfx.unlock();
    handicapShown = null;
    game.startRun(settings);
    beginRound();
  }

  /** Le châssis se choisit dans les deux modes, juste après le mode. */
  let pendingMode = 'run';
  function showChassis(mode) {
    pendingMode = mode;
    $('chassisSub').textContent = mode === 'run'
      ? 'Rogue lite · il t\'accompagne pour toute la run'
      : 'Exhibition · un match libre en 15 points';
    $('chassisGo').textContent = mode === 'run' ? 'COMMENCER LA RUN' : 'CHOISIR L\'ADVERSAIRE';
    showPanel('chassis');
  }

  /** Exhibition : un match libre en 15 points, sans cartes ni protocole. */
  const OPP_DESC = { rookie: 'BW-01 · lent et hésitant', pro: 'RG-02 · solide, il smashe', elite: 'RG-03 · volant, très rapide', boss: 'ZG-04 · deux raquettes, sans pitié' };
  function showOpponents() {
    $('oppList').innerHTML = RS.DIFF_ORDER.map((k) => {
      const d = RS.DIFFICULTY[k];
      return `<button class="choice" data-key="${k}">
        <span class="ico">🤖</span>
        <span class="txt"><span class="nm" style="color:${d.color}">${d.name}</span><span class="ds">${OPP_DESC[k]}</span></span>
      </button>`;
    }).join('');
    for (const btn of $('oppList').querySelectorAll('.choice')) {
      btn.addEventListener('click', () => {
        sfx.unlock();
        handicapShown = null;
        settings.difficulty = btn.dataset.key; saveSettings();
        game.startExhibition(settings);
        beginRound();
      });
    }
    showPanel('opponents');
  }

  /* ---------------------------------------------------------------- en ligne */
  // Deux formules, pas davantage : le rogue lite se joue contre la machine, donc un duel entre
  // deux humains est forcément un match libre, et jouer à deux du même côté appelle la run.
  const FORMULAS = {
    duel: { mode: 'duel', game: 'exhib', name: 'DUEL 1v1', desc: ['Chacun son camp', 'match en 15 points'] },
    coop: { mode: 'coop', game: 'run', name: 'COOP 2v2', desc: ['À deux contre', 'la machine · rogue lite'] },
  };
  const formulaOf = (mode) => FORMULAS[mode] || FORMULAS.duel;
  // Sur claude.ai le salon ne relie que des spectateurs connectés au même compte : pour jouer avec
  // qui l'on veut, il faut la page publique, où deux navigateurs se parlent directement.
  const PUBLIC_URL = 'brunodrapi.github.io/Botminton';
  const netSettings = { formula: 'duel' };

  function pickRow(el, defs, current, onPick, off) {
    el.innerHTML = '';
    for (const k of Object.keys(defs)) {
      const d = defs[k];
      const b = document.createElement('button');
      const dead = off && off.indexOf(k) >= 0;
      b.className = 'card' + (current === k ? ' selected' : '') + (dead ? ' dead' : '');
      b.disabled = !!dead;
      b.innerHTML = `<div class="title">${d.name}</div><div class="desc">${(dead ? d.off || d.desc : d.desc).join('<br>')}</div>`;
      if (!dead) b.addEventListener('click', () => { sfx.unlock(); onPick(k); });
      el.appendChild(b);
    }
  }

  function renderOnline() {
    if ($('online').classList.contains('hidden')) return;
    const st = $('onlineState');
    const dead = !net.room;                      // aucun transport ici : inutile de faire semblant
    $('netOffline').classList.toggle('hidden', !dead);
    for (const id of ['netMode', 'netName', 'netTables', 'netCreate', 'netHint']) $(id).classList.toggle('hidden', dead);
    $('netCode').parentElement.classList.toggle('hidden', dead);
    for (const h of $('online').querySelectorAll('h2')) h.classList.toggle('hidden', dead);
    if (dead) {
      st.textContent = 'Indisponible sur cette page';
      $('netWhy').innerHTML = net.onClaude
        ? `Sur claude.ai, le jeu en ligne ne relie que des spectateurs <b>connectés au même compte</b>.
           Pour jouer avec quelqu\u2019un d\u2019autre, ouvrez tous les deux <b>${PUBLIC_URL}</b> :
           là, les deux navigateurs se parlent directement.`
        : `Ce navigateur ne sait pas ouvrir de connexion directe : il n\u2019y a aucun moyen
           d\u2019atteindre un autre joueur d\u2019ici.`;
      return;
    }
    st.textContent = netBusy || (net.kind === 'room'
      ? `${net.livePeers().filter((p) => p.kind === 'viewer').length} personne(s) sur cette page`
      : 'Connexion directe entre navigateurs');
    // Sans annuaire, on ne peut pas lister les tables : on échange le code de vive voix.
    $('netHint').innerHTML = net.canBrowse()
      ? `Ici, seules les personnes connectées au même compte peuvent te rejoindre. Pour jouer avec
         n\u2019importe qui, ouvrez tous les deux <b>${PUBLIC_URL}</b>.`
      : 'Crée une table, donne son code à l\u2019autre joueur — il le saisit ci-dessus.';
    $('netTables').classList.toggle('hidden', !net.canBrowse());
    $('netCreate').disabled = !!netBusy;
    $('netCreate').style.opacity = netBusy ? 0.45 : 1;
    pickRow($('netMode'), FORMULAS, netSettings.formula, (k) => { netSettings.formula = k; renderOnline(); });
    const tables = net.room ? net.tables().filter((t) => !t.players.some((p) => p.me)) : [];
    $('netTables').innerHTML = tables.length ? tables.map((t) => {
      const full = t.players.length >= 2 || t.playing;
      return `<button class="choice" data-code="${t.code}" ${full ? 'disabled style="opacity:.5"' : ''}>
        <span class="ico">${t.mode === 'coop' ? '🤝' : '⚔️'}</span>
        <span class="txt"><span class="nm">${t.code} · ${formulaOf(t.mode).name}</span>
        <span class="ds">${t.players.map((p) => p.name || 'PILOTE').join(', ')}${full ? ' · complet' : ''}</span></span>
      </button>`;
    }).join('') : '<p class="tag">Aucune table pour l\u2019instant — crée la tienne.</p>';
    for (const b of $('netTables').querySelectorAll('.choice[data-code]')) {
      b.addEventListener('click', () => {
        if (b.hasAttribute('disabled')) return;
        enterTable(() => net.join(b.dataset.code, settings.chassis, settings.name), 'Connexion à la table…');
      });
    }
  }

  let netBusy = '';
  async function showOnline() {
    showPanel('online');
    $('netName').value = settings.name || '';
    netBusy = 'Connexion…';
    renderOnline();
    await net.connect();
    netBusy = '';
    renderOnline();
  }

  /** Ouvre ou rejoint une table, en montrant ce qui se passe : l'annuaire peut être lent. */
  async function enterTable(run, busy) {
    if (netBusy) return;
    sfx.unlock();
    settings.name = ($('netName').value || '').toUpperCase().slice(0, 10); saveSettings();
    netBusy = busy;
    renderOnline();
    try {
      await run();
      netBusy = '';
      showLobby();
    } catch (e) {
      netBusy = '';
      renderOnline();
      $('onlineState').textContent = String((e && e.message) || e);
    }
  }

  function showLobby() {
    showPanel('lobby');
    renderLobby();
  }

  function renderLobby() {
    if ($('lobby').classList.contains('hidden') || !net.table) return;
    if (net.adoptHost()) { /* la formule de l'hôte fait foi */ }
    const members = net.members(net.table);
    const seats = net.seats();
    $('lobbyCode').textContent = net.table;
    $('lobbySub').textContent = formulaOf(net.mode).name
      + (net.isHost() ? (net.canBrowse() ? ' · tu héberges' : ' · donne ce code à l\u2019autre joueur') : '');
    // Seul dans un salon, rien ne disait si quelqu'un pouvait seulement arriver : sur claude.ai il
    // faut que l'autre ait la page ouverte ET soit connecté au même compte, ce qui ne se devine pas.
    const alone = members.length < seats;
    const here = net.livePeers().filter((p) => p.kind === 'viewer').length;
    $('lobbyWho').innerHTML = !alone ? ''
      : net.canBrowse()
        ? (here > 1
            ? `${here} personnes ont cette page ouverte — l\u2019autre doit rejoindre la table ${net.table}.`
            : `Tu es seul sur cette page. Ici, seul un appareil <b>connecté à ton compte</b> peut te
               rejoindre — sinon, ouvrez tous les deux <b>${PUBLIC_URL}</b>.`)
        : `Donne le code <b>${net.table}</b> à l\u2019autre joueur : il le saisit dans EN LIGNE.`;
    const rows = [];
    for (let i = 0; i < seats; i++) {
      const m = members[i];
      if (!m) { rows.push('<div class="seat empty"><span class="dot"></span><span class="who">En attente d\u2019un joueur…</span></div>'); continue; }
      const q = m.presence || {};
      const mine = m.presence.pid === net.pid;
      const camp = net.mode === 'coop' ? 'même camp' : (i === 0 ? 'camp du bas' : 'camp du haut');
      rows.push(`<div class="seat ${q.rd ? 'ok' : ''}"><span class="dot"></span>
        <span class="who">${(q.nm || 'PILOTE')}${mine ? ' (toi)' : ''}
        <span class="tagline">${RS.CHASSIS[q.ch] ? RS.CHASSIS[q.ch].name : '?'} · ${camp} · ${q.rd ? 'prêt' : 'choisit…'}</span></span></div>`);
    }
    $('lobbySeats').innerHTML = rows.join('');
    pickRow($('lobbyChassis'), RS.CHASSIS, settings.chassis, (k) => {
      settings.chassis = k; saveSettings(); net.setChassis(k); renderLobby();
    });
    $('lobbyReady').textContent = net.ready ? 'ANNULER' : 'JE SUIS PRÊT';
    if (net.canStart() && net.state !== 'playing') startNetMatch();
  }

  /** Les deux côtés composent la même partie : chacun se met en place 0, chez lui. */
  function startNetMatch() {
    net.begin();                 // la composition est figée d'abord : c'est elle qui donne les places
    const seat = net.seating();
    handicapShown = null;
    const opts = { chassis: settings.chassis, assist: settings.assist, doubles: seat.doubles, humans: seat.humans };
    if (net.game === 'run') game.startRun(opts);
    else { opts.difficulty = net.mode === 'duel' ? 'rookie' : settings.difficulty; game.startExhibition(opts); }
    beginRound();
  }

  function quitNet() {
    net.leave();
    game.state = 'menu';
    showPanel('menu');
  }

  net.onChange = () => { renderOnline(); renderLobby(); };

  /** Reprend la partie après le menu ou après un choix de carte. */
  let handicapShown = null;
  function beginRound() {
    $('chassisName').textContent = RS.CHASSIS[settings.chassis].name;
    $('foeKind').textContent = 'BOT';
    $('diffName').textContent = game.diff.name;
    endShown = false;
    updateDeck();
    applyHandicapFilter();
    const h = game.run.handicap;
    if (h && handicapShown !== h.key) {          // annonce du protocole avant le premier point du boss
      handicapShown = h.key;
      $('malusCard').innerHTML = `<span class="ico">${h.icon}</span><span><span class="nm">${h.name}</span><span class="ds">${h.desc}</span></span>`;
      game.pause();
      showPanel('malus');
      return;
    }
    showPanel(null);
  }

  /** Les protocoles purement visuels passent par un filtre CSS sur le canvas. */
  function applyHandicapFilter() {
    const k = game.run && game.run.handicap ? game.run.handicap.key : null;
    canvas.classList.toggle('fx-mono', k === 'mono');
    canvas.classList.toggle('fx-sepia', k === 'sepia');
    canvas.classList.toggle('fx-flip', k === 'flip');
  }

  /* ---------------------------------------------------------------- améliorations */
  const ALL_UPS = RS.CARDS.concat(RS.RACKETS);
  function upDef(k) { return ALL_UPS.find((u) => u.key === k); }
  function ownedList() {
    const d = game.deck ? game.deck(0) : { cards: {}, racket: {} };
    return Object.keys(d.cards).map((k) => [k, d.cards[k]]).concat(Object.keys(d.racket).map((k) => [k, d.racket[k]]));
  }
  function updateDeck() {
    const list = ownedList();
    $('deck').classList.toggle('hidden', !list.length);
    const h = game.run && game.run.handicap;
    $('deck').classList.toggle('hidden', !list.length && !h);
    $('deck').innerHTML = (h ? `<span class="chip malus" title="${h.name}">${h.icon}</span>` : '')
      + list.map(([k, n]) => `<span class="chip">${upDef(k).icon}<b>${n}</b></span>`).join('');
  }
  function deckBig(el) {
    const list = ownedList();
    el.innerHTML = list.length
      ? list.map(([k, n]) => `<span title="${upDef(k).name}">${upDef(k).icon}<b>${n}</b></span>`).join('')
      : '<span style="font-size:7px">aucune amélioration</span>';
  }

  /** Écran de choix : trois cartes, ou trois modificateurs de raquette. */
  function showChoice(kind) {
    const isCard = kind === 'cards';
    const step = game.nextStep();
    const list = isCard ? game.offerCards() : game.offerRackets();
    if (!list.length) { afterChoice(kind); return; }
    const ahead = game.score[0] >= game.score[1];
    $('choiceTitle').textContent = isCard ? `PALIER ${RS.fmtScore(step)}` : 'NIVEAU FRANCHI';
    $('choiceSub').textContent = isCard
      ? `${ahead ? 'Tu mènes' : 'Le bot mène'} ${RS.fmtScore(game.score[0])} – ${RS.fmtScore(game.score[1])} · choisis une pièce`
      : 'Choisis un modificateur de raquette';
    const owned = isCard ? game.deck(0).cards : game.deck(0).racket;
    $('choiceWait').textContent = '';
    $('choiceList').innerHTML = list.map((u) => {
      const n = (owned[u.key] || 0) + 1;
      const pips = Array.from({ length: RS.UP_MAX }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      return `<button class="choice" data-key="${u.key}">
        <span class="ico">${u.icon}</span>
        <span class="txt"><span class="nm">${u.name}</span><span class="ds">${u.desc(n)}</span></span>
        <span class="lv">${pips}</span>
      </button>`;
    }).join('');
    for (const btn of $('choiceList').querySelectorAll('.choice')) {
      btn.addEventListener('click', () => {
        sfx.unlock();
        if (isCard) game.takeCard(btn.dataset.key); else game.takeRacket(btn.dataset.key);
        afterChoice(kind);
      });
    }
    showPanel('choice');
  }

  function afterChoice(kind) {
    if (kind === 'cards' && game.pendingRacket) { showChoice('racket'); return; }
    if (net.state === 'playing') {
      // En ligne, on attend que tout le monde ait choisi : c'est l'hôte qui lance la manche suivante.
      net.setPhase('ready');
      $('choiceList').innerHTML = '';
      $('choiceWait').textContent = 'En attente de l\u2019autre joueur…';
      return;
    }
    game.advance();
    beginRound();
  }

  /** Appelée à chaque image pendant une partie en ligne : synchronise les écrans de carte. */
  function netRoundSync() {
    if (net.state !== 'playing') return;
    if (net.isHost()) {
      if (game.state === 'end' && net.phase === 'ready' && net.allChosen()) {
        net.setPhase(null);
        game.advance();
        beginRound();
      }
    } else if (game.hostRound != null && game.hostRound !== (game.roundSeq || 0)) {
      // L'hôte a lancé la manche suivante : on avance d'autant chez soi.
      net.setPhase(null);
      while ((game.roundSeq || 0) < game.hostRound) game.advance();
      beginRound();
    }
  }

  $('onlineBtn').addEventListener('click', () => { sfx.unlock(); showOnline(); });
  $('netBack').addEventListener('click', () => showPanel('menu'));   // le salon revient à l'accueil
  $('netCreate').addEventListener('click', () => {
    if (!net.room) return;
    const f = formulaOf(netSettings.formula);
    enterTable(() => net.create(f.mode, f.game, settings.chassis, settings.name), 'Ouverture de la table…');
  });
  const joinTyped = () => {
    const code = ($('netCode').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (!net.room || code.length < 4) return;
    enterTable(() => net.join(code, settings.chassis, settings.name), `Recherche de la table ${code}…`);
  };
  $('netJoin').addEventListener('click', joinTyped);
  $('netCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinTyped(); });
  $('netName').addEventListener('change', () => {
    settings.name = ($('netName').value || '').toUpperCase().slice(0, 10); saveSettings();
    if (net.table) { net.name = settings.name; net.push(); }
  });
  $('lobbyReady').addEventListener('click', () => { sfx.unlock(); net.setReady(!net.ready); renderLobby(); });
  $('lobbyLeave').addEventListener('click', () => { sfx.unlock(); quitNet(); });
  $('soloBtn').addEventListener('click', () => { sfx.unlock(); showPanel('solo'); });
  $('soloBack').addEventListener('click', () => showPanel('menu'));
  $('optionsBtn').addEventListener('click', () => { sfx.unlock(); showPanel('options'); });
  $('optionsBack').addEventListener('click', () => showPanel('menu'));
  $('playBtn').addEventListener('click', () => showChassis('run'));
  $('chassisGo').addEventListener('click', () => { sfx.unlock(); if (pendingMode === 'run') startRun(); else showOpponents(); });
  $('chassisBack').addEventListener('click', () => showPanel('solo'));
  $('malusBtn').addEventListener('click', () => { game.resume(); showPanel(null); });
  $('exhibBtn').addEventListener('click', () => showChassis('exhib'));
  $('oppBack').addEventListener('click', () => showChassis('exhib'));
  $('helpBtn').addEventListener('click', () => showPanel('help'));
  $('helpBack').addEventListener('click', () => showPanel('menu'));   // l'aide a son bouton propre à l'accueil
  $('pauseBtn').addEventListener('click', () => {
    if (game.state === 'paused') return;
    // En ligne, la partie ne s'arrête pas pour les autres : on le dit plutôt que de mentir.
    const online = net.state === 'playing';
    $('pause').querySelector('h1').textContent = online ? 'TA TABLE' : 'PAUSE';
    $('resumeBtn').textContent = online ? 'Retour au jeu' : 'Reprendre';
    $('quitBtn').textContent = online ? 'Quitter la table' : 'Abandonner la run';
    if (!online) game.pause();
    deckBig($('pauseDeck'));
    showPanel('pause');
  });
  $('resumeBtn').addEventListener('click', () => { game.resume(); showPanel(null); });
  $('quitBtn').addEventListener('click', () => { if (net.table) quitNet(); else { game.state = 'menu'; showPanel('menu'); } });
  $('replayBtn').addEventListener('click', () => { if (game.run.solo) { game.startExhibition(settings); beginRound(); } else startRun(); });
  $('menuBtn').addEventListener('click', () => { if (net.table) quitNet(); else { game.state = 'menu'; showPanel('menu'); } });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (game.state === 'paused') { game.resume(); showPanel(null); }
      else if (game.state !== 'menu' && game.state !== 'end') $('pauseBtn').click();
    }
    if (e.key === 'Enter' && !$('menu').classList.contains('hidden')) showPanel('solo');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && net.state !== 'playing' && game.state !== 'menu' && game.state !== 'end') { game.pause(); showPanel('pause'); }
  });

  /* ---------------------------------------------------------------- layout */
  function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const hud = $('hud').getBoundingClientRect();
    const top = ($('hud').classList.contains('hidden') ? 0 : hud.bottom) + 2;
    let bottom = h - 8;
    const portrait = h > w;
    if (portrait && !$('pad').classList.contains('hidden')) bottom = Math.min($('dpad').getBoundingClientRect().top, $('buttons').getBoundingClientRect().top) - 6;
    else if (portrait) bottom = h - 220;
    renderer.resize(w, h, { top, bottom });
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 150));

  /* ---------------------------------------------------------------- HUD */
  let endShown = false;
  let lastServing = null;
  /** N'écrit dans le DOM que si le texte change : appelable à chaque image sans rien coûter. */
  const setText = (id, v) => { const el = $(id); if (el.textContent !== v) el.textContent = v; };
  const heatPct = $('heatPct');
  const heatBars = { you: $('heatBar'), bot: $('heatBarBot') };
  for (const k in heatBars) { heatBars[k].innerHTML = ''; for (let i = 0; i < 10; i++) { const d = document.createElement('i'); heatBars[k].appendChild(d); } }
  function setHeat(bar, heat) {
    const n = Math.round(heat / 10);
    for (let i = 0; i < 10; i++) { const seg = bar.children[i]; seg.className = i < n ? (i >= 8 ? 'on hot' : i >= 5 ? 'on warm' : 'on') : ''; }
  }
  function updateHud() {
    if (game.state === 'menu') return;
    const you = RS.fmtScore(game.score[0]), bot = RS.fmtScore(game.score[1]);
    $('scoreYou').textContent = you;
    $('scoreBot').textContent = bot;
    // un score fractionnaire (volant lesté) tient sur quatre ou cinq signes : on réduit la taille
    $('scoreYou').classList.toggle('long', you.length > 2);
    $('scoreBot').classList.toggle('long', bot.length > 2);
    $('stage').textContent = game.run.solo
      ? `EXHIBITION · ${RS.fmtScore(game.score[0])} / ${RS.LEVEL_TARGET}`
      : `NIVEAU ${game.run.level + 1} · PALIER ${RS.fmtScore(game.nextStep())}`;
    const p = game.player, b = game.bot;
    setHeat(heatBars.you, p.energy); setHeat(heatBars.bot, b.energy);
    // Les étiquettes se comparent à ce qui est affiché plutôt que de se fier à un état résumé :
    // deux matchs de suite dans la même formule donnaient le même résumé, donc plus rien ne se
    // remettait à jour et l'adversaire humain restait annoncé « BOT ».
    const mate = game.partner(p);
    const foe = game.robots.find((r) => r.side > 0 && !r.isAI);
    // En face d'un humain, ce n'est plus un bot : le dire évite de chercher qui est qui.
    setText('chassisName', mate && !mate.isAI ? `+${mate.name || 'ALLIÉ'}` : RS.CHASSIS[settings.chassis].name);
    setText('foeKind', foe ? 'FACE' : 'BOT');
    setText('diffName', foe ? (foe.name || 'PILOTE') : game.diff.name);
    // L'état de la liaison, en toutes lettres : sans lui une partie en ligne muette ressemble
    // à une partie normale où l'on bouge sans que rien n'arrive jamais.
    const tag = net.status();
    $('netTag').classList.toggle('hidden', !tag);
    if (tag) {
      $('netTag').textContent = tag;
      $('netTag').classList.toggle('bad', !/^(HÔTE|INVITÉ)/.test(tag));
    }
    heatPct.textContent = p.energy.toFixed(0) + '%';
    heatBars.you.classList.toggle('full', p.energy >= RS.MAX_ENERGY);
    heatBars.bot.classList.toggle('full', b.energy >= RS.MAX_ENERGY);
    // Les consignes vivent sous les boutons et changent au moment du service.
    const serving = game.state === 'serve' && game.server === p;
    if (serving !== lastServing) {
      lastServing = serving;
      // Coup droit et revers ne se choisissent qu'au service. Dans l'échange, A joue à plat et
      // B lève le volant : c'est le bouton qui dit la forme du coup, la croix la profondeur.
      $('hintA').innerHTML = serving ? 'SERVICE<br>coup droit' : 'DRIVE · SMASH<br>▼ amorti';
      $('hintB').innerHTML = serving ? 'SERVICE<br>revers' : 'DÉGAGEMENT<br>▼ court ▲ long';
      $('padHint').innerHTML = serving
        ? '▲ long &nbsp;▼ court &nbsp;◀▶ côté<br>maintenir = vers la ligne de côté'
        : '▲ fond &nbsp;▼ filet &nbsp;◀▶ côté<br>maintenir = vers la ligne';
    }
    $('serveYou').classList.toggle('on', game.server === p);
    $('serveBot').classList.toggle('on', game.server === b);
  }

  function onRoundEnd() {
    if (game.phase === 'cards') { if (net.state === 'playing') net.setPhase('choose'); showChoice('cards'); }
    else showEnd();
  }

  function showEnd() {
    const won = game.phase === 'won';
    const solo = game.run.solo;
    $('endTitle').textContent = solo ? (won ? '🏆 VICTOIRE' : '💀 DÉFAITE') : (won ? '🏆 RUN TERMINÉE' : '💀 RUN PERDUE');
    $('endTitle').style.color = won ? '#5dff7a' : '#ff5e5e';
    $('endScore').textContent = solo
      ? `${game.diff.name} · ${RS.fmtScore(game.score[0])} – ${RS.fmtScore(game.score[1])}`
      : won ? 'Les 4 niveaux sont tombés'
            : `Niveau ${game.run.level + 1} · ${RS.fmtScore(game.score[0])} – ${RS.fmtScore(game.score[1])}`;
    const p = game.player;
    const m = Math.floor(game.matchTime / 60), s = Math.floor(game.matchTime % 60);
    const rows = [
      [game.run.solo ? 'Adversaire' : 'Niveaux franchis', game.run.solo ? game.diff.name : game.run.levels + (won ? 1 : 0)],
      ['Durée', `${m}:${String(s).padStart(2, '0')}`],
      ['Frappes', p.stats.hits],
      ['Parfaites', p.stats.perfect],
      ['Smashs', p.stats.smashes],
      ['Super smashs', p.stats.supers],
      ['Coups dans le vide', p.stats.whiffs],
      ['Plus long échange', game.longestRally],
    ];
    $('endStats').innerHTML = rows.map(([k, v]) => `<div>${k} <b>${v}</b></div>`).join('');
    deckBig($('endDeck'));
    showPanel('end');
  }

  /* ---------------------------------------------------------------- boucle */
  let last = performance.now();
  let lobbyBeat = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Le salon se relit tout seul quatre fois par seconde : la liste des présents peut changer sans
    // qu'un évènement l'annonce, et un joueur seul devant un salon muet ne sait pas quoi en penser.
    if (now - lobbyBeat > 250) { lobbyBeat = now; if (net.table) { renderLobby(); renderOnline(); } }
    const inp = input.consume();
    if (net.state === 'playing' && !net.isHost()) {
      // Invité : on ne tranche rien, on prolonge la simulation et on rejoue ce que l'hôte annonce.
      game.updateRemote(dt, inp, dt * (game.diff.tempo || 1));
      const ev = net.guestTick(game);
      if (ev) playRemoteEvent(ev);
    } else {
      game.update(dt, inp);
      if (net.state === 'playing') net.hostTick(game);
    }
    for (const e of game.events) sfx.handle(e);
    game.events.length = 0;
    renderer.draw(game, dt);
    updateHud();
    netRoundSync();
    // Le protocole du boss arrive par l'instantané : le filtre de l'invité doit suivre.
    if (net.state === 'playing' && !net.isHost()) {
      const k = game.run.handicap ? game.run.handicap.key : null;
      if (k !== lastHandicap) { lastHandicap = k; applyHandicapFilter(); }
    }
    if (net.state === 'playing' && net.lostPeers()) { showDropped(); }
    if (game.state === 'end' && !endShown) { endShown = true; onRoundEnd(); }
    requestAnimationFrame(frame);
  }

  /** L'hôte annonce les frappes et les points : l'invité en rejoue le son et l'étiquette. */
  function playRemoteEvent(ev) {
    if (ev.k === 1) {
      const r = game.robots[ev.a === undefined ? 0 : (net.map ? net.map.indexOf(ev.a) : ev.a)];
      const shot = RS.SHOTS[ev.b] || 'drive';
      const level = ev.c % 10, sup = ev.c >= 10;
      sfx.handle({ type: 'hit', shot, level, robot: r || game.player, sup });
    } else if (ev.k === 2) {
      // Le camp qui marque est annoncé dans le repère de l'hôte : en duel il faut le retourner,
      // sinon l'invité s'entend dire « point pour toi » quand il vient d'en encaisser un.
      const t = net.flip ? 1 - ev.a : ev.a;
      const mine = t === 0;
      game.message = { text: RS.REASONS[ev.b] || 'POINT', sub: mine ? 'Point pour toi' : 'Point pour eux', t: 0, good: mine };
      sfx.handle({ type: 'point', winner: t, reason: RS.REASONS[ev.b] });
    }
  }

  let lastHandicap = null;
  let droppedShown = false;
  function showDropped() {
    if (droppedShown) return;
    droppedShown = true;
    game.pause();
    $('endTitle').textContent = 'JOUEUR PARTI';
    $('endScore').textContent = 'La table s\u2019est vidée';
    $('endStats').innerHTML = ''; $('endDeck').innerHTML = '';
    showPanel('end');
  }

  /* ---------------------------------------------------------------- accueil */
  // L'affiche, puis le calque qui recouvre « PRESS START » par intermittence.
  for (const el of document.querySelectorAll('.splash-art')) {
    el.querySelector('.art').src = window.TITLE_ART || '';
    el.querySelector('.band').src = window.TITLE_BAND || '';
  }
  $('menuArt').src = window.MENU_ART || '';
  const leaveSplash = () => {
    if ($('splash').classList.contains('hidden')) return;
    sfx.unlock();                              // le premier geste du joueur débloque aussi le son
    showPanel('menu');
  };
  $('splash').addEventListener('pointerdown', leaveSplash);
  window.addEventListener('keydown', leaveSplash);

  showPanel('splash');
  layout();
  requestAnimationFrame(frame);

  // Empêche le zoom / scroll iOS pendant le jeu.
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('.panel')) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  window.__rogueShuttle = { game, renderer, input, settings, net, startRun, applyHandicapFilter };
})();
