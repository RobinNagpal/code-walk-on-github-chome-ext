// The walkthrough format. Keep in sync with skills/code-walkthrough/walkthrough.schema.json
// and chrome-extension/lib/walkthrough.ts.

/**
 * What a walkthrough shows:
 * - CodeTour: files at one pinned commit.
 * - PRReview: the changes of a pull request, between its merge base and head.
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

/** How VS Code lays out a diff: one column (inline) or old and new side by side. */
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

export const WALKTHROUGH_FILE = 'walkthrough.json';
export const SPEEDS = [1, 1.2, 1.4, 1.6, 1.8, 2] as const;
/** The pace the skill sizes narration at; used to time slides that have no audio. */
export const WORDS_PER_MINUTE = 165;

export function walkthroughType(walkthrough: Walkthrough): WalkthroughType {
  return walkthrough.type ?? WalkthroughType.CodeTour;
}

/** How long a slide plays: its audio's length, or the time it takes to read the narration. */
export function slideDuration(slide: Slide): number {
  if (slide.durationSec) return slide.durationSec;
  const words = slide.narration?.split(/\s+/).filter(Boolean).length ?? 0;
  return Math.max(2, (words / WORDS_PER_MINUTE) * 60);
}

export function totalDuration(walkthrough: Walkthrough): number {
  return walkthrough.slides.reduce((sum, s) => sum + slideDuration(s), 0);
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
  if (w.type === WalkthroughType.PRReview && (!w.pullRequest?.number || !w.pullRequest.baseCommit || !w.pullRequest.headCommit)) {
    return 'PRReview without pullRequest number, baseCommit and headCommit';
  }
  if (!Array.isArray(w.slides) || w.slides.length === 0) return 'no slides';
  const bad = w.slides.findIndex((s) => !s?.id || !s?.title);
  if (bad >= 0) return `slide ${bad + 1} is missing id or title`;
  return undefined;
}
