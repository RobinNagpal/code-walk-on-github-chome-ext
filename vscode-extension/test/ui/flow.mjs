// Layer 3: drives the real VS Code UI with mouse clicks, as a person would, and checks
// what is on screen. Shared by the web (ui-web.mjs) and desktop (ui-desktop.mjs) runs.
// Nothing here calls the extension's API; everything goes through the workbench's DOM.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const HIGHLIGHT = /rgba\(255, 196, 0, 0\.\d+\)/;

export class Checks {
  failures = [];
  ok(condition, message) {
    console.log(`${condition ? '  ✔' : '  ✘'} ${message}`);
    if (!condition) this.failures.push(message);
  }
}

/**
 * The Player webview's page. VS Code nests it in two iframes and replaces the inner one as
 * the view loads, so this locator finds the current frame each time it is used.
 */
async function playerFrame(page) {
  const frame = page.locator('iframe.webview').first().contentFrame().locator('iframe#active-frame').contentFrame();
  await frame.locator('.player, .empty').first().waitFor({ timeout: 20_000 });
  return frame;
}

async function playerText(frame, selector) {
  return (await frame.locator(selector).first().textContent({ timeout: 5000 }).catch(() => ''))?.trim() ?? '';
}

/** Seconds on the Player's clock ("0:07" → 7). */
async function clock(frame) {
  const [m, s] = (await playerText(frame, '.times span')).split(':').map(Number);
  return m * 60 + s;
}

/** Lines in visible editors painted with the walkthrough highlight colour. */
function highlightedLines(page) {
  return page.evaluate((pattern) => {
    const re = new RegExp(pattern);
    return [...document.querySelectorAll('.monaco-editor .view-overlays > div > div')].filter(
      (el) => el.getBoundingClientRect().height > 0 && re.test(getComputedStyle(el).backgroundColor),
    ).length;
  }, HIGHLIGHT.source);
}

async function waitUntil(page, what, check, timeoutMs = 20_000) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await page.waitForTimeout(250);
  }
}

/** Shows a side bar view by its activity bar icon. Clicking the icon of the view already showing would hide it. */
async function showView(page, label) {
  const item = page.locator('.activitybar .action-item', { has: page.locator(`[aria-label^="${label}"]`) }).first();
  const shown = (await item.getAttribute('class'))?.includes('checked') && (await page.locator('.part.sidebar').isVisible());
  if (!shown) await item.click();
}

async function openZipFromExplorer(page, name) {
  await showView(page, 'Explorer');
  const row = page.locator(`.explorer-folders-view .monaco-list-row[aria-label^="${name}"]`).first();
  await row.waitFor({ timeout: 20_000 });
  await row.click({ button: 'right' });
  // VS Code's menus act on their own mouse events; hover the item and press Enter, as a keyboard user would.
  await page.locator('.context-view .action-menu-item', { hasText: 'Open Walkthrough Zip' }).first().hover();
  await page.keyboard.press('Enter');
  await page.locator('.notification-list-item', { hasText: 'Added' }).first().waitFor({ timeout: 20_000 });
}

async function startFromList(page, title) {
  await showView(page, 'Code Walkthroughs');
  // Scoped to the side bar: notifications are list rows too.
  const item = page.locator('.part.sidebar .monaco-list-row', { hasText: title }).first();
  await item.waitFor({ timeout: 20_000 });
  await item.click();
}

