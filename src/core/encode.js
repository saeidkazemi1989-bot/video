/**
 * MP4 export through WebCodecs (H.264 + AAC) and mp4-muxer.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { sleep } from './util.js';

const CODEC_CANDIDATES = [
  'avc1.640033', // high 5.1
  'avc1.640032', // high 5.0
  'avc1.64002A', // high 4.2
  'avc1.640028', // high 4.0
  'avc1.4d0033',
  'avc1.4d0032',
  'avc1.4d002A',
  'avc1.4d0028', // main 4.0
  'avc1.42E032',
  'avc1.42E02A',
  'avc1.42E028', // baseline 4.0
];

export function webCodecsSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function pickVideoConfig({ width, height, fps, bitrate }) {
  if (!webCodecsSupported()) return null;
  const attempts = [
    { latencyMode: 'quality', hardwareAcceleration: 'prefer-hardware' },
    { latencyMode: 'quality' },
    {},
  ];
  for (const extra of attempts) {
    for (const codec of CODEC_CANDIDATES) {
      const config = {
        codec, width, height, framerate: fps, bitrate,
        avc: { format: 'avc' },
        ...extra,
      };
      try {
        const s = await VideoEncoder.isConfigSupported(config);
        if (s?.supported) return s.config || config;
      } catch { /* try the next codec */ }
    }
  }
  return null;
}

export async function createExporter({ width, height, fps, bitrate, audio = null }) {
  const config = await pickVideoConfig({ width, height, fps, bitrate });
  if (!config) throw new Error('این مرورگر از کدگذاری ویدیو پشتیبانی نمی‌کند. از کروم اندروید یا Safari نسخه ۱۶.۴ به بالا استفاده کن.');

  const muxerOptions = {
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  };
  if (audio) {
    muxerOptions.audio = {
      codec: 'aac',
      numberOfChannels: audio.numberOfChannels || 2,
      sampleRate: audio.sampleRate || 44100,
    };
  }
  const muxer = new Muxer(muxerOptions);
  let failure = null;
  let encoded = 0;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try { muxer.addVideoChunk(chunk, meta); encoded++; } catch (e) { failure = e; }
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(config);

  return {
    config,
    get frames() { return encoded; },
    async addFrame(source, index, frameRate = fps) {
      if (failure) throw failure;
      // keep the encoder queue shallow so memory stays flat on phones
      let guard = 0;
      while (encoder.encodeQueueSize > 8 && guard++ < 400) await sleep(4);
      const timestamp = Math.round((index / frameRate) * 1e6);
      const frame = new VideoFrame(source, {
        timestamp,
        duration: Math.round(1e6 / frameRate),
        alpha: 'discard',
      });
      const keyEvery = Math.max(1, Math.round(frameRate * 2));
      encoder.encode(frame, { keyFrame: index % keyEvery === 0 });
      frame.close();
    },
    addAudio(chunks) {
      for (const { chunk, meta } of chunks) {
        try { muxer.addAudioChunk(chunk, meta); } catch (e) { failure = e; }
      }
    },
    async finish() {
      if (failure) throw failure;
      await encoder.flush();
      encoder.close();
      if (failure) throw failure;
      muxer.finalize();
      const { buffer } = muxer.target;
      return new Blob([buffer], { type: 'video/mp4' });
    },
  };
}
