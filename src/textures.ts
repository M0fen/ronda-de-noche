import * as THREE from 'three';

// Seeded RNG so the hospital decays the same way every run.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

export function toTex(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 1;
  return t;
}

export const rgba = (r: number, g: number, b: number, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

export function blotch(g: CanvasRenderingContext2D, R: () => number, x: number, y: number, r: number, col: [number, number, number], a: number, n = 14) {
  for (let i = 0; i < n; i++) {
    const rr = r * (0.3 + R() * 0.7);
    g.fillStyle = rgba(col[0], col[1], col[2], a * (0.3 + R() * 0.7));
    g.beginPath();
    g.ellipse(x + (R() - 0.5) * r * 1.6, y + (R() - 0.5) * r * 1.2, rr, rr * (0.5 + R() * 0.6), R() * 3, 0, Math.PI * 2);
    g.fill();
  }
}

export function noise(g: CanvasRenderingContext2D, R: () => number, w: number, h: number, amt: number) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (R() - 0.5) * amt;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// ---- walls, floors and ceiling, one finish per part of the building ---------------------------------
// The finishes are clean on purpose: wear, soot, leaks and corner grime are laid on in world space by the
// level's surface shader, so no stain repeats every two metres and the damage follows the building (water
// under the leaks, dirt along the skirting, mould in the corners).
export type Style = 'ward' | 'corridor' | 'reception' | 'dayroom' | 'linen' | 'breaker';
export const STYLES: Style[] = ['ward', 'corridor', 'reception', 'dayroom', 'linen', 'breaker'];
const PXM = 64; // texels per metre on walls and floors

function tileGrid(g: CanvasRenderingContext2D, R: () => number, x0: number, y0: number, w: number, h: number, tw: number, th: number, col: [number, number, number], vary: number, grout: string, crack = 0.04, offset = 0) {
  for (let y = y0, row = 0; y < y0 + h; y += th, row++) for (let x = x0 - (row % 2) * offset; x < x0 + w; x += tw) {
    const k = 1 - vary / 2 + R() * vary;
    g.fillStyle = grout; g.fillRect(x, y, tw, th);
    g.fillStyle = rgba(col[0] * k, col[1] * k, col[2] * k); g.fillRect(x, y, tw - 1, th - 1);
    g.fillStyle = rgba(255, 255, 255, 0.07 + R() * 0.05); g.fillRect(x, y, tw - 1, 1); // glaze catching the light on the top edge
    if (R() < crack) { g.strokeStyle = rgba(30, 30, 26, 0.7); g.lineWidth = 1; g.beginPath(); const sx = x + R() * tw; g.moveTo(sx, y); g.lineTo(sx + (R() - 0.5) * tw, y + th); g.stroke(); }
  }
}
function paint(g: CanvasRenderingContext2D, R: () => number, y0: number, y1: number, col: [number, number, number], roller = 0.05) {
  g.fillStyle = rgba(col[0], col[1], col[2]); g.fillRect(0, y0, 128, y1 - y0);
  // roller laps: faint vertical bands, and a few drips where the coat was thick
  for (let x = 0; x < 128; x += 6 + R() * 10) { const k = (R() - 0.5) * roller; g.fillStyle = k > 0 ? rgba(255, 250, 235, k) : rgba(40, 36, 28, -k); g.fillRect(x, y0, 4 + R() * 8, y1 - y0); }
}
function wallStyled(style: Style, seed: number) {
  const W = 128, Hh = 192, R = rng(seed);
  const [c, g] = canvas(W, Hh);
  const y = (m: number) => Math.round(Hh - m * PXM); // canvas row for a height in metres
  const skirting = (col: [number, number, number], hgt = 0.1) => { g.fillStyle = rgba(col[0], col[1], col[2]); g.fillRect(0, y(hgt), W, Hh - y(hgt)); g.fillStyle = rgba(255, 255, 255, 0.08); g.fillRect(0, y(hgt), W, 1); };
  if (style === 'ward') {
    paint(g, R, 0, y(1.25), [186, 174, 128]);
    tileGrid(g, R, 0, y(1.25), W, y(0) - y(1.25), 10, 10, [92, 118, 96], 0.25, rgba(52, 60, 50), 0.04);
    g.fillStyle = rgba(55, 60, 48); g.fillRect(0, y(1.25) - 3, W, 4);
    skirting([70, 52, 36], 0.09);
  } else if (style === 'corridor') {
    // institutional two-tone: bottle-green oil paint to the hip, cream above, a dark line between
    paint(g, R, 0, y(1.15), [200, 191, 157]);
    paint(g, R, y(1.15), Hh, [58, 88, 79], 0.035);
    for (let i = 0; i < 40; i++) { g.fillStyle = rgba(255, 255, 255, 0.025); g.fillRect(0, y(1.15) + R() * (y(0) - y(1.15)), W, 1); } // brush strokes in the gloss
    g.fillStyle = rgba(30, 42, 37); g.fillRect(0, y(1.15) - 2, W, 3); g.fillStyle = rgba(230, 222, 190, 0.35); g.fillRect(0, y(1.15) - 3, W, 1);
    skirting([38, 38, 34], 0.12);
  } else if (style === 'reception') {
    // wood panelling to the counter line, a pale striped paper above
    paint(g, R, 0, y(1.1), [190, 175, 138], 0.02);
    for (let x = 0; x < W; x += 16) { g.fillStyle = rgba(0, 0, 0, 0.035); g.fillRect(x, 0, 8, y(1.1)); }
    for (let x = 0; x < W; x += 16) {
      const k = 0.85 + R() * 0.25; g.fillStyle = rgba(108 * k, 74 * k, 46 * k); g.fillRect(x, y(1.1), 16, y(0) - y(1.1));
      g.strokeStyle = rgba(60, 38, 22, 0.35); g.lineWidth = 1;
      for (let l = 0; l < 4; l++) { g.beginPath(); let gx = x + 2 + R() * 12; g.moveTo(gx, y(1.1)); for (let yy = y(1.1); yy < Hh; yy += 8) { gx += (R() - 0.5) * 1.6; g.lineTo(gx, yy); } g.stroke(); }
      g.fillStyle = rgba(28, 18, 10, 0.9); g.fillRect(x, y(1.1), 1, y(0) - y(1.1));
    }
    g.fillStyle = rgba(84, 56, 34); g.fillRect(0, y(1.1) - 5, W, 6); g.fillStyle = rgba(255, 230, 190, 0.18); g.fillRect(0, y(1.1) - 5, W, 1);
    skirting([52, 34, 20], 0.1);
  } else if (style === 'dayroom') {
    // faded blue-grey wainscot, warm plaster above and a stencilled border the children's ward painted once
    paint(g, R, 0, y(0.95), [200, 182, 156]);
    paint(g, R, y(0.95), Hh, [104, 122, 128], 0.03);
    g.fillStyle = rgba(205, 200, 184); g.fillRect(0, y(0.95) - 4, W, 5); g.fillStyle = rgba(0, 0, 0, 0.25); g.fillRect(0, y(0.95) + 1, W, 1);
    const by = y(1.62);
    for (let x = 4; x < W; x += 32) {
      g.globalAlpha = 0.5 + R() * 0.2;
      g.fillStyle = rgba(170, 72, 60); g.beginPath(); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.moveTo(x + 8, by); g.ellipse(x + 8 + Math.cos(a) * 3.2, by + Math.sin(a) * 3.2, 2.4, 2.4, 0, 0, Math.PI * 2); } g.fill();
      g.fillStyle = rgba(214, 180, 90); g.beginPath(); g.arc(x + 8, by, 1.6, 0, 7); g.fill();
      g.fillStyle = rgba(70, 120, 112); g.fillRect(x + 18, by - 1, 8, 2); g.beginPath(); g.ellipse(x + 24, by - 3, 3, 1.6, -0.5, 0, 7); g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = rgba(150, 120, 96, 0.5); g.fillRect(0, by - 10, W, 1); g.fillRect(0, by + 9, W, 1);
    skirting([58, 52, 46], 0.1);
  } else if (style === 'linen') {
    // white glazed tile to the door head: easy to scrub
    paint(g, R, 0, y(2.05), [198, 194, 178]);
    tileGrid(g, R, 0, y(2.05), W, y(0) - y(2.05), 10, 10, [214, 212, 200], 0.08, rgba(140, 138, 126), 0.03);
    g.fillStyle = rgba(170, 168, 156); g.fillRect(0, y(2.05) - 2, W, 3);
    skirting([150, 150, 140], 0.1);
  } else {
    // breaker room: painted block, stretcher bond, a darker band where shoulders and trolleys rub
    tileGrid(g, R, 0, 0, W, Hh, 32, 13, [122, 130, 114], 0.1, rgba(84, 88, 78), 0, 16);
    g.fillStyle = rgba(30, 34, 28, 0.12); g.fillRect(0, y(1.45), W, y(0.85) - y(1.45));
    g.fillStyle = rgba(196, 160, 40, 0.75); g.fillRect(0, y(0.18), W, 6); // a painted kerb line
    skirting([60, 62, 56], 0.08);
  }
  noise(g, R, W, Hh, 12);
  return toTex(c);
}

function floorStyled(style: Style, seed: number) {
  const S = 128, R = rng(seed);
  const [c, g] = canvas(S, S);
  if (style === 'ward') {
    const q = S / 4;
    for (let yy = 0; yy < 4; yy++) for (let x = 0; x < 4; x++) {
      const a = (x + yy) % 2 === 0, k = 0.92 + R() * 0.12;
      g.fillStyle = a ? rgba(122 * k, 116 * k, 96 * k) : rgba(74 * k, 84 * k, 74 * k); g.fillRect(x * q, yy * q, q, q);
    }
    g.strokeStyle = rgba(30, 30, 26, 0.6); g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * q, 0); g.lineTo(i * q, S); g.stroke(); g.beginPath(); g.moveTo(0, i * q); g.lineTo(S, i * q); g.stroke(); }
  } else if (style === 'corridor') {
    // 30 cm vinyl tiles, marbled, quarter-turned
    const n = 6, q = S / n;
    for (let yy = 0; yy < n; yy++) for (let x = 0; x < n; x++) {
      const k = 0.93 + R() * 0.1; g.fillStyle = rgba(142 * k, 134 * k, 118 * k); g.fillRect(x * q, yy * q, q, q);
      const turn = (x + yy) % 2 === 0;
      for (let m = 0; m < 6; m++) {
        g.strokeStyle = R() < 0.5 ? rgba(96, 90, 78, 0.35) : rgba(190, 182, 164, 0.3); g.lineWidth = 1;
        g.beginPath(); let px = x * q + R() * q, py = yy * q + R() * q; g.moveTo(px, py);
        for (let k2 = 0; k2 < 5; k2++) { px += turn ? 3 + R() * 2 : (R() - 0.5) * 3; py += turn ? (R() - 0.5) * 3 : 3 + R() * 2; g.lineTo(Math.min(px, (x + 1) * q - 1), Math.min(py, (yy + 1) * q - 1)); }
        g.stroke();
      }
    }
    g.fillStyle = rgba(60, 56, 48, 0.55);
    for (let i = 0; i <= n; i++) { g.fillRect(i * q, 0, 1, S); g.fillRect(0, i * q, S, 1); }
  } else if (style === 'reception') {
    // terrazzo with brass strips at every metre
    g.fillStyle = rgba(138, 131, 117); g.fillRect(0, 0, S, S);
    const chips: [number, number, number][] = [[222, 216, 202], [44, 42, 38], [124, 76, 54], [110, 106, 96], [182, 170, 140]];
    for (let i = 0; i < 2600; i++) { const ch = chips[Math.floor(R() * chips.length)]; g.fillStyle = rgba(ch[0], ch[1], ch[2], 0.55 + R() * 0.45); const sz = R() < 0.85 ? 1 : 2; g.fillRect(R() * S, R() * S, sz, sz); }
    g.fillStyle = rgba(150, 122, 64); g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S); g.fillRect(0, S / 2, S, 1); g.fillRect(S / 2, 0, 1, S);
  } else if (style === 'dayroom') {
    // worn strip parquet
    const sh = 8;
    for (let yy = 0; yy < S; yy += sh) {
      let x = -Math.floor(R() * 40);
      while (x < S) {
        const len = 28 + Math.floor(R() * 36), k = 0.82 + R() * 0.3;
        g.fillStyle = rgba(126 * k, 92 * k, 58 * k); g.fillRect(x, yy, len, sh);
        g.strokeStyle = rgba(70, 46, 26, 0.3); g.lineWidth = 1;
        for (let l = 0; l < 2; l++) { g.beginPath(); const gy = yy + 1 + R() * (sh - 2); g.moveTo(x, gy); g.bezierCurveTo(x + len * 0.3, gy + (R() - 0.5) * 3, x + len * 0.6, gy + (R() - 0.5) * 3, x + len, gy); g.stroke(); }
        g.fillStyle = rgba(36, 24, 14, 0.8); g.fillRect(x, yy, 1, sh);
        x += len;
      }
      g.fillStyle = rgba(36, 24, 14, 0.7); g.fillRect(0, yy, S, 1);
    }
  } else if (style === 'linen') {
    tileGrid(g, R, 0, 0, S, S, 8, 8, [168, 166, 154], 0.08, rgba(104, 102, 94), 0.01);
  } else {
    // bare concrete, power-floated, a crack or two
    g.fillStyle = rgba(116, 112, 104); g.fillRect(0, 0, S, S);
    for (let i = 0; i < 18; i++) blotch(g, R, R() * S, R() * S, 8 + R() * 18, R() < 0.5 ? [96, 92, 86] : [132, 128, 120], 0.12, 10);
    g.strokeStyle = rgba(40, 38, 34, 0.55); g.lineWidth = 1;
    for (let i = 0; i < 2; i++) { g.beginPath(); let px = R() * S, py = 0; g.moveTo(px, py); while (py < S) { px += (R() - 0.5) * 10; py += 4 + R() * 8; g.lineTo(px, py); } g.stroke(); }
  }
  noise(g, R, S, S, 12);
  return toTex(c);
}

