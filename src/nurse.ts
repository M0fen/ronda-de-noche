import { T } from './telemetry';
import * as THREE from 'three';
import { applySigil } from './sigil';
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Game } from './game';
import type { Locker, Lamp } from './props';
import { PATROL, AREAS } from './content';
import { rng } from './textures';

// ---------------------------------------------------------------------------
// Character asset contract (see README): assets/nurse.glb, humanoid, metres,
// Y-up, feet at origin, facing +Z, clips named below. The placeholder below
// honours the same contract so the real model is a drop-in swap.
export const CLIPS = ['idle', 'walk', 'walk_search', 'run', 'listen', 'turn_head', 'peek_locker', 'open_locker', 'grab', 'twitch'];
const ONCE = new Set(['open_locker', 'grab', 'twitch']);

export interface Rig {
  root: THREE.Group; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>;
  head: THREE.Object3D; glints: THREE.Sprite[]; morphs: { mesh: THREE.Mesh; dict: Record<string, number> }[]; source: 'glb' | 'placeholder';
  speedScale: Record<string, number>;
}

type K = [number, number, number, number];
function qt(bone: string, keys: K[]) {
  const e = new THREE.Euler(), q = new THREE.Quaternion(), v: number[] = [];
  for (const k of keys) { e.set(k[1], k[2], k[3]); q.setFromEuler(e); v.push(q.x, q.y, q.z, q.w); }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, keys.map(k => k[0]), v);
}
function pt(bone: string, x: number, z: number, keys: [number, number][]) {
  return new THREE.VectorKeyframeTrack(`${bone}.position`, keys.map(k => k[0]), keys.flatMap(k => [x, k[1], z]));
}

function placeholderClips(): THREE.AnimationClip[] {
  const W = 1.15, w2 = W / 2, w4 = W / 4;
  const walk = (name: string, D: number, headYaw: boolean) => new THREE.AnimationClip(name, D, [
    qt('ThighL', [[0, -0.34, 0, 0], [D / 2, 0.34, 0, 0], [D, -0.34, 0, 0]]),
    qt('ThighR', [[0, 0.34, 0, 0], [D / 2, -0.34, 0, 0], [D, 0.34, 0, 0]]),
    qt('ShinL', [[0, 0.08, 0, 0], [D * 0.25, 0.1, 0, 0], [D * 0.5, 0.15, 0, 0], [D * 0.75, 0.62, 0, 0], [D, 0.08, 0, 0]]),
    qt('ShinR', [[0, 0.15, 0, 0], [D * 0.25, 0.62, 0, 0], [D * 0.5, 0.08, 0, 0], [D * 0.75, 0.1, 0, 0], [D, 0.15, 0, 0]]),
    qt('ArmL', [[0, 0.1, 0, 0.1], [D / 2, -0.1, 0, 0.1], [D, 0.1, 0, 0.1]]),
    qt('ArmR', [[0, -0.32, 0, -0.08], [D / 2, -0.28, 0, -0.08], [D, -0.32, 0, -0.08]]),
    qt('ForeArmR', [[0, -0.5, 0, 0], [D, -0.5, 0, 0]]),
    qt('Spine', [[0, 0.07, 0, 0.03], [D / 2, 0.07, 0, -0.03], [D, 0.07, 0, 0.03]]),
    qt('Head', headYaw
      ? [[0, 0.05, 0.6, 0.14], [D, 0.05, -0.6, 0.14], [D * 2, 0.05, 0.6, 0.14]]
      : [[0, 0.06, 0, 0.16], [D / 2, 0.04, 0, 0.12], [D, 0.06, 0, 0.16]]),
    pt('Hips', 0, 0, [[0, 1.0], [D / 4, 1.025], [D / 2, 1.0], [D * 0.75, 1.025], [D, 1.0]]),
  ]);
  const clips = [
    walk('walk', W, false),
    (() => { const c = walk('walk_search', W * 1.25, true); c.duration = W * 2.5; return c; })(),
    new THREE.AnimationClip('run', 0.62, [
      qt('ThighL', [[0, -0.75, 0, 0], [0.31, 0.6, 0, 0], [0.62, -0.75, 0, 0]]),
      qt('ThighR', [[0, 0.6, 0, 0], [0.31, -0.75, 0, 0], [0.62, 0.6, 0, 0]]),
      qt('ShinL', [[0, 0.3, 0, 0], [0.2, 0.2, 0, 0], [0.45, 1.3, 0, 0], [0.62, 0.3, 0, 0]]),
      qt('ShinR', [[0, 0.45, 0, 0], [0.15, 1.3, 0, 0], [0.31, 0.3, 0, 0], [0.5, 0.2, 0, 0], [0.62, 0.45, 0, 0]]),
      qt('ArmL', [[0, -0.9, 0, 0.15], [0.31, -1.25, 0, 0.15], [0.62, -0.9, 0, 0.15]]),
      qt('ArmR', [[0, -1.25, 0, -0.15], [0.31, -0.9, 0, -0.15], [0.62, -1.25, 0, -0.15]]),
      qt('ForeArmL', [[0, -0.2, 0, 0], [0.62, -0.2, 0, 0]]),
      qt('ForeArmR', [[0, -0.2, 0, 0], [0.62, -0.2, 0, 0]]),
      qt('Spine', [[0, 0.32, 0, 0], [0.62, 0.32, 0, 0]]),
      qt('Head', [[0, -0.15, 0, 0.05], [0.62, -0.15, 0, 0.05]]),
      pt('Hips', 0, 0, [[0, 0.96], [0.15, 1.02], [0.31, 0.96], [0.46, 1.02], [0.62, 0.96]]),
    ]),
    new THREE.AnimationClip('idle', 3.2, [
      qt('Chest', [[0, 0.02, 0, 0], [1.6, -0.01, 0, 0], [3.2, 0.02, 0, 0]]),
      qt('Head', [[0, 0.05, 0, 0.16], [1.6, 0.08, 0.05, 0.2], [3.2, 0.05, 0, 0.16]]),
      qt('ArmL', [[0, 0, 0, 0.08], [3.2, 0, 0, 0.08]]),
      qt('ArmR', [[0, -0.3, 0, -0.08], [3.2, -0.3, 0, -0.08]]),
      qt('ForeArmR', [[0, -0.5, 0, 0], [3.2, -0.5, 0, 0]]),
    ]),
    new THREE.AnimationClip('listen', 2.4, [
      qt('Head', [[0, 0.0, 0.25, 0.38], [1.2, 0.04, 0.3, 0.42], [2.4, 0.0, 0.25, 0.38]]),
      qt('Chest', [[0, 0.1, 0.1, 0], [2.4, 0.1, 0.1, 0]]),
      qt('ArmR', [[0, -0.3, 0, -0.08], [2.4, -0.3, 0, -0.08]]),
    ]),
    new THREE.AnimationClip('turn_head', 2.6, [
      qt('Head', [[0, 0.05, 0, 0.12], [0.7, 0.05, 1.05, 0.12], [1.3, 0.05, 1.05, 0.2], [2.0, 0.05, -1.0, 0.12], [2.6, 0.05, 0, 0.12]]),
      qt('Chest', [[0, 0, 0, 0], [0.7, 0, 0.25, 0], [2.0, 0, -0.25, 0], [2.6, 0, 0, 0]]),
    ]),
    new THREE.AnimationClip('peek_locker', 1.8, [
      qt('Spine', [[0, 0.42, 0, 0], [0.9, 0.47, 0, 0.05], [1.8, 0.42, 0, 0]]),
      qt('Chest', [[0, 0.2, 0, 0], [1.8, 0.2, 0, 0]]),
      qt('Head', [[0, 0.1, 0, 0.5], [0.9, 0.06, 0.08, 0.56], [1.8, 0.1, 0, 0.5]]),
      qt('ArmL', [[0, -0.6, 0, 0.1], [1.8, -0.6, 0, 0.1]]),
      qt('ForeArmL', [[0, -0.9, 0, 0], [1.8, -0.9, 0, 0]]),
    ]),
    new THREE.AnimationClip('open_locker', 0.8, [
      qt('ArmR', [[0, -0.3, 0, 0], [0.3, -1.5, 0, -0.1], [0.55, -1.2, 0.3, -0.2], [0.8, -0.9, 0.4, -0.3]]),
      qt('ArmL', [[0, 0, 0, 0.1], [0.4, -1.4, 0, 0.1], [0.8, -1.5, 0, 0.1]]),
      qt('Spine', [[0, 0.1, 0, 0], [0.4, 0.3, 0, 0], [0.8, 0.2, 0, 0]]),
      qt('Head', [[0, 0, 0, 0.3], [0.8, -0.1, 0, 0.1]]),
    ]),
    new THREE.AnimationClip('grab', 0.7, [
      qt('ArmL', [[0, -0.4, 0, 0.1], [0.25, -1.55, 0, 0.05], [0.7, -1.45, 0, 0.05]]),
      qt('ArmR', [[0, -0.4, 0, -0.1], [0.25, -1.55, 0, -0.05], [0.7, -1.45, 0, -0.05]]),
      qt('Spine', [[0, 0.1, 0, 0], [0.3, 0.42, 0, 0], [0.7, 0.35, 0, 0]]),
      qt('Head', [[0, -0.2, 0, 0.1], [0.7, -0.3, 0, 0.25]]),
    ]),
    new THREE.AnimationClip('twitch', 0.5, [
      qt('Head', [[0, 0.05, 0, 0.15], [0.06, 0.1, -0.3, 0.75], [0.14, 0.05, 0.1, -0.1], [0.5, 0.05, 0, 0.15]]),
      qt('Chest', [[0, 0, 0, 0], [0.08, 0.05, 0.2, 0.1], [0.5, 0, 0, 0]]),
    ]),
  ];
  return clips;
}

type PTex = { porcelain: THREE.Texture; sheet: THREE.Texture; hair: THREE.Texture; apron: THREE.Texture };
const ss = THREE.MathUtils.smoothstep;
const gauss = (dx: number, dy: number, sx: number, sy: number) => Math.exp(-(dx * dx) / (2 * sx * sx) - (dy * dy) / (2 * sy * sy));

