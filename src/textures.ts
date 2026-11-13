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

// Wall: glazed green tiles to the dado rail, then nicotine-yellow paint, peeling and streaked.
function wall(seed: number) {
  const W = 128, Hh = 192; // 2 m x 3 m
  const [c, g] = canvas(W, Hh);
  const R = rng(seed);
  const rail = Hh - Math.round(1.25 * 64);
  g.fillStyle = '#b9ab7c'; g.fillRect(0, 0, W, rail);
  // plaster showing through peeled paint
  for (let i = 0; i < 7; i++) blotch(g, R, R() * W, R() * rail, 6 + R() * 14, [150, 145, 128], 0.5, 8);
  for (let i = 0; i < 5; i++) blotch(g, R, R() * W, R() * rail * 0.6, 5 + R() * 8, [205, 196, 160], 0.35, 6);
  // tiles
  const tile = 10;
  for (let y = rail; y < Hh; y += tile) for (let x = 0; x < W; x += tile) {
    const k = 0.85 + R() * 0.25;
    g.fillStyle = rgba(92 * k, 118 * k, 96 * k);
    g.fillRect(x, y, tile - 1, tile - 1);
    if (R() < 0.05) { g.fillStyle = rgba(40, 42, 36); g.fillRect(x, y, tile - 1, tile - 1); }
    else if (R() < 0.08) { g.strokeStyle = rgba(30, 35, 30, 0.8); g.beginPath(); g.moveTo(x + R() * tile, y); g.lineTo(x + R() * tile, y + tile); g.stroke(); }
  }
  g.fillStyle = rgba(55, 60, 48); g.fillRect(0, rail - 3, W, 4); // dado rail
  g.fillStyle = rgba(70, 52, 36); g.fillRect(0, Hh - 6, W, 6); // skirting
  // water streaks from the ceiling
  for (let i = 0; i < 6; i++) {
    const x = R() * W, len = 30 + R() * 110, wdt = 2 + R() * 6;
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, rgba(90, 70, 40, 0.5)); gr.addColorStop(1, rgba(90, 70, 40, 0));
    g.fillStyle = gr; g.fillRect(x, 0, wdt, len);
  }
  // mould at ceiling and floor
  for (let i = 0; i < 9; i++) blotch(g, R, R() * W, R() * 14, 4 + R() * 9, [32, 40, 26], 0.5, 10);
  for (let i = 0; i < 6; i++) blotch(g, R, R() * W, Hh - R() * 18, 3 + R() * 8, [28, 34, 22], 0.5, 10);
  noise(g, R, W, Hh, 18);
  return toTex(c);
}

function floor(seed: number) {
  const S = 128;
  const [c, g] = canvas(S, S);
  const R = rng(seed);
  const q = S / 4;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const a = (x + y) % 2 === 0;
    const k = 0.9 + R() * 0.15;
    g.fillStyle = a ? rgba(122 * k, 116 * k, 96 * k) : rgba(74 * k, 84 * k, 74 * k);
    g.fillRect(x * q, y * q, q, q);
  }
  g.strokeStyle = rgba(30, 30, 26, 0.6); g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * q, 0); g.lineTo(i * q, S); g.stroke(); g.beginPath(); g.moveTo(0, i * q); g.lineTo(S, i * q); g.stroke(); }
  for (let i = 0; i < 10; i++) blotch(g, R, R() * S, R() * S, 4 + R() * 14, [40, 36, 26], 0.25, 10);
  for (let i = 0; i < 26; i++) { g.strokeStyle = rgba(20, 20, 16, 0.25); g.beginPath(); const x = R() * S, y = R() * S; g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 30, y + (R() - 0.5) * 8); g.stroke(); }
  if (seed % 2) for (let i = 0; i < 3; i++) blotch(g, R, R() * S, R() * S, 10 + R() * 12, [24, 26, 22], 0.35, 14);
  noise(g, R, S, S, 16);
  return toTex(c);
}

function ceiling(seed: number) {
  const S = 128;
  const [c, g] = canvas(S, S);
  const R = rng(seed);
  g.fillStyle = '#9d988a'; g.fillRect(0, 0, S, S);
  const p = S / 3;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (R() < 0.08) { g.fillStyle = '#121210'; g.fillRect(x * p + 2, y * p + 2, p - 3, p - 3); continue; }
    for (let i = 0; i < 40; i++) { g.fillStyle = rgba(70, 68, 60, 0.4); g.fillRect(x * p + R() * p, y * p + R() * p, 1, 1); }
  }
  g.strokeStyle = rgba(60, 58, 52); g.lineWidth = 2;
  for (let i = 0; i <= 3; i++) { g.beginPath(); g.moveTo(i * p, 0); g.lineTo(i * p, S); g.stroke(); g.beginPath(); g.moveTo(0, i * p); g.lineTo(S, i * p); g.stroke(); }
  for (let i = 0; i < 3; i++) {
    const x = R() * S, y = R() * S, r = 8 + R() * 22;
    g.strokeStyle = rgba(110, 80, 40, 0.5); g.lineWidth = 2;
    g.beginPath(); g.ellipse(x, y, r, r * 0.8, R(), 0, Math.PI * 2); g.stroke();
    blotch(g, R, x, y, r * 0.8, [120, 95, 55], 0.18, 8);
  }
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
    walls: [wall(1), wall(2), wall(5)],
    floors: [floor(3), floor(8)],
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
