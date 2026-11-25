import * as THREE from 'three';
import { Level, T, type Box } from './level';
import type { Tex } from './textures';
import { rng, signTex } from './textures';
import { BOTTLES, LAMPS, NOTES, EMERGENCY, GLASS, SIGNS, FACING, LEAKS, type NoteDef } from './content';
import { mergeStatic } from './merge';

export interface Locker { id: string; kind: 'locker' | 'bed'; inside: THREE.Vector3; front: THREE.Vector3; yaw: number; out: THREE.Vector3; door: THREE.Object3D; doorAngle: number; doorTarget: number }
export interface Lamp { id: string; pos: THREE.Vector3; stand: THREE.Vector3; light: THREE.PointLight; bulb: THREE.MeshLambertMaterial; on: boolean; onTime: number; halo?: THREE.Sprite }
export interface Bottle { id: string; mesh: THREE.Object3D; pos: THREE.Vector3; picked: boolean }
export interface Note { def: NoteDef; mesh: THREE.Mesh; pos: THREE.Vector3; stand: THREE.Vector3; read: boolean }
export interface EmLight { light: THREE.PointLight; lens: THREE.MeshLambertMaterial; base: number; t: number; phase: number; halo?: THREE.Sprite; beacon?: boolean }
interface Drip { x: number; z: number; t: number; drop: THREE.Mesh; ring: THREE.Mesh; y: number; ringT: number }

const lam = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

export class Props {
  group = new THREE.Group();
  lockers: Locker[] = [];
  curtains: { mesh: THREE.Mesh; base: Float32Array; cx: number; cz: number; ux: number; uz: number; nx: number; nz: number; len: number; cols: number; o: Float32Array; v: Float32Array; ph: number; awake: number; touched: number }[] = [];
  private agentPrev: { x: number; z: number }[] = [];
  lamps: Lamp[] = [];
  bottles: Bottle[] = [];
  notes: Note[] = [];
  em: EmLight[] = [];
  glass = new Set<string>();
  fuse!: { mesh: THREE.Object3D; doors: THREE.Object3D[]; pos: THREE.Vector3; stand: THREE.Vector3; taken: boolean; open: number };
  panel!: { pos: THREE.Vector3; stand: THREE.Vector3; leds: THREE.MeshLambertMaterial[]; fuses: THREE.Object3D[]; installed: number };
  /** the amber lamp over the breaker room door: where your eye goes first */
  beacon = new THREE.Vector3(43.8, 2.62, 41);
  tv?: THREE.MeshLambertMaterial;
  windows: { x: number; z: number; nx: number; nz: number }[] = [];
  windowGlass!: THREE.MeshLambertMaterial; shafts: THREE.MeshBasicMaterial[] = []; poolMat?: THREE.MeshBasicMaterial;
  sanJorge!: THREE.Mesh; wheels: THREE.Object3D[] = []; wheelchair!: THREE.Object3D; crucifix!: THREE.Object3D; calendarMesh!: THREE.Mesh;
  mats: Record<string, THREE.Material>;
  bottleGeo: THREE.Object3D;

  constructor(private level: Level, tex: Tex) {
    this.mats = {
      frame: lam({ color: 0x8a8d86 }),
      dark: lam({ color: 0x1a1b18 }),
      mattress: lam({ map: tex.mattress }),
      sheet: lam({ map: tex.sheet }),
      locker: lam({ map: tex.locker }),
      cabinet: lam({ map: tex.cabinet }),
      wood: lam({ map: tex.wood }),
      chair: lam({ color: 0x3f6b66 }),
      linen: lam({ color: 0xc6c0ad }),
      rust: lam({ color: 0x6a3a22 }),
      glass: lam({ color: 0x2c5a3c, emissive: 0x0b1c10 }),
      paper: lam({ map: tex.paper, emissive: 0x262219 }),
      paperW: lam({ map: tex.paperBlank, emissive: 0x262219 }),
      panel: lam({ map: tex.panel }),
      ceramic: lam({ color: 0xe8e0cc, emissive: 0x1c1610 }),
      copper: lam({ color: 0xb87333, emissive: 0x2a1406 }),
      shard: lam({ color: 0x9fb8a6, emissive: 0x141c16 }),
    };
    this.bottleGeo = this.makeBottle();
    const R = rng(1234);
    for (const c of level.cells) if (c.kind === 'furn') this.furniture(c.cx, c.cz, c.ch, R);
    this.place(tex, R);
    this.decorate(tex, R);
    this.clutter(rng(4321));
    mergeStatic(this.group);
  }