// Porcelain head: an egg with a narrow jaw, carved sockets, a thin nose and a
// closed mouth. Vertex colour darkens the sockets so they read as holes even
// before the torch finds them. The UV seam is turned to the back, under the hair.
function sculptHead() {
  const g = new THREE.SphereGeometry(0.1, 48, 36);
  g.rotateY(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / 0.1, y = p.getY(i) / 0.1, z = p.getZ(i) / 0.1;
    const jaw = ss(-y, 0.0, 0.95);
    const sx = 0.9 * (1 - 0.36 * jaw), sy = 1.16, sz = z < 0 ? 1.07 * (1 - 0.18 * jaw) : 1 - 0.06 * jaw;
    let X = x * 0.1 * sx, Y = y * 0.1 * sy, Z = z * 0.1 * sz;
    const f = ss(z, 0.3, 0.8), ax = Math.abs(x);
    const socket = gauss(ax - 0.4, y - 0.1, 0.15, 0.11), mouth = gauss(x, y + 0.43, 0.22, 0.03);
    let shade = 1;
    if (f > 0) {
      let d = 0;
      d -= 0.022 * socket;
      d += 0.006 * gauss(ax - 0.36, y - 0.27, 0.2, 0.05);                      // brow ridge
      d += 0.007 * gauss(ax - 0.56, y + 0.06, 0.12, 0.12);                     // cheekbones
      d += 0.011 * gauss(x, y + 0.02, 0.045, 0.16) + 0.012 * gauss(x, y + 0.2, 0.055, 0.06); // nose
      d -= 0.004 * mouth;
      d += 0.004 * gauss(x, y + 0.37, 0.15, 0.03) + 0.003 * gauss(x, y + 0.49, 0.12, 0.03);  // lips
      d += 0.006 * gauss(x, y + 0.7, 0.16, 0.1);                               // chin
      d -= 0.006 * gauss(ax - 0.5, y + 0.35, 0.12, 0.15);                      // hollow cheeks
      Z += d * f;
      shade -= f * (0.95 * socket + 0.7 * mouth + 0.18 * gauss(ax - 0.5, y + 0.35, 0.12, 0.15) + 0.15 * gauss(ax - 0.12, y + 0.22, 0.05, 0.04));
    }
    shade -= 0.25 * ss(-y, 0.6, 1.0);
    p.setXYZ(i, X, Y, Z);
    col.push(shade, shade * 0.97, shade * 0.95);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Generic surface of revolution with ripples (pleats) and a ragged lower edge.
function pleated(prof: [number, number][], o: { K?: number; M?: number; pleats?: number; amp?: (t: number) => number; rag?: number; zs?: number; arc?: [number, number]; push?: number; seed?: number; dirt?: number }) {
  const K = o.K ?? 48, M = o.M ?? 14, R = rng(o.seed ?? 311), zs = o.zs ?? 0.86;
  const [a0, a1] = o.arc ?? [0, Math.PI * 2];
  const rag = Array.from({ length: K + 1 }, () => R());
  if (!o.arc) rag[K] = rag[0];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], col: number[] = [];
  for (let j = 0; j <= M; j++) {
    const t = j / M, seg = t * (prof.length - 1), si = Math.min(prof.length - 2, Math.floor(seg)), f = seg - si;
    const r0 = prof[si][0] + (prof[si + 1][0] - prof[si][0]) * f + (o.push ?? 0);
    const y0 = prof[si][1] + (prof[si + 1][1] - prof[si][1]) * f;
    const amp = o.amp ? o.amp(t) : 0;
    for (let k = 0; k <= K; k++) {
      const a = a0 + (k / K) * (a1 - a0);
      const r = r0 + Math.sin(a * (o.pleats ?? 12)) * amp + Math.sin(a * 5 + 1.3) * amp * 0.4;
      const y = y0 - (o.rag ?? 0) * rag[k] * ss(t, 0.82, 1);
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r * zs);
      uv.push((k / K) * 3, 1 - t);
      const c = 1 - (o.dirt ?? 0) * t * t;
      col.push(c, c * 0.97, c * 0.92);
    }
  }
  for (let j = 0; j < M; j++) for (let k = 0; k < K; k++) { const a = j * (K + 1) + k, b = a + K + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Hair ribbons along Catmull-Rom curves, all in one geometry.
function strands(defs: { pts: [number, number, number][]; w: [number, number] }[]) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const tan = new THREE.Vector3(), out = new THREE.Vector3(), side = new THREE.Vector3();
  const segs = 10;
  for (const d of defs) {
    const curve = new THREE.CatmullRomCurve3(d.pts.map(q => new THREE.Vector3(...q)));
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, p = curve.getPoint(t);
      curve.getTangent(t, tan);
      out.set(p.x, 0, p.z - 0.0).normalize();
      side.crossVectors(tan, out).normalize();
      const w = d.w[0] + (d.w[1] - d.w[0]) * t;
      pos.push(p.x - side.x * w / 2, p.y - side.y * w / 2, p.z - side.z * w / 2, p.x + side.x * w / 2, p.y + side.y * w / 2, p.z + side.z * w / 2);
      uv.push(0, 1 - t, 1, 1 - t);
    }
    for (let i = 0; i < segs; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function placeholder(tex: PTex) {
  const root = new THREE.Group();
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const dress = std({ map: tex.sheet, color: 0xa29d8e });
  const skirtMat = std({ map: tex.sheet, color: 0xa29d8e, vertexColors: true, side: THREE.DoubleSide });
  const apronMat = std({ map: tex.apron, color: 0xc9c3b3, vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
  const white = std({ map: tex.apron, color: 0xcfcabb });
  const skin = std({ map: tex.porcelain, color: 0xc6bdae, roughness: 0.45 });
  const face = std({ map: tex.porcelain, color: 0xc9c0b0, roughness: 0.55, vertexColors: true });
  const stocking = std({ color: 0xb4ada2, roughness: 0.6 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x030202 });
  const hairMat = std({ color: 0x0f0b09, roughness: 0.55 });
  const strandMat = std({ color: 0x0f0b09, roughness: 0.5, map: tex.hair, alphaTest: 0.45, side: THREE.DoubleSide });
  const shoe = std({ color: 0x121110, roughness: 0.45 });
  const brass = std({ color: 0xb9ae8e, metalness: 0.85, roughness: 0.28 });
  const bone = (name: string, x: number, y: number, z: number, parent: THREE.Object3D) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z);
    g.computeBoundingSphere(); o.castShadow = g.boundingSphere!.radius > 0.035; // fingers, buckle, watch: no shadow pass
    parent.add(o); return o;
  };
  const lathe = (pts: [number, number][], seg = 18) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

  const hips = bone('Hips', 0, 1.0, 0, root);
  const spine = bone('Spine', 0, 0.12, 0, hips);
  const chest = bone('Chest', 0, 0.2, 0, spine);
  const neck = bone('Neck', 0, 0.2, 0, chest);
  const head = bone('Head', 0, 0.1, 0, neck);

  // skirt: knife pleats that deepen towards a torn, darkened hem
  const skirtProf: [number, number][] = [[0.122, 0.13], [0.138, 0.05], [0.19, -0.14], [0.236, -0.4], [0.272, -0.6]];
  mesh(pleated(skirtProf, { amp: t => 0.003 + 0.026 * t * t, rag: 0.06, dirt: 0.45 }), skirtMat, hips);
  // apron over the front of the skirt, then its bib on the chest
  mesh(pleated(skirtProf.slice(0, 4).map(([r, y]) => [r, y - 0.02] as [number, number]), { K: 20, M: 10, arc: [-0.85, 0.85], amp: t => 0.002 + 0.008 * t, pleats: 7, rag: 0.03, push: 0.03, dirt: 0.3, seed: 77 }), apronMat, hips);
  // bodice: shaped, not a tube
  const waist = mesh(lathe([[0.112, -0.06], [0.109, 0.02], [0.116, 0.12], [0.132, 0.24]]), dress, spine); waist.scale.z = 0.76;
  const torso = mesh(lathe([[0.13, -0.07], [0.148, 0.02], [0.152, 0.07], [0.142, 0.13], [0.118, 0.18], [0.072, 0.214], [0.042, 0.232]]), dress, chest); torso.scale.z = 0.74;
  const bib = mesh(new THREE.PlaneGeometry(0.13, 0.17, 1, 1), white, chest, 0, 0.05, 0.116); bib.rotation.x = -0.12;
  const belt = mesh(new THREE.CylinderGeometry(0.117, 0.117, 0.04, 22, 1, true), dress, spine, 0, 0.0); belt.scale.z = 0.78;
  (belt.material as THREE.MeshStandardMaterial) = std({ color: 0x2a2621, roughness: 0.6 });
  mesh(new THREE.BoxGeometry(0.036, 0.03, 0.008), brass, spine, 0, 0.0, 0.094);
  // fob watch pinned over her heart, and the collar
  const watch = mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.007, 14), brass, chest, 0.062, 0.1, 0.114); watch.rotation.x = Math.PI / 2;
  mesh(new THREE.BoxGeometry(0.004, 0.03, 0.003), brass, chest, 0.062, 0.128, 0.114);
  const collar = mesh(new THREE.TorusGeometry(0.052, 0.014, 6, 18), white, chest, 0, 0.212, 0.008); collar.rotation.x = Math.PI / 2 - 0.2; collar.scale.set(1, 0.85, 0.7);

  // a neck a little too long
  mesh(new THREE.CylinderGeometry(0.035, 0.043, 0.18, 10), skin, neck, 0, 0.035);
  const skull = mesh(sculptHead(), face, head, 0, 0.1, 0);
  skull.castShadow = true;
  for (const s of [-1, 1]) { const e = mesh(new THREE.SphereGeometry(0.02, 12, 8), dark, head, 0.036 * s, 0.112, 0.081); e.scale.set(1.3, 0.85, 0.45); }
  // hair: a cap over the skull, a bun coming undone, strands across one eye
  // crown stops at a high hairline so it never covers the face; a separate shell wraps the back down to the nape
  const hc = mesh(new THREE.SphereGeometry(0.113, 22, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat, head, 0, 0.118, -0.03); hc.scale.set(0.98, 1.1, 1.06);
  const hb = mesh(new THREE.SphereGeometry(0.114, 18, 12, Math.PI, Math.PI, Math.PI * 0.25, Math.PI * 0.55), hairMat, head, 0, 0.118, -0.02); hb.scale.set(1.0, 1.1, 1.05);
  mesh(new THREE.SphereGeometry(0.05, 12, 10), hairMat, head, 0.01, 0.13, -0.135).scale.set(1.1, 0.9, 0.8);
  const R = rng(5);
  const defs: { pts: [number, number, number][]; w: [number, number] }[] = [];
  for (let i = 0; i < 4; i++) {           // a few loose strands over her right eye
    const x = -0.058 + i * 0.017 + (R() - 0.5) * 0.004, len = R();
    defs.push({ pts: [[x * 0.9, 0.205, 0.05], [x * 1.0, 0.17, 0.1], [x * 1.08 + (R() - 0.5) * 0.01, 0.105, 0.116], [x * 1.12 + (R() - 0.5) * 0.02, 0.06 - len * 0.04, 0.11]], w: [0.008, 0.004] });
  }
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {   // side curtains to the shoulders
    const z = 0.035 - i * 0.03, len = R();
    defs.push({ pts: [[0.075 * s, 0.2, z], [0.098 * s, 0.13, z + 0.01], [0.092 * s, 0.03, z + 0.015], [(0.1 + R() * 0.02) * s, -0.1 - len * 0.1, z + 0.005]], w: [0.03, 0.022] });
  }
  for (let i = 0; i < 6; i++) {           // down her back
    const x = -0.07 + i * 0.028;
    defs.push({ pts: [[x, 0.16, -0.09], [x * 1.1, 0.06, -0.122], [x * 1.15, -0.1, -0.12], [x * 1.2 + (R() - 0.5) * 0.03, -0.3 - R() * 0.08, -0.1]], w: [0.04, 0.03] });
  }
  mesh(strands(defs), strandMat, head);
  // starched cap
  const capTop = mesh(new THREE.BoxGeometry(0.15, 0.05, 0.1), white, head, 0, 0.248, -0.025); capTop.rotation.x = -0.32;
  const band = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.034, 20, 1, true, -1.15, 2.3), white, head, 0, 0.205, -0.028); band.scale.x = 0.96;
  (band.material as THREE.MeshStandardMaterial) = std({ map: tex.apron, color: 0xf2eee2, side: THREE.DoubleSide });

  for (const s of [-1, 1]) {
    const L = s > 0 ? 'L' : 'R';
    const arm = bone(`Arm${L}`, 0.19 * s, 0.15, 0, chest);
    mesh(new THREE.SphereGeometry(0.052, 12, 10), dress, arm, -0.012 * s, -0.035, 0).scale.set(0.95, 0.8, 0.9);
    mesh(new THREE.CylinderGeometry(0.047, 0.04, 0.29, 10), dress, arm, 0, -0.15);
    mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.026, 10), white, arm, 0, -0.285);
    const fore = bone(`ForeArm${L}`, 0, -0.31, 0, arm);
    mesh(new THREE.CylinderGeometry(0.03, 0.021, 0.29, 8), skin, fore, 0, -0.145);
    const hand = bone(`Hand${L}`, 0, -0.29, 0, fore);
    mesh(new THREE.BoxGeometry(0.017, 0.072, 0.048), skin, hand, 0, -0.036);
    for (let i = 0; i < 4; i++) {          // long fingers, slightly curled toward the palm
      const k = new THREE.Group(); k.position.set(0, -0.07, -0.018 + i * 0.012); k.rotation.set((i - 1.5) * 0.05, 0, -s * (0.22 + i * 0.05)); hand.add(k);
      mesh(new THREE.CylinderGeometry(0.0052, 0.0034, i === 0 || i === 3 ? 0.085 : 0.105, 5), skin, k, 0, -0.05);
    }
    const th = new THREE.Group(); th.position.set(0, -0.02, 0.026); th.rotation.set(0.5, 0, -s * 0.3); hand.add(th);
    mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.06, 5), skin, th, 0, -0.03);

    const thigh = bone(`Thigh${L}`, 0.095 * s, -0.03, 0, hips);
    mesh(new THREE.CylinderGeometry(0.066, 0.05, 0.44, 10), stocking, thigh, 0, -0.22);
    const shin = bone(`Shin${L}`, 0, -0.45, 0, thigh);
    mesh(lathe([[0.046, 0.0], [0.05, -0.1], [0.04, -0.25], [0.03, -0.43]], 10), stocking, shin, 0, 0);
    const foot = bone(`Foot${L}`, 0, -0.44, 0, shin);
    const sh = mesh(new THREE.CapsuleGeometry(0.034, 0.14, 4, 10), shoe, foot, 0, -0.034, 0.045); sh.rotation.x = Math.PI / 2; sh.scale.set(1, 1, 0.72);
    mesh(new THREE.BoxGeometry(0.045, 0.03, 0.04), shoe, foot, 0, -0.05, -0.03);
  }
  return { root, head, clips: placeholderClips() };
}

