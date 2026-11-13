// Bake static set dressing into a few big meshes: one per material, shadow flags and 12 m chunk of
// floor, so a room costs a handful of draw calls instead of hundreds. Anything flagged
// userData.dynamic (and everything under it) keeps its own mesh. Materials are shared, so
// material-level animation (emissive flicker, texture swaps) still works after merging.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = ['position', 'normal', 'uv'];

export function mergeStatic(root: THREE.Object3D, chunk = 12) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const bins = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; order: number; geos: THREE.BufferGeometry[]; src: THREE.Mesh[] }>();
  const m4 = new THREE.Matrix4(), c = new THREE.Vector3();
  const walk = (o: THREE.Object3D) => {
    if (o.userData.dynamic || !o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as any).isInstancedMesh && !(m as any).isSkinnedMesh && !Array.isArray(m.material) && m.geometry.index && !m.geometry.morphAttributes.position) {
      const g = m.geometry;
      if (KEEP.every(k => g.attributes[k])) {
        m.getWorldPosition(c);
        const key = `${m.material.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}|${Math.floor(c.x / chunk)},${Math.floor(c.z / chunk)}`;
        let b = bins.get(key);
        if (!b) bins.set(key, (b = { mat: m.material, cast: m.castShadow, recv: m.receiveShadow, order: m.renderOrder, geos: [], src: [] }));
        const geo = new THREE.BufferGeometry();
        for (const k of KEEP) geo.setAttribute(k, g.attributes[k].clone());
        geo.setIndex(g.index!.clone());
        geo.applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld));
        b.geos.push(geo); b.src.push(m);
      }
    }
    for (const ch of [...o.children]) walk(ch);
  };
  walk(root);
  let before = 0, after = 0;
  for (const b of bins.values()) {
    before += b.src.length;
    if (b.src.length < 2) continue; // nothing to gain
    const geo = mergeGeometries(b.geos, false);
    if (!geo) continue;
    for (const s of b.src) s.parent?.remove(s);
    const mesh = new THREE.Mesh(geo, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.renderOrder = b.order;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh);
    after++;
  }
  for (const b of bins.values()) if (b.src.length < 2) after++;
  return { before, after };
}
