import { T } from './telemetry';
import type { Game } from './game';
import type { Device } from './input';
import type { Note } from './props';
import { KEY_LABELS, DEFAULT_KEYS, keyName, saveSettings } from './settings';
import { RECORDS_TOTAL, AREAS, MAP } from './content';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Seeded 2D noise for the CSS: a speckle mask that wears the stencil type,
// and paper grain with foxing for the notes. Generated once, no image files.
function lcg(seed: number) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function gritURL() {
  const c = document.createElement('canvas'); c.width = 300; c.height = 150;
  const g = c.getContext('2d')!, R = lcg(7);
  g.fillStyle = '#000'; g.fillRect(0, 0, 300, 150);
  g.globalCompositeOperation = 'destination-out';
  // fine pitting everywhere, a few chips, and dry-brush drag marks across the letters
  for (let i = 0; i < 1500; i++) { g.globalAlpha = 0.15 + R() * 0.6; g.beginPath(); g.arc(R() * 300, R() * 150, R() < 0.985 ? 0.3 + R() * 0.7 : 1.1 + R() * 1.3, 0, 7); g.fill(); }
  g.strokeStyle = '#000';
  for (let i = 0; i < 22; i++) { g.globalAlpha = 0.12 + R() * 0.3; g.lineWidth = 0.5 + R() * 1.6; g.beginPath(); const x = R() * 300, y = R() * 150; g.moveTo(x, y); g.lineTo(x + 30 + R() * 80, y + (R() - 0.5) * 4); g.stroke(); }
  return c.toDataURL();
}
function paperURL() {
  const c = document.createElement('canvas'); c.width = 240; c.height = 240;
  const g = c.getContext('2d')!, R = lcg(11);
  for (let i = 0; i < 2400; i++) { g.fillStyle = `rgba(90,70,40,${R() * 0.09})`; g.fillRect(R() * 240, R() * 240, 1 + R() * 2, 1); }
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(110,90,60,${0.05 + R() * 0.07})`; g.lineWidth = 0.6; g.beginPath(); const x = R() * 240, y = R() * 240; g.moveTo(x, y); g.quadraticCurveTo(x + R() * 20 - 10, y + R() * 20 - 10, x + R() * 30 - 15, y + R() * 30 - 15); g.stroke(); }
  for (let i = 0; i < 9; i++) { const x = R() * 240, y = R() * 240, r = 3 + R() * 11; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(150,100,50,0.14)'); gr.addColorStop(1, 'rgba(150,100,50,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  return c.toDataURL();
}

export class UI {
  device: Device = 'kbm';
  private subs: { el: HTMLElement; t: number }[] = [];
  private toastT = 0; private areaT = 0; private objT = 0;
  private tutDef: { act: string; text: string } | null = null;
  private screen = '';
  settingsBack: () => void = () => { };
  tutorialHint = false;
  private quietFocus = false;

  constructor(private game: Game) {
    const G = game;
    try {
      const root = document.documentElement.style;
      root.setProperty('--grit', `url("${gritURL()}")`);
      root.setProperty('--paper-grain', `url("${paperURL()}")`);
    } catch { /* canvas unavailable: plain type */ }
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', e => { e.preventDefault(); fn(); });
    // menu sound: a tick moving between items (mouse, keys or pad), a switch on choosing; never for the
    // focus a screen puts on its first button by itself
    const item = (e: Event) => (e.target as HTMLElement | null)?.closest?.('.screen button, .screen select, .screen input[type=range], .screen input[type=checkbox]') ?? null;
    let hovered: Element | null = null;
    const tick = (e: Event) => {
      const b = item(e);
      if (!b || b === hovered || this.quietFocus || (e as PointerEvent).pointerType === 'touch') return;
      hovered = b; G.audio.hover();
      if (b.id === 'btn-start') G.titleHover(true);
    };
    document.addEventListener('pointerover', tick); document.addEventListener('focusin', tick);
    document.addEventListener('pointerout', e => { const b = item(e); if (b && b === hovered) { hovered = null; if (b.id === 'btn-start') G.titleHover(false); } });
    document.addEventListener('focusout', e => { if (item(e)?.id === 'btn-start') G.titleHover(false); });
    document.addEventListener('click', e => { const b = (e.target as HTMLElement | null)?.closest?.('.screen button'); if (b && !b.classList.contains('bind')) G.audio.select(); }, true);
    // who's doing the round tonight: asked only where the play log is kept (the hosted demo)
    const who = $('player-name') as HTMLInputElement;
    if (T.possible) {
      try { who.value = localStorage.getItem('night-rounds:name') ?? ''; } catch { /* private mode */ }
      $('tele-note').hidden = false;
      who.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ($('btn-start') as HTMLButtonElement).click(); } });
    } else $('who').hidden = true;
    on('btn-start', () => {
      const name = who.value.trim(); // optional: an empty name plays as «Anónimo»
      try { localStorage.setItem('night-rounds:name', name); } catch { /* private mode */ }
      who.blur(); G.start(name);
    });
    on('btn-settings', () => this.openSettings(() => this.show('title')));
    on('btn-controls', () => this.show('controls'));
    on('btn-controls-back', () => this.show('title'));
    on('btn-resume', () => G.resume());
    on('btn-pause-settings', () => this.openSettings(() => this.show('pause')));
    on('btn-pause-journal', () => this.openJournal('pause'));
    on('btn-pause-retry', () => G.retry());
    on('btn-pause-quit', () => G.quit());
    on('btn-retry', () => G.retry());
    on('btn-caught-quit', () => G.quit());
    on('btn-note-close', () => G.closeNote());
    on('btn-journal-close', () => G.closeJournal());
    on('btn-pause-map', () => G.openMap('pause'));
    on('btn-journal-map', () => G.openMap('journal'));
    on('btn-map-close', () => G.closeMap());
    on('btn-settings-back', () => { saveSettings(G.settings); G.applySettings(); this.settingsBack(); });
    on('btn-end-continue', () => G.continueAfterEnd());
    on('btn-end-restart', () => G.restartAll());
    on('btn-end-title', () => G.quit());
    on('btn-calibrate-done', () => { G.settings.calibrated = true; saveSettings(G.settings); G.afterCalibrate(); });
    $<HTMLInputElement>('cal-bright').addEventListener('input', e => { G.settings.bright = +(e.target as HTMLInputElement).value; this.calPreview(); G.applySettings(); });
    on('pause-touch', () => G.pause());
    on('journal-touch', () => G.openJournalFromPlay());
  }

  get current() { return this.screen; }
  show(id: string) {
    this.screen = id; document.body.dataset.screen = id;
    document.querySelectorAll<HTMLElement>('.screen').forEach(s => { s.hidden = s.id !== id; });
    const first = id ? $(id)?.querySelector<HTMLElement>('button, input, select') : null;
    if (first && this.device !== 'touch') setTimeout(() => { this.quietFocus = true; first.focus({ preventScroll: true }); this.quietFocus = false; }, 30);
  }
  hud(on: boolean) {
    $('hud').hidden = !on;
    $('touch').hidden = !(on && this.device === 'touch');
  }
  setDevice(d: Device) {
    this.device = d;
    document.body.dataset.device = d;
    if (!$('hud').hidden) $('touch').hidden = d !== 'touch';
    if (this.tutDef) this.tutorial('x', this.tutDef);
  }

  glyph(act: string) {
    const k = this.game.settings.keys;
    const kbm: Record<string, string> = {
      move: 'WASD · Mouse', torch: keyName(k.torch), beam: `Rueda · ${keyName(k.beam)}`, crank: `Mantén ${keyName(k.crank)}`, crouch: keyName(k.crouch),
      interact: keyName(k.interact), throw: 'Mantén clic der. · clic izq.', breath: `Mantén ${keyName(k.breath)}`, journal: keyName(k.journal), sprint: `Mantén ${keyName(k.sprint)}`, map: keyName(k.map),
    };
    const pad: Record<string, string> = {
      move: 'Stick izq. · stick der.', torch: 'Y', beam: 'Cruceta', crank: 'Mantén X', crouch: 'B', interact: 'A', throw: 'Mantén LT · RT', breath: 'Mantén RB', journal: 'View', sprint: 'Mantén L3', map: 'Cruceta →',
    };
    const touch: Record<string, string> = {
      move: 'Pulgar izquierdo · arrastra a la derecha', torch: 'LUZ', beam: 'HAZ', crank: 'Mantén MANIVELA', crouch: 'AGACHAR', interact: 'USAR', throw: 'Mantén LANZAR', breath: 'Mantén ALIENTO', journal: 'DIARIO', sprint: 'Mantén CORRER', map: 'DIARIO · Ver el plano',
    };
    return (this.device === 'pad' ? pad : this.device === 'touch' ? touch : kbm)[act] ?? act;
  }

  objective(text: string) {
    $('objective-text').textContent = text;
    $('objective').classList.add('fresh'); this.objT = 6;
    $('journal-objective').textContent = text;
  }
  tutorial(id: string, def: { act: string; text: string } | null) {
    this.tutDef = id ? def : null;
    const el = $('tutorial');
    if (!def || !id) { el.hidden = true; return; }
    $('tut-key').textContent = this.glyph(def.act);
    $('tut-text').textContent = def.text;
    el.hidden = false;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }
  marker(p: { x: number; z?: number; y: number } | null) {
    const el = $('marker');
    if (!p) { el.hidden = true; return; }
    el.hidden = false;
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  }
  interact(label: string | null) {
    const el = $('interact');
    $('crosshair').classList.toggle('on', !!label);
    if (!label) { el.hidden = true; return; }
    $('interact-key').textContent = this.glyph('interact');
    $('interact-text').textContent = label;
    el.hidden = false;
  }
  sub(text: string) {
    const box = $('subtitles');
    if (this.subs.length && this.subs[this.subs.length - 1].el.textContent === text) { this.subs[this.subs.length - 1].t = 3.6; return; }
    const el = document.createElement('p'); el.textContent = text; el.className = text.startsWith('«') ? 'say' : text.startsWith('[') ? 'sfx' : ''; box.appendChild(el);
    this.subs.push({ el, t: 3.6 });
    while (this.subs.length > 3) this.subs.shift()!.el.remove();
  }
  // a closer look: the line types itself out under the crosshair, then fades
  private th = { text: '', t: 0, dur: 0, shown: -1 };
  thought(text: string, secs?: number) {
    const el = $('thought');
    this.th = { text, t: 0, dur: secs ?? 2.4 + text.length * 0.052, shown: -1 };
    el.textContent = ''; el.hidden = false; el.style.opacity = '1';
  }
  thoughtActive() { return this.th.text !== '' && this.th.t < this.th.dur; }
  clearThought() { this.th.text = ''; $('thought').hidden = true; }
  private updateThought(dt: number) {
    const th = this.th; if (!th.text) return;
    th.t += dt;
    const n = Math.min(th.text.length, Math.floor(th.t * 52));
    const el = $('thought');
    if (n !== th.shown) { th.shown = n; el.textContent = th.text.slice(0, n); }
    const left = th.dur - th.t;
    el.style.opacity = String(Math.max(0, Math.min(1, left / 0.6)));
    if (left <= 0) this.clearThought();
  }
  // ---- stealth feedback: a ring for every noise you make (red if she was close enough to hear it), and an eye
  // that opens as she starts to notice you
  private nz = { k: 0, r: 0, heard: false }; private aw = 0;
  noiseEvent(r: number, loud: number, x: number, z: number) {
    const N = this.game.nurse;
    const heard = N.rig.root.visible && Math.hypot(N.pos.x - x, N.pos.z - z) < r;
    const k = Math.min(1, loud * loud * 1.1); // a walk is a faint pulse, a sprint or the crank a hard ring
    if (k >= this.nz.k * 0.8 || heard) this.nz = { k, r: Math.max(r, this.nz.k > 0.3 ? this.nz.r : 0), heard: heard || (this.nz.heard && this.nz.k > 0.3) };
  }
  private updateStealth(dt: number) {
    const G = this.game, N = G.nurse, el = $('noise');
    this.nz.k = Math.max(0, this.nz.k - dt * 1.7);
    el.style.setProperty('--na', (this.nz.k * (G.settings.reduced ? 0.7 : 1)).toFixed(3));
    el.style.setProperty('--nr', `${Math.round(12 + Math.min(16, this.nz.r) * 3.4)}px`);
    el.classList.toggle('heard', this.nz.heard);
    const target = N.rig.root.visible && G.mode === 'play' ? (N.state === 'chase' ? 1 : Math.min(1, N.awareness)) : 0;
    this.aw += (target - this.aw) * Math.min(1, dt * 4);
    const eye = $('aware');
    eye.hidden = this.aw < 0.05;
    if (!eye.hidden) { eye.style.setProperty('--open', (0.12 + this.aw * 0.88).toFixed(3)); eye.style.setProperty('--ao', Math.min(1, this.aw * 2.2).toFixed(3)); eye.classList.toggle('alarm', N.state === 'chase' || this.aw > 0.95); }
  }
  toast(text: string, secs = 2.4) { const el = $('toast'); el.textContent = text; el.hidden = false; this.toastT = secs; }
  areaCard(name: string, sub: string) {
    $('area-name').textContent = name; $('area-sub').textContent = sub;
    const el = $('area-card'); el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    this.areaT = 3.6;
  }

  update(dt: number) {
    const G = this.game, P = G.player;
    for (let i = this.subs.length - 1; i >= 0; i--) { const s = this.subs[i]; s.t -= dt; s.el.style.opacity = String(Math.min(1, s.t)); if (s.t <= 0) { s.el.remove(); this.subs.splice(i, 1); } }
    this.updateThought(dt);
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').hidden = true; }
    if (this.areaT > 0) { this.areaT -= dt; if (this.areaT <= 0) $('area-card').hidden = true; }
    if (this.objT > 0) { this.objT -= dt; if (this.objT <= 0) $('objective').classList.remove('fresh'); }
    this.updateStealth(dt);
    const bat = P.torch.battery;
    $('battery-fill').style.width = `${bat}%`;
    $('battery').classList.toggle('low', bat < 15);
    $('battery').classList.toggle('warn', bat >= 15 && bat < 35);
    const pct = String(Math.ceil(bat)); if ($('battery-pct').textContent !== pct) $('battery-pct').textContent = pct;
    $('kit').classList.toggle('on', P.torch.on);
    $('beam').dataset.level = String(P.torch.level);
    $('bottles').dataset.count = String(P.bottles);
    $('fuse-chip').hidden = !P.hasFuse;
    const st = $('stamina');
    st.hidden = P.stamina > 0.985;
    if (!st.hidden) { $('stamina-fill').style.width = `${P.stamina * 100}%`; st.classList.toggle('spent', P.exhausted); }
    $('battery').classList.toggle('cranking', P.torch.cranking);
    const inL = !!P.inLocker && P.lockT >= 1;
    $('breath').hidden = !inL;
    if (inL) { $('breath-fill').style.width = `${P.breath.meter * 100}%`; $('breath').classList.toggle('held', P.breath.held); $('breath').classList.toggle('lock', P.breath.lock); }
    document.body.classList.toggle('in-locker', inL);
    $('lockhint').hidden = !(G.mode === 'play' && this.device === 'kbm' && !document.pointerLockElement && !G.input.freeLook);
    document.body.classList.toggle('has-bottles', P.bottles > 0);
    document.body.classList.toggle('low-batt', P.torch.battery < 35);
    document.body.classList.toggle('can-use', !$('interact').hidden);
  }

  calPreview() { $('cal-symbol').style.filter = `brightness(${this.game.settings.bright})`; ($('cal-bright') as HTMLInputElement).value = String(this.game.settings.bright); }

  openNote(n: Note) {
    const el = $('note');
    el.dataset.kind = n.def.kind;
    $('note-title').textContent = n.def.title;
    $('note-meta').textContent = n.def.record ? `Registro ${n.def.record} de ${RECORDS_TOTAL}` : n.def.kind === 'chart' ? 'Historia clínica' : n.def.kind === 'log' ? 'Bitácora' : 'Escrito a mano';
    $('note-body').textContent = n.def.body;
    $('note-close-key').textContent = this.device === 'pad' ? 'A' : this.device === 'touch' ? '' : 'E · Esc';
    this.show('note');
  }

  openJournal(back: string) {
    const G = this.game;
    const list = $('journal-notes');
    list.innerHTML = '';
    const read = G.props.notes.filter(n => n.read);
    if (!read.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Todavía nada. Aquí quedan las notas que leas.'; list.appendChild(p); }
    for (const n of read) {
      const b = document.createElement('button'); b.className = 'jn';
      b.innerHTML = `<span class="jn-title"></span><span class="jn-meta"></span>`;
      b.querySelector('.jn-title')!.textContent = n.def.title;
      b.querySelector('.jn-meta')!.textContent = n.def.record ? `Registro ${n.def.record}` : ({ log: 'Bitácora', chart: 'Historia', scrawl: 'Garabato', record: 'Registro' } as Record<string, string>)[n.def.kind];
      b.addEventListener('click', () => { G.journalBack = back; G.openNote(n, true); });
      list.appendChild(b);
    }
    $('journal-records').textContent = `Registros ${G.stats.records} / ${RECORDS_TOTAL} · Fusibles ${G.props.panel.installed} / 4`;
    G.journalBack = back;
    this.show('journal');
  }

  // ---- the evacuation plan: the whole floor is printed, faint; the rooms you've been in are inked in with
  // their names and hiding places; a red arrow for you and a dashed ring round where the objective points
  openMap() {
    const G = this.game, L = G.level, S = G.story, P = G.player, pr = G.props;
    const cv = $('map-canvas') as HTMLCanvasElement, g = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    let x0 = 99, x1 = 0, z0 = 99, z1 = 0;
    for (const c of L.cells) if (c.kind !== 'wall' || MAP[c.cz][c.cx] === '=' || MAP[c.cz][c.cx] === 'X') { x0 = Math.min(x0, c.cx); x1 = Math.max(x1, c.cx); z0 = Math.min(z0, c.cz); z1 = Math.max(z1, c.cz); }
    x0 -= 1; z0 -= 1; x1 += 1; z1 += 1;
    const cs = Math.floor(Math.min((W - 40) / (x1 - x0 + 1), (H - 40) / (z1 - z0 + 1)));
    const ox = Math.round((W - cs * (x1 - x0 + 1)) / 2) - x0 * cs, oz = Math.round((H - cs * (z1 - z0 + 1)) / 2) - z0 * cs;
    const px = (wx: number) => ox + (wx / 2) * cs, pz = (wz: number) => oz + (wz / 2) * cs;
    const areaOf = (cx: number, cz: number) => AREAS.find(a => cx >= a.x0 && cx <= a.x1 && cz >= a.z0 && cz <= a.z1);
    const seen = new Set<number>();
    for (const c of L.cells) {
      if (c.kind === 'wall') continue;
      const a = areaOf(c.cx, c.cz), k = c.cz * L.w + c.cx;
      if ((a && S.seenAreas.has(a.id)) || S.visited.has(k)) seen.add(k);
    }
    for (const k of [...S.visited]) { const cx = k % L.w, cz = Math.floor(k / L.w); for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const n = L.cell(cx + dx, cz + dz); if (n && n.kind !== 'wall') seen.add(n.cz * L.w + n.cx); } }
    const ink = (a: number) => `rgba(31, 36, 51, ${a})`;
    // unwalked floor: a faint photocopy hatch; walked: clean paper
    for (const c of L.cells) {
      if (c.kind === 'wall') continue;
      const X = ox + c.cx * cs, Z = oz + c.cz * cs;
      if (seen.has(c.cz * L.w + c.cx)) { g.fillStyle = 'rgba(255, 252, 240, 0.32)'; g.fillRect(X, Z, cs, cs); }
      else { g.strokeStyle = ink(0.14); g.lineWidth = 1; g.beginPath(); for (let i = -cs; i < cs; i += 4) { g.moveTo(X + Math.max(0, i), Z + Math.max(0, -i)); g.lineTo(X + Math.min(cs, i + cs), Z + Math.min(cs, cs - i)); } g.stroke(); }
    }
    // walls: an edge wherever floor meets wall, heavier where you've been
    g.lineCap = 'square';
    for (const c of L.cells) {
      if (c.kind === 'wall') continue;
      const X = ox + c.cx * cs, Z = oz + c.cz * cs, on = seen.has(c.cz * L.w + c.cx);
      g.strokeStyle = ink(on ? 0.92 : 0.3); g.lineWidth = on ? 3 : 1.5;
      for (const [dx, dz, ax, az, bx, bz] of [[0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 1], [-1, 0, 0, 0, 0, 1]]) {
        const n = L.cell(c.cx + dx, c.cz + dz); if (n && n.kind !== 'wall') continue;
        const ch = n ? MAP[n.cz][n.cx] : '#';
        if (ch === '=' || ch === 'X') { g.save(); g.strokeStyle = on ? 'rgba(179, 38, 30, 0.9)' : 'rgba(179, 38, 30, 0.4)'; g.setLineDash([4, 3]); }
        g.beginPath(); g.moveTo(X + ax * cs, Z + az * cs); g.lineTo(X + bx * cs, Z + bz * cs); g.stroke();
        if (ch === '=' || ch === 'X') g.restore();
      }
      if (c.kind === 'door' && on && c.door) { // the swing of the leaf
        const d = c.door, cx = X + cs / 2, cz = Z + cs / 2, r = cs * 0.42;
        g.strokeStyle = ink(0.55); g.lineWidth = 1; g.beginPath();
        if (d.axis === 'x') { g.moveTo(cx - r, cz); g.arc(cx - r, cz, r * 2 * 0.9, 0, -Math.PI / 2, true); } else { g.moveTo(cx, cz - r); g.arc(cx, cz - r, r * 2 * 0.9, Math.PI / 2, 0, true); }
        g.stroke();
        if (d.barred) { g.strokeStyle = 'rgba(179, 38, 30, 0.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 5, cz - 5); g.lineTo(cx + 5, cz + 5); g.moveTo(cx + 5, cz - 5); g.lineTo(cx - 5, cz + 5); g.stroke(); }
      }
    }
    // furniture where you've been
    for (const c of L.cells) {
      if (c.kind !== 'furn' || !seen.has(c.cz * L.w + c.cx)) continue;
      const X = ox + c.cx * cs, Z = oz + c.cz * cs, ch = MAP[c.cz][c.cx];
      g.strokeStyle = ink(0.6); g.lineWidth = 1; g.fillStyle = ink(0.08);
      if (ch === 'B') { g.fillRect(X + cs * 0.15, Z + cs * 0.25, cs * 0.7, cs * 0.5); g.strokeRect(X + cs * 0.15, Z + cs * 0.25, cs * 0.7, cs * 0.5); }
      else if (ch !== 'L') { g.fillRect(X + cs * 0.22, Z + cs * 0.22, cs * 0.56, cs * 0.56); g.strokeRect(X + cs * 0.22, Z + cs * 0.22, cs * 0.56, cs * 0.56); }
    }
    for (const lk of pr.lockers) {
      const c = L.at(lk.inside.x, lk.inside.z); if (!c || !seen.has(c.cz * L.w + c.cx)) continue;
      g.fillStyle = 'rgba(47, 111, 104, 0.85)'; const s2 = lk.kind === 'bed' ? cs * 0.22 : cs * 0.26;
      g.fillRect(px(lk.inside.x) - s2 / 2, pz(lk.inside.z) - s2 / 2, s2, s2);
    }
    // names of the rooms you've been in
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const a of AREAS) {
      if (!S.seenAreas.has(a.id)) continue;
      const cx = ox + ((a.x0 + a.x1 + 1) / 2) * cs, cz = oz + ((a.z0 + a.z1 + 1) / 2) * cs, wide = (a.x1 - a.x0 + 1) >= (a.z1 - a.z0 + 1);
      g.save(); g.translate(cx, cz); if (!wide) g.rotate(-Math.PI / 2);
      g.font = `700 ${Math.max(9, Math.round(cs * 0.42))}px 'Courier Prime', 'Courier New', monospace`; g.fillStyle = ink(0.85);
      g.fillText(a.name.toUpperCase(), 0, 0); g.restore();
    }
    // the objective
    const fuseHunt = !!S.flags.panelSeen && !pr.fuse.taken, toPanel = !S.flags.panelSeen || P.hasFuse;
    const ring = (x: number, z: number, r: number) => { g.save(); g.strokeStyle = 'rgba(179, 38, 30, 0.9)'; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.arc(px(x), pz(z), r, 0, Math.PI * 2); g.stroke(); g.restore(); };
    if (toPanel) ring(pr.panel.pos.x, pr.panel.pos.z, cs * 0.75);
    else if (fuseHunt) { const a = AREAS.find(r => r.id === 'ward')!; ring((a.x0 + a.x1 + 1), (a.z0 + a.z1 + 1), cs * 2.6); }
    // you
    const fx = P.fwd.x, fz = P.fwd.z, l = Math.hypot(fx, fz) || 1, ux = fx / l, uz = fz / l, X = px(P.pos.x), Z = pz(P.pos.z), r = Math.max(7, cs * 0.34);
    g.fillStyle = '#b3261e'; g.strokeStyle = 'rgba(255, 250, 240, 0.9)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(X + ux * r * 1.3, Z + uz * r * 1.3); g.lineTo(X - ux * r * 0.8 - uz * r * 0.8, Z - uz * r * 0.8 + ux * r * 0.8); g.lineTo(X - ux * r * 0.8 + uz * r * 0.8, Z - uz * r * 0.8 - ux * r * 0.8); g.closePath(); g.fill(); g.stroke();
    g.font = `700 11px 'Courier Prime', 'Courier New', monospace`; g.fillStyle = '#b3261e'; g.textAlign = 'left';
    g.fillText('USTED ESTÁ AQUÍ', X + r * 1.4, Z - r * 1.2);
    // north and a scale bar
    g.fillStyle = ink(0.8); g.textAlign = 'center'; g.font = `700 12px 'Courier Prime', monospace`;
    g.fillText('N', W - 24, 18); g.beginPath(); g.moveTo(W - 24, 26); g.lineTo(W - 29, 38); g.lineTo(W - 19, 38); g.closePath(); g.fill();
    g.fillRect(16, H - 14, cs * 2.5, 2); g.textAlign = 'left'; g.font = `400 10px 'Courier Prime', monospace`; g.fillText('5 m', 16 + cs * 2.5 + 6, H - 13);
    $('map-close-key').textContent = this.device === 'pad' ? 'B' : this.device === 'touch' ? '' : `${keyName(this.game.settings.keys.map)} · Esc`;
    this.show('map');
  }

  openSettings(back: () => void) {
    this.settingsBack = back;
    const s = this.game.settings, G = this.game;
    const form = $('settings-form');
    form.innerHTML = '';
    const row = (label: string, input: HTMLElement, hint = '') => {
      const r = document.createElement('label'); r.className = 'row';
      r.innerHTML = `<span class="lbl"></span>`; r.querySelector('.lbl')!.textContent = label;
      r.appendChild(input);
      if (hint) { const h = document.createElement('small'); h.textContent = hint; r.appendChild(h); }
      form.appendChild(r);
    };
    const range = (id: string, key: keyof typeof s, min: number, max: number, step: number) => {
      const i = document.createElement('input'); i.type = 'range'; i.id = `set-${id}`; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(s[key]);
      i.addEventListener('input', () => { (s as any)[key] = +i.value; G.applySettings(); });
      return i;
    };
    const check = (id: string, key: keyof typeof s) => {
      const i = document.createElement('input'); i.type = 'checkbox'; i.id = `set-${id}`; i.checked = !!s[key];
      i.addEventListener('change', () => { (s as any)[key] = i.checked; G.applySettings(); });
      return i;
    };
    const head = (t: string) => { const h = document.createElement('h3'); h.textContent = t; form.appendChild(h); };
    head('Comodidad');
    row('Sustos reducidos', check('reduced', 'reduced'), 'Sin sustos repentinos, alucinaciones, parpadeos ni primeros planos.');
    row('Subtítulos', check('subs', 'subs'), 'Incluyen de dónde viene cada sonido.');
    row('Brillo', range('bright', 'bright', 0.6, 1.8, 0.05));
    row('Vibración', check('rumble', 'rumble'));
    head('Controles');
    row('Sensibilidad de la vista', range('sens', 'sens', 0.3, 3, 0.05));
    row('Invertir la vista', check('invert', 'invertY'));
    row('Campo de visión', range('fov', 'fov', 60, 95, 1));
    if (this.device === 'touch') {
      head('Pantalla táctil');
      const ts = document.createElement('select'); ts.id = 'set-touchsize';
      for (const [v, t] of [['sm', 'Pequeños'], ['md', 'Medianos'], ['lg', 'Grandes']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; ts.appendChild(o); }
      ts.value = s.touchSize; ts.addEventListener('change', () => { s.touchSize = ts.value as any; G.applySettings(); });
      row('Tamaño de los botones', ts);
      row('Zurdo', check('lefty', 'lefty'), 'El joystick pasa a la derecha y los botones a la izquierda.');
    }
    head('Sonido');
    row('General', range('master', 'master', 0, 1, 0.05));
    row('Música', range('music', 'music', 0, 1, 0.05));
    row('Efectos', range('sfx', 'sfx', 0, 1, 0.05));
    head('Gráficos');
    const q = document.createElement('select'); q.id = 'set-quality';
    for (const [v, t] of [['low', 'Baja (360p)'], ['medium', 'Media (540p)'], ['high', 'Alta (720p)']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; q.appendChild(o); }
    q.value = s.quality; q.addEventListener('change', () => { s.quality = q.value as any; G.applySettings(); });
    row('Resolución', q);
    if (this.device !== 'touch') head('Teclado');
    if (this.device !== 'touch') for (const a in KEY_LABELS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'bind'; b.id = `bind-${a}`;
      b.textContent = keyName(s.keys[a]);
      b.addEventListener('click', e => {
        e.preventDefault(); b.textContent = 'Presiona una tecla…'; b.classList.add('wait');
        G.input.capture = code => {
          if (code !== 'Escape') { for (const o in s.keys) if (s.keys[o] === code) s.keys[o] = ''; s.keys[a] = code; }
          saveSettings(s); this.openSettings(back);
        };
      });
      row(KEY_LABELS[a], b);
    }
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'bind'; reset.textContent = 'Restablecer teclas';
    reset.addEventListener('click', e => { e.preventDefault(); s.keys = { ...DEFAULT_KEYS }; saveSettings(s); this.openSettings(back); });
    row('Predeterminadas', reset);
    this.show('settings');
  }

  intro(lines: string[], done: () => void) {
    const box = $('intro-lines');
    box.innerHTML = '';
    this.show('intro');
    let i = 0;
    const next = () => {
      if (i >= lines.length) { setTimeout(done, 900); return; }
      const p = document.createElement('p'); p.textContent = lines[i++]; box.appendChild(p);
      setTimeout(next, i === 1 ? 1300 : 1700);
    };
    next();
  }

  caught(line: string) { $('caught-line').textContent = line; this.show('caught'); }

  end() {
    const G = this.game, S = G.stats;
    const m = Math.floor(S.time / 60), s = Math.floor(S.time % 60);
    const rows: [string, string][] = [
      ['Tiempo', `${m}:${String(s).padStart(2, '0')}`], ['Veces atrapado', String(S.caught)], ['Botellas lanzadas', String(S.thrown)],
      ['Registros', `${S.records} / ${RECORDS_TOTAL}`], ['Notas leídas', String(S.notes)], ['Fusibles', `${G.props.panel.installed} / 4`],
    ];
    const dl = $('end-stats'); dl.innerHTML = '';
    for (const [k, v] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); }
    this.show('end');
  }
}
