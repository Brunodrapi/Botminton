/* Rogue Shuttle — entrées : stick virtuel flottant, 4 boutons tactiles, clavier. */
(function (root) {
  'use strict';

  const KEY_SHOTS = { a: 'clear', b: 'drop', x: 'smash', y: 'drive' };

  class Input {
    constructor(opts) {
      this.stickZone = opts.stickZone;
      this.stickBase = opts.stickBase;
      this.stickKnob = opts.stickKnob;
      this.radius = opts.radius || 46;
      this.stick = { x: 0, y: 0 };
      this.held = {};
      this.just = [];
      this.keys = {};
      this.stickId = null;
      this.origin = null;
      this.onAny = opts.onAny || (() => {});
      this.bindStick();
      for (const btn of opts.buttons) this.bindButton(btn);
      this.bindKeyboard();
    }

    bindStick() {
      const z = this.stickZone;
      z.addEventListener('pointerdown', (e) => {
        if (this.stickId !== null) return;
        e.preventDefault();
        this.onAny();
        this.stickId = e.pointerId;
        try { z.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        this.origin = { x: e.clientX, y: e.clientY };
        this.stick.x = 0; this.stick.y = 0;
        this.stickBase.style.display = 'block';
        this.stickBase.style.left = (e.clientX - this.radius - 14) + 'px';
        this.stickBase.style.top = (e.clientY - this.radius - 14) + 'px';
        this.stickKnob.style.transform = 'translate(0px,0px)';
      });
      const move = (e) => {
        if (e.pointerId !== this.stickId) return;
        e.preventDefault();
        let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
        const d = Math.hypot(dx, dy);
        if (d > this.radius) { dx *= this.radius / d; dy *= this.radius / d; }
        let nx = dx / this.radius, ny = dy / this.radius;
        const n = Math.hypot(nx, ny);
        const dead = 0.14;
        if (n < dead) { nx = 0; ny = 0; }
        else { const k = (n - dead) / (1 - dead) / n; nx *= k; ny *= k; }
        this.stick.x = nx; this.stick.y = -ny;
        this.stickKnob.style.transform = `translate(${dx}px,${dy}px)`;
      };
      const end = (e) => {
        if (e.pointerId !== this.stickId) return;
        this.stickId = null;
        this.stick.x = 0; this.stick.y = 0;
        this.stickBase.style.display = 'none';
      };
      z.addEventListener('pointermove', move);
      z.addEventListener('pointerup', end);
      z.addEventListener('pointercancel', end);
      z.addEventListener('lostpointercapture', end);
    }

    bindButton(btn) {
      const shot = btn.dataset.shot;
      const press = (e) => {
        e.preventDefault();
        this.onAny();
        try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if (!this.held[shot]) this.just.push(shot);
        this.held[shot] = true;
        btn.classList.add('active');
      };
      const release = (e) => {
        if (e) e.preventDefault();
        this.held[shot] = false;
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    bindKeyboard() {
      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        this.keys[k] = true;
        if (KEY_SHOTS[k]) { this.onAny(); this.just.push(KEY_SHOTS[k]); this.held[KEY_SHOTS[k]] = true; }
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      });
      window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        this.keys[k] = false;
        if (KEY_SHOTS[k]) this.held[KEY_SHOTS[k]] = false;
      });
      window.addEventListener('blur', () => { this.keys = {}; for (const s in this.held) this.held[s] = false; });
    }

    consume() {
      let sx = this.stick.x, sy = this.stick.y;
      if (this.stickId === null) {
        const k = this.keys;
        sx = (k.arrowright || k.d ? 1 : 0) - (k.arrowleft || k.q ? 1 : 0);
        sy = (k.arrowup || k.z || k.w ? 1 : 0) - (k.arrowdown || k.s ? 1 : 0);
        const n = Math.hypot(sx, sy);
        if (n > 1) { sx /= n; sy /= n; }
      }
      const out = { stick: { x: sx, y: sy }, held: Object.assign({}, this.held), just: this.just };
      this.just = [];
      return out;
    }
  }

  root.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
