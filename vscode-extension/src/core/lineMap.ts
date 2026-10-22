// Where removed lines show up in a one-column (inline) diff. VS Code draws them inside the
// new file, just above the first new line after them, so a slide about removed lines
// scrolls the new file there.

/**
 * Pairs of equal lines (0-based old index, new index) in a longest common subsequence,
 * found with Myers' O((N+M)·D) algorithm, so large files with small changes stay fast.
 */
export function commonLines(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const offset = n + m + 1;
  // v[offset + k]: the furthest x reached on diagonal k. trace[d] is v before step d.
  let v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  const down = (row: Int32Array, d: number, k: number) => k === -d || (k !== d && row[offset + k - 1] < row[offset + k + 1]);
  for (let d = 0; d <= n + m; d++) {
    trace.push(v);
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = down(v, d, k) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, down, offset, n, m);
    }
    v = next;
  }
  return [];
}

function backtrack(
  trace: Int32Array[],
  down: (row: Int32Array, d: number, k: number) => boolean,
  offset: number,
  n: number,
  m: number,
): [number, number][] {
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const k = x - y;
    const prevK = down(trace[d], d, k) ? k + 1 : k - 1;
    const prevX = trace[d][offset + prevK];
    const prevY = prevX - prevK;
    for (; x > prevX && y > prevY; x--, y--) pairs.push([x - 1, y - 1]);
    x = prevX;
    y = prevY;
  }
  for (; x > 0 && y > 0; x--, y--) pairs.push([x - 1, y - 1]);
  return pairs.reverse();
}

/**
 * The 1-based line of the new file that follows the old file's `oldLine` in an inline diff:
 * the line after the last unchanged line before it.
 */
export function newLineAfter(oldText: string, newText: string, oldLine: number): number {
  let line = 1;
  for (const [oldIndex, newIndex] of commonLines(oldText.split('\n'), newText.split('\n'))) {
    if (oldIndex >= oldLine - 1) break;
    line = newIndex + 2;
  }
  return line;
}
