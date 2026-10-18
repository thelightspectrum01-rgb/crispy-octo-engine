// Sculpted stone pieces: robed, hooded statues with glowing eyes, built procedurally.
// Bodies are surfaces of revolution with carved cloth folds and baked crevice occlusion;
// crowns, the horse head and the crenellations are added as extra solids.
import * as THREE from 'three';
import {mergeGeometries} from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import {PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE} from './chess.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function plinth(R) {
  return [
    [0, 0], [R - 0.012, 0], [R, 0.012], [R, 0.045], [R - 0.008, 0.058], [R - 0.03, 0.064], [R - 0.034, 0.075],
    [R - 0.025, 0.088], [R - 0.022, 0.1], [R - 0.03, 0.112], [R - 0.06, 0.12], [R - 0.07, 0.13],
  ];
}

// Masonry courses carved into a tower profile.
function grooved(points, grooves, depth = 0.007) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    out.push(points[i]);
    const next = points[i + 1];
    if (!next) continue;
    for (const y of grooves) {
      if (y > points[i][1] && y < next[1]) {
        const t = (y - points[i][1]) / (next[1] - points[i][1]);
        const r = points[i][0] + (next[0] - points[i][0]) * t;
        out.push([r, y - 0.006], [r - depth, y - 0.003], [r - depth, y + 0.003], [r, y + 0.006]);
      }
    }
  }
  return out;
}

// Approximate ambient occlusion per profile point: 2D rays against the profile and its mirror image.
function profileOcclusion(profile) {
  const segs = [];
  for (let i = 0; i < profile.length - 1; i++) {
    segs.push([profile[i], profile[i + 1], i]);
    segs.push([[-profile[i][0], profile[i][1]], [-profile[i + 1][0], profile[i + 1][1]], -1]);
  }
  const reach = 0.16;
  return profile.map((p, i) => {
    const a = profile[Math.max(0, i - 1)], b = profile[Math.min(profile.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    const nx = ty, ny = -tx;
    let occ = 0;
    const rays = 9;
    for (let k = 0; k < rays; k++) {
      const ang = (k / (rays - 1) - 0.5) * Math.PI * 0.85;
      const dx = nx * Math.cos(ang) - ny * Math.sin(ang), dy = nx * Math.sin(ang) + ny * Math.cos(ang);
      const ox = p[0] + nx * 0.003, oy = p[1] + ny * 0.003;
      let best = reach;
      for (const [s0, s1, idx] of segs) {
        if (idx === i || idx === i - 1) continue;
        const ex = s1[0] - s0[0], ey = s1[1] - s0[1];
        const det = dx * ey - dy * ex;
        if (Math.abs(det) < 1e-9) continue;
        const qx = s0[0] - ox, qy = s0[1] - oy;
        const t = (qx * ey - qy * ex) / det, u = (qx * dy - qy * dx) / det;
        if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
      }
      if (best < reach) occ += Math.pow(1 - best / reach, 1.5);
    }
    return Math.max(0.3, 1 - 0.9 * occ / rays);
  });
}

// Surface of revolution with optional radial displacement (cloth folds) and per-vertex shading.
function lathe(profile, segments, {displace = null, shade = null} = {}) {
  const n = profile.length, m = segments;
  const ao = profileOcclusion(profile);
  const lengths = [0];
  for (let i = 1; i < n; i++) lengths.push(lengths[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const grid = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < m; j++) {
      const theta = (j / m) * TAU;
      const [r0, y] = profile[i];
      const r = displace && r0 > 0 ? displace(theta, y, r0) : r0;
      row.push(new THREE.Vector3(r * Math.sin(theta), y, r * Math.cos(theta)));
    }
    grid.push(row);
  }
  const positions = [], normals = [], uvs = [], colors = [], index = [];
  const tTheta = new THREE.Vector3(), tProf = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= m; j++) {
      const jj = j % m;
      const p = grid[i][jj];
      const r = profile[i][0];
      if (r < 1e-6) {
        normal.set(0, i === 0 ? -1 : 1, 0);
      } else {
        tTheta.subVectors(grid[i][(jj + 1) % m], grid[i][(jj - 1 + m) % m]);
        const ia = Math.max(0, i - 1), ib = Math.min(n - 1, i + 1);
        tProf.subVectors(grid[ib][jj], grid[ia][jj]);
        normal.crossVectors(tTheta, tProf).normalize();
        if (normal.lengthSq() < 0.5) normal.set(Math.sin((jj / m) * TAU), 0, Math.cos((jj / m) * TAU));
      }
      positions.push(p.x, p.y, p.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push((j / m) * 2, lengths[i] * 1.2);
      const s = ao[i] * (shade ? shade((jj / m) * TAU, profile[i][1], r) : 1);
      colors.push(s, s, s);
    }
  }
  const row = m + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  return geometry;
}

const foldWave = theta => 0.55 * Math.sin(9 * theta + 0.3) + 0.3 * Math.sin(17 * theta + 1.1) + 0.15 * Math.sin(29 * theta + 2.0);

function robe(top, hem, amp, hood = null) {
  return {
    displace(theta, y, r) {
      let k = 1;
      if (y > hem && y < top) k += amp * smooth(top, hem, y) * foldWave(theta);
      if (hood && y > hood[0] && y < hood[1]) k += 0.07 * Math.max(0, -Math.cos(theta)) * Math.sin(Math.PI * (y - hood[0]) / (hood[1] - hood[0]));
      return r * k;
    },
    shade(theta, y) {
      if (y <= hem || y >= top) return 1;
      return 1 - 0.55 * smooth(top, hem, y) * Math.max(0, -foldWave(theta));
    },
  };
}

// Normalises a part for merging: non-indexed with position, normal, uv and colour.
function part(geometry, shade = 1, matrix = null) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
  if (matrix) g.applyMatrix4(matrix);
  if (!g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position.count;
  if (!g.attributes.uv) {
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      uv[i * 2] = g.attributes.position.getX(i) * 2 + g.attributes.position.getZ(i) * 2;
      uv[i * 2 + 1] = g.attributes.position.getY(i) * 2;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(shade), 3));
  return g;
}

