// Entry point for the tests in VS Code for the web (@vscode/test-web loads it in the
// browser's extension host). Mocha is set up before the suites are imported.
import './setup.web.ts';
import './player.test.ts';

export function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} tests failed`)) : resolve()));
  });
}
