// Layer 2: runs test/suite in a downloaded desktop VS Code, with only this extension loaded
// and a fresh profile, on a folder holding the fixture zips.
import { runTests } from '@vscode/test-electron';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareFixtures } from './prepare-fixtures.mjs';

const root = resolve(import.meta.dirname, '..');
try {
  await runTests({
    version: 'stable',
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'dist/test/node/index.node.js'),
    launchArgs: [
      prepareFixtures(),
      '--disable-extensions',
      '--disable-workspace-trust',
      '--user-data-dir',
      mkdtempSync(join(tmpdir(), 'cw-vscode-')),
    ],
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
