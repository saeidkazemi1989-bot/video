/**
 * WebGL2 frame compositor: aspect-fit crop, motion, the colour grade of the
 * selected preset and real transitions blended with the previous frame.
 */
import { clamp } from './util.js';
import { coverRect, containRect } from './framing.js';

export const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){
  // uv is *top-down* like a DOM image and like the analysis focus coordinates:
  // (0,0) = top-left of the frame. aPos.y = +1 is the top of the frame in clip
  // space, so the y axis is flipped here on purpose.
  vUv = vec2(aPos.x, -aPos.y) * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;
uniform sampler2D uPrev;

uniform vec2  uRes;          // output resolution (px)
uniform vec2  uSrcSize;      // source resolution (px)
uniform float uCoverScale;   // source px -> canvas px
uniform vec2  uCoverCenter;  // CENTRE of the visible src region (src px, top-down)
uniform float uFlipX;        // 1 = mirror the sampled frame horizontally
uniform float uFlipY;        // 1 = flip the sampled frame vertically
uniform float uZoom;
uniform vec2  uPan;          // canvas px
uniform float uRot;
uniform vec2  uFocus;        // 0..1 in source

uniform vec3  uLift;
uniform vec3  uGain;
uniform float uExposure;
uniform float uContrast;
uniform float uSat;
uniform float uVibrance;
uniform float uTemp;
uniform float uTint;
uniform float uGamma;
uniform float uFade;
uniform float uVignette;
uniform float uGrain;
uniform float uSharpen;
uniform float uChroma;
uniform float uBloom;
uniform float uScan;
uniform float uHue;
uniform float uLetterbox;
uniform float uFraming;      // 0 = fill the frame (cover), 1 = show the whole frame (contain)
uniform float uTime;

uniform int   uTransType;  // 0 none 1 fade 2 flash 3 zoomblur 4 whip 5 glitch 6 slide 7 zoom 8 lightleak 9 spin
uniform float uTrans;      // 0..1
uniform vec2  uTransDir;
uniform float uHasPrev;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec2 mapUv(vec2 cv, out float inside){
  vec2 p = (cv - 0.5) * uRes - uPan;
  p /= uZoom;
  float cs = cos(uRot), sn = sin(uRot);
  p = mat2(cs, -sn, sn, cs) * p;
  // p is measured from the centre of the frame, so the window is anchored by its
  // own centre — passing the top-left corner here shifts the crop by half a window.
  vec2 srcPx = p / uCoverScale + uCoverCenter;
  vec2 uv = srcPx / uSrcSize;
  // Orientation lives here, in the shader, and nowhere else: every upload is
  // UNPACK_FLIP_Y_WEBGL = false (see upload()), so the texture is always top-down
  // and no driver can disagree with another driver about images vs video frames.
  // These two flags are measured per device by probeRenderOrientation().
  uv = vec2(mix(uv.x, 1.0 - uv.x, uFlipX), mix(uv.y, 1.0 - uv.y, uFlipY));
  inside = (uv.x > -0.002 && uv.x < 1.002 && uv.y > -0.002 && uv.y < 1.002) ? 1.0 : 0.0;
  return uv;
}

// The previous shot is snapshotted *after* compositing, so it lives in output uv space
// (0..1 of the canvas) — no cover mapping needed, just the parallax offset.
vec3 fetchPrev(vec2 uv){
  // The snapshot is our own output canvas, uploaded the same way (no driver flip),
  // so it already lives in output uv space — flipping it here would double-flip it.
  return texture(uPrev, clamp(uv, 0.0, 1.0)).rgb;
}

vec3 grade(vec3 col, vec2 uv){
  col *= uExposure;
  // white balance
  col.r *= 1.0 + uTemp * 0.22;
  col.b *= 1.0 - uTemp * 0.22;
  col.g *= 1.0 + uTint * 0.12;
  col.r *= 1.0 - uTint * 0.06;
  col.b *= 1.0 - uTint * 0.06;
  col *= uGain;
  col += uLift;
  // contrast around 0.5
  col = (col - 0.5) * uContrast + 0.5;
  // gamma
  col = pow(max(col, 0.0), vec3(1.0 / max(0.2, uGamma)));
  // saturation + vibrance
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(max(col.r, col.g), col.b);
  float mn = min(min(col.r, col.g), col.b);
  float sat = mx - mn;
  col = mix(vec3(luma), col, uSat);
  col = mix(vec3(luma), col, 1.0 + uVibrance * (1.0 - clamp(sat, 0.0, 1.0)));
  // hue rotate
  if (abs(uHue) > 0.001) {
    vec3 hsv = rgb2hsv(col);
    hsv.x = fract(hsv.x + uHue);
    col = hsv2rgb(hsv);
  }
  // film fade (lifted blacks)
  col = mix(col, vec3(0.09, 0.09, 0.12) + col * 0.86, uFade);
  // scanlines
  if (uScan > 0.001) {
    float sl = 0.5 + 0.5 * sin(vUv.y * uRes.y * 1.7 + uTime * 2.0);
    col *= 1.0 - uScan * 0.35 * sl;
  }
  return col;
}

void main(){
  vec2 uv = vUv;
  float tp = smoothstep(0.0, 1.0, clamp(uTrans, 0.0, 1.0));

  // ---- per-transition geometry on the incoming frame ----
  vec2 warp = vec2(0.0);
  float zoomMul = 1.0, rotAdd = 0.0;
  if (uTransType == 6) {                      // slide
    warp.x = (1.0 - tp) * uTransDir.x;
    warp.y = (1.0 - tp) * uTransDir.y;
  } else if (uTransType == 7) {               // zoom in
    zoomMul = mix(1.35, 1.0, tp);
  } else if (uTransType == 9) {               // spin
    rotAdd = (1.0 - tp) * 0.55 * (uTransDir.x >= 0.0 ? 1.0 : -1.0);
    zoomMul = mix(1.25, 1.0, tp);
  } else if (uTransType == 4) {               // whip pan
    warp.x = (1.0 - tp) * 0.35 * uTransDir.x;
    zoomMul = mix(1.12, 1.0, tp);
  }

  vec2 cv = uv + warp;
  vec2 cvPrev = uv - warp * 0.6;
  float inside;
  vec2 muv = mapUv(cv, inside);
  vec3 col = texture(uTex, clamp(muv, 0.0, 1.0)).rgb;

  // ---- framing: contain puts the whole picture inside a blurred backdrop ----
  float fx = 1.0;                       // punch-in effects only make sense when filled
  if (uFraming > 0.5) {
    float srcA = uSrcSize.x / max(1.0, uSrcSize.y);
    float outA = uRes.x / max(1.0, uRes.y);
    vec2 vis = (srcA > outA) ? vec2(1.0, outA / srcA) : vec2(srcA / outA, 1.0);
    vec2 off = (1.0 - vis) * 0.5;
    vec2 uvf = (uv - off) / vis;
    bool inFit = uvf.x > 0.0 && uvf.x < 1.0 && uvf.y > 0.0 && uvf.y < 1.0;
    // the backdrop reuses the cover sample, blurred with a cheap 5-tap disc
    vec2 br = vec2(30.0) / max(uRes.x, uRes.y);
    vec3 bg = texture(uTex, clamp(muv, 0.0, 1.0)).rgb * 0.36;
    bg += texture(uTex, clamp(muv + vec2(br.x, 0.0), 0.0, 1.0)).rgb * 0.16;
    bg += texture(uTex, clamp(muv - vec2(br.x, 0.0), 0.0, 1.0)).rgb * 0.16;
    bg += texture(uTex, clamp(muv + vec2(0.0, br.y), 0.0, 1.0)).rgb * 0.16;
    bg += texture(uTex, clamp(muv - vec2(0.0, br.y), 0.0, 1.0)).rgb * 0.16;
    bg = mix(bg, vec3(dot(bg, vec3(0.2126, 0.7152, 0.0722))), 0.3) * 0.62;
    col = inFit ? texture(uTex, clamp(uvf, 0.0, 1.0)).rgb : bg;
    fx = 0.0;
  }

  // sharper look through a light unsharp mask
  if (uSharpen > 0.001 * fx) {
    vec2 t = 1.6 / uSrcSize;
    vec3 blur = (
      texture(uTex, clamp(muv + vec2(t.x, 0.0), 0.0, 1.0)).rgb +
      texture(uTex, clamp(muv - vec2(t.x, 0.0), 0.0, 1.0)).rgb +
      texture(uTex, clamp(muv + vec2(0.0, t.y), 0.0, 1.0)).rgb +
      texture(uTex, clamp(muv - vec2(0.0, t.y), 0.0, 1.0)).rgb) * 0.25;
    col += (col - blur) * uSharpen * 2.2 * fx;
  }
  // chroma aberration
  if (uChroma > 0.001 * fx) {
    vec2 d = (muv - 0.5) * uChroma * 0.012 * fx;
    col.r = texture(uTex, clamp(muv + d, 0.0, 1.0)).r;
    col.b = texture(uTex, clamp(muv - d, 0.0, 1.0)).b;
  }
  // soft bloom on highlights
  if (uBloom > 0.001 * fx) {
    vec3 sum = vec3(0.0);
    vec2 r = vec2(5.0) / uSrcSize;
    sum += texture(uTex, clamp(muv + vec2(r.x, 0.0), 0.0, 1.0)).rgb;
    sum += texture(uTex, clamp(muv - vec2(r.x, 0.0), 0.0, 1.0)).rgb;
    sum += texture(uTex, clamp(muv + vec2(0.0, r.y), 0.0, 1.0)).rgb;
    sum += texture(uTex, clamp(muv - vec2(0.0, r.y), 0.0, 1.0)).rgb;
    sum += texture(uTex, clamp(muv + r * 0.7, 0.0, 1.0)).rgb;
    sum += texture(uTex, clamp(muv - r * 0.7, 0.0, 1.0)).rgb;
    vec3 avg = sum / 6.0;
    float lum = dot(avg, vec3(0.2126, 0.7152, 0.0722));
    col += avg * uBloom * smoothstep(0.55, 0.95, lum) * 0.9 * fx;
  }

  col = grade(col, uv);

  // ---- blend with the previous shot during a transition ----
  if (uTransType != 0 && uHasPrev > 0.5 && tp < 1.0) {
    vec3 prev = fetchPrev(cvPrev);
    prev = grade(prev, uv);
    float a = tp;
    if (uTransType == 1) {                       // fade
      col = mix(prev, col, smoothstep(0.0, 1.0, a));
    } else if (uTransType == 2) {                // flash
      col = mix(prev, col, smoothstep(0.0, 1.0, a));
      float f = 1.0 - abs(a - 0.5) * 2.0;
      col = mix(col, vec3(1.0), pow(f, 1.6) * 0.9);
    } else if (uTransType == 3) {                // zoom blur
      vec3 z = vec3(0.0);
      float w = 0.0;
      for (int i = 0; i < 7; i++) {
        float k = float(i) / 6.0;
        float sc = 1.0 + k * 0.16 * (1.0 - a);
        vec2 pp = (uv - 0.5) * sc + 0.5 + warp * (1.0 - k * 0.4);
        float ins;
        vec2 uvc = mapUv(pp, ins);
        z += texture(uTex, clamp(uvc, 0.0, 1.0)).rgb * (1.0 - k * 0.5);
        w += (1.0 - k * 0.5);
      }
      vec3 blended = mix(prev, z / w, smoothstep(0.0, 1.0, a));
      col = mix(blended, col, smoothstep(0.55, 1.0, a));
    } else if (uTransType == 5) {                // glitch
      float blocks = 14.0;
      float band = floor(uv.y * blocks + hash(vec2(floor(uTime * 24.0), 3.0)) * 2.0);
      float shift = (hash(vec2(band, floor(uTime * 30.0))) - 0.5) * 0.14 * (1.0 - a);
      vec2 gv = uv + vec2(shift, 0.0);
      float ins;
      vec2 uvg = mapUv(gv, ins);
      vec3 g = texture(uTex, clamp(uvg + vec2(0.006, 0.0) * (1.0 - a), 0.0, 1.0)).rgb;
      g.g = texture(uTex, clamp(uvg, 0.0, 1.0)).g;
      g.b = texture(uTex, clamp(uvg - vec2(0.006, 0.0) * (1.0 - a), 0.0, 1.0)).b;
      col = mix(prev, grade(g, uv), pow(a, 0.6));
    } else if (uTransType == 8) {                // light leak
      col = mix(prev, col, smoothstep(0.0, 1.0, a));
      float sweep = smoothstep(0.0, 1.0, 1.0 - abs(a - 0.35) * 2.2);
      vec3 leak = vec3(1.0, 0.72, 0.36);
      float grad = uv.x * (uTransDir.x >= 0.0 ? 1.0 : -1.0) * 0.5 + 0.5;
      col += leak * sweep * pow(grad, 1.5) * 0.75;
    } else if (uTransType == 4) {                // whip
      col = mix(prev, col, smoothstep(0.0, 1.0, a));
    } else {
      col = mix(prev, col, smoothstep(0.0, 1.0, a));
    }
  }

  // ---- focus pull / vignette / grain ----
  if (uVignette > 0.001) {
    // lean the vignette toward the detected subject instead of the frame centre
    vec2 vc = mix(vec2(0.5, 0.46), clamp(uFocus, 0.0, 1.0), 0.22);
    vec2 d = (uv - vc) * vec2(1.05, 1.0);
    float v = smoothstep(0.35, 0.95, length(d) * 1.35);
    col *= 1.0 - uVignette * v;
  }
  if (uGrain > 0.001) {
    float n = hash(uv * uRes + uTime * 91.7) - 0.5;
    col += n * uGrain * 0.55;
  }
  if (uLetterbox > 0.001) {
    float bar = uLetterbox;
    if (uv.y < bar || uv.y > 1.0 - bar) col = vec3(0.0);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('Shader error: ' + log);
  }
  return s;
}

export function createGLRenderer(canvas, { flipX = 0, flipY = 0 } = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;

  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    }
  } catch (e) {
    // A driver that rejects our GLSL must never blank the preview: the 2D
    // compositor is slower and simpler, but it always draws.
    console.warn('[reelforge] WebGL disabled —', e.message);
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
    return null;
  }
  gl.useProgram(prog);

  // THE driver flag is a trap: Android drivers apply UNPACK_FLIP_Y_WEBGL per source
  // type (an image upload is flipped, a video frame often is not), which is exactly
  // how a phone ended up showing photos upright and videos «۱۸۰ درجه چرخیده».
  // So it is forced off for every upload, and orientation is done in mapUv() instead
  // (uFlipX/uFlipY). One code path, one answer, on every device.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  let flipYValue = flipY ? 1 : 0;
  let flipXValue = flipX ? 1 : 0;

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  const names = [
    'uRes', 'uSrcSize', 'uCoverScale', 'uCoverCenter', 'uFlipX', 'uFlipY', 'uZoom', 'uPan', 'uRot', 'uFocus',
    'uLift', 'uGain', 'uExposure', 'uContrast', 'uSat', 'uVibrance', 'uTemp', 'uTint', 'uGamma',
    'uFade', 'uVignette', 'uGrain', 'uSharpen', 'uChroma', 'uBloom', 'uScan', 'uHue', 'uLetterbox', 'uFraming',
    'uTime', 'uTransType', 'uTrans', 'uTransDir', 'uHasPrev', 'uTex', 'uPrev',
  ];
  for (const n of names) U[n] = gl.getUniformLocation(prog, n);

  function makeTexture() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  const texCurrent = makeTexture();
  const texPrev = makeTexture();
  gl.useProgram(prog);
  gl.uniform1i(U.uTex, 0);
  gl.uniform1i(U.uPrev, 1);

  // 1x1 black placeholder for the previous frame
  const blank = new Uint8Array([0, 0, 0, 255]);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texPrev);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blank);

  let hasPrev = false;

  function upload(textureUnit, texture, source) {
    gl.activeTexture(textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // re-assert on every upload: this is global context state, not per-texture
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // A <video> is the one source type whose texture layout the driver decides on its
    // own (the decoder hands over a hardware frame). Drawing the frame into a canvas
    // first — the exact path photos and the self-test already use — makes preview and
    // export agree with each other and with the photos. One blit per rendered frame.
    let src = source;
    if (isVideoSource(source)) {
      src = drawSourceToScratch(source, canvas.ownerDocument);
      // No scratch frame means the video has not decoded yet. Uploading the raw
      // <video> here would bring the driver's per-source-type flip back in, so the
      // previous texture simply stays on screen for one frame.
      if (!src) return false;
    }
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      return true;
    } catch (e) {
      // some sources (video without a decoded frame) throw; keep the old texture
      return false;
    }
  }

  return {
    gl,
    canvas,
    /** Orientation correction measured by probeRenderOrientation. */
    setFlipY(v) { flipYValue = v ? 1 : 0; },
    setFlipX(v) { flipXValue = v ? 1 : 0; },
    setFlip(x, y) { flipXValue = x ? 1 : 0; flipYValue = y ? 1 : 0; },
    get flipY() { return flipYValue; },
    get flipX() { return flipXValue; },
    resize(w, h) {
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      gl.viewport(0, 0, w, h);
    },
    /** Snapshot the current canvas so the next frame can blend against it. */
    snapshotPrev() {
      upload(gl.TEXTURE1, texPrev, canvas);
      hasPrev = true;
    },
    resetPrev() { hasPrev = false; },
    draw({
      source,
      srcWidth,
      srcHeight,
      grade,
      zoom = 1,
      pan = [0, 0],
      rotation = 0,
      focus = [0.5, 0.42],
      transition = null,
      time = 0,
      letterbox = 0,
      framing = 0,
    }) {
      const w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      // cover mapping
      const scale = Math.max(w / srcWidth, h / srcHeight);
      const visW = w / scale, visH = h / scale;
      let ox = (srcWidth - visW) / 2;
      let oy = (srcHeight - visH) / 2;
      // bias the crop toward the detected point of interest (faces/centres)
      const fx = clamp(focus[0], 0, 1), fy = clamp(focus[1], 0, 1);
      const wantX = clamp(fx * srcWidth - visW * 0.5, 0, Math.max(0, srcWidth - visW));
      const wantY = clamp(fy * srcHeight - visH * 0.42, 0, Math.max(0, srcHeight - visH));
      ox = ox * 0.35 + wantX * 0.65;
      oy = oy * 0.35 + wantY * 0.65;

      const uploaded = upload(gl.TEXTURE0, texCurrent, source);

      gl.uniform2f(U.uRes, w, h);
      gl.uniform2f(U.uSrcSize, srcWidth, srcHeight);
      gl.uniform1f(U.uCoverScale, scale);
      gl.uniform2f(U.uCoverCenter, ox + visW / 2, oy + visH / 2);
      gl.uniform1f(U.uFlipX, flipXValue);
      gl.uniform1f(U.uFlipY, flipYValue);
      gl.uniform1f(U.uZoom, zoom);
      gl.uniform2f(U.uPan, pan[0], pan[1]);
      gl.uniform1f(U.uRot, rotation);
      gl.uniform2f(U.uFocus, fx, fy);
      gl.uniform3fv(U.uLift, grade.lift);
      gl.uniform3fv(U.uGain, grade.gain);
      gl.uniform1f(U.uExposure, grade.exposure);
      gl.uniform1f(U.uContrast, grade.contrast);
      gl.uniform1f(U.uSat, grade.saturation);
      gl.uniform1f(U.uVibrance, grade.vibrance);
      gl.uniform1f(U.uTemp, grade.temperature);
      gl.uniform1f(U.uTint, grade.tint);
      gl.uniform1f(U.uGamma, grade.gamma);
      gl.uniform1f(U.uFade, grade.fade);
      gl.uniform1f(U.uVignette, grade.vignette);
      gl.uniform1f(U.uGrain, grade.grain);
      gl.uniform1f(U.uSharpen, grade.sharpen);
      gl.uniform1f(U.uChroma, grade.chroma);
      gl.uniform1f(U.uBloom, grade.bloom);
      gl.uniform1f(U.uScan, grade.scanlines);
      gl.uniform1f(U.uHue, grade.hueShift || 0);
      gl.uniform1f(U.uLetterbox, letterbox);
      gl.uniform1f(U.uFraming, framing ? 1 : 0);
      gl.uniform1f(U.uTime, time);

      const tr = transition?.type && transition.type !== 'cut' ? transition : null;
      const typeMap = { fade: 1, flash: 2, zoomblur: 3, whip: 4, glitch: 5, slide: 6, zoom: 7, lightleak: 8, spin: 9 };
      gl.uniform1i(U.uTransType, tr ? (typeMap[tr.type] || 1) : 0);
      gl.uniform1f(U.uTrans, tr ? clamp(tr.progress, 0, 1) : 1);
      gl.uniform2f(U.uTransDir, tr?.dir?.[0] ?? 1, tr?.dir?.[1] ?? 0);
      gl.uniform1f(U.uHasPrev, tr && hasPrev ? 1 : 0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return uploaded !== false;
    },
  };
}

