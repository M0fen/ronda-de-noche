// The end of the first part. The power comes back, and with it what the porters had kept locked in Cirugía: a
// tall doctor pushing a gurney, and under the sheet a second nurse with a syringe of colours. One shot in first
// person, staged on a timeline (seconds) and played in the engine: the same code replays, skips, and steps
// without rendering for tests (__NR.simulate).
//
// Lights: the scene's light count never changes (that would recompile every shader mid-scene). The finale
// borrows lights that are already there (the breaker room's emergency lamp, the amber beacon over its door, two
// corridor lamps, the torch's bounce) and gives them back afterwards.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Game } from './game';
import type { Rig, Pose } from './nurse';
import type { EmLight } from './props';
import { rng } from './textures';

const DEG = Math.PI / 180;
const cl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (a: number, b: number, x: number) => { const t = cl((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---- people -------------------------------------------------------------------------------------------
const BONES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];

/** A copy of la Jefa's rig with its own skeleton, clips and the same pose layer she uses (nurse.ts). */
export class Actor {
  root = new THREE.Group(); model: THREE.Object3D; mixer: THREE.AnimationMixer;
  actions = new Map<string, THREE.AnimationAction>(); anim = '';
  bone = new Map<string, THREE.Object3D>(); head: THREE.Object3D; glints: THREE.Sprite[] = [];
  pose: Pose = {};                                   // this frame's layer, degrees (see POSES in nurse.ts)
  look = new THREE.Vector3(); lookW = 0;             // look-at, shared by spine, neck and head
  boneScale: Record<string, [number, number, number]> = {};
  hip = new THREE.Vector3();                         // the hip joint in the actor's own space, standing
  private lb: { name: string; b: THREE.Object3D; anim: THREE.Quaternion; w: THREE.Quaternion }[] = [];
  private m = new THREE.Matrix4(); private mi = new THREE.Matrix4(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private e = new THREE.Euler(); private q = new THREE.Quaternion(); private d = new THREE.Quaternion(); private h = new THREE.Vector3();

  constructor(src: Rig, scale = 1) {
    this.model = cloneSkinned(src.root);
    this.model.position.set(0, 0, 0); this.model.rotation.set(0, 0, 0); this.model.scale.setScalar(scale); this.model.visible = true;
    this.root.add(this.model);
    this.model.traverse((o: any) => {
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; }
      if (o.isSprite) { o.material = o.material.clone(); o.material.opacity = 0; this.glints.push(o); }
      if (BONES.includes(o.name) && !this.bone.has(o.name)) this.bone.set(o.name, o);
    });
    this.head = this.bone.get('head') ?? this.model;
    this.eyeL = this.model.getObjectByName('glint_L'); this.eyeR = this.model.getObjectByName('glint_R');
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, a] of src.actions) this.actions.set(name, this.mixer.clipAction(a.getClip()));
    for (const n of BONES) { const b = this.bone.get(n); if (b) this.lb.push({ name: n, b, anim: b.quaternion.clone(), w: new THREE.Quaternion() }); }
    this.play('idle', 0); this.mixer.update(0);
    for (const v of this.lb) v.anim.copy(v.b.quaternion);
    this.root.updateMatrixWorld(true);
    const pel = this.bone.get('pelvis');
    if (pel) { pel.getWorldPosition(this.hip); this.root.worldToLocal(this.hip); } else this.hip.set(0, 0.95 * scale, 0);
  }
  play(name: string, fade = 0.3, scale = 1) {
    const a = this.actions.get(name); if (!a) return;
    a.timeScale = scale;
    if (this.anim === name) return;
    const prev = this.actions.get(this.anim);
    a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.play();
    if (prev && fade > 0) a.crossFadeFrom(prev, fade, false); else prev?.stop();
    this.anim = name;
  }
  /** a point on the actor in the world, from a point in its own (standing) space */
  at(local: THREE.Vector3, out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return out.copy(local).applyMatrix4(this.root.matrixWorld); }
  /** put the hip joint at `hip` (world), facing `yaw`, pitched about its own x axis (−90°: on its back) */
  placeHip(hip: THREE.Vector3, yaw: number, pitch = 0) {
    this.root.rotation.set(pitch, yaw, 0, 'YXZ');
    this.root.updateMatrix();
    this.v.copy(this.hip).applyQuaternion(this.root.quaternion);
    this.root.position.copy(hip).sub(this.v);
  }
  stand(x: number, z: number, yaw: number) { this.root.rotation.set(0, yaw, 0, 'YXZ'); this.root.position.set(x, 0, z); }
  headPos(out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return this.head.getWorldPosition(out); }
  private eyeL?: THREE.Object3D; private eyeR?: THREE.Object3D;
  /** between the eyes: what a close-up frames */
  eyes(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    if (!this.eyeL || !this.eyeR) return this.head.getWorldPosition(out);
    return this.eyeL.getWorldPosition(out).add(this.eyeR.getWorldPosition(this.h)).multiplyScalar(0.5);
  }

  update(dt: number) {
    for (const v of this.lb) v.b.quaternion.copy(v.anim);
    this.mixer.update(dt);
    for (const v of this.lb) v.anim.copy(v.b.quaternion);
    const acc: Record<string, [number, number, number]> = {};
    for (const k in this.pose) { const p = this.pose[k]; acc[k] = [p[0], p[1], p[2]]; }
    const add = (k: string, x: number, y: number, z: number) => { const a = acc[k] ?? (acc[k] = [0, 0, 0]); a[0] += x; a[1] += y; a[2] += z; };
    this.root.updateMatrixWorld(true);
    if (this.lookW > 0.002) {
      // where to look, in the actor's own space: spine, neck and head share the turn
      const t = this.v.copy(this.look); this.root.worldToLocal(t);
      this.head.getWorldPosition(this.h); this.root.worldToLocal(this.h);
      const lx = t.x - this.h.x, ly = t.y - this.h.y, lz = t.z - this.h.z;
      const yaw = THREE.MathUtils.clamp(Math.atan2(lx, lz), -1.75, 1.75) / DEG, pitch = THREE.MathUtils.clamp(Math.atan2(ly, Math.max(0.25, Math.hypot(lx, lz))), -0.9, 0.7) / DEG;
      const w = this.lookW;
      add('spine_03', -pitch * 0.1 * w, yaw * 0.18 * w, 0); add('neck_01', -pitch * 0.35 * w, yaw * 0.34 * w, 0); add('head', -pitch * 0.55 * w, yaw * 0.48 * w, 0);
    }
    this.mi.copy(this.root.matrixWorld).invert();
    for (const v of this.lb) if (acc[v.name]) this.m.multiplyMatrices(this.mi, v.b.matrixWorld).decompose(this.v, v.w, this.s);
    for (const v of this.lb) {
      const a = acc[v.name]; if (!a) continue;
      this.q.setFromEuler(this.e.set(a[0] * DEG, a[1] * DEG, a[2] * DEG, 'YXZ'));
      this.d.copy(v.w).invert().multiply(this.q).multiply(v.w);
      v.b.quaternion.multiply(this.d);
    }
    for (const k in this.boneScale) { const b = this.bone.get(k); if (b) b.scale.set(...this.boneScale[k]); }
  }
}

const tint = (m: THREE.Material, c: [number, number, number]) => { const n = (m as THREE.MeshStandardMaterial).clone(); n.color.setRGB(...c); return n; };
function restyle(a: Actor, f: (mesh: THREE.Mesh, name: string) => void) {
  a.model.traverse((o: any) => { if (o.isMesh) f(o, (o.material as THREE.Material).name || o.name); });
}

