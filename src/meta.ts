// What the game knows about the person holding it, for the lines that talk past the character to them: their
// real clock and date, the name they gave (if any), their phone's battery (where the browser tells).
const started = new Date();
let battery: number | null = null;
try { (navigator as any).getBattery?.().then((b: any) => { const up = () => { battery = Math.round(b.level * 100); }; up(); b.addEventListener?.('levelchange', up); }).catch(() => {}); } catch { /* not offered */ }

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function spoken(d: Date) {
  const h = d.getHours(), m = d.getMinutes(), h12 = h % 12 || 12;
  const part = h < 5 ? 'de la madrugada' : h < 12 ? 'de la mañana' : h < 19 ? 'de la tarde' : 'de la noche';
  return `${h12 === 1 ? 'la' : 'las'} ${h12}:${String(m).padStart(2, '0')} ${part}`;
}

export const Meta = {
  /** «las 5:23 de la tarde» — now, where they are */
  clock: () => spoken(new Date()),
  /** when they walked in */
  startClock: () => spoken(started),
  late: () => { const h = new Date().getHours(); return h >= 22 || h < 5; },
  today: () => { const d = new Date(); return `${d.getDate()} de ${MONTHS[d.getMonth()]}`; },
  /** the name they typed at the start, or '' */
  name: () => { try { const n = (localStorage.getItem('night-rounds:name') ?? '').trim(); return /^an[oó]nimo$/i.test(n) ? '' : n.slice(0, 24); } catch { return ''; } },
  battery: () => battery,
  phone: () => document.body.dataset.device === 'touch',
};
