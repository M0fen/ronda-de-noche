import { T as Tel } from './telemetry';
import * as THREE from 'three';
import type { Game } from './game';
import type { Act } from './input';
import type { Locker } from './props';
import { T, H } from './level';


const LEVELS = [
  { angle: 0.3, intensity: 30, range: 12, vis: 0.45, drain: 0.45 },
  { angle: 0.44, intensity: 60, range: 17, vis: 0.7, drain: 0.95 },
  { angle: 0.6, intensity: 100, range: 22, vis: 1.0, drain: 1.9 },
];

interface Proj { mesh: THREE.Object3D; p: THREE.Vector3; v: THREE.Vector3; ox: number; oz: number }
interface Shard { mesh: THREE.Mesh; v: THREE.Vector3; life: number }

export class Player {
  pos = { x: 0, z: 0 }; yaw = 0; pitch = 0; vel = { x: 0, z: 0 };
  eyeH = 1.62; bob = 0; bobAmt = 0;
  eye = new THREE.Vector3(); fwd = new THREE.Vector3(0, 0, -1);
  crouch = false; stamina = 1; exhausted = false; sprinting = false; moving = false;
  torch = { on: false, level: 1, battery: 100, pos: new THREE.Vector3(), dir: new THREE.Vector3(), cos: 0.9, range: 16, cranking: false, flick: 1 };
  light: THREE.SpotLight; lightTarget = new THREE.Object3D(); torchModel: THREE.Group; lens: THREE.MeshBasicMaterial;
  bottles = 0; aiming = false; arc: THREE.Line; marker: THREE.Mesh;
  proj: Proj[] = []; shards: Shard[] = [];
  inLocker: Locker | null = null; lockT = 1; lockDir = 0; lockFrom = { x: 0, z: 0, yaw: 0, pitch: 0 }; lockerTutorial = false;
  breath = { meter: 1, held: false, gasped: false, gaspT: 0, lock: false };
  hasFuse = false; ghost = false;
  crouchToggle = false; crouchHeldT = 0; crouchMomentary = false; stepPhase = 0; stepCount = 0; roll = 0; fovKick = 0; bumpT = 0;
  bounce: THREE.PointLight; aimD = 6;
  stepAcc = 0; crankT = 0; darkT = 0; shake = 0; lowWarned = false; dipT = 0;
  // a short, guided look at something: the view eases onto it, the field narrows and the edges soften
  focusW = 0; private focusT = 0; private focusDur = 0; private focusK = 1; private focusAt = new THREE.Vector3();
  focusOn(p: THREE.Vector3, dur = 1.3, strength = 1) { this.focusAt.copy(p); this.focusDur = dur; this.focusT = 0; this.focusK = strength; }
  private updateFocus(dt: number) {
    if (this.focusDur <= 0) { this.focusW = Math.max(0, this.focusW - dt * 4); return; }
    this.focusT += dt;
    const t = this.focusT, D = this.focusDur, ss = THREE.MathUtils.smoothstep;
    this.focusW = ss(t, 0, 0.22) * (1 - ss(t, D - 0.45, D));
    const vx = this.focusAt.x - this.eye.x, vy = this.focusAt.y - this.eye.y, vz = this.focusAt.z - this.eye.z;
    const yaw = Math.atan2(-vx, -vz), pitch = Math.atan2(vy, Math.hypot(vx, vz));
    let dy = yaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const k = Math.min(1, dt * 7) * this.focusW * this.focusK;
    this.yaw += dy * k; this.pitch += (pitch - this.pitch) * k;
    if (t >= D) this.focusDur = 0;
  }
  focus: any = null;
  private bottleMesh: THREE.Object3D;