function ivStand() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x8d8f88, roughness: 0.4, metalness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.85, 6), metal); pole.position.y = 0.95; g.add(pole);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.025), metal);
    leg.position.set(Math.cos(a) * 0.14, 0.06, Math.sin(a) * 0.14); leg.rotation.y = -a; g.add(leg);
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    w.position.set(Math.cos(a) * 0.27, 0.025, Math.sin(a) * 0.27); g.add(w);
  }
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 4, 10, Math.PI), metal); hook.position.y = 1.86; g.add(hook);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.2, 0.04), new THREE.MeshStandardMaterial({ color: 0xd9cf8f, transparent: true, opacity: 0.72, roughness: 0.2 }));
  bag.position.set(0.06, 1.7, 0); g.add(bag);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.9, 4), new THREE.MeshStandardMaterial({ color: 0xbdb7a6 }));
  tube.position.set(0.1, 1.15, 0.04); tube.rotation.z = 0.15; g.add(tube);
  g.traverse(o => { o.castShadow = true; });
  return g;
}

// The model ships inside the build (src/assets/nurse.glb, inlined as a data URL in the single-file
// version); without it the game falls back to assets/nurse.glb next to the page, then to the placeholder.
const GLB = import.meta.glob('./assets/nurse.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const NURSE_URL = Object.values(GLB)[0] ?? 'assets/nurse.glb';

// The published page forbids fetch() of data: and blob: URLs (the frame's connect-src), which is how GLTFLoader
// reads an inlined model and its pictures. So the model is decoded by hand and its pictures straight from their
// bytes: createImageBitmap on a Blob goes through no URL at all (an <img> with a data: URL is the fallback).
function bytesOf(dataUrl: string) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
function dataImage(buf: ArrayBuffer, type: string) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = `data:${type};base64,${btoa(s)}`; });
}
const FILTERS: Record<number, THREE.TextureFilter> = { 9728: THREE.NearestFilter, 9729: THREE.LinearFilter, 9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter, 9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter };
const WRAPS: Record<number, THREE.Wrapping> = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
class EmbeddedImages {
  name = 'NR_EMBEDDED_IMAGES';
  constructor(private parser: GLTFParser) { }
  loadTexture(index: number) {
    const parser = this.parser as any, json = parser.json, def = json.textures[index], src = json.images?.[def.source];
    if (!src || src.bufferView === undefined) return null;
    return parser.getDependency('bufferView', src.bufferView).then(async (buf: ArrayBuffer) => {
      let img: ImageBitmap | HTMLImageElement;
      try { img = await createImageBitmap(new Blob([buf], { type: src.mimeType }), { premultiplyAlpha: 'none' }); }
      catch { img = await dataImage(buf, src.mimeType); }
      const tex = new THREE.Texture(img);
      tex.flipY = false; tex.name = def.name || src.name || '';
      const sm = (json.samplers || [])[def.sampler] || {};
      tex.magFilter = (FILTERS[sm.magFilter] as THREE.MagnificationTextureFilter) || THREE.LinearFilter;
      tex.minFilter = FILTERS[sm.minFilter] || THREE.LinearMipmapLinearFilter;
      tex.wrapS = WRAPS[sm.wrapS] || THREE.RepeatWrapping; tex.wrapT = WRAPS[sm.wrapT] || THREE.RepeatWrapping;
      tex.generateMipmaps = tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter;
      tex.needsUpdate = true;
      parser.associations.set(tex, { textures: index });
      return tex;
    });
  }
}
export let nurseLoadError = '';
async function loadGLB(url: string) {
  try {
    const loader = new GLTFLoader();
    loader.register(p => new EmbeddedImages(p));
    if (url.startsWith('data:')) return await loader.parseAsync(bytesOf(url), '');
    const head = await fetch(url, { method: 'HEAD' }); if (!head.ok) return null;
    return await loader.loadAsync(url);
  } catch (e) { nurseLoadError = String(e); console.warn('[nurse] model failed, using the placeholder:', e); return null; }
}

export let sigilCount = 0;
export async function buildRig(tex: PTex & { glint: THREE.Texture }, url = NURSE_URL): Promise<Rig> {
  let root: THREE.Group, head: THREE.Object3D, clips: THREE.AnimationClip[], source: Rig['source'] = 'placeholder';
  const gltf = await loadGLB(url);
  const glintMat = () => new THREE.SpriteMaterial({ map: tex.glint, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 });
  const glints: THREE.Sprite[] = [];
  const morphs: Rig['morphs'] = [];
  if (gltf) {
    source = 'glb';
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const hgt = box.max.y - box.min.y;
    const s = hgt < 1.2 || hgt > 2.4 ? 1.75 / hgt : 1;
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    root = new THREE.Group(); root.add(model);
    model.traverse((o: any) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.morphTargetDictionary) morphs.push({ mesh: o, dict: o.morphTargetDictionary }); }
    });
    head = model.getObjectByName('glint_L')?.parent ?? (() => { let h: THREE.Object3D | undefined; model.traverse(o => { if (!h && /head/i.test(o.name) && (o as any).isBone) h = o; }); return h ?? model; })();
    for (const n of ['glint_L', 'glint_R']) {
      const anchor = model.getObjectByName(n);
      const sp = new THREE.Sprite(glintMat());
      if (anchor) anchor.add(sp); else { head.add(sp); sp.position.set((n.endsWith('L') ? 0.032 : -0.032) / s, 0.03 / s, 0.09 / s); }
      glints.push(sp);
    }
    sigilCount = applySigil(model);
    clips = gltf.animations.map(c => { const k = c.clone(); k.name = c.name.toLowerCase(); return k; });
  } else {
    const p = placeholder(tex);
    root = p.root; head = p.head; clips = p.clips;
    for (const sx of [1, -1]) { const sp = new THREE.Sprite(glintMat()); sp.position.set(0.036 * sx, 0.112, 0.098); head.add(sp); glints.push(sp); }
  }
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  const byName = new Map(clips.map(c => [c.name, c]));
  const fallback: Record<string, string[]> = {
    walk_search: ['walk'], run: ['walk'], listen: ['idle'], turn_head: ['idle'], peek_locker: ['idle'],
    open_locker: ['grab', 'idle'], grab: ['idle'], twitch: ['idle'], walk: ['idle'], idle: [],
  };
  const speedScale: Record<string, number> = {};
  for (const name of CLIPS) {
    let c = byName.get(name);
    if (!c) for (const f of fallback[name] ?? []) if ((c = byName.get(f))) { if (name === 'run') speedScale.run = 1.9; break; }
    if (!c) c = new THREE.AnimationClip(name, 1, []);
    const a = mixer.clipAction(c);
    if (ONCE.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions.set(name, a);
  }
  // optional one-shots: only if the model has them (the placeholder doesn't; then the pose layer stands in)
  for (const name of ['scratch']) {
    const c = byName.get(name);
    if (c) { const a = mixer.clipAction(c); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; actions.set(name, a); }
  }
  return { root, mixer, actions, head, glints, morphs, source, speedScale };
}

// ---------------------------------------------------------------------------
type State = 'idle' | 'patrol' | 'suspicious' | 'investigate' | 'search' | 'chase' | 'inspect' | 'lightoff' | 'leave' | 'script' | 'grab' | 'frozen' | 'ambush';
// A stop on her round: where she stands, what she looks at, how long, and what she does there.
interface Stop { x: number; z: number; wait: number; act: string; tag: string; look?: { x: number; y: number; z: number }; bed?: Locker }
export interface Noise { x: number; z: number; r: number; loud: number; kind: string; ox?: number; oz?: number }
interface ScriptStep { to?: { x: number; z: number }; speed?: number; wait?: number; look?: boolean; hum?: boolean; glint?: number; call?: () => void }

// ---- procedural layer --------------------------------------------------------------------------
// Poses laid over the clips, written as rotations in her own space (degrees: x bends forward/down, y turns to
// her left, z tips toward her right shoulder), applied at each joint in the frame the clip has put it in
// (q·W⁻¹·Q·W), parent first, so a child's angle is given as if its parent hadn't moved. Weights ease in and
// out; a look-at aims neck and head.
type E3 = [number, number, number];
export type Pose = Record<string, E3>;
const LAYER_BONES = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
export const POSES: Record<string, (t: number) => Pose> = {
  // right hand up to the side of her neck, scratching; head tipped away from it
  scratch: t => {
    const a = Math.sin(t * 14), b = Math.sin(t * 14 + 1.4);
    return { clavicle_r: [0, 0, -10], upperarm_r: [0, 30, -82], lowerarm_r: [-140 + a * 8, 0, 0], hand_r: [b * 22, 0, 0], neck_01: [0, 0, -8], head: [4, 0, -16] };
  },
  // the head goes over, slowly, and stays there
  tilt: () => ({ neck_01: [0, 0, -9], head: [3, 0, -24] }),
  // down on her knees to look under a bed: shins on the floor, hands down, back bent over until her face is
  // at the gap, head turned sideways
  bend: () => ({
    thigh_l: [-55, 0, -8], thigh_r: [-55, 0, 8], calf_l: [145, 0, 0], calf_r: [145, 0, 0], foot_l: [25, 0, 0], foot_r: [25, 0, 0],
    spine_01: [48, 0, 0], spine_02: [42, 0, 0], spine_03: [32, 0, 0], neck_01: [-30, 0, 0], head: [-92, 0, 30],
    upperarm_l: [-122, 0, 15], upperarm_r: [-122, 0, -15], lowerarm_l: [-75, 0, 0], lowerarm_r: [-75, 0, 0],
  }),
};
const BEND_DROP = 0.67;
const MIXAMO: Record<string, string> = {
  Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'head',
  RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r',
  LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r',
};
const DEG = Math.PI / 180;

