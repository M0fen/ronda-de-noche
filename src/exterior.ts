// The two places outside, as they look today, at night:
//  · Carrera 4 between the Hospital Universitario San Jorge and the Parque Gaitán (the way in, during the blackout:
//    the bust of Gaitán on its brick column, the red brick walks, the big trees, the kiosks, an ambulance turning red
//    at Urgencias), and
//  · the Hospital Mental Universitario de Risaralda (HOMERIS) on the Avenida 30 de Agosto (where the dose takes you:
//    the white front with its turquoise bands and the big lettering, the parking, the samanes, the guard's booth).
// Built from reference photos; nothing photographic is used. Each set sits far from the hospital map and, while a scene
// runs there, borrows the map's lights (the count never changes, so no shader is rebuilt) and gives them back after.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Game } from './game';
import { rng, canvas, toTex, rgba, noise, blotch } from './textures';

export const SJ0 = new THREE.Vector3(1000, 0, 0);   // the San Jorge set: x east along the Carrera 4, z south into the park
export const HM0 = new THREE.Vector3(2000, 0, 0);   // the HOMERIS set: x east along the avenue, z south toward it
export type SetName = 'sj' | 'hm';

const FONT = '"Arial Black", "Arial Bold", "Helvetica Neue", Arial, sans-serif';
const lam = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---- geometry kit: everything with the same material is merged into one mesh --------------------------------------
function scaleUV(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}
function tileBox(g: THREE.BufferGeometry, w: number, h: number, d: number, tile: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x −x +y −y +z −z
  for (let i = 0; i < uv.count; i++) { const [a, b] = dims[Math.floor(i / 4)]; uv.setXY(i, uv.getX(i) * a / tile, uv.getY(i) * b / tile); }
}
const UP = V(0, 1, 0);

// the colours behind HOMERIS's doors at the very end: a turning kaleidoscope, added over the hall's back wall
const COLOURS_F = /* glsl */ `uniform float uTime, uK; varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * vec2(1.35, 1.0);
  float r = length(p), a = atan(p.y, p.x);
  float s = 6.2831853 / 8.0, ak = abs(mod(a + uTime * 0.12, s) - s * 0.5);
  vec2 q = vec2(cos(ak), sin(ak)) * r;
  float f = sin(q.x * 22.0 - uTime * 3.0) * sin(q.y * 19.0 + uTime * 1.7) + sin(r * 30.0 - uTime * 4.0);
  vec3 c = 0.55 + 0.45 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + f * 0.12 + r * 0.8 - uTime * 0.3));
  gl_FragColor = vec4(c * (1.0 + 0.7 * exp(-r * 3.0)) * uK, 1.0);
}`;
class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(m: THREE.Material, g: THREE.BufferGeometry) { const a = this.parts.get(m); if (a) a.push(g); else this.parts.set(m, [g]); return g; }
  box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, o: { ry?: number; tile?: number } = {}) {
    const g = new THREE.BoxGeometry(w, h, d); if (o.tile) tileBox(g, w, h, d, o.tile);
    if (o.ry) g.rotateY(o.ry); g.translate(x, y, z); return this.add(m, g);
  }
  /** a box standing on y0 */
  block(m: THREE.Material, w: number, h: number, d: number, x: number, y0: number, z: number, o: { ry?: number; tile?: number } = {}) { return this.box(m, w, h, d, x, y0 + h / 2, z, o); }
  plane(m: THREE.Material, w: number, h: number, x: number, y: number, z: number, o: { ry?: number; rx?: number; tile?: number } = {}) {
    const g = new THREE.PlaneGeometry(w, h); if (o.tile) scaleUV(g, w / o.tile, h / o.tile);
    if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry); g.translate(x, y, z); return this.add(m, g);
  }
  /** flat ground, tiled in metres */
  ground(m: THREE.Material, x0: number, z0: number, x1: number, z1: number, y: number, tile: number, ry = 0) {
    const w = x1 - x0, d = z1 - z0; const g = new THREE.PlaneGeometry(w, d); scaleUV(g, w / tile, d / tile);
    g.rotateX(-Math.PI / 2); if (ry) g.rotateY(ry); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); return this.add(m, g);
  }
  /** a strip of ground of width w from a to b */
  strip(m: THREE.Material, ax: number, az: number, bx: number, bz: number, w: number, y: number, tile: number) {
    const L = Math.hypot(bx - ax, bz - az); const g = new THREE.PlaneGeometry(w, L); scaleUV(g, w / tile, L / tile);
    g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(bx - ax, bz - az)); g.translate((ax + bx) / 2, y, (az + bz) / 2); return this.add(m, g);
  }
  disc(m: THREE.Material, r: number, x: number, y: number, z: number, tile: number, seg = 24) {
    const g = new THREE.CircleGeometry(r, seg); scaleUV(g, 2 * r / tile, 2 * r / tile); g.rotateX(-Math.PI / 2); g.translate(x, y, z); return this.add(m, g);
  }
  cyl(m: THREE.Material, rt: number, rb: number, h: number, x: number, y0: number, z: number, seg = 8) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y0 + h / 2, z); return this.add(m, g); }
  ball(m: THREE.Material, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 10) { const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)); g.scale(sx, sy, sz); g.translate(x, y, z); return this.add(m, g); }
  /** a limb from a to b, tapering */
  limb(m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 5) {
    const d = b.clone().sub(a), L = d.length(); const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, true); g.translate(0, L / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize())); g.translate(a.x, a.y, a.z); return this.add(m, g);
  }
  build(into: THREE.Object3D) {
    for (const [m, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, m); mesh.matrixAutoUpdate = false; mesh.frustumCulled = true; into.add(mesh);
      for (const g of list) g.dispose();
    }
    this.parts.clear();
  }
}

// ---- textures -------------------------------------------------------------------------------------------------------
function T(w: number, h: number, seed: number, draw: (g: CanvasRenderingContext2D, R: () => number) => void, repeat = true) {
  const [c, g] = canvas(w, h); draw(g, rng(seed)); return toTex(c, repeat);
}
const shade = (hex: string, k: number) => { const n = parseInt(hex.slice(1), 16); return rgba(Math.min(255, (n >> 16) * k), Math.min(255, ((n >> 8) & 255) * k), Math.min(255, (n & 255) * k)); };

/** a façade painted in metres (y up from the ground), with a second canvas for what glows at night */
class FP {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; ce: HTMLCanvasElement; e: CanvasRenderingContext2D; R: () => number;
  constructor(public W: number, public H: number, public S: number, seed: number, wall: string) {
    const [c, g] = canvas(Math.round(W * S), Math.round(H * S)); const [ce, e] = canvas(c.width, c.height);
    this.c = c; this.g = g; this.ce = ce; this.e = e; this.R = rng(seed);
    g.fillStyle = wall; g.fillRect(0, 0, c.width, c.height); e.fillStyle = '#000'; e.fillRect(0, 0, c.width, c.height);
  }
  X(x: number) { return x * this.S; }
  Y(y: number) { return (this.H - y) * this.S; }
  rect(x: number, y: number, w: number, h: number, col: string, ctx = this.g) { ctx.fillStyle = col; ctx.fillRect(this.X(x), this.Y(y + h), w * this.S, h * this.S); }
  glow(x: number, y: number, w: number, h: number, col: string) { this.rect(x, y, w, h, col, this.e); }
  vgrad(x: number, y: number, w: number, h: number, top: string, bot: string, ctx = this.g) { const gr = ctx.createLinearGradient(0, this.Y(y + h), 0, this.Y(y)); gr.addColorStop(0, top); gr.addColorStop(1, bot); ctx.fillStyle = gr; ctx.fillRect(this.X(x), this.Y(y + h), w * this.S, h * this.S); }
  text(s: string, x: number, y: number, size: number, col: string, o: { align?: CanvasTextAlign; weight?: number; font?: string; glow?: string; spacing?: number; stroke?: string; sw?: number } = {}) {
    const draw = (ctx: CanvasRenderingContext2D, fill: string, stroke?: string) => {
      ctx.font = `${o.weight ?? 900} ${Math.round(size * this.S)}px ${o.font ?? FONT}`; ctx.textAlign = o.align ?? 'left'; ctx.textBaseline = 'alphabetic';
      const ls = (ctx as unknown as { letterSpacing?: string });
      if (o.spacing) ls.letterSpacing = `${(o.spacing * this.S).toFixed(1)}px`;
      if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = (o.sw ?? 0.12) * this.S; ctx.strokeStyle = stroke; ctx.strokeText(s, this.X(x), this.Y(y)); }
      ctx.fillStyle = fill; ctx.fillText(s, this.X(x), this.Y(y));
      if (o.spacing) ls.letterSpacing = '0px';
    };
    draw(this.g, col, o.stroke);
    if (o.glow) draw(this.e, o.glow);
  }
  grime(n: number, col: [number, number, number] = [28, 26, 22], a = 0.1, r = 1.2) { for (let i = 0; i < n; i++) blotch(this.g, this.R, this.R() * this.c.width, this.R() * this.c.height, (0.3 + this.R()) * r * this.S, col, a, 5); }
  /** rain runs under a sill */
  runs(x: number, y: number, w: number, len: number, a = 0.16) {
    for (let i = 0; i < 4; i++) { const xx = this.X(x + this.R() * w), L = len * (0.4 + this.R() * 0.6); const gr = this.g.createLinearGradient(0, this.Y(y), 0, this.Y(y - L)); gr.addColorStop(0, rgba(25, 23, 20, a)); gr.addColorStop(1, rgba(25, 23, 20, 0)); this.g.fillStyle = gr; this.g.fillRect(xx, this.Y(y), Math.max(1, this.S * 0.06), L * this.S); }
  }
  win(x: number, y: number, w: number, h: number, o: { frame?: string; glass?: string; fw?: number; mull?: number; tran?: number; bars?: string; lit?: string; blind?: number; sill?: string; runs?: boolean } = {}) {
    const fw = o.fw ?? 0.07, fr = o.frame ?? '#d8d3c5';
    this.rect(x - fw, y - fw, w + 2 * fw, h + 2 * fw, fr);
    const base = o.glass ?? '#161b22';
    this.vgrad(x, y, w, h, shade(base, 1.9), shade(base, 0.85));
    // a soft diagonal sheen: the sky in the glass
    const g = this.g; g.save(); g.beginPath(); g.rect(this.X(x), this.Y(y + h), w * this.S, h * this.S); g.clip();
    g.fillStyle = 'rgba(150,170,200,0.07)'; g.beginPath(); const sx = this.X(x + w * (0.1 + this.R() * 0.5)); g.moveTo(sx, this.Y(y + h)); g.lineTo(sx + w * this.S * 0.35, this.Y(y + h)); g.lineTo(sx - w * this.S * 0.2, this.Y(y)); g.lineTo(sx - w * this.S * 0.55, this.Y(y)); g.fill(); g.restore();
    if (o.blind) this.rect(x, y + h * (1 - o.blind), w, h * o.blind, 'rgba(190,184,168,0.55)');
    if (o.lit) { this.glow(x, y, w, h, o.lit); if (o.blind) this.glow(x, y + h * (1 - o.blind), w, h * o.blind, 'rgba(0,0,0,0.5)'); }
    if (o.mull) for (let i = 1; i < o.mull; i++) { this.rect(x + w * i / o.mull - 0.025, y, 0.05, h, fr); }
    if (o.tran) this.rect(x, y + h - o.tran, w, 0.05, fr);
    if (o.bars) for (let bx = x + 0.1; bx < x + w - 0.02; bx += 0.13) { this.rect(bx, y, 0.025, h, o.bars); }
    if (o.sill) this.rect(x - fw - 0.04, y - fw - 0.08, w + 2 * fw + 0.08, 0.08, o.sill);
    if (o.runs) this.runs(x, y - fw - 0.08, w, 1.4);
  }
  done() { return { map: toTex(this.c), emap: toTex(this.ce) }; }
}

