import { BambooPhysics, MAX_RPM, SING_RPM } from '../js/physics.js';

const p = new BambooPhysics();
p.setRpm(4500);
const rows = [];
let t = 0;
let lastReport = 0;
while (p.rpm > 1 && t < 60) {
  p.step(1 / 120);
  t += 1 / 120;
  if (t - lastReport >= 1) {
    rows.push({ t: +t.toFixed(2), rpm: Math.round(p.rpm) });
    lastReport = t;
  }
}
console.log('natural decay from 4500 rpm:', rows);
console.log('stop time:', t.toFixed(2), 's');

// One strong swipe.
const q = new BambooPhysics();
for (let i = 0; i < 20; i++) q.rub(0.03, 1, 1.2);
console.log('20 small rub events ->', Math.round(q.rpm), 'rpm');

// Sustained vigorous rubbing.
const r = new BambooPhysics();
for (let frame = 0; frame < 60 * 2; frame++) {
  r.rub(0.018, 1, 1.1);
  r.step(1 / 60);
}
console.log('2s vigorous rubbing ->', Math.round(r.rpm), 'rpm');

// Test the challenge threshold.
const s = new BambooPhysics();
s.setRpm(SING_RPM);
console.log('SING threshold rpm', SING_RPM, 'omega', (SING_RPM * Math.PI * 2 / 60).toFixed(2), 'max rpm', MAX_RPM);
