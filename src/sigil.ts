// The PuntoNeutro sigil, embroidered on la Jefa: on the front of her cap, where the red cross used to be, and
// on her left breast. Each is a decal cut from the garment's own triangles (same skin weights, a hair in front
// of the cloth), so it bends with her exactly, drawn crisp on its own canvas instead of baked into the
// low-resolution uniform texture.
import * as THREE from 'three';

// one stroke, measured from the logo (a 282 x 512 box, y down)
const V: [number, number][] = [[67, 444], [120, 28], [226, 445], [260, 170], [23, 235], [222, 77]];

type RGB = [number, number, number];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** satin-stitched thread on a transparent canvas, plus a height map for the raised thread */
function embroidery(size: number, thread: RGB, width: number) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return [c, c.getContext('2d')!] as const; };
  const [col, g] = mk(), [bump, b] = mk();
  const hgt = size * 0.86, sc = hgt / 512, ox = (size - 282 * sc) / 2, oy = (size - hgt) / 2;
  const P = V.map(([x, y]) => [ox + x * sc, oy + y * sc] as const);
  const w = width * size;
  const path = (c: CanvasRenderingContext2D) => { c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (const p of P.slice(1)) c.lineTo(p[0], p[1]); };
  const stroke = (c: CanvasRenderingContext2D, style: string, lw: number) => { c.strokeStyle = style; c.lineWidth = lw; c.lineJoin = 'round'; c.lineCap = 'round'; path(c); c.stroke(); };
  const dark: RGB = [thread[0] * 0.32, thread[1] * 0.25, thread[2] * 0.28];
  const lite: RGB = [Math.min(255, thread[0] * 1.32 + 20), Math.min(255, thread[1] * 1.5 + 18), Math.min(255, thread[2] * 1.45 + 18)];
  // the edge where the thread sinks into the cloth, then the thread itself
  stroke(g, css(dark, 0.95), w * 1.32);
  stroke(g, css(thread), w);
  b.fillStyle = '#000'; b.fillRect(0, 0, size, size);
  b.filter = `blur(${Math.max(1, size / 256)}px)`; stroke(b, '#5a5a5a', w * 1.25); stroke(b, '#c8c8c8', w * 0.92); b.filter = 'none';
  // satin stitches across each leg of the stroke, slightly slanted, alternating light and shade
  for (let i = 0; i < P.length - 1; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1], len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0);
    for (const [c, light, shade] of [[g, css(lite, 0.55), css(dark, 0.35)], [b, '#ffffff', '#6e6e6e']] as const) {
      c.save(); c.translate(x0, y0); c.rotate(ang);
      c.beginPath(); c.rect(0, -w / 2, len, w); c.clip();
      const step = Math.max(1.2, size / 300);
      for (let x = -w; x < len + w; x += step) {
        c.strokeStyle = (Math.round(x / step) & 1) ? light : shade; c.lineWidth = step * 0.55;
        c.beginPath(); c.moveTo(x, -w / 2); c.lineTo(x + w * 0.42, w / 2); c.stroke();
      }
      c.restore();
    }
  }
  // the sheen running down the thread
  g.save(); g.translate(-w * 0.12, -w * 0.12); stroke(g, css(lite, 0.28), w * 0.26); g.restore();
  const tex = (c: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return { map: tex(col, true), bump: tex(bump, false) };
}

