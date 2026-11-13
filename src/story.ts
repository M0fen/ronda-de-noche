import { T } from './telemetry';
import * as THREE from 'three';
import type { Game } from './game';
import { AREAS, RECORDS_TOTAL, type Area } from './content';
import type { Door } from './level';
import type { Note } from './props';

export interface Interactable { id: string; pos: THREE.Vector3; range: number; label: () => string; enabled: () => boolean; use: () => void; key?: string; aim?: number; los?: boolean }

interface Snapshot {
  player: { x: number; z: number; yaw: number; battery: number; bottles: number; torchOn: boolean; level: number; hasFuse: boolean };
  picked: string[]; read: string[]; lamps: string[]; doors: Record<string, { open: boolean; barred: boolean }>;
  fuseTaken: boolean; installed: number; flags: Record<string, any>; phase: number; objective: string; lures: number; hides: number;
}

// Tutorial beats: shown once, in order of relevance, never stacked.
const TUT: Record<string, { act: string; text: string }> = {
  move: { act: 'move', text: 'Moverse · mirar alrededor' },
  torch: { act: 'torch', text: 'Encender o apagar la linterna' },
  beam: { act: 'beam', text: 'Cambiar el haz. A un haz estrecho le cuesta más verlo' },
  crank: { act: 'crank', text: 'Dale manivela para cargar la linterna. El zumbido se oye lejos' },
  crouch: { act: 'crouch', text: 'Agáchate. Tus pasos dejan de sonar' },
  throw: { act: 'throw', text: 'Apunta y lanza. El vidrio roto la atrae hacia allá' },
  locker: { act: 'interact', text: 'Algo viene. Escóndete en un casillero' },
  breath: { act: 'breath', text: 'Aguanta la respiración mientras esté cerca. La luz de la linterna se escapa por la rejilla. Suelta cuando vuelva a tararear' },
  journal: { act: 'journal', text: 'Diario: notas y objetivo' },
  run: { act: 'sprint', text: 'Corre y rompe su línea de visión. Las puertas y las esquinas ayudan' },
};

export class Story {
  flags: Record<string, any> = {};
  objective = '';
  area: Area | null = null; areaTime = 0; seenAreas = new Set<string>();
  items: Interactable[] = [];
  checkpoint: Snapshot | null = null;
  tutDone = new Set<string>(); tutCur = ''; tutT = 0;
  moved = 0; private lastPos = { x: 0, z: 0 };
  timers: { t: number; fn: () => void }[] = [];
  hallT = 10; halluc: THREE.Sprite[] = []; hallLife = 0;
  sightWait = 0;

  constructor(private game: Game) {
    this.buildItems();
    const gm = new THREE.SpriteMaterial({ map: game.tex.glint, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 });
    for (let i = 0; i < 2; i++) { const s = new THREE.Sprite(gm); s.visible = false; s.scale.setScalar(0.12); game.scene.add(s); this.halluc.push(s); }
  }

  after(t: number, fn: () => void) { this.timers.push({ t, fn }); }

  setObjective(text: string) { if (text !== this.objective) { T.ev('obj', text); T.progress({ obj: text }); } this.objective = text; this.game.ui.objective(text); }

