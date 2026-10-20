// The walkthrough format. Keep in sync with skills/code-walkthrough/walkthrough.schema.json.

export interface LineRange {
  start: number;
  end: number;
}

export interface Slide {
  id: string;
  title: string;
  summary: string;
  narration: string;
  file?: string;
  lines?: LineRange;
  audio?: string;
  durationSec?: number;
}

export interface Walkthrough {
  version: 1;
  id: string;
  title: string;
  description?: string;
  repo: { host?: string; owner: string; name: string; commit: string };
  createdAt?: string;
  targetMinutes?: number;
  slides: Slide[];
}

export const WALKTHROUGH_FILE = 'walkthrough.json';
export const SPEEDS = [1, 1.2, 1.4, 1.6, 1.8, 2] as const;

const PLAIN_VIEW = /\.(md|markdown|mdx|rst|adoc)$/i;

/** GitHub URL of a slide's file at the walkthrough's commit, or undefined for a slide without a file. */
export function slideUrl(walkthrough: Walkthrough, slide: Slide): string | undefined {
  if (!slide.file) return undefined;
  const { host = 'github.com', owner, name, commit } = walkthrough.repo;
  const path = slide.file.split('/').map(encodeURIComponent).join('/');
  // Rendered markdown has no line anchors; the plain view does.
  const query = PLAIN_VIEW.test(slide.file) ? '?plain=1' : '';
  const hash = slide.lines ? `#L${slide.lines.start}-L${slide.lines.end}` : '';
  return `https://${host}/${owner}/${name}/blob/${commit}/${path}${query}${hash}`;
}

/** The URL without its hash, for telling whether a tab already shows a file. */
export function withoutHash(url: string): string {
  const i = url.indexOf('#');
  return i < 0 ? url : url.slice(0, i);
}

export function totalDuration(walkthrough: Walkthrough): number {
  return walkthrough.slides.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Rejects JSON that the player can't use; returns a readable reason. */
export function invalidReason(value: unknown): string | undefined {
  const w = value as Partial<Walkthrough> | null;
  if (!w || typeof w !== 'object') return 'not a JSON object';
  if (w.version !== 1) return 'unsupported version';
  if (!w.id || !w.title) return 'missing id or title';
  if (!w.repo?.owner || !w.repo?.name || !w.repo?.commit) return 'missing repo owner, name or commit';
  if (!Array.isArray(w.slides) || w.slides.length === 0) return 'no slides';
  const bad = w.slides.findIndex((s) => !s?.id || !s?.title);
  if (bad >= 0) return `slide ${bad + 1} is missing id or title`;
  return undefined;
}
