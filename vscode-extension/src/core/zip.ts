// Reads a walkthrough zip as the skill writes it: one folder holding walkthrough.json and
// the slides' MP3s. A zip with the files at its top level is accepted too.
import { unzipSync } from 'fflate';
import { invalidReason, WALKTHROUGH_FILE, type Walkthrough } from './walkthrough.ts';

export interface UnpackedWalkthrough {
  walkthrough: Walkthrough;
  /** The walkthrough's files by name, walkthrough.json included. */
  files: Map<string, Uint8Array>;
  /** Slides whose audio file is not in the zip; they play silently for their reading time. */
  missingAudio: string[];
}

/** Ids become folder names in the extension's storage, so they are kept to a safe alphabet. */
export const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/i;
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Throws an Error with a message fit to show the user when the zip is not a walkthrough. */
export function unpackWalkthrough(zip: Uint8Array): UnpackedWalkthrough {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, { filter: (file) => !file.name.endsWith('/') });
  } catch {
    throw new Error('The file is not a valid zip.');
  }
  const manifests = Object.keys(entries).filter((path) => path === WALKTHROUGH_FILE || path.endsWith(`/${WALKTHROUGH_FILE}`));
  if (manifests.length === 0) throw new Error(`The zip has no ${WALKTHROUGH_FILE}.`);
  if (manifests.length > 1) throw new Error(`The zip has ${manifests.length} walkthroughs; open one walkthrough per zip.`);

  const prefix = manifests[0].slice(0, -WALKTHROUGH_FILE.length);
  let walkthrough: Walkthrough;
  try {
    walkthrough = JSON.parse(new TextDecoder().decode(entries[manifests[0]]));
  } catch {
    throw new Error(`${WALKTHROUGH_FILE} is not valid JSON.`);
  }
  const reason = invalidReason(walkthrough);
  if (reason) throw new Error(`${WALKTHROUGH_FILE} is not a walkthrough: ${reason}.`);
  if (!SAFE_ID.test(walkthrough.id)) throw new Error(`The walkthrough id "${walkthrough.id}" has characters that can't be used in a folder name.`);

  // Only the walkthrough's own folder, and only plain file names: nothing can be written elsewhere.
  const files = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (SAFE_FILE.test(name)) files.set(name, data);
  }
  const missingAudio = walkthrough.slides.filter((s) => s.audio && !files.has(s.audio)).map((s) => s.audio!);
  return { walkthrough, files, missingAudio };
}
