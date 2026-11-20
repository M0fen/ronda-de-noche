import { T } from './telemetry';
import * as THREE from 'three';
import { loadSettings, saveSettings, type Settings } from './settings';
import { makeTextures, type Tex } from './textures';
import { Level } from './level';
import { Props, type Lamp, type Note } from './props';
import { Post, makeDust } from './post';
import { AudioSys } from './audio';
import { Input } from './input';
import { UI } from './ui';
import { Player } from './player';
import { Nurse, Director, buildRig, type Noise } from './nurse';
import { Story } from './story';
import { FEAR } from './content';
import { Dressing } from './dressing';
import { Storm } from './storm';

// the title shot: Ward B at night, her between the beds, the storm in the windows behind her
// title shot: you have just found her. Torch on her chest, the ward and the storm behind; she stands on the right third
const TITLE = { x: 12.0, z: 23.35, yaw: 1.32, pitch: -0.06, nx: 9.1, nz: 21.9, nyaw: 1.107 };

type Mode = 'title' | 'calibrate' | 'intro' | 'play' | 'pause' | 'note' | 'journal' | 'map' | 'caught' | 'caughtUI' | 'end';

export class Game {
  settings: Settings = loadSettings();
  canvas = document.getElementById('view') as HTMLCanvasElement;
  renderer!: THREE.WebGLRenderer; scene = new THREE.Scene(); camera!: THREE.PerspectiveCamera;
  post!: Post; dust!: THREE.Points; tex!: Tex;
  level!: Level; props!: Props; audio = new AudioSys(); input!: Input; ui!: UI;
  player!: Player; nurse!: Nurse; director!: Director; story!: Story;
  dressing!: Dressing; storm!: Storm;
  noises: Noise[] = []; time = 0; mode: Mode = 'title';
  stats = { time: 0, caught: 0, thrown: 0, notes: 0, records: 0, hides: 0 };
  flicker = 0; fear = 0; caughtT = 0; journalBack = 'pause'; noteFromJournal = false;
  private throttle = new Map<string, number>();
  private last = performance.now(); private frameAvg = 16; private slowT = 0; private fastT = 0;
  private cues = new Set<string>();
  debugNoises: { x: number; z: number; r: number; t: number }[] = [];
  debug: any = null;