  // ---- interactables -------------------------------------------------------------
  private buildItems() {
    const G = this.game, P = () => G.player, props = G.props, L = G.level;
    for (const b of props.bottles) this.items.push({
      id: b.id, pos: b.pos.clone().setY(0.12), range: 1.7, key: 'interact',
      label: () => (P().bottles >= 3 ? 'Manos llenas' : 'Recoger botella'),
      enabled: () => !b.picked,
      use: () => { if (P().bottles >= 3) return; b.picked = true; b.mesh.visible = false; P().bottles++; G.audio.pickup(); this.tut('bottle'); },
    });
    for (const n of props.notes) this.items.push({
      id: n.def.id, pos: n.pos, range: 1.9, label: () => (n.read ? 'Leer otra vez' : 'Leer'), enabled: () => true,
      use: () => this.read(n),
    });
    for (const l of props.lamps) this.items.push({
      id: l.id, pos: l.pos, range: 1.9, label: () => (l.on ? 'Apagar la lámpara' : 'Encender la lámpara'), enabled: () => true,
      use: () => { l.on = !l.on; G.audio.click(); },
    });
    for (const d of L.doors) {
      const c = L.center(d.cx, d.cz);
      this.items.push({
        id: d.id, pos: new THREE.Vector3(c.x, 1.2, c.z), range: 2.15, enabled: () => true,
        label: () => {
          if (d.barred) return this.unbarSide(d) ? 'Quitar la tranca' : 'Atrancada del otro lado';
          return d.open ? 'Cerrar la puerta' : 'Abrir la puerta';
        },
        use: () => this.useDoor(d),
      });
    }
    for (const lk of props.lockers) this.items.push({
      id: lk.id, pos: lk.kind === 'bed' ? lk.inside.clone().lerp(lk.front, 0.45).setY(0.45) : lk.inside.clone().setY(1.05), range: lk.kind === 'bed' ? 2.1 : 1.95,
      label: () => lk.kind === 'bed' ? 'Meterte bajo la cama' : 'Esconderse', enabled: () => !P().inLocker,
      use: () => P().enterLocker(lk),
    });
    const f = props.fuse;
    this.items.push({ id: 'fuse', pos: f.pos, range: 1.9, label: () => 'Tomar el fusible (PABELLÓN)', enabled: () => !f.taken, use: () => this.takeFuse() });
    const pn = props.panel;
    this.items.push({
      id: 'panel', pos: pn.pos, range: 2.2, enabled: () => true,
      label: () => (P().hasFuse ? 'Instalar el fusible' : `Tablero eléctrico · ${pn.installed}/4`),
      use: () => this.usePanel(),
    });
    this.items.push({ id: 'exit', pos: new THREE.Vector3(32, 1.2, 48), range: 2.4, label: () => 'Puertas principales', enabled: () => true, use: () => G.subtitle('Encadenadas por fuera. No se mueven.') });
    this.items.push({ id: 'theatre', pos: new THREE.Vector3(60, 1.2, 8), range: 2.4, label: () => 'Cirugía', enabled: () => true, use: () => G.subtitle(`Cerradura magnética. Necesita energía: ${pn.installed}/4 fusibles.`) });
    this.items.push({ id: 'stairs', pos: new THREE.Vector3(4, 1.2, 8), range: 2.4, label: () => 'Escaleras al sótano', enabled: () => true, use: () => G.subtitle(`Cerradura magnética. Necesita energía: ${pn.installed}/4 fusibles.`) });
  }

  private unbarSide(d: Door) {
    if (!d.unbarSide) return false;
    const c = this.game.level.at(this.game.player.pos.x, this.game.player.pos.z);
    return !!c && c.cx === d.cx + d.unbarSide.dx && c.cz === d.cz + d.unbarSide.dz;
  }

  private useDoor(d: Door) {
    const G = this.game, L = G.level, P = G.player;
    const c = L.center(d.cx, d.cz);
    if (d.barred) {
      if (!this.unbarSide(d)) { G.subtitle('Atrancada del otro lado.'); return; }
      d.barred = false; G.level.openDoor(d, P.pos);
      d.pivot.getObjectByName('bar')!.visible = false;
      G.audio.doorSlam({ x: c.x, y: 1.2, z: c.z }, 0);
      G.noises.push({ x: c.x, z: c.z, r: 8, loud: 0.7, kind: 'door' });
      this.flags.unbarred = true;
      return;
    }
    // can't close a door on yourself
    if (d.open) {
      const inside = Math.abs(P.pos.x - c.x) < 1.05 && Math.abs(P.pos.z - c.z) < 1.05;
      if (inside) return;
    }
    if (d.open) d.open = false; else L.openDoor(d, P.pos);
    const slam = !d.open && P.sprinting;
    if (slam) { G.audio.doorSlam({ x: c.x, y: 1.2, z: c.z }, 0); G.noises.push({ x: c.x, z: c.z, r: 15, loud: 1, kind: 'slam' }); G.player.shake = 0.4; }
    else { G.audio.doorCreak({ x: c.x, y: 1.2, z: c.z }, 0); G.noises.push({ x: c.x, z: c.z, r: 4, loud: 0.45, kind: 'door' }); }
  }

