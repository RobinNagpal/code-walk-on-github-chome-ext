// The walkthrough format. Keep in sync with skills/code-walkthrough/walkthrough.schema.json.

/**
 * What a walkthrough shows:
 * - CodeTour: files at one pinned commit (GitHub's blob view).
 * - PRReview: the changes of a pull request (its "Files changed" tab).
 */
export const WalkthroughType = {
  CodeTour: 'CodeTour',
  PRReview: 'PRReview',
} as const;
export type WalkthroughType = (typeof WalkthroughType)[keyof typeof WalkthroughType];

export interface LineRange {
  start: number;
  end: number;
}

/** In a PRReview, which side of the diff a slide's lines are on. */
export type DiffSide = 'new' | 'old';

/** How GitHub lays out a pull request's diff. */
export type DiffView = 'unified' | 'split';

export interface Slide {
  id: string;
  title: string;
  summary: string;
  narration: string;
  file?: string;
  lines?: LineRange;
  /** PRReview only: "new" (default) for added or kept lines, "old" for removed ones. */
  side?: DiffSide;
  audio?: string;
  durationSec?: number;
}

export interface PullRequest {
  number: number;
  title?: string;
  /** The commit the PR's changes are measured from (the merge base). */
  baseCommit: string;
  /** The PR head the walkthrough was written for. */
  headCommit: string;
}

export interface Walkthrough {
  version: 1;
  /** Missing means CodeTour (walkthroughs written before the field existed). */
  type?: WalkthroughType;
  id: string;
  title: string;
  description?: string;
  repo: { host?: string; owner: string; name: string; commit: string };
  pullRequest?: PullRequest;
  createdAt?: string;
  targetMinutes?: number;
  slides: Slide[];
}

/** Where a slide sends the tab, and what to highlight once there. */
export interface SlideTarget {
  url: string;
  focus: FocusTarget;
}

export type FocusTarget =
  | { kind: 'blob'; lines?: LineRange }
  /** `anchor` is GitHub's id for the file's diff: "diff-" + sha256 of the path. */
  | { kind: 'diff'; anchor: string; side: DiffSide; lines?: LineRange };

export const WALKTHROUGH_FILE = 'walkthrough.json';
export const SPEEDS = [1, 1.2, 1.4, 1.6, 1.8, 2] as const;

const PLAIN_VIEW = /\.(md|markdown|mdx|rst|adoc)$/i;

export function walkthroughType(walkthrough: Walkthrough): WalkthroughType {
  return walkthrough.type ?? WalkthroughType.CodeTour;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** GitHub's anchor for a file in a pull request diff. */
export async function diffAnchor(file: string): Promise<string> {
  return `diff-${await sha256Hex(file)}`;
}

/**
 * Where to show a slide, or undefined when the slide has no page of its own.
 * Code tours open the file at the pinned commit. PR reviews open the pull request's
 * Files changed tab with whitespace changes hidden, in the chosen diff view.
 */
export async function slideTarget(walkthrough: Walkthrough, slide: Slide, diffView: DiffView): Promise<SlideTarget | undefined> {
  const { host = 'github.com', owner, name, commit } = walkthrough.repo;
  if (walkthroughType(walkthrough) === WalkthroughType.PRReview && walkthrough.pullRequest) {
    const filesTab = `https://${host}/${owner}/${name}/pull/${walkthrough.pullRequest.number}/files?w=1&diff=${diffView}`;
    if (!slide.file) return { url: filesTab, focus: { kind: 'blob' } };
    const anchor = await diffAnchor(slide.file);
    const side = slide.side ?? 'new';
    const letter = side === 'new' ? 'R' : 'L';
    const hash = slide.lines ? `#${anchor}${letter}${slide.lines.start}-${letter}${slide.lines.end}` : `#${anchor}`;
    return { url: filesTab + hash, focus: { kind: 'diff', anchor, side, lines: slide.lines } };
  }
  if (!slide.file) return undefined;
  const path = slide.file.split('/').map(encodeURIComponent).join('/');
  // Rendered markdown has no line anchors; the plain view does.
  const query = PLAIN_VIEW.test(slide.file) ? '?plain=1' : '';
  const hash = slide.lines ? `#L${slide.lines.start}-L${slide.lines.end}` : '';
  return { url: `https://${host}/${owner}/${name}/blob/${commit}/${path}${query}${hash}`, focus: { kind: 'blob', lines: slide.lines } };
}

/** The URL fragment that points GitHub at a focus target. */
export function focusHash(focus: FocusTarget): string | undefined {
  if (!focus.lines) return focus.kind === 'diff' ? `#${focus.anchor}` : undefined;
  if (focus.kind === 'blob') return `#L${focus.lines.start}-L${focus.lines.end}`;
  const letter = focus.side === 'new' ? 'R' : 'L';
  return `#${focus.anchor}${letter}${focus.lines.start}-${letter}${focus.lines.end}`;
}

/**
 * Whether two URLs show the same page, ignoring the hash and the order of query
 * parameters (GitHub rewrites ?w=1&diff=split as ?diff=split&w=1). A pull request's
 * Files changed tab is /files in the classic layout and /changes in the newer one.
 */
export function samePage(a: string, b: string): boolean {
  try {
    const key = (raw: string) => {
      const url = new URL(raw);
      url.searchParams.sort();
      const path = url.pathname.replace(/(\/pull\/\d+)\/files$/, '$1/changes');
      return `${url.origin}${path}?${url.searchParams}`;
    };
    return key(a) === key(b);
  } catch {
    return false;
  }
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
  if (w.type !== undefined && !Object.values(WalkthroughType).includes(w.type)) return `unknown type "${w.type}"`;
  if (!w.id || !w.title) return 'missing id or title';
  if (!w.repo?.owner || !w.repo?.name || !w.repo?.commit) return 'missing repo owner, name or commit';
  if (w.type === WalkthroughType.PRReview && !w.pullRequest?.number) return 'PRReview without pullRequest.number';
  if (!Array.isArray(w.slides) || w.slides.length === 0) return 'no slides';
  const bad = w.slides.findIndex((s) => !s?.id || !s?.title);
  if (bad >= 0) return `slide ${bad + 1} is missing id or title`;
  return undefined;
}
