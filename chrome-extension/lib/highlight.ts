// Highlights and scrolls to a slide's lines on GitHub: in a file (blob view) or in a
// pull request's diff (Files changed tab).
//
// Blob view: each code line has id="LC<n>", each line-number cell data-line-number="<n>".
// Diff view: a line's anchor is "<anchor>R<n>" (new side) or "<anchor>L<n>" (old side), where
// <anchor> is "diff-" + sha256 of the file path. The classic layout puts it as the id of the
// line-number cell; the newer layout (/pull/<n>/changes) puts it in data-line-anchor on the
// code cell. Either way, in split view the code cell follows its number cell, and in unified
// view the row holds both numbers and the code.
//
// The highlight is a stylesheet rule rather than inline styles, so it survives GitHub's
// re-renders.
import type { FocusTarget, LineRange } from './walkthrough';
import { focusHash } from './walkthrough';

const STYLE_ID = 'code-walkthrough-highlight';
const WAIT_MS = 8000;
const POLL_MS = 150;
const SOFT = 'rgba(255, 196, 0, 0.18)';
const STRONG = 'rgba(255, 196, 0, 0.45)';

let pending: number | undefined;

function styleElement(): HTMLStyleElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.append(style);
  }
  return style;
}

export function clearHighlight(): void {
  if (pending) window.clearInterval(pending);
  pending = undefined;
  document.getElementById(STYLE_ID)?.remove();
}

function visible(selector: string): HTMLElement | undefined {
  // The page can hold hidden copies of a line; use the one that is laid out.
  return [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

function range(lines: LineRange): number[] {
  return Array.from({ length: lines.end - lines.start + 1 }, (_, i) => lines.start + i);
}

function diffLineAnchor(target: Extract<FocusTarget, { kind: 'diff' }>, n: number): string {
  return `${target.anchor}${target.side === 'new' ? 'R' : 'L'}${n}`;
}

/** The newer layout's code cell for a line. A hunk header cell carries the anchor of the line before the hunk. */
function codeCell(anchor: string): string {
  return `td[data-line-anchor="${anchor}"]:not(.diff-hunk-cell)`;
}

/** CSS selector for line n's element, used to find and to scroll. */
function lineSelector(target: FocusTarget, n: number): string {
  if (target.kind === 'blob') return `[id="LC${n}"], .react-line-number[data-line-number="${n}"]`;
  const anchor = diffLineAnchor(target, n);
  return `[id="${anchor}"], ${codeCell(anchor)}`;
}

function highlightCss(target: FocusTarget, lines: LineRange): string {
  const numbers = range(lines);
  if (target.kind === 'blob') {
    return `
      ${numbers.map((n) => `[id="LC${n}"]`).join(',')} { background-color: ${SOFT} !important; }
      ${numbers.map((n) => `.react-line-number[data-line-number="${n}"]`).join(',')} { background-color: ${STRONG} !important; }
      [id="LC${lines.start}"] { box-shadow: inset 0 1px 0 rgba(255, 170, 0, 0.8); }
      [id="LC${lines.end}"] { box-shadow: inset 0 -1px 0 rgba(255, 170, 0, 0.8); }
    `;
  }
  const anchors = numbers.map((n) => diffLineAnchor(target, n));
  const ids = anchors.map((anchor) => `[id="${anchor}"]`);
  // Newer layout: split view marks its code cells with their side. An unchanged line carries
  // its R anchor on both sides, so only the slide's side is picked.
  const sideClass = target.side === 'new' ? 'right-side-diff-cell' : 'left-side-diff-cell';
  const splitCells = anchors.map((anchor) => `${codeCell(anchor)}.${sideClass}`);
  const unifiedCells = anchors.map((anchor) => `${codeCell(anchor)}:not(.left-side-diff-cell, .right-side-diff-cell)`);
  return `
    ${ids.map((id) => `table.file-diff-split ${id}, table.file-diff-split ${id} + td`).join(',')} { background-color: ${STRONG} !important; }
    ${ids.map((id) => `table:not(.file-diff-split) tr:has(> ${id}) > td`).join(',')} { background-color: ${STRONG} !important; }
    ${splitCells.map((cell) => `${cell}, td:has(+ ${cell})`).join(',')} { background-color: ${STRONG} !important; }
    ${unifiedCells.map((cell) => `tr:has(> ${cell}) > td`).join(',')} { background-color: ${STRONG} !important; }
  `;
}

function scrollTo(target: FocusTarget, lines: LineRange, first: HTMLElement): void {
  const lineHeight = first.getBoundingClientRect().height || 20;
  const visibleLines = Math.floor((window.innerHeight * 0.8) / lineHeight);
  const span = lines.end - lines.start + 1;
  // Centre a range that fits; otherwise show its top part.
  const middle = span <= visibleLines ? Math.floor((lines.start + lines.end) / 2) : lines.start + Math.floor(visibleLines / 2) - 2;
  (visible(lineSelector(target, middle)) ?? first).scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** GitHub collapses deleted files and large diffs behind a "Load diff" button; press it. */
function loadCollapsedDiff(anchor: string): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(`[id="${anchor}"] button, [data-diff-anchor="${anchor}"] button`);
  [...buttons].find((button) => /^load diff$/i.test(button.textContent?.trim() ?? ''))?.click();
}

export function focusLines(target: FocusTarget | undefined): void {
  clearHighlight();
  if (!target?.lines) {
    if (target?.kind === 'diff') {
      // A whole file in a diff: bring its header into view.
      document.getElementById(target.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }
  const lines = target.lines;
  styleElement().textContent = highlightCss(target, lines);

  // Lines appear once GitHub has rendered them; long files and big diffs render lazily,
  // in which case asking GitHub to jump to the anchor brings the lines into the DOM.
  const startedAt = Date.now();
  let askedGitHub = false;
  if (target.kind === 'diff') loadCollapsedDiff(target.anchor);
  pending = window.setInterval(() => {
    const first = visible(lineSelector(target, lines.start));
    if (first) {
      window.clearInterval(pending);
      pending = undefined;
      scrollTo(target, lines, first);
      return;
    }
    const waited = Date.now() - startedAt;
    const hash = focusHash(target);
    if (!askedGitHub && waited > 1500 && hash) {
      askedGitHub = true;
      location.hash = hash;
    }
    if (waited > WAIT_MS) {
      window.clearInterval(pending);
      pending = undefined;
    }
  }, POLL_MS);
}