  private read(n: Note) {
    const G = this.game;
    if (!n.read) {
      n.read = true; G.stats.notes++;
      if (n.def.record) G.stats.records++;
      T.progress({ notes: G.stats.notes, records: G.stats.records });
      if (n.def.id === 'porter') this.after(0.2, () => this.queue('crank'));
      this.after(0.5, () => this.queue('journal'));
    }
    G.audio.paper();
    G.openNote(n);
  }

  private takeFuse() {
    T.ev('fuse'); T.progress({ fuse: true });
    const G = this.game, f = G.props.fuse;
    f.taken = true; f.mesh.visible = false;
    G.player.hasFuse = true; this.flags.fuse = true;
    G.audio.spark(f.pos); G.audio.screech(f.pos);
    G.noises.push({ x: f.pos.x, z: f.pos.z, r: 30, loud: 1, kind: 'cabinet' });
    G.subtitle('Chirría la puerta del gabinete');
    G.director.phase = 1; G.nurse.phaseMul = 1.25;
    G.flicker = 2.5;
    G.player.shake = 0.35;
    this.setObjective('Lleva el fusible al cuarto eléctrico. La puerta de la lencería hacia recepción se destranca desde este lado.');
  }

  private usePanel() {
    const G = this.game, pn = G.props.panel, P = G.player;
    if (!this.flags.panelSeen) {
      this.flags.panelSeen = true;
      this.setObjective('Encuentra los cuatro fusibles. Empieza por el Pabellón B, al norte por el pasillo principal. (0/4)');
      G.subtitle('Cuatro portafusibles vacíos: PABELLÓN, CIRUGÍA, ANFITEATRO, ARCHIVO.');
      this.save();
    }
    if (P.hasFuse) {
      P.hasFuse = false; pn.installed++;
      pn.fuses[0].visible = true;
      pn.leds[0].emissive.setHex(0xffa020); pn.leds[0].color.setHex(0xffa020);
      G.audio.install(); G.player.shake = 0.5; G.input.rumble(0.6, 0.3, 300);
      this.flags.installed = true;
      this.setObjective('Fusible 1 de 4 restaurado. Al norte, las puertas de cirugía empiezan a zumbar.');
      this.save();
      this.after(1.8, () => G.endSlice());
    }
  }

  // ---- tutorial ---------------------------------------------------------------------
  queue(id: string) { if (this.tutDone.has(id) || this.tutCur === id) return; this.tutCur = id; this.tutT = 0; this.game.ui.tutorial(id, TUT[id]); }
  finish(id: string) { this.tutDone.add(id); if (this.tutCur === id) { this.tutCur = ''; this.game.ui.tutorial('', null); } }
  tut(ev: string) {
    const map: Record<string, string> = { 'torch-on': 'torch', beam: 'beam', crank: 'crank', 'crouch-done': 'crouch', throw: 'throw', 'locker-in': 'locker', breath: 'breath' };
    if (ev === 'bottle') { if (!this.tutDone.has('throw')) this.after(0.4, () => this.queue('throw')); return; }
    if (ev === 'torch-on' && !this.tutDone.has('move')) this.after(1.2, () => { if (!this.tutDone.has('move')) this.queue('move'); });
    const id = map[ev];
    if (id === 'breath') { this.flags.breathTried = true; return; }
    if (id) this.finish(id);
  }

