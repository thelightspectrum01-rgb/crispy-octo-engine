import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  LinearMipmapLinearFilter,
  LinearFilter,
} from 'three';

/* ------------------------------------------------------------------ tiny utilities */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const SIZE = 256;
  const grid = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (x, y) => grid[((y & (SIZE - 1)) << 8) | (x & (SIZE - 1))];
  const smooth = (t) => t * t * (3 - 2 * t);
  const value = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  const fbm = (x, y, oct = 4) => {
    let amp = 0.5;
    let f = 1;
    let sum = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * value(x * f, y * f);
      f *= 2;
      amp *= 0.5;
    }
    return sum;
  };
  return { value, fbm };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { repeat = false, srgb = true, aniso = 8, mip = true } = {}) {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  }
  t.anisotropy = aniso;
  t.generateMipmaps = mip;
  t.minFilter = mip ? LinearMipmapLinearFilter : LinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------ desk wood */

export function woodTexture({ size = 1024, aniso = 8 } = {}) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = makeNoise(7);
  const rnd = mulberry32(99);
  const planks = 4;
  const plankH = size / planks;
  const tone = [];
  for (let i = 0; i < planks; i++) tone.push(0.85 + rnd() * 0.3);
  const dark = [104, 72, 46];
  const light = [168, 126, 84];
  for (let y = 0; y < size; y++) {
    const pi = Math.floor(y / plankH);
    const seam = (y % plankH) < 2.2 ? 0.55 : 1;
    for (let x = 0; x < size; x++) {
      const warp = n.fbm(x * 0.0025 + pi * 13.1, y * 0.012, 3) * 7;
      const ring = 0.5 + 0.5 * Math.sin(y * 0.09 + warp * 3.2 + pi * 7.0);
      const fine = n.value(x * 0.5, y * 0.07 + pi * 5) * 0.5 + n.value(x * 0.08, y * 0.9) * 0.25;
      let v = Math.pow(ring, 1.6) * 0.45 + fine * 0.55;
      v = Math.min(1, Math.max(0, v)) * tone[pi] * seam;
      const idx = (y * size + x) * 4;
      img.data[idx] = dark[0] + (light[0] - dark[0]) * v;
      img.data[idx + 1] = dark[1] + (light[1] - dark[1]) * v;
      img.data[idx + 2] = dark[2] + (light[2] - dark[2]) * v;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { repeat: true, aniso });
}

/* ------------------------------------------------------------------ cutting mat */

/**
 * Self-healing cutting mat: teal base, white grid (1 u cells, heavier every 5 u), edge numbers and
 * angle arcs. `wU` x `hU` are the mat dimensions in world units.
 */
export function cuttingMatTexture(wU, hU, { pxPerUnit = 26, aniso = 8 } = {}) {
  const W = Math.round(wU * pxPerUnit);
  const H = Math.round(hU * pxPerUnit);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const n = makeNoise(21);
  // base
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1d6f6a');
  g.addColorStop(1, '#165a62');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // subtle mottling / wear
  const img = ctx.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = (n.fbm(x * 0.012, y * 0.012, 3) - 0.5) * 22 + (n.value(x * 0.9, y * 0.9) - 0.5) * 6;
      const i = (y * W + x) * 4;
      img.data[i] += v;
      img.data[i + 1] += v;
      img.data[i + 2] += v;
    }
  }
  ctx.putImageData(img, 0, 0);

  const margin = pxPerUnit * 1.6;
  const gx0 = margin;
  const gy0 = margin;
  const gx1 = W - margin;
  const gy1 = H - margin;
  // grid
  for (let u = 0; ; u++) {
    const x = gx0 + u * pxPerUnit;
    if (x > gx1 + 0.5) break;
    const major = u % 5 === 0;
    ctx.strokeStyle = major ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.26)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, gy0);
    ctx.lineTo(x, gy1);
    ctx.stroke();
  }
  for (let u = 0; ; u++) {
    const y = gy0 + u * pxPerUnit;
    if (y > gy1 + 0.5) break;
    const major = u % 5 === 0;
    ctx.strokeStyle = major ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.26)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(gx0, y);
    ctx.lineTo(gx1, y);
    ctx.stroke();
  }
  // outer frame + tick marks
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `${Math.round(pxPerUnit * 0.62)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let u = 0; gx0 + u * pxPerUnit <= gx1 + 0.5; u += 5) {
    const x = gx0 + u * pxPerUnit;
    ctx.fillText(String(u), x, gy0 - margin * 0.5);
    ctx.fillText(String(u), x, gy1 + margin * 0.5);
  }
  for (let u = 0; gy0 + u * pxPerUnit <= gy1 + 0.5; u += 5) {
    const y = gy0 + u * pxPerUnit;
    ctx.fillText(String(u), gx0 - margin * 0.5, y);
    ctx.fillText(String(u), gx1 + margin * 0.5, y);
  }
  // angle arcs in the corners
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  for (const [cx, cy, a0] of [
    [gx0, gy0, 0],
    [gx1, gy0, Math.PI / 2],
    [gx1, gy1, Math.PI],
    [gx0, gy1, (3 * Math.PI) / 2],
  ]) {
    for (let r = 3; r <= 9; r += 3) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * pxPerUnit, a0, a0 + Math.PI / 2);
      ctx.stroke();
    }
    for (let a = 0; a <= 90; a += 15) {
      const ang = a0 + (a * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * 8.4 * pxPerUnit, cy + Math.sin(ang) * 8.4 * pxPerUnit);
      ctx.lineTo(cx + Math.cos(ang) * 9 * pxPerUnit, cy + Math.sin(ang) * 9 * pxPerUnit);
      ctx.stroke();
    }
  }
  // brand text
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.font = `800 ${Math.round(pxPerUnit * 2.1)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('DESK COASTER  ·  TIME TRIAL', gx0 + pxPerUnit * 1.5, gy1 - pxPerUnit * 1.3);
  ctx.restore();
  return toTexture(c, { aniso });
}

