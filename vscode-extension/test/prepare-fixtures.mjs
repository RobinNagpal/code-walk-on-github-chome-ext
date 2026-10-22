// Copies the walkthrough zips the VS Code tests open into a folder the test VS Code opens.
// They come from CODE_WALKTHROUGHS_DIR, or the repository's git-ignored walkthroughs/.
// Make them with the skill: generate-audio.ts writes <id>.zip (--provider silent is enough).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ZIPS = ['robotics-basics-pr-6-frames-3d-and-motion.zip', 'clear-the-table-solution-1-one-fixed-nudge.zip'];

export function prepareFixtures() {
  const source = process.env.CODE_WALKTHROUGHS_DIR ?? resolve(import.meta.dirname, '../../walkthroughs');
  const folder = resolve(import.meta.dirname, '../.vscode-test/fixtures');
  mkdirSync(folder, { recursive: true });
  for (const zip of ZIPS) {
    const from = join(source, zip);
    if (!existsSync(from)) throw new Error(`Missing test walkthrough ${from}`);
    copyFileSync(from, join(folder, zip));
  }
  return folder;
}
