export interface Settings {
  sens: number; invertY: boolean; fov: number; bright: number; subs: boolean;
  master: number; music: number; sfx: number; reduced: boolean; rumble: boolean;
  quality: 'low' | 'medium' | 'high'; calibrated: boolean;
  touchSize: 'sm' | 'md' | 'lg'; lefty: boolean;
  keys: Record<string, string>;
}

export const KEY_LABELS: Record<string, string> = {
  forward: 'Avanzar', back: 'Retroceder', left: 'Paso a la izquierda', right: 'Paso a la derecha',
  sprint: 'Correr', crouch: 'Agacharse', interact: 'Usar / esconderse', torch: 'Linterna', beam: 'Ancho del haz',
  crank: 'Manivela', breath: 'Aguantar la respiración', journal: 'Diario',
};

export const DEFAULT_KEYS: Record<string, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft', crouch: 'KeyC',
  interact: 'KeyE', torch: 'KeyF', beam: 'KeyQ', crank: 'KeyR', breath: 'Space', journal: 'Tab',
};

const DEFAULTS: Settings = {
  sens: 1, invertY: false, fov: 72, bright: 1, subs: true, master: 0.9, music: 0.8, sfx: 1,
  reduced: false, rumble: true, quality: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'low' : 'medium', calibrated: false, touchSize: 'md', lefty: false, keys: { ...DEFAULT_KEYS },
};

const STORE = 'night-rounds:settings:v1';

export function loadSettings(): Settings {
  let s: Settings = { ...DEFAULTS, keys: { ...DEFAULT_KEYS } };
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) { const p = JSON.parse(raw); s = { ...s, ...p, keys: { ...DEFAULT_KEYS, ...(p.keys || {}) } }; }
  } catch { /* storage unavailable */ }
  return s;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function keyName(code: string) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { ShiftLeft: 'Shift', ShiftRight: 'Shift der.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl der.', Space: 'Espacio', Tab: 'Tab', AltLeft: 'Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'Bloq Mayús', Semicolon: 'Ñ' };
  return map[code] ?? code;
}