/** cut a decal out of a skinned garment: its triangles in front of `center` within w x h, re-skinned the same */
function decal(src: THREE.SkinnedMesh, center: THREE.Vector3, normal: THREE.Vector3, w: number, h: number, mat: THREE.Material, lift: number, depth: number) {
  const g = src.geometry, pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  if (!pos || !nor || !si || !sw) return null;
  const N = normal.clone().normalize(), U = new THREE.Vector3(0, 1, 0).addScaledVector(N, -N.y).normalize(), R = new THREE.Vector3().crossVectors(U, N);
  const idx = g.index ? Array.from(g.index.array as ArrayLike<number>) : [...Array(pos.count).keys()];
  const map = new Map<number, number>(), out: number[] = [];
  const P = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), tn = new THREE.Vector3(), q = new THREE.Vector3();
  const uvOf = (p: THREE.Vector3) => { P.copy(p).sub(center); return [P.dot(R) / w + 0.5, P.dot(U) / h + 0.5, P.dot(N)] as const; };
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
    A.fromBufferAttribute(pos, ia); B.fromBufferAttribute(pos, ib); C.fromBufferAttribute(pos, ic);
    tn.fromBufferAttribute(nor, ia).add(q.fromBufferAttribute(nor, ib)).add(q.fromBufferAttribute(nor, ic)).normalize();
    if (tn.dot(N) < 0.25) continue; // facing away, or edge-on
    const ua = uvOf(A), ub = uvOf(B), uc = uvOf(C);
    if (Math.max(ua[0], ub[0], uc[0]) < -0.05 || Math.min(ua[0], ub[0], uc[0]) > 1.05) continue;
    if (Math.max(ua[1], ub[1], uc[1]) < -0.05 || Math.min(ua[1], ub[1], uc[1]) > 1.05) continue;
    if (Math.min(Math.abs(ua[2]), Math.abs(ub[2]), Math.abs(uc[2])) > depth) continue; // only the outer layer, not the far side
    for (const i of [ia, ib, ic]) { if (!map.has(i)) map.set(i, map.size); out.push(map.get(i)!); }
  }
  if (!out.length) return null;
  const n = map.size, fp = new Float32Array(n * 3), fn = new Float32Array(n * 3), fu = new Float32Array(n * 2);
  const fi = new (si.array.constructor as any)(n * 4), fw = new Float32Array(n * 4), V3 = new THREE.Vector3(), N3 = new THREE.Vector3();
  for (const [i, k] of map) {
    V3.fromBufferAttribute(pos, i); N3.fromBufferAttribute(nor, i);
    const uv = uvOf(V3);
    V3.addScaledVector(N3, lift);
    fp.set([V3.x, V3.y, V3.z], k * 3); fn.set([N3.x, N3.y, N3.z], k * 3); fu.set([uv[0], uv[1]], k * 2);
    fi.set([si.getX(i), si.getY(i), si.getZ(i), si.getW(i)], k * 4); fw.set([sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)], k * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(fp, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(fn, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(fu, 2));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(fi, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(fw, 4));
  geo.setIndex(out);
  const m = new THREE.SkinnedMesh(geo, mat);
  m.name = `${src.name}_sigil`; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
  m.position.copy(src.position); m.quaternion.copy(src.quaternion); m.scale.copy(src.scale);
  m.bindMode = src.bindMode;
  src.parent!.add(m);
  m.bind(src.skeleton, src.bindMatrix);
  return m;
}

function material(size: number, thread: RGB, width: number) {
  const e = embroidery(size, thread, width);
  return new THREE.MeshStandardMaterial({ map: e.map, bumpMap: e.bump, bumpScale: 0.9, roughness: 0.78, metalness: 0, alphaTest: 0.42, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
}

/** put the sigil on her; returns how many decals went on (0 if the model isn't the one it expects) */
export function applySigil(model: THREE.Object3D) {
  let suit: THREE.SkinnedMesh | null = null, cap: THREE.SkinnedMesh | null = null, cross: THREE.SkinnedMesh | null = null;
  model.traverse((o: any) => {
    if (!o.isSkinnedMesh) return;
    const mn = (o.material as THREE.Material)?.name ?? '';
    if (/elegantsuit/i.test(o.name) || mn === 'Jefa_uniforme') suit = suit ?? o;
    if (mn === 'Jefa_cofia') cap = o;
    if (mn === 'Jefa_cruz') cross = o;
  });
  let n = 0;
  // the cap: the sigil takes the cross's place, a little bigger, the cross goes
  const cr = cross as THREE.SkinnedMesh | null, cp = cap as THREE.SkinnedMesh | null;
  if (cr && cp) {
    const g = cr.geometry; g.computeBoundingBox();
    const bb = g.boundingBox!, c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    // the cap's own surface normal around the cross (the cross is a thin solid: its normals cancel out)
    const nrm = new THREE.Vector3(), v = new THREE.Vector3(), vn = new THREE.Vector3(), cpos = cp.geometry.attributes.position, cnor = cp.geometry.attributes.normal;
    const r = Math.max(sz.x, sz.y) * 0.9;
    for (let i = 0; i < cpos.count; i++) { v.fromBufferAttribute(cpos, i); if (v.distanceTo(c) < r) { vn.fromBufferAttribute(cnor, i); if (vn.z > 0.2) nrm.add(vn); } }
    if (nrm.lengthSq() < 1e-6) nrm.set(0, 0, 1);
    nrm.normalize();
    const hgt = Math.max(sz.x, sz.y) * 2.5;
    if (decal(cp, c, nrm, hgt, hgt, material(256, [168, 26, 30], 0.085), 0.0016, 0.05)) { cr.visible = false; n++; } // square canvas, square patch
  }
  // the left breast, stitched bigger than before so it reads from across a room
  const st = suit as THREE.SkinnedMesh | null;
  if (st) {
    const pos = st.geometry.attributes.position, v = new THREE.Vector3();
    const CX = 0.098, CY = 1.405; let zf = -1;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); if (Math.abs(v.x - CX) < 0.03 && Math.abs(v.y - CY) < 0.03) zf = Math.max(zf, v.z); }
    if (zf > -1 && decal(st, new THREE.Vector3(CX, CY, zf), new THREE.Vector3(0, 0.12, 1), 0.14, 0.14, material(512, [150, 22, 28], 0.064), 0.0022, 0.08)) n++;
  }
  return n;
}