function leafTex(seed: number, tint: [number, number, number], dense = 1) {
  const [c, g] = canvas(256, 256); const R = rng(seed);
  g.clearRect(0, 0, 256, 256);
  // clumps of small leaves inside a ragged round edge
  const clumps = 5 + Math.floor(R() * 3);
  for (let k = 0; k < clumps; k++) {
    const cx = 128 + (R() - 0.5) * 120, cy = 128 + (R() - 0.5) * 120, cr = 34 + R() * 40;
    for (let i = 0; i < 520 * dense; i++) {
      const a = R() * Math.PI * 2, r = Math.pow(R(), 0.55) * cr; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.85;
      const v = 0.55 + R() * 0.7;
      g.fillStyle = rgba(tint[0] * v, tint[1] * v, tint[2] * v, 1);
      g.beginPath(); g.ellipse(x, y, 1.6 + R() * 3.4, 0.9 + R() * 1.8, R() * 3, 0, Math.PI * 2); g.fill();
    }
  }
  return toTex(c);
}
function barkTex(seed: number) {
  return T(64, 128, seed, (g, R) => {
    g.fillStyle = '#4a433a'; g.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 70; i++) { g.fillStyle = rgba(30 + R() * 30, 27 + R() * 26, 22 + R() * 20, 0.6); g.fillRect(R() * 64, R() * 128, 1 + R() * 2, 6 + R() * 26); }
    noise(g, R, 64, 128, 22);
  });
}
function skyTex(seed: number, glow: [number, number, number]) {
  const [c, g] = canvas(512, 256); const R = rng(seed);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#020308'); gr.addColorStop(0.3, '#060a12'); gr.addColorStop(0.46, rgba(glow[0] * 0.55, glow[1] * 0.55, glow[2] * 0.55)); gr.addColorStop(0.5, rgba(glow[0], glow[1], glow[2]));
  gr.addColorStop(0.52, '#08090a'); gr.addColorStop(1, '#040404');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  // low cloud, lit from below by the parts of the city that still have light
  for (let i = 0; i < 150; i++) { const y = 18 + R() * 108; const k = Math.pow(y / 128, 1.6); blotch(g, R, R() * 512, y, 16 + R() * 46, [12 + glow[0] * k, 13 + glow[1] * k, 18 + glow[2] * k], 0.13, 6); }
  for (let i = 0; i < 60; i++) { g.fillStyle = rgba(190, 200, 225, 0.2 + R() * 0.4); g.fillRect(R() * 512, R() * 60, 1, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** a ring of hills: dark ridges against the sky, with the lights of houses on their sides */
function hillsTex(seed: number, lights: number, warm: number) {
  const W = 2048, H = 160; const [c, g] = canvas(W, H); const R = rng(seed);
  g.clearRect(0, 0, W, H);
  const ridge = (base: number, amp: number, col: string, freq: number) => {
    const ys: number[] = []; let y = base, v = 0;
    for (let x = 0; x <= W; x += 4) { v += (R() - 0.5) * amp * 0.5; v *= 0.93; y += v + Math.sin(x * freq) * amp * 0.05; y = Math.max(base - amp * 3, Math.min(base + amp, y)); ys.push(y); }
    // make it wrap round
    const n = ys.length; for (let i = 0; i < 40; i++) { const k = i / 40; ys[n - 1 - i] = ys[n - 1 - i] * k + ys[i] * (1 - k); }
    g.fillStyle = col; g.beginPath(); g.moveTo(0, H); ys.forEach((yy, i) => g.lineTo(i * 4, yy)); g.lineTo(W, H); g.closePath(); g.fill();
    return ys;
  };
  ridge(70, 14, '#0b0e13', 0.004);
  const near = ridge(104, 12, '#05070a', 0.007);
  // houses on the slopes: warm where there is light, a cold one now and then
  for (let i = 0; i < lights; i++) {
    const x = Math.floor(R() * W); const top = near[Math.min(near.length - 1, Math.floor(x / 4))];
    const y = top + 4 + Math.pow(R(), 1.4) * (H - top - 8);
    const w = R() < warm ? [255, 196, 120] : [200, 220, 255];
    g.fillStyle = rgba(w[0], w[1], w[2], 0.5 + R() * 0.5); g.fillRect(x, y, R() < 0.2 ? 2 : 1, 1);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
/** a far city of dark blocks with a few windows */
function cityTex(seed: number, lit: number, warm: number) {
  return T(128, 128, seed, (g, R) => {
    g.fillStyle = '#0d0e10'; g.fillRect(0, 0, 128, 128);
    for (let y = 4; y < 128; y += 8) for (let x = 3; x < 128; x += 7) {
      if (R() < lit) { const w = R() < warm ? [255, 190, 110] : [190, 210, 255]; g.fillStyle = rgba(w[0], w[1], w[2], 0.35 + R() * 0.5); }
      else g.fillStyle = rgba(24, 26, 30, 1);
      g.fillRect(x, y, 3, 4);
    }
  });
}

// ---- the things in the sets ---------------------------------------------------------------------------------------
interface TreeKind { h: number; crown: number; crownH: number; trunk: number; branches: number; leaves: number; flat?: boolean; bare?: boolean; size?: number }
function tree(k: Kit, bark: THREE.Material, leaves: THREE.Material[], x: number, z: number, R: () => number, o: TreeKind) {
  const base = V(x, 0, z);
  const h0 = o.h * (o.flat ? 0.27 : 0.42);
  const lean = V((R() - 0.5) * 0.5, h0, (R() - 0.5) * 0.5);
  const top = base.clone().add(lean);
  k.limb(bark, base, top, o.trunk, o.trunk * 0.78, 7);
  // a root flare
  k.cyl(bark, o.trunk * 0.9, o.trunk * 1.35, 0.5, x, 0, z, 7);
  const tips: THREE.Vector3[] = [];
  for (let i = 0; i < o.branches; i++) {
    const a = (i / o.branches) * Math.PI * 2 + R() * 0.8;
    const el = o.flat ? 0.28 + R() * 0.28 : 0.55 + R() * 0.45;
    const L = o.crown * (0.6 + R() * 0.45);
    const d = V(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    const mid = top.clone().addScaledVector(d, L * 0.55);
    k.limb(bark, top, mid, o.trunk * 0.62, o.trunk * 0.4, 5);
    for (let j = 0; j < 2; j++) {
      const a2 = a + (j ? 0.45 : -0.45) + (R() - 0.5) * 0.4, el2 = el + (R() - 0.3) * 0.5;
      const d2 = V(Math.cos(a2) * Math.cos(el2), Math.sin(el2) + (o.flat ? 0.15 : 0), Math.sin(a2) * Math.cos(el2)).normalize();
      const tip = mid.clone().addScaledVector(d2, L * (0.45 + R() * 0.3));
      k.limb(bark, mid, tip, o.trunk * 0.36, o.trunk * 0.12, 4);
      tips.push(tip);
      if (o.bare) for (let q = 0; q < 3; q++) { const t2 = tip.clone().add(V((R() - 0.5) * 2.4, 0.6 + R() * 1.8, (R() - 0.5) * 2.4)); k.limb(bark, tip, t2, o.trunk * 0.1, 0.02, 3); }
    }
  }
  if (o.bare) return;
  // the crown: leafy cards around the tips and through the volume, lying mostly flat (an umbrella) or tossed
  const cy = top.y + o.crownH * 0.55;
  for (let i = 0; i < o.leaves; i++) {
    let p: THREE.Vector3;
    if (i < tips.length * 3) { const t = tips[i % tips.length]; p = t.clone().add(V((R() - 0.5) * 2.2, (R() - 0.3) * 1.4, (R() - 0.5) * 2.2)); }
    else { const a = R() * Math.PI * 2, r = Math.sqrt(R()) * o.crown; p = V(top.x + Math.cos(a) * r, cy + (R() - 0.5) * o.crownH * (1 - 0.5 * r / o.crown), top.z + Math.sin(a) * r); }
    const s = (o.size ?? 4) * (0.7 + R() * 0.6);
    const g = new THREE.PlaneGeometry(s, s);
    g.rotateX(-Math.PI / 2 + (o.flat ? (R() - 0.5) * 0.9 : (R() - 0.5) * 2.6)); g.rotateZ((R() - 0.5) * (o.flat ? 0.8 : 2.4)); g.rotateY(R() * Math.PI * 2);
    g.translate(p.x, p.y, p.z);
    k.add(leaves[i % leaves.length], g);
  }
}

function car(k: Kit, m: { body: THREE.Material; glass: THREE.Material; tyre: THREE.Material; lamp?: THREE.Material }, x: number, z: number, ry: number, L = 4.3, W = 1.75) {
  const parts: [number, number, number, number, number, number, THREE.Material][] = [
    [L, 0.62, W, 0, 0.62, 0, m.body],
    [L * 0.52, 0.5, W * 0.9, -L * 0.04, 1.17, 0, m.glass],
    [L * 0.5, 0.06, W * 0.86, -L * 0.04, 1.44, 0, m.body],
  ];
  const c = Math.cos(ry), s = Math.sin(ry);
  for (const [w, h, d, px, py, pz, mat] of parts) k.box(mat, w, h, d, x + px * c + pz * s, py, z - px * s + pz * c, { ry });
  for (const [px, pz] of [[L * 0.32, W / 2 - 0.1], [L * 0.32, -W / 2 + 0.1], [-L * 0.32, W / 2 - 0.1], [-L * 0.32, -W / 2 + 0.1]]) {
    const g = new THREE.CylinderGeometry(0.31, 0.31, 0.2, 10); g.rotateX(Math.PI / 2); g.rotateY(ry); g.translate(x + px * c + pz * s, 0.31, z - px * s + pz * c); k.add(m.tyre, g);
  }
}

// ---- rain: streaks round the camera that show where there is light ------------------------------------------------
const RAIN_V = /* glsl */ `
attribute float aSeed; attribute float aEnd; uniform vec3 uCam; uniform float uTime; uniform vec3 uL[4]; uniform float uI[4]; uniform float uFlash;
varying float vA;
void main(){
  // each drop keeps its place in the world (wrapped round the camera) and falls through 14 m
  float fall = fract(position.y - uTime * (0.8 + aSeed * 0.3));
  vec2 xz = position.xz * 15.0;
  vec2 rel = (fract((xz - uCam.xz) / 30.0 + 0.5) - 0.5) * 30.0;
  vec3 w = vec3(uCam.x + rel.x, uCam.y - 4.0 + fall * 14.0, uCam.z + rel.y);
  w.y += aEnd * 0.42; w.x += aEnd * 0.03;
  float a = 0.01 + uFlash * 0.16;
  for (int i = 0; i < 4; i++) { float d = distance(w, uL[i]); a += uI[i] * 0.8 / (1.0 + d * d * 0.2); }
  a *= smoothstep(2.5, 7.0, distance(w, uCam));
  vA = min(a, 0.32);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const RAIN_F = /* glsl */ `varying float vA; void main(){ gl_FragColor = vec4(0.78, 0.84, 0.95, vA); }`;
class Rain {
  mesh: THREE.LineSegments; mat: THREE.ShaderMaterial;
  constructor(n = 1400) {
    const pos = new Float32Array(n * 6), seed = new Float32Array(n * 2), end = new Float32Array(n * 2); const R = rng(77);
    for (let i = 0; i < n; i++) {
      const x = R() * 2 - 1, z = R() * 2 - 1, y = R(), s = R();
      pos.set([x, y, z, x, y, z], i * 6); seed[i * 2] = s; seed[i * 2 + 1] = s; end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({ vertexShader: RAIN_V, fragmentShader: RAIN_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uFlash: { value: 0 }, uL: { value: [V(0, -99, 0), V(0, -99, 0), V(0, -99, 0), V(0, -99, 0)] }, uI: { value: [0, 0, 0, 0] } } });
    this.mesh = new THREE.LineSegments(g, this.mat); this.mesh.frustumCulled = false; this.mesh.visible = false;
  }
}

// ---- the camera for the set scenes: eased eye, aim and roll, and a held-by-hand drift -----------------------------
export class ShotCam {
  eye = V(0, 1.6, 0); look = V(0, 1.6, -1); up = V(0, 1, 0); fov = 60;
  tEye = V(0, 1.6, 0); tLook = V(0, 1.6, -1); tUp = V(0, 1, 0); tFov = 60;
  kEye = 4; kLook = 4; kUp = 4; kFov = 2; hand = 0.5; roll = 0; shake = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  snap() { this.eye.copy(this.tEye); this.look.copy(this.tLook); this.up.copy(this.tUp); this.fov = this.tFov; }
  apply(cam: THREE.PerspectiveCamera, dt: number, t: number, reduced: boolean) {
    const ex = (k: number) => 1 - Math.exp(-k * dt);
    this.eye.lerp(this.tEye, ex(this.kEye)); this.look.lerp(this.tLook, ex(this.kLook)); this.up.lerp(this.tUp, ex(this.kUp)).normalize();
    this.fov += (this.tFov - this.fov) * ex(this.kFov);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    cam.position.copy(this.eye); this.m.lookAt(this.eye, this.look, this.up); cam.quaternion.setFromRotationMatrix(this.m);
    const h = (reduced ? 0.4 : 1) * 0.0045 * this.hand, s = reduced ? this.shake * 0.25 : this.shake;
    const nx = h * (Math.sin(t * 1.31) * 0.6 + Math.sin(t * 2.93 + 1) * 0.3 + Math.sin(t * 0.71 + 2) * 0.5) + (Math.random() - 0.5) * s * 0.05;
    const ny = h * (Math.sin(t * 1.07 + 3) * 0.6 + Math.sin(t * 2.31) * 0.3) + (Math.random() - 0.5) * s * 0.05;
    this.q.setFromEuler(this.e.set(nx, ny, this.roll + h * 0.4 * Math.sin(t * 0.53), 'YXZ')); cam.quaternion.multiply(this.q);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }
}

// ---- the sets -------------------------------------------------------------------------------------------------------
interface Saved { o: THREE.Light; parent: THREE.Object3D | null; pos: THREE.Vector3; color: THREE.Color; intensity: number; distance: number; decay: number; angle?: number; penumbra?: number; shadow?: boolean; ground?: THREE.Color }

export class Exterior {
  group = new THREE.Group();
  sj = new THREE.Group(); hm = new THREE.Group();
  which: SetName | null = null;
  flash = 0;                         // lightning right now (0..1)
  /** the HOMERIS entrance: two glass leaves that slide apart */
  hmDoors: { l: THREE.Object3D; r: THREE.Object3D; k: number; want: number; inside: THREE.MeshBasicMaterial; colours: THREE.ShaderMaterial };
  /** the main doors of the San Jorge (swing in) */
  sjDoor: THREE.Object3D;
  /** the window where somebody holds a candle */
  sjWindow: { fig: THREE.Mesh; glow: THREE.Mesh; on: boolean };
  sjBeacon: THREE.MeshBasicMaterial[] = [];
  hmSign: THREE.MeshLambertMaterial | null = null;
  hmTV: THREE.MeshLambertMaterial | null = null;
  private skyM: THREE.MeshBasicMaterial[] = [];
  private rain = new Rain();
  private saved: Saved[] = [];
  private fogSave = { color: new THREE.Color(), density: 0.06, far: 70, bg: new THREE.Color() };
  private dustVis = true; private torchVis = true;
  private t = 0;

  constructor(private G: Game) {
    this.group.add(this.sj, this.hm, this.rain.mesh);
    this.sj.position.copy(SJ0); this.hm.position.copy(HM0);
    const glint = G.tex.glint;
    const built = this.buildSJ(glint);
    this.sjDoor = built.door; this.sjWindow = built.win;
    this.hmDoors = this.buildHM(glint);
    this.sj.visible = false; this.hm.visible = false;
    G.scene.add(this.group);
  }

  /** world position of a point in a set */
  at(set: SetName, x: number, y: number, z: number, out = new THREE.Vector3()) { return out.set(x, y, z).add(set === 'sj' ? SJ0 : HM0); }

  warm(on: boolean) { this.sj.visible = on; this.hm.visible = on; this.rain.mesh.visible = on; }
  /** send every texture of both sets to the GPU at load, so the first frame outside doesn't stall */
  upload(r: THREE.WebGLRenderer) {
    const seen = new Set<THREE.Texture>();
    this.group.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material & { map?: THREE.Texture; emissiveMap?: THREE.Texture } | undefined;
      if (!m) return;
      for (const t of [m.map, m.emissiveMap]) if (t && !seen.has(t)) { seen.add(t); r.initTexture(t); }
    });
  }

  // ---- San Jorge: Carrera 4, the hospital's front and the Parque Gaitán --------------------------------------------
  private buildSJ(glint: THREE.Texture) {
    const k = new Kit(), R = rng(501);
    const asphalt = lam({ map: T(256, 256, 11, (g, r) => { g.fillStyle = '#2a2b2c'; g.fillRect(0, 0, 256, 256); noise(g, r, 256, 256, 24); for (let i = 0; i < 50; i++) blotch(g, r, r() * 256, r() * 256, 8 + r() * 24, r() < 0.6 ? [16, 17, 19] : [60, 60, 58], 0.16, 6); for (let i = 0; i < 700; i++) { const v = 70 + r() * 70; g.fillStyle = rgba(v, v, v, 0.3); g.fillRect(r() * 256, r() * 256, 1, 1); } }) });
    const pavers = lam({ map: T(256, 256, 12, (g, r) => {
      g.fillStyle = '#3a1e16'; g.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 16; row++) for (let col = -1; col < 9; col++) {
        const x = col * 32 + (row % 2) * 16, y = row * 16, kk = r() < 0.07 ? 0.72 : 1;
        g.fillStyle = rgba((124 + r() * 36) * kk, (54 + r() * 20) * kk, (36 + r() * 14) * kk); g.fillRect(x + 1, y + 1, 30, 14);
      }
      noise(g, r, 256, 256, 18); for (let i = 0; i < 36; i++) blotch(g, r, r() * 256, r() * 256, 6 + r() * 16, [26, 18, 14], 0.14, 5);
    }) });
    const grass = lam({ map: T(128, 128, 13, (g, r) => { g.fillStyle = '#1b2614'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 1500; i++) { const v = r(); g.fillStyle = rgba(26 + v * 40, 40 + v * 52, 18 + v * 20, 0.6); g.fillRect(r() * 128, r() * 128, 1, 2 + r() * 2); } for (let i = 0; i < 10; i++) blotch(g, r, r() * 128, r() * 128, 8 + r() * 14, [50, 42, 28], 0.14, 5); }) });
    const walk = lam({ map: T(256, 256, 14, (g, r) => { g.fillStyle = '#5f5d58'; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = 92 + r() * 22; g.fillStyle = rgba(v, v * 0.98, v * 0.94); g.fillRect(x * 64 + 1, y * 64 + 1, 62, 62); } noise(g, r, 256, 256, 16); for (let i = 0; i < 18; i++) blotch(g, r, r() * 256, r() * 256, 6 + r() * 18, [38, 36, 32], 0.14, 5); }) });
    const brick = lam({ map: T(128, 128, 15, (g, r) => { g.fillStyle = '#5a2a1e'; g.fillRect(0, 0, 128, 128); for (let row = 0; row < 16; row++) for (let col = -1; col < 5; col++) { const x = col * 32 + (row % 2) * 16; g.fillStyle = rgba(132 + r() * 30, 58 + r() * 16, 40 + r() * 12); g.fillRect(x + 1, row * 8 + 1, 30, 6); } noise(g, r, 128, 128, 16); }) });
    const concrete = lam({ color: 0x8c8a84 });
    const dark = lam({ color: 0x15171a });
    const white = lam({ color: 0xd6d4cc });
    const paint = (col: number) => lam({ color: col, emissive: 0x000000 });
    const lineW = lam({ color: 0xcfcdc4 }), lineY = lam({ color: 0xc9a227 });
    const bronze = lam({ color: 0x4a4636, emissive: 0x060504 });
    const bark = lam({ map: barkTex(16) });
    const leaves = [lam({ map: leafTex(17, [38, 56, 30]), alphaTest: 0.5, side: THREE.DoubleSide }), lam({ map: leafTex(18, [30, 48, 28], 0.9), alphaTest: 0.5, side: THREE.DoubleSide }), lam({ map: leafTex(19, [46, 60, 34], 1.1), alphaTest: 0.5, side: THREE.DoubleSide })];
    const tyre = lam({ color: 0x0c0c0c }), glassCar = lam({ color: 0x0d1116 });

    // ground: the street, the walks, the park
    k.ground(lam({ color: 0x101112 }), -260, -260, 260, 260, -0.03, 50);
    k.ground(asphalt, -95, -4.5, 95, 4.5, 0, 4);
    for (let x = -94; x < 94; x += 6) k.ground(lineW, x, -0.06, x + 3, 0.06, 0.006, 3);
    for (let z = -4; z <= 4; z += 1) k.ground(lineW, -8.6, z - 0.25, -5.4, z + 0.25, 0.007, 3); // the zebra at the main doors
    k.box(walk, 102, 0.15, 3.5, -44, 0.075, -6.25, { tile: 2 });   // the hospital's walk, broken by the ambulance bay
    k.box(walk, 71, 0.15, 3.5, 54.5, 0.075, -6.25, { tile: 2 });
    k.ground(asphalt, 7, -8, 19, -4.5, 0.01, 4);
    k.box(pavers, 190, 0.15, 2.0, 0, 0.075, 5.5, { tile: 1.6 });     // the park's walk along the street
    k.box(concrete, 190, 0.17, 0.18, 0, 0.085, 4.55);
    k.box(concrete, 102, 0.17, 0.18, -44, 0.085, -4.55); k.box(concrete, 71, 0.17, 0.18, 54.5, 0.085, -4.55);
    k.ground(grass, -38, 6.5, 22, 62, 0.13, 3);
    k.ground(pavers, -38, 6.5, 22, 10.5, 0.152, 1.6);                // the strip where the bust stands
    k.ground(pavers, -10.5, 10.5, -5.5, 26, 0.152, 1.6);             // the walk in to the round
    k.disc(pavers, 9, -8, 0.153, 34, 1.6, 28);
    k.ground(pavers, -10.5, 42, -5.5, 62, 0.152, 1.6);
    k.strip(pavers, -8, 34, -35, 11, 3, 0.151, 1.6); k.strip(pavers, -8, 34, 19, 11, 3, 0.151, 1.6);
    k.strip(pavers, -8, 34, -35, 59, 3, 0.151, 1.6); k.strip(pavers, -8, 34, 19, 59, 3, 0.151, 1.6);
    k.ground(pavers, -38, 59.5, 22, 62, 0.152, 1.6);
    // the pool in the round (dry-dark water)
    k.block(concrete, 7.4, 0.42, 0.25, -8, 0.15, 32.1); k.block(concrete, 7.4, 0.42, 0.25, -8, 0.15, 35.9); k.block(concrete, 0.25, 0.42, 3.6, -11.6, 0.15, 34); k.block(concrete, 0.25, 0.42, 3.6, -4.4, 0.15, 34);
    k.ground(lam({ color: 0x07101a, emissive: 0x02060a }), -11.5, 32.2, -4.5, 35.8, 0.36, 4);

    // Gaitán on his brick column, looking into the park, his back to the hospital
    const BX = -8, BZ = 12.4;
    k.block(brick, 2.8, 0.22, 2.8, BX, 0.15, BZ, { tile: 1 }); k.block(brick, 2.0, 0.22, 2.0, BX, 0.37, BZ, { tile: 1 });
    k.block(brick, 0.82, 2.05, 0.82, BX, 0.59, BZ, { tile: 1 });
    k.block(concrete, 1.02, 0.12, 1.02, BX, 2.64, BZ);
    k.block(lam({ color: 0x7c7a72 }), 0.52, 0.14, 0.44, BX, 2.76, BZ);
    k.box(bronze, 0.5, 0.36, 0.02, BX, 1.5, BZ + 0.42);                                          // the plaque
    { // the bust: chest and shoulders in a jacket, the neck, the head with its hair combed back
      const by = 2.9;
      const chest = new THREE.CylinderGeometry(0.25, 0.32, 0.46, 14); chest.scale(1, 1, 0.58); chest.translate(BX, by + 0.23, BZ); k.add(bronze, chest);
      k.ball(bronze, 0.3, BX, by + 0.44, BZ, 1.08, 0.36, 0.6, 14);                                // the shoulders
      k.cyl(bronze, 0.075, 0.09, 0.16, BX, by + 0.48, BZ + 0.01, 10);
      k.ball(bronze, 0.135, BX, by + 0.75, BZ + 0.015, 0.86, 1.12, 0.98, 14);                      // the head
      k.ball(bronze, 0.14, BX, by + 0.8, BZ - 0.025, 0.9, 0.9, 0.95, 12);                          // the hair, back
      k.ball(bronze, 0.035, BX, by + 0.72, BZ + 0.14, 0.9, 1.2, 0.8, 8);                           // the nose
      for (const s of [-1, 1]) { const lap = new THREE.BoxGeometry(0.1, 0.3, 0.03); lap.rotateZ(s * 0.5); lap.translate(BX + s * 0.08, by + 0.3, BZ + 0.18); k.add(bronze, lap); }
    }

    // the trees: big old ones on the street side, one nearly bare
    const big: TreeKind = { h: 16, crown: 7.5, crownH: 6, trunk: 0.45, branches: 6, leaves: 70, size: 4.2 };
    const med: TreeKind = { h: 11, crown: 4.8, crownH: 4.5, trunk: 0.3, branches: 5, leaves: 40, size: 3.4 };
    const spots: [number, number, TreeKind][] = [
      [-28, 14, big], [-18.5, 17.5, { ...big, h: 18, crown: 8 }], [3.5, 15, { ...big, bare: true, branches: 7 }], [14, 13, big], [-31, 27, med], [10, 26, med],
      [-34, 42, big], [15, 40, big], [-21, 51, big], [5, 52, med], [-13, 45, med], [17, 57, { ...big, h: 14 }], [-2, 22, { ...med, h: 9 }], [-36, 57, med],
    ];
    for (const [x, z, o] of spots) tree(k, bark, leaves, x, z, R, o);

    // the kiosks along the street, shut
    const kiosk = (() => { const p = new FP(2, 2.4, 64, 31, '#c8c2b4');
      p.rect(0, 0, 2, 1.05, '#9a231d'); p.rect(0, 1.05, 2, 0.06, '#e9e4d8');
      for (let x = 0.1; x < 1.9; x += 0.09) p.rect(x, 1.2, 0.03, 0.9, 'rgba(70,70,72,0.5)'); // the shutter's ribs
      p.rect(0.08, 1.15, 1.84, 0.02, '#5d5d5d'); p.text('TINTO · AROMÁTICA', 1, 2.22, 0.15, '#9a231d', { align: 'center', weight: 800 });
      p.text('EMPANADAS', 1, 0.62, 0.22, '#f2eee4', { align: 'center' }); p.grime(18, [30, 24, 20], 0.12, 0.25);
      return lam({ map: p.done().map }); })();
    for (const [x, z] of [[-22, 8.3], [6.5, 8.4]]) { k.block(kiosk, 2, 2.3, 1.5, x, 0.15, z); k.block(lam({ color: 0x8a1c18 }), 2.2, 0.08, 1.7, x, 2.45, z); }

    // benches and the park's lamps (dead tonight)
    const wood = lam({ color: 0x3b2a1c });
    for (const [x, z, ry] of [[-11.8, 18, Math.PI / 2], [-4.2, 21, Math.PI / 2], [-15, 30, 1.1], [-1, 38, 1.1], [-11.8, 49, Math.PI / 2], [-26, 9, 0], [-14, 9, 0], [12, 9.2, 0]] as [number, number, number][]) {
      k.box(concrete, 0.3, 0.42, 0.4, x - Math.cos(ry) * 0.7, 0.36, z + Math.sin(ry) * 0.7, { ry }); k.box(concrete, 0.3, 0.42, 0.4, x + Math.cos(ry) * 0.7, 0.36, z - Math.sin(ry) * 0.7, { ry });
      k.box(wood, 1.8, 0.07, 0.45, x, 0.6, z, { ry });
    }
    const pole = lam({ color: 0x263028 }), globe = lam({ color: 0x55585a, emissive: 0x000000 });
    for (const [x, z] of [[-11.5, 24], [-4.5, 24], [-17, 34], [1, 34], [-11.5, 44], [-4.5, 44], [-30, 10], [14, 10]]) { k.cyl(pole, 0.06, 0.09, 4.4, x, 0.15, z, 6); k.box(pole, 0.34, 0.08, 0.34, x, 4.6, z); k.block(globe, 0.3, 0.42, 0.3, x, 4.64, z); k.box(pole, 0.38, 0.06, 0.38, x, 5.1, z); }
    // the street's lamps on concrete poles
    for (const x of [-64, -42, -20, 2, 24, 46]) { k.cyl(concrete, 0.1, 0.16, 9, x, 0.15, 5.2, 6); k.box(concrete, 0.12, 0.12, 2.2, x, 9.0, 4.2); k.box(lam({ color: 0x3c3e40 }), 0.4, 0.14, 0.7, x, 8.9, 3.1); }
    const sodium = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.6), new THREE.MeshBasicMaterial({ color: 0xffa040 })); sodium.position.set(-64, 8.82, 3.1); this.sj.add(sodium);
    const sodHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glint, color: 0xff9a40, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.85 })); sodHalo.scale.setScalar(4.5); sodHalo.position.set(-64, 8.7, 3.1); this.sj.add(sodHalo);

    // motorbikes left by the park
    const mb = lam({ color: 0x1d1f22 }), mbr = lam({ color: 0x6a1714 });
    for (const [x, i] of [[-17, 0], [-15.8, 1], [-14.6, 2]] as [number, number][]) {
      const ry = 0.5; const c = Math.cos(ry), s = Math.sin(ry), z = 3.7;
      for (const d of [-0.62, 0.62]) { const g = new THREE.TorusGeometry(0.3, 0.07, 6, 12); g.rotateY(Math.PI / 2 + ry); g.translate(x + d * c, 0.36, z - d * s); k.add(tyre, g); }
      k.box(i === 1 ? mbr : mb, 1.0, 0.36, 0.28, x, 0.72, z, { ry }); k.box(mb, 0.6, 0.12, 0.3, x - 0.25 * c, 0.97, z + 0.25 * s, { ry });
    }

    // ---- the hospital's front (z = −8, facing the park) ------------------------------------------------------------
    const fac = (p: FP, x0: number, y0: number, zf: number, emissive = 1) => {
      const { map, emap } = p.done();
      const m = lam({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: emissive });
      k.plane(m, p.W, p.H, x0 + p.W / 2, y0 + p.H / 2, zf);
      return m;
    };
    const side = (col: number) => lam({ color: col });
    // A: the old building from the forties, five floors of windows
    {
      const p = new FP(28, 18, 20, 41, '#c9c0a8');
      p.rect(0, 0, 28, 1.25, '#7d796f');
      for (let f = 0; f < 5; f++) {
        const y = 1.6 + f * 3.25; p.rect(0, y - 0.32, 28, 0.2, '#ada38b');
        for (let c = 0; c < 10; c++) { const x = 1.0 + c * 2.75; const r = p.R(); p.win(x, y, 1.35, 1.95, { frame: '#e4dfd2', glass: r < 0.1 ? '#06080a' : '#151a20', mull: 2, tran: 0.45, blind: r > 0.7 ? 0.4 + p.R() * 0.4 : 0, sill: '#bdb5a0', runs: true, lit: f === 2 && c === 6 ? 'rgba(160,24,18,0.55)' : undefined }); }
      }
      p.rect(0, 17.4, 28, 0.6, '#b3a98f'); p.grime(70, [40, 36, 28], 0.09, 1.6);
      fac(p, -58, 0.15, -7.99); k.block(side(0xbdb49c), 28, 18, 14, -44, 0.15, -15.01);
    }
    // B: an ochre wing with ribbon windows
    {
      const p = new FP(16, 12, 20, 42, '#a35d2b');
      for (let f = 0; f < 3; f++) { const y = 1.2 + f * 3.7; for (let x = 0.6; x < 15.4; x += 1.25) p.win(x, y, 1.15, 1.7, { frame: '#3a3633', glass: '#121820', fw: 0.04 }); p.rect(0, y + 2.1, 16, 0.25, '#8f4f22'); }
      for (let x = 0; x < 16; x += 1.6) p.rect(x, 0, 0.03, 12, 'rgba(60,30,12,0.35)'); // panel joints
      p.grime(40, [40, 24, 12], 0.1, 1.2);
      fac(p, -30, 0.15, -7.99); k.block(side(0x94552a), 16, 12, 12, -22, 0.15, -14.01);
    }
    // C: the main entrance — ochre cladding, the big glass, the green stone, the round sign
    {
      const p = new FP(14, 16, 32, 43, '#a8612c');
      for (let y = 0; y < 16; y += 0.9) for (let x = 0; x < 14; x += 1.2) { const v = 0.92 + p.R() * 0.14; p.rect(x + 0.02, y + 0.02, 1.16, 0.86, shade('#a8612c', v)); }
      // ground floor: recessed lobby, glass and steel
      p.rect(0, 0, 14, 3.7, '#2c2a28');
      for (let x = 0.4; x < 13.6; x += 1.6) p.win(x, 0.05, 1.45, 3.4, { frame: '#9a9a96', glass: '#0d1014', fw: 0.05, tran: 0.6, lit: x > 5 && x < 9 ? 'rgba(120,16,12,0.45)' : 'rgba(90,10,8,0.18)' });
      // the curtain wall
      const gx = 3.4, gw = 6.6, gy = 4.1, gh = 9.6;
      p.vgrad(gx, gy, gw, gh, '#3a4656', '#161c24');
      for (let i = 0; i < 26; i++) { const yy = gy + p.R() * gh; p.rect(gx, yy, gw, 0.06 + p.R() * 0.2, 'rgba(120,140,170,0.07)'); } // sky caught in the panes
      for (let x = gx; x <= gx + gw + 0.01; x += gw / 5) p.rect(x - 0.05, gy, 0.1, gh, '#1d1f21');
      for (let y = gy; y <= gy + gh + 0.01; y += gh / 8) p.rect(gx, y - 0.04, gw, 0.08, '#1d1f21');
      // green stone with white veins
      const sx = gx + gw + 0.2;
      p.rect(sx, gy - 0.4, 1.5, gh + 0.4, '#2d5444');
      const g = p.g; g.strokeStyle = 'rgba(220,230,220,0.35)'; g.lineWidth = 1;
      for (let i = 0; i < 26; i++) { g.beginPath(); let xx = p.X(sx + p.R() * 1.5), yy = p.Y(gy + p.R() * gh); g.moveTo(xx, yy); for (let s = 0; s < 6; s++) { xx += (p.R() - 0.5) * 14; yy += (p.R() - 0.3) * 12; g.lineTo(xx, yy); } g.stroke(); }
      // the band at the top: the round sign and the name
      p.rect(0, 13.9, 14, 2.1, '#9b5626');
      const cx = p.X(1.6), cy = p.Y(14.95), r = 0.82 * p.S;
      for (const [ctx, ring, fill] of [[p.g, '#ece6d8', '#2f6b4f'], [p.e, 'rgba(0,0,0,0)', 'rgba(0,0,0,0)']] as [CanvasRenderingContext2D, string, string][]) {
        ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2); ctx.fill();
      }
      p.g.fillStyle = '#ece6d8'; p.g.beginPath(); p.g.arc(cx, cy - r * 0.18, r * 0.2, 0, Math.PI * 2); p.g.fill(); p.g.fillRect(cx - r * 0.09, cy, r * 0.18, r * 0.42); // a figure in the round
      p.text('HOSPITAL UNIVERSITARIO', 2.75, 15.05, 0.48, '#ece6d8', { weight: 800 });
      p.text('SAN JORGE', 2.75, 14.3, 0.62, '#ece6d8', { weight: 900 });
      p.grime(30, [50, 30, 14], 0.08, 1);
      for (let x = 0.4; x < 13.6; x += 1.6) { const w = Math.min(1.45, 13.9 - x); p.g.clearRect(p.X(x), p.Y(3.45), w * p.S, 3.4 * p.S); p.e.clearRect(p.X(x), p.Y(3.45), w * p.S, 3.4 * p.S); }
      { const { map, emap } = p.done(); k.plane(lam({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: 1.2, alphaTest: 0.5 }), 14, 16, -7, 8.15, -7.2); }
      k.block(side(0x9b5a29), 14, 12.3, 14, -7, 3.85, -14.21); k.block(side(0x9b5a29), 14, 3.7, 7.9, -7, 0.15, -17.26);
      // the lobby behind the glass: dark, red from one battery lamp on the back wall
      const lobbyTex = T(128, 128, 49, (g, r) => { g.fillStyle = '#4a4744'; g.fillRect(0, 0, 128, 128); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = 70 + r() * 14; g.fillStyle = rgba(v, v * 0.97, v * 0.94); g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30); } noise(g, r, 128, 128, 12); });
      const lobby = new THREE.Mesh(new THREE.BoxGeometry(13.6, 3.7, 6), lam({ map: lobbyTex, side: THREE.BackSide }));
      scaleUV(lobby.geometry, 4, 1.5); lobby.position.set(-7, 2.0, -10.3); this.sj.add(lobby);
      const furn = lam({ color: 0x2a2a2c });
      k.block(furn, 3.2, 1.1, 0.8, -11.2, 0.15, -11.6); k.block(lam({ color: 0x8a8580 }), 3.3, 0.06, 0.9, -11.2, 1.25, -11.6);   // the information desk
      for (let i = 0; i < 4; i++) { k.block(furn, 0.5, 0.45, 0.5, -3.6 + i * 0.62, 0.15, -9.6); k.block(furn, 0.5, 0.5, 0.08, -3.6 + i * 0.62, 0.6, -9.85); } // a row of chairs
      k.block(lam({ color: 0x6a5a4c }), 0.6, 3.6, 0.6, -6.0, 0.15, -10.8);                                                        // a column
      k.box(new THREE.MeshBasicMaterial({ color: 0xff2a18 }), 0.34, 0.09, 0.08, -7.2, 3.3, -13.22);                            // the battery lamp
      { const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glint, color: 0xff3a22, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 })); h.scale.setScalar(1.1); h.position.set(-7.2, 3.28, -13.1); this.sj.add(h); }
      // the glass in front of it (the door has its own)
      const glassM = lam({ color: 0x1b222b, transparent: true, opacity: 0.42, depthWrite: false });
      k.plane(glassM, 6.4, 3.4, -14 + 0.4 + 3.2, 1.9, -7.215); k.plane(glassM, 5.4, 3.4, -14 + 8.4 + 2.7, 1.9, -7.215);
      // the canopy over the doors
      k.box(lam({ color: 0x6a6a66 }), 13, 0.22, 2.4, -7, 3.95, -6.0); k.box(lam({ color: 0x2a2a2a }), 13, 0.08, 2.3, -7, 3.82, -6.0);
      for (const x of [-13.2, -0.8]) k.cyl(lam({ color: 0x7a7a76 }), 0.09, 0.09, 3.7, x, 0.15, -4.95, 8);
    }
    // the door you will push: a glass leaf on a hinge at x −7.9
    const door = new THREE.Object3D(); door.position.set(-7.2, 0.2, -7.2); this.sj.add(door);
    { const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.45, 3.35, 0.04), lam({ color: 0x1b222b, transparent: true, opacity: 0.42, depthWrite: false })); leaf.position.set(0.725, 1.68, 0); door.add(leaf);
      const fr = lam({ color: 0x8e8e8a }); for (const [w, h, x, y] of [[1.45, 0.06, 0.725, 0.03], [1.45, 0.06, 0.725, 3.33], [0.06, 3.35, 0.03, 1.68], [0.06, 3.35, 1.42, 1.68]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), fr); b.position.set(x, y, 0); door.add(b); }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.06), fr); bar.position.set(1.25, 1.15, 0.07); door.add(bar); }
    // the candle in the curtain wall, and who holds it (only at the first flash)
    const fig = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.5), new THREE.MeshBasicMaterial({ map: (() => { const [c, g] = canvas(64, 112); g.fillStyle = '#000'; g.beginPath(); g.ellipse(32, 30, 12, 14, 0, 0, Math.PI * 2); g.fill(); g.fillRect(17, 14, 30, 7); g.beginPath(); g.moveTo(22, 16); g.lineTo(42, 16); g.lineTo(38, 6); g.lineTo(26, 6); g.fill(); g.beginPath(); g.moveTo(10, 112); g.quadraticCurveTo(12, 54, 32, 46); g.quadraticCurveTo(52, 54, 54, 112); g.fill(); return toTex(c, false); })(), transparent: true, alphaTest: 0.5, fog: false }));
    fig.position.set(-8.6, 9.75, -7.16); this.sj.add(fig);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.15), new THREE.MeshBasicMaterial({ color: 0xff9a48, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, map: glint }));
    glow.position.set(-8.75, 9.55, -7.18); this.sj.add(glow);
    // D: the yellow block with the round sign on white
    {
      const p = new FP(6, 13, 24, 44, '#c08b3a');
      for (let f = 0; f < 3; f++) for (const x of [0.6, 3.4]) p.win(x, 1.4 + f * 3.8, 2.0, 1.8, { frame: '#e6e0cf', glass: '#141a22', sill: '#d7cfb8', runs: true });
      p.rect(1.6, 9.2, 2.8, 2.8, '#ebe7dd');
      p.g.fillStyle = '#2f6b4f'; p.g.beginPath(); p.g.arc(p.X(3), p.Y(10.95), 0.75 * p.S, 0, Math.PI * 2); p.g.fill();
      p.g.fillStyle = '#ebe7dd'; p.g.beginPath(); p.g.arc(p.X(3), p.Y(11.15), 0.17 * p.S, 0, Math.PI * 2); p.g.fill(); p.g.fillRect(p.X(2.92), p.Y(10.98), 0.16 * p.S, 0.4 * p.S);
      p.text('HOSPITAL UNIVERSITARIO', 3, 9.7, 0.2, '#2f4a3c', { align: 'center', weight: 800 }); p.text('SAN JORGE', 3, 9.4, 0.24, '#2f4a3c', { align: 'center' });
      p.grime(26, [50, 34, 14], 0.1, 1);
      fac(p, 0, 0.15, -7.99); k.block(side(0xb38236), 6, 13, 12, 3, 0.15, -14.01);
    }
    // E: Urgencias — a low white front behind the ambulance bay, its canopy lettered in red
    {
      const p = new FP(18, 8, 24, 45, '#d4d1c8');
      p.rect(0, 0, 18, 0.5, '#8d8a82');
      p.win(1.2, 0.5, 3.6, 2.8, { frame: '#9b9b98', glass: '#121a20', mull: 2, lit: 'rgba(150,180,200,0.55)' }); // the sliding doors, lit by the generator
      for (let x = 6; x < 17; x += 2.2) p.win(x, 1.1, 1.6, 1.6, { frame: '#c8c4b8', glass: '#141a20', bars: '#55575a' });
      for (let x = 0.8; x < 17; x += 2.2) p.win(x, 4.9, 1.6, 1.6, { frame: '#c8c4b8', glass: '#141a20', sill: '#bdb8aa', runs: true });
      p.grime(40, [40, 38, 32], 0.08, 1.2);
      fac(p, 6, 0.15, -7.99, 1.1); k.block(side(0xc6c3ba), 18, 8, 12, 15, 0.15, -14.01);
      // the canopy on its two columns
      k.box(white, 13, 0.35, 4.2, 13, 4.3, -6.0);
      const fp = new FP(13, 0.9, 48, 46, '#e2e0d9'); fp.text('URGENCIAS', 6.5, 0.2, 0.62, '#a5221b', { align: 'center', spacing: 0.08 }); fp.grime(10, [40, 38, 32], 0.1, 0.4);
      k.plane(lam({ map: fp.done().map }), 13, 0.9, 13, 4.5, -3.89);
      k.box(white, 13, 0.9, 0.2, 13, 4.5, -4.0);
      for (const x of [7, 19]) k.cyl(white, 0.16, 0.16, 4.2, x, 0.0, -4.3, 10);
    }
    // F: the yellow buildings on east, and the tall blocks behind
    {
      const p = new FP(36, 11, 16, 47, '#c99c45');
      for (let f = 0; f < 3; f++) for (let x = 0.8; x < 35; x += 2.4) p.win(x, 1.3 + f * 3.3, 1.5, 1.6, { frame: '#efe9d8', glass: '#141a22', sill: '#ddd3bb', runs: true });
      p.grime(50, [50, 36, 16], 0.09, 1.4);
      fac(p, 24, 0.15, -7.99); k.block(side(0xb68c3e), 36, 11, 12, 42, 0.15, -14.01);
    }
    {
      const p = new FP(34, 27, 12, 48, '#b9b2a0');
      for (let f = 0; f < 8; f++) for (let x = 1; x < 33; x += 2.1) p.win(x, 1.6 + f * 3.2, 1.3, 1.6, { frame: '#d6d0c0', glass: '#10141a', fw: 0.06, lit: (f === 5 && x > 20 && x < 23) || (f === 2 && x < 3) ? 'rgba(150,20,14,0.6)' : undefined });
      p.grime(60, [40, 36, 30], 0.08, 2);
      fac(p, -24, 0.15, -21.0); k.block(side(0xa8a190), 34, 27, 14, -7, 0.15, -28.01);
      k.block(side(0x9c9583), 26, 20, 14, 30, 0.15, -30);
    }

    // the ambulance in the bay, its light bar turning
    {
      const body = (() => { const p = new FP(5.4, 2.3, 40, 51, '#e8e7e2'); p.rect(0, 0.75, 5.4, 0.28, '#c4221a'); p.rect(0, 1.06, 5.4, 0.08, '#e86b1c'); p.text('AMBULANCIA', 2.9, 1.42, 0.36, '#c4221a', { align: 'center' }); p.rect(3.9, 1.3, 1.4, 0.75, '#141a20'); p.grime(10, [60, 60, 56], 0.1, 0.4); return lam({ map: p.done().map }); })();
      const X = 13, Z = -6.1;
      k.block(body, 5.4, 2.3, 2.2, X, 0.35, Z);
      k.block(white, 1.2, 1.4, 2.1, X - 3.2, 0.35, Z);
      k.box(glassCar, 0.05, 0.7, 1.8, X - 3.82, 1.55, Z);
      for (const [dx, dz] of [[-2.6, 1], [-2.6, -1], [1.7, 1], [1.7, -1]]) { const g = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 12); g.rotateX(Math.PI / 2); g.translate(X + dx, 0.38, Z + dz * 1.0); k.add(tyre, g); }
      const red = new THREE.MeshBasicMaterial({ color: 0x300000 }), red2 = new THREE.MeshBasicMaterial({ color: 0x300000 });
      this.sjBeacon = [red, red2];
      for (const [i, dz] of [[0, -0.55], [1, 0.55]] as [number, number][]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.7), i ? red2 : red); m.position.set(X - 2.45, 2.78, Z + dz); this.sj.add(m); }
      k.box(lam({ color: 0xe6e6e6 }), 0.36, 0.06, 1.6, X - 2.45, 2.66, Z);
    }

    // the city round the park: brick buildings, a shop shutter, here and there a candle
    const brickFront = (w: number, h: number, seed: number) => {
      const p = new FP(w, h, 14, seed, '#7d3925');
      const g = p.g; for (let y = 0; y < h * p.S; y += 3) { g.fillStyle = 'rgba(40,16,10,0.25)'; g.fillRect(0, y, w * p.S, 1); }
      noise(g, p.R, p.c.width, p.c.height, 12);
      p.rect(0, 0, w, 3.2, '#5f5f60'); for (let x = 0.2; x < w; x += 0.18) p.rect(x, 0.2, 0.04, 2.8, 'rgba(30,30,32,0.5)');
      const floors = Math.floor((h - 3.5) / 3);
      for (let f = 0; f < floors; f++) for (let x = 0.8; x < w - 1.4; x += 2.6) { const lit = p.R() < 0.06 ? 'rgba(255,150,60,0.7)' : undefined; p.win(x, 4.0 + f * 3, 1.5, 1.6, { frame: '#e8e4da', glass: '#10141a', fw: 0.08, lit, blind: lit ? 0.5 : 0 }); if (p.R() < 0.4) p.rect(x - 0.3, 3.7 + f * 3, 2.1, 0.12, '#2e2c2a'); }
      p.grime(30, [30, 16, 10], 0.1, 1.2);
      return p;
    };
    let seed = 60;
    for (const [x0, w, h] of [[-46, 14, 13], [-32, 18, 16], [-14, 12, 11], [-2, 16, 14], [14, 14, 12]] as [number, number, number][]) { const p = brickFront(w, h, seed++); const { map, emap } = p.done(); k.plane(lam({ map, emissiveMap: emap, emissive: 0xffffff }), w, h, x0 + w / 2, h / 2, 63.99, { ry: Math.PI }); k.block(side(0x6a3020), w, h, 12, x0 + w / 2, 0, 70.01); }
    for (const [z0, w, h] of [[8, 16, 12], [24, 20, 15], [44, 18, 13]] as [number, number, number][]) { const p = brickFront(w, h, seed++); const { map, emap } = p.done(); k.plane(lam({ map, emissiveMap: emap, emissive: 0xffffff }), w, h, -45.99, h / 2, z0 + w / 2, { ry: Math.PI / 2 }); k.block(side(0x6a3020), 12, h, w, -52.01, 0, z0 + w / 2); }
    k.block(lam({ color: 0x4a4d50 }), 26, 9, 40, 44, 0, 32); // the police block on the far side of Calle 25
    // far town: low dark blocks with a few lit windows (other sectors still have power)
    const town = lam({ map: cityTex(52, 0.05, 0.75), emissiveMap: cityTex(52, 0.05, 0.75), emissive: 0xffffff, emissiveIntensity: 0.9 });
    for (let i = 0; i < 70; i++) { const a = R() * Math.PI * 2, r = 95 + R() * 120; const w = 10 + R() * 20, h = 6 + R() * 26; k.block(town, w, h, w, Math.cos(a) * r, 0, Math.sin(a) * r, { ry: R() * 3, tile: 16 }); }

    k.build(this.sj);
    this.sky(this.sj, [78, 58, 44], 91, 260, 0.6);
    return { door, win: { fig, glow, on: true } };
  }

  // ---- HOMERIS: the Avenida 30 de Agosto, the parking and the white front with its turquoise bands -----------------
  private buildHM(glint: THREE.Texture) {
    const k = new Kit(), R = rng(601);
    const asphalt = lam({ map: T(256, 256, 21, (g, r) => { g.fillStyle = '#3b3c3d'; g.fillRect(0, 0, 256, 256); noise(g, r, 256, 256, 22); for (let i = 0; i < 40; i++) blotch(g, r, r() * 256, r() * 256, 8 + r() * 24, r() < 0.5 ? [20, 20, 22] : [64, 64, 62], 0.14, 6); }) });
    const grass = lam({ map: T(128, 128, 22, (g, r) => { g.fillStyle = '#1c2714'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 1500; i++) { const v = r(); g.fillStyle = rgba(28 + v * 42, 44 + v * 54, 20 + v * 20, 0.6); g.fillRect(r() * 128, r() * 128, 1, 2 + r() * 2); } }) });
    const concrete = lam({ color: 0x8e8c86 });
    const lineW = lam({ color: 0xd2d0c8 }), lineY = lam({ color: 0xd1a52a });
    const white = lam({ color: 0xe2e5e2 }), turq = lam({ color: 0x1fb3a4 }), roof = lam({ color: 0x3a3c3d });
    const bark = lam({ map: barkTex(23) });
    const leaves = [lam({ map: leafTex(24, [34, 54, 28], 1.2), alphaTest: 0.5, side: THREE.DoubleSide }), lam({ map: leafTex(25, [28, 46, 26], 1.1), alphaTest: 0.5, side: THREE.DoubleSide })];
    const tyre = lam({ color: 0x0c0c0c }), glassCar = lam({ color: 0x0e1218 });

    // ground
    k.ground(lam({ color: 0x0f120e }), -260, -260, 260, 260, -0.03, 50);
    k.ground(asphalt, -40, -14, 66, -3, 0.01, 4);                 // the parking
    for (let x = -28; x < 62; x += 2.7) if (x < -12 || x > -4) k.ground(lineW, x - 0.06, -13.2, x + 0.06, -8.2, 0.016, 2);
    k.ground(lineY, -12, -13.4, -4.6, -13.25, 0.017, 2); k.ground(lineY, -12, -9.2, -4.6, -9.05, 0.017, 2);
    for (let x = -11.5; x < -4.6; x += 0.9) k.strip(lineY, x, -13.2, x + 0.9, -9.25, 0.12, 0.017, 2);
    k.box(concrete, 7.4, 0.14, 1.4, -8.3, 0.07, -13.3);            // the step at the doors
    k.ground(asphalt, -260, -3, 260, 3.5, 0, 4);                   // the service road
    k.box(concrete, 520, 0.16, 0.2, 0, 0.08, 3.5);
    k.ground(grass, -260, 3.6, 260, 14, 0.12, 3);
    k.box(concrete, 520, 0.16, 0.2, 0, 0.08, 14);
    k.ground(asphalt, -260, 14, 260, 22, 0, 4);                    // the avenue, one way
    for (let x = -258; x < 258; x += 9) k.ground(lineW, x, 17.94, x + 4.5, 18.06, 0.006, 3);
    k.box(concrete, 520, 0.2, 0.2, 0, 0.1, 22); k.ground(grass, -260, 22, 260, 27, 0.14, 3); k.box(concrete, 520, 0.2, 0.2, 0, 0.1, 27);
    k.ground(asphalt, -260, 27, 260, 35, 0, 4);                    // and the other
    for (let x = -258; x < 258; x += 9) k.ground(lineW, x, 30.94, x + 4.5, 31.06, 0.006, 3);
    k.ground(grass, -260, 35, 260, 60, 0.1, 3);

    // A: the two-storey front with the big lettering
    const fac = (p: FP, x0: number, y0: number, zf: number, ei = 1) => { const { map, emap } = p.done(); const m = lam({ map, emissiveMap: emap, emissive: 0xffffff, emissiveIntensity: ei }); k.plane(m, p.W, p.H, x0 + p.W / 2, y0 + p.H / 2, zf); return m; };
    {
      const p = new FP(32, 9.6, 26, 61, '#e7ebe8');
      p.rect(0, 0, 32, 0.4, '#8a8c88');
      p.rect(0, 3.35, 32, 0.38, '#1fb3a4'); p.rect(0, 9.2, 32, 0.4, '#1fb3a4');
      for (let x = 0.9; x < 31; x += 3.0) {
        const inDoor = x > 14.5 && x < 19.5;
        if (!inDoor) { const r = p.R(); p.win(x, 1.0, 1.7, 1.75, { frame: '#1fb3a4', glass: '#121a1e', fw: 0.09, bars: '#d9dcd8', blind: r < 0.5 ? 0.6 : 0, lit: r < 0.22 ? 'rgba(170,200,215,0.32)' : r < 0.3 ? 'rgba(220,190,140,0.28)' : undefined }); }
        { const r = p.R(); p.win(x, 4.35, 1.7, 1.7, { frame: '#1fb3a4', glass: '#121a1e', fw: 0.09, lit: r < 0.25 ? 'rgba(175,205,225,0.34)' : undefined, blind: r < 0.6 ? 0.5 : 0 }); }
      }
      // the entrance: a turquoise frame round a hole (the doors and the hall behind are their own things)
      p.rect(15.3, 0, 4.4, 3.1, '#1fb3a4');
      p.text('HOSPITAL MENTAL UNIVERSITARIO DE RISARALDA', 9.8, 6.95, 0.36, '#13786c', { align: 'left', weight: 800 });
      p.grime(40, [40, 44, 42], 0.05, 1.4);
      p.g.clearRect(p.X(15.5), p.Y(2.95), 4.0 * p.S, 2.95 * p.S); p.e.clearRect(p.X(15.5), p.Y(2.95), 4.0 * p.S, 2.95 * p.S);
      { const { map, emap } = p.done(); k.plane(lam({ map, emissiveMap: emap, emissive: 0xffffff, alphaTest: 0.5 }), 32, 9.6, -10, 4.8, -13.99); }
      k.block(white, 15.5, 9.6, 12, -18.25, 0, -20.01); k.block(white, 12.5, 9.6, 12, -0.25, 0, -20.01); k.block(white, 4.0, 6.65, 12, -8.5, 2.95, -20.01);
      k.box(roof, 32.2, 0.1, 12.2, -10, 9.62, -20.01);
      // the lettering: its own lit plane above the windows
      const s = new FP(16, 2.2, 64, 62, 'rgba(0,0,0,0)');
      s.g.clearRect(0, 0, s.c.width, s.c.height);
      const g = s.g, cx = s.X(1.1), cy = s.Y(1.1), r = 0.95 * s.S;
      for (const ctx of [s.g, s.e]) { ctx.fillStyle = ctx === s.g ? '#eef3f1' : 'rgba(120,255,225,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
      g.fillStyle = '#138a70'; g.beginPath(); g.arc(cx, cy, r * 0.82, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#eef3f1'; g.beginPath(); g.arc(cx - r * 0.28, cy - r * 0.22, r * 0.17, 0, Math.PI * 2); g.arc(cx + r * 0.28, cy - r * 0.22, r * 0.17, 0, Math.PI * 2); g.fill(); g.fillRect(cx - r * 0.42, cy - r * 0.02, r * 0.84, r * 0.2); g.fillRect(cx - r * 0.42, cy, r * 0.22, r * 0.5); g.fillRect(cx + r * 0.2, cy, r * 0.22, r * 0.5);
      s.text('HOMERIS', 2.5, 0.42, 1.55, '#12876e', { weight: 900, stroke: '#eef3f1', sw: 0.22, glow: 'rgba(110,255,220,0.9)', spacing: 0.04 });
      const st = s.done();
      const sm = lam({ map: st.map, emissiveMap: st.emap, emissive: 0xffffff, emissiveIntensity: 1.1, transparent: true, alphaTest: 0.35 });
      this.hmSign = sm;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.2), sm); sign.position.set(-15.2, 8.0, -13.9); this.hm.add(sign);
      // the canopy over the doors
      k.box(turq, 6.0, 0.24, 1.7, -8.5, 3.25, -13.1); k.box(lam({ color: 0xdfe8e6, emissive: 0x9aa6a8 }), 5.6, 0.04, 1.5, -8.5, 3.12, -13.1);
    }
    // the doors: two glass leaves that slide apart; behind them a lit hall (a box seen from inside, a counter, a bench)
    const inside = new THREE.MeshBasicMaterial({ color: 0xbfd6dc, side: THREE.BackSide });
    const hall = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.95, 4.6), inside); hall.position.set(-8.5, 1.475, -16.3); this.hm.add(hall);
    { const cm = new THREE.MeshBasicMaterial({ color: 0x5f7a7c }); const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.05, 0.6), cm); counter.position.set(-9.2, 0.52, -17.6); this.hm.add(counter); const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.45), cm); bench.position.set(-7.4, 0.22, -16.8); this.hm.add(bench); }
    const colours = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uK: { value: 0 } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: COLOURS_F, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const cw = new THREE.Mesh(new THREE.PlaneGeometry(3.96, 2.9), colours); cw.position.set(-8.5, 1.47, -18.55); this.hm.add(cw);
    const leafM = lam({ color: 0x8fb8c0, emissive: 0x1c3236, transparent: true, opacity: 0.38 });
    const mk = (x: number) => { const o = new THREE.Object3D(); o.position.set(x, 0, -13.95); const l = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.9, 0.04), leafM); l.position.y = 1.45; o.add(l); const fr = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.06), turq); fr.position.y = 2.92; o.add(fr); this.hm.add(o); return o; };
    const dl = mk(-9.5), dr = mk(-7.5);
    // B: the turquoise stair tower
    {
      const p = new FP(5, 11, 26, 63, '#1fb3a4');
      for (let y = 1.2; y < 10; y += 1.6) { p.rect(1.6, y, 0.5, 1.2, '#e6eeec'); p.rect(2.9, y, 0.5, 1.2, '#e6eeec'); p.rect(1.68, y + 0.06, 0.34, 1.08, '#132022'); p.rect(2.98, y + 0.06, 0.34, 1.08, '#132022'); }
      p.rect(0, 10.6, 5, 0.4, '#e6eeec'); p.grime(16, [10, 40, 36], 0.08, 0.8);
      fac(p, 6, 0, -13.59); k.block(turq, 5, 11, 11, 8.5, 0, -19.1);
    }
    // C: the long wing to the east, with the name along it
    {
      const p = new FP(50, 7.4, 18, 64, '#e4e8e5');
      p.rect(0, 0, 50, 0.4, '#8a8c88'); p.rect(0, 6.8, 50, 0.6, '#1fb3a4'); p.rect(0, 3.4, 50, 0.22, '#1fb3a4');
      for (let x = 1.0; x < 49; x += 2.9) { { const r = p.R(), r2 = p.R(); p.win(x, 1.0, 1.6, 1.6, { frame: '#1fb3a4', glass: '#121a1e', fw: 0.08, bars: '#d9dcd8', blind: r < 0.5 ? 0.6 : 0, lit: r < 0.18 ? 'rgba(170,200,215,0.3)' : undefined }); p.win(x, 4.2, 1.6, 1.6, { frame: '#1fb3a4', glass: '#121a1e', fw: 0.08, blind: r2 < 0.6 ? 0.5 : 0, lit: r2 < 0.2 ? 'rgba(180,205,225,0.32)' : undefined }); } }
      p.rect(20, 2.75, 29, 0.55, '#e4e8e5');
      p.text('HOSPITAL MENTAL UNIVERSITARIO DE RISARALDA', 34.5, 2.86, 0.44, '#1d3b36', { align: 'center', weight: 800 });
      p.grime(50, [40, 44, 42], 0.05, 1.6);
      fac(p, 11, 0, -13.99);
      k.block(white, 50, 7.4, 11, 36, 0, -19.51); k.box(roof, 50.2, 0.1, 11.2, 36, 7.42, -19.51);
    }
    // the rest of the place behind, and the hill
    k.block(lam({ color: 0x9fa4a2 }), 30, 12, 16, -6, 0, -36); k.block(lam({ color: 0x8e9391 }), 24, 8, 18, 30, 0, -38);
    // the guard's booth in the grass, a television's blue in its window
    {
      const p = new FP(2.4, 2.6, 40, 65, '#7c8183');
      p.win(0.4, 1.0, 1.6, 1.0, { frame: '#d9dcd8', glass: '#0a1018', fw: 0.05, lit: 'rgba(70,100,200,0.34)', blind: 0.35 });
      p.rect(1.25, 1.0, 0.5, 0.55, '#05070a'); p.glow(1.25, 1.0, 0.5, 0.55, 'rgba(0,0,0,1)'); // somebody's back, in the chair
      p.rect(0, 2.4, 2.4, 0.2, '#5c6163'); p.grime(10, [30, 30, 30], 0.1, 0.4);
      const { map, emap } = p.done(); const m = lam({ map, emissiveMap: emap, emissive: 0xffffff }); this.hmTV = m;
      k.plane(m, 2.4, 2.6, -10.79, 1.3, 6.0, { ry: Math.PI / 2 }); k.block(lam({ color: 0x74797b }), 2.4, 2.6, 2.4, -12, 0, 6.0); k.box(roof, 2.8, 0.12, 2.8, -12, 2.66, 6.0);
    }
    // cars in the parking
    const silver = lam({ color: 0x8d9296 }), wine = lam({ color: 0x4a1418 }), whiteCar = lam({ color: 0xc9ccc9 });
    car(k, { body: silver, glass: glassCar, tyre }, -21, -10.6, Math.PI / 2);
    car(k, { body: wine, glass: glassCar, tyre }, 0.5, -10.4, Math.PI / 2 + 0.04);
    car(k, { body: whiteCar, glass: glassCar, tyre }, 17, -10.7, Math.PI / 2);
    // the samanes: wide umbrellas over the grass
    const saman: TreeKind = { h: 14, crown: 11, crownH: 3.6, trunk: 0.75, branches: 7, leaves: 150, flat: true, size: 5.2 };
    for (const [x, z] of [[-24, 7], [2, 8.5], [28, 7.5], [54, 8]] as [number, number][]) tree(k, bark, leaves, x, z, R, { ...saman, crown: 10 + R() * 2.5 });
    for (const [x, z] of [[-34, 44], [-4, 46], [24, 43], [52, 45], [-58, 9]] as [number, number][]) tree(k, bark, leaves, x, z, R, { ...saman, h: 12, crown: 8, leaves: 90 });
    // street lights: on the service road and down the median
    const poleM = lam({ color: 0x6c7072 }), head = new THREE.MeshBasicMaterial({ color: 0xe8f2ff }), headS = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    for (const [x, sod] of [[-36, false], [-16, false], [14, true], [44, false]] as [number, boolean][]) {
      k.cyl(poleM, 0.08, 0.13, 8.5, x, 0.12, 4.2, 6); k.box(poleM, 0.1, 0.1, 1.8, x, 8.45, 3.4);
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.7), sod ? headS : head); hd.position.set(x, 8.36, 2.6); this.hm.add(hd);
      const hl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glint, color: sod ? 0xffa050 : 0xd8e8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 })); hl.scale.setScalar(3.6); hl.position.set(x, 8.25, 2.6); this.hm.add(hl);
    }
    for (const x of [-40, 0, 40]) {
      k.cyl(poleM, 0.1, 0.15, 10, x, 0.14, 24.5, 6); k.box(poleM, 0.1, 0.1, 3.6, x, 9.95, 24.5);
      for (const dz of [-1.7, 1.7]) { const hd = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.7), head); hd.position.set(x, 9.86, 24.5 + dz); this.hm.add(hd); const hl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glint, color: 0xd8e8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.75 })); hl.scale.setScalar(3.4); hl.position.set(x, 9.75, 24.5 + dz); this.hm.add(hl); }
    }
    // the far side of the avenue: sheds and a fence, all dark
    const town = lam({ map: cityTex(66, 0.03, 0.5), emissiveMap: cityTex(66, 0.03, 0.5), emissive: 0xffffff, emissiveIntensity: 0.8 });
    for (let i = 0; i < 60; i++) { const a = R() * Math.PI * 2, r = 110 + R() * 110; const w = 12 + R() * 22, h = 5 + R() * 14; k.block(town, w, h, w, Math.cos(a) * r, 0, Math.sin(a) * r, { ry: R() * 3, tile: 16 }); }

    k.build(this.hm);
    this.sky(this.hm, [30, 38, 52], 92, 380, 0.35);
    return { l: dl, r: dr, k: 0, want: 0, inside, colours };
  }

  /** the dome and the ring of hills round a set */
  private sky(into: THREE.Group, glow: [number, number, number], seed: number, lights: number, warm: number) {
    const m = new THREE.MeshBasicMaterial({ map: skyTex(seed, glow), side: THREE.BackSide, fog: false, depthWrite: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), m); dome.renderOrder = -2; into.add(dome); this.skyM.push(m);
    const hm = new THREE.MeshBasicMaterial({ map: hillsTex(seed + 1, lights, warm), transparent: true, alphaTest: 0.5, side: THREE.BackSide, fog: false, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(330, 330, 110, 64, 1, true), hm); ring.position.y = 40; ring.renderOrder = -1; into.add(ring); this.skyM.push(hm);
  }

  // ---- while a scene is out here ---------------------------------------------------------------------------------
  /** go out: show the set, borrow the map's lights (and the emergency ones unless the finale holds them) */
  enter(which: SetName, borrowEm = true) {
    const G = this.G, P = G.player, sc = G.scene, fog = sc.fog as THREE.FogExp2;
    if (this.which) this.leave();
    this.which = which; this.t = 0;
    this.sj.visible = which === 'sj'; this.hm.visible = which === 'hm';
    this.fogSave = { color: fog.color.clone(), density: fog.density, far: G.camera.far, bg: (sc.background as THREE.Color).clone() };
    fog.color.setHex(which === 'sj' ? 0x0a0d12 : 0x0b1018); fog.density = which === 'sj' ? 0.017 : 0.011;
    (sc.background as THREE.Color).setHex(0x05070a);
    G.camera.far = 700; G.camera.updateProjectionMatrix();
    this.holdSave = G.props.hold; G.storm.external = true; G.props.hold = true;
    this.dustVis = G.dust.visible; G.dust.visible = false;
    this.torchVis = P.torchModel.visible; P.torchModel.visible = false;
    const save = (o: THREE.Light) => {
      const pl = o as THREE.PointLight, sl = o as THREE.SpotLight;
      this.saved.push({ o, parent: o.parent, pos: o.position.clone(), color: o.color.clone(), intensity: o.intensity, distance: pl.distance ?? 0, decay: pl.decay ?? 2, angle: sl.isSpotLight ? sl.angle : undefined, penumbra: sl.isSpotLight ? sl.penumbra : undefined, shadow: o.castShadow, ground: (o as THREE.HemisphereLight).isHemisphereLight ? (o as THREE.HemisphereLight).groundColor.clone() : undefined });
    };
    this.saved = [];
    const hemi = sc.children.find(c => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight; save(hemi);
    for (const l of G.props.lamps) save(l.light);
    for (const l of G.storm.lightsList()) save(l);
    if (G.props.candles.light) save(G.props.candles.light);
    save(P.light);
    if (borrowEm) { for (const e of G.props.em) save(e.light); save(P.bounce); }
    // the spot leaves the torch: it becomes the moon (San Jorge) or a floodlight on a pole (HOMERIS)
    this.tgtSave = { parent: P.lightTarget.parent, pos: P.lightTarget.position.clone() };
    this.group.add(P.light); this.group.add(P.lightTarget);
    for (const s of this.saved) if (!(s.o as THREE.HemisphereLight).isHemisphereLight && s.o !== P.light) { this.group.add(s.o); (s.o as THREE.PointLight).intensity = 0; }
    this.rain.mesh.visible = which === 'sj';
    this.hmDoors.k = 0; this.hmDoors.want = 0; this.hmDoors.l.position.x = -9.5; this.hmDoors.r.position.x = -7.5;
    this.sjDoor.rotation.y = 0;
    this.sjWindow.on = true;
    G.audio.exterior(which, which === 'sj' ? this.at('sj', 14, 1, -16) : undefined);
    this.update(0, 0);
  }
  private tgtSave: { parent: THREE.Object3D | null; pos: THREE.Vector3 } | null = null;
  private holdSave = false;

  leave() {
    if (!this.which) return;
    const G = this.G, P = G.player, sc = G.scene, fog = sc.fog as THREE.FogExp2;
    for (const s of this.saved) {
      const o = s.o as THREE.PointLight & THREE.SpotLight & THREE.HemisphereLight;
      if (s.parent) s.parent.add(o);
      o.position.copy(s.pos); o.color.copy(s.color); o.intensity = s.intensity;
      if (!o.isHemisphereLight) { o.distance = s.distance; o.decay = s.decay; }
      if (s.angle !== undefined) { o.angle = s.angle; o.penumbra = s.penumbra!; }
      if (s.ground) o.groundColor.copy(s.ground);
    }
    this.saved = [];
    if (this.tgtSave) { (this.tgtSave.parent ?? G.scene).add(P.lightTarget); P.lightTarget.position.copy(this.tgtSave.pos); this.tgtSave = null; }
    G.audio.exterior(null); G.audio.rain(0, 0);
    fog.color.copy(this.fogSave.color); fog.density = this.fogSave.density; (sc.background as THREE.Color).copy(this.fogSave.bg);
    G.camera.far = this.fogSave.far; G.camera.updateProjectionMatrix();
    G.storm.external = false; G.props.hold = this.holdSave; G.post.u.uFlash.value = 0;
    G.dust.visible = this.dustVis; P.torchModel.visible = this.torchVis;
    this.rain.mesh.visible = false;
    this.sj.visible = false; this.hm.visible = false; this.which = null;
  }

  /** the light plans, every frame */
  update(dt: number, t: number) {
    const G = this.G, w = this.which; if (!w) return;
    this.t += dt;
    const P = G.player, red = G.settings.reduced;
    const f = G.storm.flash; this.flash = f;
    const get = (o: THREE.Light) => o as THREE.PointLight;
    const hemi = this.saved.find(s => (s.o as THREE.HemisphereLight).isHemisphereLight)!.o as THREE.HemisphereLight;
    const lamps = G.props.lamps.map(l => l.light), storm = G.storm.lightsList(), candle = G.props.candles.light, em = G.props.em.map(e => e.light);
    const borrowedEm = this.saved.some(s => s.o === em[0]);
    const put = (l: THREE.PointLight | null | undefined, set: SetName, x: number, y: number, z: number, col: number, I: number, dist: number, decay = 2) => {
      if (!l) return; this.at(set, x, y, z, l.position); l.color.setHex(col); l.intensity = I; l.distance = dist; l.decay = decay;
    };
    const spot = P.light;
    if (w === 'sj') {
      hemi.color.setHex(0x1c2638); hemi.groundColor.setHex(0x0c0b0a); hemi.intensity = 0.4 + f * (red ? 0.8 : 2.4);
      // the moon, behind cloud, from over the park's south-west
      this.at('sj', -70, 80, 110, spot.position); this.at('sj', -6, 0, -8, P.lightTarget.position);
      spot.color.setHex(0x8ea4c8); spot.intensity = 0.62; spot.distance = 0; spot.decay = 0; spot.angle = 0.55; spot.penumbra = 1;
      // lightning: high over the park and over the hospital
      put(storm[0], 'sj', -12, 40, 30, 0xcad8ff, f * 3.2, 0, 0); put(storm[1], 'sj', 18, 36, -26, 0xcad8ff, f * 2.0, 0, 0);
      // the ambulance's light bar: two reds, turning
      const ph = this.t * 3.1;
      const b0 = Math.pow(Math.max(0, Math.sin(ph)), 3), b1 = Math.pow(Math.max(0, Math.sin(ph + Math.PI)), 3);
      const bk = red ? 0.5 : 1;
      if (borrowedEm) {
        put(em[0], 'sj', 10.55 + 1.2 * Math.sin(ph), 2.9, -6.65 + 2.2 * Math.cos(ph), 0xff1a10, 14 * b0 * bk, 26); put(em[1], 'sj', 10.55 - 1.2 * Math.sin(ph), 2.9, -5.55 - 2.2 * Math.cos(ph), 0xff1a10, 14 * b1 * bk, 26);
        put(em[2], 'sj', 9.2, 3.4, -6.4, 0xcfe2ff, 2.6, 9);                 // the generator's tube at Urgencias
        put(em[3], 'sj', -7.2, 3.0, -12.6, 0xff2a18, 6.5, 12);               // the red battery lamp in the lobby
        put(em[4], 'sj', -64, 8.5, 3.4, 0xff9440, 22, 30);                  // one street lamp on another circuit
        put(P.bounce, 'sj', 0, 0, 0, 0x8fa2c4, 0, 1);
      }
      for (let i = 0; i < 2; i++) this.sjBeacon[i].color.setRGB(0.2 + 3.0 * (i ? b1 : b0) * bk, 0.02, 0.02);
      // the candle in the window
      const cand = this.sjWindow.on ? 0.85 + 0.15 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3) : 0;
      put(lamps[0], 'sj', -8.7, 9.6, -8.2, 0xff9a48, 1.6 * cand, 6); put(lamps[1], 'sj', 0, -50, 0, 0, 0, 1);
      put(candle, 'sj', 0, -50, 0, 0, 0, 1);
      this.sjWindow.glow.visible = cand > 0; (this.sjWindow.glow.material as THREE.MeshBasicMaterial).opacity = 0.65 * cand;
      this.sjWindow.fig.visible = this.sjWindow.on;
      // the sky flashes with the strike
      for (const m of this.skyM) m.color.setScalar(1 + f * (red ? 1.5 : 4));
      G.post.u.uFlash.value = f * (red ? 0.2 : 0.45);
      G.audio.rain(0.75, 1);
    } else {
      hemi.color.setHex(0x283a56); hemi.groundColor.setHex(0x12150f); hemi.intensity = 0.78 + f * 0.8;
      // a floodlight on a pole across the service road, on the front and the lettering
      this.at('hm', -4, 10.5, 4, spot.position); this.at('hm', -10, 4.5, -14, P.lightTarget.position);
      spot.color.setHex(0xe2efff); spot.intensity = 420; spot.distance = 50; spot.decay = 2; spot.angle = 0.7; spot.penumbra = 0.9;
      put(storm[0], 'hm', 30, 0.6, -10.5, 0xdcecff, 14, 16);                 // a wash along the wing
      put(storm[1], 'hm', -16, 8.3, 2.6, 0xd2e4ff, 60, 26);                 // the street light by the parking
      put(lamps[0], 'hm', -10.2, 1.6, 6.0, 0x6a8dff, (0.9 + 0.6 * Math.sin(this.t * 9) * Math.sin(this.t * 5.3)) * 1.4, 6); // the guard's television
      put(lamps[1], 'hm', 14, 8.3, 2.6, 0xff9a48, 48, 24);                  // a sodium one further on
      put(candle, 'hm', -15, 8.6, -12.6, 0x52ffd8, 5.5, 10);                // the lettering's glow on the wall
      G.audio.rain(0, 0);
      if (borrowedEm) {
        put(em[0], 'hm', -8.5, 2.5, -12.6, 0xe8f4ff, 7, 11);                 // the light spilling from the hall
        put(em[1], 'hm', 0, 9.6, 24.5, 0xd2e4ff, 30, 26); put(em[2], 'hm', -40, 9.6, 24.5, 0xd2e4ff, 30, 26);
        put(em[3], 'hm', -36, 8.3, 2.6, 0xd2e4ff, 55, 26); put(em[4], 'hm', 44, 8.3, 2.6, 0xd2e4ff, 40, 24);
        put(P.bounce, 'hm', 0, -50, 0, 0, 0, 1);
      }
      const tv = this.hmTV; if (tv) tv.emissiveIntensity = 0.75 + 0.35 * Math.sin(this.t * 9) * Math.sin(this.t * 5.3);
      if (this.hmSign) this.hmSign.emissiveIntensity = 1.05 + (red ? 0 : 0.08 * Math.sin(this.t * 31) * (Math.sin(this.t * 0.7) > 0.93 ? 4 : 0));
      for (const m of this.skyM) m.color.setScalar(1 + f * 2);
      G.post.u.uFlash.value = f * 0.25;
      // the doors slide
      const D = this.hmDoors; D.k += (D.want - D.k) * Math.min(1, dt * 2.4);
      D.l.position.x = -9.5 - 1.9 * D.k; D.r.position.x = -7.5 + 1.9 * D.k;
    }
    // rain round the camera, lit where the lights are
    if (this.rain.mesh.visible) {
      const u = this.rain.mat.uniforms; u.uCam.value.copy(G.camera.position); u.uTime.value = this.t * 0.9; u.uFlash.value = f;
      const L = u.uL.value as THREE.Vector3[], I = u.uI.value as number[];
      const pick = [em[0], em[1], em[4], lamps[0]];
      pick.forEach((l, i) => { L[i].copy(l.position); I[i] = Math.min(1, l.intensity / 9); });
    }
    void t;
  }
}
