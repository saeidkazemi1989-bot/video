/**
 * Procedural music engine — a real, royalty-free sound library generated on
 * the phone (WebAudio OfflineAudioContext), so the user never has to hunt for
 * a track. Because the music is *composed* here, the beat grid is exact
 * (confidence 1.0) and every cut lands on the beat with zero estimation error.
 *
 * 8 genres × arrangement (intro/build/drop/break/drop) with drums, bass,
 * chord pads, plucks, arpeggios, risers, impacts, vinyl noise, reverb & delay.
 */
import { mulberry32, clamp, pick } from './util.js';
import { movingAverage } from './fft.js';

export const GENRES = [
  {
    id: 'lofi', name: 'لو-فای و آرام', icon: '🎧', bpm: 84, mood: 'chill',
    palette: ['#8a7f8d', '#d8c3a5', '#3f3a44'],
    scale: [0, 2, 3, 5, 7, 8, 10], root: 45, // A minor-ish, jazzy
    progressions: [[0, 5, 3, 4], [0, 3, 5, 4], [5, 3, 0, 4]],
    drums: 'soft', hats: 'swing', bass: 'sub', chords: 'rhodes', lead: 'pluck',
    vinyl: 0.5, reverb: 0.5, energy: 0.75,
  },
  {
    id: 'pop', name: 'پاپ شاداب', icon: '🌟', bpm: 104, mood: 'happy',
    palette: ['#ffd166', '#ff6b9d', '#4cc9f0'],
    scale: [0, 2, 4, 5, 7, 9, 11], root: 48, // C major
    progressions: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 3, 4, 4]],
    drums: 'four', hats: 'eighth', bass: 'pluck', chords: 'pad', lead: 'arp',
    vinyl: 0, reverb: 0.35, energy: 1,
  },
  {
    id: 'hiphop', name: 'هیپ‌هاپ / ترپ', icon: '🎤', bpm: 92, mood: 'cool',
    palette: ['#1b1b1f', '#a4f0ff', '#7c5cff'],
    scale: [0, 2, 3, 5, 7, 8, 10], root: 43, // G minor
    progressions: [[0, 5, 3, 4], [0, 3, 5, 5], [5, 4, 0, 3]],
    drums: 'trap', hats: 'rolls', bass: '808', chords: 'rhodes', lead: 'bell',
    vinyl: 0.25, reverb: 0.4, energy: 0.95,
  },
  {
    id: 'house', name: 'هاوس / دنس', icon: '🔊', bpm: 124, mood: 'energetic',
    palette: ['#00e5ff', '#ff2d9b', '#ffe066'],
    scale: [0, 2, 3, 5, 7, 8, 10], root: 45,
    progressions: [[0, 5, 3, 4], [3, 4, 0, 5], [0, 3, 4, 5]],
    drums: 'four', hats: 'sixteenth', bass: 'offbeat', chords: 'stab', lead: 'arp',
    vinyl: 0, reverb: 0.4, energy: 1.05,
  },
  {
    id: 'sport', name: 'پرانرژی ورزشی', icon: '⚡', bpm: 140, mood: 'hype',
    palette: ['#ff3b30', '#ffd60a', '#0b0b0f'],
    scale: [0, 2, 3, 5, 7, 8, 10], root: 41, // F minor
    progressions: [[0, 5, 3, 4], [0, 3, 4, 5]],
    drums: 'hard', hats: 'sixteenth', bass: 'drive', chords: 'stab', lead: 'lead',
    vinyl: 0, reverb: 0.3, energy: 1.15,
  },
  {
    id: 'cinematic', name: 'سینمایی حماسی', icon: '🎻', bpm: 78, mood: 'epic',
    palette: ['#0f2f3f', '#ff8a3d', '#e8e2d6'],
    scale: [0, 2, 3, 5, 7, 8, 10], root: 40, // E minor
    progressions: [[0, 5, 3, 4], [0, 4, 5, 5]],
    drums: 'cinematic', hats: 'none', bass: 'sub', chords: 'strings', lead: 'melody',
    vinyl: 0, reverb: 0.7, energy: 0.9,
  },
  {
    id: 'eastern', name: 'شرقی / سنتی', icon: '🪕', bpm: 96, mood: 'warm',
    palette: ['#c98b5e', '#f2c14e', '#5b3a29'],
    scale: [0, 1, 4, 5, 7, 8, 10], root: 45, // Phrygian dominant (دستگاهی)
    progressions: [[0, 0, 3, 4], [0, 4, 0, 5], [0, 3, 4, 0]],
    drums: 'soft', hats: 'swing', bass: 'pluck', chords: 'pad', lead: 'santur',
    vinyl: 0.15, reverb: 0.5, energy: 0.9,
  },
  {
    id: 'ambient', name: 'آمبینت آرام', icon: '🌫️', bpm: 70, mood: 'calm',
    palette: ['#9fb3c8', '#cfe8ea', '#2f3a44'],
    scale: [0, 2, 5, 7, 10], root: 43, // pentatonic
    progressions: [[0, 0, 2, 1], [0, 2, 0, 1]],
    drums: 'none', hats: 'none', bass: 'none', chords: 'strings', lead: 'bell',
    vinyl: 0.2, reverb: 0.8, energy: 0.55,
  },
];

