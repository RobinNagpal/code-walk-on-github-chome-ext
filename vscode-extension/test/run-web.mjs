// Layer 2, web: runs the same suites in VS Code for the web (the build vscode.dev serves)
// in a headless Chromium. The extension runs in the browser's extension host, as it does
// on vscode.dev and github.dev; the fixture folder is mounted as the workspace.
import { runTests } from '@vscode/test-web';
import { join, resolve } from 'node:path';
import { format } from 'node:util';
import { prepareFixtures } from './prepare-fixtures.mjs';

const root = resolve(import.meta.dirname, '..');

// VS Code for the web doesn't always report the end of the run, which leaves runTests
// waiting forever. Mocha's summary ("9 passing", "1 failing") is printed either way, so
// the run ends a moment after it.
const SUMMARY_GRACE_MS = 3000;
const RUN_TIMEOUT_MS = 10 * 60_000;
let passing = false;
let failing = 0;
for (const level of ['log', 'error', 'info', 'warn']) {
  const print = console[level].bind(console);
  console[level] = (...args) => {
    print(...args);
    // Mocha prints "%d passing" with the number as a separate argument.
    const text = format(...args).replace(/\x1b\[[0-9;]*m/g, '');
    const failed = text.match(/^\s*(\d+) failing/m);
    if (failed) failing = Number(failed[1]);
    if (!passing && /^\s*\d+ passing/m.test(text)) {
      passing = true;
      setTimeout(() => process.exit(failing ? 1 : 0), SUMMARY_GRACE_MS);
    }
  };
}
setTimeout(() => {
  console.error('The web test run timed out.');
  process.exit(1);
}, RUN_TIMEOUT_MS);

try {
  await runTests({
    browserType: 'chromium',
    quality: 'stable',
    headless: true,
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'dist/test/web/index.js'),
    folderPath: prepareFixtures(),
    testRunnerDataDir: join(root, '.vscode-test-web'),
    // Let the Player start audio without a click; the UI test clicks Play like a person.
    browserOptions: ['--autoplay-policy=no-user-gesture-required'],
  });
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
