import * as THREE from 'three';

// Low-resolution render target + one lo-fi composite pass:
// barrel warp, chromatic aberration, tone mapping, grade, grain, ordered dither,
// vignette, locker slats, the sheet, and fades.
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom; uniform float uBloom;
uniform vec2 uRes; uniform vec2 uOut;
uniform float uTime, uExposure, uGrain, uAberr, uWarp, uFear, uPulse, uBreath, uLocker, uSheet, uFade, uHalluc, uDesat, uLevels, uFlash, uFocus, uShock;
uniform sampler2D tDepth; uniform float uNear, uFar, uHaze, uTorchCos, uTorchCosIn, uTorchRange; uniform int uSteps;
uniform vec2 uTan; uniform vec3 uTorchPos, uTorchDir; uniform mat4 uCamWorld;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
// The torch beam through dusty air: march the view ray up to whatever it hits and gather light wherever
// the ray is inside the spotlight cone. Walls cut it off (depth), the air drifts (cheap world-space noise).
float linDepth(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
vec3 beamHaze(vec2 uv, float jit){
  vec3 rd = normalize(vec3((uv * 2.0 - 1.0) * uTan, -1.0));
  float tMax = min(linDepth(uv) / -rd.z, uTorchRange);
  float acc = 0.0, n = float(uSteps);
  for (int i = 0; i < 12; i++) {
    if (i >= uSteps) break;
    vec3 x = rd * ((float(i) + jit) / n * tMax);
    vec3 v = x - uTorchPos; float d = length(v);
    float cone = smoothstep(uTorchCos, uTorchCosIn, dot(v, uTorchDir) / max(d, 1e-3));
    vec3 w = (uCamWorld * vec4(x, 1.0)).xyz;
    float air = 0.5 + 0.5 * sin(w.x * 1.7 + uTime * 0.23) * sin(w.z * 1.3 - uTime * 0.17 + w.y * 2.3);
    acc += cone * air / (1.0 + d * d * 0.16);
  }
  return vec3(1.0, 0.86, 0.66) * acc * tMax / max(n, 1.0) * uHaze;
}
vec3 toSRGB(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float frame24 = mod(floor(uTime * 24.0), 64.0);
  vec2 p = vUv * 2.0 - 1.0;
  p *= 1.0 + uWarp * dot(p, p);
  p /= 1.0 + uWarp;
  if (uHalluc > 0.0) p += vec2(sin(uTime*1.7 + p.y*6.0), cos(uTime*1.3 + p.x*5.0)) * 0.006 * uHalluc;
  vec2 uv = p * 0.5 + 0.5;
  // the grab: the picture tears in bands
  if (uShock > 0.0) { float row = floor(vUv.y * 38.0), fr = floor(uTime * 40.0); uv.x += (hash(vec2(row, fr)) - 0.5) * 0.07 * uShock * step(0.5, hash(vec2(row * 1.7, fr + 3.0))); }
  vec2 dir = uv - 0.5;
  float ca = uAberr * (0.7 + uFear * 1.6) * (1.0 - uLocker * 0.7) * (1.0 + uShock * 8.0);
  vec3 col;
  col.r = texture2D(tScene, uv + dir * ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - dir * ca).b;
  // looking closely: the edges go soft so the eye lands on the thing
  if (uFocus > 0.0) {
    float rr = smoothstep(0.08, 0.62, length((uv - 0.5) * vec2(uOut.x / uOut.y, 1.0))) * uFocus;
    vec2 o = dir * 0.03 * rr, o2 = vec2(-o.y, o.x) * 0.8;
    vec3 b = texture2D(tScene, uv + o).rgb + texture2D(tScene, uv - o).rgb + texture2D(tScene, uv + o2).rgb + texture2D(tScene, uv - o2).rgb;
    col = mix(col, b * 0.25, clamp(rr * 1.2, 0.0, 1.0));
  }
  col += texture2D(tBloom, uv).rgb * uBloom;
  if (uHaze > 0.0 && uSteps > 0) col += beamHaze(uv, ign(floor(gl_FragCoord.xy) + 5.588238 * frame24));
  col *= step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  col *= uExposure * (1.0 + uFlash * 0.5) * (1.0 + uShock * 0.9);
  col = mix(col, col * vec3(1.9, 0.38, 0.32) + vec3(0.05, 0.0, 0.0), uShock * 0.7);
  col += vec3(0.05, 0.06, 0.08) * uFlash; // a lightning flash lifts the whole frame a little, cold
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l), clamp(uDesat + uFear * 0.3, 0.0, 1.0));
  col *= mix(vec3(0.84, 1.0, 0.9), vec3(1.06, 1.0, 0.88), smoothstep(0.0, 0.5, l));
  col = toSRGB(col);
  // vignette, tightened by fear (pulsing) and by holding breath
  vec2 q = (vUv - 0.5) * vec2(uOut.x / uOut.y, 1.0);
  float d = length(q);
  float inner = 0.46 - uBreath * 0.24 - uFear * 0.08 * (0.6 + 0.4 * uPulse) - uFocus * 0.12;
  float vig = 1.0 - smoothstep(inner, inner + 0.6 - uBreath * 0.2, d);
  col *= mix(0.2 - uBreath * 0.12, 1.0, vig);
  if (uLocker > 0.0) {
    // hidden: the slats (or the bed) are real geometry now; this only closes the dark in around the edges
    float side = smoothstep(0.0, 0.24, vUv.x) * smoothstep(0.0, 0.24, 1.0 - vUv.x) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(0.0, 0.14, 1.0 - vUv.y);
    col *= mix(1.0, 0.3 + 0.7 * side, uLocker);
  }
  if (uSheet > 0.0) {
    float n = sin(vUv.x * 9.0 + sin(vUv.y * 5.0) * 1.7) * 0.5 + 0.5;
    float folds = smoothstep(0.15, 0.85, n) * 0.28 + hash(floor(vUv * uRes * 0.5)) * 0.05;
    vec3 cloth = vec3(0.72, 0.70, 0.64) * (0.7 + folds);
    col = mix(col, cloth, uSheet);
  }
  vec2 pix = floor(vUv * uRes);
  col = floor(col * uLevels + bayer4(pix)) / uLevels;
  // film grain: one screen pixel, new at 24 fps, added after the posterize (the 36 steps would blow small
  // grain up into whole-step flips), strongest in the mid-tones and almost gone in the blacks.
  // Measured at 1080p: std ~2/255 in mid-tones, ~1.3 in shadows, <0.8 in black (it was 4-6, peaks of 13).
  vec2 gp = floor(gl_FragCoord.xy) + frame24 * vec2(37.0, 17.0);
  float g = hash(gp) + hash(gp + 71.3) - 1.0;
  float v = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += g * uGrain * (0.3 + 0.7 * smoothstep(0.0, 0.15, v) * (1.0 - 0.6 * smoothstep(0.55, 1.0, v)));
  if (uShock > 0.93) col = vec3(1.0) - col; // the first frames of the grab, negative
  col *= 1.0 - uFade;
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BRIGHT = /* glsl */ `precision highp float; uniform sampler2D tSrc; uniform float uThreshold; varying vec2 vUv;
void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.6, l), 1.0); }`;
const BLUR = /* glsl */ `precision highp float; uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
  c += (texture2D(tSrc, vUv + uDir * 1.385).rgb + texture2D(tSrc, vUv - uDir * 1.385).rgb) * 0.316;
  c += (texture2D(tSrc, vUv + uDir * 3.23).rgb + texture2D(tSrc, vUv - uDir * 3.23).rgb) * 0.07;
  gl_FragColor = vec4(c, 1.0);
}`;