  constructor(private game: Game, public camera: THREE.PerspectiveCamera) {
    this.light = new THREE.SpotLight(0xfff0d6, 0, 16, 0.44, 0.55, 1.6);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.bias = -0.0006; this.light.shadow.normalBias = 0.03;
    this.light.shadow.camera.near = 0.2;
    camera.add(this.light); camera.add(this.lightTarget);
    this.light.position.set(0.22, -0.2, -0.05);
    this.lightTarget.position.set(0, -0.05, -6);
    this.light.target = this.lightTarget;
    this.light.map = game.tex.cookie; // reflector rings and lens dirt
    // torchlight bouncing off whatever it hits: a dim warm fill at the beam's end
    this.bounce = new THREE.PointLight(0xffd9a8, 0, 9, 2);
    game.scene.add(this.bounce);

    const tm = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.24, 10), new THREE.MeshBasicMaterial({ color: 0x121311, depthTest: false }));
    body.rotation.x = Math.PI / 2;
    this.lens = new THREE.MeshBasicMaterial({ color: 0x23241f, depthTest: false });
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.024, 0.07, 12, 1, true), this.lens);
    head.rotation.x = Math.PI / 2; head.position.z = -0.14;
    const crank = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.018), new THREE.MeshBasicMaterial({ color: 0x2a2a26, depthTest: false }));
    crank.position.set(0.026, 0.018, 0.04); crank.name = 'crank';
    tm.add(body, head, crank);
    tm.traverse(o => { o.renderOrder = 999; (o as THREE.Mesh).frustumCulled = false; });
    tm.position.set(0.3, -0.29, -0.5);
    tm.visible = false; // kept for a future hand model; the bare cylinder read as a glitch
    camera.add(tm);
    this.torchModel = tm;

    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(120 * 3), 3));
    this.arc = new THREE.Line(ag, new THREE.LineDashedMaterial({ color: 0xd8cfb0, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.7, depthTest: true }));
    this.arc.frustumCulled = false; this.arc.visible = false;
    game.scene.add(this.arc);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 20), new THREE.MeshBasicMaterial({ color: 0xd8cfb0, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false;
    game.scene.add(this.marker);
    this.bottleMesh = game.props.bottleGeo;
  }

  spawn(x: number, z: number, yaw: number) {
    this.pos.x = x; this.pos.z = z; this.yaw = yaw; this.pitch = 0; this.vel = { x: 0, z: 0 };
    this.inLocker = null; this.lockT = 1; this.crouch = false; this.stamina = 1; this.aiming = false;
    this.breath = { meter: 1, held: false, gasped: false, gaspT: 0, lock: false };
    this.syncCamera(0);
  }

  get light01() { return LEVELS[this.torch.level]; }
  updateLight() { const lv = LEVELS[this.torch.level]; this.light.intensity = this.torch.on ? lv.intensity : 0; }
  /** the torch's auto-exposure for something at distance d (used while she has you and the update isn't running) */
  exposeTo(d: number, flick = 1) { const lv = LEVELS[this.torch.level]; this.light.intensity = this.torch.on ? lv.intensity * flick * THREE.MathUtils.clamp((d / 6) ** 1.6, 0.03, 1) : 0; }

  visibility() {
    const G = this.game;
    let v = 0.07;
    if (this.torch.on) v = Math.max(v, LEVELS[this.torch.level].vis * (0.6 + 0.4 * this.torch.flick));
    for (const l of G.props.lamps) if (l.on) { const d = this.eye.distanceTo(l.pos); if (d < 6) v = Math.max(v, 0.8 * (1 - d / 6) + 0.12); }
    for (const e of G.props.em) { const d = Math.hypot(e.light.position.x - this.pos.x, e.light.position.z - this.pos.z); if (d < 4) v = Math.max(v, 0.25 * (1 - d / 4) + 0.08); }
    if (this.crouch) v *= 0.62;
    if (this.sprinting) v = Math.min(1, v + 0.12);
    return v;
  }

  private noise(r: number, loud: number, kind: string, x = this.pos.x, z = this.pos.z, extra: any = {}) {
    // thunder rolling overhead swallows footsteps, the crank and the creak of a door (not a thrown bottle)
    const masked = (this.game.storm?.masking ?? 0) > 0 && kind !== 'bottle' && kind !== 'slam';
    if (masked) r *= 0.5;
    this.game.noises.push({ x, z, r, loud, kind, ...extra });
    this.game.debugNoise(x, z, r);
    if (kind !== 'bottle' && kind !== 'throw') this.game.ui.noiseEvent(r, loud, x, z); // the ring round the crosshair
  }

  update(dt: number, a: Act) {
    const G = this.game, L = G.level, A = G.audio;
    if (this.inLocker) { this.updateLocker(dt, a); this.updateTorch(dt, a); this.syncCamera(dt); return; }

    this.yaw -= a.lx * (1 - this.focusW * 0.7); this.pitch = THREE.MathUtils.clamp(this.pitch - a.ly * (1 - this.focusW * 0.7), -1.35, 1.3);
    this.updateFocus(dt);
    // tap = toggle; hold past a beat = momentary, standing back up on release
    if (a.crouch) { this.crouchToggle = !this.crouchToggle; this.crouchHeldT = 0; this.crouchMomentary = false; G.story.tut('crouch-done'); }
    if (a.crouchHold && this.crouchToggle) { this.crouchHeldT += dt; if (this.crouchHeldT > 0.35) this.crouchMomentary = true; }
    if (!a.crouchHold && this.crouchMomentary) { this.crouchToggle = false; this.crouchMomentary = false; }
    this.moving = Math.hypot(a.mx, a.mz) > 0.1;
    if (this.stamina <= 0.02) this.exhausted = true;
    if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    this.sprinting = a.sprint && this.moving && a.mz > -0.2 && !this.exhausted && !this.aiming && !this.torch.cranking;
    if (this.sprinting) this.crouchToggle = false;
    this.crouch = this.crouchToggle && !this.sprinting;
    this.stamina = THREE.MathUtils.clamp(this.stamina + dt * (this.sprinting ? -1 / 6.5 : this.moving ? 0.1 : 0.2), 0, 1);
    const speed = this.crouch ? 1.3 : this.sprinting ? 4.4 : this.aiming || this.torch.cranking ? 1.5 : 2.35;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const tx = (fx * a.mz + rx * a.mx) * speed, tz = (fz * a.mz + rz * a.mx) * speed;
    // quick to start, a touch of weight when stopping or changing direction
    const k = Math.min(1, dt * (this.moving ? (this.sprinting ? 6.5 : 9) : 11));
    this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    L.collide(this.pos, 0.3);
    const moved = Math.hypot(this.pos.x - px, this.pos.z - pz);
    this.eyeH += ((this.crouch ? 1.02 : 1.62) - this.eyeH) * Math.min(1, dt * 9);

    // walking into a shut door pushes it open; at a run it bangs open
    if (a.mz > 0.3) {
      const c = L.at(this.pos.x + fx * 0.62, this.pos.z + fz * 0.62);
      if (c?.kind === 'door' && !c.door!.open && !c.door!.barred) {
        this.bumpT += dt;
        if (this.bumpT > (this.sprinting ? 0 : 0.16)) {
          this.bumpT = 0; this.game.level.openDoor(c.door!, this.pos);
          const dp = L.center(c.cx, c.cz);
          if (this.sprinting) { A.doorSlam({ x: dp.x, y: 1.2, z: dp.z }, 0); this.noise(14, 1, 'slam', dp.x, dp.z); this.shake = Math.max(this.shake, 0.35); G.input.rumble(0.5, 0.3, 160); }
          else { A.doorCreak({ x: dp.x, y: 1.2, z: dp.z }, 0); this.noise(4, 0.45, 'door', dp.x, dp.z); }
        }
      } else this.bumpT = 0;
    }

    // footsteps are tied to the head bob; crouching is silent
    const stride = this.crouch ? 0.6 : this.sprinting ? 0.95 : 0.72;
    this.stepPhase += moved / stride;
    if (this.stepPhase >= 1) {
      this.stepPhase -= 1; this.stepCount++;
      const cell = L.at(this.pos.x, this.pos.z);
      const glass = cell && G.props.glass.has(`${cell.cx},${cell.cz}`);
      if (glass) { A.crunch(); this.noise(this.crouch ? 3.5 : 9, this.crouch ? 0.5 : 0.9, 'glass'); G.subtitleThrottled('crunch', 'Cruje vidrio bajo tus pies', undefined, 6); }
      if (!this.crouch) { const fc = G.level.at(this.pos.x, this.pos.z); A.step(undefined, 0, this.sprinting ? 1.3 : 0.75, false, fc ? G.level.styleAt(fc.cx, fc.cz) : ''); this.noise(this.sprinting ? 11 : 3.5, this.sprinting ? 1 : 0.5, 'step'); }
      else A.step(undefined, 0, 0.18);
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 0.2) this.stepPhase += (Math.round(this.stepPhase) - this.stepPhase) * Math.min(1, dt * 4); // settle the bob when standing
    this.bobAmt += ((sp > 0.3 ? (this.sprinting ? 0.05 : this.crouch ? 0.014 : 0.028) : 0) - this.bobAmt) * Math.min(1, dt * 6);
    const lateral = this.vel.x * rx + this.vel.z * rz;
    this.roll += (-lateral / 4.4 * 0.03 - this.roll) * Math.min(1, dt * 6);
    this.fovKick += ((this.sprinting && sp > 3 ? 6 : 0) - this.fovKick) * Math.min(1, dt * 4);

    this.updateTorch(dt, a);
    this.updateThrow(dt, a);
    this.syncCamera(dt);

    // darkness pressure (only when truly unlit)
    const lit = this.torch.on || G.props.lamps.some(l => l.on && this.eye.distanceTo(l.pos) < 5) || G.props.em.some(e => Math.hypot(e.light.position.x - this.pos.x, e.light.position.z - this.pos.z) < 3.2);
    this.darkT = lit ? Math.max(0, this.darkT - dt * 3) : this.darkT + dt;
  }

  private updateTorch(dt: number, a: Act) {
    const G = this.game, A = G.audio, t = this.torch;
    if (a.torch) {
      A.click();
      if (!t.on && t.battery <= 0.5) G.subtitle('La linterna está muerta. Dale manivela.');
      else { t.on = !t.on; G.story.tut(t.on ? 'torch-on' : 'torch-off'); }
    }
    if (a.beam) { t.level = (t.level + a.beam + 3) % 3; A.click(); G.story.tut('beam'); }
    t.cranking = a.crank;
    if (t.cranking) {
      t.battery = Math.min(100, t.battery + dt * 13);
      this.crankT -= dt;
      if (this.crankT <= 0) { this.crankT = 0.32; A.crank(); this.noise(13, 0.9, 'crank'); G.subtitleThrottled('crank', 'Zumba la manivela', undefined, 8); G.input.rumble(0, 0.15, 60); }
      G.story.tut('crank');
    }
    if (t.on) { t.battery -= dt * LEVELS[t.level].drain; if (t.battery <= 0) { t.battery = 0; t.on = false; A.click(); A.torchDie(0.55); G.subtitle('Se apaga la linterna.'); G.bark('dead', 'Ay, no. Esto es de manivela, como el radio del abuelo.', 0.8); } }
    // the first warning: the bulb browns out for a moment as the charge drops under 15
    if (t.on && t.battery < 15 && !this.lowWarned) { this.lowWarned = true; this.dipT = 0.5; A.torchDie(0.22); G.subtitle('La linterna parpadea: poca carga'); }
    if (t.battery > 25) this.lowWarned = false;
    // flicker: low battery, cranking, or her presence (smooth, never strobing)
    const tm = G.time;
    let f = 1;
    if (t.battery < 15) f *= 0.45 + 0.55 * (t.battery / 15) * (0.75 + 0.25 * Math.sin(tm * 6.1));
    if (this.dipT > 0) { this.dipT -= dt; f *= Math.random() < 0.5 ? 0.15 : 0.6; }
    if (t.cranking) f *= 0.8 + 0.2 * Math.sin(tm * 18);
    const nd = G.nurse.dist;
    if (nd < 9 && !G.settings.reduced) f *= 1 - (1 - nd / 9) * 0.55 * Math.max(0, Math.sin(tm * 2.7) * Math.sin(tm * 4.3 + 1));
    t.flick = f;
    const lv = LEVELS[t.level];
    this.light.angle = Math.min(1.1, lv.angle * 1.6); this.light.distance = lv.range; // wider than the gameplay cone: the cookie keeps the hot spot
    const boxed = this.inLocker && this.lockT > 0.5 ? (this.inLocker.kind === 'bed' ? 0.45 : 0.16) : 1; // the door swallows most of the beam; under a bed it lies along the floor
    // auto-exposure: closer than ~6 m the beam dims with the distance to whatever is under the crosshair
    // (the same falloff the light has), so a note on the wall, a painting or her face at arm's length
    // keeps its detail instead of burning out
    const near = THREE.MathUtils.clamp((this.aimD / 6) ** 1.6, 0.03, 1);
    this.light.intensity = t.on ? lv.intensity * f * boxed * near : 0;
    this.lens.color.setRGB(t.on ? 0.22 + 0.2 * f : 0.14, t.on ? 0.21 + 0.18 * f : 0.14, t.on ? 0.18 + 0.12 * f : 0.12);
    t.cos = Math.cos(lv.angle * 0.95); t.range = lv.range;
    if (t.on) {
      const d0 = t.dir, o = t.pos, hl = Math.max(0.05, Math.hypot(d0.x, d0.z));
      let d = this.game.level.rayDist(o.x, o.z, d0.x, d0.z, lv.range) / hl;
      if (d0.y < -0.02) d = Math.min(d, o.y / -d0.y);
      if (d0.y > 0.02) d = Math.min(d, (H - o.y) / d0.y);
      d = Math.min(d, lv.range);
      this.bounce.position.copy(o).addScaledVector(d0, Math.max(0.3, d - 0.35));
      this.bounce.intensity = this.light.intensity * 0.13 * Math.max(0, 1 - d / lv.range); // the room glows back: no hard keyhole
    } else this.bounce.intensity = 0;
    const crank = this.torchModel.getObjectByName('crank')!;
    crank.rotation.x = t.cranking ? tm * 25 : crank.rotation.x;
  }

  private simulate(p: THREE.Vector3, v: THREE.Vector3, dt: number) {
    const L = this.game.level;
    v.y -= 9.8 * dt;
    const n = p.clone().addScaledVector(v, dt);
    if (n.y >= H - 0.05) { n.y = H - 0.05; v.y = -Math.abs(v.y) * 0.3; }
    const c = L.at(n.x, n.z);
    let hit = !c || c.kind === 'wall';
    if (c && (c.kind === 'door' || c.kind === 'furn')) for (const b of L.boxesAt(c.cx, c.cz)) if (n.x > b.x0 && n.x < b.x1 && n.z > b.z0 && n.z < b.z1 && (b.tall || n.y < 0.85)) hit = true;
    if (n.y <= 0.03) { n.y = 0.03; hit = true; }
    return { n, hit };
  }

  private launch() {
    const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
    const origin = this.eye.clone().addScaledVector(f, 0.35).add(new THREE.Vector3(-f.z, 0, f.x).normalize().multiplyScalar(0.15)).add(new THREE.Vector3(0, -0.12, 0));
    const v = f.multiplyScalar(10.5).add(new THREE.Vector3(0, 2.3, 0));
    return { origin, v };
  }

  private updateThrow(dt: number, a: Act) {
    const G = this.game;
    this.aiming = a.aim && this.bottles > 0;
    this.arc.visible = this.marker.visible = this.aiming;
    if (this.aiming) {
      const { origin, v } = this.launch();
      const arr = (this.arc.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      let p = origin.clone(); let i = 0;
      for (; i < 120; i++) {
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
        const r = this.simulate(p, v, 0.025);
        p = r.n; if (r.hit) { i++; arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; break; }
      }
      this.arc.geometry.setDrawRange(0, Math.min(i + 1, 120));
      this.arc.geometry.attributes.position.needsUpdate = true;
      this.arc.computeLineDistances();
      this.marker.position.set(p.x, Math.min(p.y, 0.04) + 0.02, p.z);
      if (a.throw) {
        const m = this.bottleMesh.clone();
        const l = this.launch();
        m.position.copy(l.origin); G.scene.add(m);
        this.proj.push({ mesh: m, p: l.origin, v: l.v, ox: this.pos.x, oz: this.pos.z });
        this.bottles--; G.stats.thrown++; Tel.ev('bottle');
        G.audio.step(undefined, 0, 0.3);
        this.noise(2.5, 0.35, 'throw');
        G.story.tut('throw');
      }
    }
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const pr = this.proj[i];
      let done = false;
      for (let s = 0; s < 3 && !done; s++) { const r = this.simulate(pr.p, pr.v, dt / 3); pr.p.copy(r.n); done = r.hit; }
      pr.mesh.position.copy(pr.p); pr.mesh.rotation.x += dt * 9; pr.mesh.rotation.z += dt * 5;
      if (done) {
        G.scene.remove(pr.mesh); this.proj.splice(i, 1);
        const occ = G.level.occlusion(pr.p.x, pr.p.z, this.pos.x, this.pos.z);
        G.audio.glass({ x: pr.p.x, y: pr.p.y, z: pr.p.z }, occ);
        this.noise(16, 1, 'bottle', pr.p.x, pr.p.z, { ox: pr.ox, oz: pr.oz });
        G.subtitle('Se rompe un vidrio', { x: pr.p.x, z: pr.p.z });
        for (let k = 0; k < 14; k++) {
          const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.05), G.props.mats.shard);
          sh.position.copy(pr.p); G.scene.add(sh);
          this.shards.push({ mesh: sh, v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3), life: 1.4 });
        }
      }
    }
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt; s.v.y -= 9.8 * dt; s.mesh.position.addScaledVector(s.v, dt);
      if (s.mesh.position.y < 0.01) { s.mesh.position.y = 0.01; s.v.set(0, 0, 0); }
      s.mesh.rotation.x += dt * 8;
      if (s.life <= 0) { G.scene.remove(s.mesh); this.shards.splice(i, 1); }
    }
  }

  // -- lockers -------------------------------------------------------------------
  enterLocker(l: Locker) {
    this.inLocker = l; this.lockT = 0; this.lockDir = 1;
    this.game.stats.hides++; Tel.ev('hide', l.id); Tel.progress({ hides: this.game.stats.hides });
    this.lockFrom = { x: this.pos.x, z: this.pos.z, yaw: this.yaw, pitch: this.pitch };
    this.crouch = false; this.aiming = false; this.arc.visible = this.marker.visible = false;
    l.doorTarget = 1.25;
    if (l.kind === 'bed') this.game.audio.bed(false); else this.game.audio.locker();
    this.noise(l.kind === 'bed' ? 3.5 : 5, 0.5, 'locker');
    this.game.nurse.onPlayerEnteredLocker(l);
    if (l.kind === 'bed') this.game.bark('bed', 'Aquí abajo hay más polvo que donde la abuela.', 1.3); else this.game.bark('locker', 'Quietico. Quietico. Como cuando llegaba tarde a la casa.', 0.9);
    this.game.ui.tutorialHint = true;
    this.game.story.tut('locker-in');
  }

  exitLocker() {
    const l = this.inLocker!;
    Tel.ev('unhide', l.id);
    this.lockT = 0; this.lockDir = -1;
    this.lockFrom = { x: l.inside.x, z: l.inside.z, yaw: this.yaw, pitch: this.pitch };
    l.doorTarget = 1.25;
    if (l.kind === 'bed') this.game.audio.bed(true); else this.game.audio.locker();
    this.noise(l.kind === 'bed' ? 3.5 : 5, 0.5, 'locker');
  }

  private updateLocker(dt: number, a: Act) {
    const l = this.inLocker!, G = this.game, A = G.audio;
    const b = this.breath;
    const bed = l.kind === 'bed';
    if (this.lockT < 1) {
      this.lockT = Math.min(1, this.lockT + dt / (bed ? 1.05 : 0.6));
      const sm = (x: number) => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
      const e = sm(this.lockT);
      // under a bed: get down first, then slide in (and out first, then up)
      const em = bed ? (this.lockDir > 0 ? sm((this.lockT - 0.3) / 0.7) : sm(this.lockT / 0.7)) : e;
      const dest = this.lockDir > 0 ? l.inside : l.front;
      this.pos.x = this.lockFrom.x + (dest.x - this.lockFrom.x) * em;
      this.pos.z = this.lockFrom.z + (dest.z - this.lockFrom.z) * em;
      let dy = l.yaw - this.lockFrom.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (this.lockDir > 0) { this.yaw = this.lockFrom.yaw + dy * em; this.pitch = this.lockFrom.pitch * (1 - em); }
      const eyeT = bed && (this.lockDir > 0 || this.lockT < 0.62) ? 0.2 : 1.55;
      this.eyeH += (eyeT - this.eyeH) * Math.min(1, dt * (bed ? 5 : 6));
      if (this.lockT >= 1) {
        l.doorTarget = 0;
        if (this.lockDir < 0) { this.inLocker = null; this.lockT = 1; b.held = false; G.audio.inLocker = false; }
      }
      return;
    }
    G.audio.inLocker = true;
    // limited look: through the slats, or out along the floor; the head moves a little with it
    this.yaw -= a.lx; this.pitch = THREE.MathUtils.clamp(this.pitch - a.ly, bed ? -0.16 : -0.35, bed ? 0.2 : 0.3);
    let d = this.yaw - l.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    d = THREE.MathUtils.clamp(d, bed ? -0.85 : -0.6, bed ? 0.85 : 0.6);
    this.yaw = l.yaw + d;
    const lean = -d * (bed ? 0.14 : 0.06), rx = Math.cos(l.yaw), rz = -Math.sin(l.yaw);
    this.pos.x += (l.inside.x + rx * lean - this.pos.x) * Math.min(1, dt * 6);
    this.pos.z += (l.inside.z + rz * lean - this.pos.z) * Math.min(1, dt * 6);
    // breath
    const want = a.breath && !b.lock;
    if (want) {
      if (!b.held) G.story.tut('breath');
      b.held = true;
      b.meter -= dt / (G.nurse.tutorial ? 11 : 8.5);
      if (b.meter <= 0) { b.meter = 0; b.held = false; b.lock = true; b.gasped = true; b.gaspT = 0.6; A.gasp(); Tel.ev('gasp'); this.noise(7, 0.9, 'gasp'); G.input.rumble(0.5, 0.5, 200); }
    } else {
      if (b.held && b.meter < 0.3) { A.pant(); this.noise(2.2, 0.5, 'pant'); }
      b.held = false;
      b.meter = Math.min(1, b.meter + dt * 0.33);
      if (b.lock && b.meter > 0.3) b.lock = false;
    }
    if (b.gaspT > 0) { b.gaspT -= dt; if (b.gaspT <= 0) b.gasped = false; }
    if (a.interact && G.nurse.state !== 'grab') this.exitLocker();
  }

  syncCamera(dt: number) {
    const cam = this.camera;
    const ph = this.stepPhase;
    const by = -Math.abs(Math.cos(Math.PI * ph)) * this.bobAmt + this.bobAmt * 0.5;
    const bx = Math.sin(Math.PI * (ph + this.stepCount)) * this.bobAmt * 0.55;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.game.settings.reduced ? this.shake * 0.3 : this.shake;
    const sx = (Math.random() - 0.5) * sh * 0.08, sy = (Math.random() - 0.5) * sh * 0.08;
    cam.position.set(this.pos.x + Math.cos(this.yaw) * bx, this.eyeH + by + sy, this.pos.z - Math.sin(this.yaw) * bx);
    cam.rotation.set(this.pitch + sy * 0.5, this.yaw + sx * 0.5, this.roll + bx * 0.25, 'YXZ');
    cam.updateMatrixWorld();
    this.eye.copy(cam.position);
    cam.getWorldDirection(this.fwd);
    // the beam converges on whatever sits under the crosshair: at arm's length it finds her face, not her chest
    const f = this.fwd, e = this.eye, h2 = Math.max(0.0025, f.x * f.x + f.z * f.z), hl = Math.sqrt(h2);
    let aim = this.game.level.rayDist(e.x, e.z, f.x / hl, f.z / hl, 8) / hl;
    if (f.y < -0.02) aim = Math.min(aim, e.y / -f.y);
    if (f.y > 0.02) aim = Math.min(aim, (H - e.y) / f.y);
    const N = this.game.nurse;
    if (N && N.rig.root.visible) {
      const nx = N.pos.x - e.x, nz = N.pos.z - e.z, tt = (nx * f.x + nz * f.z) / h2;
      const ox = nx - tt * f.x, oz = nz - tt * f.z, y = e.y + tt * f.y;
      if (tt > 0 && ox * ox + oz * oz < 0.09 && y > 0 && y < 1.95) aim = Math.min(aim, tt - 0.12);
    }
    aim = THREE.MathUtils.clamp(aim, 0.6, 8);
    this.aimD = dt > 0 ? this.aimD + (aim - this.aimD) * Math.min(1, dt * 9) : aim;
    this.lightTarget.position.set(0, 0, -this.aimD);
    this.light.getWorldPosition(this.torch.pos);
    this.torch.dir.copy(this.lightTarget.getWorldPosition(new THREE.Vector3())).sub(this.torch.pos).normalize();
    // torch sway
    const tm = this.torchModel;
    const crank = this.torch.cranking ? Math.sin(this.game.time * 30) * 0.006 : 0;
    tm.position.set(0.3 + bx * 0.4, -0.29 + by * 0.5 + crank, -0.5);
    tm.visible = false;
  }
}

export { T };