export function getGenre(id) {
  return GENRES.find((g) => g.id === id) || GENRES[1];
}

/* ------------------------------------------------------------------ */
/* music theory helpers                                                */
/* ------------------------------------------------------------------ */

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function scaleNote(scale, root, degree) {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + scale[idx] + 12 * oct;
}

function chordDegrees(progression, bar, seedRng) {
  const deg = progression[bar % progression.length];
  return [deg, deg + 2, deg + 4, deg + 6];
}

/* ------------------------------------------------------------------ */
/* arrangement                                                         */
/* ------------------------------------------------------------------ */

const SHAPE = [
  { name: 'intro', bars: 2, drums: 0.45, bass: 0, chords: 1, lead: 0, riser: 0 },
  { name: 'verse', bars: 4, drums: 0.9, bass: 1, chords: 1, lead: 0.35, riser: 0 },
  { name: 'build', bars: 2, drums: 1, bass: 0.7, chords: 1, lead: 0.5, riser: 1 },
  { name: 'drop', bars: 8, drums: 1, bass: 1, chords: 0.85, lead: 1, riser: 0 },
  { name: 'break', bars: 4, drums: 0.35, bass: 0.35, chords: 1, lead: 0.6, riser: 0 },
  { name: 'drop2', bars: 8, drums: 1, bass: 1, chords: 0.8, lead: 1, riser: 0 },
  { name: 'outro', bars: 2, drums: 0.4, bass: 0, chords: 1, lead: 0.3, riser: 0 },
];

export function buildArrangement(bpm, maxSeconds = 96) {
  const barSec = (60 / bpm) * 4;
  const targetBars = clamp(Math.round(maxSeconds / barSec), 14, 40);
  const base = SHAPE.reduce((s, x) => s + x.bars, 0);
  const factor = targetBars / base;
  const sections = [];
  let bar = 0;
  SHAPE.forEach((s, i) => {
    let bars = Math.max(i === 0 || i === SHAPE.length - 1 ? 2 : 2, Math.round(s.bars * factor));
    if (i === 0) bars = Math.max(2, Math.min(bars, 2));
    sections.push({ ...s, bars, startBar: bar });
    bar += bars;
  });
  const totalBars = bar;
  return { sections, totalBars, barSec, duration: totalBars * barSec };
}

/* ------------------------------------------------------------------ */
/* synthesis                                                           */
/* ------------------------------------------------------------------ */

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function impulseResponse(ctx, seconds = 2.2, decay = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < ctx.sampleRate * 0.01 ? 0.6 : 1);
    }
  }
  return buf;
}

