// Layer 1: finding where removed lines appear in a one-column diff.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commonLines, newLineAfter } from '../../src/core/lineMap.ts';

describe('commonLines', () => {
  it('pairs the lines both versions share, in order', () => {
    assert.deepEqual(commonLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']), [
      [0, 0],
      [2, 2],
      [3, 3],
    ]);
    assert.deepEqual(commonLines([], ['a']), []);
    assert.deepEqual(commonLines(['a'], ['a']), [[0, 0]]);
  });

  it('finds a longest common run (for example, a moved block)', () => {
    const pairs = commonLines('a b c d e f'.split(' '), 'a d e f b c'.split(' '));
    assert.equal(pairs.length, 4);
  });

  it('stays fast on a large file with a small change', () => {
    const old = Array.from({ length: 20_000 }, (_, i) => `line ${i}`);
    const changed = [...old.slice(0, 10_000), 'inserted', ...old.slice(10_005)];
    const started = Date.now();
    assert.equal(commonLines(old, changed).length, 19_995);
    assert.ok(Date.now() - started < 1000);
  });
});

describe('newLineAfter', () => {
  const oldText = ['# Title', 'keep 1', 'removed A', 'removed B', 'keep 2', 'end'].join('\n');
  const newText = ['# Title', 'added', 'keep 1', 'keep 2', 'end'].join('\n');

  it('points at the new line that follows a removed block', () => {
    // Old lines 3–4 were removed after "keep 1" (new line 3), so they show above new line 4.
    assert.equal(newLineAfter(oldText, newText, 3), 4);
  });

  it('handles removals at the very start and in a file that was deleted', () => {
    assert.equal(newLineAfter('gone\nkeep', 'keep', 1), 1);
    assert.equal(newLineAfter('a\nb\nc', '', 2), 1);
  });
});