function ceiling(seed: number) {
  const S = 128;
  const [c, g] = canvas(S, S);
  const R = rng(seed);
  g.fillStyle = '#9d988a'; g.fillRect(0, 0, S, S);
  const p = S / 3;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) for (let i = 0; i < 40; i++) { g.fillStyle = rgba(70, 68, 60, 0.4); g.fillRect(x * p + R() * p, y * p + R() * p, 1, 1); }
  g.strokeStyle = rgba(60, 58, 52); g.lineWidth = 2;
  for (let i = 0; i <= 3; i++) { g.beginPath(); g.moveTo(i * p, 0); g.lineTo(i * p, S); g.stroke(); g.beginPath(); g.moveTo(0, i * p); g.lineTo(S, i * p); g.stroke(); }
  noise(g, R, S, S, 14);
  return toTex(c);
}

function metal(seed: number, base: [number, number, number]) {
  const W = 64, Hh = 128;
  const [c, g] = canvas(W, Hh);
  const R = rng(seed);
  g.fillStyle = rgba(...base); g.fillRect(0, 0, W, Hh);
  // vents
  for (const vy of [12, Hh - 26]) for (let i = 0; i < 5; i++) { g.fillStyle = '#121310'; g.fillRect(14, vy + i * 3, W - 28, 1.5); }
  // rust runs
  for (let i = 0; i < 8; i++) {
    const x = R() * W, y = R() * Hh * 0.7, len = 10 + R() * 50;
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, rgba(120, 58, 28, 0.75)); gr.addColorStop(1, rgba(120, 58, 28, 0));
    g.fillStyle = gr; g.fillRect(x, y, 1 + R() * 3, len);
  }
  for (let i = 0; i < 6; i++) blotch(g, R, R() * W, Hh - R() * 20, 3 + R() * 6, [96, 50, 26], 0.5, 6);
  g.fillStyle = '#2b2b26'; g.fillRect(W - 14, 56, 4, 14); // handle
  g.fillStyle = '#cfc8b4'; g.fillRect(18, 40, 18, 8); g.fillStyle = '#222'; g.font = '7px monospace'; g.fillText(String(10 + (seed % 89)), 20, 47);
  noise(g, R, W, Hh, 14);
  return toTex(c);
}

