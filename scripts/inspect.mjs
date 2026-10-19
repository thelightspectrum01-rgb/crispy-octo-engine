// Track inspector: prints design statistics and writes an SVG (plan / elevation / speed profile).
//   node scripts/inspect.mjs [out.svg]
import { writeFileSync } from 'node:fs';
import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS } from '../src/track/layout.js';
import { PHYS } from '../src/config.js';

const out = process.argv[2] ?? '/tmp/track.svg';
const t0 = performance.now();
const track = buildTrack(DESK_RAILS);
const ms = performance.now() - t0;
const pc = track.piece;
const { n, ds } = pc;

const plan = track.plan;
console.log(`built in ${ms.toFixed(0)} ms | samples ${n} | length ${track.length.toFixed(1)} u`);
console.log(`closure: dx=${plan.closure.dx.toExponential(2)} dz=${plan.closure.dz.toExponential(2)} dpsi=${plan.closure.dpsi.toExponential(2)} turns=${plan.closure.turns} free=`, plan.closure.free);
const b = track.bounds;
console.log(`bounds x[${b.min.x.toFixed(1)}, ${b.max.x.toFixed(1)}] y[${b.min.y.toFixed(1)}, ${b.max.y.toFixed(1)}] z[${b.min.z.toFixed(1)}, ${b.max.z.toFixed(1)}]`);

let maxSlope = 0, maxBank = 0, maxKside = 0, minV = 99, maxV = 0, maxKup = -99, minKup = 99;
for (let i = 0; i < n; i++) {
  maxSlope = Math.max(maxSlope, Math.abs(pc.slope[i]));
  maxBank = Math.max(maxBank, Math.abs(pc.bank[i]));
  maxKside = Math.max(maxKside, Math.abs(pc.kSide[i]));
  minV = Math.min(minV, pc.profile.v[i]);
  maxV = Math.max(maxV, pc.profile.v[i]);
  if (!pc.inv[i]) {
    maxKup = Math.max(maxKup, pc.kUp[i]);
    minKup = Math.min(minKup, pc.kUp[i]);
  }
}
console.log(`max slope ${(Math.asin(maxSlope) * 180 / Math.PI).toFixed(1)}° | max bank ${(maxBank * 180 / Math.PI).toFixed(1)}° | min radius (lateral) ${(1 / maxKside).toFixed(1)} u`);
console.log(`profile speed ${minV.toFixed(1)}..${maxV.toFixed(1)} u/s | reference lap time ${track.referenceTime.toFixed(2)} s | boosted ${pc.profileBoost.time.toFixed(2)} s`);
console.log(`vertical curvature (non-inverted): ${minKup.toFixed(3)} .. ${maxKup.toFixed(3)} 1/u`);
console.log('inversions', pc.inversions);
console.log('zones', pc.zones);
console.log('pickups', track.pickups.map((s) => s.toFixed(1)).join(' '));
console.log('checkpoints', track.checkpoints.map((s) => s.toFixed(1)).join(' '));

// ---- minimum vertical load / airtime estimate along the profile
let minUp = 99, minUpS = 0, maxUp = -99, maxUpS = 0;
for (let i = 0; i < n; i++) {
  if (pc.inv[i]) continue;
  const v = pc.profile.v[i];
  const fUp = (v * v * pc.kUp[i] + PHYS.G * pc.gUp[i]) / PHYS.G;
  if (fUp < minUp) { minUp = fUp; minUpS = i * ds; }
  if (fUp > maxUp) { maxUp = fUp; maxUpS = i * ds; }
}
console.log(`vertical load along profile: min ${minUp.toFixed(2)} g @ s=${minUpS.toFixed(1)}, max ${maxUp.toFixed(2)} g @ s=${maxUpS.toFixed(1)}`);