/** True for <video> (and VideoFrame) sources, whatever wrapper they arrive in. */
export function isVideoSource(source) {
  if (!source) return false;
  if (source.nodeName === 'VIDEO') return true;
  return typeof source.videoWidth === 'number' && typeof source.play === 'function';
}

let scratchCanvas = null;
/**
 * Draws one video frame into a reusable canvas of the source's own size.
 * @returns {HTMLCanvasElement|null} null when the frame is not ready yet.
 */
export function drawSourceToScratch(source, doc, size = null) {
  if (!doc?.createElement) return null;
  const w = Math.round(size?.w || source.videoWidth || source.width || 0);
  const h = Math.round(size?.h || source.videoHeight || source.height || 0);
  if (!w || !h) return null;
  if (!scratchCanvas || scratchCanvas.ownerDocument !== doc) scratchCanvas = doc.createElement('canvas');
  if (scratchCanvas.width !== w) scratchCanvas.width = w;
  if (scratchCanvas.height !== h) scratchCanvas.height = h;
  const ctx = scratchCanvas.getContext?.('2d', { alpha: false });
  if (!ctx?.drawImage) return null;
  try {
    ctx.drawImage(source, 0, 0, w, h);
  } catch {
    return null;      // frame not decoded yet — the previous texture stays on screen
  }
  return scratchCanvas;
}