function door(seed: number) {
  const W = 64, Hh = 128;
  const [c, g] = canvas(W, Hh);
  const R = rng(seed);
  g.fillStyle = '#7d8a7a'; g.fillRect(0, 0, W, Hh);
  g.strokeStyle = '#4a5246'; g.lineWidth = 2; g.strokeRect(5, 5, W - 10, Hh - 10);
  g.fillStyle = '#0d0f0e'; g.fillRect(20, 18, 24, 30); // wired glass
  g.strokeStyle = 'rgba(160,160,150,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(20 + i * 5, 18); g.lineTo(20 + i * 5, 48); g.stroke(); g.beginPath(); g.moveTo(20, 18 + i * 6); g.lineTo(44, 18 + i * 6); g.stroke(); }
  g.fillStyle = '#5c5a4c'; g.fillRect(4, Hh - 26, W - 8, 20); // kick plate
  g.fillStyle = '#c8c0a0'; g.fillRect(W - 12, 62, 5, 4);
  for (let i = 0; i < 10; i++) blotch(g, R, R() * W, R() * Hh, 2 + R() * 7, [50, 44, 34], 0.35, 6);
  noise(g, R, W, Hh, 16);
  return toTex(c);
}

function chainedDoors(label: string) {
  const W = 128, Hh = 192;
  const [c, g] = canvas(W, Hh);
  const R = rng(label.length * 7);
  g.fillStyle = '#4b4f46'; g.fillRect(0, 0, W, Hh);
  g.fillStyle = '#2a2c27'; g.fillRect(8, 44, W - 16, Hh - 44);
  for (const x of [12, 66]) {
    g.fillStyle = '#6c7466'; g.fillRect(x, 48, 50, Hh - 52);
    g.fillStyle = '#0b0c0b'; g.fillRect(x + 12, 62, 26, 34);
  }
  // chain across the handles
  g.strokeStyle = '#9b9686'; g.lineWidth = 3;
  for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(36 + i * 7, 116 + Math.sin(i) * 2, 4, 2.5, i % 2 ? 0 : 1.2, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = '#7a6a3a'; g.fillRect(60, 120, 10, 12);
  for (let i = 0; i < 14; i++) blotch(g, R, R() * W, R() * Hh, 3 + R() * 10, [60, 40, 26], 0.35, 6);
  noise(g, R, W, Hh, 16);
  return toTex(c);
}

function mattress() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const R = rng(91);
  g.fillStyle = '#b4ad98'; g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 6) { g.fillStyle = 'rgba(70,90,110,0.35)'; g.fillRect(x, 0, 2, S); }
  for (let i = 0; i < 5; i++) blotch(g, R, R() * S, R() * S, 4 + R() * 10, [120, 96, 50], 0.35, 8);
  noise(g, R, S, S, 18);
  return toTex(c);
}

