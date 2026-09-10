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
  const diffDefs = {};
  for (const k of RS.DIFF_ORDER) {
    const d = RS.DIFFICULTY[k];
    diffDefs[k] = { name: d.name, color: d.color, desc: [{ rookie: 'lent, hésitant', pro: 'solide, smashe', elite: 'volant, rapide', boss: '2 raquettes, sans pitié' }[k]] };
  }
  buildCards($('chassisCards'), RS.CHASSIS, 'chassis');
  buildCards($('diffCards'), diffDefs, 'difficulty');
  $('assistToggle').checked = !!settings.assist;
  $('assistToggle').addEventListener('change', (e) => { settings.assist = e.target.checked; saveSettings(); });

  const panels = ['menu', 'help', 'pause', 'end'];
  function showPanel(name) {
    for (const p of panels) $(p).classList.toggle('hidden', p !== name);
    const playing = !name;
    $('hud').classList.toggle('hidden', name === 'menu' || name === 'help');
    $('pad').classList.toggle('hidden', !playing);
    layout();
  }

  function startMatch() {
    sfx.unlock();
    game.startMatch(settings);
    $('chassisName').textContent = RS.CHASSIS[settings.chassis].name;
    $('diffName').textContent = RS.DIFFICULTY[settings.difficulty].name;
    endShown = false;
    showPanel(null);
  }

  $('playBtn').addEventListener('click', startMatch);
  $('helpBtn').addEventListener('click', () => showPanel('help'));
  $('helpBack').addEventListener('click', () => showPanel('menu'));
  $('pauseBtn').addEventListener('click', () => { if (game.state !== 'paused') { game.pause(); showPanel('pause'); } });
  $('resumeBtn').addEventListener('click', () => { game.resume(); showPanel(null); });
  $('quitBtn').addEventListener('click', () => { game.state = 'menu'; showPanel('menu'); });
  $('replayBtn').addEventListener('click', startMatch);
  $('menuBtn').addEventListener('click', () => { game.state = 'menu'; showPanel('menu'); });
  $('nextBtn').addEventListener('click', () => {
    const i = RS.DIFF_ORDER.indexOf(settings.difficulty);
    settings.difficulty = RS.DIFF_ORDER[Math.min(RS.DIFF_ORDER.length - 1, i + 1)];
    saveSettings();
    buildCards($('diffCards'), diffDefs, 'difficulty');
    startMatch();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (game.state === 'paused') { game.resume(); showPanel(null); }
      else if (game.state !== 'menu' && game.state !== 'end') { game.pause(); showPanel('pause'); }
    }
    if (e.key === 'Enter' && !$('menu').classList.contains('hidden')) startMatch();
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
    $('scoreYou').textContent = game.score[0];
    $('scoreBot').textContent = game.score[1];
    const p = game.player, b = game.bot;
    setHeat(heatBars.you, p.heat); setHeat(heatBars.bot, b.heat);
    heatPct.textContent = p.heat.toFixed(0) + '%';
    heatBars.you.classList.toggle('overheat', p.overheat > 0);
    $('serveYou').classList.toggle('on', game.server === p);
    $('serveBot').classList.toggle('on', game.server === b);
  }

  function showEnd() {
    const won = game.winner === 0;
    $('endTitle').textContent = won ? '🏆 VICTOIRE' : '💀 DÉFAITE';
    $('endTitle').style.color = won ? '#5dff7a' : '#ff5e5e';
    $('endScore').textContent = `${game.score[0]} – ${game.score[1]}`;
    const p = game.player;
    const m = Math.floor(game.matchTime / 60), s = Math.floor(game.matchTime % 60);
    const rows = [
      ['Durée', `${m}:${String(s).padStart(2, '0')}`],
      ['Frappes', p.stats.hits],
      ['Parfaites', p.stats.perfect],
      ['Smashs', p.stats.smashes],
      ['Heat max', p.stats.maxHeat.toFixed(0)],
      ['Overheats', p.overheats],
      ['Plus long échange', game.longestRally],
    ];
    $('endStats').innerHTML = rows.map(([k, v]) => `<div>${k} <b>${v}</b></div>`).join('');
    const last = settings.difficulty === RS.DIFF_ORDER[RS.DIFF_ORDER.length - 1];
    $('nextBtn').classList.toggle('hidden', !won || last);
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
    if (game.state === 'end' && !endShown) { endShown = true; showEnd(); }
    requestAnimationFrame(frame);
  }

  showPanel('menu');
  layout();
  requestAnimationFrame(frame);

  // Empêche le zoom / scroll iOS pendant le jeu.
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('.panel')) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  window.__rogueShuttle = { game, renderer, input, settings, startMatch };
})();