function createKit(ctx, cfg, dest, rng) {
  const noise = noiseBuffer(ctx, 2);
  const master = ctx.createGain();
  master.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 22;
  comp.ratio.value = 3.4;
  comp.attack.value = 0.006;
  comp.release.value = 0.22;
  const sat = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.35);
  }
  sat.curve = curve;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 26;
  master.connect(comp); comp.connect(sat); sat.connect(hp); hp.connect(dest);

  // ---- shared fx ----
  const reverb = ctx.createConvolver();
  reverb.buffer = impulseResponse(ctx, 2.4, 3.4);
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = cfg.reverb ?? 0.5;
  reverb.connect(reverbGain); reverbGain.connect(master);

  const beat = 60 / cfg.bpm;
  const delay = ctx.createDelay(2);
  delay.delayTime.value = clamp(beat * 0.75, 0.05, 1.8);
  const fb = ctx.createGain();
  fb.gain.value = 0.28;
  const delayTone = ctx.createBiquadFilter();
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 2600;
  const delayGain = ctx.createGain();
  delayGain.gain.value = 0.35;
  delay.connect(delayTone); delayTone.connect(fb); fb.connect(delay);
  delayTone.connect(delayGain); delayGain.connect(master);

  const track = (sendReverb, sendDelay) => {
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(master);
    if (sendReverb) {
      const s = ctx.createGain();
      s.gain.value = sendReverb;
      g.connect(s); s.connect(reverb);
    }
    if (sendDelay) {
      const s = ctx.createGain();
      s.gain.value = sendDelay;
      g.connect(s); s.connect(delay);
    }
    return g;
  };

  const env = (param, t, { attack = 0.004, decay = 0.2, hold = 0, release = 0.05, peak = 1 }) => {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    if (hold > 0) param.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t + attack + hold + Math.max(decay, release));
  };

  const noiseVoice = (t, dur, { gain = 0.2, filter = null, type = 'bandpass', q = 1, decay = null, attack = 0.002, out = null }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 1 + (rng() - 0.5) * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filter?.[0] ?? 1200;
    f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(out || master);
    const d = decay ?? dur;
    env(g.gain, t, { attack, decay: d, peak: gain });
    if (filter && filter.length === 2) {
      f.frequency.setValueAtTime(filter[0], t);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, filter[1]), t + dur);
    }
    src.start(t, rng() * 1.5);
    src.stop(t + dur + 0.05);
    return g;
  };

  const toneVoice = (t, dur, { freq = 220, type = 'sine', gain = 0.2, attack = 0.004, decay = 0.2, detune = 0,
    filter = null, q = 0.8, out = null, glideTo = null, pan = 0 }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + Math.min(0.25, dur * 0.5));
    osc.detune.value = detune;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter ?? 8000;
    f.Q.value = q;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(f); f.connect(g); g.connect(p); p.connect(out || master);
    env(g.gain, t, { attack, decay, peak: gain });
    if (filter && filter.length === 2) {
      f.frequency.setValueAtTime(filter[0], t);
      f.frequency.exponentialRampToValueAtTime(Math.max(80, filter[1]), t + dur);
    }
    osc.start(t);
    osc.stop(t + dur + 0.08);
    return g;
  };

  /* ---------------- drum voices ---------------- */
  const kick = (t, v = 1, style = 'four') => {
    const g = ctx.createGain();
    g.connect(master);
    const o = ctx.createOscillator();
    o.type = 'sine';
    const start = style === '808' ? 90 : 155;
    const end = style === '808' ? 42 : 48;
    o.frequency.setValueAtTime(start, t);
    o.frequency.exponentialRampToValueAtTime(end, t + (style === '808' ? 0.12 : 0.07));
    o.connect(g);
    const dur = style === '808' ? 0.45 : 0.24;
    env(g.gain, t, { attack: 0.002, decay: dur, peak: 0.85 * v });
    o.start(t); o.stop(t + dur + 0.05);
    noiseVoice(t, 0.03, { gain: 0.1 * v, filter: [4200, 900], type: 'highpass', decay: 0.02 });
  };

  const snare = (t, v = 1) => {
    noiseVoice(t, 0.2, { gain: 0.3 * v, filter: [1900, 900], q: 0.8, decay: 0.16, out: track(0.22, 0) });
    toneVoice(t, 0.12, { freq: 190, type: 'triangle', gain: 0.14 * v, decay: 0.1 });
  };

  const clap = (t, v = 1) => {
    for (let i = 0; i < 3; i++) {
      noiseVoice(t + i * 0.009, 0.12, { gain: 0.16 * v, filter: [1500, 800], q: 1.1, decay: 0.09, out: track(0.25, 0) });
    }
    noiseVoice(t + 0.028, 0.22, { gain: 0.12 * v, filter: [1300, 700], q: 0.9, decay: 0.2, out: track(0.3, 0) });
  };

  const hat = (t, v = 1, open = false) => {
    noiseVoice(t, open ? 0.22 : 0.05, {
      gain: (open ? 0.075 : 0.062) * v, filter: [8200, 6000], type: 'highpass',
      decay: open ? 0.16 : 0.032,
    });
  };

  /* ---------------- instruments ---------------- */
  const subBass = (t, freq, dur, v = 1) => toneVoice(t, dur, {
    freq, type: 'sine', gain: 0.34 * v, attack: 0.012, decay: dur * 0.9, filter: 220,
  });

  const pluckBass = (t, freq, dur, v = 1) => toneVoice(t, dur, {
    freq, type: 'sawtooth', gain: 0.2 * v, attack: 0.006, decay: dur * 0.7,
    filter: [700, 260], q: 3.2, out: track(0.12, 0),
  });

  const driveBass = (t, freq, dur, v = 1) => {
    toneVoice(t, dur, { freq, type: 'sawtooth', gain: 0.2 * v, attack: 0.004, decay: dur * 0.8, filter: [1400, 320], q: 5 });
    toneVoice(t, dur, { freq: freq / 2, type: 'square', gain: 0.1 * v, attack: 0.004, decay: dur * 0.8, filter: 260 });
  };

  const padChord = (t, freqs, dur, v = 1, style = 'pad') => {
    const out = track(style === 'strings' ? 0.65 : 0.45, 0);
    const attack = style === 'strings' ? 0.85 : style === 'stab' ? 0.02 : 0.35;
    freqs.forEach((f, i) => {
      const gain = (style === 'stab' ? 0.1 : 0.062) * v;
      toneVoice(t, dur, {
        freq: f, type: style === 'rhodes' ? 'sine' : style === 'stab' ? 'square' : 'sawtooth',
        gain, attack, decay: dur * (style === 'stab' ? 0.35 : 0.9),
        detune: i * 4 - 6, filter: style === 'rhodes' ? 2200 : style === 'stab' ? 3200 : 1150, q: 0.9,
        pan: (i - 1.5) * 0.22, out,
      });
      if (style !== 'rhodes') {
        toneVoice(t, dur, { freq: f * 1.005, type: 'sawtooth', gain: gain * 0.55, attack, decay: dur * 0.9, filter: 1400, pan: (1.5 - i) * 0.18, out });
      }
      if (style === 'rhodes') {
        // bell-like overtone for the electric-piano feel
        toneVoice(t, dur * 0.5, { freq: f * 2, type: 'sine', gain: gain * 0.35, attack: 0.01, decay: dur * 0.35, out });
      }
    });
  };

  const pluck = (t, freq, v = 1, style = 'pluck') => toneVoice(t, 0.34, {
    freq, type: style === 'bell' ? 'sine' : style === 'santur' ? 'triangle' : 'triangle',
    gain: 0.15 * v, attack: 0.004, decay: 0.3,
    filter: style === 'bell' ? 5200 : style === 'santur' ? 4200 : 2800, q: 2.4,
    out: track(0.3, 0.3),
  });

  const leadNote = (t, freq, dur, v = 1) => toneVoice(t, dur, {
    freq, type: 'square', gain: 0.09 * v, attack: 0.02, decay: dur * 0.6,
    filter: [3600, 1600], q: 3, out: track(0.25, 0.35),
  });

  const riser = (t, dur) => {
    noiseVoice(t, dur, { gain: 0.11, filter: [300, 7000], type: 'bandpass', q: 0.7, decay: dur, attack: dur * 0.55 });
    for (let i = 0; i < 8; i++) {
      const k = i / 8;
      noiseVoice(t + dur * k, 0.06, { gain: 0.05 + k * 0.05, filter: [2000, 1600], q: 1, decay: 0.05 });
    }
    toneVoice(t, dur, { freq: 110, type: 'sawtooth', gain: 0.05, attack: dur * 0.7, decay: dur * 0.35, filter: [300, 3800] });
  };

  const impact = (t) => {
    toneVoice(t, 1.4, { freq: 90, type: 'sine', gain: 0.4, attack: 0.003, decay: 1.2, filter: 180, glideTo: 32, out: track(0.5, 0) });
    noiseVoice(t, 0.9, { gain: 0.16, filter: [900, 200], type: 'lowpass', q: 0.7, decay: 0.8, out: track(0.5, 0) });
  };

  const vinylCrackle = (t, v) => {
    noiseVoice(t, 0.03, { gain: 0.05 * v, filter: [3000, 2200], q: 1, decay: 0.02 });
  };

  return {
    master, track, kick, snare, clap, hat, subBass, pluckBass, driveBass,
    padChord, pluck, leadNote, riser, impact, vinylCrackle, noiseVoice, toneVoice, env,
    noise, reverb,
  };
}

