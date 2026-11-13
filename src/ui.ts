import { T } from './telemetry';
import type { Game } from './game';
import type { Device } from './input';
import type { Note } from './props';
import { KEY_LABELS, DEFAULT_KEYS, keyName, saveSettings } from './settings';
import { RECORDS_TOTAL } from './content';

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

  constructor(private game: Game) {
    const G = game;
    try {
      const root = document.documentElement.style;
      root.setProperty('--grit', `url("${gritURL()}")`);
      root.setProperty('--paper-grain', `url("${paperURL()}")`);
    } catch { /* canvas unavailable: plain type */ }
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', e => { e.preventDefault(); fn(); });
    // who's doing the round tonight: asked only where the play log is kept (the hosted demo)
    const who = $('player-name') as HTMLInputElement;
    if (T.possible) {
      try { who.value = localStorage.getItem('night-rounds:name') ?? ''; } catch { /* private mode */ }
      $('tele-note').hidden = false;
      who.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ($('btn-start') as HTMLButtonElement).click(); } });
    } else $('who').hidden = true;
    on('btn-start', () => {
      const name = who.value.trim();
      if (T.possible && !name) { who.focus(); $('who').classList.remove('shake'); void $('who').offsetWidth; $('who').classList.add('shake'); return; }
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
    this.screen = id;
    document.querySelectorAll<HTMLElement>('.screen').forEach(s => { s.hidden = s.id !== id; });
    const first = id ? $(id)?.querySelector<HTMLElement>('button, input, select') : null;
    if (first && this.device !== 'touch') setTimeout(() => first.focus({ preventScroll: true }), 30);
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
      interact: keyName(k.interact), throw: 'Mantén clic der. · clic izq.', breath: `Mantén ${keyName(k.breath)}`, journal: keyName(k.journal), sprint: `Mantén ${keyName(k.sprint)}`,
    };
    const pad: Record<string, string> = {
      move: 'Stick izq. · stick der.', torch: 'Y', beam: 'Cruceta', crank: 'Mantén X', crouch: 'B', interact: 'A', throw: 'Mantén LT · RT', breath: 'Mantén RB', journal: 'View', sprint: 'Mantén L3',
    };
    const touch: Record<string, string> = {
      move: 'Pulgar izquierdo · arrastra a la derecha', torch: 'LUZ', beam: 'HAZ', crank: 'Mantén MANIVELA', crouch: 'AGACHAR', interact: 'USAR', throw: 'Mantén LANZAR', breath: 'Mantén ALIENTO', journal: 'DIARIO', sprint: 'Mantén CORRER',
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
