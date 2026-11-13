// Set dressing with a story: decals with intent, pictures that change while you look away, small
// props that do things when you touch them. Everything here is examinable through ./examine.
import * as THREE from 'three';
import type { Game } from './game';
import { T } from './level';
import { makeDecalAtlas, DECAL_SIZE, type DecalKind, type Atlas, nursesPhoto, founder, landscape, bodegon, nursePortrait, frameBack, clockFace, doorLeaf, silhouette, tapedSaint } from './decor';
import { Examine, type ExamDef } from './examine';
import { mergeStatic } from './merge';

type Face = 'N' | 'S' | 'E' | 'W';
const NRM: Record<Face, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lam = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);

// The tune she hums, transcribed from her recording (MIDI, beats) and lifted two octaves for the comb.
export const HER_SONG: [number, number][] = [
  [79, 0.5], [81, 0.5], [79, 2], [0, 0.5],
  [79, 1], [81, 0.5], [74, 0.25], [74, 0.5], [72, 2.5], [0, 0.5],
  [76, 0.5], [76, 0.75], [76, 0.75], [0, 1], [74, 1.5], [0, 1],
  [79, 0.5], [81, 0.5], [79, 3], [0, 0.5],
  [72, 0.5], [74, 0.5], [76, 1.25], [76, 0.5], [76, 0.5], [72, 2.5],
];

interface Pose { p: THREE.Vector3; n: THREE.Vector3; r: THREE.Vector3 }

export class Dressing {
  atlas: Atlas;
  ex: Examine;
  group = new THREE.Group();
  private G: Game;
  private dq = { pos: [] as number[], nor: [] as number[], uv: [] as number[], idx: [] as number[] };
  private anim: ((dt: number, t: number) => void)[] = [];
  private R = Math.random;

  constructor(game: Game) {
    this.G = game;
    this.atlas = makeDecalAtlas();
    this.ex = new Examine(game);
    this.build();
    game.scene.add(this.group);
    // the handwriting was drawn with fallback fonts if the web fonts were late; redraw when they land
    (document as any).fonts?.ready?.then(() => { if ((document as any).fonts.check?.("20px 'Reenie Beanie'")) this.atlas.redraw(); });
  }

  update(dt: number, t: number) { if (this.G.mode === 'play') this.ex.update(dt); for (const f of this.anim) f(dt, t); }

