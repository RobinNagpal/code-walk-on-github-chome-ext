// Where the tests find real walkthroughs: CODE_WALKTHROUGHS_DIR, or the repository's
// git-ignored walkthroughs/ folder. Tests that need them are skipped when they are missing.
import { resolve } from 'node:path';

export const WALKTHROUGHS_DIR = process.env.CODE_WALKTHROUGHS_DIR ?? resolve(import.meta.dirname, '../../../walkthroughs');