function sheet(seed = 3) {
  const S = 64;
  const [c, g] = canvas(S, S);
  const R = rng(seed);
  g.fillStyle = '#c9c3b2'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9; i++) { g.strokeStyle = 'rgba(90,86,74,0.35)'; g.lineWidth = 1 + R() * 2; g.beginPath(); const y = R() * S; g.moveTo(0, y); g.bezierCurveTo(20, y + 6, 40, y - 6, S, y + (R() - 0.5) * 10); g.stroke(); }
  for (let i = 0; i < 4; i++) blotch(g, R, R() * S, R() * S, 3 + R() * 7, [130, 110, 70], 0.3, 8);
  noise(g, R, S, S, 12);
  return toTex(c, true);
}

function wood() {
  const W = 64, Hh = 32;
  const [c, g] = canvas(W, Hh);
  const R = rng(17);
  g.fillStyle = '#6a4a30'; g.fillRect(0, 0, W, Hh);
  for (let y = 0; y < Hh; y += 2) { g.fillStyle = rgba(40 + R() * 30, 28 + R() * 16, 18, 0.5); g.fillRect(0, y, W, 1); }
  for (let i = 0; i < 5; i++) blotch(g, R, R() * W, R() * Hh, 3 + R() * 5, [30, 20, 12], 0.4, 6);
  noise(g, R, W, Hh, 14);
  return toTex(c, true);
}

