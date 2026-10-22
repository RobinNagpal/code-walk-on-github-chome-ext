// Entry point for the tests in desktop VS Code (@vscode/test-electron loads it).
import Mocha from 'mocha';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 90_000 });
  for (const file of readdirSync(__dirname)) {
    if (file.endsWith('.test.js')) mocha.addFile(join(__dirname, file));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} tests failed`)) : resolve()));
  });
}
