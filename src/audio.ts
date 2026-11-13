// Sound is synthesized with Web Audio. An optional recorded layer sits on top: any src/sfx/<name>.mp3
// is bundled (inlined in the single-file build) and replaces or thickens the synthesized version of
// that sound. Missing files simply leave the synth in charge.
type V3 = { x: number; y: number; z: number };
const SFX_URLS = import.meta.glob('./sfx/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// Original lullaby (D Dorian-ish, 3 + 3 bars). [midi, beats]; 0 = rest.
const LULLABY: [number, number][] = [
  [62, 1], [65, 0.5], [64, 0.5], [62, 1], [57, 1.5], [59, 0.5], [60, 1], [62, 1], [64, 0.5], [65, 0.5], [67, 1], [65, 2], [0, 1],
  [69, 1], [67, 0.5], [65, 0.5], [64, 1], [62, 1], [60, 0.5], [59, 0.5], [57, 1], [59, 1], [62, 1], [61, 1], [62, 2.5], [0, 1.5],
];
const BEAT = 60 / 62;

export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode; private muffle!: BiquadFilterNode; private world!: GainNode; private uiBus!: GainNode; private hoverT = 0;
  private music!: GainNode; private sfx!: GainNode; private voice!: GainNode; private amb!: GainNode; private heart!: GainNode;
  private verb!: ConvolverNode; private verbIn!: GainNode; private duck!: GainNode;
  private noise!: AudioBuffer;
  private stems: Record<string, GainNode> = {};
  private stemLevel: Record<string, number> = { calm: 0, unease: 0, hunted: 0, chase: 0 };
  private nurseIn!: GainNode; private nurseLP!: BiquadFilterNode; private nursePan!: PannerNode; private humGain!: GainNode; private vib!: OscillatorNode; private vibAmt!: GainNode;
  private humOn = false; private humNext = 0; private humIdx = 0; private humRec: { s: AudioBufferSourceNode; g: GainNode } | null = null;
  private heartNext = 0; private breathNext = 0; private breathIn = true; private pulseNext = 0; private chaseNext = 0;
  private ambNext = 0;
  threat = 0; fear = 0; fearEmit = 0;
  breathLevel = 0; breathHeld = false; inLocker = false;
  muffleTarget = 20000;

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    const ctx: AudioContext = new AC();
    this.ctx = ctx;
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
    // the world goes quiet under the pause menu; the interface bus stays live (and dry) beside it
    this.world = ctx.createGain();
    this.master.connect(this.muffle).connect(this.world).connect(comp).connect(ctx.destination);
    this.uiBus = ctx.createGain(); this.uiBus.connect(comp);
    const bus = (to: AudioNode = this.master) => { const g = ctx.createGain(); g.connect(to); return g; };
    this.duck = bus(); // music and ambience step back under her voice
    this.music = bus(this.duck); this.sfx = bus(); this.voice = bus(); this.amb = bus(this.duck); this.heart = bus();
    this.heart.gain.value = 0;

    // hospital reverb
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const b = ir.getChannelData(ch); for (let i = 0; i < len; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.verb.buffer = ir;
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.32;
    this.verbIn.connect(this.verb).connect(this.master);
    this.sfx.connect(this.verbIn); this.voice.connect(this.verbIn);

    // the Nurse: one spatial voice chain shared by humming, IV stand and steps
    this.nursePan = this.panner();
    this.nurseLP = ctx.createBiquadFilter(); this.nurseLP.type = 'lowpass'; this.nurseLP.frequency.value = 8000;
    this.nurseIn = ctx.createGain();
    this.nurseIn.connect(this.nurseLP).connect(this.nursePan).connect(this.voice);
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    const formant = ctx.createBiquadFilter(); formant.type = 'peaking'; formant.frequency.value = 340; formant.gain.value = 7; formant.Q.value = 1.2;
    const hp = ctx.createBiquadFilter(); hp.type = 'lowpass'; hp.frequency.value = 1150;
    this.humGain.connect(formant).connect(hp).connect(this.nurseIn);
    this.vib = ctx.createOscillator(); this.vib.frequency.value = 5.2;
    this.vibAmt = ctx.createGain(); this.vibAmt.gain.value = 11;
    this.vib.connect(this.vibAmt); this.vib.start();
    this.buildSpectral();

    this.buildStems();
    this.buildAmbience();
    this.loadSamples();
  }

  // ---- recorded layer ----------------------------------------------------
  private buf = new Map<string, AudioBuffer>();
  private async loadSamples() {
    const ctx = this.ctx!;
    await Promise.all(Object.entries(SFX_URLS).map(async ([path, url]) => {
      const name = path.replace(/^.*\/(.*)\.mp3$/, '$1');
      try {
        let data: ArrayBuffer;
        if (url.startsWith('data:')) { const bin = atob(url.slice(url.indexOf(',') + 1)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); data = u.buffer; }
        else data = await (await fetch(url)).arrayBuffer();
        const b = await ctx.decodeAudioData(data);
        this.buf.set(name, b);
        if (name === 'ambience') this.startAmbienceLoop();
        if (name.startsWith('v_')) this.makePre(name, b);
      } catch { /* keep the synth */ }
    }));
  }
  private ambSynth: GainNode[] = [];
  private startAmbienceLoop() {
    const ctx = this.ctx!, b = this.buf.get('ambience')!;
    for (const g of this.ambSynth) g.gain.setTargetAtTime(g.gain.value * 0.35, ctx.currentTime, 1.5); // the recording takes over the bed
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.55;
    s.connect(g).connect(this.amb); s.start(ctx.currentTime, Math.random() * b.duration);
  }
  // a recorded one-shot at a world position (spatial + occlusion), or false if there is none
  private sampleAt(name: string, pos: V3 | undefined, occl: number, gain = 1, rate = 1, bus?: GainNode) {
    if (!this.buf.has(name)) return false;
    return this.sample(name, this.out(pos, occl, bus), this.ctx!.currentTime, gain, rate);
  }
  has(name: string) { return this.buf.has(name); }
  // ---- her voice: the spectral chain ---------------------------------------
  // Dry: presence EQ and gentle compression so the words cut through the storm, two drifting chorus
  // copies (doubled, not quite human) and a mild occlusion low-pass, all panned from where she stands.
  // Ghost: an airy high-passed copy right inside your head with a long hall, and a reversed reverb that
  // swells INTO each line. Music and ambience duck while she talks.
  private vIn!: GainNode; private vLP!: BiquadFilterNode; private preIn!: GainNode;
  private pre = new Map<string, AudioBuffer>();
  private readonly PRE = 0.9;   // reversed-reverb length (s)
  private readonly LEAD = 0.5;  // how much of the swell plays before the first word (s)
  private buildSpectral() {
    const ctx = this.ctx!;
    const f = (type: BiquadFilterType, freq: number, gain = 0, q = 0.8) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.gain.value = gain; b.Q.value = q; return b; };
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -28; comp.knee.value = 8; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.14;
    const makeup = ctx.createGain(); makeup.gain.value = 1.3;
    this.vIn = ctx.createGain();
    this.vIn.connect(f('highpass', 130, 0, 0.7)).connect(f('peaking', 320, -3, 1)).connect(f('peaking', 2900, 5, 0.8)).connect(f('highshelf', 7000, 3)).connect(comp).connect(makeup);
    const mix = ctx.createGain(); makeup.connect(mix);
    for (const [base, depth, rate, lvl] of [[0.021, 0.0035, 0.43, 0.4], [0.034, 0.005, 0.29, 0.28]]) {
      const d = ctx.createDelay(0.1); d.delayTime.value = base;
      const lfo = ctx.createOscillator(); lfo.frequency.value = rate; const amt = ctx.createGain(); amt.gain.value = depth; lfo.connect(amt).connect(d.delayTime); lfo.start();
      const g = ctx.createGain(); g.gain.value = lvl;
      const fl = ctx.createOscillator(); fl.frequency.value = 5.5 + Math.random() * 2; const fa = ctx.createGain(); fa.gain.value = lvl * 0.35; fl.connect(fa).connect(g.gain); fl.start(); // flutter
      makeup.connect(d).connect(f('lowpass', 5200)).connect(g).connect(mix);
    }
    this.vLP = f('lowpass', 12000, 0, 0.5);
    mix.connect(this.vLP).connect(this.nursePan);
    // the ghost in your head
    const ghost = ctx.createGain(); ghost.gain.value = 0.18;
    const air = f('highpass', 1300, 0, 0.6);
    makeup.connect(ghost).connect(air).connect(this.voice);
    const hall = ctx.createConvolver(), sr = ctx.sampleRate, len = Math.floor(sr * 4.2), ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) { const b = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.4; b[i] = lp * Math.pow(1 - i / len, 2.4) * Math.min(1, i / (sr * 0.04)); } }
    hall.buffer = ir;
    const hallG = ctx.createGain(); hallG.gain.value = 0.7;
    air.connect(hall).connect(hallG).connect(this.voice);
    this.preIn = ctx.createGain(); this.preIn.gain.value = 0.55;
    this.preIn.connect(f('highpass', 380, 0, 0.6)).connect(this.voice);
  }
  // reverse the line, smear it through a short room, reverse it back: the room now breathes in before each word
  private async makePre(name: string, b: AudioBuffer) {
    try {
      const sr = b.sampleRate, L = Math.floor(sr * this.PRE), off = new OfflineAudioContext(2, b.length + L, sr);
      const rev = off.createBuffer(1, b.length, sr), src = b.getChannelData(0), r = rev.getChannelData(0);
      for (let i = 0; i < b.length; i++) r[i] = src[b.length - 1 - i];
      const ir = off.createBuffer(2, L, sr);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < L; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / L, 1.7); }
      const cv = off.createConvolver(); cv.buffer = ir;
      const s = off.createBufferSource(); s.buffer = rev; s.connect(cv).connect(off.destination); s.start();
      const out = await off.startRendering();
      for (let ch = 0; ch < out.numberOfChannels; ch++) out.getChannelData(ch).reverse();
      this.pre.set(name, out);
    } catch { /* no swell then */ }
  }
  // Her recorded voice, a touch slower and lower, through the spectral chain; the hum ducks under it.
  voiceLine(name: string, gain = 1.1) {
    const b = this.buf.get(name);
    if (!b || !this.ctx) return false;
    const ctx = this.ctx, t = ctx.currentTime, rate = 0.94, pre = this.pre.get(name);
    const t0 = t + 0.05 + (pre ? this.LEAD : 0);
    if (pre) { const s = ctx.createBufferSource(); s.buffer = pre; s.playbackRate.value = rate; s.connect(this.preIn); s.start(t + 0.05, Math.max(0, this.PRE - this.LEAD * rate)); }
    this.sample(name, this.vIn, t0, gain, rate, 0);
    const end = t0 + b.duration / rate;
    for (const g of [this.humGain.gain, this.humRec?.g.gain]) {
      if (!g) continue;
      const v = g.value;
      g.cancelScheduledValues(t); g.setTargetAtTime(Math.min(v, 0.12), t, 0.05);
      if (this.humOn) g.setTargetAtTime(this.humRec && g === this.humRec.g.gain ? 0.9 : 1, end, 0.3);
    }
    const d = this.duck.gain; d.cancelScheduledValues(t); d.setTargetAtTime(0.5, t, 0.15); d.setTargetAtTime(1, end + 0.3, 0.8);
    return true;
  }
  private sample(name: string, dest: AudioNode, t: number, gain = 1, rate = 1, jitter = 0.05) {
    const b = this.buf.get(name);
    if (!b || !this.ctx) return false;
    const s = this.ctx.createBufferSource(); s.buffer = b;
    s.playbackRate.value = rate * (1 + (Math.random() - 0.5) * jitter);
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(dest); s.start(t);
    return true;
  }

  setVolumes(master: number, music: number, sfx: number) {
    if (!this.ctx) return;
    this.master.gain.value = master;
    this.uiBus.gain.value = master * (0.35 + 0.65 * sfx);
    this.music.gain.value = music * 0.9;
    this.sfx.gain.value = sfx; this.voice.gain.value = sfx; this.amb.gain.value = sfx * 0.8;
  }

  private panner() {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = 1.4; p.maxDistance = 60; p.rolloffFactor = 1.25;
    return p;
  }

  private setPos(p: PannerNode, v: V3) {
    if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; }
    else (p as any).setPosition(v.x, v.y, v.z);
  }

  listener(pos: V3, fwd: V3) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { (l as any).setPosition(pos.x, pos.y, pos.z); (l as any).setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }

  // Route a one-shot: spatial when pos is given, with occlusion as a low-pass.
  private out(pos?: V3, occl = 0, bus?: GainNode): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return bus ?? this.sfx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000 / (1 + occl * 2.6);
    const g = ctx.createGain(); g.gain.value = 1 / (1 + occl * 0.6);
    const p = this.panner(); this.setPos(p, pos);
    lp.connect(g).connect(p).connect(bus ?? this.sfx);
    setTimeout(() => { try { lp.disconnect(); p.disconnect(); } catch { /* gone */ } }, 6000);
    return lp;
  }

  private env(param: AudioParam, t: number, a: number, peak: number, d: number) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private burst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, a = 0.002) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    s.connect(f).connect(g).connect(dest);
    this.env(g.gain, t, a, peak, dur);
    s.start(t, Math.random() * 1.5, a + dur + 0.05);
    return { f, g };
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, a = 0.004) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + a + dur);
    const g = ctx.createGain();
    o.connect(g).connect(dest);
    this.env(g.gain, t, a, peak, dur);
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }

  // ---- one-shots -------------------------------------------------------
  // a footstep; yours change with what you walk on (the floors differ room to room now)
  step(pos?: V3, occl = 0, weight = 1, nurse = false, surf = '') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = nurse ? this.nurseIn : this.out(pos, occl), w = weight;
    if (nurse || !surf || surf === 'ward') { this.burst(o, t, 0.07, 'lowpass', nurse ? 900 : 1400, 0.7, 0.22 * w); this.tone(o, t, 'sine', nurse ? 95 : 120, 50, 0.08, 0.25 * w); return; }
    if (surf === 'reception') { // terrazzo: a hard heel tap
      this.burst(o, t, 0.05, 'lowpass', 2100, 0.7, 0.2 * w); this.burst(o, t, 0.012, 'bandpass', 3100, 2.2, 0.16 * w, 0.0006); this.tone(o, t, 'sine', 130, 60, 0.06, 0.2 * w);
    } else if (surf === 'corridor') { // vinyl: soft, the odd squeak of a sole
      this.burst(o, t, 0.08, 'lowpass', 1150, 0.7, 0.2 * w); this.tone(o, t, 'sine', 115, 50, 0.08, 0.22 * w);
      if (Math.random() < 0.12) this.tone(o, t + 0.03, 'triangle', 2300 + Math.random() * 600, 2600, 0.05, 0.02 * w, 0.01);
    } else if (surf === 'dayroom') { // boards: a hollow thump, and now and then one gives
      this.burst(o, t, 0.09, 'bandpass', 520, 1.4, 0.24 * w); this.tone(o, t, 'sine', 92, 48, 0.12, 0.3 * w);
      if (Math.random() < 0.14) { const c = this.tone(o, t + 0.04, 'sawtooth', 170, 230, 0.22, 0.018 * w, 0.03); c.detune.value = Math.random() * 40; }
    } else if (surf === 'linen') { // small tiles: a bright tap
      this.burst(o, t, 0.05, 'lowpass', 2300, 0.7, 0.18 * w); this.burst(o, t, 0.01, 'bandpass', 2400, 2.5, 0.12 * w, 0.0006); this.tone(o, t, 'sine', 140, 60, 0.05, 0.18 * w);
    } else { // concrete: grit under the sole
      this.burst(o, t, 0.07, 'lowpass', 1050, 0.7, 0.22 * w); this.burst(o, t + 0.01, 0.04, 'highpass', 3200, 0.8, 0.05 * w); this.tone(o, t, 'sine', 110, 48, 0.07, 0.24 * w);
    }
  }
  crunch() { if (!this.ctx) return; const t = this.ctx.currentTime; for (let i = 0; i < 5; i++) this.burst(this.sfx, t + i * 0.012, 0.03, 'bandpass', 3000 + Math.random() * 4000, 4, 0.12); }
  glass(pos: V3, occl: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(pos, occl);
    this.burst(o, t, 0.35, 'highpass', 2500, 0.7, 0.9);
    for (let i = 0; i < 9; i++) this.tone(o, t + Math.random() * 0.12, 'sine', 2600 + Math.random() * 4200, 2400, 0.12 + Math.random() * 0.25, 0.08);
  }
  doorCreak(pos: V3, occl: number) {
    if (!this.ctx || this.sampleAt('door_creak', pos, occl, 0.7)) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this.out(pos, occl);
    const s = ctx.createOscillator(); s.type = 'sawtooth';
    s.frequency.setValueAtTime(70, t); s.frequency.linearRampToValueAtTime(140 + Math.random() * 50, t + 0.9);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8;
    bp.frequency.setValueAtTime(600, t); bp.frequency.linearRampToValueAtTime(1500, t + 0.9);
    const g = ctx.createGain(); this.env(g.gain, t, 0.15, 0.18, 0.9);
    s.connect(bp).connect(g).connect(o); s.start(t); s.stop(t + 1.2);
  }
  doorSlam(pos: V3, occl: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(pos, occl);
    this.tone(o, t, 'sine', 90, 35, 0.35, 0.9);
    this.burst(o, t, 0.25, 'lowpass', 1800, 0.8, 0.7);
  }
  seal() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(this.sfx, t, 'sine', 70, 28, 0.9, 1);
    this.burst(this.sfx, t, 0.6, 'lowpass', 1200, 0.7, 0.9);
    for (let i = 0; i < 6; i++) this.tone(this.sfx, t + 0.1 + i * 0.07, 'triangle', 900 + i * 130, 700, 0.18, 0.06);
  }
  locker(pos?: V3) {
    if (!this.ctx || this.sampleAt('locker', pos, 0, 0.8)) return;
    const t = this.ctx.currentTime, o = this.out(pos);
    for (const f of [310, 478, 735, 1120]) this.tone(o, t, 'sine', f, f * 0.98, 0.35, 0.08);
    this.burst(o, t, 0.06, 'bandpass', 2000, 2, 0.3);
  }
  drip(pos: V3, occl: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(pos, occl, this.amb);
    const f = 1700 + Math.random() * 900;
    this.tone(o, t, 'sine', f, f * 0.55, 0.07, 0.12, 0.002);
    this.tone(o, t + 0.05, 'sine', f * 1.4, f * 0.9, 0.05, 0.04, 0.002);
  }
  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(this.sfx, t, 0.006, 'bandpass', 3100, 1.8, 0.28, 0.0004); this.tone(this.sfx, t, 'sine', 1750, 1500, 0.018, 0.05, 0.0005); this.tone(this.sfx, t, 'triangle', 260, 200, 0.03, 0.09, 0.001);
    this.burst(this.sfx, t + 0.045, 0.004, 'bandpass', 2400, 1.8, 0.12, 0.0004); // the switch settling
  }
  crank() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this.burst(this.sfx, t + i * 0.045, 0.02, 'bandpass', 2400 + Math.random() * 800, 6, 0.32);
    this.tone(this.sfx, t, 'sawtooth', 180, 220, 0.15, 0.05);
  }
  pickup() { if (!this.ctx || this.ui('bottle_pick', 0.55)) return; const t = this.ctx.currentTime; this.tone(this.sfx, t, 'triangle', 1600, 1200, 0.06, 0.06); this.burst(this.sfx, t, 0.04, 'bandpass', 3500, 3, 0.1); }
  paper() { if (!this.ctx) return; const t = this.ctx.currentTime; for (let i = 0; i < 3; i++) this.burst(this.sfx, t + i * 0.06, 0.08, 'bandpass', 3000 + i * 800, 1.5, 0.12, 0.02); }
  spark(pos?: V3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(pos);
    for (let i = 0; i < 7; i++) this.burst(o, t + Math.random() * 0.4, 0.03, 'highpass', 4000, 1, 0.4);
    this.tone(o, t, 'sawtooth', 100, 100, 0.6, 0.06);
  }
  // the fuse cabinet's door tearing open
  screech(pos: V3) {
    if (!this.ctx || this.sampleAt('screech', pos, 0, 1)) return;
    const t = this.ctx.currentTime, o = this.out(pos);
    const ctx = this.ctx;
    const s = ctx.createOscillator(); s.type = 'sawtooth';
    s.frequency.setValueAtTime(240, t); s.frequency.linearRampToValueAtTime(420, t + 0.7);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 10; bp.frequency.value = 1800;
    const g = ctx.createGain(); this.env(g.gain, t, 0.05, 0.3, 0.8);
    s.connect(bp).connect(g).connect(o); s.start(t); s.stop(t + 1);
  }
  install() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(this.sfx, t, 'sine', 120, 50, 0.3, 0.8);
    this.burst(this.sfx, t, 0.1, 'lowpass', 2000, 1, 0.6);
    const o = this.tone(this.sfx, t + 0.2, 'sawtooth', 50, 60, 2.6, 0.08, 0.6);
    o.detune.value = 8;
  }
  sheet() { if (!this.ctx || this.sampleAt('sheet', undefined, 0, 0.9)) return; const t = this.ctx.currentTime; const b = this.burst(this.sfx, t, 1.1, 'bandpass', 900, 0.6, 0.5, 0.25); b.f.frequency.linearRampToValueAtTime(300, t + 1.2); }
  stinger(big = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (big) this.sample('impact', this.music, t, 0.85, 1, 0.03);
    for (const f of big ? [98, 138.6, 207.7, 293.7, 311.1] : [207.7, 311.1]) {
      const o = this.tone(this.music, t, 'sawtooth', f, f * 0.94, big ? 2.6 : 1.4, big ? 0.07 : 0.05, 0.01);
      o.detune.value = (Math.random() - 0.5) * 20;
    }
    this.burst(this.music, t, big ? 1.4 : 0.6, 'bandpass', 600, 0.5, big ? 0.35 : 0.2, 0.02);
  }
  // her scream when she gets you: recorded only, on top of the stinger
  scream() { if (this.ctx) this.sample('scream', this.voice, this.ctx.currentTime, 0.9, 1, 0.04); }
  whisper(pos: V3) {
    if (!this.ctx || this.sampleAt('whisper', pos, 0, 0.9)) return;
    const t = this.ctx.currentTime, o = this.out(pos);
    for (let i = 0; i < 6; i++) { const b = this.burst(o, t + i * 0.16, 0.14, 'bandpass', 1800 + Math.random() * 1500, 5, 0.18, 0.04); b.f.frequency.linearRampToValueAtTime(900, t + i * 0.16 + 0.15); }
  }
  gasp() { if (!this.ctx || this.sampleAt('breath', undefined, 0, 0.8)) return; const t = this.ctx.currentTime; const b = this.burst(this.sfx, t, 0.5, 'bandpass', 1400, 1.2, 0.6, 0.05); b.f.frequency.linearRampToValueAtTime(700, t + 0.5); }
  pant() { if (!this.ctx) return; const t = this.ctx.currentTime; for (let i = 0; i < 3; i++) this.burst(this.sfx, t + i * 0.28, 0.18, 'bandpass', 1200, 1, 0.16, 0.04); }

  // IV stand squeak and rattle, from the Nurse's position.
  squeak() { if (!this.ctx) return; if (this.sample('squeak', this.nurseIn, this.ctx.currentTime, 0.35, 1, 0.14)) return; const t = this.ctx.currentTime; const f = 2100 + Math.random() * 500; this.tone(this.nurseIn, t, 'sine', f, f * 1.18, 0.11, 0.07, 0.02); this.tone(this.nurseIn, t, 'square', f * 0.5, f * 0.6, 0.08, 0.012, 0.02); }
  rattle() { if (!this.ctx) return; const t = this.ctx.currentTime; for (let i = 0; i < 3; i++) this.tone(this.nurseIn, t + i * 0.05, 'sine', 1900 + Math.random() * 900, 1700, 0.06, 0.05); }
  nurseStep(w = 1) { if (!this.ctx) return; if (this.sample('nurse_step', this.nurseIn, this.ctx.currentTime, 0.5 * w, 1, 0.1)) return; this.step(undefined, 0, 0.8 * w, true); }

  nurse(pos: V3, occl: number) {
    if (!this.ctx) return;
    this.setPos(this.nursePan, pos);
    const f = 9000 / (1 + occl * 2.8);
    this.nurseLP.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
    this.vLP.frequency.setTargetAtTime(12000 / (1 + occl * 1.6), this.ctx.currentTime, 0.08); // words stay readable through a wall
  }
  hum(on: boolean) {
    if (!this.ctx || on === this.humOn) return;
    this.humOn = on;
    const t = this.ctx.currentTime;
    this.humGain.gain.cancelScheduledValues(t);
    this.humGain.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.25 : 0.06);
    if (on) { this.humNext = t + 0.35; this.humIdx = this.humIdx > 12 ? 13 : 0; }
    const rec = this.buf.get('hum');
    if (rec) {
      if (on) {
        const s = this.ctx.createBufferSource(); s.buffer = rec; s.loop = true;
        const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.4);
        s.connect(g).connect(this.nurseIn); s.start(t, Math.random() * rec.duration);
        this.humRec = { s, g };
      } else if (this.humRec) {
        const { s, g } = this.humRec; this.humRec = null;
        g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, 0.06); s.stop(t + 0.5);
      }
    }
  }
  get humming() { return this.humOn; }

  private humNote(t: number, midi: number, dur: number) {
    const ctx = this.ctx!;
    const f = mtof(midi);
    const g = ctx.createGain(); g.connect(this.humGain);
    for (const [type, mul, amp] of [['triangle', 1, 0.16], ['sine', 2.003, 0.035], ['sine', 0.5, 0.05]] as [OscillatorType, number, number][]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
      this.vibAmt.connect(o.detune);
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + dur + 0.4);
      o.onended = () => { try { this.vibAmt.disconnect(o.detune); } catch { /* ok */ } };
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 0.12);
    g.gain.setValueAtTime(0.9, t + Math.max(0.13, dur * 0.85));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
  }

  // ---- continuous layers ------------------------------------------------
  private buildStems() {
    const ctx = this.ctx!;
    const stem = (name: string) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.music); this.stems[name] = g; return g; };
    const calm = stem('calm');
    for (const [f, a] of [[55, 0.12], [82.4, 0.07], [110.3, 0.03]]) { const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = a; o.connect(g).connect(calm); o.start(); }
    const unease = stem('unease');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 3;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lfoG = ctx.createGain(); lfoG.gain.value = 180; lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    lp.connect(unease);
    for (const f of [110, 116.54, 164.81]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.05; o.connect(g).connect(lp); o.start(); }
    const glassT = ctx.createOscillator(); glassT.frequency.value = 1767; const gt = ctx.createGain(); gt.gain.value = 0.006;
    const trem = ctx.createOscillator(); trem.frequency.value = 0.31; const tg = ctx.createGain(); tg.gain.value = 0.006; trem.connect(tg).connect(gt.gain); trem.start();
    glassT.connect(gt).connect(unease); glassT.start();
    const hunted = stem('hunted');
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.2;
    const tremG = ctx.createGain(); tremG.gain.value = 0.5;
    const tr = ctx.createOscillator(); tr.frequency.value = 7.3; const trA = ctx.createGain(); trA.gain.value = 0.5; tr.connect(trA).connect(tremG.gain); tr.start();
    bp.connect(tremG).connect(hunted);
    for (const f of [220, 233.08, 329.6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.035; o.connect(g).connect(bp); o.start(); }
    stem('chase');
  }

  private buildAmbience() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.amb); src.start();
    this.ambSynth.push(g);
    for (const f of [43, 43.4]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = 110; const og = ctx.createGain(); og.gain.value = 0.05; o.connect(l).connect(og).connect(this.amb); o.start(); this.ambSynth.push(og); }
  }

  // ---- whispers -------------------------------------------------------------------------
  // Recorded whispers (wh_*, half of them reversed) from somewhere around you, never close enough to
  // make out, filtered by distance. More often when you are afraid or she is near. The beds in the
  // ward murmur among themselves (wh_crowd), louder the closer you stand.
  onWhisper: ((pos: V3) => void) | null = null;
  private whNext = 35; private whLast = -1; private crowd: { g: GainNode; lp: BiquadFilterNode; p: PannerNode; next: number; on: boolean } | null = null;
  readonly WARD = { x: 9, y: 1.1, z: 21 };
  private whPool() { return [...this.buf.keys()].filter(k => k.startsWith('wh_') && k !== 'wh_crowd'); }
  whisperAt(pos: V3, occl = 0.5, gain = 0.45) {
    const pool = this.whPool(); if (!pool.length || !this.ctx) return false;
    let i = Math.floor(Math.random() * pool.length); if (pool.length > 1 && i === this.whLast) i = (i + 1) % pool.length; this.whLast = i;
    const ctx = this.ctx, t = ctx.currentTime, b = this.buf.get(pool[i])!;
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = 0.84 + Math.random() * 0.2;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300 + Math.random() * 1400; bp.Q.value = 0.45;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000 / (1 + occl * 2.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain / (1 + occl * 0.5), t + 0.6);
    const p = this.panner(); this.setPos(p, pos); p.refDistance = 2;
    s.connect(bp).connect(lp).connect(g).connect(p).connect(this.amb); g.connect(this.verbIn);
    s.onended = () => { try { s.disconnect(); g.disconnect(); p.disconnect(); } catch { /* gone */ } };
    const len = Math.min(b.duration, 4 + Math.random() * 4); // seconds of the recording; it plays slower than written
    s.start(t, Math.random() * Math.max(0, b.duration - len), len);
    g.gain.setTargetAtTime(0.0001, t + len / s.playbackRate.value - 0.9, 0.35);
    return true;
  }
  private whispers(t: number, listener: V3) {
    if (t >= this.whNext && this.whPool().length) {
      const fear = Math.min(1, this.fear + this.threat * 0.25);
      this.whNext = t + (40 + Math.random() * 55) * (1 - fear * 0.5);
      const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 8;
      const pos = { x: listener.x + Math.cos(a) * d, y: 1.3 + Math.random() * 0.9, z: listener.z + Math.sin(a) * d };
      if (this.whisperAt(pos, d > 6 ? 1.1 : 0.35, 0.3 + fear * 0.25)) this.onWhisper?.(pos);
    }
    const rec = this.buf.get('wh_crowd');
    if (rec && !this.crowd) {
      const ctx = this.ctx!, s = ctx.createBufferSource(); s.buffer = rec; s.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = this.panner(); this.setPos(p, this.WARD); p.refDistance = 3; p.rolloffFactor = 1.6;
      s.connect(lp).connect(g).connect(p).connect(this.amb); s.start(t, Math.random() * rec.duration);
      this.crowd = { g, lp, p, next: t + 8, on: false };
    }
    if (this.crowd) { // the murmur comes and goes; it hushes while she is close
      const c = this.crowd, d = Math.hypot(listener.x - this.WARD.x, listener.z - this.WARD.z);
      if (t > c.next) { c.on = !c.on && Math.random() < 0.7; c.next = t + (c.on ? 10 + Math.random() * 14 : 14 + Math.random() * 26); }
      const want = c.on && this.threat < 1.5 ? 0.5 * Math.max(0, 1 - d / 22) : 0;
      c.g.gain.setTargetAtTime(want, t, 2.2);
      c.lp.frequency.setTargetAtTime(900 + 3200 * Math.max(0, 1 - d / 12), t, 0.5);
    }
  }

  // Random building sounds: drips, settling creaks, a distant gurney.
  private ambient(t: number, listener: V3) {
    if (t < this.ambNext) return;
    this.ambNext = t + 1.2 + Math.random() * 3.5;
    const r = Math.random();
    const far = { x: listener.x + (Math.random() - 0.5) * 30, y: 2.5, z: listener.z + (Math.random() - 0.5) * 30 };
    if (r < 0.5) { const o = this.out(far, 1, this.amb); this.tone(o, t, 'sine', 1500 + Math.random() * 1200, 900, 0.09, 0.07); }
    else if (r < 0.8) { const o = this.out(far, 1.5, this.amb); const b = this.burst(o, t, 0.9, 'bandpass', 180 + Math.random() * 200, 6, 0.25, 0.3); b.f.frequency.linearRampToValueAtTime(120, t + 1.1); }
    else { const o = this.out(far, 2, this.amb); for (let i = 0; i < 4; i++) this.tone(o, t + i * 0.35, 'sine', 1900 + i * 40, 2300, 0.1, 0.035, 0.02); }
  }

  update(dt: number, listener: V3, slow: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.muffle.frequency.setTargetAtTime(this.muffleTarget, t, 0.1);

    // humming melody
    if (this.humOn && !this.humRec) while (this.humNext < t + 0.25) {
      const [m, b] = LULLABY[this.humIdx % LULLABY.length];
      if (m) this.humNote(this.humNext, m, b * BEAT);
      this.humNext += b * BEAT; this.humIdx++;
    }

    // adaptive score
    const th = this.threat;
    const tri = (x: number, c: number) => Math.max(0, 1 - Math.abs(x - c));
    const target: Record<string, number> = {
      calm: 0.8 * (1 - Math.min(1, th)) + 0.25,
      unease: Math.min(1, tri(th, 1) + this.fearEmit * 0.8 + (th > 1 ? 0.4 : 0)),
      hunted: tri(th, 2) + (th > 2 ? 0.5 : 0),
      chase: Math.max(0, Math.min(1, th - 2)),
    };
    if (this.theme) for (const k in target) target[k] = 0; // the title song owns the music bus
    for (const k in this.stems) {
      this.stemLevel[k] += (target[k] - this.stemLevel[k]) * Math.min(1, dt * (k === 'chase' ? 3 : 0.8));
      this.stems[k].gain.setTargetAtTime(this.stemLevel[k] * (k === 'hunted' ? 0.8 : 1), t, 0.1);
    }
    if (this.stemLevel.hunted > 0.05 && t > this.pulseNext) {
      this.pulseNext = t + 0.86;
      this.burst(this.stems.hunted, t, 0.06, 'bandpass', 220, 3, 0.5 * this.stemLevel.hunted / Math.max(0.2, this.stemLevel.hunted));
    }
    if (this.stemLevel.chase > 0.05 && t > this.chaseNext) {
      this.chaseNext = t + 0.43;
      this.tone(this.stems.chase, t, 'sine', 70, 30, 0.25, 0.9);
      this.burst(this.stems.chase, t, 0.12, 'bandpass', 900, 1, 0.4);
      if (Math.random() < 0.18) { const o = this.tone(this.stems.chase, t, 'sawtooth', 1200, 1700, 0.5, 0.05, 0.05); o.detune.value = 30; }
    }

    // heartbeat
    const hv = Math.max(0, Math.min(1, (this.fear - 0.12) * 1.4));
    this.heart.gain.setTargetAtTime(hv * 0.9, t, 0.2);
    if (hv > 0.02 && t > this.heartNext) {
      const bpm = 64 + this.fear * 76;
      this.heartNext = t + 60 / bpm;
      if (!this.sample('heartbeat', this.heart, t, 1.15, 0.92 + this.fear * 0.12, 0.02)) {
        this.tone(this.heart, t, 'sine', 62, 38, 0.13, 0.9, 0.006);
        this.tone(this.heart, t + 0.17, 'sine', 55, 35, 0.12, 0.55, 0.006);
      }
    }

    // breathing (stops while held)
    if (!this.breathHeld && this.breathLevel > 0.08 && t > this.breathNext) {
      const rate = 0.55 + this.breathLevel * 1.4;
      this.breathNext = t + 1 / rate * 0.5;
      const b = this.burst(this.sfx, t, 0.32 / rate, 'bandpass', this.breathIn ? 900 : 1300, 0.9, 0.09 * this.breathLevel * (this.inLocker ? 1.6 : 1), 0.08);
      b.f.frequency.linearRampToValueAtTime(this.breathIn ? 1500 : 700, t + 0.3 / rate);
      this.breathIn = !this.breathIn;
    }

    if (!slow) { this.ambient(t, listener); this.whispers(t, listener); }
  }

  // pause: the world fades out but the context keeps running, so the menu still ticks
  suspend(on: boolean) { if (!this.ctx) return; this.ctx.resume(); this.world.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, on ? 0.05 : 0.12); }

  // ---- interface ---------------------------------------------------------
  /** a dry interface sample (menus, notes, the map); also plays under the pause menu */
  ui(name: string, gain = 1, rate = 1) { if (!this.ctx) return false; return this.sample(name, this.uiBus, this.ctx.currentTime, gain, rate, 0.04); }
  /** moving between menu items: a soft bakelite tick */
  hover() {
    if (!this.ctx) return;
    const now = performance.now(); if (now - this.hoverT < 55) return; this.hoverT = now;
    const t = this.ctx.currentTime, b = this.uiBus;
    this.burst(b, t, 0.005, 'bandpass', 2700 + Math.random() * 300, 1.4, 0.13, 0.0004);
    this.tone(b, t, 'sine', 1320, 1150, 0.022, 0.035, 0.0006);
    this.tone(b, t, 'triangle', 330, 270, 0.02, 0.05, 0.0008);
  }
  /** confirming a menu choice: a heavy switch */
  select() {
    if (!this.ctx || this.ui('ui_select', 0.5)) return;
    const t = this.ctx.currentTime, b = this.uiBus;
    this.burst(b, t, 0.012, 'bandpass', 1900, 1.2, 0.3, 0.0005); this.tone(b, t, 'triangle', 240, 150, 0.06, 0.12, 0.001);
  }
  /** the checkpoint: a rubber stamp coming down on a form */
  stamp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, b = this.uiBus;
    this.tone(b, t, 'sine', 105, 42, 0.13, 0.42, 0.0015);
    this.burst(b, t, 0.045, 'bandpass', 640, 0.8, 0.32, 0.0008);
    this.burst(b, t + 0.003, 0.018, 'highpass', 2600, 0.7, 0.1, 0.0004);
    this.burst(b, t + 0.15, 0.06, 'bandpass', 3400, 2.2, 0.04, 0.012); // the rubber peeling off the ink
  }
  /** a line added to the objective: pencil on the clipboard */
  write() { if (!this.ctx || this.ui('ui_write', 0.42)) return; for (let i = 0; i < 4; i++) this.burst(this.uiBus, this.ctx.currentTime + i * 0.09, 0.07, 'bandpass', 4200, 2.5, 0.05, 0.01); }
  noteOpen() { if (!this.ui('paper_open', 0.6)) this.paper(); }
  noteClose() { if (!this.ui('paper_close', 0.5)) this.paper(); }
  mapOpen() { if (!this.ui('map_open', 0.55)) this.paper(); }
  mapClose() { if (!this.ui('map_close', 0.45)) this.paper(); }
  /** the torch giving out (or nearly): a flickering filament buzz */
  torchDie(gain = 0.5) { if (!this.ctx || this.ui('torch_die', gain)) return; this.tone(this.sfx, this.ctx.currentTime, 'sawtooth', 100, 100, 0.5, 0.05 * gain); }
  /** a low body-blow under the music: she is suddenly much closer */
  thud(gain = 0.5) { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.uiBus, t, 'sine', 62, 34, 0.55, gain, 0.004); this.burst(this.uiBus, t, 0.18, 'lowpass', 220, 0.7, gain * 0.5, 0.003); }
  /** sliding under a bed, and back out */
  bed(out: boolean, pos?: V3) {
    if (!this.ctx) return;
    if (this.sampleAt(out ? 'bed_out' : 'bed_in', pos, 0, out ? 0.55 : 0.6, 0.95)) return;
    const t = this.ctx.currentTime, b = this.burst(this.sfx, t, 0.6, 'bandpass', 900, 0.6, 0.18, 0.05); b.f.frequency.linearRampToValueAtTime(500, t + 0.6);
  }
  /** her key ring, sorting for the right one */
  keys(pos: V3, occl = 0) { if (!this.ctx) return; if (!this.sampleAt('keys', pos, occl, 0.7)) for (let i = 0; i < 5; i++) this.tone(this.out(pos, occl), this.ctx.currentTime + i * 0.05 + Math.random() * 0.03, 'sine', 3800 + Math.random() * 2400, 3600, 0.12, 0.03, 0.001); }

  // ---- set dressing ------------------------------------------------------
  // A music box: each tine a plucked sine with the comb's bright, fast-dying overtone, a little out
  // of tune, through a small wooden box. Returns how long the tune lasts.
  musicBox(pos: V3, occl: number, notes: [number, number][], beat = 0.62, slowEnd = true) {
    if (!this.ctx) return 0;
    const ctx = this.ctx, o = this.out(pos, occl);
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 900; body.Q.value = 1.4; body.gain.value = 5;
    const g = ctx.createGain(); g.gain.value = 0.5; body.connect(g).connect(o);
    let t = ctx.currentTime + 0.05;
    notes.forEach(([m, b], i) => {
      const stretch = slowEnd && i > notes.length - 6 ? 1 + (i - (notes.length - 6)) * 0.09 : 1; // the spring runs down
      if (m) {
        const f = mtof(m) * Math.pow(2, ((Math.random() - 0.5) * 14) / 1200);
        this.tone(body, t, 'sine', f, f * 0.999, 1.5, 0.32, 0.002);
        this.tone(body, t, 'sine', f * 5.93, f * 5.9, 0.12, 0.07, 0.001);
        this.tone(body, t, 'sine', f * 2.0, f * 2.0, 0.5, 0.05, 0.002);
        this.burst(body, t, 0.006, 'highpass', 6000, 1, 0.05, 0.0005);
      }
      t += b * beat * stretch;
    });
    // the spring: a soft mechanical whirr under the tune
    const w = this.burst(body, ctx.currentTime + 0.02, t - ctx.currentTime, 'bandpass', 2200, 8, 0.012, 0.2);
    void w;
    return t - ctx.currentTime;
  }
  // the reception counter bell
  bell(pos: V3, occl: number, gain = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(pos, occl);
    for (const [f, a, d] of [[2093, 0.28, 2.2], [2093 * 2.76, 0.08, 0.9], [2093 * 5.4, 0.04, 0.4], [2093 * 0.5, 0.03, 1.2]] as const) this.tone(o, t, 'sine', f, f * 0.998, d, a * gain, 0.001);
    this.burst(o, t, 0.01, 'highpass', 5000, 1, 0.12 * gain, 0.0005);
  }
  // one double ring of an old electromechanical telephone bell
  phoneRing(pos: V3, occl: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this.out(pos, occl);
    for (const [st, len] of [[0, 0.42], [0.62, 0.42]]) {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(o);
      const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 22;
      const amG = ctx.createGain(); amG.gain.value = 0.5; am.connect(amG).connect(g.gain);
      for (const f of [1180, 1420, 2650]) { const s = ctx.createOscillator(); s.type = 'triangle'; s.frequency.value = f; const sg = ctx.createGain(); sg.gain.value = f > 2000 ? 0.04 : 0.11; s.connect(sg).connect(g); s.start(t + st); s.stop(t + st + len); }
      g.gain.setValueAtTime(0.5, t + st); g.gain.setValueAtTime(0, t + st + len);
      am.start(t + st); am.stop(t + st + len);
    }
  }
  // a recorded line heard down a 1992 telephone: narrow band, a little crushed, right in the ear
  private telInput() {
    const ctx = this.ctx!;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2900;
    const sh = ctx.createWaveShaper(); const k = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; k[i] = Math.tanh(x * 2.4) / Math.tanh(2.4); } sh.curve = k;
    const g = ctx.createGain(); g.gain.value = 0.9;
    hp.connect(lp).connect(sh).connect(g).connect(this.voice);
    this.burst(g, ctx.currentTime, 6, 'bandpass', 3000, 0.7, 0.012, 0.2); // line hiss
    return hp;
  }
  phoneHum(dur: number) {
    const b = this.buf.get('hum'); if (!b || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = b;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8, t + 0.5); g.gain.setTargetAtTime(0.0001, t + dur - 0.4, 0.15);
    s.connect(g).connect(this.telInput()); s.start(t, Math.random() * (b.duration - dur - 1)); s.stop(t + dur + 0.5);
  }
  phoneVoice(name: string) {
    const b = this.buf.get(name); if (!b || !this.ctx) return false;
    const ctx = this.ctx, t = ctx.currentTime, tin = this.telInput(), pre = this.pre.get(name);
    if (pre) { const s = ctx.createBufferSource(); s.buffer = pre; s.playbackRate.value = 0.97; const g = ctx.createGain(); g.gain.value = 0.45; s.connect(g).connect(tin); s.start(t + 0.05, Math.max(0, this.PRE - this.LEAD * 0.97)); }
    this.sample(name, tin, t + 0.05 + (pre ? this.LEAD : 0), 1.3, 0.97, 0);
    return true;
  }
  // a transistor radio between stations: hiss with the ghost of somebody talking inside it
  radio(pos: V3, occl: number, dur: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this.out(pos, occl);
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.08); g.gain.setValueAtTime(0.32, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const syl = ctx.createOscillator(); syl.frequency.value = 4.3; const sg = ctx.createGain(); sg.gain.value = 600; syl.connect(sg).connect(bp.frequency);
    const am = ctx.createOscillator(); am.frequency.value = 5.7; const ag = ctx.createGain(); ag.gain.value = 0.12; am.connect(ag).connect(g.gain);
    s.connect(bp).connect(g).connect(o); s.start(t); s.stop(t + dur + 0.1); syl.start(t); syl.stop(t + dur); am.start(t); am.stop(t + dur);
    for (let i = 0; i < 8; i++) this.burst(o, t + Math.random() * dur, 0.05, 'highpass', 3000, 1, 0.08);
  }
  // nails dragged down the far side of a door
  scratch(pos: V3, occl: number, dur = 2.2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(pos, occl);
    let k = 0;
    while (k < dur) {
      const len = 0.25 + Math.random() * 0.45;
      const b = this.burst(o, t + k, len, 'bandpass', 2600 + Math.random() * 1600, 7, 0.22, 0.03);
      b.f.frequency.linearRampToValueAtTime(1400 + Math.random() * 600, t + k + len);
      k += len + 0.08 + Math.random() * 0.3;
    }
  }
  tick(pos: V3, occl = 0, gain = 1) { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(pos, occl); this.tone(o, t, 'square', 3200, 2800, 0.012, 0.05 * gain, 0.0005); this.burst(o, t, 0.008, 'highpass', 4000, 1, 0.06 * gain, 0.0005); }
  metal(pos: V3, occl = 0) { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(pos, occl); for (const f of [620, 1480, 2390]) this.tone(o, t, 'sine', f, f * 0.97, 0.35, 0.05, 0.002); this.burst(o, t, 0.05, 'bandpass', 1800, 2, 0.15); }
  // foley for looking closely at things
  touch(kind: string) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'paper') this.paper();
    else if (kind === 'cloth') { const b = this.burst(this.sfx, t, 0.35, 'bandpass', 1300, 0.7, 0.1, 0.08); b.f.frequency.linearRampToValueAtTime(700, t + 0.35); }
    else if (kind === 'metal') { this.tone(this.sfx, t, 'sine', 1900, 1850, 0.25, 0.03, 0.002); this.burst(this.sfx, t, 0.03, 'bandpass', 2600, 3, 0.08); }
    else if (kind === 'glass') this.tone(this.sfx, t, 'sine', 3100, 3080, 0.3, 0.025, 0.001);
    else if (kind === 'wood') { this.burst(this.sfx, t, 0.05, 'bandpass', 700, 2, 0.16); this.tone(this.sfx, t, 'sine', 240, 180, 0.08, 0.08); }
    else this.burst(this.sfx, t, 0.04, 'lowpass', 1200, 0.8, 0.08);
  }
  // Thunder: a crack when it is close, then a long rolling rumble; `near` 0..1
  thunder(near: number, delay: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const dest = this.amb;
    const far = ['thunder_far', 'thunder_far2'].filter(n => this.buf.has(n));
    const rec = near > 0.6 && this.buf.has('thunder_near') ? 'thunder_near' : far.length ? far[Math.floor(Math.random() * far.length)] : '';
    if (rec) { // the recording, darker the farther the strike
      const s = ctx.createBufferSource(); s.buffer = this.buf.get(rec)!; s.playbackRate.value = 0.9 + Math.random() * 0.14;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400 + near * 7000;
      const g = ctx.createGain(); g.gain.value = 0.45 + near * 0.75;
      s.connect(lp).connect(g).connect(dest); g.connect(this.verbIn); s.start(t);
      this.verbIn.gain.setTargetAtTime(0.5, t, 0.1); this.verbIn.gain.setTargetAtTime(0.32, t + 1.5, 0.8);
      return;
    }
    if (near > 0.6) { this.burst(dest, t, 0.35, 'highpass', 900, 0.5, 0.5 * near, 0.003); this.tone(dest, t, 'sine', 70, 30, 0.6, 0.6 * near, 0.005); }
    const len = 3.5 + Math.random() * 3 + (1 - near) * 2;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160 + near * 260; lp.Q.value = 0.8;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 600 + near * 900;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(lp).connect(lp2).connect(g).connect(dest);
    const peak = (0.55 + near * 0.9);
    g.gain.setValueAtTime(0, t);
    let k = 0;
    while (k < len) { // a few swells, each softer
      const a = peak * Math.pow(1 - k / len, 1.3) * (0.6 + Math.random() * 0.5);
      g.gain.linearRampToValueAtTime(a, t + k + 0.08 + Math.random() * 0.25);
      k += 0.35 + Math.random() * 0.9;
      g.gain.linearRampToValueAtTime(a * 0.35, t + Math.min(len, k));
    }
    g.gain.linearRampToValueAtTime(0, t + len + 0.6);
    s.start(t, Math.random()); s.stop(t + len + 0.8);
    this.verbIn.gain.setTargetAtTime(0.5, t, 0.1); this.verbIn.gain.setTargetAtTime(0.32, t + 1.5, 0.8);
  }
  // rain on the windows; level 0..1, louder near glass
  private rainG: GainNode | null = null; private rainLP: BiquadFilterNode | null = null; private rainHP: BiquadFilterNode | null = null; private rainSrc: AudioBufferSourceNode | null = null; private rainRec = false;
  rain(level: number, open: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.rainG) {
      this.rainHP = ctx.createBiquadFilter(); this.rainHP.type = 'highpass'; this.rainHP.frequency.value = 400;
      this.rainLP = ctx.createBiquadFilter(); this.rainLP.type = 'lowpass'; this.rainLP.frequency.value = 1500;
      this.rainG = ctx.createGain(); this.rainG.gain.value = 0;
      this.rainHP.connect(this.rainLP).connect(this.rainG).connect(this.amb);
    }
    const rec = this.buf.get('rain_in');
    if (!this.rainSrc || (rec && !this.rainRec)) { // the recording takes over from the noise once it has loaded
      try { this.rainSrc?.stop(); } catch { /* not started */ }
      const s = ctx.createBufferSource(); s.buffer = rec ?? this.noise; s.loop = true; s.connect(this.rainHP!);
      s.start(ctx.currentTime, rec ? Math.random() * rec.duration : 0);
      this.rainSrc = s; this.rainRec = !!rec; this.rainHP!.frequency.value = rec ? 110 : 400;
    }
    const t = ctx.currentTime;
    this.rainG.gain.setTargetAtTime(level * (this.rainRec ? 0.16 + open * 0.55 : 0.05 + open * 0.13), t, 0.5);
    this.rainLP!.frequency.setTargetAtTime(this.rainRec ? 2200 + open * 10000 : 900 + open * 4200, t, 0.5);
    if (level > 0.05 && Math.random() < 0.04 + open * 0.2) { // a fat drop on the glass or a ledge
      const f = 1800 + Math.random() * 2200;
      this.tone(this.amb, t, 'sine', f, f * 0.6, 0.03, 0.012 + open * 0.03, 0.001);
    }
  }
  // ---- title music ---------------------------------------------------------
  // The song repeats every THEME_LOOP seconds; each copy's reverb tail rings over the next one.
  private theme: { g: GainNode; next: number; timer: number; srcs: AudioBufferSourceNode[] } | null = null;
  playTheme(on: boolean, fade = 1.5) {
    if (!this.ctx) return false;
    const ctx = this.ctx, t = ctx.currentTime, LOOP = 55.94;
    if (on && !this.theme) {
      const b = this.buf.get('theme'); if (!b) return false;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + fade); g.connect(this.music);
      const th = { g, next: t + 0.05, timer: 0, srcs: [] as AudioBufferSourceNode[] };
      const queue = () => {
        while (th.next < ctx.currentTime + 2.5) {
          const s = ctx.createBufferSource(); s.buffer = b; s.connect(g); s.start(th.next);
          s.onended = () => { th.srcs = th.srcs.filter(x => x !== s); };
          th.srcs.push(s); th.next += LOOP;
        }
      };
      queue(); th.timer = window.setInterval(queue, 700);
      this.theme = th;
      for (const k in this.stems) this.stems[k].gain.setTargetAtTime(0, t, 0.3);
    } else if (!on && this.theme) {
      const th = this.theme; this.theme = null;
      clearInterval(th.timer);
      th.g.gain.cancelScheduledValues(t); th.g.gain.setValueAtTime(Math.max(0.0001, th.g.gain.value), t); th.g.gain.exponentialRampToValueAtTime(0.0001, t + fade);
      for (const s of th.srcs) { try { s.stop(t + fade + 0.1); } catch { /* not started yet */ } }
    }
    return true;
  }
  get themeOn() { return !!this.theme; }
  whenLoaded(name: string, fn: () => void) {
    if (this.buf.has(name)) { fn(); return; }
    const id = setInterval(() => { if (this.buf.has(name)) { clearInterval(id); fn(); } }, 100);
    setTimeout(() => clearInterval(id), 15000);
  }
}
