// The storm over the blacked-out city: lightning through the windows (a few return strokes, a bolt
// drawn into the sky), cold light thrown into the nearest rooms, thunder after the right delay,
// and rain that gets louder as you near the glass. Thunder briefly masks your own noise.
import * as THREE from 'three';
import type { Game } from './game';
import { StormSky } from './decor';

interface Stroke { s: number; d: number; a: number }

export class Storm {
  sky = new StormSky();
  flash = 0;               // 0..1 right now
  masking = 0;             // >0 while thunder rolls: your footsteps and cranking carry less
  private strokes: Stroke[] = [];
  private st = -1;         // time since the current strike began (-1 = idle)
  private power = 1;
  private next = 14;
  private lights: THREE.PointLight[] = [];
  private drawn = -1;
  private hemi: THREE.HemisphereLight | null = null;
  private hemiBase = 0.32;
  private v = new THREE.Vector3();
  onFlash: ((k: number) => void) | null = null;
  moonK = 1;               // the title dims the moonlit spill while the torch is dead
  auto = true;             // random strikes (the title schedules its own)
  external = false;        // a scene outside holds the lights: only the strike's envelope is worked out here
  lightsList() { return this.lights; }

  constructor(private G: Game) {
    const glass = G.props.windowGlass;
    glass.map = this.sky.tex; glass.emissiveMap = this.sky.tex; glass.emissive.setHex(0x8090a8); glass.emissiveIntensity = 0.35; glass.needsUpdate = true;
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xc4d2ff, 0, 15, 1.5); l.position.set(0, -50, 0); G.scene.add(l); this.lights.push(l); }
    this.hemi = G.scene.children.find(c => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight ?? null;
    if (this.hemi) this.hemiBase = this.hemi.intensity;
  }

  // Lightning now (or in a moment). power 0..1: how close the strike is.
  strike(power = 0.5 + Math.random() * 0.5, delay = 0) {
    if (this.st >= 0 && this.st < 0.8) return;
    this.power = power;
    const n = 2 + Math.floor(Math.random() * 3);
    this.strokes = []; let s = delay;
    for (let i = 0; i < n; i++) { const a = i === 0 ? 1 : 0.35 + Math.random() * 0.65; this.strokes.push({ s, d: 0.08 + Math.random() * 0.1, a }); s += 0.1 + Math.random() * 0.18; }
    this.strokes.push({ s, d: 0.7, a: 0.3 }); // the afterglow
    this.st = 0;
    const near = power;
    this.G.audio.thunder(near, delay + 0.25 + (1 - near) * 2.6 + Math.random() * 0.4);
    this.masking = 0;
    setTimeout(() => {
      this.masking = 3.5;
      const G = this.G;
      if (G.mode === 'play' && near > 0.82) G.player.flinch(0.45); // a crack right overhead makes you jump
      if (G.mode === 'play' && G.story.flags.sighting && !G.story.flags.thunderTip) { G.story.flags.thunderTip = true; G.subtitle('Truena. Por un momento, nadie oye tus pasos.'); }
    }, (delay + 0.25 + (1 - near) * 2.6) * 1000);
  }

  private nearestWindows() {
    const P = this.G.player, ws = this.G.props.windows;
    return ws.map(w => ({ w, d: Math.hypot(w.x - P.pos.x, w.z - P.pos.z) })).sort((a, b) => a.d - b.d);
  }

  update(dt: number, title = false) {
    const G = this.G;
    this.next -= dt;
    if (this.next <= 0) { if (this.auto) this.strike(); this.next = title ? 7 + Math.random() * 8 : 24 + Math.random() * 40; }
    if (this.masking > 0) this.masking -= dt;
    // the strobe envelope
    let f = 0;
    if (this.st >= 0) {
      this.st += dt;
      for (const k of this.strokes) if (this.st >= k.s && this.st <= k.s + k.d) f = Math.max(f, k.a * Math.pow(1 - (this.st - k.s) / k.d, 0.6));
      const last = this.strokes[this.strokes.length - 1];
      if (this.st > last.s + last.d) this.st = -1;
    }
    if (G.settings.reduced) f *= 0.45; // no hard strobing for photosensitive players
    this.flash = f;
    if (this.external) { this.onFlash?.(f); return; }
    // redraw the sky only at the edges of a strike: bolt in, bolt out
    const want = f > 0.5 ? 2 : f > 0.02 ? 1 : 0;
    if (want !== this.drawn) { this.drawn = want; this.sky.draw(want === 2 ? 1 : want === 1 ? 0.45 : 0, want === 2); }
    else this.sky.tick(dt);
    G.props.windowGlass.emissiveIntensity = (title ? 0.9 : 0.35) + f * 5.5 * (0.5 + this.power * 0.5);
    for (const m of G.props.shafts) m.opacity = 0.16 + f * 0.55;
    if (G.props.poolMat) G.props.poolMat.opacity = Math.min(1, 0.5 + f * 1.2);
    // cold light into the two nearest rooms with windows
    const near = this.nearestWindows();
    const moon = title ? 1.1 * this.moonK : 0; // on the title the windows also spill a little cold moonlight
    this.lights.forEach((l, i) => {
      const n = near[i];
      if (!n || n.d > 22 || (f <= 0.001 && !moon)) { l.intensity = 0; return; }
      l.position.set(n.w.x + n.w.nx * 1.3, 2.2, n.w.z + n.w.nz * 1.3);
      l.intensity = moon * (i === 0 ? 1 : 0.7) + f * (5 + this.power * 9) * (i === 0 ? 1 : 0.6);
    });
    // a little of it everywhere: eyes adjusting, light bounced through doorways
    const open = near.length ? Math.max(0, 1 - (near[0].d - 2) / 14) : 0;
    if (this.hemi) this.hemi.intensity = this.hemiBase + f * (0.1 + open * 0.5);
    G.post.u.uFlash.value = f * (title ? 1 : 0.15 + open * 0.6);
    G.audio.rain(1, open);
    this.onFlash?.(f);
    void this.v;
  }
}