const mat4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

function sphere(r, x, y, z, sx = 1, sy = 1, sz = 1, shade = 1, detail = 16) {
  return part(new THREE.SphereGeometry(r, detail, Math.max(8, detail * 0.75)), shade, mat4(x, y, z, 0, 0, 0, sx, sy, sz));
}

function faceParts(stone, glow, y, z, size) {
  // Hood opening (black void), a carved rim, and two glowing eyes.
  glow.push(sphere(1, 0, y, z, size * 1.0, size * 1.12, size * 0.78, 0, 18));
  stone.push(part(new THREE.TorusGeometry(size * 1.08, size * 0.2, 8, 24), 0.75, mat4(0, y + 0.002, z + size * 0.42, 0, 0, 0, 1, 1.14, 0.8)));
  for (const side of [-1, 1]) glow.push(sphere(size * 0.22, side * size * 0.4, y + size * 0.12, z + size * 0.68, 1, 0.8, 0.7, 1, 10));
}

// Closed annular sector (merlon) between radii and heights.
function ringSector(rIn, rOut, y0, y1, a0, a1, steps = 4) {
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const P = (r, a, y) => [r * Math.sin(a), y, r * Math.cos(a)];
  for (let s = 0; s < steps; s++) {
    const t0 = a0 + (a1 - a0) * (s / steps), t1 = a0 + (a1 - a0) * ((s + 1) / steps);
    quad(P(rOut, t0, y0), P(rOut, t1, y0), P(rOut, t1, y1), P(rOut, t0, y1));
    quad(P(rIn, t1, y0), P(rIn, t0, y0), P(rIn, t0, y1), P(rIn, t1, y1));
    quad(P(rOut, t0, y1), P(rOut, t1, y1), P(rIn, t1, y1), P(rIn, t0, y1));
  }
  quad(P(rIn, a0, y0), P(rOut, a0, y0), P(rOut, a0, y1), P(rIn, a0, y1));
  quad(P(rOut, a1, y0), P(rIn, a1, y0), P(rIn, a1, y1), P(rOut, a1, y1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return part(g, 0.95);
}

function archShape(w, h) {
  const s = new THREE.Shape();
  const spring = h - w * 0.8;
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, spring);
  s.quadraticCurveTo(-w / 2, h - w * 0.25, 0, h);
  s.quadraticCurveTo(w / 2, h - w * 0.25, w / 2, spring);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}

function horseHead(segments) {
  const pts = [
    [-0.16, 0.22], [-0.18, 0.32], [-0.186, 0.42], [-0.172, 0.52], [-0.143, 0.62], [-0.103, 0.7], [-0.072, 0.762],
    [-0.066, 0.8], [-0.052, 0.888], [-0.012, 0.806], [0.03, 0.792], [0.09, 0.752], [0.15, 0.702], [0.2, 0.652],
    [0.245, 0.602], [0.27, 0.562], [0.281, 0.53], [0.276, 0.505], [0.256, 0.49], [0.214, 0.488], [0.236, 0.47],
    [0.226, 0.455], [0.19, 0.45], [0.14, 0.46], [0.09, 0.48], [0.06, 0.45], [0.055, 0.4], [0.07, 0.34], [0.1, 0.28], [0.13, 0.22],
  ];
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = 0.12;
  const geo = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.028,
    bevelSegments: segments > 32 ? 4 : 2, curveSegments: 6});
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  // Shape space (forward, up, thickness) -> piece space (z, y, x), centred on the axis.
  geo.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  geo.translate(depth / 2, 0, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), y = p.getY(i);
    const taper = 1.12 - 0.38 * smooth(0.0, 0.29, z) + 0.12 * smooth(0.4, 0.25, y) - 0.1 * smooth(0.72, 0.86, y);
    p.setX(i, p.getX(i) * taper);
  }
  geo.computeVertexNormals();
  return part(geo, 1);
}

