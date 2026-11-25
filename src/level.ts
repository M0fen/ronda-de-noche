import * as THREE from 'three';
import { MAP, BARRED, DOOR_PLATES, AREAS, LEAKS } from './content';
import { doorLeaf } from './decor';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Tex, Style } from './textures';
import { rng, STYLES } from './textures';

export const T = 2;          // tile size (m)
export const H = 3;          // ceiling height (m)
export const DOOR_W = 1.2;   // door opening width
export const DOOR_H = 2.2;   // door opening height

export interface Box { x0: number; z0: number; x1: number; z1: number; tall: boolean }
export type Kind = 'wall' | 'floor' | 'door' | 'furn';

export interface Door {
  id: string; cx: number; cz: number; axis: 'x' | 'z';
  open: boolean; angle: number; barred: boolean; unbarSide?: { dx: number; dz: number };
  pivot: THREE.Object3D; jambs: Box[]; panel: Box; swing: number;
  touchedAt?: number; // game time the player last opened or shut it (she notices a door that isn't how she left it)
}

export interface Cell { ch: string; cx: number; cz: number; kind: Kind; boxes: Box[]; door?: Door; glass?: boolean }

const WALLS = '#X=P';
const FURN = 'BLKCshotvImx';

// Collects quads into one BufferGeometry per material.
class Geo {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  quad(p: number[][], n: number[], uv: number[][]) {
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(...p[i]); this.nor.push(...n); this.uv.push(...uv[i]); }
    // wind the quad so its front face is the side the normal points to (door frames were built inside-out)
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const f = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2];
    if (f >= 0) this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  // Vertical quad from a to b (left to right as seen from the front), y0..y1.
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, n: number[], u0 = 0, u1 = 1) {
    this.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], n, [[u0, y0 / H], [u1, y0 / H], [u1, y1 / H], [u0, y1 / H]]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Do segments AB and CD cross?
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az), d2 = o(cx, cz, dx, dz, bx, bz), d3 = o(ax, az, bx, bz, cx, cz), d4 = o(ax, az, bx, bz, dx, dz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export class Level {
  w = MAP[0].length; h = MAP.length;
  cells: Cell[] = [];
  doors: Door[] = [];
  // hanging cloth (the ward's privacy curtains): you walk through it, nobody sees through it
  screens: { ax: number; az: number; bx: number; bz: number }[] = [];
  start = { x: 0, z: 0 };
  group = new THREE.Group();

  constructor(tex: Tex) {
    MAP.forEach((row, z) => { if (row.length !== this.w) throw new Error(`map row ${z} has ${row.length} columns`); });
    for (let cz = 0; cz < this.h; cz++) for (let cx = 0; cx < this.w; cx++) {
      const ch = MAP[cz][cx];
      let kind: Kind = 'floor';
      if (WALLS.includes(ch)) kind = 'wall';
      else if ('DdJ'.includes(ch)) kind = 'door';
      else if (FURN.includes(ch)) kind = 'furn';
      if (ch === 'S') this.start = this.center(cx, cz);
      this.cells.push({ ch, cx, cz, kind, boxes: [] });
    }
    this.buildGeometry(tex);
  }

  inside(cx: number, cz: number) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }
  /** the finish a cell's floor and walls get: each part of the building has its own */
  styleAt(cx: number, cz: number): Style {
    const a = AREAS.find(r => cx >= r.x0 && cx <= r.x1 && cz >= r.z0 && cz <= r.z1);
    return ({ reception: 'reception', breaker: 'breaker', corridor: 'corridor', north: 'corridor', ward: 'ward', dayroom: 'dayroom', linen: 'linen' } as Record<string, Style>)[a?.id ?? ''] ?? 'corridor';
  }
  cell(cx: number, cz: number): Cell | undefined { return this.inside(cx, cz) ? this.cells[cz * this.w + cx] : undefined; }
  at(x: number, z: number) { return this.cell(Math.floor(x / T), Math.floor(z / T)); }
  center(cx: number, cz: number) { return { x: (cx + 0.5) * T, z: (cz + 0.5) * T }; }
  isWall(cx: number, cz: number) { const c = this.cell(cx, cz); return !c || c.kind === 'wall'; }
  isOpen(cx: number, cz: number) { const c = this.cell(cx, cz); return !!c && (c.kind === 'floor' || c.kind === 'furn'); }

  // Walkable for the Nurse's pathfinding: floors and usable doors.
  walkable(cx: number, cz: number) {
    const c = this.cell(cx, cz);
    if (!c) return false;
    if (c.kind === 'floor') return true;
    if (c.kind === 'door') return !c.door!.barred;
    return false;
  }

  private buildGeometry(tex: Tex) {
    const R = rng(77);
    const walls = Object.fromEntries(STYLES.map(st => [st, [new Geo(), new Geo()]])) as Record<Style, Geo[]>;
    const floors = Object.fromEntries(STYLES.map(st => [st, [new Geo(), new Geo()]])) as Record<Style, Geo[]>;
    const cols = Object.fromEntries(STYLES.map(st => [st, new Geo()])) as Record<Style, Geo>;
    const ceil = new Geo();
    const exitG = new Geo();
    const lockG = new Geo();
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];

    for (const c of this.cells) {
      if (c.kind === 'wall') continue;
      const x0 = c.cx * T, z0 = c.cz * T, x1 = x0 + T, z1 = z0 + T;
      const st = c.kind === 'door' ? 'corridor' : this.styleAt(c.cx, c.cz);
      floors[st][R() < 0.5 ? 0 : 1].quad([[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      ceil.quad([[x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]); // door cells too: no black holes overhead
      if (c.kind === 'door') { this.buildDoor(c, (cx, cz) => walls[this.styleAt(cx, cz)][0], tex); continue; }
      if (c.ch === 'I') { // a column in the middle of a big room: 0.84 m square, finished like the walls around it
        const g = cols[st], h = 0.42, mx = x0 + 1, mz = z0 + 1;
        g.wall(mx - h, mz + h, mx + h, mz + h, 0, H, [0, 0, 1], 0, 0.42);
        g.wall(mx + h, mz - h, mx - h, mz - h, 0, H, [0, 0, -1], 0.3, 0.72);
        g.wall(mx + h, mz + h, mx + h, mz - h, 0, H, [1, 0, 0], 0.55, 0.97);
        g.wall(mx - h, mz - h, mx - h, mz + h, 0, H, [-1, 0, 0], 0.12, 0.54);
      }
      for (const [dx, dz] of dirs) {
        const n = this.cell(c.cx + dx, c.cz + dz);
        if (!n || n.kind !== 'wall') continue;
        const g = walls[st][R() < 0.5 ? 0 : 1]; // the double doors at X and = are real geometry now (dressing.ts)
        if (dz === -1) g.wall(x0, z0, x1, z0, 0, H, [0, 0, 1]);
        if (dz === 1) g.wall(x1, z1, x0, z1, 0, H, [0, 0, -1]);
        if (dx === -1) g.wall(x0, z1, x0, z0, 0, H, [1, 0, 0]);
        if (dx === 1) g.wall(x1, z0, x1, z1, 0, H, [-1, 0, 0]);
      }
    }
    // the colour maps double as bump maps: grout, peeled paint and seams read as relief under the torch
    const lam = (map: THREE.Texture, bump = 0) => new THREE.MeshLambertMaterial(bump ? { map, bumpMap: map, bumpScale: bump } : { map });
    const add = (g: Geo, m: THREE.Material) => {
      const mesh = new THREE.Mesh(g.build(), m);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    const gu = this.grimeUniforms();
    for (const st of STYLES) if (cols[st].idx.length) add(cols[st], grime(lam(tex.walls[st][0], 2.2), 0, gu)).castShadow = true;
    for (const st of STYLES) for (let i = 0; i < 2; i++) {
      if (walls[st][i].idx.length) add(walls[st][i], grime(lam(tex.walls[st][i], 2.2), 0, gu));
      if (floors[st][i].idx.length) add(floors[st][i], grime(lam(tex.floors[st][i], 1.4), 1, gu));
    }
    add(ceil, grime(lam(tex.ceiling), 2, gu)); // no bump on the ceiling: seen at a grazing angle overhead its derivatives degenerate into black patches
    add(exitG, lam(tex.exitDoors));
    add(lockG, lam(tex.lockedDoors));

    for (const c of this.cells) if (c.kind === 'wall') c.boxes = [{ x0: c.cx * T, z0: c.cz * T, x1: (c.cx + 1) * T, z1: (c.cz + 1) * T, tall: true }];
    // glass marks live in props; doors are built above.
    this.doorMat = new THREE.MeshLambertMaterial({ map: tex.door });
    this.doors.forEach((d, i) => this.makePanel(d, i));
    this.casings();
  }

  private doorMat!: THREE.MeshLambertMaterial;

  // A blurred map of where the walls are (4 texels a tile): high along the skirting, higher still in corners.
  // The surface shader uses it for the dirt that collects there; the leaks list stains ceiling, floor and walls.
  private grimeUniforms() {
    const S = 4, W = this.w * S, Hh = this.h * S;
    let a = new Float32Array(W * Hh);
    for (let z = 0; z < Hh; z++) for (let x = 0; x < W; x++) a[z * W + x] = this.isWall(Math.floor(x / S), Math.floor(z / S)) ? 1 : 0;
    const blur = (src: Float32Array) => {
      const t = new Float32Array(src.length), o = new Float32Array(src.length), r = 2;
      for (let z = 0; z < Hh; z++) for (let x = 0; x < W; x++) { let s = 0; for (let k = -r; k <= r; k++) s += src[z * W + Math.min(W - 1, Math.max(0, x + k))]; t[z * W + x] = s / (2 * r + 1); }
      for (let z = 0; z < Hh; z++) for (let x = 0; x < W; x++) { let s = 0; for (let k = -r; k <= r; k++) s += t[Math.min(Hh - 1, Math.max(0, z + k)) * W + x]; o[z * W + x] = s / (2 * r + 1); }
      return o;
    };
    a = blur(blur(a));
    const px = new Uint8Array(W * Hh * 4);
    for (let i = 0; i < a.length; i++) { px[i * 4] = Math.round(a[i] * 255); px[i * 4 + 3] = 255; }
    const tex = new THREE.DataTexture(px, W, Hh, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    return {
      uField: { value: tex }, uFieldSize: { value: new THREE.Vector2(this.w * T, this.h * T) },
      uLeaks: { value: LEAKS.map(l => new THREE.Vector4(l.x, l.z, 0.75 + l.s * 0.55, 0)) },
    };
  }

  private buildDoor(c: Cell, geoFor: (cx: number, cz: number) => Geo, _tex: Tex) {
    const x0 = c.cx * T, z0 = c.cz * T, x1 = x0 + T, z1 = z0 + T;
    const xc = x0 + T / 2, zc = z0 + T / 2, hw = DOOR_W / 2;
    const axis: 'x' | 'z' = this.isWall(c.cx - 1, c.cz) && this.isWall(c.cx + 1, c.cz) ? 'x' : 'z';
    // each face of the frame takes the finish of the room it faces
    const ga = axis === 'x' ? geoFor(c.cx, c.cz - 1) : geoFor(c.cx - 1, c.cz), gb = axis === 'x' ? geoFor(c.cx, c.cz + 1) : geoFor(c.cx + 1, c.cz);
    let g = ga;
    const key = `${c.cx},${c.cz}`;
    const door: Door = {
      id: `door_${key}`, cx: c.cx, cz: c.cz, axis, open: c.ch === 'd', angle: c.ch === 'd' ? 1.45 : 0,
      barred: c.ch === 'J', unbarSide: BARRED[key], pivot: new THREE.Object3D(), jambs: [], swing: 1,
      panel: axis === 'x' ? { x0: xc - hw, z0: zc - 0.08, x1: xc + hw, z1: zc + 0.08, tall: true }
        : { x0: xc - 0.08, z0: zc - hw, x1: xc + 0.08, z1: zc + hw, tall: true },
    };
    if (axis === 'x') {
      door.jambs = [{ x0, z0, x1: xc - hw, z1, tall: true }, { x0: xc + hw, z0, x1, z1, tall: true }];
      // front and back faces: jambs plus lintel
      g.wall(x0, z0, xc - hw, z0, 0, H, [0, 0, -1], 0, 0.2); g.wall(xc + hw, z0, x1, z0, 0, H, [0, 0, -1], 0.8, 1);
      g.wall(xc - hw, z0, xc + hw, z0, DOOR_H, H, [0, 0, -1], 0.2, 0.8);
      g = gb;
      g.wall(x1, z1, xc + hw, z1, 0, H, [0, 0, 1], 0, 0.2); g.wall(xc - hw, z1, x0, z1, 0, H, [0, 0, 1], 0.8, 1);
      g.wall(xc + hw, z1, xc - hw, z1, DOOR_H, H, [0, 0, 1], 0.2, 0.8);
      // reveal faces and soffit
      g.wall(xc - hw, z0, xc - hw, z1, 0, DOOR_H, [1, 0, 0], 0, 1);
      g.wall(xc + hw, z1, xc + hw, z0, 0, DOOR_H, [-1, 0, 0], 0, 1);
      g.quad([[xc - hw, DOOR_H, z0], [xc + hw, DOOR_H, z0], [xc + hw, DOOR_H, z1], [xc - hw, DOOR_H, z1]], [0, -1, 0], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]]);
    } else {
      door.jambs = [{ x0, z0, x1, z1: zc - hw, tall: true }, { x0, z0: zc + hw, x1, z1, tall: true }];
      g.wall(x0, z1, x0, zc + hw, 0, H, [-1, 0, 0], 0, 0.2); g.wall(x0, zc - hw, x0, z0, 0, H, [-1, 0, 0], 0.8, 1);
      g.wall(x0, zc + hw, x0, zc - hw, DOOR_H, H, [-1, 0, 0], 0.2, 0.8);
      g = gb;
      g.wall(x1, z0, x1, zc - hw, 0, H, [1, 0, 0], 0, 0.2); g.wall(x1, zc + hw, x1, z1, 0, H, [1, 0, 0], 0.8, 1);
      g.wall(x1, zc - hw, x1, zc + hw, DOOR_H, H, [1, 0, 0], 0.2, 0.8);
      g.wall(x1, zc - hw, x0, zc - hw, 0, DOOR_H, [0, 0, 1], 0, 1);
      g.wall(x0, zc + hw, x1, zc + hw, 0, DOOR_H, [0, 0, -1], 0, 1);
      g.quad([[x0, DOOR_H, zc - hw], [x1, DOOR_H, zc - hw], [x1, DOOR_H, zc + hw], [x0, DOOR_H, zc + hw]], [0, -1, 0], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]]);
    }
    c.door = door;
    this.doors.push(door);
  }

  private edgeMat = new THREE.MeshLambertMaterial({ color: 0x3e443c });
  private steelMat = new THREE.MeshLambertMaterial({ color: 0xa9aaa3, emissive: 0x0c0c0a });
  private makePanel(d: Door, i: number) {
    const xc = d.cx * T + T / 2, zc = d.cz * T + T / 2, hw = DOOR_W / 2;
    const W = DOOR_W - 0.04, Hh = DOOR_H - 0.03, TK = 0.05;
    const geo = new THREE.BoxGeometry(W, Hh, TK);
    geo.translate(W / 2, Hh / 2, 0);
    // each face has its handle at the latch edge as seen from that side, and its own plate
    const pl = DOOR_PLATES[`${d.cx},${d.cz}`] ?? {};
    const tone: [number, number, number] = d.barred ? [112, 120, 104] : i % 2 ? [124, 138, 122] : [118, 132, 128];
    const front = new THREE.MeshLambertMaterial({ map: doorLeaf({ handle: 'right', seed: 70 + i * 3, plate: pl.front?.[0], sub: pl.front?.[1], tone }) });
    const back = new THREE.MeshLambertMaterial({ map: doorLeaf({ handle: 'left', seed: 71 + i * 3, plate: pl.back?.[0], sub: pl.back?.[1], tone }) });
    const e = this.edgeMat;
    const mesh = new THREE.Mesh(geo, [e, e, e, e, front, back]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    d.pivot.add(mesh);
    // lever handles on both faces, pointing back toward the hinges (one merged mesh per door)
    const parts: THREE.BufferGeometry[] = [];
    for (const s of [1, -1]) {
      parts.push(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 14).rotateX(Math.PI / 2).translate(W - 0.075, 1.0, s * (TK / 2 + 0.006)));
      parts.push(new THREE.BoxGeometry(0.13, 0.018, 0.02).translate(W - 0.075 - 0.055, 1.0, s * (TK / 2 + 0.045)));
      parts.push(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 6).rotateX(Math.PI / 2).translate(W - 0.075, 1.0, s * (TK / 2 + 0.025)));
    }
    const handles = new THREE.Mesh(mergeGeometries(parts.map(g => g.index ? g : g)), this.steelMat);
    handles.castShadow = true; d.pivot.add(handles);
    if (d.axis === 'x') { d.pivot.position.set(xc - hw + 0.02, 0, zc); d.pivot.rotation.y = 0; }
    else { d.pivot.position.set(xc, 0, zc + hw - 0.02); d.pivot.rotation.y = Math.PI / 2; }
    d.pivot.userData.base = d.pivot.rotation.y;
    if (d.barred) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.3, 0.12, 0.08), new THREE.MeshLambertMaterial({ color: 0x5a4632 }));
      bar.position.set(DOOR_W / 2, 1.1, d.unbarSide && (d.unbarSide.dx < 0 || d.unbarSide.dz < 0) ? -0.08 : 0.08);
      bar.name = 'bar';
      d.pivot.add(bar);
    }
    this.group.add(d.pivot);
    this.applyDoor(d);
  }

  // painted casings round every door opening, on both faces of the wall, merged into one mesh
  private casings() {
    const parts: THREE.BufferGeometry[] = [], hw = DOOR_W / 2, cw = 0.075, cd = 0.028;
    const add = (w: number, h: number, d: number, x: number, y: number, z: number) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(g); };
    for (const d of this.doors) {
      const x0 = d.cx * T, z0 = d.cz * T, xc = x0 + T / 2, zc = z0 + T / 2;
      for (const side of [-1, 1]) {
        if (d.axis === 'x') {
          const z = side < 0 ? z0 - cd / 2 : z0 + T + cd / 2;
          add(cw, DOOR_H + cw, cd, xc - hw - cw / 2, (DOOR_H + cw) / 2, z); add(cw, DOOR_H + cw, cd, xc + hw + cw / 2, (DOOR_H + cw) / 2, z);
          add(DOOR_W + cw * 2, cw, cd, xc, DOOR_H + cw / 2, z);
        } else {
          const x = side < 0 ? x0 - cd / 2 : x0 + T + cd / 2;
          add(cd, DOOR_H + cw, cw, x, (DOOR_H + cw) / 2, zc - hw - cw / 2); add(cd, DOOR_H + cw, cw, x, (DOOR_H + cw) / 2, zc + hw + cw / 2);
          add(cd, cw, DOOR_W + cw * 2, x, DOOR_H + cw / 2, zc);
        }
      }
    }
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ color: 0x4d5448 }));
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
  }

  applyDoor(d: Door) { d.pivot.rotation.y = d.pivot.userData.base + d.angle * d.swing; }
  // open a door so that it swings away from whoever pushes it
  openDoor(d: Door, from?: { x: number; z: number }) {
    if (d.open) return;
    if (from && d.angle < 0.05) {
      const c = this.center(d.cx, d.cz);
      d.swing = d.axis === 'x' ? (from.z > c.z ? 1 : -1) : (from.x > c.x ? 1 : -1);
    }
    d.open = true;
  }

  // Animate door swings; returns nothing.
  updateDoors(dt: number) {
    for (const d of this.doors) {
      const target = d.open ? 1.45 : 0;
      if (Math.abs(d.angle - target) > 0.001) {
        const sp = d.open ? 3.2 : 4.2;
        d.angle += Math.sign(target - d.angle) * Math.min(Math.abs(target - d.angle), sp * dt);
        this.applyDoor(d);
      }
    }
  }

  boxesAt(cx: number, cz: number): Box[] {
    const c = this.cell(cx, cz);
    if (!c) return [{ x0: cx * T, z0: cz * T, x1: (cx + 1) * T, z1: (cz + 1) * T, tall: true }];
    if (c.kind === 'door') {
      const d = c.door!;
      return d.angle < 1.0 ? [...d.jambs, d.panel] : d.jambs;
    }
    return c.boxes;
  }

  // Push a circle out of walls and furniture.
  collide(p: { x: number; z: number }, r: number) {
    for (let it = 0; it < 3; it++) {
      const cx0 = Math.floor((p.x - r) / T), cx1 = Math.floor((p.x + r) / T);
      const cz0 = Math.floor((p.z - r) / T), cz1 = Math.floor((p.z + r) / T);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        for (const b of this.boxesAt(cx, cz)) {
          const qx = Math.max(b.x0, Math.min(p.x, b.x1)), qz = Math.max(b.z0, Math.min(p.z, b.z1));
          let dx = p.x - qx, dz = p.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d);
          } else {
            const pen = [p.x - b.x0, b.x1 - p.x, p.z - b.z0, b.z1 - p.z];
            const m = Math.min(...pen);
            if (m === pen[0]) p.x = b.x0 - r; else if (m === pen[1]) p.x = b.x1 + r;
            else if (m === pen[2]) p.z = b.z0 - r; else p.z = b.z1 + r;
            dx = dz = 0;
          }
        }
      }
    }
  }

  // Cells crossed by a segment (Amanatides–Woo).
  private *walk(ax: number, az: number, bx: number, bz: number) {
    let cx = Math.floor(ax / T), cz = Math.floor(az / T);
    const ex = Math.floor(bx / T), ez = Math.floor(bz / T);
    const dx = bx - ax, dz = bz - az;
    const sx = Math.sign(dx), sz = Math.sign(dz);
    const tdx = sx !== 0 ? Math.abs(T / dx) : Infinity, tdz = sz !== 0 ? Math.abs(T / dz) : Infinity;
    let tmx = sx > 0 ? ((cx + 1) * T - ax) / dx : sx < 0 ? (cx * T - ax) / dx : Infinity;
    let tmz = sz > 0 ? ((cz + 1) * T - az) / dz : sz < 0 ? (cz * T - az) / dz : Infinity;
    for (let n = 0; n < 200; n++) {
      yield [cx, cz];
      if (cx === ex && cz === ez) return;
      if (tmx < tmz) { tmx += tdx; cx += sx; } else { tmz += tdz; cz += sz; }
    }
  }

  private segBox(ax: number, az: number, bx: number, bz: number, b: Box) {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    for (const [p, d, lo, hi] of [[ax, dx, b.x0, b.x1], [az, dz, b.z0, b.z1]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
      let ta = (lo - p) / d, tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  }

  // True if sight is blocked between two points (walls, shut doors, tall furniture and, unless told otherwise, curtains).
  blocked(ax: number, az: number, bx: number, bz: number, cloth = true) {
    for (const [cx, cz] of this.walk(ax, az, bx, bz)) {
      const c = this.cell(cx, cz);
      if (!c || c.kind === 'wall') return true;
      if (c.kind === 'door' || c.kind === 'furn') {
        for (const b of this.boxesAt(cx, cz)) if (b.tall && this.segBox(ax, az, bx, bz, b)) return true;
      }
    }
    if (cloth) for (const q of this.screens) if (cross(ax, az, bx, bz, q.ax, q.az, q.bx, q.bz)) return true;
    return false;
  }

  // Distance along a horizontal ray to the first wall, shut door or tall furniture (coarse march).
  rayDist(ax: number, az: number, dx: number, dz: number, maxD: number) {
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    for (let d = 0.15; d < maxD; d += 0.15) {
      const x = ax + dx * d, z = az + dz * d;
      const c = this.at(x, z);
      if (!c || c.kind === 'wall') return d;
      if (c.kind === 'door' || c.kind === 'furn') for (const b of this.boxesAt(c.cx, c.cz)) if (b.tall && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return d;
    }
    return maxD;
  }

  // How many walls / shut doors sound passes through.
  occlusion(ax: number, az: number, bx: number, bz: number) {
    let o = 0;
    for (const [cx, cz] of this.walk(ax, az, bx, bz)) {
      const c = this.cell(cx, cz);
      if (!c || c.kind === 'wall') o += 0.8;
      else if (c.kind === 'door' && c.door!.angle < 1.0) o += 0.7;
    }
    return Math.min(o, 4);
  }

  // A* over the tile grid (8-way, no corner cutting).
  path(sx: number, sz: number, tx: number, tz: number): { x: number; z: number }[] | null {
    const s = [Math.floor(sx / T), Math.floor(sz / T)], t = [Math.floor(tx / T), Math.floor(tz / T)];
    if (!this.walkable(t[0], t[1])) {
      // target sits in a furniture cell (a locker front, a desk): aim for the closest open neighbour
      let best: number[] | null = null, bd = Infinity;
      for (let r = 1; r <= 2 && !best; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const nx = t[0] + dx, nz = t[1] + dz;
        if (!this.walkable(nx, nz) || this.cell(nx, nz)!.kind === 'door') continue;
        const c = this.center(nx, nz), d = Math.hypot(c.x - tx, c.z - tz);
        if (d < bd) { bd = d; best = [nx, nz]; }
      }
      if (!best) return null;
      t[0] = best[0]; t[1] = best[1];
    }
    const W = this.w, N = W * this.h;
    const g = new Float32Array(N).fill(Infinity), f = new Float32Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const si = s[1] * W + s[0], ti = t[1] * W + t[0];
    const h = (i: number) => { const x = i % W, z = (i / W) | 0, dx = Math.abs(x - t[0]), dz = Math.abs(z - t[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    g[si] = 0; f[si] = h(si);
    const open = [si];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi]; open.splice(bi, 1);
      if (cur === ti) break;
      closed[cur] = 1;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!this.walkable(nx, nz)) continue;
        if (dx && dz) {
          if (!this.walkable(cx + dx, cz) || !this.walkable(cx, cz + dz)) continue;
          const a = this.cell(cx + dx, cz)!, b = this.cell(cx, cz + dz)!;
          if (a.kind === 'door' || b.kind === 'door' || this.cell(nx, nz)!.kind === 'door' || this.cell(cx, cz)!.kind === 'door') continue;
        }
        const ni = nz * W + nx;
        if (closed[ni]) continue;
        const ng = g[cur] + (dx && dz ? 1.414 : 1);
        if (ng < g[ni]) { g[ni] = ng; f[ni] = ng + h(ni); from[ni] = cur; if (!open.includes(ni)) open.push(ni); }
      }
    }
    if (from[ti] < 0 && si !== ti) return null;
    const cells: number[] = [];
    for (let i = ti; i !== -1 && i !== si; i = from[i]) cells.push(i);
    cells.reverse();
    return this.smooth(sx, sz, cells.map(i => ({ cx: i % W, cz: (i / W) | 0 })), tx, tz);
  }

  // Straighten a cell path, keeping door cells (and the cells either side) as anchors.
  private smooth(sx: number, sz: number, cells: { cx: number; cz: number }[], tx: number, tz: number) {
    const pts = cells.map(c => ({ ...this.center(c.cx, c.cz), door: this.cell(c.cx, c.cz)!.kind === 'door' }));
    if (pts.length) { pts[pts.length - 1].x = tx; pts[pts.length - 1].z = tz; }
    const anchor = (i: number) => pts[i].door || (pts[i + 1] && pts[i + 1].door) || (pts[i - 1] && pts[i - 1].door);
    const out: { x: number; z: number }[] = [];
    let cur = { x: sx, z: sz };
    let i = 0;
    while (i < pts.length) {
      let j = i;
      if (!anchor(i)) {
        for (let k = pts.length - 1; k > i; k--) {
          let ok = true;
          for (let m = i; m <= k; m++) if (anchor(m)) { ok = false; break; }
          if (ok && this.clear(cur.x, cur.z, pts[k].x, pts[k].z, 0.4)) { j = k; break; }
        }
      }
      out.push({ x: pts[j].x, z: pts[j].z });
      cur = pts[j];
      i = j + 1;
    }
    return out;
  }

  // Is a straight walk between two points free of non-walkable cells?
  clear(ax: number, az: number, bx: number, bz: number, r: number) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const nx = -dz / len, nz = dx / len;
    for (let s = 0; s <= len; s += 0.25) {
      const px = ax + (dx * s) / len, pz = az + (dz * s) / len;
      for (const o of [-r, 0, r]) {
        const qx = px + nx * o, qz = pz + nz * o;
        const c = this.at(qx, qz);
        if (!c || !(c.kind === 'floor')) return false;
      }
    }
    return true;
  }

  // Random walkable floor point at a distance band from (x,z).
  randomNear(x: number, z: number, minD: number, maxD: number, R: () => number = Math.random) {
    const cand: { x: number; z: number }[] = [];
    for (const c of this.cells) {
      if (c.kind !== 'floor') continue;
      const p = this.center(c.cx, c.cz);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d >= minD && d <= maxD) cand.push(p);
    }
    return cand.length ? cand[Math.floor(R() * cand.length)] : null;
  }
}

