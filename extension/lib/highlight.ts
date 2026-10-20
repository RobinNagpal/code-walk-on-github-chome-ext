// Highlights and scrolls to a line range on a GitHub file page.
//
// GitHub's code view gives each code line id="LC<n>" and each line-number cell
// data-line-number="<n>". The highlight is a stylesheet rule rather than inline
// styles, so it survives GitHub's React re-renders.
import type { LineRange } from './walkthrough';

const STYLE_ID = 'code-walkthrough-highlight';
const WAIT_MS = 8000;
const POLL_MS = 150;

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

function lineElement(n: number): HTMLElement | undefined {
  // The page can hold hidden copies of a line; use the one that is laid out.
  const candidates = document.querySelectorAll<HTMLElement>(`[id="LC${n}"], .react-line-number[data-line-number="${n}"]`);
  return [...candidates].find((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

function scrollTo(range: LineRange, first: HTMLElement): void {
  const lineHeight = first.getBoundingClientRect().height || 20;
  const visibleLines = Math.floor((window.innerHeight * 0.8) / lineHeight);
  const span = range.end - range.start + 1;
  // Centre a range that fits; otherwise show its top part.
  const target = span <= visibleLines ? Math.floor((range.start + range.end) / 2) : range.start + Math.floor(visibleLines / 2) - 2;
  (lineElement(target) ?? first).scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function focusLines(range: LineRange | undefined): void {
  clearHighlight();
  if (!range) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const code: string[] = [];
  const numbers: string[] = [];
  for (let n = range.start; n <= range.end; n++) {
    code.push(`[id="LC${n}"]`);
    numbers.push(`.react-line-number[data-line-number="${n}"]`);
  }
  styleElement().textContent = `
    ${code.join(',')} { background-color: rgba(255, 196, 0, 0.18) !important; }
    ${numbers.join(',')} { background-color: rgba(255, 196, 0, 0.45) !important; }
    [id="LC${range.start}"] { box-shadow: inset 0 1px 0 rgba(255, 170, 0, 0.8); }
    [id="LC${range.end}"] { box-shadow: inset 0 -1px 0 rgba(255, 170, 0, 0.8); }
  `;

  // Lines appear once GitHub has rendered the file; very long files render lazily,
  // in which case asking GitHub to jump to the anchor brings the lines into the DOM.
  const startedAt = Date.now();
  let askedGitHub = false;
  pending = window.setInterval(() => {
    const first = lineElement(range.start);
    if (first) {
      window.clearInterval(pending);
      pending = undefined;
      scrollTo(range, first);
      return;
    }
    const waited = Date.now() - startedAt;
    if (!askedGitHub && waited > 1500) {
      askedGitHub = true;
      location.hash = `#L${range.start}-L${range.end}`;
    }
    if (waited > WAIT_MS) {
      window.clearInterval(pending);
      pending = undefined;
    }
  }, POLL_MS);
}
