import type { Settings } from './settings';

export type Device = 'kbm' | 'pad' | 'touch';
export interface Act {
  mx: number; mz: number; lx: number; ly: number;
  sprint: boolean; crank: boolean; aim: boolean; breath: boolean; crouchHold: boolean;
  crouch: boolean; interact: boolean; torch: boolean; beam: number; throw: boolean; journal: boolean; pause: boolean; any: boolean;
}

const HELD = ['forward', 'back', 'left', 'right', 'sprint', 'crank', 'breath', 'aim'];

export class Input {
  device: Device = 'kbm';
  held = new Set<string>();
  edge = new Set<string>();
  mdx = 0; mdy = 0; wheel = 0;
  capture: ((code: string) => void) | null = null;
  onDevice: ((d: Device) => void) | null = null;
  private padPrev: boolean[] = [];
  private stickFullT = 0; private padLookT = 0; private smoothLook = { x: 0, y: 0 };
  private tMove = { x: 0, y: 0 }; private tLook = { x: 0, y: 0 };
  private stickId = -1; private lookId = -1; private stickOrigin = { x: 0, y: 0 }; private lookLast = { x: 0, y: 0 };
  enabled = true;
  freeLook = false; private cur = { x: 0.5, y: 0.5, in: false };
  private lookDown = { x: 0, y: 0, t: 0, moved: 0 }; private stickBase: HTMLElement | null = null;