export class Nurse {
  rig: Rig; iv = ivStand();
  pos = new THREE.Vector3(); yaw = 0; speed = 0;
  state: State = 'idle'; t = 0; phaseMul = 1;
  path: { x: number; z: number }[] = []; pi = 0; goal: { x: number; z: number } | null = null; repath = 0;
  awareness = 0; canSee = false; litByTorch = false; dist = 99; lastSeen = new THREE.Vector3(); lostT = 0;
  target = new THREE.Vector3(); targetKind = '';
  heard: Noise | null = null; heardS = 0;
  locker: Locker | null = null; sawEnter = false; insp = 'approach'; inspT = 0; notHeld = 0; tutorial = false; inspectDone: (() => void) | null = null;
  lures = 0; lockerHides = 0; hint = false; lamp: Lamp | null = null; looked = false;
  searchCenter = new THREE.Vector3(); searchT = 0;
  stepAcc = 0; squeakT = 0; twitchT = 12; stepT = 0; stepClock = 0; doorWait = 0; stuckT = 0; stuckN = 0; lastD = 0;
  blinkT = 3; blinking = 0; glintBoost = 0; glintLevel = 0; peekDip = 0; private gw = new THREE.Vector3(); private gv = new THREE.Vector3();
  anim = ''; oneShot = ''; script: { steps: ScriptStep[]; i: number; t: number; done?: () => void } | null = null;
  humWant = false; wasHumming = false; voiceCD = 8;
  // procedural layer: per-bone rest frames, the clip's pose of each, layer weights, look-at
  private lb = new Map<string, { b: THREE.Object3D; anim: THREE.Quaternion; w: THREE.Quaternion }>();
  private lm = new THREE.Matrix4(); private lmi = new THREE.Matrix4(); private lp = new THREE.Vector3(); private ls = new THREE.Vector3();
  layer: Record<string, { w: number; want: number }> = { scratch: { w: 0, want: 0 }, tilt: { w: 0, want: 0 }, bend: { w: 0, want: 0 } };
  lookW = 0; lookWant = 0; lookAt = new THREE.Vector3(); layerT = 0; debugPose: Pose | null = null;
  // a pause on her round: she stops, and stares, scratches or tips her head
  pause: { t: number; act: string; dur: number; checked?: boolean } | null = null; stopT = 20; private handR: THREE.Object3D | null | undefined;
  // her round: the same stops in the same order, and the next time the other way round (the Hoja de ronda)
  round: Stop[] = []; ri = -1; rdir = 1; stop: Stop | null = null; rounds = 0; offRound = true; private roundPhase = -1;
  // what she keeps in mind: where you were heading, the doors as she left them, where people like to hide
  seenVel = { x: 0, z: 0 }; private lastEye = { x: 0, z: 0, ok: false };
  doorMem = new Map<string, boolean>(); private doorScan = 0; spotT = 0;
  heat = new Map<string, number>(); kindHeat: Record<string, number> = { locker: 0, bed: 0 }; checkedAt = new Map<string, number>();
  spots: { x: number; z: number; l?: Locker }[] = []; cur: { x: number; z: number; l?: Locker } | null = null;
  amb: { phase: 'away' | 'wait' | 'back'; t: number; c: THREE.Vector3; wait: number } | null = null; lastAmbush = -99;
  clue: { x: number; z: number; kind: string } | null = null;
  private le = new THREE.Euler(); private lq = new THREE.Quaternion(); private ld = new THREE.Quaternion(); private lh = new THREE.Vector3();
  R = rng(99);

  constructor(public game: Game, rig: Rig) {
    this.rig = rig;
    game.scene.add(rig.root);
    game.scene.add(this.iv);
    this.initLayers();
    this.play('idle', 0);
  }

  private initLayers() {
    // the pose names are the game-engine rig's; a Mixamo rig (mixamorig:* → 'mixamorigSpine' once loaded) maps onto them
    const found = new Map<string, THREE.Object3D>();
    this.rig.root.traverse(o => {
      const n = LAYER_BONES.includes(o.name) ? o.name : MIXAMO[o.name.replace(/^mixamorig\d*:?/, '')];
      if (n && !found.has(n)) found.set(n, o);
    });
    for (const n of LAYER_BONES) { const o = found.get(n); if (o) this.lb.set(n, { b: o, anim: o.quaternion.clone(), w: new THREE.Quaternion() }); } // parent first
  }
  // the mixer writes the clip's pose; the layer is taken off before and laid back on after
  private mix(dt: number) {
    for (const v of this.lb.values()) v.b.quaternion.copy(v.anim);
    this.rig.mixer.update(dt);
    for (const v of this.lb.values()) v.anim.copy(v.b.quaternion);
  }
  private applyLayers(dt: number) {
    if (!this.lb.size) return;
    this.layerT += dt;
    const acc: Record<string, E3> = {};
    const add = (pose: Pose, w: number) => { for (const k in pose) { const a = acc[k] ?? (acc[k] = [0, 0, 0]), v = pose[k]; a[0] += v[0] * w; a[1] += v[1] * w; a[2] += v[2] * w; } };
    for (const k in this.layer) {
      const L = this.layer[k];
      L.w += (L.want - L.w) * Math.min(1, dt * (k === 'bend' ? 2.4 : 3.2));
      if (L.w > 0.002) add(POSES[k](this.layerT), L.w);
    }
    if (this.debugPose) add(this.debugPose, 1);
    // look-at: the neck takes 40%, the head 60%, never past her shoulder
    this.lookW += (this.lookWant - this.lookW) * Math.min(1, dt * 3.5);
    if (this.lookW > 0.002) {
      const hx = this.lookAt.x - this.pos.x, hz = this.lookAt.z - this.pos.z, c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      const lx = hx * c - hz * sn, lz = hx * sn + hz * c;
      const yawL = THREE.MathUtils.clamp(Math.atan2(lx, lz), -1.3, 1.3) / DEG;
      this.rig.head.getWorldPosition(this.lh);
      const pitch = THREE.MathUtils.clamp(Math.atan2(this.lookAt.y - this.lh.y, Math.max(0.3, Math.hypot(lx, lz))), -0.7, 0.5) / DEG;
      add({ neck_01: [-pitch * 0.4, yawL * 0.4, 0], head: [-pitch * 0.6, yawL * 0.6, 0] }, this.lookW);
    }
    // the clip's pose, and each joint's frame in her space
    for (const v of this.lb.values()) v.b.quaternion.copy(v.anim);
    const root = this.rig.root; root.updateMatrixWorld(true); this.lmi.copy(root.matrixWorld).invert();
    for (const [name, v] of this.lb) if (acc[name]) this.lm.multiplyMatrices(this.lmi, v.b.matrixWorld).decompose(this.lp, v.w, this.ls);
    for (const [name, v] of this.lb) {
      const a = acc[name];
      if (!a) continue;
      this.lq.setFromEuler(this.le.set(a[0] * DEG, a[1] * DEG, a[2] * DEG, 'YXZ'));
      this.ld.copy(v.w).invert().multiply(this.lq).multiply(v.w);
      v.b.quaternion.multiply(this.ld);
    }
  }
  private startPause(t: number, act: string, look?: { x: number; y: number; z: number }) {
    this.pause = { t, act, dur: t };
    const P = this.game.player;
    if (look && (act === 'check' || act === 'write' || act === 'look')) {
      // a stop on her round: she looks at what she came to look at (the pillow, the ledger, down the corridor)
      this.lookAt.set(look.x, look.y, look.z); this.lookWant = 1;
      if (act === 'write') this.layer.tilt.want = 0.6;
      return;
    }
    if (act === 'stare') {
      // she looks right at where you are, if there's a line to you; otherwise off to one side, at nothing
      if (this.dist < 16 && !this.game.level.blocked(this.pos.x, this.pos.z, P.eye.x, P.eye.z)) this.lookAt.copy(P.eye);
      else { const a = this.yaw + (this.R() < 0.5 ? 1 : -1) * (0.8 + this.R() * 0.5); this.lookAt.set(this.pos.x + Math.sin(a) * 4, 1.5, this.pos.z + Math.cos(a) * 4); }
      this.lookWant = 1;
    } else if (act === 'scratch') { if (this.rig.actions.has('scratch')) { this.once('scratch'); this.pause.t = Math.max(this.pause.t, this.rig.actions.get('scratch')!.getClip().duration); } else this.layer.scratch.want = 1; }
    else { this.layer.tilt.want = 1; this.lookWant = 0.5; this.lookAt.set(this.pos.x + Math.sin(this.yaw) * 3, 2.4, this.pos.z + Math.cos(this.yaw) * 3); }
  }
  private endPause() { this.pause = null; this.layer.scratch.want = 0; this.layer.tilt.want = 0; this.lookWant = 0; }

  // -- animation ------------------------------------------------------------
  play(name: string, fade = 0.25, scale = 1) {
    const a = this.rig.actions.get(name)!;
    a.timeScale = scale * (this.rig.speedScale[name] ?? 1);
    if (this.anim === name) return;
    const prev = this.rig.actions.get(this.anim);
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    if (prev && fade > 0) a.crossFadeFrom(prev, fade, false); else { prev?.stop(); }
    a.play();
    this.anim = name;
  }
  once(name: string) { this.oneShot = name; this.play(name, 0.12); }

