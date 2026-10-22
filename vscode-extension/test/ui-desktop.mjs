// Layer 3, desktop: starts the downloaded desktop VS Code with the extension and the fixture
// zips, and clicks through the same flow as the web run (test/ui/flow.mjs). Menus are set
// to VS Code's own (not the operating system's), so the test can click them. Screenshots go
// to .vscode-test/ui-desktop/.
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareFixtures } from './prepare-fixtures.mjs';
import { runFlow } from './ui/flow.mjs';

const root = resolve(import.meta.dirname, '..');
const userDataDir = mkdtempSync(join(tmpdir(), 'cw-vscode-ui-'));
mkdirSync(join(userDataDir, 'User'), { recursive: true });
writeFileSync(
  join(userDataDir, 'User', 'settings.json'),
  JSON.stringify({
    'window.menuStyle': 'custom',
    'window.titleBarStyle': 'custom',
    'workbench.startupEditor': 'none',
    'security.workspace.trust.enabled': false,
  }),
);

const app = await electron.launch({
  executablePath: await downloadAndUnzipVSCode('stable'),
  args: [
    prepareFixtures(),
    `--extensionDevelopmentPath=${root}`,
    '--disable-extensions',
    `--user-data-dir=${userDataDir}`,
    '--skip-welcome',
    '--skip-release-notes',
  ],
});
let failures = 1;
const page = await app.firstWindow();
try {
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});
  const checks = await runFlow(page, join(root, '.vscode-test/ui-desktop'));
  failures = checks.failures.length;
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll UI checks passed (desktop)');
} catch (error) {
  console.error(error);
  await page.screenshot({ path: join(root, '.vscode-test/ui-desktop/failure.png') });
} finally {
  await app.close();
  process.exit(failures ? 1 : 0);
}