function horseMane() {
  const back = [[-0.07, 0.775], [-0.1, 0.71], [-0.138, 0.63], [-0.166, 0.53], [-0.18, 0.43], [-0.176, 0.33], [-0.16, 0.25]];
  const outer = [], inner = [];
  back.forEach(([x, y], i) => {
    const out = 0.04 + (i % 2 ? 0.012 : 0.0);
    outer.push(new THREE.Vector2(x - out * 0.9, y + out * 0.25));
    inner.push(new THREE.Vector2(x + 0.03, y));
  });
  const shape = new THREE.Shape([...outer, ...inner.reverse()]);
  const depth = 0.05;
  const geo = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4});
  geo.deleteAttribute('uv');
  geo.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  geo.translate(depth / 2, 0, 0);
  geo.computeVertexNormals();
  return part(geo, 0.85);
}

function crownSpikes(stone, count, radius, y0, height, base, ball, tilt, phase = 0) {
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * TAU;
    const x = Math.sin(a) * radius, z = Math.cos(a) * radius;
    const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(tilt));
    m.setPosition(x, y0 + height / 2, z);
    stone.push(part(new THREE.ConeGeometry(base, height, 8), 0.95, m));
    const tip = new THREE.Vector3(0, height / 2, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(tilt)));
    if (ball) stone.push(sphere(ball, x + tip.x, y0 + height / 2 + tip.y, z + tip.z, 1, 1, 1, 1, 10));
  }
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, shade = 1) {
  return part(new THREE.BoxGeometry(w, h, d), shade, mat4(x, y, z, rx, ry, rz));
}

