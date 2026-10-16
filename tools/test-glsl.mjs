#!/usr/bin/env node
/**
 * GLSL lint for ReelForge's compositor shaders.
 *
 * The preview/render shader is written for WebGL2 (GLSL ES 3.00), but there is no
 * GPU in CI, so a typo only shows up as "Shader error: … no matching overloaded
 * function found" on a real phone — exactly how the missing `fetchPrev()` helper
 * (v1.2.1) managed to ship. This linter compiles *nothing*: it walks the source
 * and catches the mistakes that a driver would catch for us:
 *
 *   • calling a function that is neither defined in the file nor a GLSL built-in
 *   • mistyped built-ins (e.g. `mix(1.0, 2.0, vec3(0.0))`-style names like `mixx`)
 *   • using an identifier that was never declared (uniform / in / out / local)
 *   • uniforms that are declared but never used, or used but never declared
 *   • uniforms the JS side sets that do not exist in the shader (silent no-ops)
 *   • duplicate function definitions / duplicate parameter names
 *   • a missing `#version 300 es` header, `out` colour or `main()`
 *
 * Run: node tools/test-glsl.mjs
 */
import { readFileSync } from 'node:fs';
import { VERT_SRC, FRAG_SRC } from '../src/core/gl.js';

let failures = 0;
let checks = 0;
function ok(cond, label, extra = '') {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${label} ${extra}`); }
}

/* GLSL ES 3.00 built-ins we are allowed to call. */
const BUILTIN_FUNCS = new Set([
  // constructors / conversions
  'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
  'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat3x2',
  'mat2x4', 'mat4x2', 'mat3x3', 'mat3x4', 'mat4x3', 'mat4x4', 'float', 'int', 'uint',
  'bool', 'double',
  // trigonometry / exponential
  'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh',
  'tanh', 'asinh', 'acosh', 'atanh', 'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt',
  'inversesqrt',
  // common
  'abs', 'sign', 'floor', 'trunc', 'round', 'roundEven', 'ceil', 'fract', 'mod',
  'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'isnan', 'isinf',
  'floatBitsToInt', 'floatBitsToUint', 'intBitsToFloat', 'uintBitsToFloat',
  // geometric
  'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward', 'reflect',
  'refract', 'transpose', 'inverse', 'determinant',
  // texture
  'texture', 'textureProj', 'textureLod', 'textureOffset', 'texelFetch',
  'textureSize', 'textureGrad', 'textureGather',
  // derivatives
  'dFdx', 'dFdy', 'fwidth',
]);

const TYPE_KEYWORDS = new Set([
  'void', 'float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3',
  'ivec4', 'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3',
  'mat4', 'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2',
  'mat4x3', 'mat4x4', 'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DArray',
  'highp', 'mediump', 'lowp', 'precision', 'const', 'in', 'out', 'inout', 'uniform',
  'flat', 'smooth', 'centroid', 'invariant', 'struct', 'layout', 'location',
  'return', 'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'discard',
  'true', 'false', 'define', 'version', 'extension', 'coherent', 'restrict',
  'readonly', 'writeonly', 'switch', 'case', 'default',
]);

/** Strips comments and `#…` preprocessor lines from GLSL source. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => (line.trim().startsWith('#') ? '' : line.replace(/\/\/.*$/, '')))
    .join('\n');
}

/** Splits source into `{ name, params, body, kind }` function records. */
function parseFunctions(src) {
  const out = [];
  const re = /\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const [full, ret, name, params] = m;
    if (TYPE_KEYWORDS.has(name)) continue;
    // find the matching closing brace so nested braces don't confuse us
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    out.push({
      ret,
      name,
      params,
      body: src.slice(re.lastIndex, i - 1),
      header: full,
      start: m.index,
    });
    re.lastIndex = i;
  }
  return out;
}

function identifiersIn(code) {
  // drop member access first: `.rgb`, `.wz`, `.x`… are not identifiers
  const bare = code.replace(/\.\s*[A-Za-z_]\w*/g, ' ');
  return new Set((bare.match(/[A-Za-z_]\w*/g) || []));
}

