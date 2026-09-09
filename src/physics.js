/* Rogue Shuttle — physique du volant.
 * Unités : mètres, secondes. Axes : x = latéral, y = hauteur, z = profondeur (filet en z=0).
 * Le joueur humain est en z < 0, l'adversaire en z > 0.
 */
(function (root) {
  'use strict';

  const G = 9.81;
  // Traînée quadratique (1/m). Vitesse terminale = sqrt(G/DRAG) ≈ 9.4 m/s (un vrai volant ≈ 6.8 m/s ;
  // on triche un peu pour des trajectoires plus lisibles à l'écran).
  const DRAG = 0.11;
  const DT = 1 / 240;

  const COURT = {
    halfLength: 6.7,          // ligne de fond
    halfWidthSingles: 2.59,   // ligne de côté simple
    halfWidthDoubles: 3.05,   // ligne de côté double (décor)
    netHeight: 1.55,
    shortService: 1.98,       // ligne de service court
    longServiceDoubles: 5.94, // ligne de service long double (décor)
  };

  function step(s, dt) {
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    const k = DRAG * sp;
    s.vx -= k * s.vx * dt;
    s.vy -= (G + k * s.vy) * dt;
    s.vz -= k * s.vz * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
  }

  /** Simule la trajectoire jusqu'au sol (ou au filet). */
  function predict(s0, opt) {
    opt = opt || {};
    const s = { x: s0.x, y: s0.y, z: s0.z, vx: s0.vx, vy: s0.vy, vz: s0.vz };
    const maxT = opt.maxT || 6;
    const sampleEvery = opt.sampleEvery || 4; // 4 sous-pas de 1/240 → 60 Hz
    const path = [];
    let t = 0, i = 0, netY = null, net = false;
    path.push({ t: 0, x: s.x, y: s.y, z: s.z, vy: s.vy });
    while (t < maxT) {
      const pz = s.z, py = s.y;
      step(s, DT);
      t += DT; i++;
      if (netY === null && (pz < 0) !== (s.z < 0)) {
        const f = pz / (pz - s.z);
        netY = py + (s.y - py) * f;
        if (!opt.ignoreNet && netY < COURT.netHeight && Math.abs(s.x) < COURT.halfWidthDoubles + 0.1) {
          net = true;
          s.z = pz < 0 ? -0.03 : 0.03;
          s.y = netY;
          path.push({ t, x: s.x, y: s.y, z: s.z, vy: s.vy });
          break;
        }
      }
      if (s.y <= 0) {
        s.y = 0;
        path.push({ t, x: s.x, y: 0, z: s.z, vy: s.vy });
        break;
      }
      if (i % sampleEvery === 0) path.push({ t, x: s.x, y: s.y, z: s.z, vy: s.vy });
    }
    return { path, landing: { x: s.x, z: s.z, t }, net, netY, t };
  }

  function velocityFor(dir, angleDeg, speed) {
    const a = angleDeg * Math.PI / 180;
    const h = Math.cos(a) * speed;
    return { vx: dir.x * h, vy: Math.sin(a) * speed, vz: dir.z * h };
  }

  function landingDist(p0, dir, angleDeg, speed) {
    const v = velocityFor(dir, angleDeg, speed);
    const r = predict({ x: p0.x, y: p0.y, z: p0.z, vx: v.vx, vy: v.vy, vz: v.vz }, { ignoreNet: true, sampleEvery: 1e9 });
    return (r.landing.x - p0.x) * dir.x + (r.landing.z - p0.z) * dir.z;
  }

  /** Vitesse initiale pour atterrir à `dist` mètres avec un angle d'élévation donné. */
  function solveSpeed(p0, dir, angleDeg, dist) {
    let lo = 1, hi = 60;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (landingDist(p0, dir, angleDeg, mid) < dist) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Angle d'élévation pour atterrir à `dist` mètres avec une vitesse donnée (smash). */
  function solveAngle(p0, dir, speed, dist, minA, maxA) {
    let lo = minA == null ? -75 : minA, hi = maxA == null ? 25 : maxA;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (landingDist(p0, dir, mid, speed) < dist) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * Planifie une frappe.
   * spec = { from:{x,y,z}, target:{x,z}, mode:'angle'|'speed', angle, speed, clearance }
   * clearance = marge minimale au-dessus du filet (négatif = on ne corrige pas → erreur volontaire).
   */
  function planShot(spec) {
    const from = spec.from;
    const dx = spec.target.x - from.x, dz = spec.target.z - from.z;
    const dist = Math.max(0.05, Math.hypot(dx, dz));
    const dir = { x: dx / dist, z: dz / dist };
    const clearance = spec.clearance == null ? 0.3 : spec.clearance;
    const crossesNet = (from.z < 0) !== (spec.target.z < 0);
    const need = COURT.netHeight + clearance;

    const sim = (a, sp) => {
      const v = velocityFor(dir, a, sp);
      return predict({ x: from.x, y: from.y, z: from.z, vx: v.vx, vy: v.vy, vz: v.vz }, { sampleEvery: 1e9 });
    };

    let angle, speed, res;
    if (spec.mode === 'speed') {
      speed = spec.speed;
      angle = solveAngle(from, dir, speed, dist);
      res = sim(angle, speed);
      if (crossesNet && clearance >= 0 && res.netY !== null && res.netY < need) {
        let lo = angle, hi = 60;
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2;
          const r = sim(mid, speed);
          if (r.netY !== null && r.netY >= need) hi = mid; else lo = mid;
        }
        angle = hi;
        res = sim(angle, speed);
      }
    } else {
      angle = spec.angle;
      for (let i = 0; i < 14; i++) {
        speed = solveSpeed(from, dir, angle, dist);
        res = sim(angle, speed);
        if (!crossesNet || clearance < 0 || res.netY === null || res.netY >= need) break;
        angle += 4;
      }
    }
    const v = velocityFor(dir, angle, speed);
    return { v, angle, speed, landing: res.landing, netY: res.netY, net: res.net, flight: res.t };
  }

  function inSingles(x, z, tol) {
    tol = tol == null ? 0.03 : tol;
    return Math.abs(x) <= COURT.halfWidthSingles + tol && Math.abs(z) <= COURT.halfLength + tol;
  }

  root.Physics = { G, DRAG, DT, COURT, step, predict, planShot, velocityFor, solveSpeed, solveAngle, inSingles };
})(typeof window !== 'undefined' ? window : globalThis);
