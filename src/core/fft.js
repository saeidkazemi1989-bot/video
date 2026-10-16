/**
 * Minimal radix-2 FFT + helpers used by the beat detector.
 * Everything works on Float32Array to stay fast on phones.
 */

export class FFT {
  constructor(size) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.size = size;
    this.rev = new Uint32Array(size);
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let x = i, r = 0;
      for (let j = 0; j < bits; j++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r >>> 0;
    }
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /** in-place complex transform of this.re/this.im */
  transform() {
    const { size, rev, re, im, cos, sin } = this;
    for (let i = 0; i < size; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const step = size / len;
      for (let i = 0; i < size; i += len) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const wr = cos[tw], wi = sin[tw];
          const xr = re[i + k + half] * wr - im[i + k + half] * wi;
          const xi = re[i + k + half] * wi + im[i + k + half] * wr;
          const ur = re[i + k], ui = im[i + k];
          re[i + k] = ur + xr; im[i + k] = ui + xi;
          re[i + k + half] = ur - xr; im[i + k + half] = ui - xi;
        }
      }
    }
  }

  /** magnitude spectrum of a real-valued window (fills `out`, length size/2) */
  magnitudes(input, out) {
    const { size, re, im } = this;
    re.set(input.subarray(0, size));
    im.fill(0);
    this.transform();
    const half = size >> 1;
    for (let i = 0; i < half; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
  }
}

export function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

/** Moving average of a Float32Array with a given radius (edge-clamped). */
export function movingAverage(arr, radius) {
  const n = arr.length;
  const out = new Float32Array(n);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) sum += arr[Math.max(0, Math.min(n - 1, i))];
  const w = radius * 2 + 1;
  for (let i = 0; i < n; i++) {
    out[i] = sum / w;
    const add = arr[Math.min(n - 1, i + radius + 1)];
    const sub = arr[Math.max(0, i - radius)];
    sum += add - sub;
  }
  return out;
}

export function stdDev(arr, mean) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) m += arr[i];
  m = mean ?? m / arr.length;
  let s = 0;
  for (let i = 0; i < arr.length; i++) { const d = arr[i] - m; s += d * d; }
  return Math.sqrt(s / arr.length);
}

export function mean(arr) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) m += arr[i];
  return m / (arr.length || 1);
}

/** Normalised autocorrelation over a lag range (used for tempo). */
export function autocorr(signal, minLag, maxLag) {
  const n = signal.length;
  let mu = mean(signal);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = signal[i] - mu;
  const out = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0, den = 0;
    for (let i = 0; i + lag < n; i++) { num += x[i] * x[i + lag]; den += x[i] * x[i]; }
    out[lag] = den > 0 ? num / den : 0;
  }
  return out;
}
