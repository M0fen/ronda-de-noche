// Registro de rondas: every session of the hosted demo — who, when, how far, what they did — and a replay of
// one session on the hospital map (you in bone, her in red), with its events. Reads /api/report?k=KEY.
import { MAP } from './content';

const TILE = 2; // metres per map cell (as in level.ts)
const key = new URLSearchParams(location.search).get('k') ?? '';
const app = document.getElementById('app')!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const when = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

interface Session { id: string; name: string; started_at: string; last_at: string; device: any; progress: any; ended: boolean; events: number }
interface Ev { t: number; type: string; data: any }
type Pt = [number, number, number, number, number, number, string, string];

const LABEL: Record<string, (d: any) => [string, string?]> = {
  start: () => ['Empieza la partida'], play: () => ['Entra al hospital'], obj: d => [`Objetivo: ${d}`],
  note: d => [`Lee una nota (${d})`, 'good'], fuse: () => ['Toma el fusible', 'good'], end: () => ['Termina el tramo', 'good'],
  hide: d => [`Se esconde ${String(d).startsWith('bed') ? 'bajo una cama' : 'en un casillero'}`, 'hide'], unhide: () => ['Sale del escondite', 'hide'],
  inspect: d => [`Ella revisa ${String(d?.id).startsWith('bed') ? 'una cama' : 'un casillero'}${d?.you ? ' (justo donde está)' : ''}${d?.saw ? ', lo vio entrar' : ''}`, 'bad'],
  safe: () => ['No lo encuentra', 'good'], chase: () => ['Ella lo persigue', 'bad'], lost: () => ['Lo pierde', 'good'],
  caught: d => [`Lo atrapa${d?.hid ? ' en el escondite' : ''}`, 'bad'], retry: () => ['Vuelve a intentar'], bottle: () => ['Lanza una botella'],
  gasp: () => ['Se le acaba el aliento', 'bad'], pause: () => ['Pausa'], resume: () => ['Sigue'], hidden: () => ['Cambia de pestaña'], leave: () => ['Cierra la página'],
  map: () => ['Mira el plano'],
};

async function api(q = '') {
  const r = await fetch(`/api/report?k=${encodeURIComponent(key)}${q}`);
  if (!r.ok) {
    const msg = await r.json().then((j: any) => j?.error as string | undefined).catch(() => undefined);
    throw new Error(r.status === 403 ? 'Clave incorrecta: abre esta página con ?k=TU_CLAVE' : msg === 'no database' ? 'Falta conectar la base de datos (Vercel → Storage → Neon)' : msg ?? `Error ${r.status}`);
  }
  return r.json();
}

async function list() {
  if (!key) { app.innerHTML = '<p class="msg">Abre esta página con la clave: <code>/registro?k=TU_CLAVE</code></p>'; return; }
  let sessions: Session[];
  try { sessions = (await api()).sessions; } catch (e) { app.innerHTML = `<p class="msg">${esc((e as Error).message)}</p>`; return; }
  const players = new Set(sessions.map(s => s.name.toLowerCase()));
  const ended = sessions.filter(s => s.ended).length;
  const caught = sessions.reduce((a, s) => a + (s.progress?.caught ?? 0), 0);
  const times = sessions.map(s => s.progress?.time ?? 0).filter(t => t > 0);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  app.innerHTML = `
    <div class="tiles">
      <div class="tile"><b>${sessions.length}</b><span>Partidas</span></div>
      <div class="tile"><b>${players.size}</b><span>Jugadores</span></div>
      <div class="tile"><b>${ended}</b><span>Terminaron el tramo</span></div>
      <div class="tile"><b>${caught}</b><span>Veces atrapados</span></div>
      <div class="tile"><b>${mmss(avg)}</b><span>Tiempo medio jugado</span></div>
    </div>
    <div class="wrap"><table>
      <thead><tr><th>Jugador</th><th>Cuándo</th><th>Jugó</th><th>Hasta dónde llegó</th><th>Atrapado</th><th>Escondites</th><th>Notas</th><th>Equipo</th></tr></thead>
      <tbody>${sessions.map(s => `<tr data-id="${esc(s.id)}">
        <td class="who">${esc(s.name)}</td><td>${when(s.started_at)}</td><td class="num">${mmss(s.progress?.time ?? 0)}</td>
        <td class="obj">${s.ended ? '<span class="end">Terminó el tramo</span>' : esc(s.progress?.obj ?? 'En la portada')}</td>
        <td class="num">${s.progress?.caught ?? 0}</td><td class="num">${s.progress?.hides ?? 0}</td><td class="num">${s.progress?.notes ?? 0}</td>
        <td>${s.device?.device === 'touch' ? 'Celular' : 'Computador'} · ${s.device?.w ?? '?'}×${s.device?.h ?? '?'}</td></tr>`).join('') || '<tr><td colspan="8" class="msg">Todavía no ha jugado nadie.</td></tr>'}
      </tbody></table></div>
    <section class="detail" id="detail" hidden></section>`;
  app.querySelectorAll<HTMLTableRowElement>('tbody tr[data-id]').forEach(tr => tr.addEventListener('click', () => {
    app.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel')); tr.classList.add('sel'); show(tr.dataset.id!);
  }));
}

