// Play log for the hosted demo: who played, how far they got, what they did and where they walked (and where
// she was). Batched to /api/track every few seconds and sent with sendBeacon on the way out. It stays off where
// there's no API beside the page (the claude.ai artifact, a file opened from disk).

type Ev = { t: number; type: string; data?: unknown };
const round = (v: number, k = 100) => Math.round(v * k) / k;

class Telemetry {
  id = ''; name = '';
  private t0 = 0; private q: Ev[] = []; private track: (number | string)[][] = []; private prog: Record<string, unknown> = {};
  private sampleT = 0; private flushT = 0; private failures = 0; private seq = 0; private busy = false;
  // on the hosted build only: http(s), not inside claude.ai
  readonly possible = /^https?:$/.test(location.protocol) && !/claude\.ai|claudeusercontent/.test(location.hostname) && (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /tele/.test(location.hash));
  get on() { return this.possible && !!this.id && this.failures < 4; }

  begin(name: string, info: Record<string, unknown>) {
    this.name = name.trim().slice(0, 40) || 'Anónimo';
    this.id = (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    this.t0 = performance.now(); this.q = []; this.track = []; this.prog = {}; this.seq = 0; this.failures = 0;
    this.ev('start', info);
    this.flush();
  }
  /** seconds since the session began, to a tenth */
  now() { return round((performance.now() - this.t0) / 1000, 10); }
  ev(type: string, data?: unknown) { if (this.id) this.q.push(data === undefined ? { t: this.now(), type } : { t: this.now(), type, data }); }
  progress(p: Record<string, unknown>) { Object.assign(this.prog, p); }
  /** the route: you and her, twice a second */
  sample(dt: number, px: number, pz: number, yaw: number, nx: number, nz: number, ns: string, hid: string) {
    if (!this.id) return;
    this.sampleT += dt; if (this.sampleT < 0.5) return; this.sampleT = 0;
    this.track.push([this.now(), round(px), round(pz), round(yaw), round(nx), round(nz), ns, hid]);
  }
  tick(dt: number) { if (!this.on) return; this.flushT += dt; if (this.flushT > 8) { this.flushT = 0; this.flush(); } }

  flush(beacon = false) {
    if (!this.on || (!this.q.length && !this.track.length && !beacon)) return;
    if (this.busy && !beacon) return;
    const body = JSON.stringify({ id: this.id, name: this.name, seq: this.seq++, ev: this.q, track: this.track, progress: this.prog });
    this.q = []; this.track = [];
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' })); return; }
    this.busy = true;
    fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: body.length < 60000 })
      .then(r => { this.failures = r.ok ? 0 : this.failures + 1; })
      .catch(() => { this.failures++; })
      .finally(() => { this.busy = false; });
  }
}

export const T = new Telemetry();
addEventListener('pagehide', () => { if (T.id) { T.ev('leave'); T.flush(true); } });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && T.id) { T.ev('hidden'); T.flush(true); } });
