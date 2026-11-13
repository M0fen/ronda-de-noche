// Hand-drawn canvas art for the set dressing: decals (prints, scratches, writing, stains, paper),
// door leaves, framed pictures and their "changed" variants. Everything is generated at boot from
// seeds, so the hospital decays the same way every run. Handwriting waits for the web fonts and is
// redrawn once they arrive.
import * as THREE from 'three';
import { rng, canvas, rgba } from './textures';

type Ctx = CanvasRenderingContext2D;
type RGB = [number, number, number];
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const HAND = "'Reenie Beanie', 'Bradley Hand', 'Segoe Print', cursive";
const TYPE = "'Courier Prime', 'Courier New', monospace";
const STENCIL = "'Stardos Stencil', Impact, sans-serif";

// ---- value noise ------------------------------------------------------------------------
function noise2(seed: number) {
  const S = 64, R = rng(seed), v = new Float32Array(S * S);
  for (let i = 0; i < v.length; i++) v[i] = R();
  const at = (x: number, y: number) => v[((y & (S - 1)) * S) + (x & (S - 1))];
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}
function fbm(n: (x: number, y: number) => number, x: number, y: number, oct = 4) {
  let s = 0, a = 0.5, f = 1, t = 0;
  for (let i = 0; i < oct; i++) { s += n(x * f, y * f) * a; t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}

// soft-edged pressure blob (white, accumulates)
function blob(g: Ctx, x: number, y: number, rx: number, ry: number, rot: number, a: number) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.62, `rgba(255,255,255,${a * 0.92})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore();
}

// ---- stains: a painted pressure field becomes a dried print with a dark rim and grain ---------
interface Look { col: RGB; rim: RGB; thresh: number; grain: number; alpha: number; freq: number; rimAmt: number; mottle: number }
const BLOOD: Look = { col: [96, 18, 12], rim: [38, 6, 4], thresh: 0.36, grain: 0.42, alpha: 0.93, freq: 0.09, rimAmt: 0.85, mottle: 0.35 };
const OLD_BLOOD: Look = { col: [84, 30, 18], rim: [40, 14, 8], thresh: 0.38, grain: 0.5, alpha: 0.82, freq: 0.1, rimAmt: 0.6, mottle: 0.4 };
const SOOT: Look = { col: [30, 28, 25], rim: [12, 11, 10], thresh: 0.34, grain: 0.62, alpha: 0.78, freq: 0.14, rimAmt: 0.3, mottle: 0.5 };
const WET: Look = { col: [16, 18, 18], rim: [6, 8, 8], thresh: 0.3, grain: 0.26, alpha: 0.92, freq: 0.08, rimAmt: 0.7, mottle: 0.2 };

function stain(w: number, h: number, seed: number, look: Look, paint: (g: Ctx, R: () => number) => void) {
  const [pc, pg] = canvas(w, h);
  pg.fillStyle = '#000'; pg.fillRect(0, 0, w, h);
  const R = rng(seed);
  paint(pg, R);
  const P = pg.getImageData(0, 0, w, h).data;
  const n1 = noise2(seed * 3 + 1), n2 = noise2(seed * 7 + 5);
  const A = new Float32Array(w * h), N = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = P[i * 4] / 255;
    const n = fbm(n1, x * look.freq, y * look.freq);
    N[i] = fbm(n2, x * 0.35, y * 0.35, 2);
    A[i] = smooth(look.thresh - 0.06, look.thresh + 0.06, p + (n - 0.5) * look.grain);
  }
  // blurred copy for the dried rim (blood pulls to the edges as it dries)
  const B = new Float32Array(w * h), tmp = new Float32Array(w * h), r = 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += A[y * w + xx]; c++; } } tmp[y * w + x] = s / c; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; c++; } } B[y * w + x] = s / c; }
  const [oc, og] = canvas(w, h);
  const img = og.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) {
    const a = A[i]; if (a <= 0.003) continue;
    const p = P[i * 4] / 255;
    const rim = clamp((a - B[i]) * 3.2) * look.rimAmt;
    const k = clamp(0.25 + p * 0.45 + rim + (N[i] - 0.5) * look.mottle);
    d[i * 4] = look.col[0] + (look.rim[0] - look.col[0]) * k;
    d[i * 4 + 1] = look.col[1] + (look.rim[1] - look.col[1]) * k;
    d[i * 4 + 2] = look.col[2] + (look.rim[2] - look.col[2]) * k;
    d[i * 4 + 3] = 255 * a * look.alpha * (0.72 + 0.28 * clamp(p * 1.4)) * (0.85 + 0.3 * N[i]);
  }
  og.putImageData(img, 0, 0);
  void pc;
  return oc;
}

// ---- hands -----------------------------------------------------------------------------------
interface HandOpts { left?: boolean; child?: boolean; rot?: number; press?: number; fingers?: number[]; thumb?: number; palm?: number; spread?: number; tipsOnly?: boolean }
const FINGERS = [ // base x, base y, lean, length, width (cm; a right hand seen from behind, thumb on the left)
  [-2.75, -4.45, -0.15, 7.0, 1.78], [-0.85, -4.85, -0.03, 7.9, 1.84], [1.05, -4.6, 0.09, 7.3, 1.72], [2.8, -3.9, 0.23, 5.7, 1.5],
];
// Paints the pressure of a hand pressed flat on a wall: a solid palm that prints harder at the heel
// and under the knuckles, fingers broken only at their creases, the thumb at its own angle.
function paintHand(g: Ctx, cx: number, cy: number, s: number, o: HandOpts, R: () => number) {
  const sx = o.left ? -1 : 1, k = o.child ? 0.58 : 1, pr = o.press ?? 1, sp = o.spread ?? 1;
  g.save(); g.translate(cx, cy); g.rotate(o.rot ?? 0); g.scale(s * k * sx, s * k);
  const fl = (o.child ? 0.84 : 1), fw = (o.child ? 1.12 : 1);
  const white = (a: number) => `rgba(255,255,255,${clamp(a)})`;
  if (!o.tipsOnly && (o.palm ?? 1) > 0) {
    const pa = (o.palm ?? 1) * pr;
    g.fillStyle = white(0.6 * pa);
    g.beginPath();
    g.moveTo(-3.0, 5.3); g.quadraticCurveTo(0, 5.9, 3.1, 5.2);
    g.quadraticCurveTo(4.3, 2.8, 4.2, -0.8); g.quadraticCurveTo(4.15, -3.2, 3.5, -3.95);
    g.quadraticCurveTo(0.4, -5.4, -3.2, -4.45); g.quadraticCurveTo(-4.1, -3.4, -3.95, -1.6);
    g.quadraticCurveTo(-4.6, 1.2, -3.0, 5.3); g.closePath(); g.fill();
    blob(g, -2.0, 2.4, 2.4, 3.1, -0.35, 0.75 * pa);  // thenar
    blob(g, 2.4, 2.6, 2.0, 3.0, 0.12, 0.7 * pa);     // hypothenar
    for (const f of FINGERS) blob(g, f[0] * 0.95, -3.6, 1.45, 1.05, 0, 0.62 * pa); // pads under the knuckles
    // palm creases lift out of the print
    g.globalCompositeOperation = 'destination-out'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.26;
    g.beginPath(); g.moveTo(-3.85, -2.2); g.quadraticCurveTo(-1.1, -0.2, -0.8, 4.9); g.stroke();
    g.beginPath(); g.moveTo(-3.85, -2.0); g.quadraticCurveTo(0.2, -1.4, 3.7, -0.4); g.stroke();
    g.beginPath(); g.moveTo(4.2, -2.85); g.quadraticCurveTo(1.0, -3.4, -1.7, -3.9); g.stroke();
    g.globalCompositeOperation = 'source-over';
  }
  g.lineCap = 'round';
  FINGERS.forEach(([bx, by, lean, L0, W0], i) => {
    const fp = (o.fingers?.[i] ?? 1) * pr;
    if (fp <= 0) return;
    const a = lean * sp, L = L0 * fl, W = W0 * fw, dx = Math.sin(a), dy = -Math.cos(a);
    const at = (t: number) => [bx + dx * L * t, by + dy * L * t] as const;
    if (!o.tipsOnly) {
      g.strokeStyle = white(0.58 * fp); g.lineWidth = W * 0.92;
      const [x0, y0] = at(0.08), [x1, y1] = at(0.9);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const [mx, my] = at(0.58); blob(g, mx, my, W * 0.46, L * 0.13, a, 0.45 * fp);
    }
    const [tx, ty] = at(0.86); blob(g, tx, ty, W * 0.5, L * 0.13, a, (0.9 + R() * 0.1) * fp);
    if (!o.tipsOnly) { // the creases at the knuckles
      g.globalCompositeOperation = 'destination-out'; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.2;
      for (const t of [0.44, 0.71]) { const [cx2, cy2] = at(t); g.beginPath(); g.moveTo(cx2 - Math.cos(a) * W * 0.5, cy2 - Math.sin(a) * W * 0.5); g.lineTo(cx2 + Math.cos(a) * W * 0.5, cy2 + Math.sin(a) * W * 0.5); g.stroke(); }
      g.globalCompositeOperation = 'source-over';
    }
  });
  const tp = (o.thumb ?? 1) * pr;
  if (tp > 0) {
    const bx = -3.9, by = 1.0, a = -0.95 * sp, L = o.child ? 5.0 : 5.9, W = o.child ? 2.3 : 2.15, dx = Math.sin(a), dy = -Math.cos(a);
    const at = (t: number) => [bx + dx * L * t, by + dy * L * t] as const;
    if (!o.tipsOnly) { g.strokeStyle = white(0.55 * tp); g.lineWidth = W * 0.9; const [x0, y0] = at(0.1), [x1, y1] = at(0.88); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    const [tx, ty] = at(0.8); blob(g, tx, ty, W * 0.52, L * 0.17, a, 0.9 * tp);
  }
  g.restore();
}
// fingertip positions in canvas pixels, for smears that start from the pads
function tipPoints(cx: number, cy: number, s: number, o: HandOpts) {
  const sx = o.left ? -1 : 1, k = o.child ? 0.58 : 1, r = o.rot ?? 0, sp = o.spread ?? 1;
  return FINGERS.map(([x, y, a, L]) => {
    const lx = (x + Math.sin(a * sp) * L * 0.86) * sx * s * k, ly = (y - Math.cos(a * sp) * L * 0.86) * s * k;
    return [cx + lx * Math.cos(r) - ly * Math.sin(r), cy + lx * Math.sin(r) + ly * Math.cos(r)] as [number, number];
  });
}
// drips run down from the heaviest parts of a print
function drips(g: Ctx, R: () => number, pts: [number, number][], s: number, n: number) {
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[Math.floor(R() * pts.length)];
    const len = (2 + R() * 9) * s, w = (0.22 + R() * 0.2) * s, x0 = x + (R() - 0.5) * s;
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.85, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0.0)');
    g.strokeStyle = gr; g.lineWidth = w;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + (R() - 0.5) * 0.4 * s, y + len); g.stroke();
    blob(g, x0, y + len * 0.93, w * 0.75, w * 1.1, 0, 0.85);
  }
}

const handFull = (seed: number, o: HandOpts, look = BLOOD) => stain(112, 136, seed, look, (g, R) => {
  paintHand(g, 56, 74, 6.4, o, R);
  if (look === BLOOD) drips(g, R, tipPoints(56, 74, 6.4, o).concat([[48, 96], [64, 98]]), 6.4, 3);
});
// a hand that took the weight and slid down to the floor
function handDrag(seed: number) {
  return stain(120, 380, seed, BLOOD, (g, R) => {
    const o: HandOpts = { rot: 0.08, spread: 1.15, fingers: [1, 1, 0.95, 0.8] };
    const [tc, tg] = canvas(120, 380);
    paintHand(tg, 60, 70, 6.2, o, R);
    for (let k = 1; k < 26; k++) { g.globalAlpha = 0.34 * Math.pow(1 - k / 26, 1.8); g.drawImage(tc, (R() - 0.5) * 2 + k * 0.4, k * 9.5); }
    g.globalAlpha = 1; g.drawImage(tc, 0, 0);
    // the fingers keep dragging after the palm lets go
    g.lineCap = 'round';
    tipPoints(60, 70, 6.2, o).forEach(([x, y], i) => {
      let px = x, py = y, w = 9 - i * 0.8;
      for (let j = 0; j < 30; j++) {
        const nx = px + (R() - 0.5) * 2.2 + 0.25, ny = py + 8.5 + R() * 3, a = 0.8 * (1 - j / 30);
        g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w * (1 - j / 38); g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
        px = nx; py = ny; if (R() < 0.06) break;
      }
    });
    drips(g, R, [[40, 120], [70, 160], [55, 230], [60, 300]], 6.2, 5);
  });
}
// four fingertips dragged along the wall at hip height: somebody feeling their way in the dark
function fingerTrail(seed: number) {
  return stain(420, 110, seed, OLD_BLOOD, (g, R) => {
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      let x = 18, y = 28 + i * 15 + (i === 3 ? 6 : 0), w = 7.5 - i * 0.6, a = 0.95;
      for (let j = 0; j < 80; j++) {
        const nx = x + 4.6 + R() * 1.4, ny = y + Math.sin(j * 0.09 + i) * 0.5 + (R() - 0.5) * 0.3 + (i - 1.5) * 0.03;
        a = Math.max(0, a - 0.009 - (R() < 0.04 ? 0.25 : 0)); if (R() < 0.03) a = 0.7 + R() * 0.25;
        g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w * (0.75 + R() * 0.35); g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        x = nx; y = ny; if (x > 410) break;
      }
      blob(g, 16, 28 + i * 15, w * 0.8, w * 0.65, 0, 0.95);
    }
  });
}

// ---- scratches -------------------------------------------------------------------------------
// paint scraped back to the plaster: pale groove, dark shadow inside, loose flakes along the edge
function gouge(g: Ctx, R: () => number, pts: [number, number][], w: number) {
  const seg = (k: number) => Math.sin(Math.PI * clamp(k)) ** 0.6;
  g.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    const t = i / (pts.length - 1), [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    g.strokeStyle = 'rgba(214,205,180,0.95)'; g.lineWidth = w * (0.35 + 0.65 * seg(t)); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  for (let i = 1; i < pts.length; i++) {
    const t = i / (pts.length - 1), [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    g.strokeStyle = 'rgba(46,38,28,0.75)'; g.lineWidth = w * 0.32 * seg(t); g.beginPath(); g.moveTo(x0 + w * 0.12, y0); g.lineTo(x1 + w * 0.12, y1); g.stroke();
  }
  for (let i = 0; i < pts.length; i += 2) {
    if (R() < 0.45) continue;
    const [x, y] = pts[i], side = R() < 0.5 ? -1 : 1;
    g.fillStyle = 'rgba(200,190,160,0.9)'; g.strokeStyle = 'rgba(60,52,38,0.6)'; g.lineWidth = 0.8;
    g.beginPath(); const fx = x + side * w * (0.6 + R() * 0.6);
    g.moveTo(fx, y); g.lineTo(fx + side * (2 + R() * 4), y + (R() - 0.5) * 5); g.lineTo(fx + side * (1 + R() * 2), y + 3 + R() * 3); g.closePath(); g.fill(); g.stroke();
  }
}
function clawMarks(seed: number) {
  const [c, g] = canvas(150, 330);
  const R = rng(seed);
  for (let i = 0; i < 4; i++) {
    const pts: [number, number][] = [];
    let x = 28 + i * 26 + (R() - 0.5) * 6, y = 18 + Math.abs(i - 1.5) * 9;
    const len = 230 + R() * 60 - Math.abs(i - 1.5) * 25;
    for (let s = 0; s <= 24; s++) { pts.push([x, y]); x += 0.6 + (R() - 0.5) * 1.6 + Math.sin(s * 0.3) * 0.4; y += len / 24; }
    gouge(g, R, pts, 7 - Math.abs(i - 1.5));
  }
  return c;
}
function tally(seed: number) {
  const [c, g] = canvas(300, 150);
  const R = rng(seed);
  let n = 0, x = 14, y = 16;
  const mark = (x0: number, y0: number, x1: number, y1: number) => {
    const pts: [number, number][] = [];
    for (let s = 0; s <= 6; s++) pts.push([x0 + (x1 - x0) * s / 6 + (R() - 0.5) * 1.2, y0 + (y1 - y0) * s / 6]);
    gouge(g, R, pts, 3.2);
  };
  while (n < 43) {
    const left = Math.min(5, 43 - n);
    for (let i = 0; i < Math.min(4, left); i++) mark(x + i * 9 + (R() - 0.5) * 2, y + (R() - 0.5) * 3, x + i * 9 + (R() - 0.5) * 4, y + 44 + (R() - 0.5) * 4);
    if (left === 5) mark(x - 5, y + 36, x + 33, y + 6);
    n += left; x += 56;
    if (x > 260) { x = 14 + (R() - 0.5) * 6; y += 64; }
  }
  return c;
}

// ---- writing ---------------------------------------------------------------------------------
interface InkOpts { color: RGB; size: number; font?: string; passes?: number; jitter?: number; erode?: number; tilt?: number; spacing?: number; alpha?: number; wax?: boolean }
// Hand lettering: each glyph tilts and drifts, several dry passes, then the wall's tooth eats into it.
function letters(w: number, h: number, seed: number, lines: string[], o: InkOpts) {
  const [c, g] = canvas(w, h);
  const R = rng(seed), font = o.font ?? HAND;
  g.font = `${o.size}px ${font}`;
  const widest = Math.max(...lines.map(l => g.measureText(l).width * (o.spacing ?? 1)));
  const size = Math.min(o.size, o.size * (w * 0.9) / Math.max(1, widest), (h * 0.86) / (lines.length * 0.95 + 0.1));
  o = { ...o, size };
  const lh = o.size * 0.95, y0 = (h - lh * (lines.length - 1)) / 2 + o.size * 0.32;
  for (let p = 0; p < (o.passes ?? 4); p++) {
    const R2 = rng(seed + 17);
    lines.forEach((line, li) => {
      g.font = `${o.size}px ${font}`;
      const widths = [...line].map(ch => g.measureText(ch).width * (o.spacing ?? 1));
      const total = widths.reduce((a, b) => a + b, 0);
      let x = (w - total) / 2 + (R2() - 0.5) * o.size * 0.3;
      const y = y0 + li * lh + (R2() - 0.5) * o.size * 0.12;
      [...line].forEach((ch, i) => {
        const tilt = (R2() - 0.5) * 0.16 + (o.tilt ?? 0), dy = (R2() - 0.5) * o.size * 0.1, sc = 0.92 + R2() * 0.16;
        g.save(); g.translate(x + widths[i] / 2 + (R() - 0.5) * (o.jitter ?? 1.6), y + dy + (R() - 0.5) * (o.jitter ?? 1.6)); g.rotate(tilt); g.scale(sc, sc);
        g.fillStyle = rgba(o.color[0], o.color[1], o.color[2], (o.alpha ?? 0.42) * (0.8 + R() * 0.4));
        g.textAlign = 'center'; g.fillText(ch, 0, 0);
        if (o.wax && p === 0) { g.fillStyle = 'rgba(255,220,220,0.12)'; g.fillText(ch, -1, -1); }
        g.restore();
        x += widths[i];
      });
    });
  }
  // tooth of the wall: knock random grains out of the strokes
  const img = g.getImageData(0, 0, w, h), d = img.data, n = noise2(seed + 3), er = o.erode ?? 0.35;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = (yy * w + xx) * 4; if (!d[i + 3]) continue;
    const v = fbm(n, xx * 0.45, yy * 0.45, 2) + (R() - 0.5) * 0.35;
    if (v < er) d[i + 3] *= 0.15; else if (v < er + 0.1) d[i + 3] *= 0.6;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---- stains on plaster ---------------------------------------------------------------------
function waterStain(seed: number) {
  const W = 260, H = 400, [c, g] = canvas(W, H), R = rng(seed), n = noise2(seed);
  for (let ring = 0; ring < 6; ring++) {
    const k = 1 - ring * 0.14, cy = 70 + ring * 6;
    g.beginPath();
    for (let a = 0; a <= 64; a++) {
      const t = a / 64 * Math.PI * 2, r = (95 + fbm(n, Math.cos(t) * 2 + ring, Math.sin(t) * 2) * 70) * k;
      const x = W / 2 + Math.cos(t) * r * 1.05, y = cy + Math.sin(t) * r * 0.62;
      a ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = `rgba(110,82,40,${0.05 + ring * 0.012})`; g.fill();
    g.strokeStyle = `rgba(92,62,28,${0.28 - ring * 0.025})`; g.lineWidth = 2.4 - ring * 0.2; g.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const x = 40 + R() * (W - 80), y = 90 + R() * 60, len = 60 + R() * 230, w = 2 + R() * 7;
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, 'rgba(100,72,34,0.32)'); gr.addColorStop(1, 'rgba(100,72,34,0)');
    g.fillStyle = gr; g.fillRect(x, y, w, len);
    g.fillStyle = 'rgba(80,56,24,0.25)'; g.fillRect(x + w * 0.4, y, 1, len * 0.8);
  }
  // a face, if you look long enough: two darker eye blooms and a long mouth
  for (const [x, y, r] of [[W / 2 - 34, 92, 13], [W / 2 + 30, 95, 11], [W / 2 - 2, 152, 9]] as const) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r * (y > 140 ? 2.4 : 1));
    gr.addColorStop(0, 'rgba(70,46,20,0.45)'); gr.addColorStop(1, 'rgba(70,46,20,0)');
    g.fillStyle = gr; g.save(); if (y > 140) { g.translate(x, y); g.scale(1.9, 0.5); g.translate(-x, -y); } g.beginPath(); g.arc(x, y, r * (y > 140 ? 2.4 : 1), 0, 7); g.fill(); g.restore();
  }
  return c;
}
function mould(seed: number) {
  const W = 260, H = 200, [c, g] = canvas(W, H), R = rng(seed), n = noise2(seed);
  for (let i = 0; i < 2600; i++) {
    const x = R() * W, y = R() * H;
    const dens = fbm(n, x * 0.018, y * 0.018) - Math.hypot((x - W / 2) / W, (y - H * 0.35) / H) * 0.9;
    if (R() > dens * 1.8) continue;
    const r = 0.6 + R() * 2.6;
    g.fillStyle = R() < 0.7 ? `rgba(24,32,20,${0.35 + R() * 0.5})` : `rgba(58,66,34,${0.3 + R() * 0.4})`;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return c;
}
function scorch(seed: number) {
  const W = 260, H = 330, [c, g] = canvas(W, H), n = noise2(seed);
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W * 0.5), dy = (y - H * 0.72) / (H * 0.5);
    const plume = Math.exp(-dx * dx * (2.2 + Math.max(0, dy) * 6)) * smooth(0.55, -1.2, dy);
    const v = plume * (0.55 + fbm(n, x * 0.03, y * 0.012 + x * 0.004) * 0.9) - 0.12;
    if (v <= 0) continue;
    const i = (y * W + x) * 4; d[i] = 22; d[i + 1] = 20; d[i + 2] = 18; d[i + 3] = 255 * clamp(v * 1.3) * 0.9;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// where a picture hung for forty years: cleaner paint, a dusty outline, the nail
function ghostFrame(seed: number) {
  const W = 170, H = 220, [c, g] = canvas(W, H), R = rng(seed);
  g.fillStyle = 'rgba(255,248,220,0.16)'; g.fillRect(16, 26, W - 32, H - 42);
  g.strokeStyle = 'rgba(60,48,30,0.28)'; g.lineWidth = 3; g.strokeRect(16, 26, W - 32, H - 42);
  g.fillStyle = 'rgba(60,48,30,0.18)'; g.fillRect(16, H - 18, W - 32, 3);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(70,56,36,${R() * 0.2})`; g.fillRect(16 + R() * (W - 32), 24 + R() * 4, 2 + R() * 6, 1); }
  g.fillStyle = '#1b1712'; g.beginPath(); g.arc(W / 2, 12, 3.2, 0, 7); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(W / 2 + 2, 16, 3, 5, 0.3, 0, 7); g.fill();
  g.strokeStyle = 'rgba(140,120,90,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(W / 2, 12); g.lineTo(18, 28); g.moveTo(W / 2, 12); g.lineTo(W - 18, 28); g.stroke();
  return c;
}

