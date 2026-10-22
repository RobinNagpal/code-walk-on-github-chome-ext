// Layer 1: what each slide shows, and the format helpers, without VS Code.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterSlideEnds, parseSourcePath, slideLocation, slideView, sourcePath } from '../../src/core/slides.ts';
import { formatTime, invalidReason, slideDuration, totalDuration, type Walkthrough } from '../../src/core/walkthrough.ts';

const head = 'd0a2e1b1c5b9d8f0d6a44da6838ec4b653296073';
const base = 'c6663d697a5cd5e121cb78fb16393ae1f6fb5d90';

const tour: Walkthrough = {
  version: 1,
  id: 'tour',
  title: 'Tour',
  repo: { owner: 'octo', name: 'demo', commit: head },
  slides: [
    { id: 'a', title: 'Overview', summary: '', narration: 'word '.repeat(165) },
    { id: 'b', title: 'Code', summary: '', narration: '', file: 'src/deep/file.py', lines: { start: 4, end: 9 }, durationSec: 30 },
  ],
};

const review: Walkthrough = {
  ...tour,
  type: 'PRReview',
  pullRequest: { number: 6, baseCommit: base, headCommit: head },
  slides: [
    ...tour.slides,
    { id: 'c', title: 'Removed', summary: '', narration: '', file: 'docs/old.md', lines: { start: 480, end: 539 }, side: 'old' },
  ],
};

describe('slideView', () => {
  it('opens nothing for an overview slide', () => {
    assert.deepEqual(slideView(tour, tour.slides[0]), { kind: 'none' });
    assert.deepEqual(slideView(review, review.slides[0]), { kind: 'none' });
  });

  it('opens a code tour file at the pinned commit', () => {
    assert.deepEqual(slideView(tour, tour.slides[1]), {
      kind: 'file',
      source: { owner: 'octo', name: 'demo', commit: head, path: 'src/deep/file.py' },
      lines: { start: 4, end: 9 },
    });
  });

  it('opens a PR file as a diff from the merge base to the head, on the slide side', () => {
    const view = slideView(review, review.slides[1]);
    assert.equal(view.kind, 'diff');
    if (view.kind !== 'diff') return;
    assert.equal(view.base.commit, base);
    assert.equal(view.head.commit, head);
    assert.equal(view.side, 'new');
    assert.equal(view.title, 'file.py (PR #6)');
    const old = slideView(review, review.slides[2]);
    assert.equal(old.kind === 'diff' && old.side, 'old');
  });
});

describe('source paths', () => {
  it('round-trip, including slashes in the file path', () => {
    const ref = { owner: 'octo', name: 'demo', commit: head, path: 'src/deep/file.py' };
    assert.equal(sourcePath(ref), `/octo/demo/${head}/src/deep/file.py`);
    assert.deepEqual(parseSourcePath(sourcePath(ref)), ref);
    assert.equal(parseSourcePath('/octo/demo/not-a-sha/file.py'), undefined);
  });
});

describe('slideLocation', () => {
  it('names the file and the lines, and which side of a diff', () => {
    assert.equal(slideLocation(tour, tour.slides[1]), 'file.py · lines 4–9');
    assert.equal(slideLocation(review, review.slides[1]), 'file.py · new lines 4–9');
    assert.equal(slideLocation(review, review.slides[2]), 'old.md · removed lines 480–539');
    assert.equal(slideLocation(tour, tour.slides[0]), undefined);
  });
});

describe('afterSlideEnds', () => {
  it('moves on in autoplay and stops at the last slide', () => {
    assert.deepEqual(afterSlideEnds(0, 3, true), { index: 1, playing: true });
    assert.deepEqual(afterSlideEnds(2, 3, true), { index: 2, playing: false });
  });

  it('stays on the slide in manual mode', () => {
    assert.deepEqual(afterSlideEnds(0, 3, false), { index: 0, playing: false });
  });
});

describe('walkthrough helpers', () => {
  it('times a slide without audio by its narration at 165 words a minute', () => {
    assert.equal(slideDuration(tour.slides[0]), 60);
    assert.equal(slideDuration(tour.slides[1]), 30);
    assert.equal(totalDuration(tour), 90);
    assert.equal(formatTime(90), '1:30');
  });

  it('rejects a PR review without both commits', () => {
    assert.equal(invalidReason(review), undefined);
    assert.match(invalidReason({ ...review, pullRequest: { number: 6 } })!, /baseCommit and headCommit/);
  });
});