export class Post {
  rt: THREE.WebGLRenderTarget;
  mat: THREE.ShaderMaterial;
  b1: THREE.WebGLRenderTarget; b2: THREE.WebGLRenderTarget;
  bright: THREE.ShaderMaterial; blur: THREE.ShaderMaterial; quad!: THREE.Mesh;
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  internalH = 540;
  scale = 1;
  u: Record<string, THREE.IUniform>;

  constructor(private renderer: THREE.WebGLRenderer) {
    const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    if (!half) this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.rt.depthTexture = new THREE.DepthTexture(4, 4);
    const bopts = { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.b1 = new THREE.WebGLRenderTarget(4, 4, bopts); this.b2 = new THREE.WebGLRenderTarget(4, 4, bopts);
    this.bright = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: this.rt.texture }, uThreshold: { value: half ? 1.05 : 0.7 } }, vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false });
    this.blur = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false });
    this.u = {
      tScene: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(4, 4) }, uOut: { value: new THREE.Vector2(4, 4) },
      uTime: { value: 0 }, uExposure: { value: 1 }, uGrain: { value: 0.02 }, uAberr: { value: 0.006 }, uWarp: { value: 0.06 },
      uFear: { value: 0 }, uPulse: { value: 0 }, uBreath: { value: 0 }, uLocker: { value: 0 }, uSheet: { value: 0 }, uFade: { value: 1 },
      uHalluc: { value: 0 }, uDesat: { value: 0.12 }, uLevels: { value: 36 }, uFlash: { value: 0 }, uFocus: { value: 0 }, uShock: { value: 0 },
      tBloom: { value: null }, uBloom: { value: 0.65 },
      tDepth: { value: this.rt.depthTexture }, uNear: { value: 0.05 }, uFar: { value: 60 }, uTan: { value: new THREE.Vector2(1, 1) }, uCamWorld: { value: new THREE.Matrix4() },
      uHaze: { value: 0 }, uSteps: { value: 10 }, uTorchPos: { value: new THREE.Vector3() }, uTorchDir: { value: new THREE.Vector3(0, 0, -1) },
      uTorchCos: { value: 0.9 }, uTorchCosIn: { value: 0.95 }, uTorchRange: { value: 16 },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.quad = quad;
    this.u.tBloom.value = this.b1.texture;
  }

  resize(w: number, h: number) {
    const ih = Math.max(200, Math.round(this.internalH * this.scale));
    const iw = Math.round(ih * (w / h));
    this.rt.setSize(iw, ih);
    const bw = Math.max(2, Math.round(iw / 4)), bh = Math.max(2, Math.round(ih / 4));
    this.b1.setSize(bw, bh); this.b2.setSize(bw, bh);
    this.bloomTexel.set(1 / bw, 1 / bh);
    this.u.uRes.value.set(iw, ih);
    this.u.uOut.value.set(w, h);
  }

  bloomTexel = new THREE.Vector2(1, 1);
  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }
  // the torch whose beam shows in the air (set by the game), and how thick the air is
  torch: THREE.SpotLight | null = null; hazeK = 0.016;
  private tv = new THREE.Vector3(); private tw = new THREE.Vector3();
  private updateHaze(camera: THREE.Camera) {
    const u = this.u, cam = camera as THREE.PerspectiveCamera, L = this.torch;
    if (!cam.isPerspectiveCamera) { u.uHaze.value = 0; return; }
    u.uNear.value = cam.near; u.uFar.value = cam.far;
    const th = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2); u.uTan.value.set(th * cam.aspect, th);
    u.uCamWorld.value.copy(cam.matrixWorld);
    if (!L || L.intensity <= 0) { u.uHaze.value = 0; return; }
    const inv = cam.matrixWorldInverse;
    L.getWorldPosition(this.tv).applyMatrix4(inv);
    L.target.getWorldPosition(this.tw).applyMatrix4(inv);
    u.uTorchPos.value.copy(this.tv); u.uTorchDir.value.copy(this.tw).sub(this.tv).normalize();
    u.uTorchCos.value = Math.cos(L.angle * 0.6); u.uTorchCosIn.value = Math.cos(L.angle * 0.18); // the hot spot only
    u.uTorchRange.value = L.distance || 16;
    u.uHaze.value = this.hazeK * L.intensity / 60;
  }
  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    this.updateHaze(camera);
    // bloom: bright pass at quarter resolution, then two separable blur iterations
    this.pass(this.bright, this.b1);
    const bu = this.blur.uniforms;
    for (const k of [1, 2]) {
      bu.tSrc.value = this.b1.texture; bu.uDir.value.set(this.bloomTexel.x * k, 0); this.pass(this.blur, this.b2);
      bu.tSrc.value = this.b2.texture; bu.uDir.value.set(0, this.bloomTexel.y * k); this.pass(this.blur, this.b1);
    }
    this.pass(this.mat, null);
  }
}

