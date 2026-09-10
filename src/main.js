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
  const panels = ['menu', 'help', 'pause', 'end', 'choice'];
  function showPanel(name) {
    for (const p of panels) $(p).classList.toggle('hidden', p !== name);
    const playing = !name;
    $('hud').classList.toggle('hidden', name === 'menu' || name === 'help');
    $('pad').classList.toggle('hidden', !playing);
    layout();
  }

  function startRun() {
    sfx.unlock();
    game.startRun(settings);
    beginRound();
  }

  /** Reprend la partie après le menu ou après un choix de carte. */
  function beginRound() {
    $('chassisName').textContent = RS.CHASSIS[settings.chassis].name;
    $('diffName').textContent = game.diff.name;
    endShown = false;
    showPanel(null);
    updateDeck();
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
    $('deck').innerHTML = list.map(([k, n]) => `<span class="chip">${upDef(k).icon}<b>${n}</b></span>`).join('');
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
    const list = isCard ? game.offerCards() : game.offerRackets();
    if (!list.length) { afterChoice(kind); return; }
    $('choiceTitle').textContent = isCard ? 'MANCHE GAGNÉE' : 'FIN DE NIVEAU';
    $('choiceSub').textContent = isCard ? 'Choisis une pièce à monter' : 'Choisis un modificateur de raquette';
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

  $('playBtn').addEventListener('click', startRun);
  $('helpBtn').addEventListener('click', () => showPanel('help'));
  $('helpBack').addEventListener('click', () => showPanel('menu'));
  $('pauseBtn').addEventListener('click', () => { if (game.state !== 'paused') { game.pause(); deckBig($('pauseDeck')); showPanel('pause'); } });
  $('resumeBtn').addEventListener('click', () => { game.resume(); showPanel(null); });
  $('quitBtn').addEventListener('click', () => { game.state = 'menu'; showPanel('menu'); });
  $('replayBtn').addEventListener('click', startRun);
  $('menuBtn').addEventListener('click', () => { game.state = 'menu'; showPanel('menu'); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (game.state === 'paused') { game.resume(); showPanel(null); }
      else if (game.state !== 'menu' && game.state !== 'end') { game.pause(); showPanel('pause'); }
    }
    if (e.key === 'Enter' && !$('menu').classList.contains('hidden')) startRun();
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
    $('scoreYou').textContent = RS.fmtScore(game.score[0]);
    $('scoreBot').textContent = RS.fmtScore(game.score[1]);
    $('stage').textContent = `NIVEAU ${game.run.level + 1} · MANCHE ${game.run.round + 1} → ${RS.POINTS_TO_WIN}`;
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
    $('endTitle').textContent = won ? '🏆 RUN TERMINÉE' : '💀 RUN PERDUE';
    $('endTitle').style.color = won ? '#5dff7a' : '#ff5e5e';
    $('endScore').textContent = won
      ? `Les 4 niveaux sont tombés`
      : `Niveau ${game.run.level + 1} · manche ${game.run.round + 1} · ${RS.fmtScore(game.score[0])} – ${RS.fmtScore(game.score[1])}`;
    const p = game.player;
    const m = Math.floor(game.matchTime / 60), s = Math.floor(game.matchTime % 60);
    const rows = [
      ['Manches gagnées', Math.max(0, game.run.rounds - (won ? 0 : 1))],
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

  window.__rogueShuttle = { game, renderer, input, settings, startRun };
})();