  // -- placement --------------------------------------------------------------
  teleport(x: number, z: number, yaw = this.yaw) {
    this.pos.set(x, 0, z); this.yaw = yaw; this.path = []; this.goal = null; this.speed = 0;
  }
  visibleFrom(x: number, z: number, fx: number, fz: number, px = this.pos.x, pz = this.pos.z) {
    const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz);
    if (d > 24) return false;
    if ((dx * fx + dz * fz) / d < 0.2 && d > 3) return false;
    return !this.game.level.blocked(x, z, px, pz);
  }
  placeFar() {
    const P = this.game.player, L = this.game.level;
    let best = PATROL[0], bd = -1;
    for (const p of PATROL) {
      const c = L.center(p[0], p[1]);
      const d = Math.hypot(c.x - P.pos.x, c.z - P.pos.z);
      if (d > bd && !this.visibleFrom(P.pos.x, P.pos.z, P.fwd.x, P.fwd.z, c.x, c.z)) { bd = d; best = p; }
    }
    const c = L.center(best[0], best[1]);
    this.teleport(c.x, c.z, this.R() * 6);
    this.reset('patrol');
  }
  reset(state: State) {
    this.state = state; this.t = 0; this.awareness = 0; this.locker = null; this.sawEnter = false; this.lamp = null;
    this.hint = false; this.goal = null; this.path = []; this.oneShot = ''; this.script = null; this.glintBoost = 0; this.lostT = 0;
    this.amb = null; this.offRound = true; this.stop = null; this.pause = null;
    this.play('idle', 0);
  }

  // -- public commands ----------------------------------------------------------
  hintTo(p: { x: number; z: number }) { this.hint = true; this.offRound = true; this.stop = null; this.setGoal(p); }
  sendAway() {
    const P = this.game.player, L = this.game.level;
    let best = PATROL[0], bd = -1;
    for (const p of PATROL) { const c = L.center(p[0], p[1]); const d = Math.hypot(c.x - P.pos.x, c.z - P.pos.z); if (d > bd) { bd = d; best = p; } }
    this.to('leave'); this.offRound = true; this.stop = null; this.setGoal(L.center(best[0], best[1]));
  }
  switchOff(l: Lamp) { this.lamp = l; this.to('lightoff'); this.setGoal(l.stand); }
  runScript(steps: ScriptStep[], done?: () => void) { this.to('script'); this.script = { steps, i: 0, t: 0, done }; this.path = []; this.goal = null; }
  inspect(l: Locker, opts: { tutorial?: boolean; saw?: boolean } = {}) {
    this.locker = l; this.tutorial = !!opts.tutorial; this.sawEnter = !!opts.saw; this.insp = 'approach'; this.inspT = 0; this.notHeld = 0; this.peekLine = false;
    T.ev('inspect', { id: l.id, saw: !!opts.saw, you: this.game.player.inLocker === l });
    this.to('inspect'); this.setGoal(l.front);
  }
  onPlayerEnteredLocker(l: Locker) {
    const P = this.game.player;
    const seen = this.state !== 'script' && this.visibleFrom(this.pos.x, this.pos.z, Math.sin(this.yaw), Math.cos(this.yaw), P.pos.x, P.pos.z) && this.dist < 15;
    if (['investigate', 'search', 'chase', 'suspicious', 'ambush'].includes(this.state) && this.dist < 14) { this.lockerHides++; this.kindHeat[l.kind] += 1; }
    if (seen && (this.state === 'chase' || this.awareness > 0.5)) this.inspect(l, { saw: true });
  }

  private to(s: State) {
    if (s !== 'patrol' && s !== 'leave') { this.offRound = true; this.stop = null; }
    if (s !== 'ambush') this.amb = null;
    this.state = s; this.t = 0; this.oneShot = ''; this.looked = false; if (s !== 'patrol') this.hint = false; this.endPause(); this.layer.bend.want = 0;
  }
  private setGoal(p: { x: number; z: number }) {
    this.goal = { x: p.x, z: p.z };
    const path = this.game.level.path(this.pos.x, this.pos.z, p.x, p.z);
    this.path = path && path.length ? path : [{ x: p.x, z: p.z }];
    this.pi = 0; this.stuckT = 0; this.lastD = 1e9;
    if (!this.stuckFor || Math.hypot(p.x - this.stuckFor.x, p.z - this.stuckFor.z) > 0.05) { this.stuckFor = { x: p.x, z: p.z }; this.stuckN = 0; } // a new goal, not the same one again
  }
  private stuckFor: { x: number; z: number } | null = null;
  private arrived() { return !this.path.length || this.pi >= this.path.length; }

  // -- perception ---------------------------------------------------------------
  private sense(dt: number, noises: Noise[]) {
    const P = this.game.player, L = this.game.level, G = this.game;
    const eye = P.eye;
    const dx = eye.x - this.pos.x, dz = eye.z - this.pos.z, d = Math.max(0.01, Math.hypot(dx, dz));
    this.dist = d;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const cosA = (dx * fx + dz * fz) / d;
    const los = !L.blocked(this.pos.x, this.pos.z, eye.x, eye.z);
    this.canSee = false; this.litByTorch = false;
    // sight: full within ~55° of where she faces, fading out toward ~80° (the corner of her eye catches a lit or
    // running shape, not a still one in the dark); standing still and waiting, she watches harder
    const fov = d < 1.6 ? 1 : THREE.MathUtils.smoothstep(cosA, 0.15, 0.55);
    if (!P.inLocker && !P.ghost && los && fov > 0) {
      const lit = P.visibility();
      const range = (3.0 + 15 * lit) * (0.55 + 0.45 * fov);
      if (d < range) {
        this.canSee = true;
        this.awareness += (1 - d / range) * (0.9 + 2.6 * lit) * this.phaseMul * fov * dt * 1.5 * (this.state === 'ambush' ? 1.4 : 1);
      }
    }
    if (P.torch.on && !P.inLocker && !P.ghost && los && d < P.torch.range) {
      const hx = this.pos.x - P.torch.pos.x, hy = 1.6 - P.torch.pos.y, hz = this.pos.z - P.torch.pos.z;
      const hl = Math.hypot(hx, hy, hz);
      const c = (hx * P.torch.dir.x + hy * P.torch.dir.y + hz * P.torch.dir.z) / hl;
      if (c > P.torch.cos) { this.litByTorch = true; this.awareness += dt * (1.3 + P.torch.level * 0.7); this.canSee = true; }
    }
    if (!this.canSee) this.awareness = Math.max(0, this.awareness - dt * 0.22);
    else this.lastSeen.set(eye.x, 0, eye.z);
    this.awareness = Math.min(this.awareness, 1.5);
    // where you were going, while she could see you (for when she can't)
    if (this.canSee && dt > 0) {
      if (this.lastEye.ok) { const k = Math.min(1, dt * 4); this.seenVel.x += ((eye.x - this.lastEye.x) / dt - this.seenVel.x) * k; this.seenVel.z += ((eye.z - this.lastEye.z) / dt - this.seenVel.z) * k; }
      this.lastEye.x = eye.x; this.lastEye.z = eye.z; this.lastEye.ok = true;
    } else this.lastEye.ok = false;
    this.heard = null; this.heardS = 0;
    for (const n of noises) {
      const occ = L.occlusion(n.x, n.z, this.pos.x, this.pos.z);
      const r = n.r / (1 + occ * 1.1);
      const nd = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
      if (nd < r) { const s = n.loud * (1 - nd / r); if (s > this.heardS) { this.heardS = s; this.heard = n; } }
    }
    // things out of place: light moving on a wall, a door that isn't how she left it, a curtain still swinging
    this.clue = null;
    const busy = this.state === 'chase' || this.state === 'grab' || this.state === 'inspect' || this.state === 'script' || this.state === 'frozen';
    if (busy || this.canSee) { this.spotT = 0; return; }
    const ahead = (x: number, z: number, max: number, minCos: number) => { const qx = x - this.pos.x, qz = z - this.pos.z, qd = Math.hypot(qx, qz); return qd < max && qd > 0.5 && (qx * fx + qz * fz) / qd > minCos ? qd : 0; };
    if (P.torch.on && !P.inLocker && !P.ghost) {
      // the beam's spot: pulled back a little from the wall it lands on, so the wall itself doesn't hide it
      const k = Math.max(0.3, P.aimD - 0.35), sx = P.eye.x + P.fwd.x * k, sz = P.eye.z + P.fwd.z * k;
      const qd = ahead(sx, sz, 13, 0.2);
      if (qd && !L.blocked(this.pos.x, this.pos.z, sx, sz)) this.spotT += dt * (0.55 + 0.35 * P.torch.level) * (1 - qd / 13) * 2.2;
      else this.spotT = Math.max(0, this.spotT - dt);
      if (this.spotT > 0.7) { this.spotT = 0; this.clue = { x: sx * 0.6 + P.eye.x * 0.4, z: sz * 0.6 + P.eye.z * 0.4, kind: 'light' }; return; }
    } else this.spotT = Math.max(0, this.spotT - dt);
    if ((this.doorScan -= dt) <= 0) {
      this.doorScan = 0.25;
      for (const dr of L.doors) {
        if (dr.barred) continue;
        const c = L.center(dr.cx, dr.cz);
        if (!ahead(c.x, c.z, 11, 0.3)) continue;
        const sg = (dr.axis === 'x' ? Math.sign(this.pos.z - c.z) : Math.sign(this.pos.x - c.x)) || 1;
        const px = c.x + (dr.axis === 'z' ? sg : 0), pz = c.z + (dr.axis === 'x' ? sg : 0);
        if (L.blocked(this.pos.x, this.pos.z, px, pz)) continue;
        const was = this.doorMem.get(dr.id);
        this.doorMem.set(dr.id, dr.open);
        if (was !== undefined && was !== dr.open && dr.touchedAt !== undefined && G.time - dr.touchedAt < 150 && !this.clue)
          this.clue = { x: c.x - (dr.axis === 'z' ? sg * 2.4 : 0), z: c.z - (dr.axis === 'x' ? sg * 2.4 : 0), kind: 'door' }; // the far side
      }
      if (this.clue) return;
    }
    for (const C of G.props.curtains) {
      if (G.time - C.touched > 1.6 || !ahead(C.cx, C.cz, 11, 0.3) || L.blocked(this.pos.x, this.pos.z, C.cx, C.cz, false)) continue;
      C.touched = -99; this.clue = { x: C.cx, z: C.cz, kind: 'curtain' };
      break;
    }
  }

  private peekLine = false;
  private suspicious(x: number, z: number, kind: string) {
    this.target.set(x, 0, z); this.targetKind = kind;
    if (this.state !== 'suspicious') {
      this.to('suspicious'); this.path = [];
      if (kind !== 'bottle' && kind !== 'sight' && this.dist < 16) this.say('v_teoi', 'Te oí. No te hagas el dormido.', 0.5);
    }
  }

  private investigateTarget(n: Noise) {
    if (n.kind === 'bottle' && n.ox !== undefined) {
      if (this.lures >= 2) return { x: n.ox, z: n.oz! };
      this.lures++;
    }
    return { x: n.x, z: n.z };
  }

  // -- brain -----------------------------------------------------------------------
  private think(dt: number) {
    const P = this.game.player;
    const s = this.state;
    const phase = this.game.director.phase;
    const calm = s === 'idle' || s === 'patrol' || s === 'search' || s === 'lightoff' || s === 'leave' || s === 'ambush';
    if (s === 'inspect' && this.awareness >= 1 && this.canSee && !P.inLocker) { this.locker = null; this.toChase(); return; }
    if (calm || s === 'investigate') {
      if (this.awareness >= 1 && this.canSee) { this.toChase(); return; }
      if (this.canSee && this.awareness > 0.35 && s !== 'investigate') { this.suspicious(this.lastSeen.x, this.lastSeen.z, 'sight'); return; }
      if (this.heard && (s !== 'leave' || this.heardS > 0.45)) {
        const tgt = this.investigateTarget(this.heard);
        if (s === 'investigate') { if (this.heardS > 0.3) { this.target.set(tgt.x, 0, tgt.z); this.setGoal(tgt); } }
        else { this.suspicious(tgt.x, tgt.z, this.heard.kind); }
        return;
      }
      if (this.clue && s !== 'investigate') { this.suspicious(this.clue.x, this.clue.z, this.clue.kind); return; }
    }
    switch (s) {
      case 'idle': if (this.t > 1.5) this.nextPatrol(); break;
      case 'patrol': case 'leave':
        if (this.pause) {
          this.pause.t -= dt;
          const st = this.stop;
          if (st?.look && s === 'patrol') this.faceTo(st.look.x, st.look.z, dt, 2.6);
          // checking a bed: she looks at the pillow, not under it, unless something gives you away
          if (st?.bed && s === 'patrol' && !this.pause.checked && this.pause.t < this.pause.dur * 0.5) {
            this.pause.checked = true;
            const inside = P.inLocker === st.bed;
            const tell = inside && (!P.breath.held || P.torch.on || this.R() < 0.1 + 0.08 * phase + 0.04 * this.kindHeat.bed);
            if (tell || (!inside && this.R() < 0.05 + 0.04 * phase + 0.03 * this.kindHeat.bed)) {
              const b = st.bed; this.inspect(b); this.inspectDone = () => this.backToRound();
              break;
            }
          }
          if (this.pause.t <= 0) { const end = this.arrived(); this.endPause(); if (end) this.nextPatrol(); }
          break;
        }
        if (this.arrived()) {
          if (this.hint && !this.looked) { this.looked = true; this.t = 0; }
          if (this.looked) { if (this.t > 2.6) { this.looked = false; this.hint = false; this.nextPatrol(); } }
          else if (s === 'patrol' && this.stop) {
            const st = this.stop, w = st.wait * (phase ? 0.75 : 1) * (this.game.settings.reduced ? 0.8 : 1);
            // a plain look down a corridor sometimes turns into a stare, or the scratch, or the tilt of the head
            const r = this.R();
            const act = st.act !== 'look' || this.game.settings.reduced || r > 0.35 ? st.act : r < 0.15 ? 'stare' : r < 0.27 ? 'scratch' : 'tilt';
            this.startPause(act === 'stare' || act === 'scratch' || act === 'tilt' ? Math.max(w, 2.4) : w, act, st.look);
            if (st.tag === 'bed' && st === this.firstBed()) this.say('v_cuento', 'Cama uno, dormido. Cama dos, dormido. Cama tres…', 0.8);
          } else this.nextPatrol();
          if (s === 'leave' && this.t > 1) this.to('patrol');
        } else if (s === 'patrol' && (this.stopT -= dt) <= 0) {
          // mid-walk she just stops, and stands there looking
          this.stopT = 22 + this.R() * 24;
          if (this.R() < 0.5) this.startPause(2.2 + this.R() * 2.2, 'stare');
        }
        break;
      case 'lightoff':
        if (this.arrived() && this.lamp) {
          if (this.t > 0.8 && this.lamp.on) { this.lamp.on = false; this.game.audio.click(); this.game.onLampOff(this.lamp); }
          if (this.t > 1.6) { this.lamp = null; this.nextPatrol(); this.state = 'patrol'; }
        } else if (!this.lamp) this.nextPatrol();
        break;
      case 'suspicious':
        this.faceTo(this.target.x, this.target.z, dt, 3);
        if (this.awareness >= 1 && this.canSee) { this.toChase(); break; }
        if (this.t > (this.targetKind === 'sight' ? 0.9 : 1.3)) { this.to('investigate'); this.looked = false; this.setGoal(this.target); }
        break;
      case 'investigate':
        if (this.arrived()) {
          if (!this.looked) { this.looked = true; this.t = 0; }
          if (this.t > 2.0) { this.looked = false; this.toSearch(this.target); }
        }
        break;
      case 'search':
        this.searchT -= dt;
        if (this.arrived()) {
          if (!this.looked) { this.looked = true; this.t = 0; }
          if (this.t > (this.cur?.l ? 0.25 : 1.5)) {
            this.looked = false;
            const c = this.cur;
            if (c?.l) { this.checkedAt.set(c.l.id, this.game.time); this.inspect(c.l); this.inspectDone = () => this.continueSearch(); break; }
            this.continueSearch();
          }
        }
        break;
      case 'ambush': this.thinkAmbush(dt); break;
      case 'chase': {
        if (this.canSee) { this.lostT = 0; } else this.lostT += dt;
        // out of sight but loud (running, a door, glass): she follows the sound
        if (!this.canSee && this.heard && this.heardS > 0.3 && this.heard.kind !== 'bottle') { this.lastSeen.set(this.heard.x, 0, this.heard.z); this.lostT = Math.max(0, this.lostT - dt * 1.5); }
        this.repath -= dt;
        if (this.repath <= 0) {
          this.repath = 0.3;
          // not where you were: where you were going
          this.setGoal(this.canSee ? { x: P.pos.x, z: P.pos.z } : this.lostT < 0.45 ? this.lastSeen : this.predict());
        }
        if (this.dist < 1.05 && !P.inLocker && !P.ghost) { this.to('grab'); this.once('grab'); this.game.onGrab(); break; }
        if (this.lostT > (phase ? 4.5 : 3.2) || (this.arrived() && !this.canSee && this.lostT > 0.45)) { T.ev('lost'); this.toSearch(this.predict(), this.lastSeen); }
        break;
      }
      case 'inspect': this.thinkInspect(dt); break;
      case 'script': this.thinkScript(dt); break;
    }
  }

  // under a bed: she squats at its foot and looks along the floor at you. If she saw you crawl in, or you
  // breathe, or your torch is on, she reaches in and drags you out.
  private thinkBed(dt: number, l: Locker, inside: boolean) {
    const P = this.game.player;
    this.faceTo(l.inside.x, l.inside.z, dt, 5);
    this.inspT += dt;
    const tx = l.front.x - l.out.x * 0.15, tz = l.front.z - l.out.z * 0.15, dx = tx - this.pos.x, dz = tz - this.pos.z, dd = Math.hypot(dx, dz);
    if (dd > 0.004) { const st = Math.min(dd, dt * 0.8); this.pos.x += (dx / dd) * st; this.pos.z += (dz / dd) * st; }
    if (this.insp === 'peek' || this.insp === 'open') {
      this.layer.bend.want = 1; this.glintBoost = this.layer.bend.w > 0.7 ? 0.8 : 0;
      if (this.insp === 'peek' && this.inspT > 1.3 && !this.peekLine) { this.peekLine = true; this.say('v_ojitos', 'Cierra los ojitos. No duele.', inside ? 0.6 : 0.3); }
      if (this.insp === 'peek' && inside && this.layer.bend.w > 0.6) {
        if (!P.breath.held) this.notHeld += dt; else this.notHeld = Math.max(0, this.notHeld - dt * 0.5);
        if (P.torch.on) this.notHeld += dt * 0.8; // the beam lies right across the floor in front of her
        if (P.breath.gasped || this.notHeld > 0.8) { this.insp = 'open'; this.inspT = 0; }
      }
      if (this.insp === 'open' && this.inspT > 0.9 && this.layer.bend.w > 0.8) {
        if (inside) { this.heat.set(l.id, (this.heat.get(l.id) ?? 0) + 2); this.to('grab'); this.layer.bend.want = 1; this.game.onGrab(); return; }
        this.insp = 'turn'; this.inspT = 0;
      } else if (this.insp === 'peek' && this.inspT > 3.6 + this.game.director.phase * 0.8) {
        if (inside) { this.lockerHides++; this.closeCall(l); T.ev('safe', l.id); this.game.bark('safe', 'Uf. Casi me hago en los calzones.', 1.6); }
        this.insp = 'turn'; this.inspT = 0;
      }
    } else if (this.insp === 'turn') {
      this.layer.bend.want = 0; this.glintBoost = 0;
      if (this.inspT > 1.4) {
        const cb = this.inspectDone; this.inspectDone = null; this.tutorial = false;
        this.locker = null;
        if (cb) cb(); else this.toSearch(this.pos);
      }
    }
  }

  // She felt something in there: that spot, and that kind of spot, get looked at first next time.
  private closeCall(l: Locker) { this.heat.set(l.id, (this.heat.get(l.id) ?? 0) + 1); this.kindHeat[l.kind] += 0.5; }

  private thinkInspect(dt: number) {
    const l = this.locker!, P = this.game.player;
    const inside = P.inLocker === l;
    if (this.insp === 'approach') {
      if (this.arrived() || Math.hypot(this.pos.x - l.front.x, this.pos.z - l.front.z) < 0.35) {
        this.insp = this.sawEnter ? 'open' : 'peek'; this.inspT = 0; this.path = [];
        if (l.kind === 'bed') { this.layer.bend.want = 1; if (!this.sawEnter) this.say('v_quieto', 'No te muevas… no te muevas.', 0.6); }
        else { this.game.audio.keys({ x: this.pos.x, y: 1.0, z: this.pos.z }); if (this.sawEnter) this.once('open_locker'); } // the key ring on her belt as she leans in
        if (l.kind !== 'bed' && !this.sawEnter) this.say('v_quieto', 'No te muevas… no te muevas.', this.tutorial ? 1 : 0.6);
      }
      return;
    }
    if (l.kind === 'bed') { this.thinkBed(dt, l, inside); return; }
    this.faceTo(l.inside.x, l.inside.z, dt, 5);
    this.inspT += dt;
    // she doesn't look from a polite distance: she steps right up to the vents (and back off to swing the door)
    if (this.insp !== 'turn') {
      const k = this.insp === 'peek' ? -0.3 : -0.18;
      const tx = l.front.x + l.out.x * k, tz = l.front.z + l.out.z * k;
      const dx = tx - this.pos.x, dz = tz - this.pos.z, dd = Math.hypot(dx, dz);
      if (dd > 0.004) { const st = Math.min(dd, dt * (this.insp === 'peek' ? 0.75 : 1.6)); this.pos.x += (dx / dd) * st; this.pos.z += (dz / dd) * st; }
    }
    this.glintBoost = this.insp === 'peek' ? 0.75 : 0;
    if (this.insp === 'peek') {
      const dur = this.tutorial ? 3.3 : 3.4 + this.game.director.phase * 0.8;
      if (inside) {
        if (!P.breath.held) this.notHeld += dt; else this.notHeld = Math.max(0, this.notHeld - dt * 0.5);
        if (P.torch.on) this.notHeld += dt * 0.4; // light leaking through the vents
        if (P.breath.gasped || this.notHeld > (this.tutorial ? 1.5 : 0.85)) { this.insp = 'open'; this.inspT = 0; this.once('open_locker'); return; }
      }
      if (this.inspT > dur) {
        if (inside) { this.lockerHides++; this.closeCall(l); T.ev('safe', l.id); this.game.bark('safe', 'Uf. Casi me hago en los calzones.', 1.6); }
        this.insp = 'turn'; this.inspT = 0;
      }
    } else if (this.insp === 'open') {
      if (this.inspT > 0.45) l.doorTarget = 1.2;
      if (this.inspT > 0.55) {
        if (inside) { this.heat.set(l.id, (this.heat.get(l.id) ?? 0) + 2); this.to('grab'); this.game.onGrab(); return; }
        if (this.inspT > 1.3) { l.doorTarget = 0; this.toSearch(this.pos); }
      }
    } else if (this.insp === 'turn') {
      if (this.inspT > 0.9) {
        const cb = this.inspectDone; this.inspectDone = null; this.tutorial = false;
        this.locker = null;
        if (cb) cb(); else this.toSearch(this.pos);
      }
    }
  }

  private thinkScript(dt: number) {
    const sc = this.script!;
    const st = sc.steps[sc.i];
    if (!st) { const d = sc.done; this.script = null; this.to('patrol'); this.nextPatrol(); d?.(); return; }
    if (sc.t === 0) { st.call?.(); if (st.to) this.setGoal(st.to); }
    sc.t += dt;
    this.glintBoost = st.glint ?? 0;
    if (st.to) { if (this.arrived()) { sc.i++; sc.t = 0; } }
    else if (st.wait !== undefined) {
      if (st.look) { const E = this.game.player.eye; this.faceTo(E.x, E.z, dt, 2.2); }
      if (sc.t > st.wait) { sc.i++; sc.t = 0; }
    } else { sc.i++; sc.t = 0; }
  }

  private toChase() {
    if (this.state !== 'chase') { this.game.onChase(); this.voiceCD = 0; this.say('v_aquiesta', 'Ahí estás.', 0.85); }
    this.to('chase'); this.repath = 0; this.lostT = 0; this.tutorial = false; this.inspectDone = null;
  }
  // Where you were heading when she lost you: along your last seen run, stopped short of the first wall.
  predict() {
    const L = this.game.level, v = this.seenVel, sp = Math.hypot(v.x, v.z);
    if (sp < 0.4) return { x: this.lastSeen.x, z: this.lastSeen.z };
    const ux = v.x / sp, uz = v.z / sp, want = Math.min(7, 1.5 + sp * 1.4);
    const d = Math.max(0, L.rayDist(this.lastSeen.x, this.lastSeen.z, ux, uz, want) - 0.6);
    return { x: this.lastSeen.x + ux * d, z: this.lastSeen.z + uz * d };
  }
  // A search is a plan, not a wander: first the spot itself, then the hiding places around it, best guess first —
  // the way you were going, the ones you used before, the kind you like — with a corner or two to look into.
  private toSearch(c: { x: number; z: number }, from?: { x: number; z: number }) {
    if (this.state === 'chase') { if (this.R() < 0.5) this.say('v_ahi', 'Yo sé que estás ahí.', 0.8); else this.say('v_cama', 'Shhh… ¿Qué haces fuera de la cama?', 0.8); }
    this.to('search'); this.searchCenter.set(c.x, 0, c.z);
    this.searchT = 16 + this.R() * 6 + this.game.director.phase * 6;
    this.spots = this.searchSpots(c, from); this.cur = null;
    this.setGoal(c);
  }
  private searchSpots(c: { x: number; z: number }, from?: { x: number; z: number }) {
    const G = this.game, L = G.level;
    const hx = from ? c.x - from.x : 0, hz = from ? c.z - from.z : 0, hl = Math.hypot(hx, hz);
    const hides = G.props.lockers.map(l => {
      const d = Math.hypot(l.front.x - c.x, l.front.z - c.z);
      if (d > 10 || G.time - (this.checkedAt.get(l.id) ?? -99) < 25) return null;
      const dir = hl > 0.3 ? Math.max(0, ((l.front.x - c.x) * hx + (l.front.z - c.z) * hz) / (d * hl + 1e-6)) : 0;
      const score = (1 / (1 + d * 0.35)) * (1 + 0.6 * dir) * (1 + 0.9 * (this.heat.get(l.id) ?? 0) + 0.35 * this.kindHeat[l.kind]) * (L.occlusion(c.x, c.z, l.front.x, l.front.z) > 0.7 ? 0.45 : 1);
      return { x: l.front.x, z: l.front.z, l, score };
    }).filter((h): h is { x: number; z: number; l: Locker; score: number } => !!h).sort((a, b) => b.score - a.score);
    const out: { x: number; z: number; l?: Locker }[] = hides.slice(0, 3 + G.director.phase);
    const ux = hl > 0.3 ? hx / hl : 0, uz = hl > 0.3 ? hz / hl : 0;
    for (let k = 0; k < 2; k++) {
      const p = L.randomNear(c.x + ux * 2.5, c.z + uz * 2.5, 2, 6, this.R);
      if (p) out.splice(Math.min(out.length, 1 + k * 2), 0, p);
    }
    return out;
  }
  private continueSearch() {
    if (this.state !== 'search') { this.state = 'search'; this.t = 0; this.looked = false; }
    const next = this.spots.shift();
    if (!next || this.searchT <= 0) { this.endSearch(); return; }
    this.cur = next; this.setGoal(next.l ? next.l.front : next);
  }
  private endSearch() {
    const G = this.game, phase = G.director.phase;
    const p = 0.3 + 0.25 * phase + Math.min(0.2, (this.kindHeat.locker + this.kindHeat.bed) * 0.04);
    if (G.time - this.lastAmbush > 45 && this.R() < p) { this.toAmbush(this.searchCenter); return; }
    this.backToRound();
  }
  backToRound() { this.to('patrol'); this.nextPatrol(); }
  // The false exit: she walks off humming as if the round went on, stops dead out of sight, waits in silence
  // facing where she lost you, then comes back for one more look.
  private toAmbush(c: THREE.Vector3) {
    const L = this.game.level;
    let away: { x: number; z: number } | null = null;
    for (let k = 0; k < 14 && !away; k++) { const p = L.randomNear(c.x, c.z, 7, 11, this.R); if (p && L.blocked(c.x, c.z, p.x, p.z) && L.path(this.pos.x, this.pos.z, p.x, p.z)) away = p; }
    away ??= L.randomNear(c.x, c.z, 7, 11, this.R);
    if (!away) { this.backToRound(); return; }
    this.lastAmbush = this.game.time;
    this.to('ambush'); this.amb = { phase: 'away', t: 0, c: c.clone(), wait: 6 + this.R() * 5 + this.game.director.phase * 3 };
    this.setGoal(away);
  }
  private thinkAmbush(dt: number) {
    const a = this.amb;
    if (!a) { this.backToRound(); return; }
    a.t += dt;
    if (a.phase === 'away') { if (this.arrived() || a.t > 10) { a.phase = 'wait'; a.t = 0; this.path = []; } }
    else if (a.phase === 'wait') { this.faceTo(a.c.x, a.c.z, dt, 1.6); if (a.t > a.wait) { a.phase = 'back'; a.t = 0; this.setGoal(a.c); } }
    else if (this.arrived() || a.t > 12) { const c = a.c; this.amb = null; this.toSearch(c); this.searchT = 8; this.spots = this.spots.slice(0, 2); }
  }
  private firstBed() { return this.round.find(r => r.bed) && (this.rdir > 0 ? this.round.find(r => r.bed) : [...this.round].reverse().find(r => r.bed)); }

  // Her round, built from the floor itself: the main corridor, the ward bed by bed, the nurses' station, the north
  // corridor, the dayroom and its television, and back. Once the fuse is gone she walks it to the linen room and
  // reception instead, the way you will have to come back.
  private buildRound() {
    const G = this.game, L = G.level, phase = G.director.phase;
    const at = (cx: number, cz: number, wait: number, act: string, tag: string, look?: [number, number, number?]): Stop =>
      ({ ...L.center(cx, cz), wait, act, tag, look: look ? { x: look[0], y: look[2] ?? 1.3, z: look[1] } : undefined });
    const ward = AREAS.find(a => a.id === 'ward')!;
    const inWard = (v: THREE.Vector3) => { const cx = Math.floor(v.x / 2), cz = Math.floor(v.z / 2); return cx >= ward.x0 && cx <= ward.x1 && cz >= ward.z0 && cz <= ward.z1; };
    const mx = ward.x0 + ward.x1 + 1, mz = ward.z0 + ward.z1 + 1, door = L.center(13, 10);
    let beds = G.props.lockers.filter(l => l.kind === 'bed' && inWard(l.inside)).sort((a, b) => Math.atan2(a.inside.x - mx, a.inside.z - mz) - Math.atan2(b.inside.x - mx, b.inside.z - mz));
    const near = beds.reduce((bi, b, i) => Math.hypot(b.front.x - door.x, b.front.z - door.z) < Math.hypot(beds[bi].front.x - door.x, beds[bi].front.z - door.z) ? i : bi, 0);
    beds = [...beds.slice(near), ...beds.slice(0, near)];
    const bedStops: Stop[] = beds.map(b => ({ x: b.front.x + b.out.x * 0.75, z: b.front.z + b.out.z * 0.75, wait: 1.7, act: 'check', tag: 'bed', bed: b, look: { x: b.inside.x * 0.6 + b.front.x * 0.4, y: 0.6, z: b.inside.z * 0.6 + b.front.z * 0.4 } }));
    const corridorN = at(15, 7, 1.2, 'look', 'corridor', [31, 40]);
    const station = at(8, 9, 3.2, 'write', 'station', [17.5, 21, 0.8]);
    const corridorS = at(16, 15, 1.8, 'look', 'corridor', [31, 42]);
    this.round = phase === 0
      ? [corridorN, ...bedStops, station, at(9, 4, 1.0, 'look', 'north', [44, 9]), at(24, 4, 1.4, 'look', 'north', [51, 12]),
        at(26, 9, 2.4, 'check', 'tv', [57, 19, 1.0]), at(19, 9, 1.4, 'look', 'dayroom', [35, 21]), corridorS]
      : [corridorN, ...bedStops, station, at(6, 17, 2.6, 'check', 'linen', [15, 33, 1.1]), at(14, 20, 2.2, 'look', 'reception', [23, 41]), corridorS];
    this.roundPhase = phase; this.ri = -1; this.offRound = true;
  }
  nextPatrol() {
    const phase = this.game.director.phase;
    if (!this.round.length || this.roundPhase !== phase) this.buildRound();
    if (this.state !== 'leave') this.state = 'patrol';
    const n = this.round.length;
    let i: number;
    if (this.offRound || this.ri < 0) {
      // coming back to the round from elsewhere: pick it up at the nearest stop, going the way she was going
      i = 0; let bd = Infinity;
      this.round.forEach((r, k) => { const d = Math.hypot(r.x - this.pos.x, r.z - this.pos.z); if (d < bd) { bd = d; i = k; } });
      if (bd < 1.2) i = Math.max(0, Math.min(n - 1, i + this.rdir));
      this.offRound = false;
    } else {
      i = this.ri + this.rdir;
      if (i < 0 || i >= n) { this.rdir = -this.rdir; this.rounds++; i = this.ri + this.rdir; } // the next round, the other way
    }
    this.ri = i; this.stop = this.round[i];
    this.setGoal(this.stop);
  }

  private faceTo(x: number, z: number, dt: number, rate: number) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }

  // -- locomotion ----------------------------------------------------------------
  private move(dt: number) {
    const s = this.state;
    const phase = this.game.director.phase;
    let sp = 0;
    if (s === 'patrol' || s === 'lightoff') sp = this.hint ? 1.0 : 1.05;
    else if (s === 'leave') sp = 1.3;
    else if (s === 'investigate') sp = 1.4 + phase * 0.25;
    else if (s === 'search') sp = 1.15 + phase * 0.15;
    else if (s === 'ambush') sp = this.amb?.phase === 'back' ? 1.6 : this.amb?.phase === 'away' ? 1.05 : 0;
    else if (s === 'chase') sp = Math.min(3.35 + phase * 0.35 + this.t * 0.06, 3.9 + phase * 0.3);
    else if (s === 'inspect' && this.insp === 'approach') sp = this.sawEnter ? 2.6 : 1.3;
    else if (s === 'script') sp = this.script?.steps[this.script.i]?.speed ?? 1.2;
    if (this.looked || this.pause || s === 'suspicious' || s === 'grab' || s === 'frozen' || s === 'idle') sp = 0;
    if (this.doorWait > 0) { this.doorWait -= dt; sp = 0; }
    if (sp <= 0 || this.arrived()) { this.speed += (0 - this.speed) * Math.min(1, dt * 8); return; }
    const L = this.game.level;
    const wp = this.path[this.pi];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.3) { this.pi++; return; }
    // open doors ahead
    const ax = this.pos.x + (dx / d) * 0.95, az = this.pos.z + (dz / d) * 0.95;
    const c = L.at(ax, az);
    if (c?.kind === 'door' && !c.door!.open && !c.door!.barred) {
      this.game.level.openDoor(c.door!, this.pos); this.doorMem.set(c.door!.id, true); this.doorWait = s === 'chase' ? 0.18 : 0.5;
      const dp = L.center(c.cx, c.cz);
      const occ = L.occlusion(dp.x, dp.z, this.game.player.pos.x, this.game.player.pos.z);
      if (s === 'chase') this.game.audio.doorSlam({ x: dp.x, y: 1.2, z: dp.z }, occ); else this.game.audio.doorCreak({ x: dp.x, y: 1.2, z: dp.z }, occ);
      this.game.subtitle(s === 'chase' ? 'Una puerta se abre de golpe' : 'Cruje una puerta', { x: dp.x, z: dp.z });
      return;
    }
    this.faceTo(wp.x, wp.z, dt, s === 'chase' ? 7 : 3.2);
    const target = sp;
    this.speed += (target - this.speed) * Math.min(1, dt * (s === 'chase' ? 3 : 4));
    const step = Math.min(d, this.speed * dt);
    this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step;
    L.collide(this.pos, 0.3);
    // stuck guard
    if (d > this.lastD - 0.01) this.stuckT += dt; else this.stuckT = 0;
    this.lastD = d;
    if (this.stuckT > 1.6) {
      this.stuckT = 0;
      const g = this.goal;
      if (g && Math.hypot(g.x - this.pos.x, g.z - this.pos.z) < 1.6 && ++this.stuckN >= 2) { this.stuckN = 0; this.pi = this.path.length; return; }
      if (g) this.setGoal(g);
      const P = this.game.player;
      if (!this.visibleFrom(P.pos.x, P.pos.z, P.fwd.x, P.fwd.z)) { const n = this.path[this.pi]; if (n) { this.pos.x += (n.x - this.pos.x) * 0.3; this.pos.z += (n.z - this.pos.z) * 0.3; } }
    }
  }

  // -- presentation --------------------------------------------------------------
  private present(dt: number) {
    const s = this.state, A = this.game.audio, P = this.game.player;
    // animation choice
    if (this.oneShot) {
      const a = this.rig.actions.get(this.oneShot)!;
      if (!a.isRunning() && a.time >= a.getClip().duration - 0.01 && this.oneShot !== 'grab' && this.oneShot !== 'open_locker') this.oneShot = '';
    }
    if (!this.oneShot) {
      if (s === 'inspect' && this.insp === 'peek' && this.locker?.kind !== 'bed') this.play('peek_locker');
      else if (s === 'suspicious') this.play('listen');
      else if (this.looked) this.play('turn_head');
      else if (this.speed > 2.0) this.play('run', 0.2, this.speed / 3.6);
      else if (this.speed > 0.12) this.play(s === 'investigate' || s === 'search' || this.hint || (s === 'ambush' && this.amb?.phase === 'back') ? 'walk_search' : 'walk', 0.3, Math.max(0.5, this.speed / 1.05));
      else this.play('idle', 0.4);
      this.twitchT -= dt;
      if (this.twitchT <= 0 && this.speed < 0.2 && !this.game.settings.reduced && (s === 'idle' || s === 'patrol' || s === 'search')) {
        this.twitchT = (this.game.director.phase ? 7 : 12) + this.R() * 10; this.once('twitch');
      }
    }
    // occasional stepped (12 fps) motion
    this.stepT -= dt;
    let stepped = false;
    if (this.stepT < 0) { stepped = true; if (this.stepT < -(0.5 + this.R() * 0.9)) this.stepT = 9 + this.R() * 12; }
    if (s === 'chase' || this.game.settings.reduced) stepped = false;
    if (stepped) { this.stepClock += dt; if (this.stepClock >= 1 / 12) { this.mix(this.stepClock); this.stepClock = 0; } }
    else { this.mix(dt + this.stepClock); this.stepClock = 0; }
    // when she can see you, her head stays on you (even running)
    if (!this.pause && s !== 'frozen' && s !== 'script' && s !== 'inspect') {
      const watch = this.canSee && (s === 'chase' || s === 'suspicious' || s === 'investigate' || s === 'search');
      this.lookWant = watch ? 1 : 0; if (watch) this.lookAt.copy(P.eye);
    }
    this.applyLayers(dt);

    // a slight dip of the knees when she bends to the vents, so her eyes meet yours in the slit
    this.peekDip += ((s === 'inspect' && this.insp === 'peek' ? 1 : 0) - this.peekDip) * Math.min(1, dt * 3);
    this.rig.root.position.copy(this.pos);
    this.rig.root.position.y -= 0.07 * this.peekDip + BEND_DROP * this.layer.bend.w;
    this.rig.root.rotation.y = this.yaw;
    // IV stand: walking, she pushes it with her right hand; running, it rattles along at her side; stopped,
    // it stays where she let go of it
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    let ivx = this.pos.x + rx * 0.42 - Math.sin(this.yaw) * 0.05, ivz = this.pos.z + rz * 0.42 - Math.cos(this.yaw) * 0.05;
    const hand = this.handR ?? (this.handR = this.rig.root.getObjectByName('hand_r') ?? null);
    if (hand && (this.anim === 'walk' || this.anim === 'walk_search')) { hand.getWorldPosition(this.lh); ivx = this.lh.x + Math.sin(this.yaw) * 0.04; ivz = this.lh.z + Math.cos(this.yaw) * 0.04; }
    else if (hand && this.anim !== 'run' && Math.hypot(this.iv.position.x - this.pos.x, this.iv.position.z - this.pos.z) < 1.3) { ivx = this.iv.position.x; ivz = this.iv.position.z; }
    if (Math.hypot(ivx - this.iv.position.x, ivz - this.iv.position.z) > 2) this.iv.position.set(ivx, this.iv.position.y, ivz); // teleported
    this.iv.position.x += (ivx - this.iv.position.x) * Math.min(1, dt * 9);
    this.iv.position.z += (ivz - this.iv.position.z) * Math.min(1, dt * 9);
    this.iv.rotation.z = Math.sin(this.game.time * 7) * 0.02 * Math.min(1, this.speed) + (s === 'chase' ? Math.sin(this.game.time * 19) * 0.08 : 0);

    // audio
    const head = this.rig.head.getWorldPosition(new THREE.Vector3());
    const occ = this.game.level.occlusion(this.pos.x, this.pos.z, P.eye.x, P.eye.z);
    A.nurse({ x: head.x, y: head.y, z: head.z }, occ);
    const hum = s === 'script' ? this.humWant
      : s === 'patrol' || s === 'leave' || s === 'lightoff' || s === 'idle' || (s === 'ambush' && this.amb?.phase === 'away');
    if (hum !== this.wasHumming) {
      A.hum(hum);
      if (!hum && this.dist < 16 && occ < 2) this.game.subtitle('El tarareo se detiene');
      if (hum && this.dist < 26) this.game.subtitle('Tarareo', { x: this.pos.x, z: this.pos.z });
      this.wasHumming = hum;
    }
    if (this.speed > 0.15) {
      this.squeakT -= dt * this.speed;
      if (this.squeakT <= 0) {
        this.squeakT = s === 'chase' ? 0.5 : 0.7 + this.R() * 0.9;
        A.squeak(); if (s === 'chase' || this.R() < 0.25) A.rattle();
        this.game.subtitleThrottled('iv', s === 'chase' ? 'Traquetea un portasueros' : 'Rechina un portasueros', { x: this.pos.x, z: this.pos.z }, 9);
      }
    }
    A.herBreath(dt, A.herNear, s !== 'chase');
    this.stepAcc += this.speed * dt;
    if (this.stepAcc > (s === 'chase' ? 0.75 : 0.6)) { this.stepAcc = 0; A.nurseStep(s === 'chase' ? 1.6 : 1); }

    // eye glints: torchlight bouncing back, before you see the rest of her
    let k = 0;
    if (P.torch.on && !this.game.level.blocked(P.torch.pos.x, P.torch.pos.z, head.x, head.z)) {
      const vx = head.x - P.torch.pos.x, vy = head.y - P.torch.pos.y, vz = head.z - P.torch.pos.z, d = Math.hypot(vx, vy, vz);
      const c = (vx * P.torch.dir.x + vy * P.torch.dir.y + vz * P.torch.dir.z) / d;
      const cone = THREE.MathUtils.smoothstep(c, P.torch.cos * 0.985, Math.min(1, P.torch.cos + 0.08));
      k = cone * Math.max(0, 1 - d / (P.torch.range * 1.6)) * (0.8 + P.torch.level * 0.25);
    }
    const tx = P.eye.x - head.x, tz = P.eye.z - head.z, tl = Math.hypot(tx, tz) || 1;
    const facing = (tx * Math.sin(this.yaw) + tz * Math.cos(this.yaw)) / tl;
    k *= THREE.MathUtils.smoothstep(facing, 0.15, 0.7);
    k = Math.max(k, this.glintBoost);
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blinking = 0.13; this.blinkT = 2.5 + this.R() * 5; }
    if (this.blinking > 0) this.blinking -= dt;
    this.glintLevel += (k - this.glintLevel) * Math.min(1, dt * 10);
    const dist = Math.hypot(head.x - P.eye.x, head.z - P.eye.z);
    for (const g of this.rig.glints) {
      (g.material as THREE.SpriteMaterial).opacity = Math.min(1, this.glintLevel * 1.3);
      const sc = (0.025 + 0.06 * this.glintLevel) * (0.12 + dist * 0.175); // pin-points up close, still findable down a corridor
      g.scale.set(sc, this.blinking > 0 ? sc * 0.08 : sc, 1);
      // sit 3 cm in front of the eye, toward you, so the lids and lashes never swallow it
      const par = g.parent;
      if (par && par.name.startsWith('glint')) {
        par.getWorldPosition(this.gw); this.gv.copy(P.eye).sub(this.gw).setLength(0.03).add(this.gw);
        g.position.copy(par.worldToLocal(this.gv));
      }
    }
    for (const m of this.rig.morphs) {
      const inf = m.mesh.morphTargetInfluences!;
      if (m.dict.blink !== undefined) inf[m.dict.blink] = this.blinking > 0 ? 1 : 0;
      if (m.dict.eyes_wide !== undefined) inf[m.dict.eyes_wide] += ((s === 'chase' || s === 'suspicious' ? 1 : 0) - inf[m.dict.eyes_wide]) * Math.min(1, dt * 6);
      if (m.dict.mouth_open !== undefined) inf[m.dict.mouth_open] += ((A.humming ? 0.15 : 0) - inf[m.dict.mouth_open]) * Math.min(1, dt * 4);
      if (m.dict.scream !== undefined) inf[m.dict.scream] += ((s === 'grab' ? 1 : 0) - inf[m.dict.scream]) * Math.min(1, dt * 8);
    }
  }

  // She speaks rarely: a recorded line from where she stands, captioned, never twice in a row.
  private lastLine = ''; private reflexT = -99;
  say(name: string, text: string, chance = 1) {
    if (this.voiceCD > 0 || name === this.lastLine || this.R() > chance || this.game.settings.reduced && name === 'v_aquiesta') return false;
    if (!this.game.audio.voiceLine(name)) return false;
    this.voiceCD = 9 + this.R() * 8; this.lastLine = name;
    this.game.speech(text, { x: this.pos.x, z: this.pos.z });
    // a reflex: when her voice comes from somewhere close you can't see, your head turns a little toward it
    const P = this.game.player;
    if (!P.inLocker && this.dist < 10 && this.game.time - this.reflexT > 25 && !['chase', 'grab', 'inspect'].includes(this.state) && !this.game.dressing.ex.visible(this.rig.head.getWorldPosition(new THREE.Vector3()))) { this.reflexT = this.game.time; P.focusOn(this.rig.head.getWorldPosition(new THREE.Vector3()), 1.0, 0.3, false); }
    return true;
  }

  update(dt: number, noises: Noise[]) {
    this.t += dt;
    this.voiceCD -= dt;
    if (this.state === 'patrol' && this.dist < 19 && this.R() < dt * 0.05) {
      const pool: [string, string][] = [['v_visitas', 'Las visitas eran hasta las ocho.'], ['v_dormir', 'Ya es hora de dormir.'], ['v_rezo', 'Dios te salve, María, llena eres de gracia…']];
      const [n, t] = pool[Math.floor(this.R() * pool.length)];
      this.say(n, t);
    }
    if (this.state === 'search' && this.t > 2.5 && this.dist < 22 && this.R() < dt * 0.07) {
      const pool: [string, string][] = [['v_mijito', '¿Mijito? ¿Dónde te metiste?'], ['v_frio', 'Vuelve a la cama, que te vas a resfriar.'], ['v_cama', 'Shhh… ¿Qué haces fuera de la cama?']];
      const [n, t] = pool[Math.floor(this.R() * pool.length)];
      this.say(n, t);
    }
    if (this.state === 'frozen') { this.present(dt); return; }
    if (this.state !== 'script' && this.state !== 'grab') this.sense(dt, noises);
    else { const P = this.game.player; this.dist = Math.hypot(P.eye.x - this.pos.x, P.eye.z - this.pos.z); }
    this.think(dt);
    this.move(dt);
    this.present(dt);
  }
}