  // ---- checkpoints ------------------------------------------------------------------
  save() {
    const G = this.game, P = G.player, pr = G.props;
    this.checkpoint = {
      player: { x: P.pos.x, z: P.pos.z, yaw: P.yaw, battery: Math.max(P.torch.battery, 60), bottles: P.bottles, torchOn: P.torch.on, level: P.torch.level, hasFuse: P.hasFuse },
      picked: pr.bottles.filter(b => b.picked).map(b => b.id), read: pr.notes.filter(n => n.read).map(n => n.def.id),
      lamps: pr.lamps.filter(l => l.on).map(l => l.id),
      doors: Object.fromEntries(G.level.doors.map(d => [d.id, { open: d.open, barred: d.barred }])),
      fuseTaken: pr.fuse.taken, installed: pr.panel.installed, flags: JSON.parse(JSON.stringify(this.flags)), phase: G.director.phase,
      objective: this.objective, lures: G.nurse.lures, hides: G.nurse.lockerHides,
    };
    G.ui.toast('Punto de control');
  }

  restore() {
    const G = this.game, s = this.checkpoint!, P = G.player, pr = G.props;
    this.flags = JSON.parse(JSON.stringify(s.flags));
    this.timers = [];
    P.spawn(s.player.x, s.player.z, s.player.yaw);
    P.torch.battery = s.player.battery; P.bottles = s.player.bottles; P.torch.on = s.player.torchOn; P.torch.level = s.player.level; P.hasFuse = s.player.hasFuse;
    for (const b of pr.bottles) { b.picked = s.picked.includes(b.id); b.mesh.visible = !b.picked; }
    for (const l of pr.lamps) l.on = s.lamps.includes(l.id);
    for (const d of G.level.doors) { const st = s.doors[d.id]; d.open = st.open; d.barred = st.barred; d.angle = d.open ? 1.45 : 0; G.level.applyDoor(d); const bar = d.pivot.getObjectByName('bar'); if (bar) bar.visible = d.barred; }
    pr.fuse.taken = s.fuseTaken; pr.fuse.mesh.visible = !s.fuseTaken;
    pr.panel.installed = s.installed;
    for (const lk of pr.lockers) { lk.doorTarget = 0; }
    G.director.phase = s.phase; G.director.menace = 0; G.director.hintT = 35; G.director.cooldown = 10;
    G.nurse.lures = s.lures; G.nurse.lockerHides = s.hides; G.nurse.phaseMul = s.phase ? 1.25 : 1;
    this.setObjective(s.objective);
    if (this.flags.sighting) { G.nurse.rig.root.visible = true; G.nurse.iv.visible = true; G.nurse.placeFar(); } else { G.nurse.teleport(4, 7, Math.PI / 2); G.nurse.reset('frozen'); G.nurse.rig.root.visible = false; G.nurse.iv.visible = false; }
    G.audio.hum(false); G.nurse.wasHumming = false;
  }

  // ---- director helpers -------------------------------------------------------------
  safe() {
    const G = this.game;
    return G.director.phase === 0 && !!this.area && (this.area.id === 'reception' || this.area.id === 'breaker') && this.areaTime < 90;
  }

  begin() {
    const G = this.game;
    this.setObjective('Encuentra el tablero eléctrico.');
    this.after(1.5, () => { if (!G.player.torch.on) this.queue('torch'); });
    this.lastPos = { ...G.player.pos };
    this.save();
    // the Nurse waits off-stage until the first sighting
    G.nurse.teleport(4, 7, Math.PI / 2); G.nurse.reset('frozen'); G.nurse.rig.root.visible = false; G.nurse.iv.visible = false;
  }