// ---- one session: the map replay and the event list ------------------------------------------------
let raf = 0;
async function show(id: string) {
  const box = document.getElementById('detail')!;
  box.hidden = false; box.innerHTML = '<p class="msg">Cargando la partida…</p>';
  cancelAnimationFrame(raf);
  const d: { session: Session; events: Ev[]; track: Pt[] } = await api(`&s=${encodeURIComponent(id)}`);
  const track = d.track.slice().sort((a, b) => a[0] - b[0]);
  const end = Math.max(track.at(-1)?.[0] ?? 0, d.events.at(-1)?.t ?? 0, 1);
  box.innerHTML = `
    <div class="card"><h2>Recorrido · ${esc(d.session.name)}</h2>
      <canvas id="map"></canvas>
      <div class="controls"><button id="play">Reproducir</button><input id="t" type="range" min="0" max="${end}" step="0.1" value="${end}"><output id="tt"></output></div>
      <div class="legend"><span><i style="background:var(--bone)"></i>Jugador</span><span><i style="background:var(--alarm)"></i>La Jefa</span><span><i style="background:var(--teal)"></i>Escondido</span><span><i style="background:var(--nicotine)"></i>Notas y fusible</span></div>
    </div>
    <div class="card"><h2>Lo que hizo</h2><ol class="events">${d.events.map(e => {
      const [txt, cls] = (LABEL[e.type] ?? (() => [e.type]))(e.data);
      return `<li data-t="${e.t}"><time>${mmss(e.t)}</time><span class="${cls ?? ''}">${esc(txt)}</span></li>`;
    }).join('')}</ol></div>`;
  const cv = document.getElementById('map') as HTMLCanvasElement, slider = document.getElementById('t') as HTMLInputElement, out = document.getElementById('tt')!;
  const S = 20, cols = Math.max(...MAP.map(r => r.length)), rows = MAP.length, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = cols * S * dpr; cv.height = rows * S * dpr;
  const g = cv.getContext('2d')!; g.scale(dpr, dpr);
  const W = (x: number) => (x / TILE) * S;
  const base = document.createElement('canvas'); base.width = cv.width; base.height = cv.height;
  const b = base.getContext('2d')!; b.scale(dpr, dpr);
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    const ch = MAP[z][x] ?? '#';
    b.fillStyle = ch === '#' ? '#141713' : '#0a0c0a'; b.fillRect(x * S, z * S, S, S);
    if (ch === 'D' || ch === 'd' || ch === 'X') { b.fillStyle = '#2a2e26'; b.fillRect(x * S + 3, z * S + 3, S - 6, S - 6); }
    else if (ch === 'B') { b.fillStyle = '#3a3d36'; b.fillRect(x * S + 4, z * S + 2, S - 8, S - 4); }
    else if (ch === 'L') { b.fillStyle = '#1f3a36'; b.fillRect(x * S + 5, z * S + 5, S - 10, S - 10); }
    else if (ch !== '.' && ch !== '#') { b.fillStyle = '#20231d'; b.fillRect(x * S + 6, z * S + 6, S - 12, S - 12); }
  }
  const marks = d.events.filter(e => ['caught', 'hide', 'note', 'fuse'].includes(e.type)).map(e => {
    const p = at(e.t); return { e, x: e.type === 'caught' && e.data?.x != null ? e.data.x : p?.[1], z: e.type === 'caught' && e.data?.z != null ? e.data.z : p?.[2] };
  });
  function at(t: number): Pt | null {
    if (!track.length) return null;
    let i = track.findIndex(p => p[0] > t); if (i === -1) return track.at(-1)!; if (i === 0) return track[0];
    const a = track[i - 1], c = track[i], k = (t - a[0]) / Math.max(0.001, c[0] - a[0]);
    return [t, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k, a[3], a[4] + (c[4] - a[4]) * k, a[5] + (c[5] - a[5]) * k, a[6], a[7]];
  }
  function draw(t: number) {
    g.clearRect(0, 0, cols * S, rows * S); g.drawImage(base, 0, 0, cols * S, rows * S);
    const upto = track.filter(p => p[0] <= t);
    const path = (ix: number, iz: number, col: string, w: number, alpha: number) => {
      if (upto.length < 2) return;
      g.strokeStyle = col; g.globalAlpha = alpha; g.lineWidth = w; g.lineJoin = 'round'; g.beginPath();
      upto.forEach((p, i) => { const x = W(p[ix] as number), z = W(p[iz] as number); if (i) g.lineTo(x, z); else g.moveTo(x, z); });
      g.stroke(); g.globalAlpha = 1;
    };
    path(4, 5, '#c4291f', 1.5, 0.55); path(1, 2, '#e6dfcf', 2, 0.85);
    for (const m of marks) {
      if (m.e.t > t || m.x == null) continue;
      const x = W(m.x), z = W(m.z);
      if (m.e.type === 'caught') { g.strokeStyle = '#ff4a3d'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x - 6, z - 6); g.lineTo(x + 6, z + 6); g.moveTo(x + 6, z - 6); g.lineTo(x - 6, z + 6); g.stroke(); }
      else if (m.e.type === 'hide') { g.strokeStyle = '#6fa39a'; g.lineWidth = 2; g.strokeRect(x - 5, z - 5, 10, 10); }
      else { g.fillStyle = '#c9b06a'; g.beginPath(); g.arc(x, z, 4, 0, Math.PI * 2); g.fill(); }
    }
    const p = at(t);
    if (p) {
      const nx = W(p[4]), nz = W(p[5]);
      g.fillStyle = '#c4291f'; g.beginPath(); g.arc(nx, nz, 5, 0, Math.PI * 2); g.fill();
      const x = W(p[1]), z = W(p[2]), hid = !!p[7];
      g.strokeStyle = g.fillStyle = hid ? '#6fa39a' : '#e6dfcf'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, z, 5.5, 0, Math.PI * 2); hid ? g.stroke() : g.fill();
      g.beginPath(); g.moveTo(x, z); g.lineTo(x - Math.sin(p[3]) * 13, z - Math.cos(p[3]) * 13); g.stroke();
    }
    out.textContent = `${mmss(t)} / ${mmss(end)}`;
  }
  slider.oninput = () => { playing = false; btn.textContent = 'Reproducir'; draw(+slider.value); };
  const btn = document.getElementById('play') as HTMLButtonElement;
  let playing = false, last = 0;
  const step = (now: number) => {
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    let t = +slider.value + dt * 4; // four times real speed
    if (t >= end) { t = end; playing = false; btn.textContent = 'Reproducir'; }
    slider.value = String(t); draw(t);
    raf = requestAnimationFrame(step);
  };
  btn.onclick = () => {
    playing = !playing; btn.textContent = playing ? 'Pausa' : 'Reproducir';
    if (playing) { if (+slider.value >= end) slider.value = '0'; last = performance.now(); raf = requestAnimationFrame(step); }
  };
  box.querySelectorAll<HTMLLIElement>('ol.events li').forEach(li => li.addEventListener('click', () => { playing = false; btn.textContent = 'Reproducir'; slider.value = li.dataset.t!; draw(+li.dataset.t!); }));
  draw(end);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

list();