// ---- footprints --------------------------------------------------------------------------------
function footprint(seed: number, left: boolean) {
  return stain(64, 140, seed, WET, (g, R) => {
    g.save(); g.translate(32, 70); if (left) g.scale(-1, 1);
    blob(g, 1, 42, 11, 14, 0, 1);              // heel
    blob(g, 7, 12, 6, 18, 0.12, 0.85);         // outer arch
    blob(g, 1, -18, 14, 12, 0.1, 1);           // ball
    [[-9, -38, 4.6], [-1, -42, 3.6], [5.5, -40, 3.2], [10.5, -36, 2.9], [14.5, -30, 2.6]].forEach(([x, y, r]) => blob(g, x, y, r, r * 1.2, 0, 0.9 + R() * 0.1));
    g.restore();
  });
}

// ---- paper -------------------------------------------------------------------------------------
function paperBase(g: Ctx, W: number, H: number, R: () => number, tone = [214, 204, 178] as RGB) {
  const gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, rgba(tone[0], tone[1], tone[2])); gr.addColorStop(1, rgba(tone[0] - 24, tone[1] - 28, tone[2] - 34));
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9; i++) {
    const x = R() * W, y = R() * H, r = 6 + R() * 22;
    const s = g.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, 'rgba(140,100,50,0.16)'); s.addColorStop(0.8, 'rgba(140,100,50,0.08)'); s.addColorStop(1, 'rgba(120,80,40,0)');
    g.fillStyle = s; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(80,60,30,0.1)'; g.fillRect(0, H * 0.5, W, 1); g.fillStyle = 'rgba(255,250,235,0.18)'; g.fillRect(0, H * 0.5 + 1, W, 1); // fold
  const e = g.createLinearGradient(0, 0, 0, H); e.addColorStop(0, 'rgba(90,70,40,0.12)'); e.addColorStop(0.1, 'rgba(0,0,0,0)'); e.addColorStop(0.9, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(90,70,40,0.16)');
  g.fillStyle = e; g.fillRect(0, 0, W, H);
}
function tape(g: Ctx, x: number, y: number, w: number, h: number, rot: number) {
  g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = 'rgba(214,196,130,0.55)'; g.fillRect(-w / 2, -h / 2, w, h);
  g.fillStyle = 'rgba(120,100,50,0.25)'; g.fillRect(-w / 2, -h / 2, w, 1); g.fillRect(-w / 2, h / 2 - 1, w, 1); g.restore();
}
function tornCorner(g: Ctx, W: number, H: number, R: () => number) {
  g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath();
  g.moveTo(W, H - 30 - R() * 20); let x = W, y = H - 30;
  for (let i = 0; i < 8; i++) { x -= 4 + R() * 6; y += 3 + R() * 4; g.lineTo(x, y + (R() - 0.5) * 4); }
  g.lineTo(W, H); g.closePath(); g.fill(); g.restore();
}
function text(g: Ctx, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') {
  g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y);
}
function pencil(g: Ctx, s: string, x: number, y: number, size: number, rot = -0.04, color = 'rgba(40,38,46,0.85)') {
  g.save(); g.translate(x, y); g.rotate(rot); text(g, s, 0, 0, `${size}px ${HAND}`, color); g.restore();
}