// cloth with folds and old stains, for the gown
function gownTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d')!; const R = rng(1992);
  g.fillStyle = '#7f9e8e'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 26; i++) { const x = R() * 128, w = 2 + R() * 7; const gr = g.createLinearGradient(x - w, 0, x + w, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, R() < 0.5 ? 'rgba(20,40,32,0.28)' : 'rgba(220,240,228,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - w, 0, w * 2, 256); }
  for (let i = 0; i < 7; i++) { const x = 18 + R() * 92, y = 120 + R() * 120, r = 4 + R() * 16; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(70,22,16,0.75)'); gr.addColorStop(0.7, 'rgba(80,30,20,0.35)'); gr.addColorStop(1, 'rgba(80,30,20,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 0.7, r * 1.4, 0, 0, 7); g.fill(); }
  for (let i = 0; i < 5; i++) { const x = 20 + R() * 88; g.strokeStyle = 'rgba(66,20,14,0.55)'; g.lineWidth = 1 + R() * 2; g.beginPath(); g.moveTo(x, 150 + R() * 40); g.lineTo(x + (R() - 0.5) * 6, 200 + R() * 56); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// a surgeon's rubber apron, wet-dark, with what has dried on it
function apronTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d')!; const R = rng(1203);
  g.fillStyle = '#2a2622'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 18; i++) { const x = R() * 128, w = 3 + R() * 9; const gr = g.createLinearGradient(x - w, 0, x + w, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, R() < 0.6 ? 'rgba(0,0,0,0.35)' : 'rgba(120,110,100,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - w, 0, w * 2, 256); }
  for (let i = 0; i < 9; i++) { const x = 14 + R() * 100, y = 60 + R() * 170, r = 6 + R() * 18; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(92,20,14,0.85)'); gr.addColorStop(0.6, 'rgba(70,16,10,0.45)'); gr.addColorStop(1, 'rgba(70,16,10,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 0.8, r * 1.3, 0, 0, 7); g.fill(); }
  for (let i = 0; i < 7; i++) { const x = 16 + R() * 96; g.strokeStyle = 'rgba(80,16,10,0.7)'; g.lineWidth = 1 + R() * 2.5; g.beginPath(); g.moveTo(x, 110 + R() * 60); g.lineTo(x + (R() - 0.5) * 5, 190 + R() * 66); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** El doctor: two metres in a surgeon's gown, cap and mask, a rubber apron, a head mirror where his eyes should be */
function dressDoctor(a: Actor, glintTex: THREE.Texture) {
  const green: [number, number, number] = [0.52, 0.7, 0.62];
  restyle(a, (m, n) => {
    if (n === 'Jefa_cofia' || n === 'Jefa_cruz' || n === 'Jefa_pelo' || /cofia|pelo/i.test(m.name)) m.visible = false;
    else if (n === 'Jefa_uniforme' || /elegantsuit/i.test(m.name)) m.material = tint(m.material as THREE.Material, green);
    else if (n === 'Jefa_tapabocas') m.material = tint(m.material as THREE.Material, [0.62, 0.8, 0.72]);
    else if (n === 'Jefa_piel') m.material = tint(m.material as THREE.Material, [0.86, 0.88, 0.84]);
  });
  // the sigil decals live on the cap and the uniform; the cap's goes with the cap
  a.model.traverse((o: any) => { if (o.isMesh && /sigil/i.test(o.name) && o.parent?.name === 'Jefa_cofia') o.visible = false; });
  a.root.updateMatrixWorld(true);
  const gl = a.model.getObjectByName('glint_L'), gr = a.model.getObjectByName('glint_R');
  const eyes = new THREE.Vector3();
  if (gl && gr) eyes.copy(gl.getWorldPosition(new THREE.Vector3())).add(gr.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  else a.head.getWorldPosition(eyes).add(V(0, 0.06, 0.08));
  const sc = a.model.scale.x;
  const lam = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
  const capM = lam({ color: 0x5f8a7a, side: THREE.DoubleSide });
  // surgical cap: a soft dome over the skull
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.118 * sc, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), capM);
  cap.position.copy(eyes).add(V(0, 0.06 * sc, -0.07 * sc)); cap.scale.set(0.98, 0.8, 1.1); cap.rotation.x = -0.2; cap.castShadow = true;
  a.head.attach(cap);
  // head mirror: a concave disc on a band, over the brow
  const mirM = new THREE.MeshPhongMaterial({ color: 0xb8c0c2, specular: 0xffffff, shininess: 140, emissive: 0x000000 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.1 * sc, 0.0075 * sc, 4, 28), lam({ color: 0x161816 }));
  band.position.copy(eyes).add(V(0, 0.05 * sc, -0.072 * sc)); band.rotation.set(Math.PI / 2 - 0.22, 0, 0); band.scale.set(0.93, 1.13, 1);
  a.head.attach(band);
  const mirror = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.046 * sc, 0.046 * sc, 0.007 * sc, 24), mirM); disc.rotation.x = Math.PI / 2;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0075 * sc, 12), lam({ color: 0x050505 })); hole.position.z = 0.0037 * sc;
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.012 * sc, 0.03 * sc, 0.012 * sc), lam({ color: 0x2a2c2a })); stem.position.set(0, 0.03 * sc, -0.008 * sc);
  mirror.add(disc, hole, stem);
  mirror.position.copy(eyes).add(V(0.01 * sc, 0.05 * sc, 0.052 * sc)); mirror.rotation.x = 0.22;
  a.head.attach(mirror);
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
  flare.scale.setScalar(0.09); flare.position.z = 0.012; mirror.add(flare);
  // a heavy rubber apron from the chest to the shins (it hides her shape as much as anything), dark trousers below
  const pel = a.bone.get('pelvis')!, chest = a.bone.get('spine_03')!;
  const hip = pel.getWorldPosition(new THREE.Vector3()), ch = chest.getWorldPosition(new THREE.Vector3());
  const rubber = new THREE.MeshPhongMaterial({ map: apronTexture(), color: 0xb0a8a0, specular: 0x3a3a3a, shininess: 38, side: THREE.DoubleSide });
  const bib = new THREE.Mesh(new THREE.CylinderGeometry(0.19 * sc, 0.2 * sc, 0.4 * sc, 12, 1, true, -0.85, 1.7), rubber);
  bib.position.set(ch.x, ch.y + 0.04 * sc, ch.z - 0.02 * sc); bib.castShadow = true; chest.attach(bib);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * sc, 0.3 * sc, 0.82 * sc, 14, 1, true, -1.15, 2.3), rubber);
  skirt.position.set(hip.x, hip.y - 0.36 * sc, hip.z - 0.02 * sc); skirt.castShadow = true; pel.attach(skirt);
  const gown = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * sc, 0.25 * sc, 0.5 * sc, 14, 1, true, Math.PI - 1.4, 2.8), lam({ map: gownTexture(), color: 0xc4d8cc, side: THREE.DoubleSide }));
  gown.position.set(hip.x, hip.y - 0.2 * sc, hip.z); pel.attach(gown); // the gown's back panel, over the skirt she wears
  const pants = lam({ color: 0x1e2422 });
  for (const s of ['l', 'r']) {
    const hipJ = a.bone.get('thigh_' + s)!.getWorldPosition(new THREE.Vector3()), knee = a.bone.get('calf_' + s)!.getWorldPosition(new THREE.Vector3()), ankle = a.bone.get('foot_' + s)!.getWorldPosition(new THREE.Vector3());
    for (const [p0, p1, r0, r1, bone] of [[knee, ankle, 0.064, 0.052, 'calf_'], [hipJ, knee, 0.085, 0.066, 'thigh_']] as const) {
      const len = p0.distanceTo(p1);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(r0 * sc, r1 * sc, len, 8), pants);
      leg.position.copy(p0).add(p1).multiplyScalar(0.5); leg.quaternion.setFromUnitVectors(V(0, 1, 0), p0.clone().sub(p1).normalize()); leg.castShadow = true;
      a.bone.get(bone + s)!.attach(leg);
    }
  }
  // broader in the shoulders than she is
  a.boneScale = { spine_03: [1.16, 1, 1.08], clavicle_l: [1, 1.18, 1], clavicle_r: [1, 1.18, 1] };
  return { mirror, flare, mirM };
}

/** La otra: a second nurse in pale blue, her hair darker; her eyes catch whatever colour the syringe is */
function dressIris(a: Actor) {
  restyle(a, (m, n) => {
    if (n === 'Jefa_uniforme' || /elegantsuit/i.test(m.name)) m.material = tint(m.material as THREE.Material, [0.74, 0.86, 1.0]);
    else if (n === 'Jefa_pelo') m.material = tint(m.material as THREE.Material, [0.42, 0.24, 0.22]);
    else if (n === 'Jefa_piel') m.material = tint(m.material as THREE.Material, [0.97, 0.92, 0.92]);
  });
}

// ---- things -------------------------------------------------------------------------------------------
const LIQUID_V = /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LIQUID_F = /* glsl */ `uniform float uTime, uGlow; varying vec3 vP; // a liquid that keeps turning through the colours
void main(){
  float a = atan(vP.z, vP.x), y = vP.y * 26.0;
  float s = sin(y * 1.7 - uTime * 2.3 + a * 2.0) + sin(y * 0.9 + uTime * 1.1 - a) * 0.6;
  vec3 c = 0.55 + 0.45 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + s * 0.16 + y * 0.05 - uTime * 0.21));
  gl_FragColor = vec4(c * uGlow, 1.0);
}`;
/** the syringe: glass, a liquid that will not keep still, plunger and needle (local +y is the needle) */
function makeSyringe(glintTex: THREE.Texture) {
  const g = new THREE.Group();
  const glass = new THREE.MeshBasicMaterial({ color: 0xd8eef2, transparent: true, opacity: 0.22, depthWrite: false });
  const metal = new THREE.MeshLambertMaterial({ color: 0xcfd3d0, emissive: 0x202020 });
  const liquid = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uGlow: { value: 1.0 } }, vertexShader: LIQUID_V, fragmentShader: LIQUID_F });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.frustumCulled = false; g.add(o); return o; };
  add(new THREE.CylinderGeometry(0.0118, 0.0118, 0.108, 16, 1, true), glass, 0);
  const liq = add(new THREE.CylinderGeometry(0.0098, 0.0098, 0.084, 14), liquid, 0.008);
  liq.geometry.translate(0, 0.042, 0); liq.position.y = -0.034; // grows from the plunger end toward the needle
  const plunger = new THREE.Group(); g.add(plunger);
  const pl = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.frustumCulled = false; plunger.add(o); };
  pl(new THREE.CylinderGeometry(0.0098, 0.0098, 0.006, 14), new THREE.MeshLambertMaterial({ color: 0x111111 }), -0.037);
  pl(new THREE.BoxGeometry(0.004, 0.07, 0.004), metal, -0.075);
  pl(new THREE.CylinderGeometry(0.014, 0.014, 0.003, 14), metal, -0.111);
  add(new THREE.BoxGeometry(0.042, 0.003, 0.013), metal, -0.054);
  add(new THREE.CylinderGeometry(0.0035, 0.006, 0.013, 10), metal, 0.06);
  add(new THREE.CylinderGeometry(0.0007, 0.0007, 0.042, 5), new THREE.MeshBasicMaterial({ color: 0xe8eceb }), 0.087);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.5 }));
  halo.scale.setScalar(0.06); g.add(halo);
  /** 1: full, 0: pushed home */
  const fill = (k: number) => { liq.scale.y = Math.max(0.02, k); plunger.position.y = (1 - k) * 0.072; };
  return { group: g, liquid, halo, fill };
}