  private startSighting() {
    const G = this.game, N = G.nurse;
    this.flags.sighting = true;
    N.rig.root.visible = true; N.iv.visible = true;
    N.teleport(24, 7.2, Math.PI / 2);
    N.humWant = true;
    N.runScript([
      { to: { x: 32, z: 9.4 }, speed: 1.6, call: () => { N.humWant = true; } },
      { wait: 2.1, look: true, glint: 0.9, call: () => { N.humWant = false; G.audio.stinger(true); G.input.rumble(0.3, 0.6, 400); G.player.shake = 0.25; } },
      { to: { x: 51, z: 7.2 }, speed: 1.35, call: () => { N.humWant = true; } },
      { to: { x: 51, z: 14 }, speed: 1.2 },
    ], () => { G.director.hintT = 40; });
  }

  private startWardEvent() {
    const G = this.game, N = G.nurse, P = G.player;
    this.flags.wardEvent = true;
    this.queue('locker');
    const far = N.dist > 20 && !N.visibleFrom(P.pos.x, P.pos.z, P.fwd.x, P.fwd.z);
    if (far) N.teleport(26, 7.4, -Math.PI / 2);
    N.humWant = true;
    N.runScript([{ to: { x: 15, z: 8 }, speed: 1.35 }], () => {
      if (P.inLocker) {
        N.inspect(P.inLocker, { tutorial: true });
        N.inspectDone = () => {
          this.finish('breath');
          G.subtitle('El tarareo se aleja.');
          N.humWant = true;
          N.runScript([{ to: { x: 15, z: 7.5 }, speed: 1.2 }, { to: { x: 34, z: 7.4 }, speed: 1.2 }], () => { G.director.cooldown = 30; });
        };
      } else {
        N.reset('patrol'); N.rig.root.visible = true;
        N.hintTo({ x: 15, z: 20 });
      }
    });
  }

  update(dt: number) {
    const G = this.game, P = G.player, L = G.level, N = G.nurse;
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }

    // areas
    const cell = L.at(P.pos.x, P.pos.z);
    const ar = cell ? AREAS.find(a => cell.cx >= a.x0 && cell.cx <= a.x1 && cell.cz >= a.z0 && cell.cz <= a.z1) ?? null : null;
    if (ar !== this.area) {
      this.area = ar; this.areaTime = 0;
      if (ar && !this.seenAreas.has(ar.id)) { this.seenAreas.add(ar.id); G.ui.areaCard(ar.name, ar.sub); }
      if (ar?.id === 'corridor' && !this.tutDone.has('crouch')) this.after(1.5, () => this.queue('crouch'));
      if (ar?.id === 'ward' && this.flags.sighting && !this.flags.wardCP && N.state !== 'chase') { this.flags.wardCP = true; this.save(); }
      if (ar?.id === 'linen' && !this.flags.linenCP && N.state !== 'chase' && N.state !== 'inspect') { this.flags.linenCP = true; this.save(); }
    }
    this.areaTime += dt;

    // tutorial pacing
    this.moved += Math.hypot(P.pos.x - this.lastPos.x, P.pos.z - this.lastPos.z); this.lastPos = { ...P.pos };
    if (this.tutCur) this.tutT += dt;
    if (!this.tutDone.has('move') && this.moved > 4) this.finish('move');
    if (this.tutDone.has('move') && this.tutDone.has('torch') && !this.tutDone.has('beam') && !this.tutCur && P.torch.on && this.moved > 10) this.queue('beam');
    if (this.tutCur === 'beam' && this.tutT > 9) this.finish('beam');
    if (this.tutCur === 'crouch' && this.tutT > 12) this.finish('crouch');
    if (this.tutCur === 'throw' && this.tutT > 15) this.finish('throw');
    if (this.tutCur === 'journal' && this.tutT > 6) this.finish('journal');
    if (this.tutCur === 'run' && this.tutT > 6) this.finish('run');
    if (this.tutCur === 'crank' && this.tutT > 14) this.finish('crank');
    if (!this.tutDone.has('crank') && P.torch.battery < 40 && !this.tutCur) this.queue('crank');
    if (this.tutCur === 'locker' && P.inLocker) { this.finish('locker'); this.queue('breath'); }
    if (this.tutCur === 'breath' && !P.inLocker && !N.tutorial) this.finish('breath');
    if (this.tutDone.has('move') && !this.tutDone.has('torch') && !this.tutCur && !P.torch.on && this.moved > 8) this.queue('torch');