// Piece blueprints. Each yields stone + glow geometry, size data and fracture volumes.
const BLUEPRINTS = {
  [PAWN](seg) {
    const profile = [...plinth(0.29),
      [0.218, 0.14], [0.212, 0.17], [0.198, 0.22], [0.178, 0.28], [0.156, 0.34], [0.136, 0.4], [0.122, 0.45], [0.118, 0.48],
      [0.125, 0.5], [0.128, 0.52], [0.12, 0.54], [0.1, 0.552], [0.104, 0.558], [0.108, 0.568], [0.1, 0.578], [0.075, 0.585],
      [0.07, 0.59], [0.088, 0.605], [0.1, 0.63], [0.106, 0.66], [0.104, 0.69], [0.096, 0.715], [0.08, 0.738], [0.058, 0.755], [0.03, 0.766], [0, 0.77]];
    const stone = [part(lathe(profile, seg, robe(0.48, 0.14, 0.085, [0.6, 0.77])))], glow = [];
    faceParts(stone, glow, 0.662, 0.075, 0.05);
    return {stone, glow, profile, height: 0.77, radius: 0.29, eye: 0.67, weapon: 'spear'};
  },
  [ROOK](seg) {
    const tower = grooved([[0.255, 0.14], [0.245, 0.2], [0.236, 0.4], [0.222, 0.62]], [0.25, 0.36, 0.47, 0.58]);
    const profile = [...plinth(0.33), ...tower,
      [0.232, 0.635], [0.255, 0.66], [0.272, 0.685], [0.278, 0.7], [0.278, 0.728], [0.2, 0.728], [0.2, 0.74], [0.12, 0.745], [0, 0.75]];
    const stone = [part(lathe(profile, seg))], glow = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + TAU / 24;
      stone.push(ringSector(0.198, 0.278, 0.72, 0.87, a, a + TAU / 9));
    }
    const arch = new THREE.ShapeGeometry(archShape(0.05, 0.11), 6);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const r = 0.238;
      glow.push(part(arch, 1, mat4(Math.sin(a) * r, 0.37, Math.cos(a) * r, 0, a, 0)));
    }
    glow.push(part(new THREE.ShapeGeometry(archShape(0.1, 0.15), 6), 0, mat4(0, 0.14, 0.2505, 0, 0, 0)));
    return {stone, glow, profile, height: 0.87, radius: 0.33, eye: 0.42, weapon: null};
  },
  [KNIGHT](seg) {
    const profile = [...plinth(0.32), [0.245, 0.14], [0.235, 0.17], [0.215, 0.2], [0.19, 0.225], [0.15, 0.24], [0, 0.245]];
    const stone = [part(lathe(profile, seg)), horseHead(seg), horseMane()], glow = [];
    for (const side of [-1, 1]) {
      glow.push(sphere(0.016, side * 0.097, 0.69, 0.12, 0.5, 1, 1, 1, 10));
      glow.push(sphere(0.013, side * 0.042, 0.522, 0.268, 0.7, 1, 1, 0, 8));
    }
    const volumes = [
      {type: 'frustum', y0: 0, y1: 0.245, r0: 0.32, r1: 0.2},
      {type: 'box', center: [0, 0.42, -0.02], size: [0.22, 0.38, 0.4]},
      {type: 'box', center: [0, 0.7, 0.08], size: [0.18, 0.34, 0.42]},
    ];
    return {stone, glow, profile, height: 0.93, radius: 0.32, eye: 0.69, weapon: null, volumes};
  },
  [BISHOP](seg) {
    const profile = [...plinth(0.31),
      [0.238, 0.14], [0.228, 0.19], [0.208, 0.26], [0.184, 0.34], [0.16, 0.42], [0.142, 0.5], [0.13, 0.57], [0.126, 0.61],
      [0.134, 0.63], [0.138, 0.655], [0.13, 0.675], [0.11, 0.685], [0.118, 0.69], [0.122, 0.7], [0.114, 0.712], [0.08, 0.72],
      [0.075, 0.725], [0.086, 0.74], [0.094, 0.765], [0.095, 0.79], [0.09, 0.81], [0.1, 0.815], [0.104, 0.83], [0.1, 0.84],
      [0.096, 0.842], [0.1, 0.86], [0.104, 0.885], [0.1, 0.92], [0.088, 0.955], [0.07, 0.99], [0.048, 1.02], [0.03, 1.04],
      [0.018, 1.046], [0.026, 1.056], [0.03, 1.07], [0.026, 1.084], [0.014, 1.093], [0, 1.096]];
    const stone = [part(lathe(profile, seg, robe(0.6, 0.14, 0.075)))], glow = [];
    faceParts(stone, glow, 0.764, 0.066, 0.044);
    glow.push(box(0.014, 0.15, 0.1, 0, 0.935, 0.062, 0, 0, -0.6, 0));
    stone.push(box(0.016, 0.1, 0.02, 0, 0.47, 0.152, -0.15, 0, 0, 1.05), box(0.064, 0.016, 0.02, 0, 0.49, 0.149, -0.15, 0, 0, 1.05));
    return {stone, glow, profile, height: 1.1, radius: 0.31, eye: 0.77, weapon: 'staff'};
  },
  [QUEEN](seg) {
    const profile = [...plinth(0.34),
      [0.268, 0.14], [0.258, 0.2], [0.238, 0.28], [0.212, 0.36], [0.185, 0.45], [0.158, 0.55], [0.138, 0.64], [0.128, 0.7],
      [0.132, 0.73], [0.142, 0.77], [0.146, 0.795], [0.14, 0.815], [0.125, 0.83], [0.14, 0.835], [0.162, 0.85], [0.168, 0.865],
      [0.155, 0.878], [0.11, 0.885], [0.068, 0.89], [0.066, 0.91], [0.08, 0.925], [0.09, 0.95], [0.092, 0.975], [0.086, 0.998],
      [0.074, 1.012], [0.094, 1.016], [0.1, 1.035], [0.1, 1.05], [0.088, 1.055], [0.075, 1.065], [0.055, 1.08], [0.03, 1.09], [0, 1.093]];
    const stone = [part(lathe(profile, seg, robe(0.68, 0.14, 0.09)))], glow = [];
    faceParts(stone, glow, 0.958, 0.063, 0.043);
    crownSpikes(stone, 8, 0.093, 1.04, 0.1, 0.02, 0.016, 0.28);
    stone.push(part(new THREE.CylinderGeometry(0.012, 0.016, 0.03, 8), 1, mat4(0, 1.1, 0)), sphere(0.033, 0, 1.13, 0, 1, 1, 1, 1, 14));
    return {stone, glow, profile, height: 1.17, radius: 0.34, eye: 0.965, weapon: 'sword'};
  },
  [KING](seg) {
    const profile = [...plinth(0.35),
      [0.278, 0.14], [0.268, 0.2], [0.25, 0.28], [0.228, 0.37], [0.204, 0.47], [0.18, 0.57], [0.162, 0.66], [0.154, 0.73],
      [0.158, 0.78], [0.166, 0.82], [0.182, 0.85], [0.188, 0.87], [0.18, 0.89], [0.16, 0.905], [0.12, 0.915], [0.125, 0.92],
      [0.128, 0.93], [0.115, 0.94], [0.078, 0.945], [0.088, 0.96], [0.098, 0.985], [0.1, 1.01], [0.095, 1.035], [0.085, 1.05],
      [0.105, 1.055], [0.112, 1.075], [0.112, 1.095], [0.1, 1.1], [0.09, 1.11], [0.075, 1.14], [0.052, 1.165], [0.026, 1.18], [0, 1.185]];
    const stone = [part(lathe(profile, seg, robe(0.72, 0.14, 0.08)))], glow = [];
    faceParts(stone, glow, 0.994, 0.071, 0.046);
    crownSpikes(stone, 6, 0.106, 1.085, 0.075, 0.018, 0.014, 0.18, TAU / 12);
    stone.push(sphere(0.03, 0, 1.19, 0, 1, 1, 1, 1, 12), box(0.036, 0.2, 0.036, 0, 1.29, 0), box(0.13, 0.036, 0.036, 0, 1.315, 0));
    return {stone, glow, profile, height: 1.39, radius: 0.35, eye: 1.0, weapon: 'greatsword'};
  },
};

