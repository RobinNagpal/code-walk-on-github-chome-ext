// Text-to-speech providers. Each returns an MP3 and its exact duration.
//
//   edge    Microsoft Edge neural voices via msedge-tts. Free, no key.
//   openai  OpenAI speech API. Key: OPENAI_API_KEY.
//   gemini  Gemini speech generation (Interactions API). Key: GEMINI_API_KEY (or GOOGLE_API_KEY).
//   silent  Silence as long as the narration would take to read (165 words a minute). For testing
//           the player without paying for speech.
//
// OpenAI and Gemini return raw 16-bit PCM, which is encoded to MP3 in JavaScript (lamejs).
// The agent writes the narration; one of these voices reads it.
// Keys may also come from a .env file; see env.ts.
import { loadEnv } from './env.ts';

loadEnv();

export type Provider = 'edge' | 'openai' | 'gemini' | 'silent';

export interface VoiceSettings {
  provider: Provider;
  /** Provider voice name; each provider has its own default. */
  voice?: string;
  /** Provider model; ignored by edge. */
  model?: string;
}

export interface Speech {
  mp3: Buffer;
  durationSec: number;
}

export const PROVIDERS: Record<Provider, { voice: string; model?: string; models?: string[]; keys: string[] }> = {
  edge: { voice: 'en-US-AndrewMultilingualNeural', keys: [] },
  openai: { voice: 'alloy', model: 'gpt-4o-mini-tts', models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'], keys: ['OPENAI_API_KEY'] },
  gemini: {
    voice: 'Charon',
    // Cheapest Gemini speech model (October 2026). There is no Gemini 4 speech model yet.
    model: 'gemini-3.8-flash-lite-tts',
    models: ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-preview-tts'],
    keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  },
  silent: { voice: 'none', keys: [] },
};

const MP3_KBPS = 48;
const WORDS_PER_MINUTE = 165;
const SILENT_RATE = 16_000;
// OpenAI's speech endpoint rejects input longer than this; longer narration is sent in pieces.
const MAX_CHARS = 4000;

export function isProvider(value: string): value is Provider {
  return value in PROVIDERS;
}

/** The API key for a provider, or an error message naming the variable to set. */
export function apiKey(provider: Provider): string | undefined {
  for (const name of PROVIDERS[provider].keys) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

export function missingKeyMessage(provider: Provider): string {
  return `The ${provider} voice needs ${PROVIDERS[provider].keys.join(' or ')} in the environment.`;
}

export async function synthesize(text: string, settings: VoiceSettings): Promise<Speech> {
  const voice = settings.voice ?? PROVIDERS[settings.provider].voice;
  const model = settings.model ?? PROVIDERS[settings.provider].model ?? '';
  switch (settings.provider) {
    case 'edge':
      return edge(text, voice);
    case 'openai':
      return pcmToSpeech(await concatPcm(split(text).map((part) => () => openai(part, voice, model))), 24_000);
    case 'gemini':
      return pcmToSpeech(await concatPcm(split(text).map((part) => () => gemini(part, voice, model))), GEMINI_RATE);
    case 'silent': {
      const words = text.split(/\s+/).filter(Boolean).length;
      return pcmToSpeech(new Int16Array(Math.max(1, Math.round((words / WORDS_PER_MINUTE) * 60 * SILENT_RATE))), SILENT_RATE);
    }
  }
}

// ── edge ─────────────────────────────────────────────────────────────────────

async function edge(text: string, voice: string): Promise<Speech> {
  const { MsEdgeTTS } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  try {
    // Constant bitrate, so the duration is exactly bytes / (bitrate / 8).
    await tts.setMetadata(voice, 'audio-24khz-48kbitrate-mono-mp3' as Parameters<typeof tts.setMetadata>[1]);
    const { audioStream } = tts.toStream(escapeXml(text));
    const chunks: Buffer[] = [];
    await new Promise<void>((done, fail) => {
      audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      audioStream.on('close', done);
      audioStream.on('error', fail);
    });
    const mp3 = Buffer.concat(chunks);
    if (mp3.length === 0) throw new Error('edge returned no audio');
    return { mp3, durationSec: round(mp3.length / ((MP3_KBPS * 1000) / 8)) };
  } finally {
    tts.close();
  }
}

// msedge-tts places the text inside SSML without escaping it.
function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── openai ───────────────────────────────────────────────────────────────────

async function openai(text: string, voice: string, model: string): Promise<Int16Array> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey('openai')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: 'pcm', // 24 kHz, 16-bit, mono, little-endian
      // Only the gpt-* speech models take instructions; tts-1 rejects them.
      ...(model.startsWith('gpt-') && { instructions: 'Speak like a calm senior engineer walking a colleague through code.' }),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI speech request failed (${res.status}): ${await res.text()}`);
  return toInt16(Buffer.from(await res.arrayBuffer()));
}

// ── gemini ───────────────────────────────────────────────────────────────────

const GEMINI_RATE = 24_000;

interface InteractionResponse {
  steps?: { type?: string; content?: { type?: string; data?: string }[] }[];
}

// Gemini's Interactions API. The text is spoken verbatim, so the speaking style goes
// in a speech_metadata annotation rather than in the text.
async function gemini(text: string, voice: string, model: string): Promise<Int16Array> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey('gemini')!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text,
              annotations: [{ type: 'speech_metadata', style: 'calm, clear and conversational, like a senior engineer explaining code to a colleague' }],
            },
          ],
        },
      ],
      response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: GEMINI_RATE },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  if (!res.ok) throw new Error(`Gemini speech request failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as InteractionResponse;
  const audio = (body.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === 'audio' && part.data)
    .at(-1);
  if (!audio?.data) throw new Error(`Gemini returned no audio: ${JSON.stringify(body).slice(0, 300)}`);
  return toInt16(stripWavHeader(Buffer.from(audio.data, 'base64')));
}

/** Raw PCM is requested, but WAV is the API's default; accept either. */
function stripWavHeader(bytes: Buffer): Buffer {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') return bytes;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'data') return bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV audio has no data chunk');
}

// ── PCM → MP3 ────────────────────────────────────────────────────────────────

function toInt16(bytes: Buffer): Int16Array {
  const samples = new Int16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2);
  return samples;
}

async function concatPcm(requests: (() => Promise<Int16Array>)[]): Promise<Int16Array> {
  const parts: Int16Array[] = [];
  for (const request of requests) parts.push(await request()); // In order, one at a time.
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function pcmToSpeech(samples: Int16Array, sampleRate: number): Promise<Speech> {
  if (samples.length === 0) throw new Error('no audio returned');
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(1, sampleRate, MP3_KBPS);
  const frames: Buffer[] = [];
  // lamejs hands back Int8Arrays; view them as bytes.
  const bytes = (chunk: ArrayBufferView) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const BLOCK = 1152;
  for (let i = 0; i < samples.length; i += BLOCK) frames.push(bytes(encoder.encodeBuffer(samples.subarray(i, i + BLOCK))));
  frames.push(bytes(encoder.flush()));
  return { mp3: Buffer.concat(frames), durationSec: round(samples.length / sampleRate) };
}

/** Splits long narration at sentence ends so each request stays under MAX_CHARS. */
function split(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const parts: string[] = [];
  let current = '';
  for (const sentence of text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text]) {
    if (current && current.length + sentence.length > MAX_CHARS) {
      parts.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function round(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