/** a bed on castors: rails, mattress, pillow, push bar and a drip pole; local +z is the foot end */
function makeGurney(tex: { glint: THREE.Texture }) {
  const g = new THREE.Group();
  const lam = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
  const steel = lam({ color: 0x9a9d97 }), dark = lam({ color: 0x1a1b1a }), pad = lam({ color: 0x5f6f6a }), linen = lam({ color: 0xd8d4c8 });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  const cyl = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; g.add(o); return o; };
  for (const x of [-0.31, 0.31]) box(0.03, 0.035, 1.96, steel, x, 0.72, 0);
  for (const z of [-0.95, 0.95]) box(0.65, 0.03, 0.03, steel, 0, 0.72, z);
  box(0.6, 0.02, 1.7, steel, 0, 0.24, 0);
  const wheels: THREE.Object3D[] = [];
  for (const x of [-0.27, 0.27]) for (const z of [-0.86, 0.86]) {
    cyl(0.015, 0.6, steel, x, 0.42, z);
    box(0.03, 0.06, 0.05, dark, x, 0.11, z);
    wheels.push(cyl(0.052, 0.035, dark, x, 0.055, z + 0.02, 0, Math.PI / 2));
  }
  box(0.62, 0.09, 1.9, pad, 0, 0.785, 0);
  box(0.46, 0.08, 0.3, linen, 0, 0.865, -0.78);
  // push bar at the head end, drip pole at one corner
  cyl(0.013, 0.26, steel, -0.29, 0.86, -1.02); cyl(0.013, 0.26, steel, 0.29, 0.86, -1.02);
  cyl(0.014, 0.6, steel, 0, 0.98, -1.04, 0, Math.PI / 2);
  cyl(0.011, 1.25, steel, 0.31, 1.33, -0.98);
  cyl(0.008, 0.22, steel, 0.31, 1.95, -0.98, 0, Math.PI / 2);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.035), new THREE.MeshLambertMaterial({ color: 0xbdd2d0, transparent: true, opacity: 0.6 })); bag.position.set(0.39, 1.83, -0.98); g.add(bag);
  // the colour bleeding up through the sheet, where her hands hold the syringe
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glint, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
  glow.scale.set(0.5, 0.5, 1); glow.position.set(0, 1.08, -0.22); g.add(glow);
  g.traverse(o => { o.frustumCulled = false; });
  return { group: g, wheels, glow };
}

/** a sheet over a body (or over you): bumps for head, chest, hips, legs, the feet tenting it; it can breathe,
 *  twitch, be yanked off and lie crumpled on the floor */
class Sheet {
  mesh: THREE.Mesh; private base: Float32Array; private R = rng(31);
  constructor(private from = 0) {
    const geo = new THREE.PlaneGeometry(1.12, 2.06, 16, 34); geo.rotateX(-Math.PI / 2);
    this.base = Float32Array.from(geo.attributes.position.array as Float32Array);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xdcd8cc, side: THREE.DoubleSide }));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
  }
  /** breathe 0..1, twitch 0..1, yank 0..1 (off toward the head end and up), pile 0..1 (crumpled on the floor) */
  shape(o: { breathe?: number; twitch?: number; yank?: number; hands?: number }) {
    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute, a = pos.array as Float32Array, b = this.base;
    const br = o.breathe ?? 0, tw = o.twitch ?? 0, yk = o.yank ?? 0, hands = o.hands ?? 1;
    const bump = (u: number, v: number, u0: number, v0: number, ru: number, rv: number, h: number) => h * Math.exp(-(((u - u0) / ru) ** 2) - (((v - v0) / rv) ** 2));
    for (let i = 0; i < a.length; i += 3) {
      const x = b[i], z = b[i + 2];
      const u = (z + 1.03) / 2.06, v = x / 0.31; // u: 0 head .. 1 feet; v: −1..1 across the mattress
      let h = 0;
      if (u >= this.from) {
        h = Math.max(
          bump(u, v, 0.1, 0, 0.055, 0.42, 0.17), bump(u, v, 0.31, 0, 0.11, 0.9, 0.2 + br * 0.03), bump(u, v, 0.36, 0, 0.05, 0.3, 0.07 * hands),
          bump(u, v, 0.49, 0, 0.1, 0.85, 0.16), bump(u, v, 0.66, -0.36, 0.12, 0.42, 0.12), bump(u, v, 0.66, 0.36, 0.12, 0.42, 0.12),
          bump(u, v, 0.83, -0.33, 0.09, 0.34, 0.09), bump(u, v, 0.83, 0.33, 0.09, 0.34, 0.09),
          bump(u, v, 0.965, -0.32, 0.028, 0.3, 0.2), bump(u, v, 0.965, 0.32, 0.028, 0.3, 0.2),
          bump(u, v, 0.45, 0.95 + tw * 0.1, 0.05, 0.16, 0.05 + tw * 0.08));
      }
      let y = 0.835 + Math.max(0.012, h) + 0.006 * Math.sin(u * 47 + v * 5) * Math.min(1, h * 12);
      if (u < this.from) y = 0.76; // your own sheet stops at the chin: the rest is tucked under the pillow
      const over = Math.abs(x) - 0.31; if (over > 0) y -= Math.min(0.42, over * 1.9);
      const endH = -(z + 0.98), endF = z - 0.98; if (endH > 0) y -= Math.min(0.3, endH * 3); if (endF > 0) y -= Math.min(0.3, endF * 3);
      let px = x, pz = z;
      if (yk > 0) {
        // pulled from the head end: it slides off toward the doctor, billows, folds over itself
        const lag = (1 - u) * 0.35, k = cl((yk - lag) / (1 - lag * 0.6));
        pz = z - k * 2.3 * (0.6 + 0.4 * u); y = mix(y, 0.9 + 0.6 * Math.sin(k * Math.PI) + 0.12 * Math.sin(u * 9 + k * 6), k);
        px = x * (1 - 0.4 * k);
        if (yk >= 1) { pz = -1.5 - u * 0.5 + 0.12 * Math.sin(v * 3 + u * 17); y = 0.03 + 0.11 * Math.abs(Math.sin(u * 11 + v * 4)) * (1 - u * 0.4); px = x * 0.55 + 0.1 * Math.sin(u * 13); }
      }
      a[i] = px; a[i + 1] = y; a[i + 2] = pz;
    }
    pos.needsUpdate = true; this.mesh.geometry.computeVertexNormals();
  }
}

// a doorway full of colour: what the inside of Cirugía looks like after the syringe
const DOORLIGHT_F = /* glsl */ `uniform float uTime, uK; varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * vec2(1.0, 1.2);
  float r = length(p), a = atan(p.y, p.x);
  float s = 6.2831853 / 8.0, ak = abs(mod(a + uTime * 0.12, s) - s * 0.5);
  vec2 q = vec2(cos(ak), sin(ak)) * r;
  float f = sin(q.x * 22.0 - uTime * 3.0) * sin(q.y * 19.0 + uTime * 1.7) + sin(r * 30.0 - uTime * 4.0);
  vec3 c = 0.55 + 0.45 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + f * 0.12 + r * 0.8 - uTime * 0.3));
  gl_FragColor = vec4(c * (1.0 + 0.7 * exp(-r * 3.0)) * uK, 1.0);
}`;

// ---- the scene ------------------------------------------------------------------------------------
interface Saved { light: THREE.PointLight; pos: THREE.Vector3; color: THREE.Color; distance: number; intensity: number }
type Tube = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; x: number; z: number; k: number; want: number; flick: number; sound?: boolean; sick?: boolean; mul?: number };

const PANEL = { x: 55.0, z: 41.0 };                 // where you stand to install the fuse (the panel is on the east wall)
const PARK = { x: 54.35, z: 40.05 };                // where the gurney stops, beside you, its foot end at the wall
const DOOR = { x: 44.0, z: 41.0 };                  // the gurney's centre when its foot end is in the breaker room door
const END = 66.4;                                   // the end screen
const CARD = 60.4;                                  // the title card
const CIR = 53.4;                                   // the last shot: the doors of Cirugía
const FALL = { ex: 55.05, ez: 42.4, ix: 54.78, iz: 41.82, dx: 55.55, dz: 41.1 }; // on the floor: your eye; she kneels at your chest, he stands at your feet
const JEFA = { x: 31.15, z: 27.6 };                 // where la Jefa watches the gurney go by, under her red lamp

export class Finale {
  active = false; t = 0;
  doctor: Actor; iris: Actor;
  private mirror: THREE.Group; private flare: THREE.Sprite; private mirM: THREE.MeshPhongMaterial;
  private gurney: THREE.Group; private wheels: THREE.Object3D[]; private glow: THREE.Sprite;
  private sheet = new Sheet(); private body = new Sheet(0.17);
  private syr: ReturnType<typeof makeSyringe>;
  private tubes: Tube[] = [];
  private doorLight: THREE.Mesh; private doorMat: THREE.ShaderMaterial;
  private fired = new Set<string>();
  private saved: Saved[] = [];
  private cam = { eye: V(0, 1.6, 0), look: V(0, 1.6, -1), up: V(0, 1, 0), tEye: V(0, 1.6, 0), tLook: V(0, 1.6, -1), tUp: V(0, 1, 0), kEye: 4, kLook: 4, kUp: 4, fov: 60, tFov: 60, kFov: 2, roll: 0, hand: 0.5, shake: 0 };
  private start0 = { eye: V(0, 0, 0), look: V(0, 0, 0) };
  private gz = { x: DOOR.x, z: DOOR.z, yaw: Math.PI / 2 }; // the gurney's centre and heading
  private walkT = 0; private stepT = 0; private squeakT = 0;
  private skipK = 0; private holding = false;
  private el: Record<string, HTMLElement> = {};
  private subT = 0;
  private torchHome: { parent: THREE.Object3D; pos: THREE.Vector3; tpos: THREE.Vector3 } | null = null;
  done: (() => void) | null = null;
  private wasDark = false; private yAxis = new THREE.Vector3(0, 1, 0); private qn2 = new THREE.Quaternion(); private tmp3 = new THREE.Vector3();
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3(); private mtx = new THREE.Matrix4(); private qn = new THREE.Quaternion(); private eul = new THREE.Euler();

