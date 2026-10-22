// Turns every slide's narration into <slide-id>.mp3 next to walkthrough.json and
// writes each slide's `audio` and `durationSec` back into the JSON.
//
//   node generate-audio.ts <walkthrough-dir> [--provider edge|openai|gemini|silent] [--voice <name>] [--model <name>] [--force]
//
// The provider, voice and model default to the configured voice (config.ts set-voice),
// which defaults to edge. See tts.ts for the providers and the API key each one reads.
//
// Slides whose narration and voice are unchanged since the last run are skipped
// (tracked in .audio-manifest.json); --force regenerates everything. `--provider silent` writes
// silent MP3s as long as the narration, for testing the player without paying for speech.
//
// At the end it packs the walkthrough into <walkthroughs-folder>/<id>.zip (pack.ts).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { voiceSettings } from './config.ts';
import { packWalkthrough } from './pack.ts';
import { apiKey, isProvider, missingKeyMessage, PROVIDERS, synthesize, type VoiceSettings } from './tts.ts';
import { readWalkthrough, writeWalkthrough } from './walkthrough.ts';

const MANIFEST = '.audio-manifest.json';
const MAX_ATTEMPTS = 3;

interface ManifestEntry {
  hash: string;
  durationSec: number;
}

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_OPTIONS = ['--provider', '--voice', '--model'];
const dir = args.find((a, i) => !a.startsWith('--') && !VALUE_OPTIONS.includes(args[i - 1]));
const force = args.includes('--force');

const configured = voiceSettings();
const provider = option('provider') ?? configured.provider;
if (!dir || !isProvider(provider)) {
  console.error('Usage: node generate-audio.ts <walkthrough-dir> [--provider edge|openai|gemini|silent] [--voice <name>] [--model <name>] [--force]');
  process.exit(2);
}
// A voice or model configured for one provider means nothing to another.
const sameProvider = provider === configured.provider;
const settings: VoiceSettings = {
  provider,
  voice: option('voice') ?? (sameProvider ? configured.voice : undefined) ?? PROVIDERS[provider].voice,
  model: option('model') ?? (sameProvider ? configured.model : undefined) ?? PROVIDERS[provider].model,
};
if (PROVIDERS[provider].keys.length && !apiKey(provider)) {
  console.error(missingKeyMessage(provider));
  process.exit(1);
}

const folder = resolve(dir);
const walkthrough = readWalkthrough(folder);
const manifestPath = join(folder, MANIFEST);
const manifest: Record<string, ManifestEntry> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      console.warn(`retrying after: ${(error as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Saved after every slide, so a failure part-way through doesn't pay for finished slides again.
function save(): void {
  writeWalkthrough(folder, walkthrough);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

console.log(`voice: ${settings.provider} ${settings.voice}${settings.model ? ` (${settings.model})` : ''}`);
for (const slide of walkthrough.slides) {
  const audio = `${slide.id}.mp3`;
  const out = join(folder, audio);
  const hash = createHash('sha256').update(JSON.stringify([settings, slide.narration])).digest('hex');
  const previous = manifest[slide.id];
  if (!force && previous?.hash === hash && existsSync(out)) {
    slide.audio = audio;
    slide.durationSec = previous.durationSec;
    console.log(`skip  ${audio}`);
    continue;
  }
  const speech = await withRetry(() => synthesize(slide.narration, settings));
  writeFileSync(out, speech.mp3);
  slide.audio = audio;
  slide.durationSec = speech.durationSec;
  manifest[slide.id] = { hash, durationSec: speech.durationSec };
  save();
  console.log(`wrote ${audio}  ${speech.durationSec}s`);
}

// Drop audio for slides that no longer exist, including MP3s the manifest doesn't know
// about (a folder copied without it). The folder belongs to this walkthrough alone.
const live = new Set(walkthrough.slides.map((s) => s.id));
for (const id of Object.keys(manifest)) {
  if (!live.has(id)) delete manifest[id];
}
for (const file of readdirSync(folder)) {
  if (file.endsWith('.mp3') && !live.has(file.slice(0, -4))) rmSync(join(folder, file), { force: true });
}

save();
const total = walkthrough.slides.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
console.log(`\n${walkthrough.slides.length} slides, ${(total / 60).toFixed(1)} min of audio at 1x`);
console.log(`zip: ${packWalkthrough(folder)}`);