    // scripted beats
    if (!this.flags.sighting && ar?.id === 'corridor' && cell && cell.cz <= 9) {
      this.sightWait += dt;
      if ((P.fwd.z < -0.55 && cell.cz >= 7) || this.sightWait > 5 || cell.cz <= 7) this.startSighting();
    } else if (!this.flags.sighting && ar && ['north', 'ward', 'dayroom', 'linen'].includes(ar.id)) {
      // reached the wards another way: wake her up out of sight instead
      this.flags.sighting = true;
      N.rig.root.visible = true; N.iv.visible = true; N.placeFar();
    }
    if (this.flags.sighting && !this.flags.wardEvent && ar?.id === 'ward' && !['script', 'chase', 'inspect', 'grab'].includes(N.state)) {
      if (!this.flags.wardArm) { this.flags.wardArm = true; this.after(5.5, () => { if (!this.flags.wardEvent && G.mode === 'play') this.startWardEvent(); }); }
    }

    // darkness pressure: hallucinations
    const hallOn = !G.settings.reduced && P.darkT > 20 && !P.inLocker;
    G.post.u.uHalluc.value += ((hallOn ? Math.min(1, (P.darkT - 20) / 25) : 0) - G.post.u.uHalluc.value) * Math.min(1, dt * 2);
    if (hallOn) {
      if (!this.flags.darkWarned) { this.flags.darkWarned = true; G.subtitle('Tu respiración se acelera en la oscuridad'); }
      this.hallT -= dt;
      if (this.hallT <= 0) {
        this.hallT = 7 + Math.random() * 6;
        const r = Math.random();
        const back = { x: P.pos.x - P.fwd.x * 4, z: P.pos.z - P.fwd.z * 4 };
        if (r < 0.35) { for (let i = 0; i < 3; i++) this.after(i * 0.55, () => G.audio.step({ x: back.x, y: 0.2, z: back.z }, 0, 1.1)); G.subtitle('Pasos', back); }
        else if (r < 0.65) { const wp = { x: P.pos.x + (Math.random() - 0.5) * 4, y: 1.6, z: P.pos.z + (Math.random() - 0.5) * 4 }; if (!G.audio.whisperAt(wp, 0.2, 0.6)) G.audio.whisper(wp); G.subtitle('Susurros'); }
        else {
          const d = 6.5, x = P.pos.x + P.fwd.x * d, z = P.pos.z + P.fwd.z * d;
          if (!L.blocked(P.pos.x, P.pos.z, x, z)) {
            const rx = -P.fwd.z * 0.035, rz = P.fwd.x * 0.035;
            this.halluc[0].position.set(x + rx, 1.62, z + rz); this.halluc[1].position.set(x - rx, 1.62, z - rz);
            this.halluc.forEach(s => (s.visible = true)); this.hallLife = 1.8;
          }
        }
      }
    }
    if (this.hallLife > 0) {
      this.hallLife -= dt;
      const lit = P.torch.on;
      const o = lit ? 0 : Math.min(1, this.hallLife) * 0.8;
      (this.halluc[0].material as THREE.SpriteMaterial).opacity = o;
      if (this.hallLife <= 0 || lit) { this.hallLife = 0; this.halluc.forEach(s => (s.visible = false)); }
    }
  }

  recordsLine() { return `${this.game.stats.records} / ${RECORDS_TOTAL}`; }
}
