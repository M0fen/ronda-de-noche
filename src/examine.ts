// Looking closely at things. Every examinable has staged lines (the last one repeats) and may run
// a behaviour; some things change while you are not looking at them.
import * as THREE from 'three';
import type { Game } from './game';

export interface ExamDef {
  id: string;
  pos: THREE.Vector3;
  label?: string | (() => string);
  range?: number;
  aim?: number;                  // how centred the crosshair must be (cosine), default 0.94
  los?: boolean;                 // require a clear line from the eye (default true)
  lines?: string[];
  sound?: string;                // foley: paper, cloth, metal, glass, wood, tap, none
  use?: (stage: number, ex: Examine) => void;
  enabled?: () => boolean;
}

interface Watch { id: string; pos: THREE.Vector3; t: number; need: number; fn: () => void }

export class Examine {
  stage = new Map<string, number>();
  private watches: Watch[] = [];
  private v = new THREE.Vector3();

  constructor(private game: Game) {}

  add(d: ExamDef) {
    this.game.story.items.push({
      id: 'ex_' + d.id, pos: d.pos, range: d.range ?? 1.9, aim: d.aim ?? 0.94, los: d.los ?? true,
      label: () => (typeof d.label === 'function' ? d.label() : d.label ?? 'Examinar'),
      enabled: d.enabled ?? (() => true),
      use: () => this.use(d),
    });
    return d;
  }

  use(d: ExamDef) {
    const s = this.stage.get(d.id) ?? 0;
    this.stage.set(d.id, s + 1);
    this.game.player.focusOn(d.pos, 1.35); // the eye goes to it for a moment
    if (d.lines?.length) this.say(d.lines[Math.min(s, d.lines.length - 1)]);
    if (d.sound !== 'none') this.game.audio.touch(d.sound ?? 'tap');
    d.use?.(s, this);
  }
  say(text: string, secs?: number) { this.game.ui.thought(text, secs); }
  seen(id: string) { return this.stage.get(id) ?? 0; }

  // Run `fn` once `pos` has been out of the player's sight for `need` seconds in a row.
  whenUnseen(id: string, pos: THREE.Vector3, need: number, fn: () => void) {
    this.watches = this.watches.filter(w => w.id !== id);
    this.watches.push({ id, pos, t: 0, need, fn });
  }
  pending(id: string) { return this.watches.some(w => w.id === id); }

  visible(pos: THREE.Vector3) {
    const G = this.game, P = G.player, v = this.v.copy(pos).sub(P.eye);
    const d = v.length();
    if (d > 26) return false;
    const fov = THREE.MathUtils.degToRad(G.camera.fov) * 0.5 * Math.max(1, G.camera.aspect) * 1.08;
    if (v.dot(P.fwd) / d < Math.cos(Math.min(1.45, fov))) return false;
    return !G.level.blocked(P.eye.x, P.eye.z, pos.x, pos.z);
  }

  update(dt: number) {
    for (let i = this.watches.length - 1; i >= 0; i--) {
      const w = this.watches[i];
      if (this.visible(w.pos)) { w.t = 0; continue; }
      w.t += dt;
      if (w.t >= w.need) { this.watches.splice(i, 1); w.fn(); }
    }
  }
}
