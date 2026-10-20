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
// it, otherwise from raw.githubusercontent.com. A PRReview also checks that every
// range is visible in the pull request's whitespace-ignored diff, which needs both
// the base and head commits in the local clone.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readWalkthrough, structuralErrors, wordCount, type LineRange } from './walkthrough.ts';

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

// Plain language: listeners may not have English as a first language.
const MAX_SENTENCE_WORDS = 25;
const MAX_AVERAGE_SENTENCE_WORDS = 16;
const IDIOMS = [
  'under the hood',
  'in a nutshell',
  'heavy lifting',
  'pays for itself',
  'at the end of the day',
  'bottom line',
  'the whole of',
  'boils down to',
  'on the fly',
  'out of the box',
];

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

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

const review = walkthrough.type === 'PRReview';
const base = walkthrough.pullRequest?.baseCommit;

function hasCommit(commit: string | undefined): boolean {
  if (!commit) return false;
  try {
    execFileSync('git', ['-C', repoPath, 'cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasLocalCommit = hasCommit(walkthrough.repo.commit) && (!review || hasCommit(base));
if (review && !hasLocalCommit) {
  console.error(
    `A PR review is checked against the diff, which needs both commits in a local clone. In the clone, run\n` +
      `  git fetch origin pull/${walkthrough.pullRequest?.number}/head ${base ?? '<base>'}\n` +
      `and pass --repo <clone>.`,
  );
  process.exit(1);
}
console.log(
  hasLocalCommit
    ? `Reading files from the local clone at ${resolve(repoPath)}`
    : `Commit not found in ${resolve(repoPath)}; reading files from GitHub (pass --repo <clone> to read locally)`,
);

function git(args: string[]): string {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

async function fileAtCommit(commit: string, file: string): Promise<string | undefined> {
  if (hasLocalCommit) {
    try {
      return git(['cat-file', '-p', `${commit}:${file}`]);
    } catch {
      return undefined;
    }
  }
  const { owner, name } = walkthrough.repo;
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${commit}/${file}`);
  if (res.ok) return res.text();
  if (res.status !== 404) throw new Error(`GitHub returned ${res.status} for ${file}`);
  return undefined;
}

type Hunks = Record<'old' | 'new', LineRange[]>;

/**
 * The line ranges GitHub shows for a file in the PR's Files changed tab with whitespace
 * hidden (?w=1): the hunks of `git diff -w` between the merge base and the head, with
 * three lines of context. Lines outside them are folded away and can't be highlighted.
 */
function diffHunks(file: string): Hunks {
  const hunks: Hunks = { old: [], new: [] };
  const diff = git(['diff', '-w', '-U3', '--no-color', '--no-ext-diff', base!, walkthrough.repo.commit, '--', file]);
  for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [oldStart, oldCount, newStart, newCount] = [match[1], match[2] ?? '1', match[3], match[4] ?? '1'].map(Number);
    if (oldCount) hunks.old.push({ start: oldStart, end: oldStart + oldCount - 1 });
    if (newCount) hunks.new.push({ start: newStart, end: newStart + newCount - 1 });
  }
  return hunks;
}

const describe = (ranges: LineRange[]) => ranges.map((r) => `${r.start}-${r.end}`).join(', ') || 'none';

const cache = new Map<string, Promise<string | undefined>>();
const hunkCache = new Map<string, Hunks>();
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
  const spoken = sentences(slide.narration ?? '');
  for (const field of ['narration', 'summary'] as const) {
    for (const sentence of sentences(slide[field] ?? '')) {
      const count = wordCount(sentence);
      if (count > MAX_SENTENCE_WORDS) warnings.push(`${at}: ${field} has a ${count}-word sentence; split it ("${sentence.slice(0, 60)}…")`);
    }
  }
  const average = spoken.length ? words / spoken.length : 0;
  const longest = Math.max(0, ...spoken.map(wordCount));
  if (average > MAX_AVERAGE_SENTENCE_WORDS) {
    warnings.push(`${at}: narration sentences average ${Math.round(average)} words; aim for under 15`);
  }
  for (const idiom of IDIOMS) {
    if (`${slide.narration} ${slide.summary}`.toLowerCase().includes(idiom)) warnings.push(`${at}: idiom "${idiom}"; say it plainly`);
  }
  if (slide.audio && !existsSync(join(folder, slide.audio))) {
    warnings.push(`${at}: audio "${slide.audio}" is missing; run generate-audio.ts`);
  }

  const selected = !only || only === slide.id || only === String(i + 1);
  const side = slide.side ?? 'new';
  const letter = review ? (side === 'new' ? 'R' : 'L') : 'L';
  const range = slide.lines ? `#${letter}${slide.lines.start}-${letter}${slide.lines.end}` : '';
  if (selected) {
    const audio = slide.durationSec ? `, ${slide.durationSec.toFixed(0)}s` : '';
    const style = spoken.length ? `, sentences avg ${average.toFixed(0)} / max ${longest} words` : '';
    console.log(`\n${String(i + 1).padStart(2)}. ${slide.id}  (${words} words${audio}${style})  ${slide.file ?? '(no file)'}${range}`);
  }
  if (!slide.file) continue;

  // A review's removed lines exist only in the base; everything else is read at the head.
  const commit = review && side === 'old' ? base! : walkthrough.repo.commit;
  const key = `${commit}:${slide.file}`;
  if (!cache.has(key)) cache.set(key, fileAtCommit(commit, slide.file));
  const content = await cache.get(key);
  if (content === undefined) {
    errors.push(`${at}: file "${slide.file}" not found at commit ${commit}`);
    continue;
  }
  if (review) {
    if (!hunkCache.has(slide.file)) hunkCache.set(slide.file, diffHunks(slide.file));
    const hunks = hunkCache.get(slide.file)![side];
    if (hunks.length === 0) {
      errors.push(`${at}: "${slide.file}" has no ${side}-side changes in the PR diff (whitespace ignored)`);
    } else if (slide.lines && !hunks.some((h) => h.start <= slide.lines!.start && slide.lines!.end <= h.end)) {
      errors.push(
        `${at}: ${side}-side lines ${slide.lines.start}-${slide.lines.end} are not all shown in the PR diff; ` +
          `keep the range inside one of: ${describe(hunks)}`,
      );
    }
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
