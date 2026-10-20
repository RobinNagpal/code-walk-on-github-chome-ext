// Loads API keys from .env files that belong to the skill, never from the
// repository being walked through. Variables already set in the environment win.
//
// Looked up, first match per variable wins:
//   <skill-dir>/.env
//   <repo>/.env                              when the skill is linked from this repository
//   ~/.config/code-walkthroughs/.env
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const skillDir = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '..');

export const ENV_FILES = [
  join(skillDir, '.env'),
  join(skillDir, '..', '..', '.env'),
  join(homedir(), '.config', 'code-walkthroughs', '.env'),
];

export function loadEnv(): void {
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    for (const [name, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
      if (value && !process.env[name]) process.env[name] = value;
    }
  }
}