export async function runFlow(page, shotsDir) {
  mkdirSync(shotsDir, { recursive: true });
  const shot = (name) => page.screenshot({ path: join(shotsDir, `${name}.png`) });
  const checks = new Checks();
  await page.locator('.monaco-workbench').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(3000);

  console.log('PR review (robotics-basics #6)');
  await openZipFromExplorer(page, 'robotics-basics-pr-6-frames-3d-and-motion.zip');
  await startFromList(page, 'PR #6');
  let player = await playerFrame(page);
  await waitUntil(page, 'slide 1 in the Player', async () => (await playerText(player, '.meta')).includes('Slide 1 of 9'));
  await page.waitForTimeout(1500);
  const notice = await playerText(player, '.notice');
  const startedByItself = (await player.locator('button[title="Pause"]').count()) === 1;
  checks.ok(startedByItself || notice.includes('Press play'), `starting either plays or asks for a click (notice: "${notice || 'none'}")`);
  await shot('01-pr-started');

  // Play is a real click inside the Player, which lets the browser start audio.
  if (!startedByItself) await player.locator('button[title="Play"]').click();
  const t0 = await clock(player);
  await page.waitForTimeout(3200);
  const t1 = await clock(player);
  checks.ok(t1 - t0 >= 2, `the audio clock runs after clicking Play (${t0}s → ${t1}s)`);

  // Straight from the overview to a changed file (slide 7), before any diff is open: the split
  // diff must open at the slide's lines, not jump to the file's first change once VS Code has
  // compared the files.
  await player.locator('.list-toggle').click();
  await player.locator('.slides button').nth(6).click();
  await waitUntil(page, 'slide 7', async () => (await playerText(player, '.meta')).includes('Slide 7 of 9'));
  await waitUntil(page, 'the kinematics.py diff', async () => (await page.locator('.tab.active').first().textContent())?.includes('kinematics.py'));
  await page.waitForTimeout(4000);
  const numbers = await page.evaluate(() =>
    [...document.querySelectorAll('.monaco-diff-editor .editor.modified .line-numbers')].map((el) => Number(el.textContent)).filter(Boolean),
  );
  checks.ok(numbers.includes(509) && numbers.includes(530), `the split diff of a changed file opens at new lines 509–530 (showing ${Math.min(...numbers)}–${Math.max(...numbers)})`);
  checks.ok((await highlightedLines(page)) >= 20, `and highlights them (${await highlightedLines(page)} lines)`);
  await shot('02a-pr-changed-file-split');
  // Back to slide 1, so Next goes to slide 2.
  await player.locator('.slides button').nth(0).click();
  await waitUntil(page, 'slide 1 again', async () => (await playerText(player, '.meta')).includes('Slide 1 of 9'));
  await player.locator('.list-toggle').click();

  await player.locator('button[title="Next slide"]').click();
  await waitUntil(page, 'slide 2', async () => (await playerText(player, '.meta')).includes('Slide 2 of 9'));
  await waitUntil(page, 'the diff tab', async () => (await page.locator('.tab.active').first().textContent())?.includes('orientation.py'));
  await waitUntil(page, 'highlighted lines', async () => (await highlightedLines(page)) >= 10);
  checks.ok(true, `slide 2 opened the orientation.py diff with ${await highlightedLines(page)} highlighted lines`);
  checks.ok((await page.locator('.monaco-diff-editor.side-by-side').count()) > 0, 'the diff is side by side (Split)');
  checks.ok((await playerText(player, '.location')).includes('new lines 101–130'), 'the Player names the lines');
  await shot('02-pr-diff-split');

  const playing = (await player.locator('button[title="Pause"]').count()) === 1;
  checks.ok(playing, 'Next keeps playing without another click');

  await player.locator('select[title="Playback speed"]').selectOption('2');
  const s0 = await clock(player);
  await page.waitForTimeout(4000);
  const s1 = await clock(player);
  checks.ok(s1 - s0 >= 6, `2× speed: about 8s of audio in 4s (${s0}s → ${s1}s)`);

  // Auto: jump near the end of the slide; it should move on to slide 3 and keep playing.
  const bar = await player.locator('.progress').boundingBox();
  await player.locator('.progress').click({ position: { x: bar.width * 0.97, y: bar.height / 2 } });
  await waitUntil(page, 'autoplay to slide 3', async () => (await playerText(player, '.meta')).includes('Slide 3 of 9'));
  await page.waitForTimeout(1500);
  checks.ok((await player.locator('button[title="Pause"]').count()) === 1, 'Auto moved to slide 3 and kept playing');
  checks.ok((await highlightedLines(page)) >= 10, 'slide 3 (same file) is highlighted');
  await shot('03-pr-autoplay-same-file');

  // Manual: the slide stops at its end.
  await player.locator('.mode button', { hasText: 'Manual' }).click();
  await player.locator('.progress').click({ position: { x: bar.width * 0.97, y: bar.height / 2 } });
  await page.waitForTimeout(4000);
  checks.ok((await playerText(player, '.meta')).includes('Slide 3 of 9'), 'Manual stays on slide 3');
  checks.ok((await player.locator('button[title="Play"]').count()) === 1, 'and stops playing');
  await player.locator('.mode button', { hasText: 'Auto' }).click();

  // Removed lines (slide 8) from the slide list, then the Unified view.
  await player.locator('.list-toggle').click();
  await player.locator('.slides button').nth(7).click();
  await waitUntil(page, 'slide 8', async () => (await playerText(player, '.meta')).includes('Slide 8 of 9'));
  await waitUntil(page, 'the overview.md diff', async () => (await page.locator('.tab.active').first().textContent())?.includes('01_overview.md'));
  await waitUntil(page, 'removed lines highlighted', async () => (await highlightedLines(page)) >= 20);
  checks.ok(true, `slide 8 highlights ${await highlightedLines(page)} removed lines on the old side`);
  await shot('04-pr-removed-lines');

  await player.locator('.mode button', { hasText: 'Unified' }).click();
  await waitUntil(page, 'the inline diff', async () => (await page.locator('.monaco-diff-editor.side-by-side').count()) === 0);
  checks.ok(true, 'Unified switches the diff to one column');
  await player.locator('.slides button').nth(4).click();
  await waitUntil(page, 'slide 5', async () => (await playerText(player, '.meta')).includes('Slide 5 of 9'));
  await waitUntil(page, 'highlight in the inline diff', async () => (await highlightedLines(page)) >= 20);
  checks.ok(true, `slide 5 in the inline diff highlights ${await highlightedLines(page)} lines`);
  await shot('05-pr-unified');
  await player.locator('.slides button').nth(7).click();
  await waitUntil(page, 'slide 8 in one column', async () => (await playerText(player, '.meta')).includes('Slide 8 of 9'));
  // One column draws removed lines inside the new file; the slide's heading must be on screen.
  await waitUntil(page, 'the removed heading on screen', () =>
    page.evaluate(() => [...document.querySelectorAll('.monaco-editor .view-zones *, .monaco-editor .view-lines *')].some(
      // The editor draws spaces as non-breaking spaces.
      (el) => el.textContent?.replace(/\u00a0/g, ' ').includes('Step 4: hand the arm to ROS') && el.getBoundingClientRect().top > 0 && el.getBoundingClientRect().bottom < innerHeight,
    )),
  );
  checks.ok(true, 'slide 8 in one column scrolls to the removed lines');
  await shot('05b-pr-unified-removed-lines');
  await player.locator('.mode button', { hasText: 'Split' }).click();

  console.log('Code tour (clear the table, solution 1)');
  await openZipFromExplorer(page, 'clear-the-table-solution-1-one-fixed-nudge.zip');
  await startFromList(page, 'Clear the table, solution 1');
  player = await playerFrame(page);
  await waitUntil(page, 'the code tour in the Player', async () => (await playerText(player, '.meta')).includes('of 32'));
  await waitUntil(page, 'problem.md', async () => (await page.locator('.tab.active').first().textContent())?.includes('problem.md'));
  await waitUntil(page, 'highlighted lines', async () => (await highlightedLines(page)) >= 10);
  checks.ok(true, `slide 1 opened problem.md at the pinned commit with ${await highlightedLines(page)} highlighted lines`);
  await page.waitForTimeout(2000);
  checks.ok((await player.locator('button[title="Pause"]').count()) === 1, 'the code tour plays (the Player was clicked before)');
  const c0 = await clock(player);
  await page.waitForTimeout(2200);
  checks.ok((await clock(player)) > c0, 'its audio clock runs');
  await shot('06-tour-slide-1');

  await player.locator('.slides button').nth(4).click();
  await waitUntil(page, 'contract.py', async () => (await page.locator('.tab.active').first().textContent())?.includes('contract.py'));
  await waitUntil(page, 'highlighted lines', async () => (await highlightedLines(page)) >= 20);
  checks.ok(true, `slide 5 opened contract.py with ${await highlightedLines(page)} highlighted lines`);
  await shot('07-tour-contract');

  await player.locator('.stop').click();
  await waitUntil(page, 'the empty Player', async () => (await player.locator('.empty').count()) === 1);
  checks.ok((await highlightedLines(page)) === 0, 'ending the walkthrough removes the highlight');
  return checks;
}