function rationing(seed: number) {
  const W = 200, H = 280, [c, g] = canvas(W, H), R = rng(seed);
  paperBase(g, W, H, R, [220, 214, 196]);
  text(g, 'EMPRESA DE ENERGÍA', W / 2, 22, `700 11px ${TYPE}`, '#2a2620', 'center');
  text(g, 'RACIONAMIENTO DE ENERGÍA', W / 2, 40, `700 12px ${STENCIL}`, '#7a1c14', 'center');
  text(g, 'MARZO DE 1992', W / 2, 54, `700 10px ${TYPE}`, '#2a2620', 'center');
  g.fillStyle = '#2a2620'; g.fillRect(14, 62, W - 28, 1);
  const rows = [['SECTOR 1', '6 a.m. - 10 a.m.'], ['SECTOR 2', '10 a.m. - 2 p.m.'], ['SECTOR 3', '2 p.m. - 6 p.m.'], ['SECTOR 4', '8 p.m. - 4 a.m.'], ['SECTOR 5', '4 a.m. - 8 a.m.']];
  rows.forEach(([a, b], i) => { const y = 82 + i * 20; text(g, a, 18, y, `700 10px ${TYPE}`, '#2a2620'); text(g, b, W - 18, y, `10px ${TYPE}`, '#2a2620', 'right'); g.fillStyle = 'rgba(40,36,30,0.25)'; g.fillRect(14, y + 6, W - 28, 1); });
  g.strokeStyle = 'rgba(160,30,24,0.85)'; g.lineWidth = 2; g.beginPath(); g.ellipse(W / 2, 140, 86, 11, -0.02, 0, 7); g.stroke();
  text(g, 'Incluye: Hospital San Jorge', 18, 196, `9px ${TYPE}`, '#3a352c');
  text(g, 'La planta de emergencia es responsabilidad', 18, 210, `8px ${TYPE}`, '#3a352c');
  text(g, 'de cada institución.', 18, 221, `8px ${TYPE}`, '#3a352c');
  pencil(g, 'ella llega con el apagón', 22, 258, 22, -0.05);
  tape(g, 24, 8, 36, 12, -0.2); tape(g, W - 26, 8, 36, 12, 0.25);
  return c;
}
function handwash(seed: number) {
  const W = 200, H = 280, [c, g] = canvas(W, H), R = rng(seed);
  paperBase(g, W, H, R, [206, 214, 206]);
  g.fillStyle = '#1f4f6e'; g.fillRect(0, 0, W, 54);
  text(g, 'LÁVESE', W / 2, 26, `700 22px ${STENCIL}`, '#e8e4d8', 'center');
  text(g, 'LAS MANOS', W / 2, 48, `700 18px ${STENCIL}`, '#e8e4d8', 'center');
  // two hands under falling water
  g.fillStyle = '#d9b48f'; g.strokeStyle = '#6b4a30'; g.lineWidth = 2;
  for (const s of [-1, 1]) {
    g.save(); g.translate(W / 2 + s * 30, 150); g.scale(s, 1); g.rotate(0.35);
    g.beginPath(); g.ellipse(0, 0, 24, 30, 0, 0, 7); g.fill(); g.stroke();
    for (let f = 0; f < 4; f++) { g.beginPath(); g.ellipse(-14 + f * 9.5, -34 - (f === 1 || f === 2 ? 4 : 0), 4.5, 14, 0, 0, 7); g.fill(); g.stroke(); }
    g.restore();
  }
  g.strokeStyle = 'rgba(70,130,170,0.8)'; g.lineWidth = 2;
  for (let i = 0; i < 12; i++) { const x = W / 2 - 22 + R() * 44, y = 64 + R() * 40; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 8); g.stroke(); }
  text(g, 'Antes y después de atender', W / 2, 214, `9px ${TYPE}`, '#2a2a26', 'center');
  text(g, 'a cada paciente.', W / 2, 226, `9px ${TYPE}`, '#2a2a26', 'center');
  text(g, 'COMITÉ DE HIGIENE · H. SAN JORGE', W / 2, 244, `700 7px ${TYPE}`, '#2a2a26', 'center');
  pencil(g, 'no sale', W - 70, 270, 24, -0.12, 'rgba(110,24,20,0.85)');
  tape(g, W / 2, 6, 44, 12, 0.04);
  return c;
}
function vaccination(seed: number) {
  const W = 220, H = 300, [c, g] = canvas(W, H), R = rng(seed);
  paperBase(g, W, H, R, [224, 210, 168]);
  g.fillStyle = '#b8402c'; g.fillRect(0, 0, W, 64);
  text(g, 'JORNADA DE', W / 2, 26, `700 15px ${STENCIL}`, '#f4ead2', 'center');
  text(g, 'VACUNACIÓN', W / 2, 52, `700 24px ${STENCIL}`, '#f4ead2', 'center');
  // three smiling children, pasted from an older poster
  for (let i = 0; i < 3; i++) {
    const x = 46 + i * 64, y = 128 + (i === 1 ? -8 : 4);
    g.fillStyle = ['#c79a72', '#a8774f', '#d3a985'][i]; g.beginPath(); g.arc(x, y, 24, 0, 7); g.fill();
    g.fillStyle = '#2a1e16'; g.beginPath(); g.arc(x, y - 10, 25, Math.PI * 1.05, Math.PI * 1.95); g.fill();
    g.strokeStyle = '#3a2418'; g.lineWidth = 2; g.beginPath(); g.arc(x, y + 6, 9, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = '#2a1e16'; g.beginPath(); g.arc(x - 8, y - 3, 2.5, 0, 7); g.arc(x + 8, y - 3, 2.5, 0, 7); g.fill();
    // somebody scratched every pair of eyes out with a ballpoint
    g.strokeStyle = 'rgba(20,24,60,0.9)'; g.lineWidth = 1.4;
    for (let k = 0; k < 14; k++) { g.beginPath(); g.moveTo(x - 15 + R() * 4, y - 6 + R() * 6); g.lineTo(x + 12 + R() * 4, y - 6 + R() * 6); g.stroke(); }
    g.fillStyle = '#e8e2cc'; g.fillRect(x - 22, y + 26, 44, 34);
  }
  text(g, 'Polio · Sarampión · DPT', W / 2, 222, `700 11px ${TYPE}`, '#2a2620', 'center');
  text(g, 'Lleve a sus hijos menores de 5 años', W / 2, 240, `9px ${TYPE}`, '#2a2620', 'center');
  text(g, 'HOSPITAL SAN JORGE · PEDIATRÍA · 1991', W / 2, 262, `700 8px ${TYPE}`, '#2a2620', 'center');
  tornCorner(g, W, H, R);
  tape(g, 20, 10, 34, 12, -0.4); tape(g, W - 20, 10, 34, 12, 0.4);
  return c;
}
function extensions(seed: number) {
  const W = 170, H = 236, [c, g] = canvas(W, H), R = rng(seed);
  paperBase(g, W, H, R, [226, 220, 204]);
  text(g, 'EXTENSIONES', W / 2, 24, `700 13px ${TYPE}`, '#1e1c18', 'center');
  g.fillStyle = '#1e1c18'; g.fillRect(16, 31, W - 32, 1);
  const rows = [['Recepción', '100'], ['Pabellón A', '210'], ['Pabellón B', '214'], ['Lencería', '230'], ['Cirugía', '250'], ['Cuarto eléctrico', '270'], ['Capellanía', '280'], ['Anfiteatro', '300']];
  rows.forEach(([a, b], i) => { const y = 54 + i * 19; text(g, a, 16, y, `10px ${TYPE}`, '#1e1c18'); text(g, b, W - 16, y, `700 10px ${TYPE}`, '#1e1c18', 'right'); });
  g.strokeStyle = 'rgba(30,30,40,0.85)'; g.lineWidth = 1.3; g.beginPath(); g.ellipse(W - 28, 54 + 7 * 19 - 4, 17, 10, 0.1, 0, 7); g.stroke();
  pencil(g, 'no contestar', 30, 222, 22, -0.06);
  tape(g, W / 2, 6, 40, 12, -0.05);
  return c;
}
// a child's crayon drawing taped low on the wall of the day room
function crayon(seed: number) {
  const W = 240, H = 170, [c, g] = canvas(W, H), R = rng(seed);
  paperBase(g, W, H, R, [236, 232, 220]);
  const cray = (col: string, pts: [number, number][], w = 2.2) => {
    for (let p = 0; p < 3; p++) {
      g.strokeStyle = col; g.globalAlpha = 0.45 + R() * 0.3; g.lineWidth = w * (0.6 + R() * 0.6); g.lineCap = 'round';
      g.beginPath(); pts.forEach(([x, y], i) => { const xx = x + (R() - 0.5) * 1.6, yy = y + (R() - 0.5) * 1.6; i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); }); g.stroke();
    }
    g.globalAlpha = 1;
  };
  // window with rain and a lightning bolt
  cray('#2a3a8a', [[20, 14], [74, 14], [74, 56], [20, 56], [20, 14]]);
  for (let i = 0; i < 9; i++) { const x = 24 + R() * 46, y = 18 + R() * 30; cray('#3b5bc4', [[x, y], [x - 2, y + 7]], 1.2); }
  cray('#e2b81c', [[52, 16], [44, 32], [52, 32], [40, 52]], 2.6);
  // six little beds, a person in each, eyes shut
  for (let i = 0; i < 6; i++) {
    const x = 18 + (i % 3) * 50, y = 82 + Math.floor(i / 3) * 42;
    cray('#7a4a22', [[x, y + 16], [x + 40, y + 16], [x + 40, y + 24], [x, y + 24], [x, y + 16]]);
    cray('#7a4a22', [[x, y + 24], [x, y + 30]]); cray('#7a4a22', [[x + 40, y + 24], [x + 40, y + 30]]);
    g.fillStyle = 'rgba(230,170,140,0.9)'; g.beginPath(); g.arc(x + 9, y + 11, 6, 0, 7); g.fill();
    cray('#222', [[x + 6, y + 10], [x + 8, y + 11]], 1); cray('#222', [[x + 10, y + 10], [x + 12, y + 11]], 1);
    cray('#2f8a3c', [[x + 15, y + 12], [x + 38, y + 12]], 4);
  }
  // her: tall, black dress, white cap with a red cross, no face
  const nx = 200;
  cray('#111', [[nx - 14, 160], [nx - 10, 70], [nx + 10, 70], [nx + 14, 160]], 3);
  for (let y = 72; y < 158; y += 2.2) { const wv = 9 + (y - 72) / 86 * 5; cray('#151515', [[nx - wv + R() * 2, y], [nx + wv - R() * 2, y + 1.2]], 2.4); }
  g.fillStyle = 'rgba(240,226,210,1)'; g.beginPath(); g.arc(nx, 56, 13, 0, 7); g.fill();
  for (let k = 0; k < 18; k++) cray('#111', [[nx - 11 + R() * 4, 47 + R() * 18], [nx + 9 + R() * 4, 47 + R() * 18]], 1.4);
  cray('#111', [[nx - 13, 50], [nx - 18, 90]], 3); cray('#111', [[nx + 13, 50], [nx + 18, 92]], 3);
  cray('#f2f2f2', [[nx - 12, 40], [nx + 12, 40], [nx + 9, 32], [nx - 9, 32], [nx - 12, 40]], 3);
  cray('#d22', [[nx, 33], [nx, 39]], 1.5); cray('#d22', [[nx - 3, 36], [nx + 3, 36]], 1.5);
  cray('#111', [[nx + 14, 96], [nx + 26, 104]], 3);
  // the lettering, every N the wrong way round
  g.save(); g.font = `700 16px ${HAND}`; g.fillStyle = 'rgba(200,30,30,0.9)';
  const tw = [...'LA ENFERMERA CANTA'].reduce((a, ch) => a + g.measureText(ch).width + 1.5, 0), fit = Math.min(1, 146 / tw);
  g.translate(84, 26); g.rotate(-0.03); g.scale(fit, fit);
  let lx = 0;
  for (const ch of 'LA ENFERMERA CANTA') {
    const w = g.measureText(ch).width + 1.5;
    g.save(); g.translate(lx + w / 2, (R() - 0.5) * 3); if (ch === 'N') g.scale(-1, 1); g.textAlign = 'center'; g.fillText(ch, 0, 0); g.restore();
    lx += w;
  }
  g.restore();
  pencil(g, 'Mariana · cama 6', 120, 162, 15, -0.02, 'rgba(60,60,70,0.8)');
  tape(g, 30, 4, 30, 10, -0.3); tape(g, W - 30, 4, 30, 10, 0.3);
  return c;
}
function estampita(seed: number, which: 0 | 1) {
  const W = 72, H = 108, [c, g] = canvas(W, H), R = rng(seed);
  g.fillStyle = '#efe6cf'; g.fillRect(0, 0, W, H);
  g.fillStyle = which ? '#3d5a94' : '#7fb3d6'; g.fillRect(5, 5, W - 10, H - 26);
  const cx = W / 2, cy = 46;
  const halo = g.createRadialGradient(cx, cy - 14, 2, cx, cy - 14, 26); halo.addColorStop(0, 'rgba(255,230,140,0.95)'); halo.addColorStop(1, 'rgba(255,230,140,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(cx, cy - 14, 26, 0, 7); g.fill();
  g.fillStyle = which ? '#2a4a86' : '#e79aae'; g.beginPath(); g.moveTo(cx - 14, H - 24); g.lineTo(cx - 8, cy - 4); g.lineTo(cx + 8, cy - 4); g.lineTo(cx + 14, H - 24); g.fill();
  if (!which) { g.strokeStyle = '#e79aae'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 6, cy + 2); g.lineTo(cx - 20, cy - 8); g.moveTo(cx + 6, cy + 2); g.lineTo(cx + 20, cy - 8); g.stroke(); }
  g.fillStyle = '#e8c39e'; g.beginPath(); g.arc(cx, cy - 13, 7, 0, 7); g.fill();
  if (which) { g.fillStyle = '#1f3570'; g.beginPath(); g.arc(cx, cy - 15, 9, Math.PI, 0); g.fill(); for (let i = 0; i < 8; i++) { g.fillStyle = '#fff3b0'; g.fillRect(8 + R() * (W - 16), 8 + R() * 30, 1.5, 1.5); } }
  text(g, which ? 'Virgen del Carmen' : 'Divino Niño', W / 2, H - 9, `700 7px ${TYPE}`, '#3a3226', 'center');
  for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(120,90,40,${R() * 0.2})`; g.beginPath(); g.arc(R() * W, R() * H, 3 + R() * 6, 0, 7); g.fill(); }
  return c;
}
function rrect(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function bedPlate(n: number) {
  const W = 64, H = 44, [c, g] = canvas(W, H), R = rng(400 + n);
  g.fillStyle = '#e9e6dc'; rrect(g, 2, 2, W - 4, H - 4, 6); g.fill();
  g.strokeStyle = '#26467a'; g.lineWidth = 3; rrect(g, 5, 5, W - 10, H - 10, 4); g.stroke();
  text(g, String(n), W / 2, 34, `700 26px ${STENCIL}`, '#26467a', 'center');
  for (let i = 0; i < 4; i++) { g.fillStyle = '#1c1c1a'; g.beginPath(); g.arc(R() < 0.5 ? 4 + R() * 6 : W - 4 - R() * 6, R() < 0.5 ? 4 + R() * 5 : H - 4 - R() * 5, 1.5 + R() * 2.5, 0, 7); g.fill(); }
  g.fillStyle = '#555'; g.beginPath(); g.arc(9, H / 2, 2, 0, 7); g.arc(W - 9, H / 2, 2, 0, 7); g.fill();
  return c;
}
// the day room's cork board: everything pinned up in the last weeks
function corkBoard(seed: number) {
  const W = 400, H = 270, [c, g] = canvas(W, H), R = rng(seed), n = noise2(seed);
  g.fillStyle = '#5a3a22'; g.fillRect(0, 0, W, H);
  const img = g.createImageData(W - 24, H - 24), d = img.data;
  for (let y = 0; y < H - 24; y++) for (let x = 0; x < W - 24; x++) {
    const v = 0.75 + fbm(n, x * 0.25, y * 0.25, 2) * 0.35 + (R() - 0.5) * 0.18, i = (y * (W - 24) + x) * 4;
    d[i] = 168 * v; d[i + 1] = 122 * v; d[i + 2] = 74 * v; d[i + 3] = 255;
  }
  g.putImageData(img, 12, 12);
  const pin = (x: number, y: number, col: string) => { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(x + 2, y + 2, 4, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x - 2, y - 2, 1.5, 1.5); };
  const sheet = (x: number, y: number, w: number, h: number, rot: number, draw: (g: Ctx) => void, tone: RGB = [226, 220, 200]) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(3, 3, w, h);
    const [pc, pg] = canvas(w, h); paperBase(pg, w, h, R, tone); draw(pg); g.drawImage(pc, 0, 0);
    g.restore();
  };
  sheet(22, 24, 120, 150, -0.05, p => {
    text(p, 'VISITAS', 60, 26, `700 16px ${STENCIL}`, '#7a1c14', 'center');
    text(p, 'Martes y jueves', 60, 50, `10px ${TYPE}`, '#26221c', 'center'); text(p, '2 a 4 p. m.', 60, 64, `10px ${TYPE}`, '#26221c', 'center');
    text(p, 'Domingos', 60, 86, `10px ${TYPE}`, '#26221c', 'center'); text(p, '10 a 12 m.', 60, 100, `10px ${TYPE}`, '#26221c', 'center');
    pencil(p, 'hasta las 8.', 18, 128, 19, -0.05); pencil(p, 'Sin excepción. K.', 14, 144, 16, -0.03);
  });
  sheet(160, 30, 96, 120, 0.06, p => {
    text(p, 'SE NECESITAN', 48, 24, `700 10px ${TYPE}`, '#26221c', 'center'); text(p, 'DONANTES', 48, 40, `700 13px ${STENCIL}`, '#7a1c14', 'center');
    text(p, 'O negativo', 48, 60, `10px ${TYPE}`, '#26221c', 'center'); text(p, 'Banco de sangre', 48, 76, `9px ${TYPE}`, '#26221c', 'center'); text(p, '2.º piso', 48, 90, `9px ${TYPE}`, '#26221c', 'center');
  }, [232, 226, 214]);
  // a polaroid with the face cut out
  sheet(276, 26, 98, 114, -0.08, p => {
    p.fillStyle = '#efeadb'; p.fillRect(0, 0, 98, 114);
    const sky = p.createLinearGradient(0, 8, 0, 90); sky.addColorStop(0, '#6c7a74'); sky.addColorStop(1, '#3a3e36');
    p.fillStyle = sky; p.fillRect(8, 8, 82, 80);
    p.fillStyle = '#e6e2d6'; p.beginPath(); p.moveTo(30, 88); p.lineTo(36, 46); p.lineTo(62, 46); p.lineTo(68, 88); p.fill();
    p.fillStyle = '#f2efe6'; p.fillRect(38, 22, 22, 7);
    p.fillStyle = '#5a3a22'; p.beginPath(); p.arc(49, 38, 10, 0, 7); p.fill(); // the hole, cork showing through
    pencil(p, 'K. 1974', 24, 106, 15, -0.02);
  }, [239, 234, 219]);
  sheet(170, 166, 104, 82, -0.03, p => {
    text(p, 'TURNOS · MARZO', 52, 18, `700 9px ${TYPE}`, '#26221c', 'center');
    for (let i = 0; i < 5; i++) { p.fillStyle = 'rgba(30,30,30,0.5)'; p.fillRect(10, 28 + i * 10, 84, 1); text(p, ['Hna. Inés', 'Hna. Rosa', 'Hna. K.', 'Hna. Luz', 'Hna. K.'][i], 12, 26 + i * 10, `8px ${TYPE}`, '#26221c'); }
    p.strokeStyle = 'rgba(160,30,24,0.8)'; p.lineWidth = 1.2; p.beginPath(); p.moveTo(8, 64); p.lineTo(96, 74); p.stroke();
  }, [222, 222, 210]);
  // a prayer card and a ribbon of children's names
  const [ec] = [estampita(seed + 2, 0)]; g.save(); g.translate(300, 160); g.rotate(0.12); g.drawImage(ec, 0, 0, 54, 81); g.restore();
  sheet(28, 190, 128, 58, 0.03, p => { pencil(p, 'Recen por los de la', 10, 24, 16, -0.02); pencil(p, 'cama 3. Por todos.', 12, 44, 16, -0.03); });
  for (const [x, y, col] of [[30, 30, '#c33'], [136, 28, '#2a6'], [168, 34, '#c33'], [250, 34, '#36c'], [280, 30, '#cc3'], [366, 28, '#c33'], [176, 170, '#36c'], [268, 168, '#2a6'], [34, 194, '#cc3'], [150, 192, '#c33'], [318, 164, '#c33']] as [number, number, string][]) pin(x, y, col);
  g.strokeStyle = '#3a2414'; g.lineWidth = 12; g.strokeRect(6, 6, W - 12, H - 12);
  g.strokeStyle = 'rgba(255,230,190,0.15)'; g.lineWidth = 1; g.strokeRect(2, 2, W - 4, H - 4);
  return c;
}

// ---- the decal atlas -----------------------------------------------------------------------------
export type DecalKind =
  | 'handR' | 'handL' | 'handSmearR' | 'handTips' | 'handDrag' | 'handChild' | 'handChildL' | 'handSoot' | 'fingerTrail'
  | 'claws' | 'tally' | 'g_noduerme' | 'g_ojos' | 'g_visitas' | 'g_conteste' | 'g_cama3'
  | 'water' | 'mould' | 'scorch' | 'ghost' | 'footL' | 'footR'
  | 'rationing' | 'handwash' | 'vaccination' | 'extensions' | 'crayon' | 'estampa0' | 'estampa1' | 'cork'
  | 'bed1' | 'bed2' | 'bed3' | 'bed4' | 'bed5' | 'bed6';

// world size in metres for each decal (the canvas aspect follows)
export const DECAL_SIZE: Record<DecalKind, [number, number]> = {
  handR: [0.21, 0.255], handL: [0.21, 0.255], handSmearR: [0.21, 0.255], handTips: [0.21, 0.255], handDrag: [0.22, 0.7], handChild: [0.13, 0.158], handChildL: [0.13, 0.158], handSoot: [0.21, 0.255], fingerTrail: [0.95, 0.25],
  claws: [0.25, 0.55], tally: [0.48, 0.24], g_noduerme: [1.75, 0.5], g_ojos: [1.6, 0.7], g_visitas: [1.8, 0.58], g_conteste: [0.42, 0.14], g_cama3: [0.75, 0.45],
  water: [1.3, 2.0], mould: [1.3, 1.0], scorch: [0.95, 1.2], ghost: [0.52, 0.67], footL: [0.11, 0.24], footR: [0.11, 0.24],
  rationing: [0.3, 0.42], handwash: [0.3, 0.42], vaccination: [0.36, 0.49], extensions: [0.21, 0.29], crayon: [0.36, 0.255], estampa0: [0.07, 0.105], estampa1: [0.07, 0.105], cork: [0.95, 0.64],
  bed1: [0.13, 0.09], bed2: [0.13, 0.09], bed3: [0.13, 0.09], bed4: [0.13, 0.09], bed5: [0.13, 0.09], bed6: [0.13, 0.09],
};

function drawDecals(): Record<DecalKind, HTMLCanvasElement> {
  const ink: InkOpts = { color: [16, 14, 12], size: 64, passes: 6, jitter: 2.0, erode: 0.24, alpha: 0.5 };
  return {
    handR: handFull(11, { spread: 1.1 }), handL: handFull(12, { left: true, spread: 1.25, fingers: [1, 0.9, 1, 0.7], rot: -0.15 }),
    handSmearR: stain(112, 136, 13, BLOOD, (g, R) => { const [tc, tg] = canvas(112, 136); paintHand(tg, 52, 76, 6.0, { rot: 0.35, spread: 1.3, fingers: [0.9, 1, 0.8, 0.6], palm: 0.7 }, R); for (let k = 0; k < 8; k++) { g.globalAlpha = 0.5 * (1 - k / 8); g.drawImage(tc, k * 2.2, k * 1.1); } g.globalAlpha = 1; g.drawImage(tc, 0, 0); }),
    handTips: handFull(14, { tipsOnly: true, spread: 1.05, rot: 0.1 }, OLD_BLOOD),
    handDrag: handDrag(15),
    handChild: handFull(16, { child: true, spread: 1.2 }, OLD_BLOOD), handChildL: handFull(17, { child: true, left: true, spread: 1.3, rot: 0.2 }, OLD_BLOOD),
    handSoot: handFull(18, { left: true, spread: 1.05, palm: 0.85 }, SOOT),
    fingerTrail: fingerTrail(19),
    claws: clawMarks(20), tally: tally(21),
    g_noduerme: letters(520, 150, 22, ['ELLA NO DUERME'], { ...ink, size: 96 }),
    g_ojos: letters(480, 210, 23, ['SI CANTA,', 'CIERRE LOS OJOS'], { ...ink, size: 78 }),
    g_visitas: letters(520, 168, 24, ['LAS VISITAS ERAN', 'HASTA LAS 8'], { color: [128, 18, 28], size: 70, passes: 3, jitter: 1.4, erode: 0.24, alpha: 0.55, wax: true }),
    g_conteste: letters(240, 80, 25, ['NO CONTESTE'], { color: [24, 30, 70], size: 40, passes: 2, jitter: 0.8, erode: 0.12, alpha: 0.75, font: HAND }),
    g_cama3: letters(260, 156, 26, ['CAMA 3 →'], { ...ink, size: 70, color: [128, 18, 14], erode: 0.18 }),
    water: waterStain(27), mould: mould(28), scorch: scorch(29), ghost: ghostFrame(30),
    footL: footprint(31, true), footR: footprint(32, false),
    rationing: rationing(33), handwash: handwash(34), vaccination: vaccination(35), extensions: extensions(36), crayon: crayon(37),
    estampa0: estampita(38, 0), estampa1: estampita(39, 1), cork: corkBoard(40),
    bed1: bedPlate(1), bed2: bedPlate(2), bed3: bedPlate(3), bed4: bedPlate(4), bed5: bedPlate(5), bed6: bedPlate(6),
  };
}

export interface Atlas { tex: THREE.CanvasTexture; uv: Record<DecalKind, [number, number, number, number]>; redraw: () => void }
export function makeDecalAtlas(): Atlas {
  const W = 2048, pad = 4;
  let parts = drawDecals();
  const keys = (Object.keys(parts) as DecalKind[]).sort((a, b) => parts[b].height - parts[a].height);
  // shelf packing, tallest first
  const place: Record<string, [number, number]> = {};
  let x = pad, y = pad, row = 0;
  for (const k of keys) {
    const c = parts[k];
    if (x + c.width + pad > W) { x = pad; y += row + pad; row = 0; }
    place[k] = [x, y]; x += c.width + pad; row = Math.max(row, c.height);
  }
  const H = Math.pow(2, Math.ceil(Math.log2(y + row + pad)));
  const [cv, g] = canvas(W, H);
  const uv = {} as Atlas['uv'];
  const paint = () => {
    g.clearRect(0, 0, W, H);
    for (const k of keys) { const [px, py] = place[k], c = parts[k]; g.drawImage(c, px, py); uv[k] = [px / W, 1 - (py + c.height) / H, (px + c.width) / W, 1 - py / H]; }
  };
  paint();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, uv, redraw: () => { parts = drawDecals(); paint(); tex.needsUpdate = true; } };
}

// ---- door leaves ------------------------------------------------------------------------------
export interface LeafOpts { handle: 'left' | 'right'; plate?: string; sub?: string; seed: number; tone?: RGB; window?: 'wired' | 'round' | 'none'; push?: boolean; stencil?: string }
export function doorLeaf(o: LeafOpts) {
  const W = 128, H = 256, [c, g] = canvas(W, H), R = rng(o.seed), tone = o.tone ?? [124, 138, 122], n = noise2(o.seed);
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = 0.92 + fbm(n, x * 0.05, y * 0.05, 3) * 0.16 + (R() - 0.5) * 0.05, grime = 1 - smooth(H * 0.55, H, y) * 0.22, i = (y * W + x) * 4;
    d[i] = tone[0] * v * grime; d[i + 1] = tone[1] * v * grime; d[i + 2] = tone[2] * v * grime; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const hx = o.handle === 'right' ? W - 18 : 18;
  // a sunk panel line, and the hand-grime halo where people push
  g.strokeStyle = 'rgba(40,46,40,0.5)'; g.lineWidth = 2; g.strokeRect(9, 9, W - 18, H - 18);
  g.strokeStyle = 'rgba(220,230,215,0.12)'; g.lineWidth = 1; g.strokeRect(11, 11, W - 22, H - 22);
  const gr = g.createRadialGradient(hx, 120, 2, hx, 120, 38); gr.addColorStop(0, 'rgba(40,34,26,0.45)'); gr.addColorStop(1, 'rgba(40,34,26,0)');
  g.fillStyle = gr; g.fillRect(0, 70, W, 110);
  if ((o.window ?? 'wired') === 'wired') {
    g.fillStyle = '#353a35'; g.fillRect(36, 30, 56, 66); g.fillStyle = '#070908'; g.fillRect(40, 34, 48, 58);
    const sh = g.createLinearGradient(40, 34, 88, 92); sh.addColorStop(0, 'rgba(120,140,140,0.18)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); g.fillStyle = sh; g.fillRect(40, 34, 48, 58);
    g.strokeStyle = 'rgba(150,150,140,0.35)'; g.lineWidth = 1;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(40 + i * 6, 34); g.lineTo(40 + i * 6, 92); g.stroke(); }
    for (let i = 0; i <= 9; i++) { g.beginPath(); g.moveTo(40, 34 + i * 6.4); g.lineTo(88, 34 + i * 6.4); g.stroke(); }
    if (R() < 0.5) { g.strokeStyle = 'rgba(200,210,200,0.45)'; g.beginPath(); g.moveTo(52, 40); g.lineTo(62, 58); g.lineTo(58, 76); g.moveTo(62, 58); g.lineTo(78, 62); g.stroke(); }
  } else if (o.window === 'round') {
    g.fillStyle = '#9a9c96'; g.beginPath(); g.arc(W / 2, 62, 26, 0, 7); g.fill(); g.fillStyle = '#060707'; g.beginPath(); g.arc(W / 2, 62, 21, 0, 7); g.fill();
    g.fillStyle = 'rgba(140,160,160,0.2)'; g.beginPath(); g.arc(W / 2 - 6, 56, 9, 0, 7); g.fill();
  }
  // push plate and kick plate
  g.fillStyle = '#a8aaa2'; g.fillRect(hx - 8 - (o.handle === 'right' ? 0 : 0), 98, 16, 42); g.fillStyle = 'rgba(40,40,36,0.45)'; g.fillRect(hx - 6, 112, 12, 16);
  const kp = g.createLinearGradient(0, H - 46, 0, H - 10); kp.addColorStop(0, '#8d8f88'); kp.addColorStop(1, '#5f615b');
  g.fillStyle = kp; g.fillRect(10, H - 46, W - 20, 36);
  for (let i = 0; i < 26; i++) { g.strokeStyle = `rgba(30,30,28,${0.2 + R() * 0.4})`; g.lineWidth = 0.6 + R(); const x = 12 + R() * (W - 26), y = H - 44 + R() * 30; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 16, y + (R() - 0.5) * 3); g.stroke(); }
  if (o.push) { g.fillStyle = '#b9bab2'; g.fillRect(12, 132, W - 24, 9); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(12, 141, W - 24, 2); }
  if (o.plate) {
    g.fillStyle = '#e8e2cf'; g.fillRect(30, 104, 68, 22); g.strokeStyle = '#2b2b26'; g.lineWidth = 1.5; g.strokeRect(32, 106, 64, 18);
    text(g, o.plate, W / 2, 118, `700 9px ${TYPE}`, '#1d1c18', 'center');
    if (o.sub) text(g, o.sub, W / 2, 124, `700 5px ${TYPE}`, '#7a1c14', 'center');
  }
  if (o.stencil) { g.save(); g.globalAlpha = 0.8; text(g, o.stencil, W / 2, 172, `700 13px ${STENCIL}`, '#e8e2cf', 'center'); g.restore(); }
  // chipped paint, scuffs from beds and trolleys at shin height
  for (let i = 0; i < 18; i++) { g.fillStyle = R() < 0.5 ? 'rgba(170,160,130,0.6)' : 'rgba(50,42,32,0.5)'; g.beginPath(); g.ellipse(R() * W, 150 + R() * 70, 1 + R() * 4, 1 + R() * 2, R() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 6; i++) { const x = R() * W, y = R() * H, r = 4 + R() * 12, s = g.createRadialGradient(x, y, 0, x, y, r); s.addColorStop(0, 'rgba(70,54,30,0.25)'); s.addColorStop(1, 'rgba(70,54,30,0)'); g.fillStyle = s; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---- framed pictures ----------------------------------------------------------------------------
function frameAround(g: Ctx, W: number, H: number, b: number, col: RGB, gilt = false) {
  const gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, rgba(col[0] * 1.2, col[1] * 1.2, col[2] * 1.2)); gr.addColorStop(0.5, rgba(...col)); gr.addColorStop(1, rgba(col[0] * 0.6, col[1] * 0.6, col[2] * 0.6));
  g.fillStyle = gr;
  g.fillRect(0, 0, W, b); g.fillRect(0, H - b, W, b); g.fillRect(0, 0, b, H); g.fillRect(W - b, 0, b, H);
  g.strokeStyle = gilt ? 'rgba(255,230,150,0.45)' : 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.strokeRect(b * 0.35, b * 0.35, W - b * 0.7, H - b * 0.7);
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.strokeRect(b - 1, b - 1, W - 2 * b + 2, H - 2 * b + 2);
}
function brass(g: Ctx, W: number, y: number, s: string, size = 7) {
  g.fillStyle = '#b08d3c'; g.fillRect(W / 2 - s.length * size * 0.33 - 6, y - size - 2, s.length * size * 0.66 + 12, size + 7);
  g.fillStyle = 'rgba(255,240,180,0.35)'; g.fillRect(W / 2 - s.length * size * 0.33 - 6, y - size - 2, s.length * size * 0.66 + 12, 1);
  text(g, s, W / 2, y + 2, `700 ${size}px ${TYPE}`, '#2a2010', 'center');
}
const sepia = (g: Ctx, W: number, H: number, seed: number) => {
  const img = g.getImageData(0, 0, W, H), d = img.data, R = rng(seed);
  for (let i = 0; i < d.length; i += 4) { const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * (0.9 + R() * 0.16); d[i] = l * 1.07 + 10; d[i + 1] = l * 0.95 + 4; d[i + 2] = l * 0.78; }
  g.putImageData(img, 0, 0);
};
// Promoción de enfermería, 1974: three rows of sisters in white. The variant has one more.
export function nursesPhoto(extra: boolean) {
  const W = 300, H = 230, [c, g] = canvas(W, H), R = rng(1974);
  g.fillStyle = '#1b1a17'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8e2d0'; g.fillRect(14, 14, W - 28, H - 28); // mat
  const px = 28, py = 26, pw = W - 56, ph = H - 78;
  const bg = g.createLinearGradient(0, py, 0, py + ph); bg.addColorStop(0, '#8a877c'); bg.addColorStop(1, '#55534b');
  g.fillStyle = bg; g.fillRect(px, py, pw, ph);
  g.fillStyle = '#6b6a60'; g.fillRect(px, py + ph * 0.62, pw, ph * 0.38);
  const nurse = (x: number, y: number, s: number, scratch = false, ghost = false) => {
    g.save(); g.globalAlpha = ghost ? 0.78 : 1;
    g.fillStyle = ghost ? '#cfccc2' : '#efece4'; g.beginPath(); g.moveTo(x - 12 * s, y + 40 * s); g.lineTo(x - 9 * s, y + 8 * s); g.lineTo(x + 9 * s, y + 8 * s); g.lineTo(x + 12 * s, y + 40 * s); g.fill();
    g.fillStyle = '#2a2622'; g.beginPath(); g.arc(x, y, 7.2 * s, 0, 7); g.fill();
    g.fillStyle = ghost ? '#b9b4a8' : '#d8c8b0'; g.beginPath(); g.ellipse(x, y + 1 * s, 5.4 * s, 6.4 * s, 0, 0, 7); g.fill();
    g.fillStyle = '#f6f4ee'; g.fillRect(x - 6.5 * s, y - 8.5 * s, 13 * s, 4.2 * s);
    g.fillStyle = '#2a2622'; g.fillRect(x - 2.6 * s, y - 0.3 * s, 1.5 * s, 1.2 * s); g.fillRect(x + 1.2 * s, y - 0.3 * s, 1.5 * s, 1.2 * s);
    if (ghost) { g.fillStyle = 'rgba(10,10,10,0.9)'; g.beginPath(); g.ellipse(x - 2 * s, y + 0.3 * s, 1.6 * s, 1.9 * s, 0, 0, 7); g.ellipse(x + 2 * s, y + 0.3 * s, 1.6 * s, 1.9 * s, 0, 0, 7); g.fill(); }
    if (scratch) { g.strokeStyle = 'rgba(245,240,230,0.95)'; g.lineWidth = 1.1; for (let k = 0; k < 16; k++) { g.beginPath(); g.moveTo(x - 6 * s + R() * 3, y - 6 * s + R() * 12 * s); g.lineTo(x + 6 * s - R() * 3, y - 6 * s + R() * 12 * s); g.stroke(); } }
    g.restore();
  };
  const rows = [{ y: py + 20, n: 5, s: 1.0 }, { y: py + 44, n: 4, s: 1.08 }, { y: py + 70, n: 3, s: 1.16 }];
  rows.forEach((r, ri) => { for (let i = 0; i < r.n; i++) nurse(px + pw * (i + 1) / (r.n + 1) + (R() - 0.5) * 3, r.y, r.s, ri === 2 && i === 0); });
  if (extra) {
    // between the 2nd and 3rd sister in the back row, half a head taller, a little out of focus
    const x = px + pw * 2.5 / 6, y = py + 13;
    g.filter = 'blur(0.7px)'; nurse(x, y, 1.08, false, true); g.filter = 'none';
  }
  sepia(g, W, H, 74);
  g.fillStyle = 'rgba(255,250,235,0.06)'; for (let i = 0; i < 30; i++) g.fillRect(R() * W, R() * H, 1, 6 + R() * 30);
  text(g, 'PROMOCIÓN DE ENFERMERÍA · 1974', W / 2, H - 34, `700 9px ${TYPE}`, '#3a3428', 'center');
  text(g, 'Hospital San Jorge · Hermanas de la Caridad', W / 2, H - 22, `7px ${TYPE}`, '#4a4436', 'center');
  frameAround(g, W, H, 12, [36, 30, 24]);
  return toCanvasTex(c);
}
export function founder() {
  const W = 220, H = 280, [c, g] = canvas(W, H), R = rng(1951);
  const bg = g.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H * 0.45, H * 0.6); bg.addColorStop(0, '#5d4a30'); bg.addColorStop(1, '#1f170e');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // dark suit, white collar, tie
  g.fillStyle = '#17140f'; g.beginPath(); g.moveTo(30, H); g.quadraticCurveTo(W / 2, 150, W - 30, H); g.fill();
  g.fillStyle = '#e4dccb'; g.beginPath(); g.moveTo(W / 2 - 18, 176); g.lineTo(W / 2, 214); g.lineTo(W / 2 + 18, 176); g.fill();
  g.fillStyle = '#4a1a14'; g.beginPath(); g.moveTo(W / 2 - 5, 182); g.lineTo(W / 2 + 5, 182); g.lineTo(W / 2 + 7, 236); g.lineTo(W / 2, 246); g.lineTo(W / 2 - 7, 236); g.fill();
  // the head: old, lean, painted with too much brown
  g.fillStyle = '#b48e6c'; g.beginPath(); g.ellipse(W / 2, 118, 38, 50, 0, 0, 7); g.fill();
  g.fillStyle = '#9a7656'; g.beginPath(); g.ellipse(W / 2 + 14, 124, 18, 40, 0.1, 0, 7); g.fill();
  g.fillStyle = '#d8d2c6'; g.beginPath(); g.ellipse(W / 2, 74, 36, 16, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#c8c0b2'; g.fillRect(W / 2 - 39, 84, 8, 30); g.fillRect(W / 2 + 31, 84, 8, 30);
  g.strokeStyle = '#4a3420'; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2 - 14, 150); g.quadraticCurveTo(W / 2, 156, W / 2 + 14, 150); g.stroke();
  g.fillStyle = '#7a5a40'; g.beginPath(); g.moveTo(W / 2, 112); g.lineTo(W / 2 - 6, 136); g.lineTo(W / 2 + 6, 136); g.fill();
  // medical tape over the eyes, in a cross on each
  for (const sx of [-1, 1]) for (const r of [-0.35, 0.35]) {
    g.save(); g.translate(W / 2 + sx * 15, 108); g.rotate(r); g.fillStyle = 'rgba(236,232,220,0.96)'; g.fillRect(-15, -4.5, 30, 9);
    g.fillStyle = 'rgba(180,170,150,0.6)'; for (let i = 0; i < 6; i++) g.fillRect(-15 + i * 5, -4.5, 0.6, 9); g.restore();
  }
  for (let i = 0; i < 800; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,240,200' : '0,0,0'},${R() * 0.06})`; g.fillRect(R() * W, R() * H, 2, 1); }
  for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(20,14,8,0.25)'; g.lineWidth = 0.5; const x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 20, y + (R() - 0.5) * 20); g.stroke(); } // craquelure
  frameAround(g, W, H, 16, [150, 112, 50], true);
  brass(g, W, H - 30, 'DR. AURELIO SARMIENTO · FUNDADOR · 1951', 6);
  return toCanvasTex(c);
}
// a sabana landscape from the gift shop; in the variant somebody is home
export function landscape(lit: boolean) {
  const W = 280, H = 200, [c, g] = canvas(W, H), R = rng(77);
  const sky = g.createLinearGradient(0, 0, 0, H * 0.6); sky.addColorStop(0, '#5f7c8c'); sky.addColorStop(1, '#b8b49a');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(235,232,220,${0.25 + R() * 0.3})`; g.beginPath(); g.ellipse(R() * W, 20 + R() * 50, 20 + R() * 40, 6 + R() * 10, 0, 0, 7); g.fill(); }
  g.fillStyle = '#5b7244'; g.beginPath(); g.moveTo(0, 120); g.quadraticCurveTo(80, 88, 160, 112); g.quadraticCurveTo(220, 126, W, 100); g.lineTo(W, H); g.lineTo(0, H); g.fill();
  g.fillStyle = '#3f5530'; g.beginPath(); g.moveTo(0, 150); g.quadraticCurveTo(120, 128, W, 154); g.lineTo(W, H); g.lineTo(0, H); g.fill();
  for (let i = 0; i < 6; i++) { const x = 20 + i * 18 + R() * 8; g.fillStyle = '#2d3a26'; g.fillRect(x, 70, 3, 50); g.beginPath(); g.ellipse(x + 1, 66, 8, 24, 0, 0, 7); g.fill(); } // eucalyptus
  // the little house
  const hx = 182, hy = 108;
  g.fillStyle = '#e6e0cf'; g.fillRect(hx, hy, 40, 26);
  g.fillStyle = '#9a3a24'; g.beginPath(); g.moveTo(hx - 5, hy); g.lineTo(hx + 20, hy - 15); g.lineTo(hx + 45, hy); g.fill();
  g.fillStyle = '#4a3020'; g.fillRect(hx + 6, hy + 10, 7, 16);
  g.fillStyle = lit ? '#f4c25a' : '#1c1a16'; g.fillRect(hx + 24, hy + 8, 10, 9);
  if (lit) {
    const gl = g.createRadialGradient(hx + 29, hy + 12, 1, hx + 29, hy + 12, 16); gl.addColorStop(0, 'rgba(255,200,90,0.5)'); gl.addColorStop(1, 'rgba(255,200,90,0)'); g.fillStyle = gl; g.fillRect(hx + 10, hy - 4, 40, 34);
    g.fillStyle = '#16120c'; g.beginPath(); g.arc(hx + 29, hy + 11.5, 2.2, 0, 7); g.fill(); g.fillRect(hx + 26.5, hy + 13, 5, 4); // somebody looking out
    g.fillStyle = '#f2efe6'; g.fillRect(hx + 26.6, hy + 8.6, 4.8, 1.3);
  }
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,250,230' : '20,20,10'},${R() * 0.08})`; g.fillRect(R() * W, R() * H, 2, 2); }
  frameAround(g, W, H, 12, [92, 66, 40]);
  return toCanvasTex(c);
}
// the back of a frame, turned to face the wall
export function frameBack() {
  const W = 160, H = 210, [c, g] = canvas(W, H), R = rng(9);
  g.fillStyle = '#6b5233'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#9b8058'; g.fillRect(10, 10, W - 20, H - 20);
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(60,40,20,${R() * 0.15})`; g.fillRect(10 + R() * (W - 20), 10 + R() * (H - 20), 1 + R() * 8, 1); }
  g.strokeStyle = '#8c8c86'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(22, 46); g.quadraticCurveTo(W / 2, 20, W - 22, 46); g.stroke();
  for (const x of [22, W - 22]) { g.fillStyle = '#555'; g.beginPath(); g.arc(x, 46, 3, 0, 7); g.fill(); }
  g.fillStyle = '#e6ddc6'; g.fillRect(32, 62, 96, 26); text(g, 'Marquetería El Prado', W / 2, 74, `700 7px ${TYPE}`, '#3a3226', 'center'); text(g, 'Cra. 7 # 12-40', W / 2, 83, `6px ${TYPE}`, '#3a3226', 'center');
  pencil(g, 'para que', 30, 136, 30, -0.06); pencil(g, 'no vea', 46, 166, 30, -0.04);
  return toCanvasTex(c);
}
function toCanvasTex(c: HTMLCanvasElement) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

// clock face, numbers only; the hands are meshes
export function clockFace() {
  const S = 160, [c, g] = canvas(S, S), R = rng(347);
  g.fillStyle = '#2a2a26'; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.fill();
  const face = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2 - 8); face.addColorStop(0, '#ece6d4'); face.addColorStop(1, '#cfc6ad');
  g.fillStyle = face; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 9, 0, 7); g.fill();
  for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, r0 = S / 2 - 14, r1 = r0 - (i % 5 ? 4 : 9); g.strokeStyle = '#222'; g.lineWidth = i % 5 ? 1 : 2.4; g.beginPath(); g.moveTo(S / 2 + Math.sin(a) * r0, S / 2 - Math.cos(a) * r0); g.lineTo(S / 2 + Math.sin(a) * r1, S / 2 - Math.cos(a) * r1); g.stroke(); }
  for (let h = 1; h <= 12; h++) { const a = h / 12 * Math.PI * 2, r = S / 2 - 34; text(g, String(h), S / 2 + Math.sin(a) * r, S / 2 - Math.cos(a) * r + 5, `700 14px ${TYPE}`, '#1a1a18', 'center'); }
  text(g, 'H. SAN JORGE', S / 2, S / 2 + 30, `700 7px ${TYPE}`, '#5a1a14', 'center');
  for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(120,90,40,${R() * 0.25})`; g.beginPath(); g.arc(30 + R() * 100, 30 + R() * 100, 4 + R() * 12, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 12, -2.6, -1.4); g.stroke();
  return toCanvasTex(c);
}