  constructor(private G: Game) {
    const rig = G.nurse.rig;
    this.syr = makeSyringe(G.tex.glint);
    this.doctor = new Actor(rig, 1.17);
    const d = dressDoctor(this.doctor, G.tex.glint); this.mirror = d.mirror; this.flare = d.flare; this.mirM = d.mirM;
    this.iris = new Actor(rig, 1.0); dressIris(this.iris);
    const gy = makeGurney(G.tex); this.gurney = gy.group; this.wheels = gy.wheels; this.glow = gy.glow;
    this.gurney.add(this.sheet.mesh); this.gurney.add(this.body.mesh);
    for (const o of [this.doctor.root, this.iris.root, this.gurney, this.syr.group]) G.scene.add(o);
    // the tubes that come back on: breaker room, reception, the main corridor, the far end of the north one
    const fix: [number, number, number][] = [[50, 40, 1], [38, 40, 1], [38, 45, 1], [26, 40, 1], [26, 45, 1], [32, 33.5, 0], [32, 25, 0], [32, 16.5, 0], [32, 12.5, 0], [40, 8, 1], [57, 8, 1]];
    for (const [x, z, rot] of fix) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.012, 1.06), mat);
      mesh.position.set(x, 2.98 - 0.087, z); mesh.rotation.y = rot ? Math.PI / 2 : 0; mesh.visible = false; G.scene.add(mesh);
      this.tubes.push({ mesh, mat, x, z, k: 0, want: 0, flick: 0 });
    }
    this.doorMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uK: { value: 0 } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: DOORLIGHT_F });
    this.doorLight = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 2.28), this.doorMat);
    this.doorLight.position.set(59.994, 1.15, 8); this.doorLight.rotation.y = -Math.PI / 2; G.scene.add(this.doorLight);
    this.sheet.shape({}); this.body.shape({});
    this.hide();
    for (const id of ['cine', 'cine-sub', 'cine-skip', 'cine-card']) this.el[id] = document.getElementById(id) as HTMLElement;
    const skip = this.el['cine-skip'];
    if (skip) {
      const on = (e: Event) => { e.preventDefault(); this.holding = true; }, off = () => { this.holding = false; };
      skip.addEventListener('pointerdown', on); skip.addEventListener('pointerup', off); skip.addEventListener('pointerleave', off); skip.addEventListener('pointercancel', off);
    }
    window.addEventListener('keydown', e => { if (this.active && (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter')) { this.holding = true; e.preventDefault(); } });
    window.addEventListener('keyup', e => { if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') this.holding = false; });
  }

  /** everything visible for the shader warm-up at load, then hidden again */
  warm(on: boolean) {
    for (const o of [this.doctor.root, this.iris.root, this.gurney, this.syr.group, this.doorLight]) o.visible = on;
    for (const tb of this.tubes) tb.mesh.visible = on;
    if (on) { this.doctor.stand(PANEL.x - 3, PANEL.z, 0); this.iris.stand(PANEL.x - 3.5, PANEL.z, 0); }
  }
  private hide() { this.warm(false); }

  // ---- control ------------------------------------------------------------------------------------------
  start() {
    const G = this.G, P = G.player, N = G.nurse;
    this.active = true; this.t = 0; this.fired.clear(); this.skipK = 0; this.holding = false; this.skipFloor = -1;
    G.mode = 'cine'; G.unlock(); G.ui.hud(false); G.ui.interact(null); G.ui.marker(null); G.ui.tutorial('', null); G.ui.show('');
    document.body.classList.add('cine');
    this.el.cine.hidden = false; this.el['cine-card'].classList.remove('on'); this.sub('');
    // she is somewhere else now
    N.reset('frozen'); N.rig.root.visible = false; N.iv.visible = false; G.audio.hum(false); N.wasHumming = false; N.humWant = false;
    // borrow the lights
    const em = G.props.em, lamps = G.props.lamps;
    const borrow = (l: THREE.PointLight) => this.saved.push({ light: l, pos: l.position.clone(), color: l.color.clone(), distance: l.distance, intensity: l.intensity });
    this.saved = []; for (const e of em) borrow(e.light); borrow(P.bounce);
    G.props.hold = true;
    void lamps;
    // the camera starts where your eyes are
    P.syncCamera(0);
    const c = this.cam; c.eye.copy(P.eye); c.look.copy(P.eye).addScaledVector(P.fwd, 3); c.up.set(0, 1, 0);
    c.tEye.copy(c.eye); c.tLook.copy(c.look); c.tUp.set(0, 1, 0); c.fov = G.camera.fov; c.tFov = G.settings.fov; c.roll = 0; c.shake = 0;
    this.start0.eye.copy(c.eye); this.start0.look.copy(c.look);
    // the torch stays in your hand for now
    this.torchHome = { parent: P.light.parent!, pos: P.light.position.clone(), tpos: P.lightTarget.position.clone() };
    // set dressing
    this.gz = { x: DOOR.x - 7, z: DOOR.z, yaw: Math.PI / 2 };
    this.doctor.root.visible = false; this.iris.root.visible = false; this.gurney.visible = false; this.syr.group.visible = false;
    this.sheet.mesh.visible = true; this.body.mesh.visible = false; this.sheet.shape({});
    for (const tb of this.tubes) { tb.k = 0; tb.want = 0; tb.flick = 0; tb.mesh.visible = true; tb.sound = false; tb.sick = false; tb.mul = 1; }
    this.wasDark = false; this.squeakT = 0; this.stepT = 0.4; this.doctor.lookW = 0; this.iris.lookW = 0; this.syr.fill(1);
    this.doorLight.visible = false; this.doorMat.uniforms.uK.value = 0;
    this.G.dressing.theatreDoors(0);
    G.audio.finale(true);
    G.audio.threat = 0; G.audio.fear = 0.1; G.audio.breathHeld = false; G.audio.muffleTarget = 20000;
    const u = G.post.u; u.uFocus.value = 0; u.uLocker.value = 0; u.uBreath.value = 0; u.uHalluc.value = 0;
    G.post.trip.on = false;
  }

  /** hold to skip: straight to the title card */
  private skip() {
    if (this.t >= CARD - 0.2) return;
    this.skipFloor = 60.15; this.t = CARD - 0.05; this.G.audio.finaleCut();
    this.G.post.u.uFade.value = 1; this.G.post.trip.on = false; this.resetTrip();
    this.sub('');
  }

  private finish() {
    const G = this.G;
    this.active = false;
    this.restore();
    document.body.classList.remove('cine'); this.el.cine.hidden = true;
    this.done?.();
  }

  /** put back what was borrowed */
  restore() {
    const G = this.G, P = G.player;
    for (const s of this.saved) { s.light.position.copy(s.pos); s.light.color.copy(s.color); s.light.distance = s.distance; s.light.intensity = s.intensity; }
    this.saved = [];
    G.props.hold = false;
    if (this.torchHome) { this.torchHome.parent.add(P.light); this.torchHome.parent.add(P.lightTarget); P.light.position.copy(this.torchHome.pos); P.lightTarget.position.copy(this.torchHome.tpos); }
    this.hide(); this.resetTrip();
    G.post.u.uFocus.value = 0; G.post.u.uFade.value = 1;
    G.audio.finale(false); G.audio.muffleTarget = 20000;
    G.nurse.humWant = false; G.nurse.layer.tilt.want = 0; G.nurse.lookWant = 0; G.nurse.glintBoost = 0;
    G.dressing.theatreDoors(0);
  }

  private resetTrip() {
    const tr = this.G.post.trip; tr.on = false;
    const u = this.G.post.u;
    for (const k of ['uTrip', 'uKal', 'uHue', 'uSat', 'uEdge', 'uInj', 'uBreathe', 'uFract', 'uFlood']) u[k].value = 0;
    u.uKalN.value = 6; u.uLevels.value = 36; u.uDesat.value = 0.12; u.uAberr.value = 0.006; u.uShock.value = 0;
  }

  private skipFloor = -1;
  private at(id: string, time: number, fn: () => void) { if (this.t >= time && !this.fired.has(id)) { this.fired.add(id); if (time >= this.skipFloor) fn(); } }
  private sub(text: string, secs = 3.6, kind = '', who = '') {
    const el = this.el['cine-sub']; if (!el) return;
    el.textContent = '';
    if (who) { const w = document.createElement('span'); w.className = 'who'; w.textContent = who; el.append(w); }
    el.append(text); el.className = kind; this.subT = text ? secs : 0; el.style.opacity = text ? '1' : '0';
  }
  private say(who: string, text: string, secs?: number) { if (this.G.settings.subs) this.sub(`«${text}»`, secs ?? 2 + text.length * 0.06, 'say', who); }
  private think(text: string, secs?: number) { this.sub(text, secs ?? 2 + text.length * 0.055, 'think'); }
  private sfx(text: string, secs = 3) { if (this.G.settings.subs) this.sub(`[${text}]`, secs, 'sfx'); }

  // ---- per frame --------------------------------------------------------------------------------------
  update(dt: number) {
    if (!this.active) return;
    const G = this.G;
    // hold to skip
    if (this.holding && this.t > 1.5 && this.t < CARD - 0.3) { this.skipK += dt / 1.1; if (this.skipK >= 1) { this.skipK = 0; this.holding = false; this.skip(); } }
    else this.skipK = Math.max(0, this.skipK - dt * 2);
    this.el['cine-skip']?.style.setProperty('--p', this.skipK.toFixed(3));
    this.el['cine-skip']?.classList.toggle('show', this.t > 1.5 && this.t < CARD - 0.3);
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.el['cine-sub'].style.opacity = '0'; }

    this.t += dt;
    const t = this.t;
    this.direct(dt, t);
    if (t >= END) this.finish();
  }

  private direct(dt: number, t: number) {
    const G = this.G, P = G.player, A = G.audio, u = G.post.u, red = G.settings.reduced, c = this.cam;
    const D = this.doctor, I = this.iris, em = G.props.em;
    const room = em[3], beacon = em[4], far = em[0], corr = em[2], jefaLight = em[1];
    const emSet = (e: EmLight, x: number, y: number, z: number, col: number, dist: number) => {
      e.light.position.set(x, y, z); e.light.color.setHex(col); e.light.distance = dist;
      e.lens.emissive.setRGB(0.03, 0.01, 0.01); if (e.halo) (e.halo.material as THREE.SpriteMaterial).opacity = 0; // the mains are back: the battery lamp goes out
    };
    D.pose = {}; I.pose = {};

    // ---- act I: the light ------------------------------------------------------------------------------
    this.at('surge', 0.1, () => { A.powerOn(); c.shake = red ? 0.1 : 0.6; G.input.rumble(0.7, 0.4, 400); });
    // a blink as the whole building takes the load
    if (t < 1.2) u.uFade.value = Math.max(0, Math.sin(cl((t - 0.12) / 0.55) * Math.PI)) * 0.85;
    this.at('roomOn', 1.1, () => { emSet(room, 50, 2.62, 40, 0xd6efe2, 15); A.tubeOn({ x: 50, y: 2.9, z: 40 }, 1); this.tube(50, 40).want = 1; });
    this.at('nearOn', 2.4, () => { emSet(beacon, 41.6, 2.6, 41, 0xd6efe2, 11); A.tubeOn({ x: 38, y: 2.9, z: 41 }, 0.55); this.tube(38, 40).want = 1; this.tube(38, 45).want = 1; });
    this.at('farOn', 3.1, () => { emSet(far, 30.5, 2.6, 42.5, 0xd6efe2, 12); this.tube(26, 40).want = 1; this.tube(26, 45).want = 1; });
    room.light.intensity = 12 * this.tube(50, 40).k;
    beacon.light.intensity = 5.5 * this.tube(38, 40).k;
    far.light.intensity = 4 * this.tube(26, 40).k;
    if (t < 44) { corr.light.intensity = 0; jefaLight.light.intensity = 0; }
    this.at('torchOff', 3.4, () => { P.torch.on = false; A.click(); });
    P.light.intensity = P.torch.on ? Math.min(P.light.intensity, 30) : 0; P.bounce.intensity = 0;
    // while he is in the room, a little of the tube's light comes back off the floor and the walls onto his front
    if (t >= 13.6 && t < 27.3) { P.bounce.position.set(PANEL.x - 0.6, 1.3, PANEL.z + 0.3); P.bounce.color.setRGB(0.72, 0.84, 0.78); P.bounce.distance = 5.5; P.bounce.intensity = 1.1 * this.tube(50, 40).k * (this.wasDark ? 0.1 : 1); }
    this.at('relief', 3.7, () => this.think('Luz. Por fin.', 2.4));
    this.at('lock', 5.4, () => { A.maglock({ x: 59.5, y: 2, z: 8 }); this.sfx('Una cerradura eléctrica se suelta · al norte, lejos'); c.shake = Math.max(c.shake, red ? 0 : 0.12); });
    this.at('doors', 6.3, () => A.farDoors({ x: 59.5, y: 1.2, z: 8 }));
    this.at('cirugia', 7.3, () => this.think('Cirugía. Se abrió Cirugía.', 2.6));

    // ---- act II: the visit -------------------------------------------------------------------------------
    // down the main corridor and across the reception: squeak, step; the far lights die as he passes under them
    if (t >= 8.5 && t < 13.6) {
      const k = cl((t - 8.5) / 5.1), px = mix(31.5, DOOR.x, k), pz = mix(30, DOOR.z, ss(0, 0.6, k));
      this.squeakT -= dt; if (this.squeakT <= 0) { this.squeakT = 0.86; A.gurney({ x: px, y: 0.5, z: pz }, 0.9); }
      this.stepT -= dt; if (this.stepT <= 0) { this.stepT = 0.86; A.bigStep({ x: px - 1.5, y: 0.1, z: pz }, 0.9); }
      this.at('wheels', 8.7, () => this.sfx('Ruedas de camilla · se acercan', 4));
    }
    this.at('farOff', 10.6, () => { this.tube(26, 40).want = 0; this.tube(26, 45).want = 0; A.tubeOff({ x: 26, y: 2.9, z: 42 }); });
    this.at('nearFlick', 11.9, () => { this.tube(38, 40).sick = true; this.tube(38, 45).sick = true; });
    this.at('nearOff', 12.8, () => { this.tube(38, 40).want = 0; this.tube(38, 45).want = 0; A.tubeOff({ x: 38, y: 2.9, z: 41 }); });
    // inside: the strobe. Each time the tube comes back he is closer (reduced: it stays on, and he walks)
    let roomFlick = 1;
    const moving = t >= 13.6 && t < 19.4;
    if (t >= 13.6 && !this.fired.has('enter')) {
      this.fired.add('enter');
      const door = G.level.doors.find(d => d.id === 'door_22,20'); if (door && !door.open) { G.level.openDoor(door, { x: 44, z: 41 }); A.doorCreakAt({ x: 45, y: 1.2, z: 41 }); }
      this.gurney.visible = true; D.root.visible = true; this.sheet.mesh.visible = true;
    }
    if (moving) {
      const s0 = t - 13.6, k = s0 / 5.8;
      const DARK = [0.95, 1.95, 3.15, 4.25];
      const dark = !red && [[0.95, 1.25], [1.95, 2.35], [3.15, 3.42], [4.25, 4.6]].some(([a, b]) => s0 >= a && s0 < b);
      roomFlick = dark ? 0.04 : 1;
      if (!dark && this.wasDark) { A.tubeTick({ x: 50, y: 2.9, z: 40 }); c.shake = Math.max(c.shake, red ? 0 : 0.14); }
      this.wasDark = dark;
      // the gurney's centre: steps through the dark, a slow walk in the light
      const s = cl(red ? k : Math.min(k, 0.999) * 0.62 + DARK.filter(d => s0 >= d + 0.15).length * 0.095);
      this.gz.x = mix(DOOR.x, PARK.x, s); this.gz.z = mix(DOOR.z, PARK.z, ss(0.1, 1, s));
      this.gz.yaw = Math.PI / 2 + Math.atan2(DOOR.z - PARK.z, PARK.x - DOOR.x) * (1 - ss(0.75, 1, s));
      this.squeakT -= dt; if (this.squeakT <= 0 && !dark) { this.squeakT = 0.8; A.gurney({ x: this.gz.x, y: 0.5, z: this.gz.z }, 1.2); }
      this.stepT -= dt; if (this.stepT <= 0) { this.stepT = 0.8; A.bigStep(D.headPos(this.tmp).setY(0.1), 1.2); }
    }
    if (t >= 19.4 && t < 43) { this.gz.x = PARK.x; this.gz.z = PARK.z; this.gz.yaw = Math.PI / 2; }
    this.at('stop', 19.4, () => A.gurneyStop({ x: PARK.x, y: 0.5, z: PARK.z }));
    if (t >= 19.4 && t < 35) roomFlick = !red && Math.sin(t * 5.3) * Math.sin(t * 2.9) > 0.82 ? 0.6 : 1;
    room.light.intensity *= roomFlick; this.tube(50, 40).mul = roomFlick;

    // the gurney and the man behind it
    const gyaw = this.gz.yaw, fx = Math.sin(gyaw), fz = Math.cos(gyaw);
    if (t < 43) {
      this.gurney.position.set(this.gz.x, 0, this.gz.z); this.gurney.rotation.y = gyaw;
      if (moving) for (const w of this.wheels) w.rotation.x += dt * 9;
    }
    if (t < 35.3) {
      const dx = this.gz.x - fx * 1.58, dz = this.gz.z - fz * 1.58;
      D.stand(dx, dz, gyaw);
      if (moving) D.play('walk', 0.3, 0.72); else D.play('idle', 0.5, 0.8);
      // hands on the bar; a stoop under the door frame
      const stoop = ss(43.4, 44.4, dx) * (1 - ss(46.0, 47.0, dx));
      const grip = moving ? 1 : 0.55; // walking he pushes; stopped, his hands rest on the bar
      D.pose = { upperarm_l: [-48 * grip, 0, 6], upperarm_r: [-48 * grip, 0, -6], lowerarm_l: [-38 * grip - 8, 0, 0], lowerarm_r: [-38 * grip - 8, 0, 0], spine_01: [7, 0, 0], spine_02: [10 * stoop, 0, 0], neck_01: [14 * stoop, 0, 0] };
    }
    if (t >= 27.6 && t < 35.3) D.pose = { upperarm_l: [-12, 0, 4], upperarm_r: [-12, 0, -4], lowerarm_l: [-22, 0, 0], lowerarm_r: [-22, 0, 0], spine_01: [5, 0, 0] };
    // the tilt, the line, the sheet
    if (t >= 19.4 && t < 35.3) {
      D.lookW = mix(D.lookW, 1, Math.min(1, dt * 2)); D.look.copy(P.eye);
      const tilt = ss(20.2, 21.8, t) * (1 - ss(26.2, 26.6, t));
      D.pose.neck_01 = [0, 0, -9 * tilt]; D.pose.head = [3 * tilt, 0, -22 * tilt];
    }
    this.at('line', 20.4, () => { A.voiceAt('v_doctor', D.headPos(this.tmp), 1.3, 0.97); this.say('EL DOCTOR', 'Buenas noches. Gracias por la luz. Ahora sí lo podemos atender.', 6.7); });
    // under the sheet: breathing, a hand that moves; then he pulls it off
    const breathe = 0.5 + 0.5 * Math.sin(t * 2.1), twitch = ss(25.6, 25.75, t) * (1 - ss(25.9, 26.3, t)) + ss(26.1, 26.2, t) * (1 - ss(26.3, 26.5, t));
    if (t < 27.6 && t >= 13.5) this.sheet.shape({ breathe: t > 24.5 ? breathe : 0, twitch, yank: t >= 27.35 ? 1 : ss(26.9, 27.35, t) });
    if (t >= 26.4 && t < 27.6) {
      const reach = ss(26.4, 26.85, t) * (1 - ss(27.0, 27.4, t)), pull = ss(26.9, 27.25, t) * (1 - ss(27.3, 27.6, t));
      D.pose.upperarm_l = [-48 - 30 * reach - 70 * pull, 0, 6]; D.pose.upperarm_r = [-48 - 30 * reach - 70 * pull, 0, -6];
      D.pose.lowerarm_l = [-38 + 30 * reach, 0, 0]; D.pose.lowerarm_r = [-38 + 30 * reach, 0, 0];
      D.pose.spine_01 = [7 + 22 * reach - 10 * pull, 0, 0];
    }
    this.at('yank', 26.92, () => { A.sheetYank(); c.shake = Math.max(c.shake, red ? 0 : 0.2); });
    const gm = this.glow.material as THREE.SpriteMaterial;
    gm.opacity = t > 13.6 && t < 27.2 ? (0.16 + 0.1 * Math.sin(t * 2.7)) * (0.7 + 0.3 * breathe) : 0;
    gm.color.setHSL((t * 0.07) % 1, 0.9, 0.6);

    // ---- her -----------------------------------------------------------------------------------------------
    // revealed: on her back, the syringe in both hands on her chest; she turns her head, sits up, turns to you,
    // gets down, and the syringe goes up between your faces
    const gq = this.qn2.setFromAxisAngle(this.yAxis, gyaw);
    const onBed = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyQuaternion(gq).add(this.tmp3.set(this.gz.x, 0, this.gz.z));
    const SPOT = { x: 54.5, z: 40.62 };              // where she stands, an arm's length from you
    if (t >= 27.3 && t < 43) {
      I.root.visible = true;
      const sit = red ? ss(29.0, 29.9, t) : ss(29.0, 29.33, t) + (ss(29.2, 29.33, t) - ss(29.33, 29.5, t)) * 0.06;
      const swing = ss(29.8, 30.7, t), down = ss(30.9, 31.5, t);
      const hip = onBed(0, 0.93, -0.02).lerp(onBed(-0.27, 0.9, -0.02), swing).lerp(V(SPOT.x, I.hip.y, SPOT.z), down);
      const pitch = (-90 + 90 * sit) * DEG;
      const yaw = gyaw - (Math.PI / 2) * swing;
      const face = Math.atan2(c.eye.x - hip.x, c.eye.z - hip.z);
      I.placeHip(hip, t < 31.0 ? yaw : mix(yaw, face, cl((t - 31.0) * 2.5)), pitch);
      I.play('idle', 0, 0.6);
      const thigh = (-90 - pitch / DEG) * (1 - down), calf = 90 * swing * (1 - down);
      I.pose = {
        thigh_l: [thigh, 0, 0], thigh_r: [thigh, 0, 0], calf_l: [calf, 0, 0], calf_r: [calf, 0, 0],
        // both forearms folded on her chest, the syringe held at the breastbone
        upperarm_l: [-14, -72, 0], upperarm_r: [-14, 72, 0], lowerarm_l: [-104, 0, 0], lowerarm_r: [-104, 0, 0],
      };
      I.lookW = ss(28.2, 28.8, t); I.look.copy(c.eye);
      const raise = ss(31.5, 32.0, t) * (1 - ss(36.0, 36.6, t)), lunge = ss(35.0, 35.25, t) * (1 - ss(35.6, 36.4, t));
      if (raise > 0) {
        // up between your faces, at eye level; then across, at your neck
        I.pose.upperarm_r = [mix(-14, -45, raise) - 37 * lunge, mix(72, 30, raise) - 42 * lunge, 0];
        I.pose.lowerarm_r = [mix(-104, -55, raise) + 40 * lunge, 0, 0];
        I.pose.upperarm_l = [mix(-14, -8, raise), mix(-72, 0, raise), 4 * raise]; I.pose.lowerarm_l = [mix(-104, -25, raise), 0, 0];
        I.pose.spine_01 = [14 * lunge, -8 * lunge, 0]; I.pose.spine_02 = [10 * lunge, -8 * lunge, 0];
      }
      // after: a step back, the head over to one side
      const back = ss(36.0, 36.8, t);
      if (back > 0) {
        const bx = SPOT.x - 0.45 * back, bz = SPOT.z - 0.05 * back;
        I.stand(bx, bz, Math.atan2(c.eye.x - bx, c.eye.z - bz));
        I.pose.neck_01 = [0, 0, 9 * back]; I.pose.head = [4 * back, 0, 22 * back];
        I.lookW = 1;
      }
      // the syringe in her right hand; emptied at the needle
      const hand = I.bone.get('hand_r')!;
      I.root.updateMatrixWorld(true);
      this.syr.group.visible = true;
      this.syr.group.position.copy(hand.localToWorld(this.tmp.set(0.0, 0.09, 0.035)));
      const up = hand.localToWorld(this.tmp2.set(0.0, 0.3, 0.035)).sub(this.syr.group.position).normalize();
      this.syr.group.quaternion.setFromUnitVectors(this.yAxis, up);
      this.syr.fill(1 - ss(35.25, 35.7, t) * 0.92);
    }

    // ---- the syringe's light: the bounce light, borrowed ---------------------------------------------------
    const syrOn = this.syr.group.visible;
    this.syr.liquid.uniforms.uTime.value = t;
    const hue = (t * 0.11) % 1;
    const hm = this.syr.halo.material as THREE.SpriteMaterial;
    hm.color.setHSL(hue, 0.9, 0.62); hm.opacity = (0.13 + 0.05 * Math.sin(t * 5)) * (1 - ss(35.3, 36, t) * 0.6);
    if (syrOn) { P.bounce.position.copy(this.syr.group.position).lerp(c.eye, 0.55).add(this.tmp.set(0, 0.18, 0)); P.bounce.color.setHSL(hue, 0.6, 0.6); P.bounce.distance = 3.4; P.bounce.intensity = 0.6 * ss(27.3, 27.8, t) * (1 - 0.4 * ss(35.3, 36, t)); }
    for (const g of I.glints) { const gm2 = g.material as THREE.SpriteMaterial; gm2.opacity = syrOn ? 0.75 : 0; gm2.color.setHSL((hue + 0.5) % 1, 0.8, 0.7); g.scale.setScalar(0.03); }
    this.at('reveal', 27.36, () => { A.stinger(true); c.shake = Math.max(c.shake, red ? 0 : 0.35); A.syringe(true); G.input.rumble(0.5, 0.7, 300); });
    this.at('sitUp', 29.0, () => { if (!red) { A.stinger(false); c.shake = Math.max(c.shake, 0.5); } A.cloth(); });
    this.at('getDown', 30.95, () => A.bigStep({ x: SPOT.x, y: 0.1, z: SPOT.z }, 0.6));
    this.at('whisper', 32.1, () => { A.voiceClose('v_iris', -0.45, 1.15); this.say('LA OTRA', 'Shhh… no duele. Es de colores.', 3.2); });
    this.at('inject', 35.25, () => {
      A.inject(); A.syringe(false); c.shake = red ? 0.1 : 1.1; G.input.rumble(1, 1, 600);
      const tr = G.post.trip; tr.on = true;
      u.uInjPt.value.set(0.06, 0.42);
      this.sub('');
    });

    // ---- act III: the colours ------------------------------------------------------------------------------
    this.trip(dt, t);
    this.at('tripOn', 35.6, () => A.tripStart());
    if (t >= 35.6) A.tripUpdate(dt, ss(35.6, 39, t) * (1 - ss(59.4, 60.2, t)), ss(53.4, 59.4, t));
    this.at('irisHum', 37.0, () => A.tripHum(true));
    this.at('thud', 41.5, () => { A.thud(0.6); c.shake = Math.max(c.shake, red ? 0 : 0.5); });
    this.at('black1', 43.0, () => A.tripHum(false));

    // the doctor comes round to stand over you (while the flash has your eyes); when you go down they stand at your
    // feet and bend over you, side by side
    if (t >= 35.3 && t < 43) {
      const down = t >= 40.7;
      const ox = down ? FALL.dx : PANEL.x - 0.7, oz = down ? FALL.dz : PANEL.z + 0.62;
      D.stand(ox, oz, Math.atan2(c.eye.x - ox, c.eye.z - oz));
      D.play('idle', 0, 0.7); D.lookW = 1; D.look.copy(c.eye);
      const lean = ss(40.8, 41.9, t);
      D.pose = { spine_01: [16 * lean, 0, 0], spine_02: [14 * lean, 0, 0], spine_03: [8 * lean, 0, 0], neck_01: [8 * lean, 0, -9], head: [6, 0, -18] };
      if (down) {
        // she kneels beside you and bends over your face
        const k = lean;
        I.stand(FALL.ix, FALL.iz, Math.atan2(FALL.ex - FALL.ix, FALL.ez - FALL.iz));
        I.root.position.y = -0.62 * k;
        I.pose = {
          thigh_l: [-55 * k, 0, -8 * k], thigh_r: [-55 * k, 0, 8 * k], calf_l: [140 * k, 0, 0], calf_r: [140 * k, 0, 0], foot_l: [25 * k, 0, 0], foot_r: [25 * k, 0, 0],
          spine_01: [30 * k, 0, 0], spine_02: [24 * k, 0, 0], spine_03: [14 * k, 0, 0], neck_01: [10 * k, 0, 9], head: [10 * k, 0, 20],
          upperarm_r: [-45, 30, 0], lowerarm_r: [-55, 0, 0], upperarm_l: [-30, 0, 8], lowerarm_l: [-30, 0, 0],
        };
        this.gurney.visible = false;
      }
    }

    // ---- the ride (44.2–52.4): on the gurney, looking up at the lights going by --------------------------
    const rideA = 44.2, rideB = 52.4;
    if (t >= rideA && t < rideB) {
      const k = (t - rideA) / (rideB - rideA);
      const zc = mix(36.5, 22.0, k);
      this.gurney.visible = true; this.gurney.position.set(32, 0, zc); this.gurney.rotation.y = Math.PI; // foot end north (−z)
      for (const w of this.wheels) w.rotation.x += dt * 30;
      if (!this.fired.has('rideSet')) { this.fired.add('rideSet'); this.sheet.mesh.visible = false; this.body.mesh.visible = true; this.body.shape({ hands: 0 }); this.syr.group.visible = false; }
      D.root.visible = true; D.play('walk', 0.2, 1.7); D.stand(32, zc + 1.55, Math.PI);
      D.lookW = 1; D.look.copy(c.eye);
      D.pose = { upperarm_l: [-48, 0, 6], upperarm_r: [-48, 0, -6], lowerarm_l: [-38, 0, 0], lowerarm_r: [-38, 0, 0], spine_01: [16, 0, 0], spine_02: [14, 0, 0], spine_03: [10, 0, 0] };
      I.root.visible = true; I.play('walk', 0.2, 1.75); I.stand(32.82, zc + 0.15, Math.PI); I.lookW = 1; I.look.copy(c.eye);
      I.pose = { upperarm_r: [-120, 0, -10], lowerarm_r: [-40, 0, 0] };
      // the corridor's lights come on as you come; one stays dead (it hangs from its cable)
      for (const z of [33.5, 25, 16.5, 12.5]) { const tb = this.tube(32, z); tb.want = 1; if (!tb.sound && Math.abs(zc - z) < 7) { tb.sound = true; A.tubeOn({ x: 32, y: 2.9, z }, 0.7); } }
      // a lamp that rides over you from fitting to fitting
      const near = [33.5, 25, 16.5, 12.5].reduce((b, z) => (Math.abs(z - (zc - 0.6)) < Math.abs(b - (zc - 0.6)) ? z : b));
      emSet(corr, 32, 2.4, near, 0xe2f4ec, 7); corr.light.intensity = 2.3 * (0.5 + 0.5 * Math.exp(-((near - zc) ** 2) / 4));
      // la Jefa, under her red light, watching you go
      const N = G.nurse;
      if (t >= 46.8 && t < 51.0) {
        if (!N.rig.root.visible) { N.rig.root.visible = true; N.iv.visible = true; N.teleport(JEFA.x, JEFA.z, Math.PI / 2); N.reset('frozen'); }
        N.layer.tilt.want = 1; N.lookWant = 1; N.lookAt.copy(c.eye); N.glintBoost = 0.8; N.humWant = true;
        N.update(dt, []);
        emSet(jefaLight, JEFA.x + 0.45, 2.75, JEFA.z, 0xff3018, 7); jefaLight.light.intensity = 2.6;
      } else if (N.rig.root.visible) { N.rig.root.visible = false; N.iv.visible = false; N.humWant = false; A.hum(false); N.wasHumming = false; jefaLight.light.intensity = 0; }
      this.at('irisLine', 45.2, () => { A.voiceClose('v_iris2', 0.5, 1.0); this.say('LA OTRA', 'Respire hondo, mijo… y mire los colores.', 3.6); });
      this.at('jefaSeen', 48.4, () => this.think('Ella se queda. Ella no viene.', 2.4));
      this.squeakT -= dt; if (this.squeakT <= 0) { this.squeakT = 0.42; A.gurney(this.tmp.set(32, 0.5, zc - 0.8), 0.7); }
    }
    this.at('rideEnd', rideB, () => { const N = G.nurse; N.rig.root.visible = false; N.iv.visible = false; N.humWant = false; A.hum(false); N.wasHumming = false; jefaLight.light.intensity = 0; });

    // ---- Cirugía (53.4–60.2): head up, the doors open by themselves, all of it colour -----------------------
    if (t >= CIR && t < 60.2) {
      const k = cl((t - CIR) / 6.2);
      const eyeX = mix(56.4, 58.15, ss(0, 1, k) * 0.6 + k * 0.4);
      const gx = eyeX + 0.78;
      this.gurney.visible = true; this.gurney.position.set(gx, 0, 8); this.gurney.rotation.y = Math.PI / 2; // foot end east
      this.body.mesh.visible = true; this.sheet.mesh.visible = false;
      D.root.visible = true; D.stand(gx - 1.58, 8, Math.PI / 2); D.play('walk', 0.2, 0.9); D.lookW = 0;
      D.pose = { upperarm_l: [-48, 0, 6], upperarm_r: [-48, 0, -6], lowerarm_l: [-38, 0, 0], lowerarm_r: [-38, 0, 0], spine_01: [7, 0, 0] };
      I.root.visible = false; this.syr.group.visible = false;
      this.doorLight.visible = true;
      const open = ss(CIR + 0.7, CIR + 2.0, t);
      this.doorMat.uniforms.uTime.value = t; this.doorMat.uniforms.uK.value = ss(CIR + 0.6, CIR + 2.4, t) * 0.8;
      G.dressing.theatreDoors(open);
      emSet(corr, 59.2, 1.6, 8, 0xffffff, 12); corr.light.color.setHSL((t * 0.13) % 1, 0.85, 0.55); corr.light.intensity = 5 * ss(CIR + 0.6, CIR + 2.4, t);
      this.at('cirDoors', CIR + 0.7, () => A.doorsOpen({ x: 60, y: 1.2, z: 8 }));
    }

    // ---- the tubes -----------------------------------------------------------------------------------------------
    for (const tb of this.tubes) {
      if (tb.want > 0 && tb.k < 1 && !(tb.flick > 0.9)) {
        // a starter's flutter, then it catches
        tb.flick += dt; const f = tb.flick;
        // two catches and it holds (never more than about three flashes a second: the room light follows it)
        tb.k = red ? Math.min(1, f / 0.9) : f > 0.9 ? 1 : f < 0.12 || (f > 0.42 && f < 0.56) ? 0.85 : 0.08;
      } else if (tb.want <= 0) { tb.k = Math.max(0, tb.k - dt * 9); tb.flick = 0; }
      let kk = tb.k * (tb.mul ?? 1);
      if (tb.sick && tb.want > 0 && !red) kk *= Math.sin(t * 23) * Math.sin(t * 9.1) > 0.15 ? 1 : 0.1; // dying as he comes
      if (t >= 35.3) tb.mat.color.setHSL((t * 0.09 + tb.z * 0.05) % 1, 0.8, 0.5).multiplyScalar(kk * 3);
      else tb.mat.color.setRGB(0.86 * kk * 3.2, kk * 3.2, 0.93 * kk * 3.2);
    }

    // ---- the camera ---------------------------------------------------------------------------------------------
    this.shots(dt, t);
    this.camApply(dt, t);
    this.mirrorFlare(t);
    if (D.root.visible) D.update(dt);
    if (I.root.visible) I.update(dt);

    // ---- title ------------------------------------------------------------------------------------------------------
    this.at('cut', 60.2, () => { A.finaleCut(); this.resetTrip(); this.sub(''); this.hide(); });
    if (t >= 60.2) u.uFade.value = 1;
    this.at('card', CARD, () => { this.el['cine-card'].classList.add('on'); A.cardHit(); });
    this.at('cardOff', END - 1.4, () => this.el['cine-card'].classList.remove('on'));
  }

  private tube(x: number, z: number) { return this.tubes.find(tb => tb.x === x && tb.z === z)!; }

  // ---- the shots: where your eyes are and what they look at ----------------------------------------------------
  private shots(dt: number, t: number) {
    const c = this.cam, D = this.doctor, I = this.iris, red = this.G.settings.reduced;
    const look = (x: number, y: number, z: number, k = 4) => { c.tLook.set(x, y, z); c.kLook = k; };
    const eye = (x: number, y: number, z: number, k = 4) => { c.tEye.set(x, y, z); c.kEye = k; };
    c.tUp.set(0, 1, 0); c.kUp = 4; c.hand = 0.5; c.tFov = this.G.settings.fov; c.kFov = 2;
    if (t < 1.4) {                                 // at the panel: a step back from it
      const k = ss(0.2, 1.4, t);
      eye(mix(this.start0.eye.x, PANEL.x, k), 1.6, mix(this.start0.eye.z, PANEL.z, k), 3);
      look(this.start0.look.x, this.start0.look.y, this.start0.look.z, 3);
    } else if (t < 5.4) {                          // the room light comes on behind you; you turn round to it
      eye(PANEL.x, 1.6, PANEL.z, 3);
      if (t < 2.6) look(50, 2.5, 40.2, 2.6); else look(46, 1.45, 41, 2.2);
    } else if (t < 8.5) {                          // a sound from the north, far away
      eye(PANEL.x, 1.6, PANEL.z, 3);
      if (t < 7.4) look(47.5, 1.6, 35, 3); else look(46, 1.45, 41, 2.2);
    } else if (t < 13.6) {                         // the door; push in slowly as the squeak comes closer
      eye(PANEL.x - 0.1 * ss(8.5, 13.6, t), 1.6, PANEL.z, 1.5); look(45.5, 1.5, 41, 2.5);
      c.tFov = this.G.settings.fov - 8 * ss(8.5, 13.6, t);
    } else if (t < 19.4) {                         // him, closer each time the light comes back
      eye(PANEL.x, 1.6, PANEL.z, 2);
      const h = D.headPos(this.tmp); look(h.x, h.y - 0.25, h.z, 2.4);
    } else if (t < 25.4) {                         // he looks down at you and talks
      eye(PANEL.x, 1.6, PANEL.z, 2);
      const h = D.headPos(this.tmp); look(h.x, h.y - 0.05, h.z, 2.2);
      c.tFov = this.G.settings.fov - 12 * ss(19.4, 25, t);
    } else if (t < 27.3) {                         // something under the sheet moves
      eye(PANEL.x, 1.6, PANEL.z, 2); c.tFov = this.G.settings.fov - 6;
      if (t < 26.8) look(PARK.x - 0.15, 1.0, PARK.z, 2.4); else { const h = D.headPos(this.tmp); look(mix(PARK.x - 0.6, h.x, 0.5), 1.45, PARK.z, 6); }
    } else if (t < 31.4) {                         // her
      eye(PANEL.x + 0.12 * ss(29.0, 29.3, t), 1.6, PANEL.z + 0.08 * ss(29.0, 29.3, t), 4);
      const h = I.eyes(this.tmp); look(h.x, h.y - 0.05, h.z, t < 29 ? 3 : 5);
      c.tFov = this.G.settings.fov - 4;
    } else if (t < 35.0) {                         // the syringe between your faces
      eye(PANEL.x + 0.1, 1.6, PANEL.z + 0.1, 3);
      const s = this.syr.group.position; const h = I.eyes(this.tmp2);
      const k = ss(31.5, 32.4, t);
      look(mix(h.x, s.x, k), mix(h.y, s.y, k), mix(h.z, s.z, k), 3.5);
      c.tFov = this.G.settings.fov - 4 - 10 * k;
      this.G.post.u.uFocus.value = 0.8 * k;
    } else if (t < 35.8) {                         // the needle: your head is pushed away
      this.G.post.u.uFocus.value *= 0.8;
      eye(PANEL.x + 0.25, 1.62, PANEL.z + 0.15, 6);
      look(PANEL.x - 1.2, 2.3, PANEL.z + 1.4, red ? 4 : 9);
      c.roll = mix(c.roll, red ? 0 : 0.28, Math.min(1, dt * 8));
      c.tFov = this.G.settings.fov + 6;
    } else if (t < 40.6) {                         // the colours start; your knees go
      const k = ss(37.4, 40.6, t);
      eye(PANEL.x + 0.2, mix(1.6, 1.0, k), PANEL.z + 0.15, 2);
      const h = I.headPos(this.tmp), h2 = D.headPos(this.tmp2);
      const w = 0.5 + 0.5 * Math.sin(t * 0.8);
      look(mix(h.x, h2.x, w * 0.6), mix(h.y, h2.y, w * 0.6), mix(h.z, h2.z, w * 0.6), 1.6);
      c.roll = mix(c.roll, (red ? 0.03 : 0.12) * Math.sin(t * 0.9), Math.min(1, dt * 2));
      c.tFov = this.G.settings.fov + 4 * Math.sin(t * 0.7);
      c.hand = 2.2;
    } else if (t < 43.0) {                         // down on your back; their faces lean in over you
      const k = ss(40.6, 41.5, t);
      eye(mix(PANEL.x + 0.2, FALL.ex, k), mix(1.0, 0.22, k), mix(PANEL.z + 0.15, FALL.ez, k), k < 1 ? 6 : 3);
      const h = I.eyes(this.tmp), h2 = D.eyes(this.tmp2);
      look(mix(55.0, h.x * 0.8 + h2.x * 0.2, k), mix(1.6, h.y * 0.8 + h2.y * 0.2, k), mix(41.2, h.z * 0.8 + h2.z * 0.2, k), 4);
      c.tUp.set(0, 0.2, 1).normalize(); c.kUp = 3;
      c.tFov = this.G.settings.fov - 4;
      c.roll = mix(c.roll, 0, Math.min(1, dt * 3)); c.hand = 1.6;
    } else if (t < 44.2) {
      // eyes shut
    } else if (t < 52.4) {                         // the ride
      const zc = this.gurney.position.z;
      const eyeZ = zc + 0.78;
      eye(32, 1.0, eyeZ, 30);
      let lx = 32, ly = 3.0, lz = eyeZ - 0.55;
      const jefa = ss(47.7, 48.5, t) * (1 - ss(50.1, 50.9, t));
      c.tFov = this.G.settings.fov + 10 - 22 * jefa; c.kFov = 3;
      if (jefa > 0) { const h = this.G.nurse.rig.head.getWorldPosition(this.tmp); lx = mix(lx, h.x, jefa); ly = mix(ly, h.y, jefa); lz = mix(lz, h.z, jefa); }
      look(lx, ly, lz, 30);
      c.tUp.set(0, jefa, 1 - jefa).normalize(); // turning to her, you lift your head: she stands upright in your eyes
      c.hand = 1.4;
      if (!this.fired.has('rideSnap')) { this.fired.add('rideSnap'); c.eye.copy(c.tEye); c.look.copy(c.tLook); c.up.copy(c.tUp); }
    } else if (t < CIR) {
      // eyes shut
    } else if (t < 60.2) {                         // Cirugía: head up, the doors
      const gx = this.gurney.position.x;
      eye(gx - 0.78, 1.16, 8, 30);
      look(60.5, 1.25, 8, 30);
      c.tUp.set(0, 1, 0); c.hand = 1.2;
      c.tFov = this.G.settings.fov + 10 * ss(57.5, 59.8, t);
      if (!this.fired.has('cirSnap')) { this.fired.add('cirSnap'); c.eye.copy(c.tEye); c.look.copy(c.tLook); c.up.copy(c.tUp); c.roll = 0; }
    }
  }

  private camApply(dt: number, t: number) {
    const G = this.G, P = G.player, c = this.cam, cam = G.camera, red = G.settings.reduced;
    const e = (k: number) => 1 - Math.exp(-k * dt);
    c.eye.lerp(c.tEye, e(c.kEye)); c.look.lerp(c.tLook, e(c.kLook)); c.up.lerp(c.tUp, e(c.kUp)).normalize();
    c.fov += (c.tFov - c.fov) * e(c.kFov);
    c.shake = Math.max(0, c.shake - dt * 1.8);
    cam.position.copy(c.eye);
    this.mtx.lookAt(c.eye, c.look, c.up); cam.quaternion.setFromRotationMatrix(this.mtx);
    // a hand-held head: breathing, small drifts, and the shakes
    const h = (red ? 0.4 : 1) * 0.0045 * c.hand, s = red ? c.shake * 0.25 : c.shake;
    const nx = h * (Math.sin(t * 1.31) * 0.6 + Math.sin(t * 2.93 + 1) * 0.3 + Math.sin(t * 0.71 + 2) * 0.5) + (Math.random() - 0.5) * s * 0.05;
    const ny = h * (Math.sin(t * 1.07 + 3) * 0.6 + Math.sin(t * 2.31) * 0.3) + (Math.random() - 0.5) * s * 0.05;
    this.qn.setFromEuler(this.eul.set(nx, ny, c.roll + h * 0.4 * Math.sin(t * 0.53), 'YXZ'));
    cam.quaternion.multiply(this.qn);
    if (Math.abs(cam.fov - c.fov) > 0.01) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    P.eye.copy(cam.position); cam.getWorldDirection(P.fwd);
    // the torch, if it is on, keeps its own aim
    P.light.getWorldPosition(P.torch.pos); P.lightTarget.getWorldPosition(this.tmp); P.torch.dir.copy(this.tmp).sub(P.torch.pos).normalize();
  }

  private mirrorFlare(t: number) {
    const D = this.doctor, room = this.G.props.em[3].light;
    if (!D.root.visible) { this.flare.material.opacity = 0; return; }
    // the mirror's facing against the line to your eye; lit by the room tube
    const mp = this.mirror.getWorldPosition(this.tmp);
    const n = this.tmp2.set(0, 0, 1).transformDirection(this.mirror.matrixWorld);
    const toEye = this.G.player.eye.clone().sub(mp).normalize();
    const face = Math.max(0, n.dot(toEye));
    const lit = Math.min(1, room.intensity / 9);
    const k = Math.pow(face, 6) * lit * (t < 35 ? 1 : 0.4);
    this.flare.material.opacity = Math.min(1, k * 1.6);
    this.flare.scale.setScalar(0.05 + 0.22 * k);
    this.mirM.emissive.setScalar(0.25 * k);
  }

  // ---- the trip: post-processing over time ---------------------------------------------------------------------
  private trip(dt: number, t: number) {
    const G = this.G, u = G.post.u, tr = G.post.trip, red = G.settings.reduced;
    if (!tr.on) return;
    const R = red ? 0.35 : 1;
    const onset = ss(35.25, 39.5, t), peak = ss(53.9, 58.4, t), fall = ss(40.6, 42.6, t);
    const ride = t >= 44.2 && t < 52.4 ? 1 : 0;
    u.uTrip.value = Math.min(1, onset * 0.75 + peak * 0.25 + ride * 0.15) * (red ? 0.6 : 1);
    u.uInj.value = ss(35.25, 38.5, t) * 1.3 * (1 - ss(39.0, 41.0, t));
    u.uBreathe.value = (onset * 0.7 + ride * 0.5 + peak * 0.6) * R;
    u.uHue.value = (t - 35.25) * 0.18 * R + Math.sin(t * 0.4) * 0.6 * onset * R;
    u.uSat.value = (0.6 * onset + 0.5 * peak) * (red ? 0.5 : 1);
    u.uEdge.value = (0.35 * onset + 0.6 * peak + 0.25 * ride) * R;
    u.uKal.value = (ss(42.0, 42.9, t) * 0.6 * (t < 43 ? 1 : 0) + (ride ? 0.18 + 0.12 * Math.sin(t * 0.7) : 0) + peak) * (red ? 0.35 : 1);
    u.uKalN.value = t < 50 ? 6 : 8;
    u.uFract.value = (ride * 0.18 + peak * 0.9) * R;
    u.uFlood.value = ss(58.4, 59.6, t);
    u.uDesat.value = 0; u.uFear.value = 0;
    u.uLevels.value = mix(36, 14, (onset * 0.3 + peak * 0.7) * R);
    u.uAberr.value = 0.006 + 0.02 * onset * R;
    // trails: the last frames fade slowly behind the new one; at the doors the picture falls into itself
    tr.keep = red ? 0.5 : mix(0.82, 0.93, peak);
    tr.trail = (0.55 * onset * (1 - 0.6 * fall * (t < 42.4 ? 1 : 0)) + 0.4 * peak + 0.2 * ride) * (red ? 0.4 : 1);
    tr.zoom = Math.pow(red ? 1.05 : 1 + 0.45 * peak + 0.12 * ride + 0.06 * onset, dt);
    tr.rot = (0.08 * onset + 0.25 * peak) * dt * (red ? 0.2 : 1);
    tr.hue = (0.4 + 1.2 * peak) * dt;
    // eyes closing (blackouts between the shots)
    let fade = 0;
    fade = Math.max(fade, ss(42.6, 43.0, t) * (1 - ss(44.0, 44.6, t)));
    fade = Math.max(fade, ss(51.9, 52.4, t) * (1 - ss(53.2, 53.8, t)));
    if (!red) fade = Math.max(fade, 0.55 * Math.max(0, Math.sin(cl((t - 35.25) / 0.35) * Math.PI)) * (t < 35.7 ? 1 : 0));
    u.uFade.value = fade;
  }
}
