// Validates a walkthrough folder: the JSON shape, every slide's file and line range
// at the pinned commit, narration that will read badly aloud, and the length.
//
//   node validate.ts <walkthrough-dir> [--repo <local clone>] [--show] [--slide <id|number>]
//
// By default each slide prints the first and last line of its range, which is
// enough to catch a range that is off by a few lines. --show prints every line.
// --slide limits the output to one slide.
//
// File contents come from the local clone (`git cat-file`) when the commit is in
// it, otherwise from raw.githubusercontent.com.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readWalkthrough, structuralErrors, wordCount, type Walkthrough } from './walkthrough.ts';

const WORDS_PER_MINUTE = 165;
const LENGTH_TOLERANCE = 0.1;
// Things a text-to-speech voice reads literally or stumbles over.
const UNSPEAKABLE: [RegExp, string][] = [
  [/`/, 'backticks'],
  [/\w_\w/, 'snake_case identifier'],
  [/\w\(|\(\)/, 'function-call syntax'],
  [/https?:\/\//, 'URL'],
  [/[#*<>{}[\]|\\]/, 'markdown or code symbols'],
  [/\b\d+\.\d+\b/, 'decimal number (spell it out)'],
  [/\.(py|ts|js|tsx|json|md|go|rs|java)\b/, 'file extension'],
  [/\w\/\w/, 'path or slash'],
];

const args = process.argv.slice(2);
const VALUE_OPTIONS = ['--repo', '--slide'];
const option = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((a, i) => !a.startsWith('--') && !VALUE_OPTIONS.includes(args[i - 1]));
const repoPath = option('repo') ?? process.cwd();
const only = option('slide');
const show = args.includes('--show');

if (!dir) {
  console.error('Usage: node validate.ts <walkthrough-dir> [--repo <local clone>] [--show] [--slide <id|number>]');
  process.exit(2);
}

const folder = resolve(dir);
const walkthrough = readWalkthrough(folder);
const errors = structuralErrors(walkthrough, basename(folder));
const warnings: string[] = [];

const hasLocalCommit = (() => {
  try {
    execFileSync('git', ['-C', repoPath, 'cat-file', '-e', `${walkthrough.repo.commit}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
console.log(
  hasLocalCommit
    ? `Reading files from the local clone at ${resolve(repoPath)}`
    : `Commit not found in ${resolve(repoPath)}; reading files from GitHub (pass --repo <clone> to read locally)`,
);

async function fileAtCommit(w: Walkthrough, file: string): Promise<string | undefined> {
  if (hasLocalCommit) {
    try {
      return execFileSync('git', ['-C', repoPath, 'cat-file', '-p', `${w.repo.commit}:${file}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      return undefined;
    }
  }
  const { owner, name, commit } = w.repo;
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${commit}/${file}`);
  if (res.ok) return res.text();
  if (res.status !== 404) throw new Error(`GitHub returned ${res.status} for ${file}`);
  return undefined;
}

const cache = new Map<string, Promise<string | undefined>>();
let totalWords = 0;
let totalSeconds = 0;
let withAudio = 0;

for (const [i, slide] of walkthrough.slides.entries()) {
  const at = `slides[${i}] ${slide.id}`;
  const words = wordCount(slide.narration ?? '');
  totalWords += words;
  if (slide.durationSec) {
    totalSeconds += slide.durationSec;
    withAudio++;
  }
  for (const [pattern, what] of UNSPEAKABLE) {
    const match = pattern.exec(slide.narration ?? '');
    if (match) warnings.push(`${at}: narration has ${what} ("${slide.narration.slice(Math.max(0, match.index - 15), match.index + 20)}")`);
  }
  if (slide.audio && !existsSync(join(folder, slide.audio))) {
    warnings.push(`${at}: audio "${slide.audio}" is missing; run generate-audio.ts`);
  }

  const selected = !only || only === slide.id || only === String(i + 1);
  const range = slide.lines ? `#L${slide.lines.start}-L${slide.lines.end}` : '';
  if (selected) {
    console.log(`\n${String(i + 1).padStart(2)}. ${slide.id}  (${words} words${slide.durationSec ? `, ${slide.durationSec.toFixed(0)}s` : ''})  ${slide.file ?? '(no file)'}${range}`);
  }
  if (!slide.file) continue;

  if (!cache.has(slide.file)) cache.set(slide.file, fileAtCommit(walkthrough, slide.file));
  const content = await cache.get(slide.file);
  if (content === undefined) {
    errors.push(`${at}: file "${slide.file}" not found at commit ${walkthrough.repo.commit}`);
    continue;
  }
  if (!slide.lines) continue;
  const lines = content.replace(/\n$/, '').split('\n');
  const { start, end } = slide.lines;
  // Malformed ranges are already reported by structuralErrors.
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) continue;
  if (end > lines.length) {
    errors.push(`${at}: lines ${start}-${end} exceed ${slide.file} (${lines.length} lines)`);
    continue;
  }
  if (!lines[start - 1].trim() || !lines[end - 1].trim()) {
    warnings.push(`${at}: range ${start}-${end} starts or ends on a blank line; tighten it`);
  }
  if (!selected) continue;
  const print = (n: number) => console.log(`      ${String(n).padStart(4)} | ${lines[n - 1]}`);
  if (show || end - start < 2) {
    for (let n = start; n <= end; n++) print(n);
  } else {
    print(start);
    console.log(`           | … ${end - start - 1} more lines …`);
    print(end);
  }
}

const estimatedMinutes = totalWords / WORDS_PER_MINUTE;
console.log(`\n${walkthrough.slides.length} slides, ${totalWords} words, ~${estimatedMinutes.toFixed(1)} min at ${WORDS_PER_MINUTE} wpm`);
if (withAudio) console.log(`Audio: ${(totalSeconds / 60).toFixed(1)} min across ${withAudio} slides (re-run generate-audio.ts after editing narration)`);
if (walkthrough.targetMinutes) {
  const off = estimatedMinutes / walkthrough.targetMinutes - 1;
  if (Math.abs(off) > LENGTH_TOLERANCE) {
    const targetWords = Math.round(walkthrough.targetMinutes * WORDS_PER_MINUTE);
    warnings.push(`length is ${Math.round(off * 100)}% off the ${walkthrough.targetMinutes}-minute target; aim for ~${targetWords} words`);
  }
}
for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
process.exit(errors.length ? 1 : 0);
