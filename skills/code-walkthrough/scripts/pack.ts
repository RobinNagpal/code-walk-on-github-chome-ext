// Packs a walkthrough into one zip, so it can be shared and opened in the VS Code extension.
//
//   node pack.ts <walkthrough-dir>
//
// Writes <walkthroughs-folder>/<id>.zip next to the walkthrough's folder. The zip holds one
// folder, <id>/, with walkthrough.json and the slides' MP3s. generate-audio.ts runs this
// at the end, so the zip always matches the latest audio.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';
import { readWalkthrough, WALKTHROUGH_FILE } from './walkthrough.ts';

/** Writes the zip and returns its path. Slides without audio are packed without it. */
export function packWalkthrough(dir: string): string {
  const folder = resolve(dir);
  const walkthrough = readWalkthrough(folder);
  const files: Zippable = { [WALKTHROUGH_FILE]: [readFileSync(join(folder, WALKTHROUGH_FILE)), { level: 6 }] };
  for (const slide of walkthrough.slides) {
    // MP3s are already compressed; storing them keeps packing fast.
    if (slide.audio) files[slide.audio] = [readFileSync(join(folder, slide.audio)), { level: 0 }];
  }
  const out = join(dirname(folder), `${basename(folder)}.zip`);
  writeFileSync(out, zipSync({ [basename(folder)]: files }));
  return out;
}

// Run directly (not imported by generate-audio.ts). See config.ts for why real paths are compared.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node pack.ts <walkthrough-dir>');
    process.exit(2);
  }
  console.log(`wrote ${packWalkthrough(dir)}`);
}