function paper(lines = true) {
  const W = 32, Hh = 44;
  const [c, g] = canvas(W, Hh);
  const R = rng(5);
  g.fillStyle = '#ddd5c0'; g.fillRect(0, 0, W, Hh);
  if (lines) for (let y = 6; y < Hh - 4; y += 3) { g.fillStyle = 'rgba(40,40,40,0.55)'; g.fillRect(3, y, 6 + R() * 22, 1); }
  blotch(g, R, W * 0.7, Hh * 0.3, 5, [150, 120, 70], 0.3, 6);
  noise(g, R, W, Hh, 12);
  return toTex(c);
}

export function signTex(text: string, sub: string, green = false) {
  const W = 256, Hh = 72;
  const [c, g] = canvas(W, Hh);
  const R = rng(text.length * 13 + sub.length);
  g.fillStyle = green ? '#1d3b26' : '#d6d0bf'; g.fillRect(0, 0, W, Hh);
  g.strokeStyle = green ? '#0e1f14' : '#2b2b26'; g.lineWidth = 4; g.strokeRect(3, 3, W - 6, Hh - 6);
  g.fillStyle = green ? '#6f8f72' : '#1d1d1a';
  g.textAlign = 'center';
  g.font = 'bold 28px "Helvetica Neue", Arial, sans-serif';
  g.fillText(text, W / 2, 38, W - 20);
  g.font = '15px "Helvetica Neue", Arial, sans-serif';
  g.fillText(sub, W / 2, 60, W - 20);
  for (let i = 0; i < 8; i++) blotch(g, R, R() * W, R() * Hh, 3 + R() * 10, [90, 70, 40], 0.3, 6);
  noise(g, R, W, Hh, 18);
  return toTex(c);
}

function panel() {
  const W = 128, Hh = 160;
  const [c, g] = canvas(W, Hh);
  const R = rng(44);
  g.fillStyle = '#8b8d82'; g.fillRect(0, 0, W, Hh);
  g.strokeStyle = '#3f413a'; g.lineWidth = 3; g.strokeRect(4, 4, W - 8, Hh - 8);
  g.fillStyle = '#1b1c18'; g.font = 'bold 11px monospace'; g.textAlign = 'center';
  g.fillText('DISTRIBUCIÓN', W / 2, 20);
  const labels = ['PABELLÓN', 'CIRUGÍA', 'ANFITEATRO', 'ARCHIVO'];
  labels.forEach((l, i) => {
    const y = 34 + i * 30;
    g.fillStyle = '#2c2d28'; g.fillRect(20, y, 60, 18);
    g.fillStyle = '#d4cdb5'; g.fillRect(86, y + 3, 34, 12);
    g.fillStyle = '#1b1c18'; g.font = 'bold 7px monospace'; g.fillText(l, 103, y + 12, 32);
  });
  g.fillStyle = '#b8231c'; g.font = 'bold 9px monospace'; g.fillText('PELIGRO  440 V', W / 2, Hh - 12);
  for (let i = 0; i < 10; i++) blotch(g, R, R() * W, R() * Hh, 3 + R() * 7, [90, 60, 30], 0.3, 6);
  noise(g, R, W, Hh, 14);
  return toTex(c);
}

function glint() {
  const S = 32;
  const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,250,225,1)');
  gr.addColorStop(0.18, 'rgba(255,236,170,0.9)');
  gr.addColorStop(0.45, 'rgba(210,170,90,0.25)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function porcelain() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const R = rng(2);
  g.fillStyle = '#d8d1c4'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(60,50,45,0.6)'; g.lineWidth = 0.8; g.beginPath(); let x = R() * S, y = R() * S; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 12; y += R() * 8; g.lineTo(x, y); } g.stroke(); }
  for (let i = 0; i < 4; i++) blotch(g, R, R() * S, R() * S, 4 + R() * 6, [150, 140, 128], 0.3, 6);
  noise(g, R, S, S, 8);
  return toTex(c);
}