  constructor(private settings: Settings, private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', e => this.key(e, true));
    window.addEventListener('keyup', e => this.key(e, false));
    window.addEventListener('mousemove', e => {
      // drop the occasional bogus jump some browsers report right after locking
      const locked = document.pointerLockElement === this.canvas;
      if ((locked || this.freeLook) && Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) { this.mdx += e.movementX; this.mdy += e.movementY; this.setDevice('kbm'); }
      if (!locked) { this.cur.x = e.clientX / innerWidth; this.cur.y = e.clientY / innerHeight; this.cur.in = true; }
    });
    canvas.addEventListener('mousedown', e => {
      this.setDevice('kbm');
      if (e.button === 0) this.edge.add('throw');
      if (e.button === 2) this.held.add('aim');
    });
    window.addEventListener('mouseup', e => { if (e.button === 2) this.held.delete('aim'); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('blur', () => { this.held.clear(); this.cur.in = false; });
    document.addEventListener('mouseout', e => { if (!e.relatedTarget) this.cur.in = false; });
    this.touchSetup();
  }

  private setDevice(d: Device) {
    if (d !== this.device) { this.device = d; this.onDevice?.(d); }
  }

  private key(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
    if (this.capture && down) { e.preventDefault(); const c = this.capture; this.capture = null; c(e.code); return; }
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (down) this.setDevice('kbm');
    if (e.code === 'Escape' || e.code === 'KeyP') { if (down && !e.repeat) this.edge.add('pause'); return; }
    const k = this.settings.keys;
    for (const a in k) {
      if (k[a] !== e.code) continue;
      if (HELD.includes(a)) { if (down) this.held.add(a); else this.held.delete(a); }
      else if (down && !e.repeat) this.edge.add(a);
      // crouch: a tap toggles, holding it is momentary (the player decides on release)
      if (a === 'crouch') { if (down) this.held.add('crouchHold'); else this.held.delete('crouchHold'); }
    }
    if (down && !e.repeat) this.edge.add('any');
  }

  private touchSetup() {
    const root = document.getElementById('touch');
    if (!root) return;
    const stick = root.querySelector('.stick-zone') as HTMLElement, look = root.querySelector('.look-zone') as HTMLElement;
    const knob = root.querySelector('.knob') as HTMLElement, base = root.querySelector('.base') as HTMLElement;
    const show = (x: number, y: number) => { base.style.transform = `translate(${x}px, ${y}px)`; base.hidden = false; stick.classList.add('active'); };
    this.stickBase = base;
    const tick = () => { if (this.settings.rumble && navigator.vibrate) try { navigator.vibrate(8); } catch { /* not allowed */ } };
    window.addEventListener('touchstart', () => this.setDevice('touch'), { passive: true });
    stick.addEventListener('pointerdown', e => {
      this.stickId = e.pointerId; this.stickOrigin = { x: e.clientX, y: e.clientY };
      show(e.clientX - 55, e.clientY - 55); knob.style.transform = 'translate(0px,0px)';
      stick.setPointerCapture(e.pointerId); this.edge.add('any');
    });
    stick.addEventListener('pointermove', e => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.stickOrigin.x, dy = e.clientY - this.stickOrigin.y;
      const d = Math.hypot(dx, dy), m = 46;
      if (d > m) { dx = (dx / d) * m; dy = (dy / d) * m; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.tMove = { x: dx / m, y: dy / m };
    });
    const endStick = (e: PointerEvent) => { if (e.pointerId !== this.stickId) return; this.stickId = -1; this.tMove = { x: 0, y: 0 }; base.hidden = true; base.classList.remove('sprint'); stick.classList.remove('active'); };
    stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
    look.addEventListener('pointerdown', e => { this.lookId = e.pointerId; this.lookLast = { x: e.clientX, y: e.clientY }; this.lookDown = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; look.setPointerCapture(e.pointerId); this.edge.add('any'); });
    look.addEventListener('pointermove', e => {
      if (e.pointerId !== this.lookId) return;
      this.tLook.x += e.clientX - this.lookLast.x; this.tLook.y += e.clientY - this.lookLast.y;
      this.lookDown.moved += Math.abs(e.clientX - this.lookLast.x) + Math.abs(e.clientY - this.lookLast.y);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    // a quick tap near the crosshair uses whatever it is on (the prompt sits right there)
    const endLook = (e: PointerEvent) => {
      if (e.pointerId !== this.lookId) return;
      this.lookId = -1;
      const d = this.lookDown, near = Math.hypot(e.clientX - innerWidth / 2, e.clientY - innerHeight / 2) < Math.min(150, innerHeight * 0.3);
      if (e.type === 'pointerup' && near && d.moved < 12 && performance.now() - d.t < 260) { this.edge.add('interact'); tick(); }
    };
    look.addEventListener('pointerup', endLook); look.addEventListener('pointercancel', endLook);
    root.querySelectorAll<HTMLElement>('[data-act]').forEach(btn => {
      const act = btn.dataset.act!, hold = btn.dataset.mode === 'hold';
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); btn.setPointerCapture(e.pointerId); btn.classList.add('on'); tick();
        if (act === 'beam') this.wheel += 1;
        else if (act === 'throwhold') this.held.add('aim');
        else if (hold) this.held.add(act); else this.edge.add(act);
        if (act === 'crouch') this.held.add('crouchHold');
        if (act === 'sprint-toggle') { this.edge.delete(act); if (this.held.has('sprint')) this.held.delete('sprint'); else this.held.add('sprint'); }
      });
      const up = () => {
        btn.classList.remove('on');
        if (act === 'throwhold') { this.held.delete('aim'); this.edge.add('throw'); }
        else if (hold) this.held.delete(act);
        if (act === 'crouch') this.held.delete('crouchHold');
      };
      btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
    });
  }

  read(dt: number): Act {
    const s = this.settings;
    const a: Act = {
      mx: 0, mz: 0, lx: 0, ly: 0,
      sprint: this.held.has('sprint'), crank: this.held.has('crank'), aim: this.held.has('aim'), breath: this.held.has('breath'), crouchHold: this.held.has('crouchHold'),
      crouch: this.edge.has('crouch'), interact: this.edge.has('interact'), torch: this.edge.has('torch'),
      beam: Math.sign(this.wheel) + (this.edge.has('beam') ? 1 : 0), throw: this.edge.has('throw'), journal: this.edge.has('journal'),
      pause: this.edge.has('pause'), any: this.edge.has('any') || this.edge.has('interact') || this.edge.has('throw'),
    };
    if (this.held.has('forward')) a.mz += 1;
    if (this.held.has('back')) a.mz -= 1;
    if (this.held.has('left')) a.mx -= 1;
    if (this.held.has('right')) a.mx += 1;
    const inv = s.invertY ? -1 : 1;
    a.lx += this.mdx * 0.0022 * s.sens; a.ly += this.mdy * 0.0022 * s.sens * inv;
    // free-cursor fallback: resting the cursor near an edge keeps turning
    if (this.freeLook && this.cur.in && this.device === 'kbm' && !document.pointerLockElement) {
      const edge = (v: number) => (v < 0.07 ? -(0.07 - v) / 0.07 : v > 0.93 ? (v - 0.93) / 0.07 : 0);
      a.lx += edge(this.cur.x) * 2.4 * dt * s.sens; a.ly += edge(this.cur.y) * 1.3 * dt * s.sens * inv;
    }

    // touch: a full push on the stick breaks into a run; fast swipes turn further
    a.mx += this.tMove.x; a.mz -= this.tMove.y;
    const tm = Math.hypot(this.tMove.x, this.tMove.y);
    this.stickFullT = tm > 0.93 && this.tMove.y < 0 ? this.stickFullT + dt : 0;
    if (this.stickFullT > 0.35) a.sprint = true;
    this.stickBase?.classList.toggle('sprint', this.stickFullT > 0.35);
    const sw = Math.hypot(this.tLook.x, this.tLook.y), acc = 1 + Math.min(1.2, sw / 45);
    const tx = this.tLook.x * 0.0052 * s.sens * acc, ty = this.tLook.y * 0.0052 * s.sens * acc * inv;
    this.smoothLook.x += (tx - this.smoothLook.x) * 0.6; this.smoothLook.y += (ty - this.smoothLook.y) * 0.6;
    if (this.device === 'touch') { a.lx += this.smoothLook.x; a.ly += this.smoothLook.y; }

    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || p.mapping !== 'standard') continue;
      // radial dead zone: no snapping to the axes when you ease the stick round a corner
      const radial = (x: number, y: number) => { const m = Math.hypot(x, y); if (m < 0.16) return [0, 0]; const k = Math.min(1, (m - 0.16) / 0.8) / m; return [x * k, y * k]; };
      const [ax, ay] = radial(p.axes[0] ?? 0, p.axes[1] ?? 0), [rx, ry] = radial(p.axes[2] ?? 0, p.axes[3] ?? 0);
      const b = p.buttons.map(x => x.pressed || x.value > 0.4);
      if (ax || ay || rx || ry || b.some(Boolean)) this.setDevice('pad');
      a.mx += ax; a.mz -= ay;
      const curve = (v: number) => Math.sign(v) * v * v;
      // holding the stick at full tilt ramps the turn speed up a little
      this.padLookT = Math.abs(rx) > 0.85 ? this.padLookT + dt : 0;
      const ramp = 1 + Math.min(0.6, Math.max(0, this.padLookT - 0.25) * 1.5);
      a.lx += curve(rx) * 2.6 * ramp * dt * s.sens; a.ly += curve(ry) * 1.9 * dt * s.sens * inv;
      const was = (i: number) => this.padPrev[i];
      const pressed = (i: number) => b[i] && !was(i);
      if (pressed(0)) a.interact = true;
      if (pressed(1)) a.crouch = true;
      if (b[1]) a.crouchHold = true;
      if (b[2]) a.crank = true;
      if (pressed(3)) a.torch = true;
      if (b[5]) a.breath = true;
      if (b[6]) a.aim = true;
      if (pressed(7)) a.throw = true;
      if (pressed(8)) a.journal = true;
      if (pressed(9)) a.pause = true;
      if (b[10]) a.sprint = true;
      if (pressed(12)) a.beam += 1;
      if (pressed(13)) a.beam -= 1;
      if (b.some((x, i) => x && !was(i))) a.any = true;
      this.padPrev = b;
      break;
    }
    const m = Math.hypot(a.mx, a.mz);
    if (m > 1) { a.mx /= m; a.mz /= m; }
    if (!this.enabled) { a.mx = a.mz = 0; }
    return a;
  }

  endFrame() { this.edge.clear(); this.mdx = this.mdy = 0; this.wheel = 0; this.tLook = { x: 0, y: 0 }; }

  rumble(strong: number, weak: number, ms: number) {
    if (!this.settings.rumble) return;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) (p as any)?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
      if (this.device === 'touch' && navigator.vibrate) navigator.vibrate(Math.min(ms, 200));
    } catch { /* not supported */ }
  }
}
