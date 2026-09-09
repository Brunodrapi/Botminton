// node tests/physics.test.mjs — vérifie que le solveur de frappes fait ce qu'on lui demande.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { globalThis: null };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../src/physics.js', import.meta.url), 'utf8'), ctx);
const P = ctx.Physics;

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fails++;
}
const fmt = (n) => n.toFixed(2);

// Dégagé depuis le fond de court joueur vers le fond adverse
{
  const r = P.planShot({ from: { x: 0, y: 2.0, z: -5 }, target: { x: 0.5, z: 6.3 }, mode: 'angle', angle: 45, clearance: 0.7 });
  check('clear lands near target', Math.abs(r.landing.z - 6.3) < 0.15 && Math.abs(r.landing.x - 0.5) < 0.15, `landing=(${fmt(r.landing.x)}, ${fmt(r.landing.z)}) speed=${fmt(r.speed)} angle=${fmt(r.angle)} netY=${fmt(r.netY)} t=${fmt(r.flight)}`);
  check('clear clears the net', !r.net && r.netY > P.COURT.netHeight + 0.7);
}
// Amorti au-dessus du filet depuis mi-court
{
  const r = P.planShot({ from: { x: 0, y: 2.2, z: -3 }, target: { x: -1, z: 0.95 }, mode: 'angle', angle: -8, clearance: 0.12 });
  check('drop lands near net', Math.abs(r.landing.z - 0.95) < 0.15, `landing=(${fmt(r.landing.x)}, ${fmt(r.landing.z)}) speed=${fmt(r.speed)} angle=${fmt(r.angle)} netY=${fmt(r.netY)} t=${fmt(r.flight)}`);
  check('drop clears the net', !r.net && r.netY >= P.COURT.netHeight + 0.12);
}
// Amorti au filet, contact bas (net shot)
{
  const r = P.planShot({ from: { x: 0.5, y: 0.6, z: -1.2 }, target: { x: 0.5, z: 0.95 }, mode: 'angle', angle: 30, clearance: 0.12 });
  check('net shot lands near net', Math.abs(r.landing.z - 0.95) < 0.2, `landing z=${fmt(r.landing.z)} speed=${fmt(r.speed)} angle=${fmt(r.angle)} netY=${fmt(r.netY)}`);
  check('net shot clears the net', !r.net);
}
// Smash depuis 2.4 m de haut
{
  const r = P.planShot({ from: { x: 0, y: 2.4, z: -3.5 }, target: { x: 1.5, z: 3.8 }, mode: 'speed', speed: 24, clearance: 0.12 });
  check('smash lands in court', !r.net && P.inSingles(r.landing.x, r.landing.z), `landing=(${fmt(r.landing.x)}, ${fmt(r.landing.z)}) angle=${fmt(r.angle)} netY=${fmt(r.netY)} t=${fmt(r.flight)}`);
  check('smash is fast', r.flight < 0.75, `flight=${fmt(r.flight)}s`);
}
// Smash depuis le fond de court, plus bas : doit rester dans le terrain grâce à la correction d'angle
{
  const r = P.planShot({ from: { x: 0, y: 1.8, z: -6 }, target: { x: 0, z: 3.8 }, mode: 'speed', speed: 20, clearance: 0.12 });
  check('deep smash still in court', !r.net && P.inSingles(r.landing.x, r.landing.z), `landing=(${fmt(r.landing.x)}, ${fmt(r.landing.z)}) angle=${fmt(r.angle)} netY=${fmt(r.netY)}`);
}
// Drive plat
{
  const r = P.planShot({ from: { x: 0, y: 1.3, z: -3 }, target: { x: -1, z: 5.9 }, mode: 'angle', angle: 14, clearance: 0.15 });
  check('drive lands deep', Math.abs(r.landing.z - 5.9) < 0.3 && !r.net, `landing=(${fmt(r.landing.x)}, ${fmt(r.landing.z)}) speed=${fmt(r.speed)} angle=${fmt(r.angle)} netY=${fmt(r.netY)} t=${fmt(r.flight)}`);
}
// Erreur volontaire : dans le filet
{
  const r = P.planShot({ from: { x: 0, y: 1.2, z: -3 }, target: { x: 0, z: 0.8 }, mode: 'angle', angle: -10, clearance: -9 });
  check('deliberate net error hits net', r.net, `netY=${fmt(r.netY)}`);
}
// Service long
{
  const r = P.planShot({ from: { x: 1, y: 1.0, z: -3 }, target: { x: -1, z: 6.0 }, mode: 'angle', angle: 55, clearance: 1.0 });
  check('long serve lands deep', Math.abs(r.landing.z - 6.0) < 0.2 && !r.net, `landing=(${fmt(r.landing.x)}, ${fmt(r.landing.z)}) t=${fmt(r.flight)}`);
}
// predict() : la trajectoire s'arrête au filet quand elle est trop basse
{
  const r = P.predict({ x: 0, y: 1.0, z: -2, vx: 0, vy: 1, vz: 6 });
  check('predict detects net', r.net === true, `netY=${fmt(r.netY)}`);
}

console.log(fails ? `\n${fails} test(s) failed` : '\nall good');
process.exit(fails ? 1 : 0);
