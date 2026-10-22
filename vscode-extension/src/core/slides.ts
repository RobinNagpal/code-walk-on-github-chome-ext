// What each slide shows in the editor. Pure, so it can be unit tested without VS Code.
import { walkthroughType, WalkthroughType, type DiffSide, type LineRange, type Slide, type Walkthrough } from './walkthrough.ts';

/** A file at a commit in a GitHub repository. */
export interface SourceRef {
  owner: string;
  name: string;
  commit: string;
  path: string;
}

export type SlideView =
  /** An overview slide: nothing to open. */
  | { kind: 'none' }
  /** CodeTour: the file at the pinned commit. */
  | { kind: 'file'; source: SourceRef; lines?: LineRange }
  /** PRReview: the file's diff from the merge base to the PR head. */
  | { kind: 'diff'; base: SourceRef; head: SourceRef; side: DiffSide; lines?: LineRange; title: string };

export function slideView(walkthrough: Walkthrough, slide: Slide): SlideView {
  if (!slide.file) return { kind: 'none' };
  const { owner, name, commit } = walkthrough.repo;
  const pr = walkthrough.pullRequest;
  if (walkthroughType(walkthrough) === WalkthroughType.PRReview && pr) {
    const fileName = slide.file.split('/').pop();
    return {
      kind: 'diff',
      base: { owner, name, commit: pr.baseCommit, path: slide.file },
      head: { owner, name, commit: pr.headCommit, path: slide.file },
      side: slide.side ?? 'new',
      lines: slide.lines,
      title: `${fileName} (PR #${pr.number})`,
    };
  }
  return { kind: 'file', source: { owner, name, commit, path: slide.file }, lines: slide.lines };
}

/** The path part of a source URI: /<owner>/<repo>/<commit>/<file path>. */
export function sourcePath(ref: SourceRef): string {
  return `/${ref.owner}/${ref.name}/${ref.commit}/${ref.path}`;
}

export function parseSourcePath(path: string): SourceRef | undefined {
  const match = path.match(/^\/([^/]+)\/([^/]+)\/([0-9a-f]{7,40})\/(.+)$/i);
  return match ? { owner: match[1], name: match[2], commit: match[3], path: match[4] } : undefined;
}

/** "motion.py · new lines 12–30": the slide's file name and lines, for the player. */
export function slideLocation(walkthrough: Walkthrough, slide: Slide): string | undefined {
  if (!slide.file) return undefined;
  const isReview = walkthroughType(walkthrough) === WalkthroughType.PRReview;
  const lineLabel = isReview ? (slide.side === 'old' ? 'removed lines' : 'new lines') : 'lines';
  return `${slide.file.split('/').pop()}${slide.lines ? ` · ${lineLabel} ${slide.lines.start}–${slide.lines.end}` : ''}`;
}

/** Where the player goes when a slide's audio ends. */
export function afterSlideEnds(index: number, count: number, autoplay: boolean): { index: number; playing: boolean } {
  if (autoplay && index < count - 1) return { index: index + 1, playing: true };
  return { index, playing: false };
}