  async init() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 16 / 9, 0.05, 70);
    this.scene.add(this.camera);
    this.scene.background = new THREE.Color(0x020202);
    this.scene.fog = new THREE.FogExp2(0x030303, 0.06);
    this.scene.add(new THREE.HemisphereLight(0x3c4c4c, 0x2a2420, 0.5));

    this.tex = makeTextures();
    this.level = new Level(this.tex);
    this.scene.add(this.level.group);
    this.props = new Props(this.level, this.tex);
    this.scene.add(this.props.group);
    this.post = new Post(r);
    this.dust = makeDust();
    this.scene.add(this.dust);
    this.input = new Input(this.settings, this.canvas);
    this.ui = new UI(this);
    this.input.onDevice = d => this.ui.setDevice(d);
    this.player = new Player(this, this.camera);
    this.post.torch = this.player.light;
    this.audio.onWhisper = pos => { if (this.mode === 'play') this.subtitleThrottled('whisper', 'Susurros', pos, 30); };
    this.director = new Director(this);
    const rig = await buildRig(this.tex);
    this.nurse = new Nurse(this, rig);
    this.story = new Story(this);
    this.dressing = new Dressing(this);
    this.storm = new Storm(this);
    let lastFlash = -1;
    const titleEl = document.getElementById('title')!;
    this.storm.onFlash = k => { const v = Math.round(k * 50) / 50; if (v !== lastFlash) { lastFlash = v; titleEl.style.setProperty('--flash', String(v)); } };
    this.props.onDrip = (x, z) => { if (this.mode === 'play') this.audio.drip({ x, y: 0.05, z }, this.level.occlusion(x, z, this.player.pos.x, this.player.pos.z)); };
    this.ui.setDevice(matchMedia('(pointer: coarse)').matches ? 'touch' : 'kbm');
    this.input.device = this.ui.device;

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) { this.input.freeLook = false; this.canvas.style.cursor = ''; return; }
      if (this.mode === 'play' && this.ui.device === 'kbm' && !this.input.freeLook) this.pause();
    });
    // if the page can't lock the pointer at all (some embedded viewers), fall back to a free cursor
    document.addEventListener('pointerlockerror', () => { if (performance.now() - this.lockClickT < 2000) this.enableFreeLook(); });
    this.canvas.addEventListener('click', () => { if (this.mode === 'play' && this.ui.device === 'kbm') { this.lockClickT = performance.now(); this.lock(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'play') this.pause(); });

    this.setupTitle();
    this.applySettings();
    this.resize();
    // compile every shader up front so nothing hitches when a new room comes into view
    this.player.torch.on = true; this.player.updateLight();
    this.renderer.compile(this.scene, this.camera);
    this.post.render(this.scene, this.camera); // warm-up pass also builds the shadow shaders
    this.player.torch.on = false; this.player.updateLight();
    if (/debug/.test(location.hash) || /debug=1/.test(location.search)) {
      const { Debug } = await import('./debug');
      this.debug = new Debug(this);
    }
    (window as any).__NR = this;
    document.body.classList.add('ready');
    requestAnimationFrame(t => this.loop(t));
  }

  // ---- settings / layout ---------------------------------------------------------
  applySettings() {
    const s = this.settings;
    if (this.mode !== 'caught') this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.post.u.uExposure.value = 1.15 * s.bright;
    this.post.internalH = s.quality === 'low' ? 360 : s.quality === 'high' ? 720 : 540;
    if (/qa/.test(location.hash)) this.post.internalH = 200;
    // the beam in the air: off on low, fewer steps on phones
    this.post.u.uSteps.value = s.quality === 'low' ? 0 : s.quality === 'high' ? 12 : document.body.dataset.device === 'touch' ? 6 : 9;
    this.audio.setVolumes(s.master, s.music, s.sfx);
    const b = document.body.classList;
    b.toggle('tb-sm', s.touchSize === 'sm'); b.toggle('tb-lg', s.touchSize === 'lg'); b.toggle('lefty', !!s.lefty);
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.post.resize(w, h);
    (this.dust.material as THREE.ShaderMaterial).uniforms.uPx.value = this.post.u.uRes.value.y / 540;
    document.getElementById('rotate')!.hidden = !(this.ui.device === 'touch' && h > w);
  }
  // raw mouse (no OS acceleration) where the browser offers it, plain pointer lock otherwise
  private lockClickT = -1e9;
  lock() {
    if (this.ui.device !== 'kbm' || document.pointerLockElement) return;
    const c: any = this.canvas;
    const fail = () => { if (!document.pointerLockElement && performance.now() - this.lockClickT < 2000) this.enableFreeLook(); };
    const plain = () => { try { const q = c.requestPointerLock(); q?.catch?.(fail); } catch { fail(); } };
    try { const p = c.requestPointerLock({ unadjustedMovement: true }); if (p?.catch) p.catch(plain); } catch { plain(); }
  }
  private enableFreeLook() {
    if (this.input.freeLook || document.pointerLockElement) return;
    this.input.freeLook = true; this.canvas.style.cursor = 'crosshair';
    this.ui.toast('Mira con el mouse; lleva el cursor a un borde para seguir girando', 6);
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ---- flow -------------------------------------------------------------------------
  private setupTitle() {
    this.player.spawn(TITLE.x, TITLE.z, TITLE.yaw);
    this.player.eyeH = 1.5;
    this.nurse.teleport(TITLE.nx, TITLE.nz, TITLE.nyaw);
    this.nurse.reset('frozen'); this.nurse.rig.root.visible = false; this.nurse.iv.visible = false;
    const lamp = this.props.lamps.find(l => l.id === 'lamp_ward'); if (lamp) lamp.on = false; // the torch is the only light on the title
    this.ui.show('gate');
    this.ui.hud(false);
    this.post.u.uFade.value = 1;
    // the first touch anywhere unlocks sound: then the song, then the menu
    const gate = document.getElementById('gate')!;
    const enter = (e: Event) => {
      e.preventDefault();
      if (this.mode !== 'title' || this.ui.current !== 'gate') return;
      this.audio.init(); this.applySettings();
      this.audio.whenLoaded('theme', () => { if (this.mode === 'title' || this.mode === 'calibrate' || this.mode === 'intro') this.audio.playTheme(true, 2.5); });
      this.storm.strike(0.9, 0.15);
      this.ui.show('title');
    };
    gate.addEventListener('pointerdown', enter);
    window.addEventListener('keydown', e => { if (this.ui.current === 'gate' && !e.repeat) enter(e); });
  }

  start(name = '') {
    T.begin(name, { device: this.ui.device, w: innerWidth, h: innerHeight, q: this.settings.quality, ua: navigator.userAgent.slice(0, 140) });
    this.audio.init();
    this.applySettings();
    if (this.ui.device === 'touch') {
      try { (document.documentElement as any).requestFullscreen?.().catch?.(() => { }); (screen.orientation as any)?.lock?.('landscape').catch?.(() => { }); } catch { /* optional */ }
    }
    if (!this.settings.calibrated) { this.mode = 'calibrate'; this.ui.show('calibrate'); this.ui.calPreview(); return; }
    this.afterCalibrate();
  }
  afterCalibrate() {
    this.lock();
    const lamp = this.props.lamps.find(l => l.id === 'lamp_ward'); if (lamp) lamp.on = false;
    this.mode = 'intro';
    const P = this.player; P.torch.on = false; P.torch.flick = 1; P.lightTarget.position.set(0, -0.05, -6); P.updateLight(); P.bounce.intensity = 0; this.post.hazeK = 0.016;
    this.storm.auto = true; this.storm.moonK = 1; this.nurse.glintBoost = 0; this.nurse.layer.tilt.want = 0; this.nurse.lookWant = 0;
    this.nurse.rig.root.visible = false; this.nurse.iv.visible = false;
    this.player.spawn(this.level.start.x, this.level.start.z, 0);
    this.post.u.uFade.value = 1;
    this.ui.intro(['Hospital San Jorge', '1992 · 03:47', 'Con el racionamiento, la luz se fue hace horas.', 'Alguien tiene que volver a prenderla.'], () => this.beginPlay());
  }
  beginPlay() {
    if (this.mode !== 'intro') return;
    this.mode = 'play'; T.ev('play');
    this.ui.show(''); this.ui.hud(true);
    this.audio.playTheme(false, 2.2);
    this.audio.seal();
    this.subtitle('Las puertas se cierran de golpe a tu espalda');
    this.player.shake = 0.9; this.input.rumble(0.8, 0.4, 350);
    this.story.begin();
  }
  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'pause'; this.unlock(); T.ev('pause');
    this.ui.show('pause'); this.audio.suspend(true);
  }
  resume() {
    if (this.mode !== 'pause') return;
    this.mode = 'play'; this.ui.show(''); this.audio.suspend(false); this.lock(); T.ev('resume');
    if (this.stats.time > 20) this.bark('pause', 'Pausaste. Ella no.', 0.7);
  }
  openNote(n: Note, fromJournal = false) {
    if (!fromJournal) T.ev('note', n.def.id);
    this.noteFromJournal = fromJournal;
    if (this.mode === 'play') this.mode = 'note';
    else this.mode = 'note';
    this.unlock();
    this.ui.openNote(n);
  }
  closeNote() {
    this.audio.noteClose();
    if (this.noteFromJournal) { this.ui.openJournal(this.journalBack); this.mode = 'journal'; return; }
    this.mode = 'play'; this.ui.show(''); this.lock();
  }
  openJournalFromPlay() { if (this.mode !== 'play') return; this.mode = 'journal'; this.unlock(); this.audio.noteOpen(); this.ui.openJournal('play'); }
  private mapBack: 'play' | 'pause' | 'journal' = 'play';
  openMap(back: 'play' | 'pause' | 'journal') {
    if (back === 'play' && this.mode !== 'play') return;
    this.mapBack = back; this.mode = 'map'; this.unlock(); this.audio.mapOpen(); T.ev('map'); this.story.finish('map');
    this.ui.openMap();
  }
  closeMap() {
    this.audio.mapClose();
    if (this.mapBack === 'pause') { this.mode = 'pause'; this.ui.show('pause'); return; }
    if (this.mapBack === 'journal') { this.mode = 'journal'; this.ui.openJournal(this.journalBack); return; }
    this.mode = 'play'; this.ui.show(''); this.lock();
  }
  closeJournal() {
    this.audio.noteClose();
    if (this.journalBack === 'pause') { this.mode = 'pause'; this.ui.show('pause'); return; }
    this.mode = 'play'; this.ui.show(''); this.lock();
  }
  retry() {
    T.ev('retry');
    this.audio.suspend(false);
    this.story.restore();
    this.post.u.uSheet.value = 0; this.post.u.uFade.value = 1; this.post.u.uShock.value = 0; this.post.u.uFocus.value = 0;
    this.player.eyeH = 1.62; this.player.roll = 0; this.player.focusW = 0;
    this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix();
    this.audio.muffleTarget = 20000;
    this.fear = 0;
    this.mode = 'play'; this.ui.show(''); this.ui.hud(true); this.lock();
    this.bark('retry', 'Otra vez. Ella ya me apuntó en la pared: una rayita. Le faltan cuatro pa\' completar el cinco.', 1.2);
  }
  quit() { location.reload(); }
  restartAll() { location.reload(); }
  endSlice() { this.mode = 'end'; this.unlock(); this.ui.hud(false); this.ui.end(); T.ev('end', { time: Math.round(this.stats.time) }); T.progress({ ended: true }); T.flush(); }
  continueAfterEnd() {
    this.mode = 'play'; this.ui.show(''); this.ui.hud(true); this.lock();
    this.story.setObjective('Explora. Cirugía, el anfiteatro y el archivo se abren en el juego completo.');
  }

  // ---- events from the world ----------------------------------------------------
  onGrab() {
    if (this.mode !== 'play') return;
    this.mode = 'caught'; this.caughtT = 0; this.stats.caught++;
    T.ev('caught', { x: Math.round(this.player.pos.x * 10) / 10, z: Math.round(this.player.pos.z * 10) / 10, hid: this.player.inLocker?.id ?? null, by: this.nurse.state }); T.progress({ caught: this.stats.caught });
    this.audio.stinger(true); if (!this.settings.reduced) { this.audio.scream(); this.audio.shock(); this.post.u.uShock.value = 1; } this.input.rumble(1, 1, 700);
    this.player.shake = this.settings.reduced ? 0.2 : 1.6; this.player.breath.held = false; this.player.focusOn(this.player.eye, 0); this.player.focusW = 0; this.post.u.uFocus.value = 0;
    this.nurse.glintBoost = 1;
    this.ui.hud(false); this.ui.interact(null); this.ui.tutorial('', null);
    this.cues.clear();
  }
  onChase() {
    T.ev('chase'); this.bark('chase', '¡Corra, mijo, corra!'); this.player.flinch(1);
    this.audio.stinger(false);
    this.input.rumble(0.4, 0.8, 300);
    if (!this.story.tutDone.has('run')) this.story.queue('run');
  }
  onLampOff(l: Lamp) {
    const d = Math.hypot(l.pos.x - this.player.pos.x, l.pos.z - this.player.pos.z);
    if (d < 26) this.subtitle('Se apaga una lámpara', { x: l.pos.x, z: l.pos.z });
  }

  dirLabel(p: { x: number; z: number }) {
    const P = this.player;
    const dx = p.x - P.pos.x, dz = p.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d < 1.2) return 'muy cerca';
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const ang = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
    const side = Math.abs(ang) < 0.75 ? 'adelante' : Math.abs(ang) > 2.4 ? 'atrás' : ang > 0 ? 'derecha' : 'izquierda';
    return d < 5 ? `${side}, cerca` : d > 16 ? `${side}, lejos` : side;
  }
  subtitle(text: string, pos?: { x: number; z: number }) {
    if (!this.settings.subs && pos) return;
    const t = pos ? `[${text} · ${this.dirLabel(pos)}]` : text.endsWith('.') ? text : `[${text}]`;
    this.ui.sub(t);
  }
  // what she says, quoted, with where it came from
  speech(text: string, pos?: { x: number; z: number }) {
    if (!this.settings.subs) return;
    this.ui.sub(pos ? `«${text}» — ${this.dirLabel(pos)}` : `«${text}»`);
  }
  subtitleThrottled(key: string, text: string, pos: { x: number; z: number } | undefined, sec: number) {
    const last = this.throttle.get(key) ?? -999;
    if (this.time - last < sec) return;
    this.throttle.set(key, this.time);
    this.subtitle(text, pos);
  }
  debugNoise(x: number, z: number, r: number) { if (this.debug) this.debugNoises.push({ x, z, r, t: 1.2 }); }
  // what you say to yourself the first time something happens (each once a night), under the crosshair
  private barked = new Set<string>();
  bark(id: string, text: string, delay = 0) {
    if (this.barked.has(id)) return;
    this.barked.add(id);
    const go = () => { if (this.mode !== 'play') return; if (this.ui.thoughtActive()) { this.story.after(1.4, go); return; } this.ui.thought(text); };
    if (delay) this.story.after(delay, go); else go();
  }

  // ---- per-frame ----------------------------------------------------------------------
  private lastFocus: any = null;
  private tmpV = new THREE.Vector3();
  private markFocus(it: any) {
    if (!it || this.player.inLocker) { this.ui.marker(null); return; }
    const v = it.pos.clone().project(this.camera);
    if (v.z > 1) { this.ui.marker(null); return; }
    this.ui.marker({ x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (0.5 - v.y * 0.5) * window.innerHeight });
  }

  private focus() {
    const P = this.player;
    if (P.inLocker) { this.ui.interact(P.lockT >= 1 ? (P.inLocker.kind === 'bed' ? 'Salir de debajo de la cama' : 'Salir del casillero') : null); return null; }
    // forgiving cone, plus a little stickiness so the prompt doesn't flicker between neighbours
    let best: any = null, bs = 0.7;
    const v = this.tmpV;
    for (const it of this.story.items) {
      v.copy(it.pos).sub(P.eye);
      const d = v.length();
      if (d > it.range) continue;
      const dot = v.dot(P.fwd) / d;
      if (it.aim && dot < it.aim) continue; // small things need the crosshair on them
      if (!it.enabled()) continue;
      let c = dot - d * 0.015;
      if (it === this.lastFocus) c += 0.06;
      if (c <= bs) continue;
      if (it.los && this.level.blocked(P.eye.x, P.eye.z, it.pos.x, it.pos.z)) continue;
      bs = c; best = it;
    }
    this.lastFocus = best;
    this.ui.interact(best ? best.label() : null);
    return best;
  }

  private play(dt: number) {
    const a = this.input.read(dt);
    if (a.pause) { this.pause(); return; }
    if (a.journal) { this.openJournalFromPlay(); return; }
    if (a.map) { this.openMap('play'); return; }
    const P = this.player, N = this.nurse;
    const target = this.focus();
    if (a.interact && target && !P.inLocker) { target.use(); a.interact = false; this.input.rumble(0, 0.12, 40); }
    P.update(dt, a);
    const fov = this.settings.fov + P.fovKick - 11 * P.focusW * P.focusVis;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.post.u.uFocus.value = P.focusW * P.focusVis;
    this.ui.reading(P.focusW * P.focusVis > 0.3 && this.ui.thoughtActive());
    this.markFocus(target);
    if (this.mode !== 'play') return;
    if (N.rig.root.visible) N.update(dt, this.noises);
    this.noises.length = 0;
    this.director.update(dt);
    this.story.update(dt);
    this.stats.time += dt;
    { const P = this.player, N = this.nurse; T.sample(dt, P.pos.x, P.pos.z, P.yaw, N.pos.x, N.pos.z, N.state, P.inLocker ? P.inLocker.id : ''); T.progress({ time: Math.round(this.stats.time) }); }

    // fear, threat and the score
    const near = N.rig.root.visible ? Math.max(0, 1 - N.dist / 14) : 0;
    let fear = near * (N.canSee || N.state === 'chase' ? 1 : 0.55);
    if (N.state === 'chase') fear = Math.max(fear, 0.75);
    if (P.inLocker && N.state === 'inspect') fear = Math.max(fear, 0.85);
    fear += Math.min(0.25, P.darkT / 80);
    this.fear += (Math.min(1, fear) - this.fear) * Math.min(1, dt * 2);
    let threat = 0.25 + this.director.menace / 140;
    if (N.state === 'chase') threat = 3;
    else if (N.state === 'inspect' && P.inLocker) threat = 2.5;
    else if ((N.state === 'suspicious' || N.state === 'investigate') && N.dist < 18) threat = 2;
    else if (N.dist < 14 && N.rig.root.visible) threat = Math.max(threat, 1 + (1 - N.dist / 14));
    const A = this.audio;
    A.threat += (threat - A.threat) * Math.min(1, dt * 1.6);
    A.fear = this.fear;
    let fe = 0;
    for (const f of FEAR) fe = Math.max(fe, 1 - Math.hypot(f.x - P.pos.x, f.z - P.pos.z) / 9);
    A.fearEmit = fe;
    A.breathLevel = Math.max(1 - P.stamina, this.fear * 0.8, P.inLocker ? 0.35 : 0);
    A.breathHeld = P.breath.held;
    A.muffleTarget = P.inLocker && P.lockT >= 1 ? (P.inLocker.kind === 'bed' ? 9000 : 4200) : 20000;

    const u = this.post.u;
    if (u.uFade.value > 0) u.uFade.value = Math.max(0, u.uFade.value - dt * 0.8);
    u.uFear.value = this.fear;
    u.uPulse.value = Math.sin(this.time * (64 + this.fear * 76) / 60 * Math.PI * 2) * 0.5 + 0.5;
    u.uBreath.value += ((P.breath.held ? 1 : 0) - u.uBreath.value) * Math.min(1, dt * 5);
    u.uLocker.value += ((P.inLocker && P.lockT > 0.55 ? (P.inLocker.kind === 'bed' ? 0.6 : 1) : 0) - u.uLocker.value) * Math.min(1, dt * 7);
    this.debug?.update(dt);
  }

  private caught(dt: number) {
    this.caughtT += dt;
    const P = this.player, N = this.nurse, u = this.post.u, t = this.caughtT, reduced = this.settings.reduced;
    const head = N.rig.head.getWorldPosition(new THREE.Vector3());
    if (!reduced && t < 3.2) {
      // 1) she is on you in a blink, her face is all there is, and she shakes you; 2) she throws you down and
      // leans over you; 3) the sheet (below)
      const dx = P.pos.x - N.pos.x, dz = P.pos.z - N.pos.z, d = Math.hypot(dx, dz);
      const want = t < 0.95 ? 0.4 : 0.62;
      if (d > want && !P.inLocker) { const st = Math.min(d - want, dt * (t < 0.22 ? 16 : 3)); N.pos.x += (dx / d) * st; N.pos.z += (dz / d) * st; }
      if (d > 0.01) { let ny = Math.atan2(dx, dz) - N.yaw; ny = Math.atan2(Math.sin(ny), Math.cos(ny)); N.yaw += ny * Math.min(1, dt * 14); }
      const vx = head.x - P.eye.x, vy = head.y - P.eye.y, vz = head.z - P.eye.z;
      const yaw = Math.atan2(-vx, -vz), pitch = Math.atan2(vy, Math.hypot(vx, vz));
      let dy = yaw - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      // the torch keeps exposing for her face (it would burn white at this distance), and stutters while she shakes you
      P.exposeTo(Math.max(0.3, Math.hypot(vx, vy, vz)), t < 0.95 ? 0.45 + Math.random() * 0.75 : 0.8);
      const k = Math.min(1, dt * (t < 0.3 ? 28 : 8));
      P.yaw += dy * k; P.pitch += (pitch - P.pitch) * k;
      const fovT = t < 0.12 ? 30 : t < 0.95 ? 38 : 52;
      this.camera.fov += (fovT - this.camera.fov) * Math.min(1, dt * (t < 0.12 ? 45 : 6)); this.camera.updateProjectionMatrix();
      if (t < 0.95) { P.shake = Math.max(P.shake, 1.5 - t); P.roll = Math.sin(t * 47) * 0.05 * (1 - t); }
      else if (!P.inLocker) { P.eyeH += (0.5 - P.eyeH) * Math.min(1, dt * 11); P.roll += (0.32 - P.roll) * Math.min(1, dt * 8); } // on your back, head to one side
      if (t > 0.95 && !this.cues.has('down')) { this.cues.add('down'); this.audio.thud(0.9); P.shake = 0.9; this.input.rumble(0.8, 0.5, 260); this.post.u.uShock.value = Math.max(this.post.u.uShock.value, 0.45); }
      // the shock decays: two negative frames, then the red tearing dies away
      const sk = this.post.u.uShock;
      sk.value = t < 0.07 ? Math.max(sk.value, 1) : Math.max(0, Math.min(sk.value, 0.9) - dt * 1.15);
    }
    N.update(dt, []);
    P.syncCamera(dt);
    if (t > (reduced ? 0.6 : 1.3) && !this.cues.has('hum')) { this.cues.add('hum'); this.audio.hum(true); }
    if (t > (reduced ? 0.95 : 1.45) && !this.cues.has('line')) { this.cues.add('line'); if (this.audio.voiceLine('v_dormir', 1.4)) this.speech('Ya es hora de dormir.'); }
    const s0 = reduced ? 0.2 : 2.5;
    if (t > s0 && !this.cues.has('sheet')) { this.cues.add('sheet'); this.audio.sheet(); this.audio.muffleTarget = 500; }
    u.uSheet.value = THREE.MathUtils.smoothstep(t, s0, s0 + 1.0);
    u.uFade.value = THREE.MathUtils.smoothstep(t, s0 + 1.3, s0 + 2.1);
    u.uFear.value = 1; u.uLocker.value *= 0.9; u.uBreath.value *= 0.9;
    if (t > s0 + 2.2) {
      this.mode = 'caughtUI'; this.unlock(); this.audio.hum(false); this.nurse.wasHumming = false; this.ui.marker(null);
      this.ui.caught(this.stats.caught > 1 ? 'Otra vez a la cama.' : 'Te arropa hasta la cabeza. A dormir.');
    }
  }

  private curtainAgents = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
  // ---- the title: she never moves while you can see her ---------------------------------------------
  // Your torch is failing. Each time it dies she is closer when it comes back on, until she is at arm's length;
  // the next time it comes back the ward is empty and the beam goes looking for her. Lightning lights the room
  // in between (once, her too, somewhere she shouldn't be). Hovering «Empezar la noche» makes her tip her head.
  private static STEPS = [
    { x: 7.0, z: 18.2, tilt: 0 }, { x: 7.6, z: 20.0, tilt: 1 }, { x: 8.6, z: 21.4, tilt: 0 }, { x: 10.2, z: 22.0, tilt: 0.55 }, { x: 10.75, z: 22.55, tilt: 0 },
  ];
  private static SEQ: { step?: number; lit?: number; gone?: number; strike?: number; ghost?: number }[] = [
    { gone: 2.6 }, { step: 0, lit: 4.6 }, { step: 1, lit: 4.2, strike: 1.7 }, { step: 2, lit: 3.9 }, { step: 3, lit: 3.4 }, { step: 4, lit: 2.9 }, { gone: 9.5, ghost: 3.6 },
  ];
  private static SEQ_SOFT: { step?: number; lit?: number; gone?: number; strike?: number; ghost?: number }[] = [
    { gone: 2.6 }, { step: 0, lit: 5.2 }, { step: 1, lit: 5.0, strike: 2 }, { step: 2, lit: 5.5 }, { gone: 8 },
  ];
  private tl = { k: 0, phase: 'run' as 'run' | 'flicker' | 'dark', t: 0, struck: false, moved: false, ghost: false, hover: false, dim: 0, find: 0, up: 0 };
  private titleAim = new THREE.Vector3(7, 1.0, 19); private titleSec = -1;
  titleHover(on: boolean) { this.tl.hover = on; }
  private titleRound(dt: number) {
    const N = this.nurse, cam = this.player.eye, tl = this.tl, soft = this.settings.reduced;
    const SEQ = soft ? Game.SEQ_SOFT : Game.SEQ;
    if (tl.k >= SEQ.length) tl.k = 0;
    const cur = SEQ[tl.k], present = cur.step !== undefined;
    const darkDur = cur.step === 4 ? 2.6 : 1.3;
    tl.t += dt;
    const place = (x: number, z: number) => { N.teleport(x, z, Math.atan2(cam.x - x, cam.z - z)); N.rig.root.visible = true; N.iv.visible = true; };
    const hide = () => { N.rig.root.visible = false; N.iv.visible = false; };
    let glint = 0;
    if (tl.phase === 'run') {
      if (cur.strike !== undefined && !tl.struck && tl.t > cur.strike) { tl.struck = true; this.storm.strike(0.55); }
      if (cur.ghost !== undefined && !tl.struck && tl.t > cur.ghost) { tl.struck = true; this.storm.strike(0.9); tl.ghost = true; place(5.0, 17.0); }
      if (tl.ghost) { const on = this.storm.flash > 0.12; N.rig.root.visible = on; N.iv.visible = on; glint = on ? 0.6 : 0; if (tl.t > (cur.ghost ?? 0) + 1.6) { tl.ghost = false; hide(); } }
      if (present) glint = 0.3 + (tl.hover ? 0.45 : 0) + (cur.step === 4 ? 0.4 : 0);
      if (tl.t > (cur.lit ?? cur.gone ?? 4)) { tl.phase = 'flicker'; tl.t = 0; this.audio.torchDie(0.16); }
    } else if (tl.phase === 'flicker') {
      glint = present ? 0.45 : 0;
      if (tl.t > 0.7) { tl.phase = 'dark'; tl.t = 0; tl.moved = false; }
    } else {
      const next = SEQ[(tl.k + 1) % SEQ.length];
      if (!tl.moved && tl.t > darkDur * 0.5) {
        tl.moved = true;
        if (next.step !== undefined) { const p = Game.STEPS[next.step]; place(p.x, p.z); } else hide();
      }
      // eyeshine in the dark: there, gone (a blink), there again - closer
      const k = tl.t / darkDur, nowHere = tl.moved ? next.step !== undefined : present;
      glint = nowHere && (k < 0.34 || k > 0.62) ? (soft ? 0.3 : 0.55) : 0;
      if (tl.t > darkDur) {
        tl.k = (tl.k + 1) % SEQ.length; tl.phase = 'run'; tl.t = 0; tl.struck = false; tl.find = 0.6;
        this.audio.click();
        if (next.step === 4 && !soft) this.audio.thud(0.5);
      }
    }
    const nowCur = SEQ[tl.k], step = nowCur.step !== undefined && tl.phase !== 'dark' ? Game.STEPS[nowCur.step] : null;
    N.glintBoost = glint;
    N.layer.tilt.want = step ? Math.max(step.tilt, tl.hover ? 1 : 0) : 0;
    N.lookWant = 1; N.lookAt.copy(cam);
    N.speed = 0;
    tl.dim += ((tl.phase === 'dark' ? 0.3 : 0) - tl.dim) * Math.min(1, dt * (tl.phase === 'dark' ? 12 : 6));
    // when she is at arm's length you look up into her face
    tl.up += ((step === Game.STEPS[4] ? 0.15 : 0) - tl.up) * Math.min(1, dt * 2.5);
    this.storm.moonK += ((tl.phase === 'dark' ? 0.12 : 1) - this.storm.moonK) * Math.min(1, dt * 10);
    return { lit: tl.phase === 'run' ? 1 : tl.phase === 'flicker' ? (soft ? 1 - tl.t / 0.7 : (Math.sin(tl.t * 38) + Math.sin(tl.t * 61 + 2) > 0.1 + tl.t * 1.5 ? 0.95 : 0.06)) : 0, present: !!step };
  }
  private title(dt: number) {
    const t = this.time, P = this.player;
    P.yaw = TITLE.yaw + Math.sin(t * 0.11) * 0.03; P.pitch = TITLE.pitch + Math.sin(t * 0.17) * 0.012 + this.tl.up;
    P.pos.x = TITLE.x + Math.sin(t * 0.05) * 0.15;
    P.syncCamera(dt);
    const N = this.nurse;
    this.storm.auto = false;
    const st = this.titleRound(dt);
    N.update(dt, []);
    // the torch: on her when she's there (finding her fast when it comes back on), otherwise sweeping the ward
    const L = P.light, T = P.torch, aim = this.titleAim, tl = this.tl;
    if (st.present) {
      const k = Math.min(1, dt * (tl.find > 0 ? 7 : 2.2)); tl.find = Math.max(0, tl.find - dt);
      aim.x += (N.pos.x - aim.x) * k; aim.z += (N.pos.z - aim.z) * k; aim.y += (1.12 - aim.y) * k;
    } else if (tl.phase === 'run') {
      const sx = 6.6 + 1.9 * Math.sin(t * 0.43), sz = 19.4 + 2.3 * Math.sin(t * 0.29 + 1), k = Math.min(1, dt * 1.2);
      aim.x += (sx - aim.x) * k; aim.z += (sz - aim.z) * k; aim.y += (0.75 - aim.y) * k;
    }
    this.camera.updateMatrixWorld();
    P.lightTarget.position.copy(aim); this.camera.worldToLocal(P.lightTarget.position);
    const fl = this.settings.reduced ? 1 : 1 - 0.16 * Math.max(0, Math.sin(t * 2.7) * Math.sin(t * 4.3 + 1));
    const lit = st.lit * fl;
    T.on = lit > 0.02; T.flick = Math.max(0.01, lit); T.range = 17; L.angle = 0.7; L.distance = 17; L.intensity = 15 * lit; this.post.hazeK = 0.045; // thicker air: the beam reads
    L.getWorldPosition(T.pos); T.dir.copy(aim).sub(T.pos).normalize();
    P.bounce.position.copy(aim).addScaledVector(T.dir, -0.45); P.bounce.intensity = L.intensity * 0.05;
    const sec = Math.floor(t) % 60;
    if (sec !== this.titleSec) {
      this.titleSec = sec; const el = document.getElementById('title-clock');
      if (el) el.textContent = `03:${47 + Math.floor(t / 60) % 12}:${String(sec).padStart(2, '0')}`;
    }
    const u = this.post.u;
    this.titleFade = Math.max(0, this.titleFade - dt * 0.5);
    u.uFade.value = Math.max(this.titleFade, tl.dim);
  }
  private titleFade = 1;

  private loop(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.tick(dt);
    this.post.render(this.scene, this.camera);
    this.input.endFrame();
    this.adapt(dt);
    requestAnimationFrame(t => this.loop(t));
  }

  // Advance the world without rendering (QA and debugging).
  simulate(sec: number, step = 1 / 30) { for (let t = 0; t < sec; t += step) { this.tick(step); this.input.endFrame(); } }

  private tick(dt: number) {
    this.time += dt;
    const u = this.post.u;
    switch (this.mode) {
      case 'title': this.title(dt); break;
      case 'play': this.play(dt); break;
      case 'caught': this.caught(dt); break;
      case 'intro': { const a = this.input.read(dt); if (a.any || a.interact) this.beginPlay(); break; }
      case 'pause': { const a = this.input.read(dt); if (a.pause) this.resume(); break; }
      case 'note': { const a = this.input.read(dt); if (a.pause || a.interact) this.closeNote(); break; }
      case 'journal': { const a = this.input.read(dt); if (a.pause || a.journal) this.closeJournal(); else if (a.map) this.openMap('journal'); break; }
      case 'map': { const a = this.input.read(dt); if (a.pause || a.map || a.interact || a.crouch) this.closeMap(); break; }
      default: this.input.read(dt);
    }
    // world presentation
    this.flicker = Math.max(0, this.flicker - dt);
    this.dressing.update(dt, this.time);
    this.storm.update(dt, this.mode === 'title');
    this.props.update(dt, this.time, this.flicker > 0 ? 1 : 0, this.settings.reduced);
    this.level.updateDoors(dt);
    this.curtainAgents[0].x = this.player.pos.x; this.curtainAgents[0].z = this.player.pos.z;
    this.curtainAgents[1].x = this.nurse.pos.x; this.curtainAgents[1].z = this.nurse.pos.z;
    this.props.updateCurtains(dt, this.time, this.mode === 'title' ? this.curtainAgents.slice(1) : this.curtainAgents, this.storm.flash * 0.8 + 0.18 * Math.max(0, Math.sin(this.time * 0.23) * Math.sin(this.time * 0.61 + 1)));
    if (this.props.tv) { const k = this.nurse.dist < 9 && this.mode === 'play' && !this.settings.reduced ? Math.random() * 0.25 * (1 - this.nurse.dist / 9) : 0; this.props.tv.emissive.setRGB(k, k, k * 1.1); }
    const du = (this.dust.material as THREE.ShaderMaterial).uniforms;
    const P = this.player;
    du.uCam.value.copy(P.eye); du.uTime.value = this.time;
    du.uTorchPos.value.copy(P.torch.pos); du.uTorchDir.value.copy(P.torch.dir);
    du.uTorchCos.value = P.torch.cos; du.uTorchOn.value = P.torch.on ? P.torch.flick * Math.min(1.3, P.light.intensity / 55) : 0; du.uTorchRange.value = P.torch.range; // the whole beam, dimmer at its edge
    u.uTime.value = this.time;
    T.tick(dt);
    if (this.audio.ctx) { this.audio.listener(P.eye, P.fwd); this.audio.update(dt, P.eye, this.mode !== 'play'); }
    if (this.mode === 'play' || this.mode === 'caught') this.ui.update(dt);
  }

  // dynamic resolution keeps phones near 30 fps
  private adapt(dt: number) {
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.05;
    if (this.mode !== 'play') return;
    if (this.frameAvg > 38) { this.slowT += dt; this.fastT = 0; } else if (this.frameAvg < 20) { this.fastT += dt; this.slowT = 0; } else { this.slowT = this.fastT = 0; }
    if (this.slowT > 2 && this.post.scale > 0.6) { this.post.scale -= 0.15; this.slowT = 0; this.resize(); }
    if (this.fastT > 6 && this.post.scale < 1) { this.post.scale = Math.min(1, this.post.scale + 0.1); this.fastT = 0; this.resize(); }
  }
}

export { saveSettings };