/* ------------------------------------------------------------------ */
/* composition                                                         */
/* ------------------------------------------------------------------ */

const DRUM_PATTERNS = {
  four: { kick: [0, 4, 8, 12], snare: [4, 12], openHat: [14], hatEvery: 2 },
  hard: { kick: [0, 4, 8, 12], snare: [4, 12], openHat: [6, 14], hatEvery: 1 },
  soft: { kick: [0, 10], snare: [8], openHat: [], hatEvery: 4 },
  trap: { kick: [0, 6, 10], snare: [], clap: [8], openHat: [], hatEvery: 2 },
  cinematic: { kick: [0, 8], snare: [], openHat: [], hatEvery: 0 },
  none: { kick: [], snare: [], openHat: [], hatEvery: 0 },
};

function composeProgression(genre, rng) {
  return pick(rng, genre.progressions);
}

/**
 * Generate a track.
 * @returns {Promise<{buffer: AudioBuffer, bpm:number, beats:Float32Array, energy:Float32Array, energyHz:number, bestStart:number, dropTime:number, waveform:Float32Array, duration:number}>}
 */
export async function generateTrack({ genreId = 'pop', bpm: bpmOverride = null, seed = 1, onProgress, signal } = {}) {
  const genre = getGenre(genreId);
  const bpm = clamp(bpmOverride || genre.bpm, 60, 175);
  const rng = mulberry32(seed * 7919 + 13);
  const arrangement = buildArrangement(bpm);
  const { sections, totalBars, barSec, duration } = arrangement;
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, Math.ceil(duration * 44100) + 4410, 44100);
  const kit = createKit(ctx, { bpm, reverb: genre.reverb }, ctx.destination, rng);
  const progression = composeProgression(genre, rng);
  const beat = 60 / bpm;
  const step = barSec / 16;               // 16th notes
  const pattern = DRUM_PATTERNS[genre.drums] || DRUM_PATTERNS.four;

  let fakeTimer = null;
  if (onProgress) {
    let p = 0.05;
    fakeTimer = setInterval(() => {
      p = Math.min(0.9, p + (0.9 - p) * 0.06 + 0.004);
      onProgress(p, 'ترکیب صداها و افکت‌ها');
    }, 220);
    onProgress(0.05, 'ساخت سازها');
  }

  sections.forEach((section) => {
    if (signal?.aborted) throw new DOMException('لغو شد', 'AbortError');
    const s0 = section.startBar * barSec;
    const L = section;
    for (let bar = 0; bar < L.bars; bar++) {
      const t0 = s0 + bar * barSec;
      const absBar = section.startBar + bar;
      const chord = chordDegrees(progression, absBar, rng);
      const freqs = chord.map((d) => midiToHz(scaleNote(genre.scale, genre.root, d)));

      /* ---- drums ---- */
      if (L.drums > 0) {
        for (const s of pattern.kick) {
          if (rng() < 0.92) kit.kick(t0 + s * step, L.drums * (s === 0 ? 1 : 0.92));
        }
        for (const s of pattern.snare) kit.snare(t0 + s * step, L.drums * 0.9);
        if (pattern.clap) for (const s of pattern.clap) kit.clap(t0 + s * step, L.drums);
        if (pattern.hatEvery > 0) {
          for (let s = 0; s < 16; s += pattern.hatEvery) {
            const swing = genre.hats === 'swing' && s % 2 === 1 ? step * 0.18 : 0;
            const accent = s % 4 === 0 ? 1 : 0.7;
            kit.hat(t0 + s * step + swing, L.drums * accent);
          }
        }
        if (genre.hats === 'rolls' && absBar % 2 === 1) {
          const base = 8 * step;
          for (let k = 0; k < 6; k++) kit.hat(t0 + base + (k * step) / 3, L.drums * 0.55);
        }
        for (const s of pattern.openHat || []) kit.hat(t0 + s * step, L.drums * 0.8, true);
      }

      /* ---- bass ---- */
      if (L.bass > 0) {
        const root = freqs[0] / 2;
        const fifth = midiToHz(scaleNote(genre.scale, genre.root, chord[2]) - 12);
        if (genre.bass === 'offbeat') {
          for (const s of [2, 6, 10, 14]) kit.pluckBass(t0 + s * step, root, step * 1.6, L.bass * 0.95);
        } else if (genre.bass === '808') {
          kit.subBass(t0, root, barSec * (rng() < 0.3 ? 0.55 : 0.42), L.bass);
          if (rng() < 0.6) kit.subBass(t0 + 10 * step, root * (rng() < 0.5 ? 1 : 1.5), step * 4, L.bass * 0.9);
        } else if (genre.bass === 'drive') {
          for (const s of [0, 4, 8, 12]) kit.driveBass(t0 + s * step, s === 12 && rng() < 0.4 ? fifth : root, step * 3.4, L.bass * 0.9);
        } else if (genre.bass === 'pluck') {
          kit.pluckBass(t0, root, step * 6, L.bass);
          kit.pluckBass(t0 + 8 * step, rng() < 0.5 ? fifth : root, step * 5, L.bass * 0.85);
        } else {
          kit.subBass(t0, root, barSec * 0.9, L.bass * 0.9);
        }
      }

      /* ---- chords / pad ---- */
      if (L.chords > 0) {
        const style = genre.chords;
        kit.padChord(t0, freqs, barSec * (style === 'stab' ? 0.5 : 1.05), L.chords * genre.energy, style);
        if (style === 'stab') kit.padChord(t0 + 8 * step, freqs, step * 5, L.chords * 0.7 * genre.energy, style);
      }

      /* ---- lead / arp / melody ---- */
      if (L.lead > 0) {
        if (genre.lead === 'arp') {
          const seq = [0, 2, 4, 2, 4, 6, 4, 2];
          for (let s = 0; s < 8; s++) {
            const deg = chord[seq[s] % chord.length] + (s > 3 ? 7 : 0);
            const f = midiToHz(scaleNote(genre.scale, genre.root, deg + 12));
            kit.pluck(t0 + s * (barSec / 8), f, L.lead * 0.85, 'pluck');
          }
        } else if (genre.lead === 'melody' || genre.lead === 'lead') {
          const notes = 4 + Math.floor(rng() * 3);
          for (let n = 0; n < notes; n++) {
            if (rng() < 0.22) continue;
            const at = t0 + (n / notes) * barSec;
            const deg = chord[Math.floor(rng() * chord.length)] + (rng() < 0.35 ? 7 : 0);
            const f = midiToHz(scaleNote(genre.scale, genre.root, deg + 12));
            if (genre.lead === 'lead') kit.leadNote(at, f, barSec / notes * (0.7 + rng() * 0.5), L.lead);
            else kit.toneVoice(at, barSec / notes * 0.9, {
              freq: f, type: 'sawtooth', gain: 0.075 * L.lead, attack: 0.12, decay: barSec / notes * 0.7,
              filter: 1800, out: kit.track(0.4, 0),
            });
          }
        } else {
          const doubleArp = genre.lead === 'santur';
          const seq = doubleArp ? [0, 4, 2, 5, 0, 4, 2, 7] : [0, 3, 2, 5, 4, 3, 2, 0];
          for (let s = 0; s < 8; s++) {
            if (rng() < 0.18) continue;
            const deg = chord[seq[s] % chord.length] + (s > 5 ? 7 : 0);
            const f = midiToHz(scaleNote(genre.scale, genre.root, deg + 12));
            kit.pluck(t0 + s * (barSec / 8), f, L.lead * 0.8, genre.lead === 'bell' ? 'bell' : 'santur');
          }
        }
      }

      /* ---- textures ---- */
      if (genre.vinyl > 0) {
        if (absBar % 2 === 0) kit.vinylCrackle(t0 + rng() * barSec, genre.vinyl);
        if (rng() < 0.5) kit.vinylCrackle(t0 + rng() * barSec, genre.vinyl * 0.7);
      }
    }
    // section transitions
    const sectionEnd = s0 + L.bars * barSec;
    if (L.riser) kit.riser(sectionEnd - barSec * 2, barSec * 2);
    if (section.name === 'drop' || section.name === 'drop2') kit.impact(s0);
    if (section.name === 'break') kit.impact(s0 - 0.05);
  });

  // vinyl floor noise across the whole track
  if (genre.vinyl > 0) {
    const src = ctx.createBufferSource();
    src.buffer = kit.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 4200;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.012 * genre.vinyl;
    src.connect(f); f.connect(g); g.connect(kit.master);
    src.start(0);
  }

  const rendered = await ctx.startRendering();
  if (fakeTimer) clearInterval(fakeTimer);
  onProgress?.(0.92, 'نرمال‌سازی و اندازه‌گیری ریتم');
  if (signal?.aborted) throw new DOMException('لغو شد', 'AbortError');

  // normalize + measure
  const L = rendered.getChannelData(0);
  const R = rendered.getChannelData(1);
  let peak = 1e-6;
  for (let i = 0; i < L.length; i += 4) {
    const a = Math.abs(L[i]) + Math.abs(R[i]);
    if (a > peak) peak = a;
  }
  const gain = clamp(0.96 / (peak * 0.55 + 0.45), 0.4, 12);
  const softClip = (x) => (x > 1.6 ? 1 : x < -1.6 ? -1 : Math.tanh(x));
  for (let i = 0; i < L.length; i++) {
    L[i] = softClip(L[i] * gain * 0.75);
    R[i] = softClip(R[i] * gain * 0.75);
  }

  // exact beat grid (the track was composed to it)
  const beatPeriod = 60 / bpm;
  const beatCount = Math.floor(duration / beatPeriod) + 1;
  const beats = new Float32Array(beatCount);
  for (let i = 0; i < beatCount; i++) beats[i] = i * beatPeriod;

  // measured energy curve + waveform
  const energyHz = 20;
  const energyLen = Math.floor(duration * energyHz);
  const energy = new Float32Array(energyLen);
  const stepSamples = Math.floor((rendered.sampleRate / energyHz));
  let eMax = 1e-6;
  for (let f = 0; f < energyLen; f++) {
    let sum = 0;
    const off = f * stepSamples;
    for (let i = 0; i < stepSamples; i += 4) {
      const s = (L[off + i] || 0) + (R[off + i] || 0);
      sum += s * s * 4;
    }
    energy[f] = Math.sqrt(sum / Math.max(1, stepSamples));
    if (energy[f] > eMax) eMax = energy[f];
  }
  for (let i = 0; i < energyLen; i++) energy[i] = clamp(energy[i] / eMax, 0, 1);

  const buckets = 320;
  const waveform = new Float32Array(buckets);
  const per = Math.floor(L.length / buckets);
  let wMax = 1e-6;
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    for (let i = 0; i < per; i += 3) {
      const v = Math.abs(L[b * per + i] || 0);
      if (v > m) m = v;
    }
    waveform[b] = m;
    if (m > wMax) wMax = m;
  }
  for (let b = 0; b < buckets; b++) waveform[b] = Math.min(1, waveform[b] / wMax);

  // best start = strongest window aligned to a bar; drop = biggest energy surge
  const smooth = movingAverage(energy, 4);
  let bestStart = 0, bestSum = -1;
  const winFrames = Math.round(30 * energyHz);
  for (let f = 0; f + winFrames <= energy.length; f += Math.round(energyHz / 2)) {
    let sum = 0;
    for (let k = 0; k < winFrames; k += 2) sum += smooth[f + k];
    if (sum > bestSum) { bestSum = sum; bestStart = f / energyHz; }
  }
  const barSnap = (t) => Math.round(t / barSec) * barSec;
  bestStart = barSnap(bestStart);
  let dropTime = 0, bestSurge = -1;
  for (let i = Math.round(energyHz * 4); i < smooth.length; i++) {
    const surge = smooth[i] - smooth[Math.max(0, i - energyHz * 2)];
    if (surge > bestSurge) { bestSurge = surge; dropTime = i / energyHz; }
  }
  onProgress?.(1, 'آماده');

  return {
    buffer: rendered,
    bpm,
    beatPeriod,
    beats,
    energy,
    energyHz,
    waveform,
    bestStart: clamp(bestStart, 0, Math.max(0, duration - 30)),
    dropTime: barSnap(dropTime),
    duration,
    seed,
    genre: genre.id,
    genreName: genre.name,
    name: `${genre.name} • ${Math.round(bpm)} BPM`,
    generated: true,
    structure: sections.map((s) => ({ name: s.name, t0: s.startBar * barSec, bars: s.bars })),
  };
}

/** Wrap a generated track into the shape the rest of the app expects. */
export function toMusicAnalysis(track) {
  return {
    duration: track.duration,
    sampleRate: track.buffer.sampleRate,
    bpm: track.bpm,
    beatPeriod: track.beatPeriod,
    beats: track.beats,
    downbeats: Float32Array.from(track.beats.filter((_, i) => i % 4 === 0)),
    energy: track.energy,
    energyHz: track.energyHz,
    waveform: track.waveform,
    confidence: 1,
    phaseScore: 99,
    bestStart: track.bestStart,
    dropTime: track.dropTime,
    analyzed: track.duration,
    ms: 0,
    generated: true,
    genre: track.genre,
    name: track.name,
    buffer: track.buffer,
  };
}

export { movingAverage };