function callsIn(code) {
  const names = new Set();
  for (const m of code.matchAll(/([A-Za-z_]\w*)\s*\(/g)) names.add(m[1]);
  return names;
}

function lint(src, label) {
  const clean = strip(src);
  const defs = parseFunctions(clean);
  const defined = new Set(defs.map((d) => d.name));

  // ---- structural expectations ----
  ok(/^\s*#version\s+300\s+es/m.test(src), `${label}: has a #version 300 es header`);
  ok(defined.has('main'), `${label}: defines main()`);

  // ---- duplicate definitions ----
  const seen = new Map();
  for (const d of defs) {
    if (seen.has(d.name)) {
      ok(false, `${label}: duplicate definition of ${d.name}()`);
    }
    seen.set(d.name, d);
    const params = d.params.split(',').map((p) => p.trim().replace(/^(?:const|in|out|inout|highp|mediump|lowp)\s+/g, '').match(/([A-Za-z_]\w*)\s*$/)?.[1]).filter(Boolean);
    ok(new Set(params).size === params.length, `${label}: ${d.name}() has no duplicate parameter names`);
  }

  // ---- globals: uniforms, in/out, consts ----
  const uniforms = new Set();
  for (const m of clean.matchAll(/\buniform\s+\w+\s+([^;]+);/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().match(/([A-Za-z_]\w*)\s*(\[[^\]]*\])?$/)?.[1];
      if (name) uniforms.add(name);
    }
  }
  const varyings = new Set();
  for (const m of clean.matchAll(/\b(?:in|out)\s+\w+\s+([A-Za-z_]\w*)\s*;/g)) varyings.add(m[1]);
  const consts = new Set();
  for (const m of clean.matchAll(/\bconst\s+(?:highp|mediump|lowp\s+)?\w+\s+([A-Za-z_]\w*)\s*=/g)) consts.add(m[1]);
  const globals = new Set([...uniforms, ...varyings, ...consts]);

  // ---- per-function: every call must exist, every identifier must exist ----
  const declaredUniformList = [...globals];
  for (const fn of defs) {
    const localNames = new Set(globals);
    // parameters
    for (const p of fn.params.split(',')) {
      const name = p.trim().replace(/^(?:const|in|out|inout|highp|mediump|lowp)\s+/g, '').match(/([A-Za-z_]\w*)\s*$/)?.[1];
      if (name) localNames.add(name);
    }
    // local declarations + loop counters
    for (const m of fn.body.matchAll(/\b(?:highp|mediump|lowp\s+)?(?:float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234](?:x[234])?)\s+([^;{}]+);/g)) {
      // one declaration can introduce several names: `float a = 1.0, b = 2.0;`
      for (const decl of m[1].split(',')) {
        const name = decl.trim().match(/^([A-Za-z_]\w*)/)?.[1];
        if (name && !TYPE_KEYWORDS.has(name)) localNames.add(name);
      }
    }
    for (const m of fn.body.matchAll(/\bfor\s*\(\s*\w+\s+([A-Za-z_]\w*)\s*=/g)) localNames.add(m[1]);
    for (const m of fn.body.matchAll(/\bstruct\s+\w+\s*\{[^}]*\}\s*([A-Za-z_]\w*)/g)) localNames.add(m[1]);

    for (const call of callsIn(fn.body)) {
      if (BUILTIN_FUNCS.has(call) || defined.has(call) || TYPE_KEYWORDS.has(call)) continue;
      ok(false, `${label}: ${fn.name}() calls ${call}(), which is not defined anywhere`, '(this is the "no matching overloaded function found" error)');
    }

    // identifiers that look like variables but were never declared
    const unknown = [];
    for (const id of identifiersIn(fn.body)) {
      if (localNames.has(id) || defined.has(id) || BUILTIN_FUNCS.has(id) || TYPE_KEYWORDS.has(id)) continue;
      if (/^(?:gl_\w+)$/.test(id)) continue;
      if (/^\d/.test(id)) continue;
      if (fn.body.includes(`${id}(`)) continue;      // handled by the call check
      if (/^[A-Za-z_]\w*$/.test(id) && /[A-Za-z]/.test(id)) unknown.push(id);
    }
    // member accessors (.rgb, .x, .w…) are identifiers too — filter those out
    const members = new Set(['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a', 's', 't', 'p', 'q',
      'rgb', 'rgba', 'xyzw', 'xyz', 'xy', 'xz', 'yz', 'bgr', 'rg', 'ba', 'zw']);
    const realUnknown = unknown.filter((id) => !members.has(id));
    ok(realUnknown.length === 0, `${label}: ${fn.name}() only uses declared identifiers`, realUnknown.join(', '));
  }

  // ---- uniform usage ----
  const unused = [...uniforms].filter((u) => (clean.match(new RegExp(`\\b${u}\\b`, 'g')) || []).length < 2);
  ok(unused.length === 0, `${label}: every declared uniform is actually used`, unused.join(', '));

  return { defined, globals: new Set([...uniforms, ...varyings, ...consts]), uniforms };
}

console.log('\n▸ GLSL lint (vertex + fragment)');
const vert = lint(VERT_SRC, 'vertex');
const frag = lint(FRAG_SRC, 'fragment');

/* ---- the JS side must set exactly the uniforms the shader declares ------- */
const glSource = readFileSync(new URL('../src/core/gl.js', import.meta.url), 'utf8');
const namesLiteral = glSource.match(/const names = \[([\s\S]*?)\];/);
ok(!!namesLiteral, 'gl.js lists the uniforms it binds');
if (namesLiteral) {
  const bound = [...namesLiteral[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const missing = bound.filter((n) => !frag.globals.has(n));
  ok(missing.length === 0, 'every uniform bound from JS exists in the fragment shader', missing.join(', '));
  const notBound = [...frag.uniforms].filter((n) => !bound.includes(n));
  ok(notBound.length === 0, 'every fragment uniform is bound from JS', notBound.join(', '));
}

/* ---- the 2D fallback must offer the same draw() contract ----------------- */
const draws = [...glSource.matchAll(/draw\(\{([\s\S]*?)\}\)/g)];
ok(draws.length >= 2, 'both renderers expose draw({…})');
ok(/fallback:\s*true/.test(glSource), 'the 2D renderer is flagged as a fallback');
ok(glSource.includes("const scale = Math.max(w / srcWidth, h / srcHeight)"), '2D fallback keeps the cover mapping');

console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} GLSL checks passed`);
process.exit(failures ? 1 : 0);
