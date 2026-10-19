import { buildTrack } from '../src/track/build.js';
import { DESK_RAILS } from '../src/track/layout.js';
const track = buildTrack(DESK_RAILS);
const pc = track.piece;
const step = Number(process.argv[2] ?? 4);
console.log('   s     y   slope°  bank°  kSide    r_lat  vLim   vProf  inv');
for (let s = 0; s < track.length; s += step) {
  const i = Math.round(s / pc.ds) % pc.n;
  const k = pc.kSide[i];
  console.log(
    s.toFixed(1).padStart(6),
    pc.pos[3 * i + 1].toFixed(2).padStart(5),
    ((Math.asin(pc.slope[i]) * 180) / Math.PI).toFixed(0).padStart(6),
    ((pc.bank[i] * 180) / Math.PI).toFixed(0).padStart(6),
    k.toFixed(3).padStart(7),
    (Math.abs(k) > 1e-3 ? (1 / Math.abs(k)).toFixed(1) : '  inf').padStart(7),
    Math.min(pc.vLim[i], 99).toFixed(1).padStart(6),
    pc.profile.v[i].toFixed(1).padStart(6),
    pc.inv[i] ? ' *' : '',
  );
}