// ---------------------------------------------------------------------------
// Director: always knows where the player is, never tells the Nurse exactly.
export class Director {
  menace = 0; hintT = 40; phase = 0; highT = 0; cooldown = 0; R = rng(7);
  constructor(private game: Game) { }
  update(dt: number) {
    const N = this.game.nurse, P = this.game.player, G = this.game;
    if (N.state === 'script' || N.state === 'frozen' || N.state === 'grab') return;
    const near = N.dist < 12;
    if (N.state === 'chase') this.menace += dt * 18;
    else if (near && N.canSee) this.menace += dt * 10;
    else if (near) this.menace += dt * 3.5;
    else this.menace -= dt * 4;
    this.menace = Math.max(0, Math.min(100, this.menace));
    if (this.menace > 72 && N.state !== 'chase' && N.state !== 'inspect') this.highT += dt; else this.highT = 0;
    if (this.highT > 9) { N.sendAway(); this.highT = 0; this.menace = 40; this.cooldown = 22; }
    if (this.cooldown > 0) this.cooldown -= dt;
    this.hintT -= dt;
    if (this.hintT <= 0) {
      this.hintT = this.phase ? 24 + this.R() * 14 : 55 + this.R() * 25;
      if (N.state === 'patrol' && this.cooldown <= 0 && !G.story.safe()) {
        const p = G.level.randomNear(P.pos.x, P.pos.z, this.phase ? 3 : 5, this.phase ? 8 : 11, this.R);
        if (p) N.hintTo(p);
      }
    }
    for (const l of G.props.lamps) {
      if (l.on && l.onTime > (this.phase ? 12 : 24) && N.state === 'patrol' && !N.lamp) { N.switchOff(l); break; }
    }
  }
}