// Flashlight cookie: hot centre, a reflector ring, a soft spill and a few specks of dirt on the lens.
function cookie() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const R = rng(61);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S - 0.5, dy = (y + 0.5) / S - 0.5, r = Math.hypot(dx, dy) * 2;
    // broad, even spill so the torch still lights the floor and walls ahead; a hotter core and faint reflector rings on top
    // the light cone is ~1.6x the gameplay beam: a hot spot that fills the old beam, then a wide dim spill
    // fading to nothing, like a real reflector torch (no hard 'keyhole' edge)
    let v = 0.72 * Math.exp(-Math.pow(r / 0.36, 2)) + 0.28 * (1 - THREE.MathUtils.smoothstep(r, 0.25, 1.0));
    v += 0.06 * Math.exp(-Math.pow((r - 0.34) / 0.04, 2)) + 0.04 * Math.exp(-Math.pow((r - 0.5) / 0.04, 2)); // faint reflector rings
    v *= 1 - THREE.MathUtils.smoothstep(r, 0.85, 1.0);
    const k = Math.min(255, v * 255);
    const i = (y * S + x) * 4;
    img.data[i] = k; img.data[i + 1] = k * 0.96; img.data[i + 2] = k * 0.86; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(0,0,0,${0.08 + R() * 0.15})`; g.beginPath(); g.arc(20 + R() * 88, 20 + R() * 88, 1 + R() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // a light multiplier, not a colour: keep the values linear
  return t;
}

// Hospital privacy curtain: faded teal, vertical folds, stains, torn holes (alpha).
function curtain() {
  const W = 64, Hh = 128;
  const [c, g] = canvas(W, Hh);
  const R = rng(73);
  g.fillStyle = '#7d978d'; g.fillRect(0, 0, W, Hh);
  for (let x = 0; x < W; x += 4) { const k = Math.sin(x * 0.7) * 0.5 + 0.5; g.fillStyle = `rgba(30,45,40,${0.12 + k * 0.22})`; g.fillRect(x, 0, 2, Hh); }
  for (let i = 0; i < 10; i++) blotch(g, R, R() * W, Hh * (0.5 + R() * 0.5), 3 + R() * 8, [90, 80, 45], 0.35, 8);
  g.fillStyle = '#4c5f57'; for (let x = 2; x < W; x += 8) g.fillRect(x, 0, 3, 4); // rail hooks
  noise(g, R, W, Hh, 14);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(R() * W, 20 + R() * (Hh - 20), 2 + R() * 6, 3 + R() * 10, R() * 3, 0, 7); g.fill(); }
  for (let x = 0; x < W; x += 3) g.fillRect(x, Hh - 2 - R() * 10, 2, 14); // frayed hem
  const t = toTex(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

// Window: wired glass in a steel frame; a couple of panes broken out.
function windowTex() {
  const W = 64, Hh = 96;
  const [c, g] = canvas(W, Hh);
  const R = rng(37);
  g.fillStyle = '#20231f'; g.fillRect(0, 0, W, Hh);
  for (let py = 0; py < 3; py++) for (let px = 0; px < 2; px++) {
    const x = 5 + px * 28, y = 5 + py * 30;
    const broken = R() < 0.18;
    const gr = g.createLinearGradient(x, y, x + 24, y + 26);
    gr.addColorStop(0, broken ? '#06080a' : '#5d7184'); gr.addColorStop(1, broken ? '#0b0f12' : '#2c3a48');
    g.fillStyle = gr; g.fillRect(x, y, 24, 26);
    if (!broken) { g.strokeStyle = 'rgba(200,210,220,0.18)'; g.lineWidth = 1; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(x + k * 6, y); g.lineTo(x + k * 6, y + 26); g.stroke(); g.beginPath(); g.moveTo(x, y + k * 6.5); g.lineTo(x + 24, y + k * 6.5); g.stroke(); } }
    for (let k = 0; k < 4; k++) blotch(g, R, x + R() * 24, y + R() * 26, 2 + R() * 4, [40, 50, 40], 0.4, 5);
  }
  noise(g, R, W, Hh, 10);
  return toTex(c);
}

// Soft pool of moonlight on the floor, with the window bars in it.
function lightPool() {
  const S = 64;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.filter = 'blur(2px)';
  g.fillStyle = '#fff';
  for (let py = 0; py < 3; py++) for (let px = 0; px < 2; px++) g.fillRect(10 + px * 23, 6 + py * 18, 19, 15);
  g.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Vertical streaky gradient for fake light shafts.
function shaft() {
  const W = 32, Hh = 64;
  const [c, g] = canvas(W, Hh);
  const R = rng(19);
  for (let x = 0; x < W; x++) {
    const k = 0.5 + 0.5 * Math.sin(x * 0.9 + R() * 2);
    const gr = g.createLinearGradient(0, 0, 0, Hh);
    gr.addColorStop(0, `rgba(255,255,255,${0.55 * k})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, 0, 1, Hh);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Puddle alpha: irregular blob, soft rim.
function puddle() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const R = rng(83);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.filter = 'blur(3px)';
  g.fillStyle = '#fff';
  for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(32 + (R() - 0.5) * 22, 32 + (R() - 0.5) * 18, 8 + R() * 12, 5 + R() * 9, R() * 3, 0, 7); g.fill(); }
  g.filter = 'none';
  return new THREE.CanvasTexture(c);
}

// Scattered paper and broken tile debris.
function debris() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const R = rng(29);
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#d5ccb5'; g.fillRect(4, 4, 24, 30);
  g.fillStyle = 'rgba(40,40,40,0.5)'; for (let y = 8; y < 32; y += 3) g.fillRect(7, y, 10 + R() * 12, 1);
  g.fillStyle = '#c9c0a8'; g.save(); g.translate(46, 20); g.rotate(0.4); g.fillRect(-11, -14, 22, 28); g.restore();
  g.fillStyle = '#5d7461'; for (let i = 0; i < 5; i++) { g.save(); g.translate(10 + R() * 44, 40 + R() * 18); g.rotate(R() * 3); g.fillRect(-4, -3, 8, 6); g.restore(); }
  blotch(g, R, 20, 20, 6, [120, 90, 50], 0.3, 6);
  return toTex(c);
}

