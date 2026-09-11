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

  const settings = { chassis: 'balanced', difficulty: 'rookie', assist: false };
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
  const panels = ['menu', 'help', 'pause', 'end', 'choice', 'malus', 'opponents', 'chassis'];
  const LOBBY = ['menu', 'help', 'chassis', 'opponents'];
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

  /** Reprend la partie après le menu ou après un choix de carte. */
  let handicapShown = null;
  function beginRound() {
    $('chassisName').textContent = RS.CHASSIS[settings.chassis].name;
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
    const r = game.run || { cards: {}, racket: {} };
    return Object.keys(r.cards).map((k) => [k, r.cards[k]]).concat(Object.keys(r.racket).map((k) => [k, r.racket[k]]));
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
    const owned = isCard ? game.run.cards : game.run.racket;
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
    game.advance();
    beginRound();
  }

  $('playBtn').addEventListener('click', () => showChassis('run'));
  $('chassisGo').addEventListener('click', () => { sfx.unlock(); if (pendingMode === 'run') startRun(); else showOpponents(); });
  $('chassisBack').addEventListener('click', () => showPanel('menu'));
  $('malusBtn').addEventListener('click', () => { game.resume(); showPanel(null); });
  $('exhibBtn').addEventListener('click', () => showChassis('exhib'));
  $('oppBack').addEventListener('click', () => showChassis('exhib'));
  $('helpBtn').addEventListener('click', () => showPanel('help'));
  $('helpBack').addEventListener('click', () => showPanel('menu'));
  $('pauseBtn').addEventListener('click', () => { if (game.state !== 'paused') { game.pause(); deckBig($('pauseDeck')); showPanel('pause'); } });
  $('resumeBtn').addEventListener('click', () => { game.resume(); showPanel(null); });
  $('quitBtn').addEventListener('click', () => { game.state = 'menu'; showPanel('menu'); });
  $('replayBtn').addEventListener('click', () => { if (game.run.solo) { game.startExhibition(settings); beginRound(); } else startRun(); });
  $('menuBtn').addEventListener('click', () => { game.state = 'menu'; showPanel('menu'); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (game.state === 'paused') { game.resume(); showPanel(null); }
      else if (game.state !== 'menu' && game.state !== 'end') { game.pause(); showPanel('pause'); }
    }
    if (e.key === 'Enter' && !$('menu').classList.contains('hidden')) showChassis('run');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && game.state !== 'menu' && game.state !== 'end') { game.pause(); showPanel('pause'); } });

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
    heatPct.textContent = p.energy.toFixed(0) + '%';
    heatBars.you.classList.toggle('full', p.energy >= RS.MAX_ENERGY);
    heatBars.bot.classList.toggle('full', b.energy >= RS.MAX_ENERGY);
    $('serveYou').classList.toggle('on', game.server === p);
    $('serveBot').classList.toggle('on', game.server === b);
  }

  function onRoundEnd() {
    if (game.phase === 'cards') showChoice('cards');
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
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const inp = input.consume();
    game.update(dt, inp);
    for (const e of game.events) sfx.handle(e);
    game.events.length = 0;
    renderer.draw(game, dt);
    updateHud();
    if (game.state === 'end' && !endShown) { endShown = true; onRoundEnd(); }
    requestAnimationFrame(frame);
  }

  showPanel('menu');
  layout();
  requestAnimationFrame(frame);

  // Empêche le zoom / scroll iOS pendant le jeu.
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('.panel')) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  window.__rogueShuttle = { game, renderer, input, settings, startRun, applyHandicapFilter };
})();