// ---- surface wear, in world space ---------------------------------------------------------------------
// kind 0 walls, 1 floors, 2 ceiling. Macro blotchiness so no two metres match; soot under the ceiling and the
// mop line at the skirting; dirt and mould where walls meet; sparse leak streaks; and the leaks: a stained
// ring on the ceiling, the wall beside it wet, a damp halo round the puddle on the floor.
const GRIME_HEAD = (n: number) => `
uniform sampler2D uField; uniform vec2 uFieldSize; uniform vec4 uLeaks[${n}];
varying vec3 vGW; varying vec3 vGN;
float gh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), f.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), f.x), f.y); }
float gf(vec2 p) { return gn(p) * 0.55 + gn(p * 2.03 + 7.1) * 0.3 + gn(p * 4.07 + 3.3) * 0.15; }
float gField(vec2 xz) { return texture2D(uField, xz / uFieldSize).r; }
float gLeak(vec2 xz, out float rim) {
  float k = 0.0; rim = 0.0;
  for (int i = 0; i < ${n}; i++) {
    vec4 L = uLeaks[i];
    float d = length(xz - L.xy) / L.z + (gn(xz * 2.6 + float(i) * 7.0) - 0.5) * 0.28;
    k = max(k, 1.0 - smoothstep(0.5, 1.0, d));
    rim = max(rim, smoothstep(0.8, 0.94, d) * (1.0 - smoothstep(0.94, 1.06, d)));
  }
  return k;
}
`;
const GRIME_BODY = [
  // walls
  `{
    vec3 n = normalize(vGN);
    bool xw = abs(n.x) > 0.5;
    float along = xw ? vGW.z : vGW.x, plane = xw ? vGW.x : vGW.z, y = vGW.y;
    float g = 0.84 + 0.3 * gf(vec2(along * 0.6, y * 0.6) + plane * 1.37);
    g *= 1.0 - 0.34 * smoothstep(2.2, 3.0, y) * (0.45 + gf(vec2(along * 1.5, plane + y)));
    g *= 1.0 - 0.42 * (1.0 - smoothstep(0.03, 0.36, y)) * (0.6 + 0.6 * gn(vec2(along * 4.0, plane)));
    float f = gField(vGW.xz + n.xz * 0.3);
    float corner = smoothstep(0.42, 0.72, f);
    float mould = corner * smoothstep(0.38, 0.72, gf(vec2(along, y) * 2.2 + plane)) * clamp(smoothstep(1.7, 3.0, y) + 1.0 - smoothstep(0.0, 0.8, y), 0.0, 1.0);
    g *= 1.0 - 0.38 * corner;
    float cell = floor(along / 0.7), r = gh(vec2(cell, floor(plane * 2.0 + 0.5)));
    float streak = 0.0, tide = 0.0;
    if (r > 0.8) {
      float cx = (cell + 0.25 + 0.5 * gh(vec2(r * 91.0, cell))) * 0.7;
      float wd = 0.03 + 0.12 * gh(vec2(cell, r * 37.0)), ln = 0.4 + 1.8 * gh(vec2(cell * 1.7, r * 13.0));
      float dx = abs(along - cx - (gn(vec2(y * 2.5, cell)) - 0.5) * wd * 1.4) / wd;
      float top = smoothstep(3.0 - ln, 3.0 - ln * 0.45, y);
      streak = (1.0 - smoothstep(0.5, 1.0, dx)) * top;
      tide = smoothstep(0.62, 0.86, dx) * (1.0 - smoothstep(0.86, 1.0, dx)) * top;
    }
    float rim; float wet = gLeak(vGW.xz + n.xz * 0.15, rim);
    wet *= smoothstep(0.4, 2.9, y) * (0.75 + 0.5 * gn(vec2(along * 3.0, y * 1.5)));
    streak = max(streak, wet);
    vec3 col = diffuseColor.rgb * g;
    col = mix(col, col * vec3(0.58, 0.48, 0.32), clamp(streak * 0.7 + tide * 0.6, 0.0, 1.0));
    col = mix(col, col * vec3(0.34, 0.4, 0.28), mould * 0.75);
    diffuseColor.rgb = col;
  }`,
  // floors
  `{
    float g = 0.84 + 0.26 * gf(vGW.xz * 0.5);
    g *= 1.0 - 0.4 * smoothstep(0.55, 0.82, gf(vGW.xz * 0.23 + 11.0));
    float f = gField(vGW.xz);
    g *= 1.0 - 0.6 * smoothstep(0.18, 0.56, f) * (0.7 + 0.3 * gn(vGW.xz * 3.0));
    float rim; float wet = gLeak(vGW.xz, rim);
    g *= 1.0 - 0.3 * wet - 0.3 * rim;
    diffuseColor.rgb *= g;
  }`,
  // ceiling
  `{
    float g = 0.9 + 0.2 * gf(vGW.xz * 0.4);
    vec2 tc = floor(vGW.xz / (2.0 / 3.0));
    float hole = step(0.975, gh(tc + 17.0));
    float rim; float wet = gLeak(vGW.xz, rim);
    vec2 c2 = floor(vGW.xz / 2.0); float st = 0.0, sr = 0.0;
    if (gh(c2 + 3.0) > 0.88) {
      vec2 cc = (c2 + 0.3 + 0.4 * vec2(gh(c2 + 9.0), gh(c2 + 13.0))) * 2.0; float rad = 0.28 + 0.2 * gh(c2 + 21.0);
      float d = length(vGW.xz - cc) / rad + (gn(vGW.xz * 4.0) - 0.5) * 0.3;
      st = 1.0 - smoothstep(0.6, 1.0, d); sr = smoothstep(0.8, 0.95, d) * (1.0 - smoothstep(0.95, 1.08, d));
    }
    vec3 col = diffuseColor.rgb * g;
    col = mix(col, col * vec3(0.72, 0.6, 0.42), max(wet, st * 0.7) * 0.65);
    col = mix(col, col * vec3(0.42, 0.34, 0.22), max(rim, sr) * 0.75);
    col *= 1.0 - hole * 0.88;
    diffuseColor.rgb = col;
  }`,
];
function grime<M extends THREE.Material>(m: M, kind: number, u: Record<string, { value: unknown }>): M {
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vGW; varying vec3 vGN;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vGW = (modelMatrix * vec4(transformed, 1.0)).xyz; vGN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = GRIME_HEAD((u.uLeaks.value as unknown[]).length) + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + GRIME_BODY[kind]);
  };
  m.customProgramCacheKey = () => `grime${kind}`;
  return m;
}
