import type { Game } from './game';
import { T } from './level';
import { PATROL } from './content';

// #debug overlay: minimap, Nurse state, vision cone, noise rings, menace gauge.
// Keys: 1-5 teleport, G ghost (she can't sense you), N freeze her, M toggle map.
export class Debug {
  cv = document.createElement('canvas');
  g = this.cv.getContext('2d')!;
  show = true;
  constructor(private game: Game) {
    const s = 7;
    this.cv.width = game.level.w * s; this.cv.height = game.level.h * s + 60;
    this.cv.id = 'debug-map';
    document.body.appendChild(this.cv);
    const spots: Record<string, [number, number]> = { Digit1: [16, 22], Digit2: [16, 11], Digit3: [7, 11], Digit4: [5, 18], Digit5: [25, 20] };
    window.addEventListener('keydown', e => {
      const P = game.player;
      if (spots[e.code]) { const c = game.level.center(...spots[e.code]); P.pos.x = c.x; P.pos.z = c.z; }
      if (e.code === 'KeyG') { P.ghost = !P.ghost; game.ui.toast(P.ghost ? 'Fantasma activado' : 'Fantasma desactivado'); }
      if (e.code === 'KeyN') { game.nurse.state = game.nurse.state === 'frozen' ? 'patrol' : 'frozen'; }
      if (e.code === 'KeyM') { this.show = !this.show; this.cv.hidden = !this.show; }
    });
  }

  // Can every key spot be reached from the start? Used by the QA pass.
  reachability() {
    const L = this.game.level;
    const start = L.start;
    const targets: Record<string, { x: number; z: number }> = {
      panel: this.game.props.panel.stand, fuse: this.game.props.fuse.stand,
      ...Object.fromEntries(this.game.props.lockers.map(l => [l.id, { x: l.front.x, z: l.front.z }])),
      ...Object.fromEntries(this.game.props.notes.map(n => [n.def.id, { x: n.stand.x, z: n.stand.z }])),
      ...Object.fromEntries(PATROL.map((p, i) => [`patrol${i}`, L.center(p[0], p[1])])),
    };
    const res: Record<string, boolean> = {};
    for (const [k, t] of Object.entries(targets)) res[k] = !!L.path(start.x, start.z, t.x, t.z);
    return res;
  }

  update(dt: number) {
    const G = this.game, L = G.level, g = this.g, s = 7, N = G.nurse, P = G.player;
    G.debugNoises.forEach(n => (n.t -= dt));
    G.debugNoises = G.debugNoises.filter(n => n.t > 0);
    if (!this.show) return;
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    for (const c of L.cells) {
      g.fillStyle = c.kind === 'wall' ? '#111' : c.kind === 'door' ? (c.door!.barred ? '#844' : c.door!.open ? '#575' : '#a85') : c.kind === 'furn' ? '#334' : '#2a2c28';
      g.fillRect(c.cx * s, c.cz * s, s - 0.5, s - 0.5);
    }
    const W = (v: number) => (v / T) * s;
    for (const n of G.debugNoises) { g.strokeStyle = `rgba(255,200,80,${n.t})`; g.beginPath(); g.arc(W(n.x), W(n.z), W(n.r), 0, 7); g.stroke(); }
    for (const l of G.props.lockers) { g.fillStyle = '#69a'; g.fillRect(W(l.front.x) - 2, W(l.front.z) - 2, 4, 4); }
    // path
    g.strokeStyle = '#c55'; g.beginPath(); g.moveTo(W(N.pos.x), W(N.pos.z));
    for (let i = N.pi; i < N.path.length; i++) g.lineTo(W(N.path[i].x), W(N.path[i].z));
    g.stroke();
    // vision cone
    g.fillStyle = N.canSee ? 'rgba(255,60,40,0.35)' : 'rgba(255,255,255,0.12)';
    g.beginPath(); g.moveTo(W(N.pos.x), W(N.pos.z));
    g.arc(W(N.pos.x), W(N.pos.z), W(10), Math.atan2(Math.cos(N.yaw), Math.sin(N.yaw)) - 1.05, Math.atan2(Math.cos(N.yaw), Math.sin(N.yaw)) + 1.05);
    g.fill();
    g.fillStyle = '#f44'; g.beginPath(); g.arc(W(N.pos.x), W(N.pos.z), 3, 0, 7); g.fill();
    g.fillStyle = P.ghost ? '#888' : '#4cf'; g.beginPath(); g.arc(W(P.pos.x), W(P.pos.z), 3, 0, 7); g.fill();
    g.strokeStyle = '#4cf'; g.beginPath(); g.moveTo(W(P.pos.x), W(P.pos.z)); g.lineTo(W(P.pos.x - Math.sin(P.yaw) * 2), W(P.pos.z - Math.cos(P.yaw) * 2)); g.stroke();
    const y0 = L.h * s + 4;
    g.fillStyle = '#ddd'; g.font = '11px monospace';
    g.fillText(`${N.state}${N.state === 'inspect' ? ':' + N.insp : ''}  aware ${N.awareness.toFixed(2)}  d ${N.dist.toFixed(1)}  lures ${N.lures} hides ${N.lockerHides}`, 4, y0 + 10);
    g.fillText(`menace ${G.director.menace.toFixed(0)}  hint ${G.director.hintT.toFixed(0)}s  phase ${G.director.phase}  vis ${P.visibility().toFixed(2)}  dark ${P.darkT.toFixed(0)}`, 4, y0 + 24);
    g.fillStyle = '#522'; g.fillRect(4, y0 + 32, 200, 8); g.fillStyle = '#e44'; g.fillRect(4, y0 + 32, G.director.menace * 2, 8);
    g.fillStyle = '#aaa'; g.fillText(`${Math.round(1000 / Math.max(1, 16))}`, 0, 0);
  }
}
