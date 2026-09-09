/* Rogue Shuttle — sons synthétiques (WebAudio), rien à charger. */
(function (root) {
  'use strict';

  class Sfx {
    constructor() { this.ctx = null; this.enabled = true; this.noise = null; }

    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.enabled = false; return; }
        this.ctx = new AC();
        const len = Math.floor(this.ctx.sampleRate * 0.25);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    tone(freq, dur, type, vol, when, slide) {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime + (when || 0);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }

    burst(freq, dur, vol, q) {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1.2;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.ctx.destination);
      src.start(t); src.stop(t + dur + 0.02);
    }

    handle(e) {
      if (!this.ctx || !this.enabled) return;
      switch (e.type) {
        case 'hit': {
          const lvl = e.level;
          if (e.shot === 'smash') { this.burst(320, 0.16, 0.9, 0.8); this.tone(140, 0.18, 'triangle', 0.5, 0, 60); }
          else if (e.shot === 'drive') { this.burst(700, 0.09, 0.6); }
          else if (e.shot === 'drop') { this.burst(1400, 0.07, 0.35, 2); }
          else { this.burst(900, 0.1, 0.5); }
          if (lvl === 2) { this.tone(880, 0.12, 'sine', 0.18, 0.02); this.tone(1320, 0.18, 'sine', 0.18, 0.09); }
          else if (lvl === 0) { this.tone(160, 0.2, 'sawtooth', 0.12, 0, 90); }
          break;
        }
        case 'point': {
          if (e.winner === 0) { [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'square', 0.12, i * 0.09)); }
          else { this.tone(330, 0.2, 'square', 0.12, 0); this.tone(220, 0.3, 'square', 0.12, 0.15); }
          break;
        }
        case 'overheat': {
          for (let i = 0; i < 4; i++) this.tone(110, 0.1, 'square', 0.15, i * 0.13);
          break;
        }
        case 'end': {
          if (e.winner === 0) [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, i * 0.14));
          else [392, 330, 262].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.18, i * 0.2));
          break;
        }
        default: break;
      }
    }
  }

  root.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