  // ---- placement helpers --------------------------------------------------------------
  // a point on the face of wall cell (cx, cz) looking into the room; `along` runs to the viewer's right
  private wall(cx: number, cz: number, face: Face, along = 0, y = 1.5): Pose {
    const [nx, nz] = NRM[face];
    const p = V((cx + 0.5) * T + nx * T / 2, y, (cz + 0.5) * T + nz * T / 2);
    const n = V(nx, 0, nz), r = V(nz, 0, -nx);
    p.addScaledVector(r, along);
    return { p, n, r };
  }
  private decal(kind: DecalKind, at: Pose, o: { s?: number; rot?: number; flip?: boolean; lift?: number } = {}) {
    const [w0, h0] = DECAL_SIZE[kind], s = o.s ?? 1, w = w0 * s, h = h0 * s;
    const n = at.n, up0 = new THREE.Vector3().crossVectors(n, at.r);
    const a = o.rot ?? 0, r = at.r.clone().multiplyScalar(Math.cos(a)).addScaledVector(up0, Math.sin(a));
    const up = up0.clone().multiplyScalar(Math.cos(a)).addScaledVector(at.r, -Math.sin(a));
    const c = at.p.clone().addScaledVector(n, 0.005 + (o.lift ?? 0));
    let [u0, v0, u1, v1] = this.atlas.uv[kind];
    if (o.flip) [u0, u1] = [u1, u0];
    const q = this.dq, b = q.pos.length / 3;
    const corners: [number, number, number, number][] = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
    for (const [sx, sy, u, v] of corners) {
      const pt = c.clone().addScaledVector(r, sx * w / 2).addScaledVector(up, sy * h / 2);
      q.pos.push(pt.x, pt.y, pt.z); q.nor.push(n.x, n.y, n.z); q.uv.push(u, v);
    }
    q.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    return c;
  }
  private floorDecal(kind: DecalKind, x: number, z: number, heading: number, o: { s?: number; flip?: boolean } = {}) {
    // heading: the direction the top of the decal points, as an angle in the floor plane
    const up = V(Math.sin(heading), 0, Math.cos(heading)), n = V(0, 1, 0);
    const r = new THREE.Vector3().crossVectors(up, n); // so that n x r = up
    return this.decal(kind, { p: V(x, 0.008, z), n, r }, { s: o.s, flip: o.flip });
  }
  private framed(tex: THREE.Texture, w: number, h: number, at: Pose, depth = 0.03) {
    const back = lam({ color: 0x2a221a });
    const front = lam({ map: tex, color: 0xb8b8b8 }); // pictures sit a little under the torch's glare
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), [back, back, back, back, front, back]);
    m.position.copy(at.p).addScaledVector(at.n, depth / 2 + 0.002);
    m.rotation.y = Math.atan2(at.n.x, at.n.z);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    return { mesh: m, mat: front };
  }
  private box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; parent.add(b); return b;
  }
  private cyl(r0: number, r1: number, h: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group, seg = 10) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m); c.position.set(x, y, z); c.castShadow = true; c.receiveShadow = true; parent.add(c); return c;
  }
  // furniture-local -> world, matching Props' rotation convention
  private local(cx: number, cz: number, rot: number, lx: number, lz: number) {
    const c = this.G.level.center(cx, cz);
    return { x: c.x + lx * Math.cos(rot) + lz * Math.sin(rot), z: c.z - lx * Math.sin(rot) + lz * Math.cos(rot) };
  }
  private noise(x: number, z: number, r: number, loud: number, kind: string) { this.G.noises.push({ x, z, r, loud, kind }); }
  private occ(x: number, z: number) { const P = this.G.player; return this.G.level.occlusion(x, z, P.pos.x, P.pos.z); }
  private later(t: number, fn: () => void) { this.G.story.after(t, fn); }
  private add(d: ExamDef) { return this.ex.add(d); }

  // ---- the whole dressing pass ---------------------------------------------------------------
  private build() {
    this.marks();
    this.pictures();
    this.wardProps();
    this.receptionProps();
    this.dayroomProps();
    this.corridorProps();
    this.specialDoors();
    this.fixtures();
    this.existing();
    // all decals in one mesh
    const q = this.dq, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(q.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(q.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(q.uv, 2));
    g.setIndex(q.idx); g.computeBoundingSphere();
    const m = new THREE.MeshLambertMaterial({ map: this.atlas.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.renderOrder = 1;
    this.group.add(mesh);
    mergeStatic(this.group);
  }

  // ---- marks on the walls and floor ------------------------------------------------------------
  private marks() {
    const d = (kind: DecalKind, at: Pose, o?: { s?: number; rot?: number; flip?: boolean; lift?: number }) => this.decal(kind, at, o);
    // WARD B
    const drag = d('handDrag', this.wall(1, 11, 'E', 0.3, 1.27), { s: 0.75 });
    this.add({ id: 'drag', pos: drag, lines: ['Una mano que resbaló hasta el piso. Alguien se agarró de la pared mientras lo devolvían a la cama.', 'Esa mano dice «no quiero volver a la cama». Yo tampoco, hermano.'], aim: 0.93 });
    d('handL', this.wall(1, 11, 'E', -0.34, 1.32), { rot: 0.35, s: 0.95 });
    const ojos = d('g_ojos', this.wall(14, 8, 'W', 0, 1.72));
    this.add({ id: 'ojos', pos: ojos, range: 3.2, aim: 0.9, lines: ['Con carbón, por dentro del pabellón: SI CANTA, CIERRE LOS OJOS.', 'Ojalá no cante como mi tía en las novenas. Eso sí da miedo.'] });
    d('water', this.wall(3, 5, 'S', 0.2, 2.0)); d('mould', this.wall(3, 5, 'S', -0.4, 2.6), { s: 0.8 });
    d('mould', this.wall(12, 15, 'N', 0, 2.55), { s: 0.9, flip: true });
    d('handTips', this.wall(14, 12, 'W', 0.3, 1.45), { rot: -0.4 });
    const full = d('handR', this.wall(7, 15, 'N', 0.35, 1.38), { rot: 0.12 });
    this.add({ id: 'fullhand', pos: full, lines: ['Una mano entera, abierta, a la altura de la cara. Como si alguien hubiera esperado aquí, con la frente contra la pared.', 'Como castigado en el colegio, mirando la pared hasta que se olvidaron de él.'] });
    for (const [n, cx, cz, f] of [[1, 1, 7, 'E'], [2, 1, 9, 'E'], [3, 1, 11, 'E'], [4, 1, 13, 'E'], [5, 14, 7, 'W'], [6, 14, 13, 'W']] as [number, number, number, Face][]) d(('bed' + n) as DecalKind, this.wall(cx, cz, f, 0, 1.36));
    d('estampa0', this.wall(1, 9, 'E', -0.16, 1.18), { rot: 0.08 }); d('estampa1', this.wall(1, 9, 'E', 0.02, 1.2), { rot: -0.1 }); d('estampa0', this.wall(1, 9, 'E', 0.18, 1.16), { rot: 0.15, s: 0.9 });
    // child handprints on the outside of the ward's middle window
    const kid = d('handChild', { p: V(4.012, 1.5, 21.18), n: V(1, 0, 0), r: V(0, 0, -1) }, { rot: 0.15, lift: 0.003 });
    d('handChildL', { p: V(4.012, 1.36, 20.84), n: V(1, 0, 0), r: V(0, 0, -1) }, { rot: -0.2, lift: 0.003 });
    this.add({ id: 'kidhands', pos: kid, aim: 0.9, lines: ['Manitos en el vidrio. Están por fuera.', 'Siguen ahí. Del lado de afuera. ¿Qué niño anda afuera con este aguacero, a esta hora? Ninguno, ¿cierto?'] });
    // LINEN
    const soot = d('handSoot', this.wall(6, 15, 'S', 0.62, 1.3), { rot: -0.2 });
    d('handSoot', this.wall(8, 15, 'S', -0.55, 1.02), { rot: 0.5, s: 0.95, flip: true });
    this.add({ id: 'soot', pos: soot, lines: ['Huellas negras de grasa. Los camilleros escondieron aquí los fusibles.', 'Ni se lavaron las manos. Y eso que hay afiche.'] });
    const tal = d('tally', this.wall(9, 18, 'W', 0.1, 0.95));
    this.add({ id: 'tally', pos: tal, lines: ['Rayitas de cinco en cinco. Cuarenta y tres. Alguien llevaba la cuenta de algo.', 'Cuarenta y tres. Las conté otra vez. Ojalá sean días y no personas.'] });
    // RECEPTION
    const claws = d('claws', this.wall(9, 18, 'E', -0.52, 0.78));
    this.add({ id: 'claws', pos: claws, lines: ['Rasguños hondos en la pintura, a la altura de un niño. Alguien quería entrar a la lencería.', 'O salir. Ay, no. ¿Pa\' qué pensé eso?'] });
    const ext = d('extensions', this.wall(9, 20, 'E', 0.32, 1.5), { rot: -0.03 });
    d('g_conteste', this.wall(9, 20, 'E', 0.33, 1.24));
    this.add({ id: 'ext', pos: ext, lines: ['Extensiones. La del anfiteatro, la 300, tiene un círculo y dice «no contestar». Debajo, en la pared: NO CONTESTE.', 'Tranquilos, que no hay línea. Aquí lo único que funciona es el susto.'], sound: 'paper' });
    const rat = d('rationing', this.wall(13, 17, 'S', 0.25, 1.5), { rot: 0.02 });
    this.add({ id: 'rationing', pos: rat, lines: ['Horario de racionamiento, marzo de 1992. Sector 4: sin luz de 8 p. m. a 4 a. m. Abajo, a lápiz: «ella llega con el apagón».', 'Con la hora Gaviria uno ya ni sabe qué hora es. Igual ella llega con el apagón.'], sound: 'paper' });
    const vac = d('vaccination', this.wall(13, 24, 'N', 0, 1.48), { rot: -0.02 });
    this.add({ id: 'vacc', pos: vac, lines: ['Jornada de vacunación, 1991. A los niños del afiche les rayaron los ojos con lapicero.', 'Yo de niño lloraba con la vacuna. Esto es peor.'], sound: 'paper' });
    const wash = d('handwash', this.wall(22, 19, 'W', 0, 1.46));
    this.add({ id: 'wash', pos: wash, lines: ['LÁVESE LAS MANOS. Debajo, a lápiz rojo: «no sale».', 'Ni con jabón Rey, parece.'], sound: 'paper' });
    const ghost = d('ghost', this.wall(22, 22, 'W', 0, 1.78));
    this.add({ id: 'ghost', pos: ghost, lines: ['Aquí colgó un cuadro durante años. Lo descolgaron hace poco: el clavo todavía brilla.', 'Uno menos que me mire. Chévere.'] });
    d('handSmearR', this.wall(22, 21, 'W', -0.5, 1.15), { rot: 0.6 });
    d('mould', this.wall(21, 24, 'N', 0.3, 2.6), { s: 0.8 });
    // MAIN CORRIDOR
    const trail = d('fingerTrail', this.wall(17, 14, 'W', 0, 1.2), { flip: true });
    this.add({ id: 'trail', pos: trail, range: 2.2, aim: 0.9, lines: ['Rayas de dedos a la altura de la cadera, a lo largo de la pared. Alguien caminó a tientas hacia el pabellón.', 'A tientas, como yo buscando las velas cada vez que se va la luz.'] });
    const nod = d('g_noduerme', this.wall(17, 8, 'W', 0, 1.62));
    this.add({ id: 'noduerme', pos: nod, range: 3.2, aim: 0.9, lines: ['Escrito con carbón: ELLA NO DUERME.', 'Alguien apretó tanto el carbón que se partió en la última letra.', 'Ella no duerme. Yo, después de esta noche, tampoco.'] });
    const c3 = d('g_cama3', this.wall(14, 11, 'E', 0, 1.56));
    this.add({ id: 'cama3', pos: c3, range: 2.6, aim: 0.9, lines: ['Con algo rojo, ya seco: CAMA 3, y una flecha hacia el pabellón.', 'Ojalá sea salsa de tomate. Ojalá.'] });
    const face = d('water', this.wall(14, 13, 'E', 0.1, 2.0));
    this.add({ id: 'face', pos: face.clone().setY(2.3), range: 3, aim: 0.9, lines: ['Una mancha de humedad. Si uno la mira mucho rato, tiene cara.', 'Tiene cara.', 'Y se parece a mi profesor de matemáticas.'] });
    d('mould', this.wall(17, 16, 'W', 0.2, 2.6), { s: 0.7 });
    d('handL', this.wall(17, 12, 'W', 0.5, 1.2), { rot: -0.25, s: 0.9 });
    // wet bare feet from the corridor puddle into the ward, none coming back
    const path: [number, number][] = [[31.4, 30.2], [31.0, 26.5], [30.6, 23.2], [30.0, 21.6], [28.6, 21.2], [27.2, 21.0]];
    let k = 0, first: THREE.Vector3 | null = null;
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1], len = Math.hypot(bx - ax, bz - az), hd = Math.atan2(bx - ax, bz - az);
      for (let s = 0; s < len; s += 0.36) {
        const t = s / len, side = k % 2 ? 1 : -1, px = ax + (bx - ax) * t + Math.cos(hd) * side * 0.09, pz = az + (bz - az) * t - Math.sin(hd) * side * 0.09;
        const c = this.floorDecal(side < 0 ? 'footL' : 'footR', px, pz, hd, { s: 1.05 + (k % 3) * 0.03 });
        if (!first) first = c;
        k++;
      }
    }
    this.add({ id: 'feet', pos: V(30.9, 0.1, 25.5), range: 2.6, aim: 0.82, lines: ['Pisadas descalzas, mojadas. Pies pequeños. Van hacia el pabellón y ninguna vuelve.', '¿Descalzo con este frío? Mi mamá ya lo habría regañado.'] });
    // NORTH CORRIDOR
    const vis = d('g_visitas', this.wall(24, 2, 'S', 0, 1.45));
    this.add({ id: 'visitas', pos: vis, range: 3, aim: 0.9, lines: ['Con pintalabios: LAS VISITAS ERAN HASTA LAS 8.', 'Y yo llegando a las 3:47. Me van a regañar.'] });
    d('water', this.wall(6, 2, 'S', 0, 2.0), { flip: true }); d('mould', this.wall(12, 2, 'S', 0, 2.6));
    d('handTips', this.wall(20, 5, 'N', 0.2, 1.3), { rot: 0.5 });
    d('claws', this.wall(13, 5, 'N', -0.3, 1.4), { s: 0.8, rot: 0.2 });
    // DAY ROOM
    const cray = d('crayon', this.wall(17, 12, 'E', 0, 1.02), { rot: 0.04 });
    this.add({ id: 'crayon', pos: cray, lines: ['Un dibujo de crayola. Seis camitas con gente acostada, todos con los ojos cerrados. Una enfermera alta, sin cara. Arriba: LA ENFERMERA CANTA. Lo firma Mariana, cama 6.', 'Mariana dibuja mejor que yo. Y da más miedo.'], sound: 'paper' });
    d('water', this.wall(29, 12, 'W', 0.3, 2.0)); d('mould', this.wall(29, 7, 'W', 0, 2.6), { s: 0.9 });
    // BREAKER ROOM
    const sc = d('scorch', this.wall(28, 20, 'W', 0.05, 2.15));
    this.add({ id: 'scorch', pos: sc.clone().setY(2.3), range: 2.6, aim: 0.88, lines: ['Hollín sobre el tablero. Alguien hizo saltar los breakers a la fuerza.', 'Con razón no hay luz. Esto no lo arregla ni el electricista del barrio.'] });
  }

  // ---- framed pictures that change ------------------------------------------------------------
  private pictures() {
    const ex = this.ex, G = this.G;
    // 1974 graduation photo in the main corridor
    const ph = this.framed(nursesPhoto(false), 0.6, 0.46, this.wall(14, 7, 'E', 0, 1.72));
    const photo13 = nursesPhoto(true);
    let thirteen = false;
    this.add({
      id: 'photo', pos: ph.mesh.position, range: 2.3, aim: 0.9, label: 'Mirar la foto', sound: 'glass',
      use: s => {
        if (s === 0) { ex.say('Promoción de enfermería, 1974. Doce hermanas. A una le rasparon la cara con la uña. Debajo del vidrio, a lápiz: «K.»'); ex.whenUnseen('photo', ph.mesh.position, 7, () => { ph.mat.map = photo13; ph.mat.needsUpdate = true; thirteen = true; }); }
        else if (!thirteen) ex.say('Doce. Las conté dos veces. Ninguna sonríe; la del medio tiene cara de que le deben plata.');
        else if (!G.story.flags.photo13) { G.story.flags.photo13 = true; ex.say('Ahora son trece. La de atrás no estaba. Y tiene la cabeza caída sobre el hombro, de lado, como si se le hubiera zafado.'); if (!G.settings.reduced) G.audio.stinger(false); }
        else ex.say('Trece. Ave María purísima.');
      },
    });
    // the founder, behind reception, eyes taped
    const fd = this.framed(founder(), 0.55, 0.7, this.wall(9, 22, 'E', 0, 1.85));
    const bare = founder(true);
    let isBare = false;
    this.add({
      id: 'founder', pos: fd.mesh.position, range: 2.6, aim: 0.88, label: 'Mirar el cuadro', sound: 'wood',
      use: s => {
        if (s === 0) { ex.say('El doctor Aurelio Sarmiento, fundador. Le taparon los ojos con esparadrapo, en cruz.'); ex.whenUnseen('founder', fd.mesh.position, 6, () => { fd.mat.map = bare; fd.mat.needsUpdate = true; isBare = true; }); }
        else if (!isBare) ex.say('Con esa cara de bravo, mejor que no vea.');
        else if (!G.story.flags.founderBare) { G.story.flags.founderBare = true; ex.say('Se le cayó el esparadrapo. No tiene ojos. Y antes no se estaba riendo.'); if (!G.settings.reduced) G.audio.stinger(false); }
        else ex.say('Sigue riéndose. Yo no.');
      },
    });
    // a sabana landscape in the day room
    const ls = this.framed(landscape(false), 0.75, 0.52, this.wall(20, 14, 'N', 0, 1.65));
    const lit = landscape(true);
    let isLit = false;
    this.add({
      id: 'landscape', pos: ls.mesh.position, range: 2.6, aim: 0.88, label: 'Mirar el cuadro', sound: 'wood',
      use: s => {
        if (s === 0) { ex.say('Un paisaje cafetero: palmas de cera, una finca de balcones rojos y un Willys cargado de café. Muy de Salento.'); ex.whenUnseen('land', ls.mesh.position, 8, () => { ls.mat.map = lit; ls.mat.needsUpdate = true; isLit = true; }); }
        else if (isLit) {
          if (!G.story.flags.landLit) { G.story.flags.landLit = true; ex.say('Ahora es de noche en el cuadro. En cada surco hay un recolector, todos mirando hacia acá, sin cara. Y la luna tiene un ojo.'); if (!G.settings.reduced) G.audio.stinger(false); }
          else ex.say('Ninguno está recogiendo café. Están esperando. Qué boleta.');
        } else ex.say('Me provoca un tinto. Y salir de aquí.');
      },
    });
    // a still life in the day room: one guava has an eye; give it a moment and they all do
    const bd = this.framed(bodegon(false), 0.62, 0.48, this.wall(17, 8, 'E', 0, 1.62));
    const allEyes = bodegon(true);
    let eyed = false;
    this.add({
      id: 'bodegon', pos: bd.mesh.position, range: 2.6, aim: 0.88, label: 'Mirar el cuadro', sound: 'wood',
      use: s => {
        if (s === 0) { ex.say('Un bodegón: lulos, guayabas, una granadilla, bananos. A la guayaba partida le pintaron un ojo en vez de semillas.'); ex.whenUnseen('bodegon', bd.mesh.position, 7, () => { bd.mat.map = allEyes; bd.mat.needsUpdate = true; eyed = true; }); }
        else if (!eyed) ex.say('Ni en la galería de Pereira venden eso.');
        else if (!G.story.flags.bodegon) { G.story.flags.bodegon = true; ex.say('Ahora todas las frutas tienen ojos. Y todas me miran a mí. Jamás vuelvo a tomar jugo de lulo.'); if (!G.settings.reduced) G.audio.stinger(false); }
        else ex.say('Me siguen mirando. Hasta los bananos.');
      },
    });
    // above bed 3, a holy picture turned to face the wall
    const fb = this.framed(frameBack(), 0.4, 0.52, this.wall(1, 11, 'E', -0.05, 1.86));
    fb.mesh.rotation.z = 0.04;
    const portrait = nursePortrait();
    let faced = false;
    this.add({
      id: 'turned', pos: fb.mesh.position, range: 2.6, aim: 0.88, label: 'Mirar el cuadro', sound: 'wood',
      use: s => {
        if (s === 0) ex.say('Una lámina volteada contra la pared. Por detrás, a lápiz: «para que no vea».');
        else if (s === 1 && !faced) { ex.say('Mejor no voltearla. Mi abuela decía que lo que está volteado se deja volteado.'); ex.whenUnseen('turned', fb.mesh.position, 8, () => { fb.mat.map = portrait; fb.mat.needsUpdate = true; fb.mesh.rotation.z = -0.02; faced = true; }); }
        else if (faced && !G.story.flags.turnedFaced) { G.story.flags.turnedFaced = true; ex.say('Alguien la volteó. Es una hermana sin cara, con la boca cosida. Yo no fui.'); if (!G.settings.reduced) G.audio.stinger(false); }
        else ex.say(faced ? 'No tiene ojos, pero igual siento que me mira.' : 'Sigue volteada. Así está bien.');
      },
    });
  }

  // ---- ward B ---------------------------------------------------------------------------------------
  private wardProps() {
    const G = this.G, ex = this.ex, wood = lam({ color: 0x6b5238 }), steel = lam({ color: 0x9a9c96 }), white = lam({ color: 0xe8e4d8 }), cream = lam({ color: 0xd8cfb4 });
    const beds: [number, number, number, number][] = [[1, 2, 7, Math.PI / 2], [2, 2, 9, Math.PI / 2], [3, 2, 11, Math.PI / 2], [4, 2, 13, Math.PI / 2], [5, 13, 7, -Math.PI / 2], [6, 13, 13, -Math.PI / 2]];
    let boxPos = V(0, 0, 0);
    for (const [n, cx, cz, rot] of beds) {
      // nightstand at the head, on the bed's right
      const ns = this.local(cx, cz, rot, 0.78, -0.68);
      const g = new THREE.Group(); g.position.set(ns.x, 0, ns.z); g.rotation.y = rot; this.group.add(g);
      this.box(0.44, 0.62, 0.4, wood, 0, 0.31, 0, g); this.box(0.46, 0.025, 0.42, steel, 0, 0.635, 0, g);
      this.box(0.38, 0.012, 0.012, steel, 0, 0.5, 0.205, g);
      const cell = G.level.cell(cx, cz)!;
      cell.boxes.push({ x0: ns.x - 0.25, z0: ns.z - 0.25, x1: ns.x + 0.25, z1: ns.z + 0.25, tall: false });
      if (n !== 3) { const gl = this.cyl(0.028, 0.024, 0.09, lam({ color: 0x8fa6a0, transparent: true, opacity: 0.55 }), 0.08, 0.695, 0.05, g); gl.castShadow = false; }
      if (n === 2 || n === 6) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 4, 16), lam({ color: 0x4a2a18 })); r.rotation.x = -Math.PI / 2; r.position.set(-0.1, 0.652, -0.06); g.add(r); }
      if (n === 3) {
        // the music box, lid open, a dancer with no head
        const mb = new THREE.Group(); mb.position.set(-0.04, 0.648, 0); g.add(mb);
        const mw = lam({ color: 0x5a3220 });
        this.box(0.14, 0.07, 0.1, mw, 0, 0.035, 0, mb);
        const lid = new THREE.Object3D(); lid.position.set(0, 0.07, -0.05); mb.add(lid); lid.rotation.x = -1.9;
        this.box(0.14, 0.008, 0.1, mw, 0, 0, 0.05, lid); this.box(0.12, 0.004, 0.08, lam({ color: 0x8a1f2a }), 0, 0.005, 0.05, lid);
        const dancer = new THREE.Group(); dancer.position.set(0, 0.075, 0.01); dancer.userData.dynamic = true; mb.add(dancer);
        this.cyl(0.003, 0.003, 0.02, steel, 0, 0.01, 0, dancer, 4);
        const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.016, 10, 1, true), lam({ color: 0xf0d8dc, side: THREE.DoubleSide })); skirt.position.y = 0.026; dancer.add(skirt);
        this.cyl(0.004, 0.006, 0.022, lam({ color: 0xf0d8dc }), 0, 0.044, 0, dancer, 6);
        this.box(0.03, 0.003, 0.003, lam({ color: 0xe8c8b0 }), 0, 0.05, 0, dancer);
        boxPos = mb.getWorldPosition(new THREE.Vector3()); g.updateMatrixWorld(true); boxPos = mb.localToWorld(V(0, 0.05, 0));
        let playing = 0, spin = 0;
        this.anim.push(dt => { if (playing > 0) { playing -= dt; spin += dt * 2.2; dancer.rotation.y = spin; } });
        this.add({
          id: 'musicbox', pos: boxPos, range: 1.9, aim: 0.9, label: () => (playing > 0 ? 'Suena' : 'Dar cuerda'), sound: 'wood', enabled: () => playing <= 0,
          use: s => {
            if (s === 0) ex.say('Una cajita de música con una bailarina sin cabeza. Toca la canción que ella tararea.'); else if (s === 1) ex.say('La bailarina sin cabeza baila mejor que yo en diciembre.');
            const dur = G.audio.musicBox({ x: boxPos.x, y: boxPos.y, z: boxPos.z }, 0, HER_SONG, 0.6);
            playing = dur;
            this.noise(boxPos.x, boxPos.z, 14, 0.55, 'music');
            this.later(dur * 0.5, () => this.noise(boxPos.x, boxPos.z, 12, 0.45, 'music'));
            G.subtitle('Cajita de música', { x: boxPos.x, z: boxPos.z });
          },
        });
      }
      // IV stands beside beds 1, 3 and 5
      if (n === 1 || n === 3 || n === 5) {
        const iv = this.local(cx, cz, rot, -0.74, n === 3 ? 0.25 : -0.5);
        const s = new THREE.Group(); s.position.set(iv.x, 0, iv.z); this.group.add(s);
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; this.box(0.3, 0.02, 0.025, steel, Math.cos(a) * 0.14, 0.06, Math.sin(a) * 0.14, s).rotation.y = -a; }
        this.cyl(0.011, 0.011, 1.95, steel, 0, 1.03, 0, s, 6);
        this.box(0.22, 0.012, 0.012, steel, 0, 1.98, 0, s);
        const bag = this.box(0.1, 0.17, 0.035, lam({ color: 0xd8e4e0, transparent: true, opacity: 0.7 }), 0.09, 1.86, 0, s); bag.castShadow = false;
        const line = this.cyl(0.0025, 0.0025, 0.95, lam({ color: 0xc8d4d0 }), 0.09, 1.3, 0, s, 3); line.rotation.z = 0.12;
        G.level.cell(cx, cz)!.boxes.push({ x0: iv.x - 0.15, z0: iv.z - 0.15, x1: iv.x + 0.15, z1: iv.z + 0.15, tall: false });
      }
      // bed 1: restraints, buckled shut over nobody
      if (n === 1) {
        const bg = new THREE.Group(); const c = G.level.center(cx, cz); bg.position.set(c.x, 0, c.z); bg.rotation.y = rot; this.group.add(bg);
        const leather = lam({ color: 0x5a3a24 }), brass = lam({ color: 0xb08d3c });
        for (const z of [-0.25, 0.45]) { this.box(1.0, 0.012, 0.075, leather, 0, 0.652, z, bg); this.box(0.05, 0.016, 0.06, brass, 0.2, 0.66, z, bg); }
      }
      // bed 5: the sheets on the floor
      if (n === 5) {
        const p = this.local(cx, cz, rot, -0.85, 0.3);
        const geo = new THREE.PlaneGeometry(1.1, 0.9, 10, 8), pa = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.abs(Math.sin(pa.getX(i) * 7) * Math.cos(pa.getY(i) * 6)) * 0.07);
        geo.computeVertexNormals();
        const sh = new THREE.Mesh(geo, G.props.mats.sheet); sh.rotation.set(-Math.PI / 2, 0, 0.6); sh.position.set(p.x, 0.012, p.z); sh.receiveShadow = true; this.group.add(sh);
      }
      const c = G.level.center(cx, cz);
      const lines: Record<number, string[]> = {
        1: ['Cama 1. Las correas de cuero están abrochadas. No hay nadie adentro.', 'Abrochadas desde afuera. Ni en la cárcel de La 40.'],
        2: ['Cama 2. Estampitas pegadas en la cabecera. Detrás de una, a lápiz: «que no me cante a mí».', 'Tiene más estampitas que la buseta de mi tío.'],
        3: ['Cama 3. Hay alguien acostado... No. Son almohadas, amarradas con gasa en forma de persona.', 'A la almohada de arriba le dibujaron una cara con lapicero. Los ojos están cerrados.', 'Está tibia. ¿Por qué está tibia?'],
        4: ['Cama 4. Tendida con esquinas de hospital. Perfecta. Como si nadie se hubiera ido nunca.', 'Mejor tendida que la mía. No le vayan a contar a mi mamá.'],
        5: ['Cama 5. Las sábanas están en el piso. «La paciente no permaneció en cama.»', 'Yo tampoco permanecería. Pero aquí estoy.'],
        6: ['Cama 6. Una pulsera de paciente: «Mariana R. · Cama 6 · Ingreso 13-III-92».', 'La pulsera está cortada con tijera. Ojalá se haya volado.'],
      };
      this.add({ id: 'bed' + n, pos: V(c.x, 0.72, c.z), range: 2.1, aim: 0.86, label: 'Revisar la cama', sound: 'cloth', lines: lines[n] });
    }
    // the ward desk: a cup of tinto, still warm
    const desk = G.level.center(8, 10);
    const cup = new THREE.Group(); cup.position.set(desk.x + 0.55, 0.765, desk.z + 0.12); this.group.add(cup);
    this.cyl(0.05, 0.05, 0.006, white, 0, 0.003, 0, cup, 14); this.cyl(0.034, 0.028, 0.06, white, 0, 0.036, 0, cup, 14);
    const coffee = this.cyl(0.031, 0.031, 0.002, lam({ color: 0x1a0e06 }), 0, 0.06, 0, cup, 12); coffee.castShadow = false;
    const steamM = new THREE.SpriteMaterial({ map: G.tex.glint, color: 0x9a9690, transparent: true, depthWrite: false, opacity: 0 });
    const puffs = [0, 1, 2].map(i => { const s = new THREE.Sprite(steamM.clone()); s.scale.setScalar(0.04); cup.add(s); s.userData.p = i / 3; return s; });
    this.anim.push(dt => { for (const s of puffs) { s.userData.p = (s.userData.p + dt * 0.35) % 1; const p = s.userData.p; s.position.set(Math.sin(p * 6 + s.id) * 0.012, 0.07 + p * 0.16, 0); s.scale.setScalar(0.03 + p * 0.07); (s.material as THREE.SpriteMaterial).opacity = Math.sin(p * Math.PI) * 0.22; } });
    this.add({ id: 'tinto', pos: V(desk.x + 0.55, 0.85, desk.z + 0.12), range: 1.9, aim: 0.9, label: 'Examinar', sound: 'glass', lines: ['Un pocillo de tinto. Todavía está tibio.', 'Tibio. Alguien estuvo aquí hace nada.', 'Y ni me brindaron. Qué gente.'] });
    // trolleys and the linen shelves
    const tr = G.level.center(3, 4); void tr;
    this.add({ id: 'cart', pos: V(13, 0.95, 17), range: 2.0, aim: 0.85, sound: 'metal', lines: ['Un carro de curaciones. Gasa, alcohol... y rollos y rollos de esparadrapo.', 'Esparadrapo para tapar ojos. Aquí todo el presupuesto se va en esparadrapo.'] });
    this.add({ id: 'shelves', pos: V(8.2, 1.2, 35), range: 2.2, aim: 0.82, sound: 'cloth', lines: ['Sábanas almidonadas, dobladas en cuadro. Todas tienen bordado el mismo número: 3.', 'Las dobla mejor que mi mamá. Eso no se lo digo a nadie.'] });
  }

  // ---- reception -----------------------------------------------------------------------------------
  private receptionProps() {
    const G = this.G, ex = this.ex, A = G.audio;
    const cream = lam({ color: 0xcbbf9e }), dark = lam({ color: 0x1e1d1a }), chrome = lam({ color: 0xb8b8b0, emissive: 0x111111 }), brassM = lam({ color: 0xb59a52, emissive: 0x1a1406 });
    // the desk phone
    const ph = new THREE.Group(); ph.position.set(22.82, 0.79, 41.35); ph.rotation.y = Math.PI / 2 + 0.25; this.group.add(ph);
    this.box(0.21, 0.06, 0.22, cream, 0, 0.03, 0, ph).rotation.x = -0.08;
    this.box(0.12, 0.012, 0.07, dark, 0, 0.066, 0.04, ph);
    for (let i = 0; i < 12; i++) this.box(0.018, 0.006, 0.014, lam({ color: 0xe8e4d6 }), -0.03 + (i % 3) * 0.03, 0.074, 0.015 + Math.floor(i / 3) * 0.018, ph);
    const hand = new THREE.Group(); hand.position.set(0, 0.09, -0.04); hand.userData.dynamic = true; ph.add(hand);
    this.box(0.2, 0.03, 0.045, cream, 0, 0, 0, hand); this.box(0.05, 0.035, 0.06, cream, -0.085, -0.012, 0, hand); this.box(0.05, 0.035, 0.06, cream, 0.085, -0.012, 0, hand);
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 4, 24, Math.PI * 7), dark); cord.position.set(0.12, 0.03, -0.05); cord.rotation.y = 1.2; cord.scale.set(1, 1, 3); ph.add(cord);
    const phonePos = V(22.82, 0.9, 41.35);
    const phone = { ringing: false, rang: false, rings: 0, next: 0, call: false };
    this.anim.push(dt => {
      if (G.mode !== 'play') return;
      const P = G.player, d = Math.hypot(P.pos.x - phonePos.x, P.pos.z - phonePos.z);
      if (!phone.rang && !phone.ringing && G.story.flags.fuse && d < 13 && G.nurse.state !== 'chase' && !P.inLocker) { phone.ringing = true; phone.next = 0; phone.rings = 0; }
      if (phone.ringing) {
        phone.next -= dt;
        hand.position.y = 0.09 + (phone.next > 2.4 ? Math.sin(G.time * 90) * 0.002 : 0);
        if (phone.next <= 0) {
          phone.next = 3.4; phone.rings++;
          A.phoneRing({ x: phonePos.x, y: phonePos.y, z: phonePos.z }, this.occ(phonePos.x, phonePos.z));
          this.noise(phonePos.x, phonePos.z, 15, 0.55, 'phone');
          G.subtitleThrottled('phone', 'Suena el teléfono', { x: phonePos.x, z: phonePos.z }, 6);
          if (phone.rings > 6) { phone.ringing = false; phone.rang = true; if (d < 10) ex.say('Dejó de sonar.'); }
        }
      }
    });
    this.add({
      id: 'phone', pos: phonePos, range: 1.9, aim: 0.88, label: () => (phone.ringing ? 'Contestar' : 'Levantar el teléfono'), sound: 'tap', enabled: () => !phone.call,
      use: s => {
        if (phone.ringing) {
          phone.ringing = false; phone.rang = true; phone.call = true;
          hand.position.set(0.02, 0.13, 0.02); hand.rotation.z = 0.5;
          A.phoneHum(4.6); ex.say('Alguien tararea al otro lado de la línea.', 3.6);
          this.later(4.2, () => { if (A.phoneVoice('v_cama')) G.speech('Shhh… ¿Qué haces fuera de la cama?'); });
          this.later(8.2, () => {
            A.click(); ex.say('Colgaron.'); phone.call = false; hand.position.set(0, 0.09, -0.04); hand.rotation.z = 0;
            // she knows where you are now
            if (G.nurse.rig.root.visible && G.nurse.state !== 'chase') G.nurse.hintTo({ x: phonePos.x + 1.2, z: phonePos.z });
          });
          return;
        }
        ex.say(s === 0 ? 'Sin tono. Solo un zumbido, muy lejos.' : s === 1 ? 'Nada. Ni siquiera el zumbido.' : 'Muerto. Como el teléfono de la casa cuando no pagamos.');
      },
    });
    // the counter bell
    const bell = new THREE.Group(); bell.position.set(23.28, 0.79, 39.45); this.group.add(bell);
    this.cyl(0.042, 0.045, 0.014, dark, 0, 0.007, 0, bell, 16);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), chrome); dome.position.y = 0.014; bell.add(dome);
    const plunger = this.cyl(0.004, 0.004, 0.02, chrome, 0, 0.058, 0, bell, 6); plunger.userData.dynamic = true;
    const bellPos = V(23.28, 0.85, 39.45);
    let answered = false;
    this.add({
      id: 'bell', pos: bellPos, range: 1.8, aim: 0.9, label: 'Tocar el timbre', sound: 'none',
      use: () => {
        A.bell({ x: bellPos.x, y: bellPos.y, z: bellPos.z }, 0);
        plunger.position.y = 0.05; this.later(0.12, () => { plunger.position.y = 0.058; });
        this.noise(bellPos.x, bellPos.z, 9, 0.4, 'bell');
        if (!answered) {
          answered = true;
          const far = { x: 17.6, y: 0.9, z: 20.4 }; // the ward desk
          this.later(2.6, () => { A.bell(far, this.occ(far.x, far.z), 0.6); G.subtitle('Otro timbre responde', far); });
        }
      },
    });
    // the wall clock, stopped at 3:47, its second hand still trying
    const clk = this.wall(18, 17, 'S', 0, 2.35);
    const cg = new THREE.Group(); cg.position.copy(clk.p).addScaledVector(clk.n, 0.03); cg.rotation.y = Math.atan2(clk.n.x, clk.n.z); this.group.add(cg);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 32), dark); rim.rotation.x = Math.PI / 2; cg.add(rim);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.175, 32), lam({ map: clockFace() })); dial.position.z = 0.026; cg.add(dial);
    const hands = (len: number, w: number, ang: number, z: number) => { const pv = new THREE.Object3D(); pv.position.z = z; pv.rotation.z = -ang; cg.add(pv); const hm = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.003), dark); hm.position.y = len * 0.42; pv.add(hm); return pv; };
    hands(0.1, 0.012, (3 + 47 / 60) / 12 * Math.PI * 2, 0.028); hands(0.15, 0.008, 47 / 60 * Math.PI * 2, 0.031);
    const sec = hands(0.16, 0.003, 12 / 60 * Math.PI * 2, 0.034); sec.userData.dynamic = true;
    const secBase = sec.rotation.z; let tk = 0;
    this.anim.push(dt => { tk += dt; const f = tk % 1.0; sec.rotation.z = secBase - (f < 0.12 ? Math.sin(f / 0.12 * Math.PI) * 0.1 : 0); if (f < dt && Math.hypot(G.player.pos.x - clk.p.x, G.player.pos.z - clk.p.z) < 7) A.tick({ x: clk.p.x, y: clk.p.y, z: clk.p.z }, 0, 0.6); });
    this.add({ id: 'clock', pos: cg.position, range: 3.0, aim: 0.9, label: 'Mirar el reloj', sound: 'none', lines: ['El reloj se paró a las 3:47.', 'Las 3:47. El segundero tiembla, como si quisiera seguir.', 'O las 4:47, con la hora Gaviria. Da igual: es tarde.'] });
    // San Jorge and the candles: the saint's eyes get taped while you look away; then the candles go out
    const pr = G.props;
    const taped = tapedSaint(G.tex.sanJorge.image as HTMLCanvasElement);
    let isTaped = false, out = false;
    const sjPos = pr.sanJorge.position;
    const blowOut = () => {
      out = true; pr.candles.lit = false;
      pr.candles.flames.forEach(f => (f.visible = false));
      const P = G.player, behind = { x: P.pos.x - P.fwd.x * 1.1, y: 1.6, z: P.pos.z - P.fwd.z * 1.1 };
      A.whisper(behind); G.subtitle('Alguien sopla', behind);
      ex.whenUnseen('candles', sjPos, 24, () => { pr.candles.flames.forEach(fl => (fl.visible = true)); pr.candles.lit = true; out = false; G.story.flags.relit = true; });
    };
    this.add({
      id: 'sanjorge', pos: sjPos, range: 2.6, aim: 0.88, label: 'Mirar el cuadro', sound: 'wood',
      use: s => {
        if (s === 0) { ex.say('San Jorge y el dragón. Las velas están recién prendidas. Nadie más tiene llaves de la recepción.'); ex.whenUnseen('sj', sjPos, 6, () => { (pr.sanJorge.material as THREE.MeshLambertMaterial).map = taped; (pr.sanJorge.material as THREE.MeshLambertMaterial).needsUpdate = true; isTaped = true; }); return; }
        if (!isTaped) { ex.say('El santo mira hacia el pasillo. Las velas no tiemblan.'); return; }
        if (!G.story.flags.sjSeen) { G.story.flags.sjSeen = true; ex.say('Ahora el santo tiene los ojos tapados con esparadrapo. Hace un momento no estaba así.'); if (!G.settings.reduced) this.later(1.6, blowOut); return; }
        ex.say(out ? 'Las mechas todavía humean.' : G.story.flags.relit ? 'Las velas se volvieron a prender solas.' : 'El esparadrapo es nuevo.');
      },
    });
    this.add({ id: 'calendar', pos: pr.calendarMesh.position, range: 2.4, aim: 0.9, label: 'Mirar el calendario', sound: 'paper', lines: ['Marzo de 1992. Tachados hasta el 13. En el 14, a lápiz: «turno Hna. K.».', 'Debajo hay más hojas. Abril, mayo, junio... todos los días tachados. Todos dicen «turno Hna. K.».', 'Ni un festivo le dieron. En este país, con tanto puente. Con razón está así.'] });
    this.add({ id: 'chairs', pos: V(37.6, 0.6, 41), range: 2.4, aim: 0.85, label: 'Examinar', sound: 'cloth', lines: ['Sillas de espera. En una, un ramo de flores secas envuelto en El Diario del Otún del 13 de marzo.', 'Las flores eran pa\' alguien de la cama 3. Nunca llegaron.'] });
    void brassM;
  }

  // ---- day room -------------------------------------------------------------------------------------
  private dayroomProps() {
    const G = this.G, ex = this.ex, A = G.audio;
    // the cork board
    const cb = this.wall(21, 5, 'S', 0, 1.55);
    const board = this.decal('cork', cb, { lift: 0.012 });
    this.box(0.97, 0.66, 0.012, lam({ color: 0x3a2414 }), cb.p.x, cb.p.y, cb.p.z + 0.006);
    this.add({ id: 'cork', pos: board, range: 2.4, aim: 0.86, label: 'Leer la cartelera', sound: 'paper', lines: ['Cartelera. «Visitas hasta las 8. Sin excepción. K.» Una foto con la cara recortada. Un papelito: «Recen por los de la cama 3. Por todos.»', 'Sin excepción. Ni que esto fuera la Registraduría.'] });
    // the transistor radio on the TV cabinet
    const rp = V(57.7, 0.7, 19.45);
    const radio = new THREE.Group(); radio.position.copy(rp); radio.rotation.y = -Math.PI / 2; this.group.add(radio);
    const rcase = lam({ color: 0x3a2a20 }), grille = lam({ color: 0x8a8476 });
    this.box(0.24, 0.14, 0.08, rcase, 0, 0.07, 0, radio); this.box(0.13, 0.1, 0.004, grille, -0.04, 0.072, 0.041, radio);
    this.box(0.06, 0.03, 0.004, lam({ color: 0xd8cfa8, emissive: 0x000000 }), 0.07, 0.1, 0.041, radio);
    this.cyl(0.012, 0.012, 0.012, grille, 0.07, 0.05, 0.044, radio, 10).rotation.x = Math.PI / 2;
    const ant = this.cyl(0.002, 0.002, 0.42, lam({ color: 0xc8c8c0 }), 0.1, 0.33, 0, radio, 4); ant.rotation.z = -0.5;
    let busy = false;
    this.add({
      id: 'radio', pos: V(rp.x - 0.06, 0.78, rp.z), range: 2.0, aim: 0.86, los: false, label: 'Prender el radio', sound: 'none', enabled: () => !busy,
      use: s => {
        busy = true; A.click();
        const dur = s === 0 ? 7.4 : 3.2;
        A.radio({ x: rp.x, y: 0.8, z: rp.z }, 0, dur);
        this.noise(rp.x, rp.z, 15, 0.6, 'radio');
        if (s === 0) {
          this.later(0.7, () => G.ui.sub('Radio: «…racionamiento… sector cuatro, de ocho de la noche a cuatro de la mañana…»'));
          this.later(3.1, () => G.ui.sub('Radio: «…se les recuerda a los pacientes no levantarse de la cama…»'));
          if (!G.settings.reduced) this.later(5.6, () => G.ui.sub('Radio: «…ella ya va para allá.»'));
        } else ex.say('Solo estática.');
        this.later(dur + 0.3, () => { busy = false; A.click(); });
      },
    });
    // the dead television: something stands behind you in the glass
    const scr = V(57.49, 0.93, 19.0);
    const sil = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.22), new THREE.MeshBasicMaterial({ map: silhouette(), transparent: true, opacity: 0, depthWrite: false }));
    sil.position.set(scr.x - 0.004, 0.92, scr.z + 0.08); sil.rotation.y = -Math.PI / 2; sil.userData.dynamic = true; this.group.add(sil);
    let show = 0;
    this.anim.push(dt => { if (show > 0) { show -= dt; (sil.material as THREE.MeshBasicMaterial).opacity = Math.min(1, show * 3, (0.75 - show) * 8 + 0.2) * 0.75; if (show <= 0) (sil.material as THREE.MeshBasicMaterial).opacity = 0; } });
    this.add({
      id: 'tv', pos: scr, range: 2.3, aim: 0.88, los: false, label: 'Mirar el televisor', sound: 'glass',
      use: s => {
        if (s === 0 && !G.settings.reduced) {
          ex.say('Un televisor de perilla, desenchufado. En la pantalla apagada se ve la sala...', 2.6);
          this.later(1.2, () => { show = 0.75; G.input.rumble(0.3, 0.5, 200); });
          this.later(2.4, () => { ex.say('...y alguien parado detrás.', 2.4); A.stinger(false); });
        } else ex.say(s === 0 ? 'Un televisor de perilla, desenchufado. En la pantalla apagada se ve la sala, vacía.' : 'Solo la sala, vacía, reflejada en el vidrio.');
      },
    });
    this.add({ id: 'dchairs', pos: V(45.5, 0.6, 19), range: 2.4, aim: 0.84, label: 'Examinar', sound: 'cloth', lines: ['Las sillas miran hacia el televisor apagado. Una todavía está tibia.', 'Seguro estaban esperando Sábados Felices.'] });
  }

  // ---- corridors ------------------------------------------------------------------------------------
  private corridorProps() {
    const G = this.G, ex = this.ex, A = G.audio, pr = G.props;
    const wood = lam({ color: 0x6b4a2e }), steel = lam({ color: 0x8e918a });
    // handrails along the corridors, on brackets
    const rails: [number, number, number, number][] = [ // x0, z0, x1, z1 (rail line just off the wall)
      [30.06, 10.3, 30.06, 19.7], [30.06, 22.3, 30.06, 35.7], [33.94, 10.3, 33.94, 19.7], [33.94, 22.3, 33.94, 35.7],
      [4.3, 6.06, 59.7, 6.06], [4.3, 9.94, 13.7, 9.94], [16.3, 9.94, 29.7, 9.94], [34.3, 9.94, 49.7, 9.94], [52.3, 9.94, 59.7, 9.94],
    ];
    for (const [x0, z0, x1, z1] of rails) {
      const len = Math.hypot(x1 - x0, z1 - z0), along = x0 === x1 ? 'z' : 'x';
      const r = this.box(along === 'x' ? len : 0.05, 0.045, along === 'x' ? 0.05 : len, wood, (x0 + x1) / 2, 0.9, (z0 + z1) / 2); r.castShadow = false;
      for (let s = 0.3; s < len; s += 1.6) { const bx = along === 'x' ? x0 + s : x0 + (x0 < 32 ? -0.03 : 0.03), bz = along === 'z' ? z0 + s : z0 + (z0 < 8 ? -0.03 : 0.03); this.box(0.03, 0.05, 0.03, steel, bx, 0.86, bz).castShadow = false; }
    }
    // the overturned wheelchair: one wheel still turning until you look
    let spin = 1.6, stopped = false;
    this.anim.push(dt => { if (spin > 0) for (const w of pr.wheels.slice(0, 1)) w.rotation.x += dt * spin; });
    this.add({
      id: 'wheel', pos: V(18.6, 0.6, 7.6), range: 2.2, aim: 0.84, label: 'Examinar', sound: 'metal',
      use: s => {
        if (s === 0) { ex.say('La silla está volcada. Una rueda todavía gira, despacio. Alguien la volcó hace nada.'); this.later(1.5, () => { spin = 0; stopped = true; A.metal({ x: 18.6, y: 0.5, z: 7.6 }, 0); }); }
        else ex.say(stopped ? 'Ahora la rueda está quieta. Como si alguien la hubiera agarrado.' : 'La rueda gira.');
      },
    });
    this.add({ id: 'gurney', pos: V(33, 0.95, 17), range: 2.1, aim: 0.85, label: 'Revisar la camilla', sound: 'cloth', lines: ['Una camilla. La sábana tiene la forma de alguien.', 'Debajo solo hay almohadas, acomodadas como una persona. Están tibias.', 'El truco de las almohadas. Yo lo hacía para volarme del colegio.'] });
    this.add({ id: 'meds', pos: V(31, 0.95, 25), range: 2.0, aim: 0.86, label: 'Revisar el carro', sound: 'metal', lines: ['Un carro de medicamentos, un cajón por cama. El de la cama 3 está lleno de frasquitos vacíos de gotas para dormir.', 'Con eso duerme uno hasta el otro Mundial.'] });
    this.add({ id: 'mattress', pos: V(30.5, 0.9, 27.4), range: 2.0, aim: 0.85, sound: 'cloth', lines: ['Un colchón con la forma de alguien hundida en el centro. Huele a formol.', 'A formol y a sancocho viejo. Mal plan.'] });
    this.add({ id: 'emlight', pos: V(32, 2.75, 21), range: 2.6, aim: 0.9, label: 'Mirar la lámpara', sound: 'none', lines: ['Una lámpara de emergencia. En la etiqueta: «Revisada · Hna. K. · 13-III-92».', 'Revisada y todo, y no prende. Típico.'] });
    this.add({ id: 'crucifix', pos: pr.crucifix.position, range: 2.6, aim: 0.9, label: 'Mirar el crucifijo', sound: 'none', lines: ['Un crucifijo sobre la puerta del pabellón. Al Cristo también le taparon los ojos.', 'Aquí a todos les tapan los ojos. Hasta a él.'] });
    // windows: every one looks out on a blacked-out city; looking draws the lightning
    pr.windows.forEach((w, i) => {
      if (i === 1) return; // the one with the small hands has its own lines
      this.add({ id: 'win' + i, pos: V(w.x + w.nx * 0.05, 1.7, w.z + w.nz * 0.05), range: 2.3, aim: 0.86, label: 'Mirar por la ventana', sound: 'glass', lines: ['Afuera, Pereira está a oscuras. Racionamiento.', 'Llueve. Ni en Dosquebradas hay una luz.', 'Y yo aquí, en vez de estar en la casa con una vela y un tinto.'], use: () => G.storm?.strike(0.6) });
    });
  }

  // ---- the three double doors at the ends of the building ---------------------------------------------
  private specialDoors() {
    const G = this.G, ex = this.ex, A = G.audio;
    const frameM = lam({ color: 0x5c6258 }), steel = lam({ color: 0xa4a69e }), led = lam({ color: 0x300606, emissive: 0x3a0604 });
    const make = (at: Pose, kind: 'exit' | 'theatre' | 'stairs') => {
      const g = new THREE.Group(); g.position.copy(at.p).setY(0); g.rotation.y = Math.atan2(at.n.x, at.n.z); this.group.add(g);
      this.box(0.1, 2.42, 0.1, frameM, -1.0, 1.21, 0.05, g); this.box(0.1, 2.42, 0.1, frameM, 1.0, 1.21, 0.05, g); this.box(2.1, 0.1, 0.1, frameM, 0, 2.37, 0.05, g);
      const opts = (side: 'left' | 'right', seed: number) => ({ handle: side, seed, window: kind === 'theatre' ? 'round' as const : 'wired' as const, push: kind === 'exit', tone: kind === 'theatre' ? [150, 160, 150] as [number, number, number] : kind === 'stairs' ? [118, 92, 70] as [number, number, number] : undefined, stencil: kind === 'stairs' ? 'ESCALERAS' : kind === 'theatre' ? 'NO PASAR' : undefined });
      for (const s of [-1, 1]) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.94, 2.3, 0.045), [frameM, frameM, frameM, frameM, lam({ map: doorLeaf(opts(s < 0 ? 'right' : 'left', 600 + s + kind.length * 7)) }), frameM]);
        leaf.position.set(s * 0.475, 1.15, 0.025); leaf.castShadow = true; leaf.receiveShadow = true; g.add(leaf);
        if (kind === 'exit') { this.cyl(0.018, 0.018, 0.78, steel, s * 0.48, 1.02, 0.1, g, 8).rotation.z = Math.PI / 2; for (const e of [0.1, 0.86]) this.box(0.04, 0.06, 0.06, steel, s * e, 1.02, 0.07, g); }
        else this.box(0.03, 0.3, 0.03, steel, s * 0.07, 1.05, 0.075, g); // pull handles at the meeting stiles
      }
      if (kind !== 'exit') { this.box(0.3, 0.07, 0.06, steel, 0, 2.27, 0.07, g); const l = this.box(0.02, 0.02, 0.01, led, 0.11, 2.27, 0.1, g); l.castShadow = false; }
      return g;
    };
    make(this.wall(15, 24, 'N', -1.0, 0), 'exit');
    make(this.wall(30, 3, 'W', 1.0, 0), 'theatre');
    make(this.wall(1, 3, 'E', -1.0, 0), 'stairs');
    // eyes in the left porthole of surgery, once
    const glintM = new THREE.SpriteMaterial({ map: G.tex.glint, color: 0xd8e4dc, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
    const eyes = [0, 1].map(i => { const s = new THREE.Sprite(glintM); s.scale.setScalar(0.045); s.position.set(59.93, 1.74, 8 + 0.475 + (i ? -0.03 : 0.03)); this.group.add(s); return s; });
    let eyeT = 0;
    this.anim.push(dt => { if (eyeT > 0) { eyeT -= dt; glintM.opacity = Math.min(1, eyeT * 4, (0.9 - eyeT) * 10) * 0.9; if (eyeT <= 0) glintM.opacity = 0; } });
    void eyes;
    const items = G.story.items;
    const th = items.find(i => i.id === 'theatre'), stairs = items.find(i => i.id === 'stairs'), exit = items.find(i => i.id === 'exit');
    const pn = G.props.panel;
    let thS = 0, stS = 0, exS = 0;
    if (th) th.use = () => {
      const s = thS++;
      ex.say(`Cirugía. Cerradura eléctrica: sin energía no abre. ${pn.installed}/4 fusibles.`);
      if (s === 1 && !G.settings.reduced) this.later(1.4, () => { eyeT = 0.9; });
    };
    if (stairs) stairs.use = () => {
      const s = stS++;
      ex.say(s === 0 ? `Escaleras al sótano y al anfiteatro. Cerradura eléctrica. ${pn.installed}/4 fusibles.` : s === 1 ? 'Del otro lado de la puerta hace frío. Se siente en la ranura de abajo.' : 'Silencio del otro lado.');
      if (s === 1) this.later(1.6, () => { A.scratch({ x: 4.2, y: 0.7, z: 8 }, 0.4, 2.6); G.subtitle('Algo rasca la puerta del otro lado', { x: 4.2, z: 8 }); G.input.rumble(0.2, 0.4, 300); });
    };
    if (exit) exit.use = () => {
      const s = exS++;
      ex.say(['Encadenadas por fuera. No se mueven.', 'Por la rendija se ve la calle. Ni una luz en toda la ciudad.', '¿Y entonces yo por dónde salgo? Qué boleta.', 'Afuera sigue lloviendo. Nadie viene.'][Math.min(s, 3)]);
      A.metal({ x: 32, y: 1.1, z: 47.8 }, 0);
    };
  }

  // ---- dead fluorescent fittings ---------------------------------------------------------------------
  private fixtures() {
    const G = this.G;
    const housing = lam({ color: 0x8c8e86 }), diff = lam({ color: 0xbfbcae, emissive: 0x0c0c0a });
    const spots: [number, number, number, number][] = [ // x, z, yaw, hanging
      [32, 12.5, 0, 0], [32, 16.5, 0, 0], [32, 25, 0, 0], [32, 29.5, 0, 1], [32, 33.5, 0, 0],
      [10, 8, Math.PI / 2, 0], [22, 8, Math.PI / 2, 0], [40, 8, Math.PI / 2, 0], [50, 8, Math.PI / 2, 1], [57, 8, Math.PI / 2, 0],
      [10, 16, 0, 0], [20, 16, 0, 0], [10, 25, 0, 0], [20, 25, 0, 1],
      [42, 16, 0, 0], [52, 16, 0, 0], [42, 24, 0, 0], [52, 24, 0, 0],
      [26, 40, Math.PI / 2, 0], [38, 40, Math.PI / 2, 0], [26, 45, Math.PI / 2, 0], [38, 45, Math.PI / 2, 0],
      [11, 36, 0, 0], [50, 40, Math.PI / 2, 0],
    ];
    for (const [x, z, yaw, hang] of spots) {
      const pv = new THREE.Object3D(); pv.position.set(x, 2.98, z); pv.rotation.y = yaw; this.group.add(pv);
      const body = new THREE.Group(); pv.add(body);
      this.box(0.3, 0.07, 1.2, housing, 0, -0.035, 0, body).castShadow = !!hang;
      const d = this.box(0.26, 0.01, 1.14, diff, 0, -0.075, 0, body); d.castShadow = false;
      if (hang) { body.position.z = -0.6; body.children.forEach(c => (c.position.z += 0.6)); body.rotation.x = 0.85; const cbl = this.cyl(0.004, 0.004, 0.6, lam({ color: 0x151614 }), 0, -0.3, 0.6, pv, 3); cbl.rotation.x = 0.2; }
    }
    void G;
  }

  // existing set pieces that now answer back
  private existing() {
    const G = this.G;
    const lump = G.level.center(2, 11); void lump;
  }
}
