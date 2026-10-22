// Bundles the extension twice, for desktop VS Code (Node) and for vscode.dev / github.dev
// (a web worker), plus the player's webview script. `--tests` also bundles the test suites.
import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

const shared = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'es2022' };
const extension = { ...shared, entryPoints: ['src/extension.ts'], external: ['vscode'], format: 'cjs' };

const builds = [
  { ...extension, platform: 'node', outfile: 'dist/node/extension.js' },
  { ...extension, platform: 'browser', mainFields: ['browser', 'module', 'main'], outfile: 'dist/web/extension.js' },
  {
    ...shared,
    entryPoints: ['src/webview/main.tsx'],
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    outfile: 'dist/webview/player.js',
  },
];

if (tests) {
  const suites = readdirSync('test/suite').filter((f) => f.endsWith('.test.ts'));
  // Desktop: one bundle per suite; Mocha loads them after defining describe/it.
  builds.push({
    ...shared,
    entryPoints: ['test/suite/index.node.ts', ...suites.map((f) => `test/suite/${f}`)],
    external: ['vscode', 'mocha'],
    platform: 'node',
    format: 'cjs',
    outdir: 'dist/test/node',
  });
  // Web: one bundle that sets up Mocha first, then imports every suite.
  builds.push({
    ...shared,
    entryPoints: ['test/suite/index.web.ts'],
    external: ['vscode'],
    platform: 'browser',
    format: 'cjs',
    outfile: 'dist/test/web/index.js',
  });
}

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