// the storm sky seen through the windows: clouds, and (when lightning fires) a bolt drawn into it
export class StormSky {
  c: HTMLCanvasElement; g: Ctx; tex: THREE.CanvasTexture; private R = rng(5150);
  private skyline: [number, number][] = []; private bolt: [number, number][][] | null = null;
  private drops: { x: number; y: number; v: number; l: number; w: number; stop: number }[] = [];
  private flash = 0; private acc = 0;
  constructor() {
    [this.c, this.g] = canvas(96, 144);
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace;
    let x = 0; // the city, blacked out by the rationing: a ragged skyline, not one window lit (fixed: it does not move between strikes)
    while (x < 96) { const h = 18 + this.R() * 26; this.skyline.push([x, h]); x += 6 + this.R() * 12; this.skyline.push([x, h]); }
    for (let i = 0; i < 30; i++) this.drops.push(this.drop(true));
    this.draw(0, false);
  }
  private drop(anywhere = false) { const R = this.R; return { x: 5 + R() * 86, y: anywhere ? R() * 144 : -8 - R() * 30, v: 6 + R() * 30, l: 3 + R() * 7, w: R() < 0.25 ? 1.6 : 1, stop: 0 }; }
  private makeBolt() {
    const R = this.R, H = 144, paths: [number, number][][] = []; let x = 20 + R() * 56, y = 0; const main: [number, number][] = [[x, y]];
    while (y < H * 0.75) {
      const nx = x + (R() - 0.5) * 16, ny = y + 6 + R() * 10; main.push([nx, ny]);
      if (R() < 0.18) paths.push([[nx, ny], [nx + (R() - 0.5) * 30, ny + 10 + R() * 18]]);
      x = nx; y = ny;
    }
    paths.unshift(main); return paths;
  }
  draw(flash: number, bolt: boolean) {
    this.flash = flash;
    this.bolt = bolt ? this.bolt ?? this.makeBolt() : null;
    this.paint();
  }
  // water running down the glass: drops slide, stall, slide again (redrawn ~12 times a second)
  tick(dt: number) {
    for (const d of this.drops) {
      if (d.stop > 0) { d.stop -= dt; continue; }
      d.y += d.v * dt;
      if (Math.random() < dt * 0.6) d.stop = 0.2 + Math.random() * 0.9;
      if (d.y - d.l > 144) Object.assign(d, this.drop());
    }
    this.acc += dt;
    if (this.acc > 1 / 12) { this.acc = 0; this.paint(); }
  }
  private paint() {
    const g = this.g, W = 96, H = 144, k = this.flash;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `rgb(${14 + 200 * k},${18 + 205 * k},${26 + 215 * k})`); sky.addColorStop(1, `rgb(${8 + 120 * k},${10 + 125 * k},${16 + 140 * k})`);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(${30 + 200 * k},${34 + 200 * k},${44 + 205 * k},0.5)`; g.beginPath(); g.ellipse((i * 37) % W, 18 + (i * 23) % 50, 26, 9, 0, 0, 7); g.fill(); }
    if (this.bolt) {
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1.6; g.shadowColor = 'rgba(200,220,255,1)'; g.shadowBlur = 8;
      g.beginPath(); for (const path of this.bolt) path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.shadowBlur = 0;
    }
    g.fillStyle = `rgb(${4 + 30 * k},${5 + 30 * k},${7 + 34 * k})`;
    g.beginPath(); g.moveTo(0, H); for (const [x, h] of this.skyline) g.lineTo(x, H - h); g.lineTo(W, H); g.fill();
    // frame bars
    g.fillStyle = '#1a1c1a'; g.fillRect(0, 0, W, 4); g.fillRect(0, H - 4, W, 4); g.fillRect(0, 0, 4, H); g.fillRect(W - 4, 0, 4, H); g.fillRect(W / 2 - 2, 0, 4, H); g.fillRect(0, H * 0.45, W, 4);
    // rain on the glass: a bright head and a thin wet trail
    for (const d of this.drops) {
      const tr = g.createLinearGradient(0, d.y - d.l * 3, 0, d.y);
      tr.addColorStop(0, 'rgba(160,180,200,0)'); tr.addColorStop(1, `rgba(${150 + 100 * k},${170 + 80 * k},${195 + 60 * k},0.3)`);
      g.strokeStyle = tr; g.lineWidth = d.w * 0.7; g.beginPath(); g.moveTo(d.x, d.y - d.l * 3); g.lineTo(d.x, d.y); g.stroke();
      g.fillStyle = `rgba(${185 + 70 * k},${200 + 55 * k},${215 + 40 * k},0.55)`; g.fillRect(d.x - d.w * 0.5, d.y - 1, d.w, 2);
    }
    this.tex.needsUpdate = true;
  }
}

// her outline as it would show in dark glass behind your shoulder: cap, hair, the white apron
export function silhouette() {
  const W = 64, H = 128, [c, g] = canvas(W, H);
  g.fillStyle = 'rgba(8,8,8,0.95)';
  g.beginPath(); g.moveTo(14, H); g.lineTo(20, 52); g.quadraticCurveTo(32, 40, 44, 52); g.lineTo(50, H); g.fill();
  g.beginPath(); g.ellipse(32, 30, 10, 13, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(22, 30); g.quadraticCurveTo(18, 58, 24, 70); g.lineTo(40, 70); g.quadraticCurveTo(46, 58, 42, 30); g.fill(); // hair down to the shoulders
  g.fillStyle = 'rgba(210,205,192,0.85)'; g.fillRect(23, 16, 18, 5);                                     // cap
  g.fillStyle = 'rgba(180,176,166,0.55)'; g.beginPath(); g.moveTo(25, 62); g.lineTo(39, 62); g.lineTo(42, 112); g.lineTo(22, 112); g.fill(); // apron
  g.fillStyle = 'rgba(150,146,138,0.5)'; g.beginPath(); g.ellipse(32, 31, 6, 8, 0, 0, 7); g.fill();     // a pale smear of face
  g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillRect(28, 29, 2.4, 2); g.fillRect(34, 29, 2.4, 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// the San Jorge print again, with tape over the saint's eyes
export function tapedSaint(src: HTMLCanvasElement) {
  const [c, g] = canvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  g.save(); g.translate(57, 40); g.rotate(-0.25); g.fillStyle = 'rgba(236,232,220,0.95)'; g.fillRect(-6, -1.4, 12, 2.6); g.restore();
  g.save(); g.translate(57, 40); g.rotate(0.3); g.fillStyle = 'rgba(226,222,208,0.9)'; g.fillRect(-5, -1.1, 10, 2.2); g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return t;
}