// ---- svg
const W = 1400;
const margin = 30;
const sc = (W - 2 * margin) / (b.max.x - b.min.x);
const planH = (b.max.z - b.min.z) * sc + 2 * margin;
const sideH = 180;
const profH = 200;
const H = planH + sideH + profH + 40;
const col = (v) => {
  const t = Math.min(1, Math.max(0, (v - 3) / 11));
  const r = Math.round(255 * Math.min(1, t * 2));
  const g = Math.round(255 * (t < 0.5 ? t * 2 : (1 - t) * 2));
  const bl = Math.round(255 * Math.max(0, 1 - t * 2));
  return `rgb(${r},${g},${bl})`;
};
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="monospace" font-size="11"><rect width="100%" height="100%" fill="#fff"/>`;
const px = (x) => margin + (x - b.min.x) * sc;
const pz = (z) => margin + (z - b.min.z) * sc;
// plan
for (let i = 0; i < n; i++) {
  const j = (i + 1) % n;
  svg += `<line x1="${px(pc.pos[3 * i]).toFixed(1)}" y1="${pz(pc.pos[3 * i + 2]).toFixed(1)}" x2="${px(pc.pos[3 * j]).toFixed(1)}" y2="${pz(pc.pos[3 * j + 2]).toFixed(1)}" stroke="${col(pc.profile.v[i])}" stroke-width="${2 + pc.pos[3 * i + 1] * 0.6}" stroke-linecap="round"/>`;
}
const mark = (s, label, color = '#000') => {
  pc.locate(s);
  const i = pc._i0;
  svg += `<circle cx="${px(pc.pos[3 * i])}" cy="${pz(pc.pos[3 * i + 2])}" r="5" fill="${color}"/><text x="${px(pc.pos[3 * i]) + 7}" y="${pz(pc.pos[3 * i + 2]) - 7}" fill="${color}">${label}</text>`;
};
mark(0, 'FINISH', '#c00');
for (const [k, v] of Object.entries(track.anchors)) if (k !== 'finish') mark(v, k, '#06c');
track.pickups.forEach((s, i) => mark(s, 'p' + i, '#090'));
track.checkpoints.forEach((s, i) => mark(s, 'cp' + i, '#a60'));
svg += `<text x="${margin}" y="14">PLAN (x→, z↓)  length ${track.length.toFixed(1)}  ref lap ${track.referenceTime.toFixed(2)}s  color = profile speed (blue slow → red fast)</text>`;
// elevation
const y0 = planH + 10;
const sx = (s) => margin + (s / track.length) * (W - 2 * margin);
const sy = (y) => y0 + sideH - 14 - y * 18;
let d = '';
for (let i = 0; i < n; i += 2) d += `${i ? 'L' : 'M'}${sx(i * ds).toFixed(1)},${sy(pc.pos[3 * i + 1]).toFixed(1)}`;
svg += `<path d="${d}" fill="none" stroke="#333" stroke-width="1.5"/><text x="${margin}" y="${y0 + 4}">ELEVATION (y vs s, ×18 px/u)</text>`;
// profile
const y1 = y0 + sideH + 10;
const vy = (v) => y1 + profH - 14 - v * 11;
d = '';
let d2 = '';
for (let i = 0; i < n; i += 2) {
  d += `${i ? 'L' : 'M'}${sx(i * ds).toFixed(1)},${vy(pc.profile.v[i]).toFixed(1)}`;
  d2 += `${i ? 'L' : 'M'}${sx(i * ds).toFixed(1)},${vy(Math.min(pc.vLim[i], 18)).toFixed(1)}`;
}
svg += `<path d="${d2}" fill="none" stroke="#ccc" stroke-width="1"/><path d="${d}" fill="none" stroke="#d33" stroke-width="1.5"/><text x="${margin}" y="${y1 + 4}">SPEED PROFILE (red) vs cornering limit (grey), 11 px per u/s</text>`;
for (const iv of pc.inversions) svg += `<rect x="${sx(iv.s0)}" y="${y1}" width="${sx(iv.s1) - sx(iv.s0)}" height="${profH}" fill="#0af" opacity="0.15"/>`;
svg += '</svg>';
writeFileSync(out, svg);
console.log('wrote', out);