/** A do-nothing grade, used by the orientation self-test. */
export const NEUTRAL_GRADE = {
  lift: [0, 0, 0], gain: [1, 1, 1], exposure: 1, contrast: 1, saturation: 1, vibrance: 0,
  temperature: 0, tint: 0, gamma: 1, fade: 0, vignette: 0, grain: 0, sharpen: 0,
  chroma: 0, bloom: 0, scanlines: 0, hueShift: 0, letterbox: 0,
};

/** 2D-canvas fallback compositor (no WebGL available). */
export function create2DRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  return {
    canvas,
    fallback: true,
    resize(w, h) { canvas.width = w; canvas.height = h; },
    snapshotPrev() {},
    resetPrev() {},
    draw({ source, srcWidth, srcHeight, grade, zoom = 1, pan = [0, 0], transition = null, time = 0, focus = [0.5, 0.42], framing = 0 }) {
      const w = canvas.width, h = canvas.height;
      const cover = coverRect(srcWidth, srcHeight, w, h, { zoom, focus, pan });
      const { x, y, w: dw, h: dh } = cover;
      if (framing) {
        // blurred cover as the backdrop, then the whole picture inside it
        const fit = containRect(srcWidth, srcHeight, w, h);
        ctx.save();
        ctx.filter = 'blur(26px) brightness(0.55) saturate(0.75)';
        ctx.drawImage(source, x, y, dw, dh);
        ctx.restore();
        ctx.drawImage(source, fit.x, fit.y, fit.w, fit.h);
      }
      ctx.save();
      ctx.filter = [
        `brightness(${grade.exposure})`,
        `contrast(${grade.contrast})`,
        `saturate(${grade.saturation + grade.vibrance * 0.4})`,
        grade.saturation < 0.15 ? 'grayscale(1)' : '',
        `sepia(${Math.max(0, grade.temperature) * 0.35})`,
      ].filter(Boolean).join(' ');
      if (!framing) ctx.drawImage(source, x, y, dw, dh);
      ctx.restore();
      if (transition?.type && transition.type !== 'cut') {
        ctx.fillStyle = transition.type === 'flash'
          ? `rgba(255,255,255,${Math.max(0, 1 - Math.abs(transition.progress - 0.5) * 2) * 0.85})`
          : `rgba(0,0,0,${(1 - transition.progress) * 0.9})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (grade.vignette > 0.01) {
        const g = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.25, w / 2, h * 0.46, Math.max(w, h) * 0.72);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${grade.vignette})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      if (grade.fade > 0.01) {
        ctx.fillStyle = `rgba(20,20,26,${grade.fade * 0.8})`;
        ctx.fillRect(0, 0, w, h);
      }
    },
  };
}
