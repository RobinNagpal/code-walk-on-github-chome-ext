// Layer 3, web: serves VS Code for the web with the extension and the fixture zips, opens
// it in a headless Chromium with the browser's normal autoplay rules, and clicks through
// a PR review and a code tour (test/ui/flow.mjs). Screenshots go to .vscode-test/ui-web/.
import { open } from '@vscode/test-web';
import { chromium } from 'playwright';
import { join, resolve } from 'node:path';
import { prepareFixtures } from './prepare-fixtures.mjs';
import { runFlow } from './ui/flow.mjs';

const root = resolve(import.meta.dirname, '..');
const port = 3011;
const server = await open({
  browserType: 'none',
  quality: 'stable',
  port,
  extensionDevelopmentPath: root,
  folderPath: prepareFixtures(),
  testRunnerDataDir: join(root, '.vscode-test-web'),
});
const browser = await chromium.launch();
let failures = 1;
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (message) => {
  if (message.type() === 'error' && /walkthrough/i.test(message.text())) console.log(`[page error] ${message.text()}`);
});
try {
  await page.goto(`http://localhost:${port}`);
  const checks = await runFlow(page, join(root, '.vscode-test/ui-web'));
  failures = checks.failures.length;
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll UI checks passed (web)');
} catch (error) {
  console.error(error);
  await page.screenshot({ path: join(root, '.vscode-test/ui-web/failure.png') });
} finally {
  await browser.close();
  server.dispose();
  process.exit(failures ? 1 : 0);
}