  // ---- what a hospital left in a hurry looks like: boxes, stands, tanks, a parked chair, dead plants, a bucket by
  // the leak. All of it hugs the walls (paths stay clear) and collides as low boxes; it merges into a few meshes.
  private clutter(R: () => number) {
    const L = this.level, m = this.mats, g = this.group;
    const card = [lam({ color: 0x7b5d3b }), lam({ color: 0x6a4f31 }), lam({ color: 0x8a6c45 })], tape = lam({ color: 0xb09868 });
    const tank = lam({ color: 0x2d5a3c }), steel = lam({ color: 0x8e918a }), red = lam({ color: 0x8e1c14 }), yellow = lam({ color: 0xc49a22 });
    const terra = lam({ color: 0x86492c }), stalk = lam({ color: 0x4d4128 }), manila = lam({ color: 0xc6ae78 }), white = lam({ color: 0xd2ccbc });
    const bag = new THREE.MeshLambertMaterial({ color: 0xd9e2e0, transparent: true, opacity: 0.55, depthWrite: false });
    const NRM: Record<string, [number, number]> = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
    // a spot against wall `side` of cell (cx, cz), `inset` metres out from it, slid `along` it; rot faces the room
    const at = (cx: number, cz: number, side: string, inset: number, along = 0) => {
      const c = L.center(cx, cz), [nx, nz] = NRM[side];
      return { x: c.x + nx * (1 - inset) + (nz !== 0 ? along : 0), z: c.z + nz * (1 - inset) + (nx !== 0 ? along : 0), rot: Math.atan2(-nx, -nz) };
    };
    const block = (x: number, z: number, hw: number, hd: number) => { const c = L.at(x, z); if (c && c.kind === 'floor') c.boxes.push({ x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd, tall: false }); };
    const put = (o: THREE.Object3D, x: number, z: number, rot = 0) => { o.position.set(x, 0, z); o.rotation.y = rot; o.traverse(k => { const mm = k as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } }); g.add(o); return o; };
    const cyl = (r0: number, r1: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 10, open = false) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg, 1, open), mat); c.position.set(x, y + h / 2, z); return c; };

    const boxes = (cx: number, cz: number, side: string, n: number, along = 0) => {
      const p = at(cx, cz, side, 0.36, along), o = new THREE.Group();
      let y = 0;
      for (let i = 0; i < n; i++) {
        const w = 0.48 + R() * 0.22, h = 0.3 + R() * 0.18, d = 0.38 + R() * 0.16;
        const b = box(w, h, d, card[Math.floor(R() * 3)], (R() - 0.5) * 0.08, y, (R() - 0.5) * 0.06); b.rotation.y = (R() - 0.5) * 0.35; o.add(b);
        const t = box(0.07, 0.004, d + 0.004, tape, 0, y + h, 0); t.rotation.y = b.rotation.y; t.position.x = b.position.x; t.position.z = b.position.z; o.add(t);
        y += h;
      }
      put(o, p.x, p.z, p.rot); block(p.x, p.z, 0.34, 0.3);
    };
    const tanks = (cx: number, cz: number, side: string, n: number, along = 0) => {
      const p = at(cx, cz, side, 0.2, along), o = new THREE.Group();
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 0.21;
        o.add(cyl(0.09, 0.09, 1.08, tank, x, 0, 0, 12), cyl(0.06, 0.09, 0.08, tank, x, 1.08, 0, 12), cyl(0.02, 0.02, 0.1, steel, x, 1.16, 0, 6));
        const gauge = cyl(0.028, 0.028, 0.012, white, x + 0.03, 1.2, 0, 10); gauge.rotation.x = Math.PI / 2; o.add(gauge);
      }
      o.add(box(n * 0.21 + 0.06, 0.02, 0.02, steel, 0, 0.72, -0.085)); // the chain bar to the wall
      put(o, p.x, p.z, p.rot); block(p.x, p.z, n * 0.11, 0.12);
    };
    const ivStand = (x: number, z: number, rot = 0) => {
      const o = new THREE.Group();
      for (let k = 0; k < 5; k++) { const leg = box(0.28, 0.02, 0.025, steel, 0, 0.04, 0); leg.geometry.translate(0.14, 0, 0); leg.rotation.y = (k / 5) * Math.PI * 2; o.add(leg); }
      o.add(cyl(0.012, 0.012, 1.92, steel, 0, 0.05, 0, 6), box(0.36, 0.015, 0.015, steel, 0, 1.95, 0));
      const b = box(0.12, 0.2, 0.035, bag, 0.15, 1.7, 0); o.add(b, cyl(0.003, 0.003, 0.9, bag, 0.15, 0.82, 0, 4));
      put(o, x, z, rot); block(x, z, 0.16, 0.16);
    };
    const wheelchair = (x: number, z: number, rot: number) => {
      const o = new THREE.Group();
      for (const sd of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.018, 6, 20), steel); w.rotation.y = Math.PI / 2; w.position.set(0.26 * sd, 0.31, 0.04); o.add(w);
        o.add(box(0.025, 0.025, 0.5, steel, 0.23 * sd, 0.62, -0.02), cyl(0.012, 0.012, 0.42, steel, 0.23 * sd, 0.08, -0.2, 6));
        const caster = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 10), m.dark); caster.rotation.y = Math.PI / 2; caster.position.set(0.2 * sd, 0.05, 0.3); o.add(caster);
      }
      o.add(box(0.46, 0.05, 0.44, m.chair, 0, 0.47, 0), box(0.46, 0.44, 0.04, m.chair, 0, 0.52, -0.22), box(0.36, 0.02, 0.16, steel, 0, 0.12, 0.36));
      put(o, x, z, rot); block(x, z, 0.36, 0.38);
    };
    const extinguisher = (cx: number, cz: number, side: string, along = 0) => {
      const p = at(cx, cz, side, 0.1, along), o = new THREE.Group();
      o.add(cyl(0.075, 0.075, 0.48, red, 0, 1.08, 0, 12), cyl(0.03, 0.05, 0.06, m.dark, 0, 1.56, 0, 8), box(0.1, 0.03, 0.03, m.dark, 0.03, 1.62, 0)); // above the handrails
      const hose = cyl(0.01, 0.01, 0.4, m.dark, 0.08, 1.16, 0.02, 5); hose.rotation.z = 0.1; o.add(hose);
      o.add(box(0.2, 0.04, 0.06, steel, 0, 1.26, -0.07));
      put(o, p.x, p.z, p.rot);
    };
    const plant = (cx: number, cz: number, side: string, along = 0) => {
      const p = at(cx, cz, side, 0.32, along), o = new THREE.Group();
      o.add(cyl(0.17, 0.13, 0.34, terra, 0, 0, 0, 12), cyl(0.155, 0.155, 0.01, m.dark, 0, 0.32, 0, 12));
      for (let k = 0; k < 7; k++) { const h = 0.35 + R() * 0.55, st = cyl(0.006, 0.004, h, stalk, 0, 0, 0, 4), pv = new THREE.Object3D(); pv.position.y = 0.33; pv.add(st); pv.rotation.set((R() - 0.5) * 0.9, R() * 6.28, (R() - 0.5) * 0.9); o.add(pv); } // dry stalks out of the soil
      put(o, p.x, p.z, p.rot); block(p.x, p.z, 0.18, 0.18);
    };
    const bin = (cx: number, cz: number, side: string, along = 0) => {
      const p = at(cx, cz, side, 0.3, along), o = new THREE.Group();
      o.add(cyl(0.17, 0.15, 0.5, m.dark, 0, 0, 0, 12, true), cyl(0.15, 0.15, 0.01, m.dark, 0, 0.02, 0, 12));
      for (let k = 0; k < 6; k++) { const pb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 + R() * 0.03, 0), white); pb.position.set((R() - 0.5) * 0.2, k < 3 ? 0.5 + R() * 0.06 : 0.04, (R() - 0.5) * 0.2 + (k < 3 ? 0 : 0.25)); o.add(pb); }
      put(o, p.x, p.z, p.rot); block(p.x, p.z, 0.18, 0.18);
    };
    const ladder = (cx: number, cz: number, side: string, along = 0) => {
      const p = at(cx, cz, side, 0.42, along), o = new THREE.Group(), lean = new THREE.Object3D();
      for (const sd of [-1, 1]) lean.add(box(0.04, 2.3, 0.04, lam({ color: 0x9a8a62 }), 0.2 * sd, 0, 0));
      for (let k = 1; k < 7; k++) lean.add(box(0.4, 0.03, 0.03, lam({ color: 0x9a8a62 }), 0, k * 0.32, 0));
      lean.rotation.x = -0.17; o.add(lean);
      put(o, p.x, p.z, p.rot); block(p.x, p.z, 0.24, 0.28);
    };
    const chairDown = (x: number, z: number, rot: number) => {
      const o = new THREE.Group(), c = new THREE.Group();
      c.add(box(0.42, 0.04, 0.4, m.chair, 0, 0.44, 0), box(0.42, 0.42, 0.03, m.chair, 0, 0.48, -0.19));
      for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) c.add(cyl(0.012, 0.012, 0.44, steel, lx, 0, lz, 5));
      c.rotation.z = Math.PI / 2; c.position.set(0.44, 0.2, 0); o.add(c);
      put(o, x, z, rot); block(x, z, 0.4, 0.3);
    };
    const folders = (x: number, z: number, n: number, spread: number) => {
      for (let k = 0; k < n; k++) { const f = box(0.23, 0.012, 0.31, R() < 0.7 ? manila : white, 0, 0, 0); put(f, x + (R() - 0.5) * spread, z + (R() - 0.5) * spread, R() * 6.28); f.position.y = 0.002 + k * 0.001; }
    };
    // the yellow A-frame by the leak: ¡CUIDADO! PISO MOJADO
    const wetSign = (x: number, z: number, rot: number) => {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256; const c2 = cv.getContext('2d')!;
      c2.fillStyle = '#d6a91e'; c2.fillRect(0, 0, 128, 256); c2.fillStyle = '#16140e'; c2.textAlign = 'center';
      c2.font = 'bold 22px Arial, sans-serif'; c2.fillText('¡CUIDADO!', 64, 46);
      c2.beginPath(); c2.moveTo(64, 70); c2.lineTo(104, 140); c2.lineTo(24, 140); c2.closePath(); c2.lineWidth = 6; c2.stroke();
      c2.font = 'bold 34px Arial, sans-serif'; c2.fillText('!', 64, 132);
      c2.font = 'bold 21px Arial, sans-serif'; c2.fillText('PISO', 64, 180); c2.fillText('MOJADO', 64, 206);
      for (let k = 0; k < 900; k++) { c2.fillStyle = `rgba(40,30,10,${Math.random() * 0.18})`; c2.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const face = lam({ map: t, side: THREE.DoubleSide });
      const o = new THREE.Group();
      for (const sd of [-1, 1]) { const pnl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.6), face); pnl.position.set(0, 0.3, 0.09 * sd); pnl.rotation.set(0.28 * sd, sd > 0 ? 0 : Math.PI, 0); o.add(pnl); }
      put(o, x, z, rot); block(x, z, 0.18, 0.14);
    };
    const bucket = (x: number, z: number) => {
      const o = new THREE.Group();
      o.add(cyl(0.2, 0.17, 0.3, yellow, 0, 0, 0, 12, true), cyl(0.17, 0.17, 0.01, yellow, 0, 0.02, 0, 12), box(0.22, 0.12, 0.08, yellow, 0, 0.3, -0.12));
      const stick = cyl(0.014, 0.014, 1.35, lam({ color: 0x6b5a3a }), 0, 0, 0, 6); const pv = new THREE.Object3D(); pv.position.set(0.04, 0.12, 0.02); pv.rotation.set(0.28, 0, -0.2); pv.add(stick); o.add(pv);
      put(o, x, z, R() * 6); block(x, z, 0.22, 0.22);
    };

    // RECEPTION: a parked wheelchair by the doors, plants in the corners, boxes along the north wall, files on the floor
    boxes(12, 18, 'N', 2); plant(13, 18, 'N', 0.4); boxes(21, 18, 'N', 3, -0.4); boxes(18, 18, 'N', 1, 0.3);
    wheelchair(34.6, 46.6, Math.PI * 0.92); plant(10, 23, 'S', -0.45); bin(14, 23, 'S'); extinguisher(21, 22, 'E', -0.5);
    folders(25.6, 41.2, 7, 1.3);
    // BREAKER ROOM: oxygen chained to the wall, a ladder, boxes and a toolbox
    tanks(24, 18, 'N', 3); ladder(25, 22, 'S', 0.3); boxes(26, 22, 'S', 2, 0.2); boxes(27, 19, 'E', 1);
    { const tb = box(0.42, 0.18, 0.2, red, 0, 0, 0); put(tb, 52.2, 43.2, 0.4); const hd = box(0.2, 0.03, 0.03, m.dark, 0, 0.2, 0); put(hd, 52.2, 43.2, 0.4); hd.position.y = 0.2; block(52.2, 43.2, 0.24, 0.16); }
    // MAIN CORRIDOR: the sign and the bucket by the leak, tanks and a stand further up, boxes by the wall
    wetSign(30.42, 19.2, 1.2); bucket(30.55, 15.2); boxes(16, 15, 'E', 2); tanks(15, 16, 'W', 2); ivStand(30.45, 26.8, 0.3); bin(16, 14, 'E', 0.3);
    // NORTH CORRIDOR
    boxes(8, 3, 'N', 3); ivStand(24.4, 6.5, 1.1); boxes(23, 3, 'N', 2, 0.3); bin(26, 4, 'S'); tanks(12, 3, 'N', 2, 0.4); extinguisher(17, 3, 'N');
    // WARD B: drip stands at the heads of the beds, boxes of linen, a second chair waiting
    ivStand(6.6, 14.6, 0.4); ivStand(6.6, 22.6, 2.2); ivStand(25.4, 14.6, 2.9); ivStand(6.6, 26.6, 1.3);
    boxes(12, 6, 'N', 2); wheelchair(17.2, 28.6, 0.15); bin(9, 14, 'S', 0.4);
    // DAYROOM: a chair knocked over, plants, a bin
    chairDown(56.9, 22.6, 0.7); plant(27, 6, 'N', 0.3); plant(18, 12, 'W', 0.4); bin(25, 13, 'S'); boxes(22, 13, 'S', 1, 0.5);
    // LINEN ROOM: boxes of sheets
    boxes(5, 20, 'S', 2, 0.2); boxes(7, 20, 'S', 3, -0.2);
  }

  // Curtains: every column of cloth is a damped spring, coupled to its neighbours. Bodies push it out of
  // their way (and drag it with them as they pass), the draught sways it; the hem moves most, the rail not at all.
  updateCurtains(dt: number, time: number, agents: { x: number; z: number }[], gust: number) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.04);
    const vel = agents.map((a, i) => { const p = this.agentPrev[i]; const v = p ? { x: (a.x - p.x) / dt, z: (a.z - p.z) / dt } : { x: 0, z: 0 }; this.agentPrev[i] = { x: a.x, z: a.z }; return v; });
    for (const C of this.curtains) {
      let near = false;
      for (const a of agents) if (Math.hypot(a.x - C.cx, a.z - C.cz) < C.len / 2 + 1.2) near = true;
      if (!near && C.awake <= 0 && gust < 0.35) continue;
      const n = C.cols, o = C.o, v = C.v;
      let motion = 0;
      for (let i = 0; i <= n; i++) {
        const s = (i / n - 0.5) * C.len, px = C.cx + C.ux * s, pz = C.cz + C.uz * s;
        let f = -26 * o[i] - 3.2 * v[i];
        if (i > 0) f += 60 * (o[i - 1] - o[i]);
        if (i < n) f += 60 * (o[i + 1] - o[i]);
        f += gust * 0.9 * Math.sin(time * 1.3 + C.ph + i * 0.45) + 0.12 * Math.sin(time * 0.7 + C.ph + i * 0.2);
        for (let k = 0; k < agents.length; k++) {
          const a = agents[k], dx = a.x - px, dz = a.z - pz;
          const along = dx * C.ux + dz * C.uz, nd = dx * C.nx + dz * C.nz;
          const r = Math.hypot(along, nd * 0.8);
          if (r > 0.75) continue;
          const w = 1 - r / 0.75;
          if (k === 0 && w > 0.25 && Math.hypot(vel[0].x, vel[0].z) > 0.25) C.touched = time; // you brushed it: it swings for a while
          // out of the body's way...
          const want = -Math.sign(nd || 1) * (0.42 - Math.abs(nd)) ;
          if (Math.abs(nd) < 0.42 && Math.abs(o[i] - want) > 0.02 && Math.sign(want) * (want - o[i]) > 0) f += (want - o[i]) * 160 * w;
          // ...and dragged along a little
          f += (vel[k].x * C.nx + vel[k].z * C.nz) * 6 * w;
        }
        v[i] += f * dt; motion += Math.abs(v[i]) + Math.abs(o[i]);
      }
      for (let i = 0; i <= n; i++) o[i] = THREE.MathUtils.clamp(o[i] + v[i] * dt, -0.7, 0.7);
      C.awake = motion > 0.01 ? 2 : C.awake - dt;
      // write the cloth: displacement grows toward the hem
      const pa = C.mesh.geometry.attributes.position as THREE.BufferAttribute, arr = pa.array as Float32Array, base = C.base;
      for (let k = 0; k < pa.count; k++) {
        const x = base[k * 3], y = base[k * 3 + 1];
        const h = Math.max(0, (1.1 - y) / 2.2), u = THREE.MathUtils.clamp((x / C.len + 0.5) * n, 0, n), i0 = Math.min(n - 1, Math.floor(u)), t = u - i0; // (float32 puts the top row a hair above the rail)
        const d = (o[i0] * (1 - t) + o[i0 + 1] * t) * Math.pow(h, 1.5);
        arr[k * 3] = x; arr[k * 3 + 1] = y + Math.abs(d) * 0.12 * h; arr[k * 3 + 2] = base[k * 3 + 2] + d;
      }
      pa.needsUpdate = true;
      C.mesh.geometry.computeVertexNormals();
    }
  }

  // Back wall of a wall-hugging piece -> rotation so local +Z faces the room.
  private tape?: THREE.MeshLambertMaterial;
  private makeTape() {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 16; const g = cv.getContext('2d')!;
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#15130e' : '#c9a227'; g.beginPath(); g.moveTo(i * 16, 16); g.lineTo(i * 16 + 8, 0); g.lineTo(i * 16 + 24, 0); g.lineTo(i * 16 + 16, 16); g.fill(); }
    g.fillStyle = '#efe6cf'; g.fillRect(96, 2, 64, 12); g.fillStyle = '#15130e'; g.font = 'bold 10px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('NO PASAR', 128, 12);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return lam({ map: t, side: THREE.DoubleSide });
  }

  private backRot(cx: number, cz: number) {
    const L = this.level;
    if (L.isWall(cx - 1, cz)) return Math.PI / 2;
    if (L.isWall(cx + 1, cz)) return -Math.PI / 2;
    if (L.isWall(cx, cz - 1)) return 0;
    if (L.isWall(cx, cz + 1)) return Math.PI;
    return 0;
  }

  private worldBox(cx: number, cz: number, rot: number, b: [number, number, number, number], tall: boolean): Box {
    const c = this.level.center(cx, cz);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const pts = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, z]) => [c.x + x * cs + z * sn, c.z - x * sn + z * cs]);
    return { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), z0: Math.min(...pts.map(p => p[1])), z1: Math.max(...pts.map(p => p[1])), tall };
  }

  private furniture(cx: number, cz: number, ch: string, R: () => number) {
    const L = this.level, m = this.mats;
    const cell = L.cell(cx, cz)!;
    const g = new THREE.Group();
    const c = L.center(cx, cz);
    g.position.set(c.x, 0, c.z);
    let rot = 0; let b: [number, number, number, number] = [-0.5, -0.5, 0.5, 0.5]; let tall = false;
    const key = `${cx},${cz}`;
    switch (ch) {
      case 'B': {
        rot = this.backRot(cx, cz);
        for (const x of [-0.45, 0.45]) for (const z of [-0.92, 0.92]) g.add(box(0.04, 0.58, 0.04, m.frame, x, 0, z));
        g.add(box(0.94, 0.05, 1.9, m.frame, 0, 0.42, 0));
        g.add(box(0.96, 0.62, 0.04, m.frame, 0, 0.38, -0.95));
        g.add(box(0.96, 0.3, 0.04, m.frame, 0, 0.42, 0.95));
        g.add(box(0.9, 0.16, 1.86, m.mattress, 0, 0.47, 0));
        g.add(box(0.58, 0.1, 0.3, m.sheet, 0, 0.63, -0.72));
        if (key === '2,11') { // bed 3: pillows tied into the shape of somebody asleep
          const lump = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.05, 4, 8), m.sheet);
          lump.rotation.x = Math.PI / 2; lump.position.set(0.02, 0.74, 0.1); lump.castShadow = true;
          g.add(lump);
          g.add(box(0.98, 0.04, 1.6, m.sheet, 0, 0.63, 0.15));
        } else if (key !== '13,7' && R() < 0.6) g.add(box(0.94, 0.04, 1.2, m.sheet, 0, 0.63, 0.32));
        b = [-0.48, -0.98, 0.48, 0.98];
        {
          // the hiding spot underneath: you slide in at the foot end and lie looking out along the floor
          const loc = (lx: number, lz: number) => new THREE.Vector3(c.x + lx * Math.cos(rot) + lz * Math.sin(rot), 0, c.z - lx * Math.sin(rot) + lz * Math.cos(rot));
          const out = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
          this.lockers.push({ id: `bed_${key}`, kind: 'bed', inside: loc(0, 0.3), front: loc(0, 1.5), out, yaw: Math.atan2(-out.x, -out.z), door: new THREE.Object3D(), doorAngle: 0, doorTarget: 0 });
        }
        break;
      }
      case 'L': {
        rot = this.backRot(cx, cz);
        for (const x of [-0.6, 0.6]) g.add(box(0.58, 1.9, 0.5, m.locker, x, 0, -0.73));
        // the middle locker is the hiding spot: body + hinged door
        const body = new THREE.Group();
        body.add(box(0.58, 1.9, 0.04, m.locker, 0, 0, -0.96));
        body.add(box(0.04, 1.9, 0.5, m.locker, -0.27, 0, -0.73));
        body.add(box(0.04, 1.9, 0.5, m.locker, 0.27, 0, -0.73));
        body.add(box(0.58, 0.04, 0.5, m.locker, 0, 1.86, -0.73));
        body.add(box(0.58, 0.04, 0.5, m.locker, 0, 0, -0.73));
        g.add(body);
        const pivot = new THREE.Object3D(); pivot.userData.dynamic = true;
        pivot.position.set(-0.28, 0, -0.48);
        const door = new THREE.Group(); door.position.set(0.28, 0.01, 0);
        door.add(box(0.56, 1.3, 0.03, m.locker, 0, 0, 0), box(0.56, 0.1, 0.03, m.locker, 0, 1.78, 0));
        door.add(box(0.075, 0.48, 0.03, m.locker, -0.2425, 1.3, 0), box(0.075, 0.48, 0.03, m.locker, 0.2425, 1.3, 0));
        for (let i = 0; i < 8; i++) { const sl = box(0.41, 0.014, 0.05, m.locker, 0, 1.325 + i * 0.056, 0); sl.rotation.x = 0.55; door.add(sl); }
        door.traverse(o => { o.castShadow = false; }); // torchlight leaks through the vents
        pivot.add(door);
        g.add(pivot);
        b = [-0.9, -1.0, 0.9, -0.46]; tall = true;
        const loc = (lx: number, lz: number) => new THREE.Vector3(c.x + lx * Math.cos(rot) + lz * Math.sin(rot), 0, c.z - lx * Math.sin(rot) + lz * Math.cos(rot));
        const out = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
        this.lockers.push({ id: `locker_${key}`, kind: 'locker', inside: loc(0, -0.73), front: loc(0, 0.32), out, yaw: Math.atan2(-out.x, -out.z), door: pivot, doorAngle: 0, doorTarget: 0 });
        break;
      }
      case 'K': {
        rot = FACING[key] ?? (L.cell(cx, cz - 1)?.ch === 'K' || L.cell(cx, cz + 1)?.ch === 'K' ? Math.PI / 2 : 0);
        g.add(box(2.0, 0.05, 0.8, m.wood, 0, 0.74, 0));
        g.add(box(2.0, 0.7, 0.04, m.wood, 0, 0.04, 0.36));
        for (const x of [-0.95, 0.95]) g.add(box(0.05, 0.74, 0.76, m.wood, x, 0, 0));
        if (R() < 0.7) g.add(box(0.3, 0.06, 0.22, m.paperW, (R() - 0.5) * 1.2, 0.79, (R() - 0.5) * 0.3));
        b = [-1, -0.42, 1, 0.42];
        break;
      }
      case 'C': {
        rot = this.backRot(cx, cz);
        g.add(box(1.0, 0.04, 0.45, m.cabinet, 0, 0, -0.75));
        g.add(box(1.0, 1.7, 0.03, m.cabinet, 0, 0, -0.97));
        for (const x of [-0.49, 0.49]) g.add(box(0.03, 1.7, 0.45, m.cabinet, x, 0, -0.75));
        g.add(box(1.0, 0.03, 0.45, m.cabinet, 0, 1.68, -0.75));
        g.add(box(0.96, 0.02, 0.42, m.cabinet, 0, 1.0, -0.75));
        const doors: THREE.Object3D[] = [];
        for (const s of [-1, 1]) {
          const p = new THREE.Object3D(); p.userData.dynamic = true;
          p.position.set(0.5 * s, 0, -0.52);
          p.add(box(0.49, 1.66, 0.025, m.cabinet, -0.245 * s, 0.02, 0));
          p.userData.side = s;
          g.add(p); doors.push(p);
        }
        const fuse = new THREE.Group(); fuse.userData.dynamic = true;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10), m.ceramic);
        body.rotation.z = Math.PI / 2; fuse.add(body);
        for (const s of [-1, 1]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 10), m.copper); cap.rotation.z = Math.PI / 2; cap.position.x = 0.07 * s; fuse.add(cap); }
        fuse.position.set(0, 1.08, -0.72);
        g.add(fuse);
        b = [-0.52, -1.0, 0.52, -0.5]; tall = true;
        const wp = new THREE.Vector3(c.x, 0, c.z).add(new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot)).multiplyScalar(-0.72));
        const stand = new THREE.Vector3(c.x, 0, c.z).add(new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot)).multiplyScalar(0.7));
        this.fuse = { mesh: fuse, doors, pos: wp.setY(1.08), stand, taken: false, open: 0 };
        break;
      }
      case 's': {
        rot = this.backRot(cx, cz);
        for (const x of [-0.88, 0.88]) for (const z of [-0.95, -0.52]) g.add(box(0.04, 2.0, 0.04, m.frame, x, 0, z));
        for (let i = 0; i < 4; i++) {
          const y = 0.15 + i * 0.5;
          g.add(box(1.8, 0.03, 0.48, m.frame, 0, y, -0.74));
          for (let k = 0; k < 3; k++) if (R() < 0.75) g.add(box(0.35 + R() * 0.15, 0.08 + R() * 0.18, 0.36, m.linen, -0.6 + k * 0.6, y + 0.03, -0.74));
        }
        b = [-0.92, -1.0, 0.92, -0.48]; tall = true;
        break;
      }
      case 'h': {
        rot = FACING[key] ?? 0;
        g.add(box(1.7, 0.05, 0.08, m.frame, 0, 0.36, 0));
        for (const x of [-0.6, 0, 0.6]) {
          if (R() < 0.12) continue;
          g.add(box(0.46, 0.05, 0.44, m.chair, x, 0.43, 0.02));
          g.add(box(0.46, 0.42, 0.04, m.chair, x, 0.5, -0.2 + 0.02));
        }
        for (const x of [-0.75, 0.75]) g.add(box(0.05, 0.38, 0.05, m.frame, x, 0, 0));
        b = [-0.86, -0.3, 0.86, 0.3];
        break;
      }
      case 'o': {
        rot = FACING[key] ?? 0;
        for (const x of [-0.3, 0.3]) for (const z of [-0.85, 0.85]) {
          g.add(box(0.03, 0.72, 0.03, m.frame, x, 0.06, z));
          const w = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), m.dark); w.position.set(x, 0.05, z); g.add(w);
        }
        g.add(box(0.66, 0.06, 1.85, m.frame, 0, 0.76, 0));
        g.add(box(0.7, 0.05, 1.7, m.sheet, 0, 0.82, 0.05));
        if (key === '16,8') { const lump = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.0, 4, 8), m.sheet); lump.rotation.x = Math.PI / 2; lump.position.set(0, 0.95, 0.05); lump.scale.set(1, 1, 0.75); lump.castShadow = true; g.add(lump); }
        b = [-0.36, -0.98, 0.36, 0.98];
        break;
      }
      case 't': {
        rot = FACING[key] ?? 0;
        for (const x of [-0.27, 0.27]) for (const z of [-0.42, 0.42]) g.add(box(0.025, 0.9, 0.025, m.frame, x, 0, z));
        g.add(box(0.58, 0.03, 0.88, m.frame, 0, 0.3, 0));
        g.add(box(0.58, 0.03, 0.88, m.frame, 0, 0.86, 0));
        for (let k = 0; k < 4; k++) {
          const bt = this.bottleGeo.clone(); bt.position.set(-0.18 + R() * 0.36, 0.89, -0.35 + k * 0.22); g.add(bt);
        }
        g.add(box(0.3, 0.2, 0.3, m.paperW, 0, 0.33, 0.1));
        b = [-0.31, -0.46, 0.31, 0.46];
        break;
      }
      case 'I': { // the column itself is built with the walls (level.ts); here only its footprint
        b = [-0.42, -0.42, 0.42, 0.42]; tall = true;
        break;
      }
      case 'm': { // the dayroom's tables: a card game left half played, chairs pushed back, one on the floor
        rot = FACING[key] ?? (R() - 0.5) * 0.5;
        g.add(box(1.2, 0.04, 0.8, m.wood, 0, 0.72, 0));
        for (const x of [-0.54, 0.54]) for (const z of [-0.34, 0.34]) g.add(box(0.05, 0.72, 0.05, m.frame, x, 0, z));
        for (let k = 0; k < 9; k++) { const cd = box(0.06, 0.004, 0.09, m.paperW, (R() - 0.5) * 0.7, 0.762, (R() - 0.5) * 0.4); cd.rotation.y = R() * 3; g.add(cd); }
        const chair = (x: number, z: number, yaw: number, down = false) => {
          const c = new THREE.Group();
          c.add(box(0.42, 0.04, 0.4, m.chair, 0, 0.44, 0), box(0.42, 0.42, 0.03, m.chair, 0, 0.48, -0.19));
          for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) c.add(box(0.025, 0.44, 0.025, m.frame, lx, 0, lz));
          c.position.set(x, down ? 0.2 : 0, z); c.rotation.y = yaw; if (down) c.rotation.z = Math.PI / 2;
          g.add(c);
        };
        chair(-0.95, 0.05, Math.PI / 2 + (R() - 0.5) * 0.5); chair(0.9, -0.1, -Math.PI / 2 + (R() - 0.5) * 0.6);
        chair(0.1, 0.72, Math.PI + 0.3, true); chair(-0.15, -0.75, (R() - 0.5) * 0.4);
        b = [-0.78, -0.58, 0.78, 0.58];
        break;
      }
      case 'x': { // evacuation barricade: beds on end, mattresses and chairs piled across the corridor, taped off
        rot = L.isWall(cx, cz - 1) || L.isWall(cx, cz + 1) || L.cell(cx, cz - 1)?.ch === 'x' || L.cell(cx, cz + 1)?.ch === 'x' ? Math.PI / 2 : 0;
        const side = (y: number, z: number, tilt: number) => { // a bed frame on its side
          const f = new THREE.Group();
          f.add(box(1.9, 0.05, 0.94, m.frame, 0, 0, 0), box(1.86, 0.16, 0.9, m.mattress, 0, 0.05, 0));
          for (const x of [-0.9, 0.9]) f.add(box(0.04, 0.6, 0.04, m.frame, x, 0.2, 0.42));
          f.rotation.x = Math.PI / 2 + tilt; f.position.set((R() - 0.5) * 0.15, y, z); f.rotation.y = (R() - 0.5) * 0.12; g.add(f);
        };
        side(0.47, -0.25, 0.08); side(0.5, 0.3, -0.12);
        const mat = box(1.86, 0.16, 0.9, m.mattress, 0, 0, 0); mat.rotation.set(0.25, 0.1, 0.55); mat.position.set(0.1, 1.05, 0.05); g.add(mat);
        for (let k = 0; k < 3; k++) { // chairs thrown on top
          const c = new THREE.Group();
          c.add(box(0.42, 0.04, 0.4, m.chair, 0, 0.44, 0), box(0.42, 0.42, 0.03, m.chair, 0, 0.48, -0.19));
          for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) c.add(box(0.025, 0.44, 0.025, m.frame, lx, 0, lz));
          c.position.set(-0.6 + k * 0.6 + (R() - 0.5) * 0.2, 1.25 + R() * 0.2, (R() - 0.5) * 0.4); c.rotation.set((R() - 0.5) * 2, R() * 6, (R() - 0.5) * 2.4); g.add(c);
        }
        const tapeM = this.tape ??= this.makeTape();
        for (const [y, t] of [[0.92, 0.04], [1.38, -0.06]]) { const tp = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.09), tapeM); tp.position.set(0, y, 0.62); tp.rotation.z = t; g.add(tp); const tb = tp.clone(); tb.position.z = -0.62; tb.rotation.y = Math.PI; g.add(tb); }
        b = [-1, -1, 1, 1]; tall = true;
        break;
      }
      case 'v': {
        rot = this.backRot(cx, cz);
        g.add(box(1.2, 0.7, 0.5, m.wood, 0, 0, -0.73));
        g.add(box(0.56, 0.46, 0.46, m.dark, 0, 0.7, -0.75));
        this.tv = lam({ color: 0x0c0f0d, emissive: 0x000000 });
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.32), this.tv);
        screen.position.set(0, 0.93, -0.51);
        g.add(screen);
        b = [-0.62, -1.0, 0.62, -0.46]; tall = true;
        break;
      }
    }
    g.rotation.y = rot;
    cell.boxes = [this.worldBox(cx, cz, rot, b, tall)];
    this.group.add(g);
  }

  private makeBottle() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.038, 0.19, 8), this.mats.glass);
    body.position.y = 0.095;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.08, 8), this.mats.glass);
    neck.position.y = 0.23;
    g.add(body, neck);
    g.traverse(o => { o.castShadow = true; });
    return g;
  }

  private wallPose(cx: number, cz: number, face: string, y: number, off = 0.012) {
    const p = new THREE.Vector3(), stand = new THREE.Vector3();
    let rot = 0;
    if (face === 'S') { p.set((cx + 0.5) * T, y, (cz + 1) * T + off); rot = 0; stand.set(p.x, 0, p.z + 0.9); }
    if (face === 'N') { p.set((cx + 0.5) * T, y, cz * T - off); rot = Math.PI; stand.set(p.x, 0, p.z - 0.9); }
    if (face === 'E') { p.set((cx + 1) * T + off, y, (cz + 0.5) * T); rot = Math.PI / 2; stand.set(p.x + 0.9, 0, p.z); }
    if (face === 'W') { p.set(cx * T - off, y, (cz + 0.5) * T); rot = -Math.PI / 2; stand.set(p.x - 0.9, 0, p.z); }
    return { p, rot, stand };
  }

  private place(tex: Tex, R: () => number) {
    const L = this.level, m = this.mats;
    BOTTLES.forEach(([cx, cz], i) => {
      const c = L.center(cx, cz);
      const mesh = this.bottleGeo.clone(); mesh.userData.dynamic = true;
      const pos = new THREE.Vector3(c.x + (R() - 0.5) * 0.8, 0, c.z + (R() - 0.5) * 0.8);
      mesh.position.copy(pos);
      if (R() < 0.5) { mesh.rotation.z = Math.PI / 2; mesh.position.y = 0.04; mesh.rotation.y = R() * 6; }
      this.group.add(mesh);
      this.bottles.push({ id: `bottle_${i}`, mesh, pos, picked: false });
    });

    for (const n of NOTES) {
      const pl = n.place;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.29), n.kind === 'scrawl' ? m.paperW : m.paper);
      let pos: THREE.Vector3, stand: THREE.Vector3;
      if (pl.surface === 'wall') {
        const w = this.wallPose(pl.cx, pl.cz, pl.face!, 1.45);
        mesh.position.copy(w.p); mesh.rotation.y = w.rot + (R() - 0.5) * 0.1;
        mesh.rotateZ((R() - 0.5) * 0.2);
        pos = w.p.clone(); stand = w.stand;
      } else {
        const c = L.center(pl.cx, pl.cz);
        const y = pl.surface === 'desk' ? 0.795 : 0.885;
        pos = new THREE.Vector3(c.x + (pl.ox ?? 0), y, c.z + (pl.oz ?? 0));
        mesh.position.copy(pos);
        mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = (R() - 0.5) * 0.8;
        stand = pos.clone().setY(0);
      }
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.notes.push({ def: n, mesh, pos, stand, read: false });
    }

    for (const l of LAMPS) {
      const c = L.center(l.cx, l.cz);
      const g = new THREE.Group();
      g.position.set(c.x + 0.55, 0.79, c.z - 0.15);
      g.add(box(0.16, 0.03, 0.16, m.dark, 0, 0, 0));
      g.add(box(0.025, 0.36, 0.025, m.dark, 0, 0.03, 0));
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.16, 10, 1, true), lam({ color: 0x3d4a3a, side: THREE.DoubleSide }));
      shade.position.y = 0.42; g.add(shade);
      const bulbM = lam({ color: 0xfff1d0, emissive: 0x000000 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), bulbM); bulb.position.y = 0.37; g.add(bulb);
      const light = new THREE.PointLight(0xffc98a, 0, 7.5, 2);
      light.position.set(0, 0.4, 0);
      g.add(light);
      this.group.add(g);
      const pos = new THREE.Vector3(g.position.x, 1.2, g.position.z);
      const halo = this.halo(tex, 0xffc070, 0.9); halo.position.set(0, 0.38, 0); g.add(halo);
      this.lamps.push({ id: l.id, pos, stand: new THREE.Vector3(c.x + (l.cx === 11 ? 1.1 : 0), 0, c.z + (l.cx === 11 ? 0 : 0.95)), light, bulb: bulbM, on: false, onTime: 0, halo });
    }

    EMERGENCY.forEach((e, i) => {
      const lens = lam({ color: 0x401010, emissive: 0x9a1a10 });
      const fx = box(0.34, 0.08, 0.14, lens, e.x, e.y - 0.04, e.z);
      fx.castShadow = false;
      this.group.add(fx);
      const light = new THREE.PointLight(0xff3018, 2.2, 8, 2);
      light.position.set(e.x, e.y - 0.5, e.z); // hung low enough not to burn a hot spot into the ceiling
      this.group.add(light);
      const halo = this.halo(tex, 0xff3a22, 0.95); halo.position.set(e.x, e.y - 0.08, e.z); this.group.add(halo);
      this.em.push({ light, lens, base: 2.2, t: 0, phase: i * 1.7, halo });
    });
    // the way in: an amber battery lamp over the breaker room door, breathing slowly; from where you start it is the
    // one warm light in the room
    {
      const lens = lam({ color: 0x3a2610, emissive: 0xb86a18 });
      const fx = box(0.3, 0.07, 0.12, lens, 43.84, 2.9, 41); fx.castShadow = false; this.group.add(fx);
      const light = new THREE.PointLight(0xffa64a, 2.6, 10, 2);
      light.position.set(43.1, 2.35, 41); // out from the wall: it washes the door and the sign instead of burning a spot
      this.group.add(light);
      const halo = this.halo(tex, 0xffb050, 0.9); halo.position.set(43.8, 2.86, 41); this.group.add(halo);
      this.em.push({ light, lens, base: 2.6, t: 0, phase: 0, halo, beacon: true });
    }

    // glass shards that crunch underfoot
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.004, 0, 0.05, 0.004, 0.012, 0.012, 0.004, 0.04], 3));
    tri.computeVertexNormals();
    const shards = new THREE.InstancedMesh(tri, m.shard, GLASS.length * 30);
    const dm = new THREE.Object3D();
    let k = 0;
    for (const [cx, cz] of GLASS) {
      this.glass.add(`${cx},${cz}`);
      const c = L.center(cx, cz);
      for (let i = 0; i < 30; i++) {
        dm.position.set(c.x + (R() - 0.5) * 1.8, 0, c.z + (R() - 0.5) * 1.8);
        dm.rotation.set(0, R() * 6.28, 0); dm.scale.setScalar(0.6 + R() * 1.2);
        dm.updateMatrix(); shards.setMatrixAt(k++, dm.matrix);
      }
    }
    this.group.add(shards);

    for (const s of SIGNS) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.35), lam({ map: signTex(s.text, s.sub, (s as any).green) }));
      const n = { N: [0, 0, -1], S: [0, 0, 1], E: [1, 0, 0], W: [-1, 0, 0] }[s.face as 'N']!;
      mesh.position.set(s.x + n[0] * 0.02, s.y, s.z + n[2] * 0.02);
      mesh.rotation.y = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 }[s.face as 'N'];
      this.group.add(mesh);
    }

    // breaker panel on the east wall of the breaker room
    const pc = this.level.cells.find(c => c.ch === 'P')!;
    const pose = this.wallPose(pc.cx, pc.cz, 'W', 1.55, 0.07);
    const pg = new THREE.Group();
    pg.position.copy(pose.p); pg.rotation.y = pose.rot;
    const face = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.25, 0.12), [m.frame, m.frame, m.frame, m.frame, m.panel, m.frame]);
    face.castShadow = true; face.receiveShadow = true;
    pg.add(face);
    const leds: THREE.MeshLambertMaterial[] = [];
    const fuses: THREE.Object3D[] = [];
    for (let i = 0; i < 4; i++) {
      const y = 0.39 - i * 0.235;
      const led = lam({ color: 0x300808, emissive: 0x5a0a06 });
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), led);
      s.position.set(-0.38, y, 0.07); pg.add(s); leds.push(led);
      const f = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 10), m.ceramic); body.rotation.z = Math.PI / 2; f.add(body);
      f.position.set(-0.08, y, 0.08); f.visible = false; f.userData.dynamic = true; pg.add(f); fuses.push(f);
    }
    this.group.add(pg);
    this.panel = { pos: pose.p.clone(), stand: pose.stand, leds, fuses, installed: 0 };
  }

  cables: THREE.Object3D[] = [];
  candles: { flames: THREE.Sprite[]; light: THREE.PointLight | null; lit: boolean } = { flames: [], light: null, lit: true };
  drips: Drip[] = [];
  onDrip: ((x: number, z: number) => void) | null = null;

  private halo(tex: Tex, color: number, size: number) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glint, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.5 }));
    sp.scale.setScalar(size);
    return sp;
  }

  // Set dressing: moonlit windows, privacy curtains, puddles, debris, cables, a fallen ceiling.
  private decorate(tex: Tex, R: () => number) {
    const L = this.level, m = this.mats;
    const add = (o: THREE.Object3D) => { this.group.add(o); return o; };
    // windows with moonlight shafts and pools; face = direction the window looks into the room
    const glass = new THREE.MeshLambertMaterial({ map: tex.window, emissive: 0x2c3a48, emissiveMap: tex.window });
    this.windowGlass = glass;
    const shaftM = new THREE.MeshBasicMaterial({ map: tex.shaft, color: 0x7f9cc0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const poolM = new THREE.MeshBasicMaterial({ map: tex.pool, color: 0x5f7fa6, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const windows: [number, number, number, number][] = [[4, 17, 1, 0], [4, 21, 1, 0], [4, 25, 1, 0], [58, 17, -1, 0], [58, 23, -1, 0], [23, 48, 0, -1], [41, 48, 0, -1]];
    this.shafts.push(shaftM); this.poolMat = poolM;
    for (const [x, z, nx, nz] of windows) {
      this.windows.push({ x, z, nx, nz });
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), glass);
      w.position.set(x + nx * 0.01, 1.78, z + nz * 0.01);
      w.rotation.y = Math.atan2(nx, nz);
      add(w);
      const sill = box(1.1, 0.05, 0.14, m.frame, x + nx * 0.06, 1.0, z + nz * 0.06); sill.rotation.y = w.rotation.y; add(sill);
      const reach = 2.1, px = x + nx * reach, pz = z + nz * reach;
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.7), poolM);
      pool.rotation.x = -Math.PI / 2; pool.rotation.z = Math.atan2(-nx, -nz);
      pool.position.set(px, 0.012, pz);
      add(pool);
      const win = new THREE.Vector3(x, 1.78, z), poolP = new THREE.Vector3(px, 0.02, pz);
      const up = win.clone().sub(poolP), len = up.length(); up.normalize(); // texture top (bright) sits at the window
      const along = new THREE.Vector3(-nz, 0, nx);
      for (const k of [0, 1]) {
        const X = k ? new THREE.Vector3().crossVectors(up, along).normalize() : along.clone();
        const Z = new THREE.Vector3().crossVectors(X, up).normalize();
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(k ? 0.75 : 1.0, len), shaftM);
        sh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, up, Z));
        sh.position.copy(win).add(poolP).multiplyScalar(0.5);
        add(sh);
      }
    }
    // ward privacy curtains on rails: they swing when you or she brush past, and breathe with the draught
    const cur = new THREE.MeshLambertMaterial({ map: tex.curtain, alphaTest: 0.5, side: THREE.DoubleSide });
    const rail = new THREE.MeshLambertMaterial({ color: 0x7c7f78 });
    const curtain = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), cols = Math.max(8, Math.round(len * 7));
      const geo = new THREE.PlaneGeometry(len, 2.2, cols, 8);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.05); // folds
      geo.computeVertexNormals();
      const c = new THREE.Mesh(geo, cur);
      c.position.set((x0 + x1) / 2, 1.45, (z0 + z1) / 2);
      c.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
      c.castShadow = true; c.receiveShadow = true;
      c.userData.dynamic = true; this.group.add(c);
      this.curtains.push({ mesh: c, base: Float32Array.from(p.array as Float32Array), cx: c.position.x, cz: c.position.z, ux: (x1 - x0) / len, uz: (z1 - z0) / len, nx: Math.sin(c.rotation.y), nz: Math.cos(c.rotation.y), len, cols, o: new Float32Array(cols + 1), v: new Float32Array(cols + 1), ph: this.curtains.length * 1.7, awake: 1, touched: -99 });
      this.level.screens.push({ ax: x0, az: z0, bx: x1, bz: z1 });
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len + 0.2, 5), rail);
      r.position.set(c.position.x, 2.58, c.position.z); r.rotation.z = Math.PI / 2; r.rotation.y = c.rotation.y;
      add(r);
    };
    for (const row of [7, 9, 11]) curtain(4.1, row * 2 + 2.15, 6.4, row * 2 + 2.15);
    curtain(6.7, 14.2, 6.7, 15.6); curtain(6.7, 22.4, 6.7, 23.8); curtain(6.7, 26.3, 6.7, 27.6);
    curtain(26.0, 16.15, 27.9, 16.15); curtain(26.0, 25.85, 27.9, 25.85);
    // wet floor patches that catch the torch
    const pudM = new THREE.MeshStandardMaterial({ color: 0x060707, roughness: 0.08, metalness: 0, transparent: true, alphaMap: tex.puddle, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const { x, z, s: sc } of LEAKS) { // under the leaks (the ceiling above is stained to match)
      const pd = new THREE.Mesh(new THREE.PlaneGeometry(1.6 * sc, 1.2 * sc), pudM);
      pd.rotation.x = -Math.PI / 2; pd.rotation.z = R() * 6; pd.position.set(x, 0.008, z); pd.receiveShadow = true;
      add(pd);
    }
    // paper and tile debris along the walls
    const debM = new THREE.MeshLambertMaterial({ map: tex.debris, alphaTest: 0.5, side: THREE.DoubleSide });
    const deb = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.42), debM, 60);
    const dm = new THREE.Object3D(); let n = 0;
    for (const c of L.cells) {
      if (c.kind !== 'floor' || n >= 60 || R() > 0.32) continue;
      const nearWall = L.isWall(c.cx - 1, c.cz) || L.isWall(c.cx + 1, c.cz) || L.isWall(c.cx, c.cz - 1) || L.isWall(c.cx, c.cz + 1);
      if (!nearWall) continue;
      const p = L.center(c.cx, c.cz);
      dm.position.set(p.x + (R() - 0.5) * 1.6, 0.01 + R() * 0.004, p.z + (R() - 0.5) * 1.6);
      dm.rotation.set(-Math.PI / 2, 0, R() * 6); dm.scale.setScalar(0.7 + R() * 0.8); dm.updateMatrix();
      deb.setMatrixAt(n++, dm.matrix);
    }
    deb.count = n; deb.receiveShadow = true;
    add(deb);
    // hanging cables
    const cabM = new THREE.MeshLambertMaterial({ color: 0x151614 });
    for (const [x, z, l] of [[31.2, 12, 0.9], [33, 19, 0.6], [32.4, 27, 1.1], [20, 7.2, 0.8], [44, 8.6, 1.2], [9, 13, 0.7], [11, 24, 0.9], [48, 18, 0.6]]) {
      const pv = new THREE.Object3D(); pv.position.set(x, 3, z); pv.userData.dynamic = true;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, l, 4), cabM); c.position.y = -l / 2; c.castShadow = true;
      pv.add(c); add(pv); this.cables.push(pv);
    }
    // ceiling panels hanging open
    const ceilM = new THREE.MeshLambertMaterial({ map: tex.ceiling, side: THREE.DoubleSide });
    for (const [x, z, ry, tilt] of [[31, 14, 0.2, 1.0], [33, 29, 1.8, 0.7], [10, 19, 0.9, 1.2], [20, 7.5, 2.6, 0.8]]) {
      const pv = new THREE.Object3D(); pv.position.set(x, 2.98, z); pv.rotation.y = ry;
      const pnl = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), ceilM);
      pnl.position.set(0, 0, 0.31); pnl.rotation.x = Math.PI / 2;
      const hinge = new THREE.Object3D(); hinge.rotation.x = tilt; hinge.add(pnl); pv.add(hinge);
      pnl.castShadow = true; add(pv);
    }
    // an overturned wheelchair in the north corridor (collides as a low box)
    const wc = new THREE.Group();
    const steel = new THREE.MeshLambertMaterial({ color: 0x8e918a });
    for (const s of [-1, 1]) {
      const hub = new THREE.Object3D(); hub.position.set(0.24 * s, 0.32, 0); wc.add(hub); this.wheels.push(hub);
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 18), steel); w.rotation.y = Math.PI / 2; hub.add(w);
      for (let k = 0; k < 6; k++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.58, 3), steel); sp.rotation.x = (k / 6) * Math.PI; hub.add(sp); }
    }
    wc.add(box(0.46, 0.04, 0.44, m.chair, 0, 0.45, 0)); wc.add(box(0.46, 0.42, 0.04, m.chair, 0, 0.48, -0.22));
    wc.rotation.set(0, 0.6, Math.PI / 2); wc.position.set(18.6, 0.24, 7.6);
    wc.traverse(o => { o.castShadow = true; });
    add(wc); this.wheelchair = wc; wc.userData.dynamic = true;
    L.cell(9, 3)!.boxes.push({ x0: 18.1, z0: 7.1, x1: 19.2, z1: 8.2, tall: false });
    // a stained mattress leaning in the main corridor
    const mat = box(0.95, 1.85, 0.16, m.mattress, 0, 0, 0); mat.position.set(30.42, 0.02, 27.4); mat.rotation.set(0.0, Math.PI / 2, -0.24);
    add(mat);
    L.cell(15, 13)!.boxes.push({ x0: 30.0, z0: 26.9, x1: 30.75, z1: 27.9, tall: false });
    // behind reception: San Jorge over a shelf of votive candles. Somebody keeps them lit.
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.96), new THREE.MeshLambertMaterial({ map: tex.sanJorge }));
    pic.position.set(20.03, 1.9, 42); pic.rotation.y = Math.PI / 2; pic.receiveShadow = true; add(pic); this.sanJorge = pic;
    add(box(0.14, 0.03, 0.56, m.frame, 20.08, 1.2, 42));
    const wax = new THREE.MeshLambertMaterial({ color: 0xe6dcc0, emissive: 0x2a1606 });
    const flameM = new THREE.SpriteMaterial({ map: tex.glint, color: 0xffb35a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    for (let i = 0; i < 5; i++) {
      const h = 0.07 + R() * 0.1, cz = 41.8 + i * 0.1 + (R() - 0.5) * 0.03, cx = 20.06 + R() * 0.05;
      const cd = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.021, h, 8), wax); cd.position.set(cx, 1.215 + h / 2, cz); add(cd);
      const fl = new THREE.Sprite(flameM.clone()); fl.position.set(cx, 1.23 + h + 0.03, cz); fl.scale.set(0.05, 0.085, 1); add(fl);
      this.candles.flames.push(fl);
    }
    this.candles.light = new THREE.PointLight(0xffa04a, 1.1, 4.5, 2);
    this.candles.light.position.set(20.35, 1.45, 42); add(this.candles.light);
    // the calendar nobody turned, and a crucifix over the ward door
    const cal = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.51), new THREE.MeshLambertMaterial({ map: tex.calendar }));
    cal.position.set(25.2, 1.72, 36.02); add(cal); this.calendarMesh = cal;
    const cross = new THREE.Group();
    const woodM = new THREE.MeshLambertMaterial({ map: tex.wood, color: 0x6a5038 });
    cross.add(box(0.04, 0.42, 0.03, woodM, 0, 0, 0), box(0.26, 0.04, 0.03, woodM, 0, 0.08, 0));
    cross.add(box(0.03, 0.17, 0.02, new THREE.MeshLambertMaterial({ color: 0xcfc5b0 }), 0, 0.0, 0.02));
    cross.add(box(0.036, 0.008, 0.006, new THREE.MeshLambertMaterial({ color: 0xece6d6 }), 0, 0.135, 0.032)); // tape over its eyes
    cross.position.set(27.97, 2.62, 21); cross.rotation.y = -Math.PI / 2; add(cross); this.crucifix = cross;
    // water drips from the ceiling
    const dropM = new THREE.MeshBasicMaterial({ color: 0x9fb2b4, transparent: true, opacity: 0.6 });
    const ringM = () => new THREE.MeshBasicMaterial({ color: 0xa8b8bb, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    for (const { x, z } of LEAKS.filter(l => l.drip)) {
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 4), dropM); drop.position.set(x, 2.95, z); drop.visible = false; drop.userData.dynamic = true; add(drop);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.055, 16), ringM()); ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.015, z); ring.visible = false; ring.userData.dynamic = true; add(ring);
      this.drips.push({ x, z, t: R() * 3, drop, ring, y: 2.95, ringT: 0 });
    }
  }

  /** while the finale borrows the lamps, they are left alone here */
  hold = false;
  update(dt: number, t: number, flickerBoost: number, reduced: boolean) {
    for (const e of this.hold ? [] : this.em) {
      e.t += dt;
      // slow, irregular dips; never faster than ~3 per second
      const w = Math.sin(t * 0.7 + e.phase) * 0.5 + Math.sin(t * 2.3 + e.phase * 3) * 0.3 + Math.sin(t * 5.1 + e.phase) * 0.2 * (reduced ? 0 : 1);
      let k = e.beacon ? 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 2.1)) : 0.75 + 0.25 * w;
      if (!reduced && flickerBoost > 0) k *= 1 - flickerBoost * (0.5 + 0.5 * Math.sin(t * 9.4 + e.phase)) * 0.6;
      e.light.intensity = e.base * Math.max(0.15, k);
      if (e.beacon) e.lens.emissive.setRGB(0.95 * k, 0.55 * k, 0.16 * k); else e.lens.emissive.setRGB(0.6 * k, 0.1 * k, 0.06 * k);
      if (e.halo) (e.halo.material as THREE.SpriteMaterial).opacity = 0.42 * Math.max(0.15, k);
    }
    for (const l of this.hold ? [] : this.lamps) {
      const target = l.on ? 5.5 : 0;
      l.light.intensity += (target - l.light.intensity) * Math.min(1, dt * 12);
      l.bulb.emissive.setRGB(l.on ? 1 : 0, l.on ? 0.8 : 0, l.on ? 0.55 : 0);
      if (l.halo) (l.halo.material as THREE.SpriteMaterial).opacity = l.light.intensity / 5.5 * 0.7;
      if (l.on) l.onTime += dt; else l.onTime = 0;
    }
    for (const c of this.cables) c.rotation.z = Math.sin(t * 0.6 + c.position.x) * 0.06;
    // candle flames: a slow breathing flicker, each on its own phase
    let cf = 0;
    this.candles.flames.forEach((f, i) => {
      const k = 0.82 + 0.1 * Math.sin(t * 7.3 + i * 2.1) + 0.08 * Math.sin(t * 13.1 + i * 5.7);
      f.scale.set(0.05 * (0.9 + 0.1 * k), 0.085 * k, 1); (f.material as THREE.SpriteMaterial).opacity = 0.75 + 0.25 * k; cf += k;
    });
    if (this.candles.light) this.candles.light.intensity = this.candles.lit ? 1.1 * (cf / Math.max(1, this.candles.flames.length)) : 0;
    for (const d of this.drips) {
      d.t -= dt;
      if (d.t <= 0 && !d.drop.visible) { d.drop.visible = true; d.y = 2.95; }
      if (d.drop.visible) {
        d.y -= dt * 6.5; d.drop.position.y = d.y;
        if (d.y <= 0.02) { d.drop.visible = false; d.t = 1.6 + Math.random() * 3; d.ringT = 0.6; d.ring.visible = true; this.onDrip?.(d.x, d.z); }
      }
      if (d.ringT > 0) { d.ringT -= dt; const k = 1 - d.ringT / 0.6; d.ring.scale.setScalar(0.2 + k * 1.4); (d.ring.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k); if (d.ringT <= 0) d.ring.visible = false; }
    }
    for (const lk of this.lockers) {
      lk.doorAngle += (lk.doorTarget - lk.doorAngle) * Math.min(1, dt * 10);
      lk.door.rotation.y = -lk.doorAngle;
    }
    if (this.fuse) {
      const target = this.fuse.taken ? 1 : 0;
      this.fuse.open += (target - this.fuse.open) * Math.min(1, dt * 5);
      for (const d of this.fuse.doors) d.rotation.y = d.userData.side * 1.6 * this.fuse.open;
    }
  }
}