/* ------------------------------------------------------------------ paper & stationery */

export function paperTexture({ w = 512, h = 640, lines = true, grid = false, margin = true, seed = 3 } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.fillStyle = '#e4dcc8';
  ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rnd() - 0.5) * 8;
    img.data[i] += v;
    img.data[i + 1] += v;
    img.data[i + 2] += v;
  }
  ctx.putImageData(img, 0, 0);
  if (lines) {
    ctx.strokeStyle = 'rgba(70,120,190,0.45)';
    ctx.lineWidth = 1.5;
    for (let y = 60; y < h - 20; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
  if (grid) {
    ctx.strokeStyle = 'rgba(70,120,190,0.3)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 22) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0; x < w; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
  if (margin) {
    ctx.strokeStyle = 'rgba(220,70,70,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(70, 0);
    ctx.lineTo(70, h);
    ctx.stroke();
  }
  // scribbles
  ctx.strokeStyle = 'rgba(30,40,90,0.7)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let y = 56; y < h - 60; y += 26) {
    if (rnd() < 0.25) continue;
    let x = 84;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const end = 84 + (w - 140) * (0.35 + rnd() * 0.6);
    while (x < end) {
      x += 5 + rnd() * 9;
      ctx.lineTo(x, y - 6 * rnd() + (rnd() < 0.15 ? -9 : 0));
    }
    ctx.stroke();
  }
  return toTexture(c);
}

export function rulerTexture({ w = 1024, h = 96 } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#ffd34d');
  g.addColorStop(1, '#f2b61c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2a2316';
  ctx.strokeStyle = '#2a2316';
  const cm = w / 30;
  for (let i = 0; i <= 30 * 10; i++) {
    const x = (i * cm) / 10;
    const len = i % 10 === 0 ? h * 0.5 : i % 5 === 0 ? h * 0.36 : h * 0.22;
    ctx.lineWidth = i % 10 === 0 ? 2.5 : 1.6;
    ctx.beginPath();
    ctx.moveTo(x + 2, 0);
    ctx.lineTo(x + 2, len);
    ctx.stroke();
  }
  ctx.font = `bold ${Math.round(h * 0.28)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  for (let i = 1; i < 30; i++) ctx.fillText(String(i), i * cm + 2, h * 0.82);
  return toTexture(c);
}

export function stickyTexture(color = '#ffe66b', seed = 5) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, color);
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const sh = ctx.createLinearGradient(0, 200, 0, 256);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.09)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, 200, 256, 56);
  ctx.strokeStyle = 'rgba(40,40,60,0.75)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // little roller-coaster doodle
  ctx.beginPath();
  ctx.moveTo(30, 150);
  ctx.bezierCurveTo(60, 60, 90, 60, 120, 140);
  ctx.bezierCurveTo(140, 190, 160, 190, 180, 120);
  ctx.bezierCurveTo(195, 70, 215, 80, 230, 130);
  ctx.stroke();
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(40, 190 + i * 16);
    ctx.lineTo(60 + rnd() * 140, 190 + i * 16);
    ctx.stroke();
  }
  return toTexture(c);
}

/* ------------------------------------------------------------------ signage */

export function bannerTexture(text, { w = 1024, h = 256, checker = true } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#10151c';
  ctx.fillRect(0, 0, w, h);
  if (checker) {
    const s = h / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < w / s; x++) {
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = '#f5f5f5';
          ctx.fillRect(x * s, y * s, s, s);
        }
      }
    }
    ctx.fillStyle = 'rgba(16,21,28,0.86)';
    roundRect(ctx, w * 0.1, h * 0.14, w * 0.8, h * 0.72, 28);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${Math.round(h * 0.52)}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h * 0.53);
  return toTexture(c, { aniso: 8 });
}

export function signTexture(line1, line2 = '', { bg = '#ffcc1f', fg = '#1b1b1b', w = 256, h = 256, arrow = 0 } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  roundRect(ctx, 6, 6, w - 12, h - 12, 34);
  ctx.fill();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 10;
  roundRect(ctx, 16, 16, w - 32, h - 32, 26);
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(h * 0.4)}px "Arial Black", Impact, sans-serif`;
  ctx.fillText(line1, w / 2, h * (line2 ? 0.4 : 0.5));
  if (line2) {
    ctx.font = `800 ${Math.round(h * 0.17)}px "Arial Black", Impact, sans-serif`;
    ctx.fillText(line2, w / 2, h * 0.74);
  }
  if (arrow) {
    ctx.beginPath();
    const cx = w / 2;
    const cy = h * 0.82;
    ctx.moveTo(cx - 34 * arrow, cy - 12);
    ctx.lineTo(cx + 12 * arrow, cy - 12);
    ctx.lineTo(cx + 12 * arrow, cy - 24);
    ctx.lineTo(cx + 40 * arrow, cy);
    ctx.lineTo(cx + 12 * arrow, cy + 24);
    ctx.lineTo(cx + 12 * arrow, cy + 12);
    ctx.lineTo(cx - 34 * arrow, cy + 12);
    ctx.closePath();
    ctx.fill();
  }
  return toTexture(c);
}

/* ------------------------------------------------------------------ monitor wallpaper */

export function screenTexture({ w = 1024, h = 576 } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#0b1230');
  g.addColorStop(0.55, '#16316b');
  g.addColorStop(1, '#6a2d7a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // sunset track silhouette
  ctx.fillStyle = 'rgba(255,170,90,0.9)';
  ctx.beginPath();
  ctx.arc(w * 0.74, h * 0.62, h * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0d1a';
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
  ctx.strokeStyle = '#ff5a3c';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.82);
  ctx.bezierCurveTo(w * 0.15, h * 0.5, w * 0.25, h * 0.4, w * 0.35, h * 0.72);
  ctx.bezierCurveTo(w * 0.42, h * 0.9, w * 0.5, h * 0.9, w * 0.56, h * 0.7);
  ctx.bezierCurveTo(w * 0.62, h * 0.5, w * 0.7, h * 0.5, w * 0.76, h * 0.7);
  ctx.bezierCurveTo(w * 0.83, h * 0.9, w * 0.92, h * 0.9, w, h * 0.78);
  ctx.stroke();
  ctx.lineWidth = 3;
  for (let x = 20; x < w; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, h * 0.74);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${Math.round(h * 0.11)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('DESK COASTER', w * 0.5, h * 0.2);
  ctx.font = `600 ${Math.round(h * 0.045)}px Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('screensaver', w * 0.5, h * 0.27);
  return toTexture(c);
}

/* ------------------------------------------------------------------ soft sprites */

export function glowTexture({ size = 128, inner = 0.0, outer = 1.0, color = '255,255,255' } = {}) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.5 * inner, size / 2, size / 2, size * 0.5 * outer);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(0.35, `rgba(${color},0.45)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, { aniso: 1, mip: false });
}

/** Soft round shadow blob, alpha only (used under props / the cart). */
export function blobShadowTexture(size = 128) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, { aniso: 1, mip: false });
}

export function numberTexture(text, { color = '#ffffff', bg = null, size = 128 } = {}) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.fillStyle = color;
  ctx.font = `900 ${Math.round(size * 0.7)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + size * 0.04);
  return toTexture(c, { aniso: 4 });
}

/** 360° room backdrop with soft bokeh lights (wrapped around a big cylinder). */
export function backdropTexture({ w = 2048, h = 512 } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#06080f');
  g.addColorStop(0.45, '#0e1526');
  g.addColorStop(0.72, '#18233a');
  g.addColorStop(1, '#0c111c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = mulberry32(31);
  const palette = ['255,205,140', '255,170,110', '140,190,255', '255,230,190', '170,150,255', '120,220,200'];
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w;
    const y = h * (0.28 + rnd() * 0.5);
    const r = 5 + rnd() * 26;
    const col = palette[Math.floor(rnd() * palette.length)];
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.1 + rnd() * 0.32;
    rg.addColorStop(0, `rgba(${col},${a})`);
    rg.addColorStop(0.7, `rgba(${col},${a * 0.8})`);
    rg.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // a few big window glows
  for (const [x, y, ww, hh, col] of [[0.18, 0.5, 120, 190, '120,170,255'], [0.62, 0.46, 160, 210, '255,190,130'], [0.85, 0.52, 110, 170, '150,200,255']]) {
    const rg = ctx.createRadialGradient(x * w, y * h, 10, x * w, y * h, ww);
    rg.addColorStop(0, `rgba(${col},0.22)`);
    rg.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(x * w - ww, y * h - hh, ww * 2, hh * 2);
  }
  return toTexture(c, { aniso: 1, mip: false });
}