// Loose hair: alpha-tested ribbons, many strands per ribbon.
function hair() {
  const W = 64, Hh = 256;
  const [c, g] = canvas(W, Hh);
  const R = rng(91);
  g.clearRect(0, 0, W, Hh);
  g.lineCap = 'round';
  for (let i = 0; i < 52; i++) {
    const x0 = 2 + R() * (W - 4), len = Hh * (0.5 + R() * 0.5), sway = (R() - 0.5) * 12;
    g.strokeStyle = `rgba(255,255,255,${0.7 + R() * 0.3})`;
    g.lineWidth = 1 + R() * 2.4;
    g.beginPath(); g.moveTo(x0, 0);
    g.bezierCurveTo(x0 + sway, len * 0.35, x0 - sway, len * 0.7, x0 + sway * 0.6, len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Her apron: starched once, then years of rust-brown stains that never washed out.
function apron() {
  const W = 64, Hh = 128;
  const [c, g] = canvas(W, Hh);
  const R = rng(57);
  g.fillStyle = '#dcd6c6'; g.fillRect(0, 0, W, Hh);
  for (let i = 0; i < 8; i++) { g.strokeStyle = 'rgba(90,86,74,0.28)'; g.lineWidth = 1 + R() * 1.5; g.beginPath(); const x = R() * W; g.moveTo(x, 0); g.bezierCurveTo(x + 6, 40, x - 6, 80, x + (R() - 0.5) * 8, Hh); g.stroke(); }
  for (let i = 0; i < 6; i++) blotch(g, R, R() * W, 64 + R() * 60, 4 + R() * 9, [92, 42, 30], 0.32, 10);
  for (let i = 0; i < 3; i++) blotch(g, R, R() * W, R() * 60, 3 + R() * 5, [112, 84, 52], 0.28, 6);
  for (let i = 0; i < 5; i++) { const x = 8 + R() * 48, y = 56 + R() * 30; g.fillStyle = 'rgba(78,34,24,0.38)'; g.fillRect(x, y, 1.5, 10 + R() * 30); }
  noise(g, R, W, Hh, 12);
  return toTex(c, true);
}

// San Jorge and the dragon: a cheap devotional print in a gilt frame, gone brown behind the reception desk.
function sanJorge() {
  const W = 96, Hh = 128;
  const [c, g] = canvas(W, Hh);
  const R = rng(1992);
  g.fillStyle = '#6e5523'; g.fillRect(0, 0, W, Hh);
  g.fillStyle = '#a8843c'; g.fillRect(3, 3, W - 6, Hh - 6);
  g.fillStyle = '#4a3a18'; g.fillRect(7, 7, W - 14, Hh - 14);
  const x0 = 9, y0 = 9, w = W - 18, h = Hh - 18;
  const sky = g.createLinearGradient(0, y0, 0, y0 + h);
  sky.addColorStop(0, '#2d4a5a'); sky.addColorStop(0.6, '#8c7a52'); sky.addColorStop(1, '#4a3a22');
  g.fillStyle = sky; g.fillRect(x0, y0, w, h);
  g.fillStyle = '#3d4a2a'; g.beginPath(); g.moveTo(x0, y0 + h * 0.78); g.quadraticCurveTo(x0 + w * 0.5, y0 + h * 0.66, x0 + w, y0 + h * 0.8); g.lineTo(x0 + w, y0 + h); g.lineTo(x0, y0 + h); g.fill();
  // the dragon, coiled at the bottom
  g.fillStyle = '#3f6a3a'; g.beginPath(); g.ellipse(x0 + 22, y0 + h - 14, 18, 7, -0.2, 0, 7); g.fill();
  g.beginPath(); g.moveTo(x0 + 6, y0 + h - 20); g.lineTo(x0 + 14, y0 + h - 32); g.lineTo(x0 + 19, y0 + h - 18); g.fill();
  g.fillStyle = '#c23b22'; g.beginPath(); g.arc(x0 + 8, y0 + h - 21, 2, 0, 7); g.fill();
  // the white horse, rearing
  g.fillStyle = '#e8e0cc';
  g.beginPath(); g.ellipse(x0 + 46, y0 + 64, 20, 11, -0.35, 0, 7); g.fill();
  g.beginPath(); g.moveTo(x0 + 30, y0 + 62); g.lineTo(x0 + 22, y0 + 42); g.lineTo(x0 + 30, y0 + 38); g.lineTo(x0 + 38, y0 + 58); g.fill();
  g.beginPath(); g.ellipse(x0 + 22, y0 + 40, 7, 4, -0.6, 0, 7); g.fill();
  g.strokeStyle = '#e8e0cc'; g.lineWidth = 3;
  for (const [ax, ay, bx, by] of [[36, 70, 24, 80], [40, 72, 34, 86], [58, 70, 62, 92], [64, 66, 70, 90]]) { g.beginPath(); g.moveTo(x0 + ax, y0 + ay); g.lineTo(x0 + bx, y0 + by); g.stroke(); }
  // the saint: halo, red cape, armour, and the lance driven into the dragon
  g.fillStyle = '#d7b04a'; g.beginPath(); g.arc(x0 + 48, y0 + 30, 8, 0, 7); g.fill();
  g.fillStyle = '#9a1f18'; g.beginPath(); g.moveTo(x0 + 50, y0 + 36); g.lineTo(x0 + 70, y0 + 58); g.lineTo(x0 + 52, y0 + 56); g.fill();
  g.fillStyle = '#8f9493'; g.fillRect(x0 + 44, y0 + 36, 8, 18);
  g.fillStyle = '#d9c7a8'; g.beginPath(); g.arc(x0 + 48, y0 + 31, 4, 0, 7); g.fill();
  g.strokeStyle = '#3a2a14'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 58, y0 + 30); g.lineTo(x0 + 10, y0 + h - 22); g.stroke();
  // varnish gone yellow, foxing, a water stain from the roof
  g.fillStyle = 'rgba(120,80,20,0.18)'; g.fillRect(x0, y0, w, h);
  for (let i = 0; i < 10; i++) blotch(g, R, x0 + R() * w, y0 + R() * h, 3 + R() * 8, [70, 50, 20], 0.3, 6);
  g.fillStyle = 'rgba(60,45,20,0.25)'; g.fillRect(x0 + w * 0.7, y0, 6, h * 0.5);
  noise(g, R, W, Hh, 16);
  return toTex(c);
}

// Wall calendar at reception: a coffee-country landscape and March 1992, crossed off day by day.
function calendar() {
  const W = 64, Hh = 96;
  const [c, g] = canvas(W, Hh);
  const R = rng(392);
  g.fillStyle = '#d8d0bc'; g.fillRect(0, 0, W, Hh);
  const sky = g.createLinearGradient(0, 4, 0, 40); sky.addColorStop(0, '#7b98a6'); sky.addColorStop(1, '#c9c2a0');
  g.fillStyle = sky; g.fillRect(4, 4, W - 8, 36);
  g.fillStyle = '#4f6a3e'; g.beginPath(); g.moveTo(4, 30); g.lineTo(20, 18); g.lineTo(34, 28); g.lineTo(48, 14); g.lineTo(60, 26); g.lineTo(60, 40); g.lineTo(4, 40); g.fill();
  g.fillStyle = '#2f4426'; for (let i = 0; i < 22; i++) g.fillRect(6 + R() * 52, 30 + R() * 9, 1.5, 1.5);
  g.fillStyle = '#1d1d1a'; g.textAlign = 'center';
  g.font = 'bold 8px monospace'; g.fillText('MARZO 1992', W / 2, 50);
  g.font = '5px monospace';
  ['D', 'L', 'M', 'M', 'J', 'V', 'S'].forEach((d, i) => g.fillText(d, 8 + i * 8, 58));
  for (let d = 1; d <= 31; d++) { // 1 March 1992 was a Sunday
    const k = d - 1, col = k % 7, x = 8 + col * 8, y = 65 + Math.floor(k / 7) * 6.5;
    g.fillStyle = col === 0 ? '#9a1f18' : '#1d1d1a'; g.fillText(String(d), x, y);
    if (d < 14) { g.strokeStyle = 'rgba(30,30,30,0.75)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x - 3, y - 4); g.lineTo(x + 3, y + 1); g.moveTo(x + 3, y - 4); g.lineTo(x - 3, y + 1); g.stroke(); }
  }
  for (let i = 0; i < 6; i++) blotch(g, R, R() * W, R() * Hh, 3 + R() * 6, [120, 90, 50], 0.25, 6);
  noise(g, R, W, Hh, 12);
  return toTex(c);
}

export type Tex = ReturnType<typeof makeTextures>;
export function makeTextures() {
  return {
    walls: Object.fromEntries(STYLES.map((st, i) => [st, [wallStyled(st, 11 + i * 7), wallStyled(st, 12 + i * 7)]])) as unknown as Record<Style, THREE.CanvasTexture[]>,
    floors: Object.fromEntries(STYLES.map((st, i) => [st, [floorStyled(st, 31 + i * 5), floorStyled(st, 32 + i * 5)]])) as unknown as Record<Style, THREE.CanvasTexture[]>,
    ceiling: ceiling(4),
    locker: metal(11, [104, 118, 104]),
    cabinet: metal(23, [118, 116, 100]),
    door: door(7),
    exitDoors: chainedDoors('EXIT'),
    lockedDoors: chainedDoors('THEATRE'),
    mattress: mattress(),
    sheet: sheet(),
    wood: wood(),
    paper: paper(),
    paperBlank: paper(false),
    panel: panel(),
    glint: glint(),
    porcelain: porcelain(),
    cookie: cookie(),
    curtain: curtain(),
    window: windowTex(),
    pool: lightPool(),
    shaft: shaft(),
    puddle: puddle(),
    debris: debris(),
    hair: hair(),
    apron: apron(),
    sanJorge: sanJorge(),
    calendar: calendar(),
  };
}