// Convex fracture volumes for a lathe profile: stacked frusta that enclose each height band.
function profileVolumes(profile, height) {
  const outline = profile.filter(p => p[0] > 0);
  const radiusAt = y => {
    let r = 0;
    for (let i = 0; i < outline.length - 1; i++) {
      const [r0, y0] = outline[i], [r1, y1] = outline[i + 1];
      if ((y >= y0 && y <= y1) || (y >= y1 && y <= y0)) {
        const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
        r = Math.max(r, r0 + (r1 - r0) * t);
      }
    }
    return r;
  };
  const bands = Math.max(4, Math.round(height / 0.11));
  const volumes = [];
  for (let b = 0; b < bands; b++) {
    const y0 = (b / bands) * height, y1 = ((b + 1) / bands) * height;
    let r0 = radiusAt(y0), r1 = radiusAt(y1), k = 1;
    for (let s = 1; s < 8; s++) {
      const y = y0 + (y1 - y0) * (s / 8);
      const lin = r0 + (r1 - r0) * (s / 8);
      if (lin > 0.01) k = Math.max(k, radiusAt(y) / lin);
    }
    k = Math.min(k, 1.6);
    r0 = Math.max(0.02, r0 * k);
    r1 = Math.max(0.02, r1 * k);
    volumes.push({type: 'frustum', y0, y1, r0, r1});
  }
  return volumes;
}

