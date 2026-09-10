/* Rogue Shuttle — entrées : croix directionnelle fixe (8 directions), boutons A/B, clavier. */
(function (root) {
  'use strict';

  const KEY_BTNS = { a: 'A', x: 'A', b: 'B', c: 'B', ' ': 'A' };

  class Input {
    constructor(opts) {
      this.dpad = opts.dpad;           // élément visuel de la croix (position fixe)
      this.dpadZone = opts.dpadZone;   // zone tactile plus large autour
      this.stick = { x: 0, y: 0 };
      this.held = {};
      this.just = [];
      this.keys = {};
      this.dpadId = null;
      this.onAny = opts.onAny || (() => {});
      this.bindDpad();
      for (const btn of opts.buttons) this.bindButton(btn);
      this.bindKeyboard();
    }

    setDir(x, y) {
      this.stick.x = x; this.stick.y = y;
      this.dpad.classList.toggle('up', y > 0.3);
      this.dpad.classList.toggle('down', y < -0.3);
      this.dpad.classList.toggle('left', x < -0.3);
      this.dpad.classList.toggle('right', x > 0.3);
    }

    dirFromPoint(cx, cy) {
      const r = this.dpad.getBoundingClientRect();
      const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d < r.width * 0.12) { this.setDir(0, 0); return; }
      const a = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      this.setDir(Math.round(Math.cos(a) * 100) / 100, Math.round(Math.sin(a) * 100) / 100);
    }

    bindDpad() {
      const z = this.dpadZone;
      z.addEventListener('pointerdown', (e) => {
        if (this.dpadId !== null) return;
        e.preventDefault();
        this.onAny();
        this.dpadId = e.pointerId;
        try { z.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        this.dirFromPoint(e.clientX, e.clientY);
      });
      z.addEventListener('pointermove', (e) => {
        if (e.pointerId !== this.dpadId) return;
        e.preventDefault();
        this.dirFromPoint(e.clientX, e.clientY);
      });
      const end = (e) => {
        if (e.pointerId !== this.dpadId) return;
        this.dpadId = null;
        this.setDir(0, 0);
      };
      z.addEventListener('pointerup', end);
      z.addEventListener('pointercancel', end);
      z.addEventListener('lostpointercapture', end);
    }

    bindButton(btn) {
      const name = btn.dataset.btn;
      const press = (e) => {
        e.preventDefault();
        this.onAny();
        try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if (!this.held[name]) this.just.push(name);
        this.held[name] = true;
        btn.classList.add('active');
      };
      const release = (e) => {
        if (e) e.preventDefault();
        this.held[name] = false;
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
        if (KEY_BTNS[k]) { this.onAny(); if (!this.held[KEY_BTNS[k]]) this.just.push(KEY_BTNS[k]); this.held[KEY_BTNS[k]] = true; }
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      });
      window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        this.keys[k] = false;
        if (KEY_BTNS[k]) this.held[KEY_BTNS[k]] = false;
      });
      window.addEventListener('blur', () => { this.keys = {}; for (const s in this.held) this.held[s] = false; });
    }

    consume() {
      let sx = this.stick.x, sy = this.stick.y;
      if (this.dpadId === null) {
        const k = this.keys;
        sx = (k.arrowright || k.d ? 1 : 0) - (k.arrowleft || k.q ? 1 : 0);
        sy = (k.arrowup || k.z || k.w ? 1 : 0) - (k.arrowdown || k.s ? 1 : 0);
        const n = Math.hypot(sx, sy);
        if (n > 1) { sx /= n; sy /= n; }
        if (sx || sy) this.setDir(sx, sy); else if (this.stick.x || this.stick.y) this.setDir(0, 0);
      }
      const out = { stick: { x: sx, y: sy }, held: Object.assign({}, this.held), just: this.just };
      this.just = [];
      return out;
    }
  }

  root.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
