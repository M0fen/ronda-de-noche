// The way in (before the first part): the Parque Gaitán in the blackout, the bust of Gaitán with the hospital
// behind it, somebody with a candle in a window of the San Jorge for the length of a lightning flash, a walk along the
// Carrera 4, across it, and in through the glass doors. Then the doors slam behind you and the game starts.
import * as THREE from 'three';
import type { Game } from './game';
import { ShotCam } from './exterior';

const END = 21.8;
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
// the walk: where your feet are, and when
const WALK: [number, number, number][] = [[11.8, -6.6, 20], [13.6, -6.7, 14.6], [14.6, -6.75, 11.2], [15.8, -6.7, 6.4], [16.9, -6.6, 0.8], [17.9, -6.5, -4.7], [18.7, -6.5, -6.0]];

export class Intro {
  active = false; t = 0;
  private cam = new ShotCam();
  private fired = new Set<string>();
  private el: Record<string, HTMLElement> = {};
  private skipK = 0; private holding = false; private subT = 0; private locT = 0;
  private stepT = 0; private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3();
  done: (() => void) | null = null;

  constructor(private G: Game) {
    for (const id of ['cine', 'cine-sub', 'cine-skip', 'cine-loc']) this.el[id] = document.getElementById(id) as HTMLElement;
    const skip = this.el['cine-skip'];
    if (skip) {
      const on = (e: Event) => { if (!this.active) return; e.preventDefault(); this.holding = true; }, off = () => { this.holding = false; };
      skip.addEventListener('pointerdown', on); skip.addEventListener('pointerup', off); skip.addEventListener('pointerleave', off); skip.addEventListener('pointercancel', off);
    }
    window.addEventListener('keydown', e => { if (this.active && (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter')) { this.holding = true; e.preventDefault(); } });
    window.addEventListener('keyup', e => { if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') this.holding = false; });
  }

  start() {
    const G = this.G;
    this.active = true; this.t = 0; this.fired.clear(); this.skipK = 0; this.holding = false; this.stepT = 0;
    G.mode = 'cine'; G.ui.hud(false); G.ui.show('');
    document.body.classList.add('cine'); this.el.cine.hidden = false; this.sub(''); this.loc('');
    G.ext.enter('sj', true);
    G.storm.auto = false;
    const c = this.cam; c.tEye.copy(this.p(-5.6, 0.95, 18.0)); c.tLook.copy(this.p(-8.6, 8.8, -8)); c.tUp.set(0, 1, 0); c.tFov = G.settings.fov - 4; c.snap();
    G.post.u.uFade.value = 1;
    G.audio.finale(true);
  }

  private p(x: number, y: number, z: number) { return this.G.ext.at('sj', x, y, z, new THREE.Vector3()); }
  private at(id: string, time: number, fn: () => void) { if (this.t >= time && !this.fired.has(id)) { this.fired.add(id); fn(); } }
  private sub(text: string, secs = 3.6, kind = '') { const el = this.el['cine-sub']; if (!el) return; el.textContent = text; el.className = kind; this.subT = text ? secs : 0; el.style.opacity = text ? '1' : '0'; }
  private loc(html: string, secs = 4) { const el = this.el['cine-loc']; if (!el) return; if (html) el.innerHTML = html; el.classList.toggle('on', !!html); this.locT = html ? secs : 0; }

  update(dt: number) {
    if (!this.active) return;
    const G = this.G;
    if (this.holding && this.t > 0.8 && this.t < END - 1.5) { this.skipK += dt / 1.1; if (this.skipK >= 1) { this.skipK = 0; this.holding = false; this.finish(); return; } }
    else this.skipK = Math.max(0, this.skipK - dt * 2);
    this.el['cine-skip']?.style.setProperty('--p', this.skipK.toFixed(3));
    this.el['cine-skip']?.classList.toggle('show', this.t > 0.8 && this.t < END - 1.5);
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.el['cine-sub'].style.opacity = '0'; }
    if (this.locT > 0) { this.locT -= dt; if (this.locT <= 0) this.el['cine-loc'].classList.remove('on'); }
    this.t += dt;
    this.direct(dt, this.t);
    G.ext.update(dt, this.t);
    if (this.t >= END) this.finish();
  }

  private direct(dt: number, t: number) {
    const G = this.G, c = this.cam, A = G.audio, X = G.ext, u = G.post.u, red = G.settings.reduced, fov = G.settings.fov;
    const eye = (x: number, y: number, z: number, k = 4) => { X.at('sj', x, y, z, c.tEye); c.kEye = k; };
    const look = (x: number, y: number, z: number, k = 4) => { X.at('sj', x, y, z, c.tLook); c.kLook = k; };
    c.tUp.set(0, 1, 0); c.kUp = 4; c.hand = 0.35;
    // fade in, and out at the doors
    u.uFade.value = Math.max(1 - ss(0.2, 1.8, t), ss(20.0, 20.7, t));
    if (t < 6.2) {                                   // the park: the bust, and the hospital behind it
      const k = ss(0, 6.2, t);
      eye(mix(-5.6, -5.75, k), mix(0.95, 1.05, k), mix(18.0, 16.9, k), 2); look(-8.6, mix(8.8, 9.6, k), -8, 2);
      c.tFov = fov - 6; c.hand = 0.25;
      this.at('loc1', 1.0, () => this.loc('<b>Parque Gaitán</b><span>Pereira</span>', 4.2));
      this.at('strike1', 2.3, () => G.storm.strike(0.85));
      this.at('dogs', 4.6, () => A.bark(this.tmp.copy(this.p(-46, 1, 58)), 0.5));
    } else if (t < 11.8) {                           // along the Carrera 4, the hospital's front going by
      if (!this.fired.has('cut2')) { this.fired.add('cut2'); X.sjWindow.on = false; c.tEye.copy(this.p(-31, 1.65, 6.3)); c.tLook.copy(this.p(-25, 7.5, -8)); c.snap(); }
      const k = (t - 6.2) / 5.6;
      const x = mix(-31, -10, k);
      eye(x, 1.65, 6.3, 30); look(x + 6.5, 7.2 - 1.2 * k, -8, 30);
      c.tFov = fov - 2; c.hand = 0.3;
      this.at('loc2', 7.0, () => this.loc('<b>Hospital Universitario San Jorge</b><span>3:47 a. m.</span>', 4.2));
      this.at('strike2', 9.3, () => G.storm.strike(0.55));
    } else {                                          // on foot: past the bust, across the street, the doors
      if (!this.fired.has('cut3')) { this.fired.add('cut3'); const w = WALK[0]; c.tEye.copy(this.p(w[1], 1.62, w[2])); c.tLook.copy(this.p(w[1] - 0.3, 2.2, w[2] - 6)); c.snap(); }
      let i = 0; while (i < WALK.length - 2 && t > WALK[i + 1][0]) i++;
      const a = WALK[i], b = WALK[i + 1], k = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
      let x = mix(a[1], b[1], k), z = mix(a[2], b[2], k);
      let y = 1.62 + (z < 6.5 && z > -4.6 ? -0.15 : 0);
      const moving = t < WALK[WALK.length - 1][0];
      if (moving) y += 0.025 * Math.sin(t * 11.4) * (red ? 0.4 : 1);
      if (t > 19.4) { const kk = ss(19.4, 20.9, t); z = mix(-6.0, -8.3, kk); x = -6.5; }
      eye(x, y, z, 8);
      c.hand = 0.8;
      // where you look: the bust as you pass it, the doors ahead, the lobby's red lamp
      const bust = ss(12.6, 13.4, t) * (1 - ss(14.1, 14.9, t));
      const lx = mix(t < 17.6 ? x - 0.2 : -6.6, -8, bust), ly = mix(t < 17.6 ? 2.6 : 1.55, 3.55, bust), lz = mix(t < 17.6 ? z - 7 : -9.5, 12.4, bust);
      look(lx, ly, lz, 3);
      c.tFov = fov;
      if (moving) { this.stepT -= dt; if (this.stepT <= 0) { this.stepT = 0.52; A.step(this.tmp.set(c.eye.x, 0, c.eye.z), 0, 0.8, false, z < 6.5 && z > -4.6 ? '' : 'reception'); } }
      this.at('strike3', 13.45, () => G.storm.strike(0.6));
      this.at('line1', 12.2, () => this.sub('En el hospital, la luz se fue hace horas.', 3.8, 'think'));
      this.at('dog2', 15.4, () => A.bark(this.tmp.copy(this.p(30, 1, 44)), 0.7));
      this.at('line2', 18.0, () => this.sub('Alguien tiene que volver a prenderla.', 3.0, 'think'));
      this.at('door', 19.0, () => A.doorCreakAt(this.tmp.copy(this.p(-6.5, 1.2, -7.2))));
      X.sjDoor.rotation.y = 1.3 * ss(19.0, 20.3, t);
    }
    c.apply(G.camera, dt, t, red);
    // the player's ears and eyes go with the camera (sound, the torch's aim)
    const P = G.player; P.eye.copy(G.camera.position); G.camera.getWorldDirection(P.fwd);
    void this.tmp2;
  }

  /** out of the way: give the lights back and let the game begin */
  finish() {
    const G = this.G;
    if (!this.active) return;
    this.active = false;
    G.ext.leave();
    G.storm.auto = true;
    G.audio.finale(false);
    this.sub(''); this.loc(''); this.el['cine-skip']?.classList.remove('show');
    document.body.classList.remove('cine'); this.el.cine.hidden = true;
    G.camera.fov = G.settings.fov; G.camera.updateProjectionMatrix();
    G.post.u.uFade.value = 1;
    G.player.spawn(G.level.start.x, G.level.start.z, 0);
    this.done?.();
  }
}