// Dust motes that only show up inside the torch beam.
export function makeDust(count = 560) {
  const geo = new THREE.BufferGeometry();
  const a = new Float32Array(count * 3);
  for (let i = 0; i < a.length; i++) a[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: 9 }, uPx: { value: 1 },
      uTorchPos: { value: new THREE.Vector3() }, uTorchDir: { value: new THREE.Vector3(0, 0, -1) }, uTorchCos: { value: 0.9 }, uTorchOn: { value: 0 }, uTorchRange: { value: 12 },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uCam, uTorchPos, uTorchDir; uniform float uTime, uBox, uTorchCos, uTorchOn, uTorchRange, uPx;
      varying float vB;
      void main(){
        vec3 s = position;
        vec3 drift = vec3(sin(uTime*0.13 + s.y*20.0), sin(uTime*0.07 + s.x*13.0)*0.5 - uTime*0.025, cos(uTime*0.11 + s.z*17.0)) * 0.4;
        vec3 wp = uCam + mod(s * uBox + drift - uCam, uBox) - uBox * 0.5;
        vec3 tv = wp - uTorchPos; float d = length(tv);
        float c = dot(tv / max(d, 0.001), uTorchDir);
        float cone = smoothstep(uTorchCos, uTorchCos + 0.05, c) * (0.35 + 0.65 * smoothstep(uTorchCos + 0.02, 1.0, c)) * (1.0 - smoothstep(uTorchRange * 0.3, uTorchRange * 0.85, d)) * smoothstep(0.3, 0.9, d);
        vB = cone * uTorchOn * (0.55 + 0.45 * sin(uTime * 1.7 + s.x * 40.0));
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_PointSize = clamp(9.0 / -mv.z, 1.0, 3.5) * uPx;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vB;
      void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)); gl_FragColor = vec4(vec3(1.0, 0.94, 0.82) * vB * a * 0.9, 1.0); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