export class PieceFactory {
  constructor({textures, segments = 48}) {
    this.models = {};
    for (const type of [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING]) {
      const bp = BLUEPRINTS[type](segments);
      const stone = mergeGeometries(bp.stone, false);
      const glow = mergeGeometries(bp.glow, false);
      stone.computeBoundingSphere();
      for (const g of [...bp.stone, ...bp.glow]) g.dispose();
      this.models[type] = {stone, glow, height: bp.height, radius: bp.radius, eye: bp.eye, weapon: bp.weapon,
        volumes: bp.volumes || profileVolumes(bp.profile, bp.height)};
    }
    const common = {vertexColors: true, normalMap: textures.stoneNormal, normalScale: new THREE.Vector2(0.55, 0.55)};
    this.stoneMaterials = [
      new THREE.MeshStandardMaterial({...common, map: textures.whiteMarble, roughness: 0.36, metalness: 0, envMapIntensity: 0.75}),
      new THREE.MeshStandardMaterial({...common, map: textures.blackMarble, roughness: 0.3, metalness: 0, envMapIntensity: 0.9}),
    ];
    this.glowColors = [new THREE.Color(0.55, 1.6, 2.4), new THREE.Color(2.6, 0.7, 0.18)];
    this.glowMaterials = this.glowColors.map(c => new THREE.MeshBasicMaterial({color: c.clone(), vertexColors: true}));
  }

  create(type, color) {
    return new PieceView(this, type, color);
  }
}

// One piece on the board. root: board placement and facing; pose: animation offsets (pivot at the base).
export class PieceView {
  constructor(factory, type, color) {
    const model = factory.models[type];
    this.factory = factory;
    this.type = type;
    this.color = color;
    this.model = model;
    this.root = new THREE.Group();
    this.pose = new THREE.Group();
    this.root.add(this.pose);
    this.body = new THREE.Mesh(model.stone, factory.stoneMaterials[color]);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.glowMaterial = factory.glowMaterials[color].clone();
    this.glow = new THREE.Mesh(model.glow, this.glowMaterial);
    this.pose.add(this.body, this.glow);
    this.facing = color === WHITE ? Math.PI : 0;
    this.root.rotation.y = this.facing;
    this.root.userData.piece = this;
    this.body.userData.piece = this;
    this.glowLevel = 1;
    this.glowTarget = 1;
    this.alive = true;
  }

  get height() { return this.model.height; }
  get radius() { return this.model.radius; }

  setGlow(level) { this.glowTarget = level; }

  setOpacity(alpha) {
    const transparent = alpha < 0.999;
    if (transparent && this.body.material === this.factory.stoneMaterials[this.color]) {
      this.body.material = this.body.material.clone();
    }
    this.body.material.transparent = transparent;
    this.body.material.opacity = alpha;
    this.body.material.depthWrite = !transparent || alpha > 0.6;
    this.glowMaterial.transparent = transparent;
    this.glowMaterial.opacity = alpha;
    if (!transparent && this.body.material !== this.factory.stoneMaterials[this.color]) {
      this.body.material.dispose();
      this.body.material = this.factory.stoneMaterials[this.color];
    }
  }

  update(dt, pulse) {
    this.glowLevel += (this.glowTarget - this.glowLevel) * Math.min(1, dt * 6);
    const base = this.factory.glowColors[this.color];
    const k = this.glowLevel * pulse;
    this.glowMaterial.color.setRGB(base.r * k, base.g * k, base.b * k);
  }

  dispose() {
    this.glowMaterial.dispose();
    if (this.body.material !== this.factory.stoneMaterials[this.color]) this.body.material.dispose();
    this.root.removeFromParent();
  }
}
