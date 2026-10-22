// Access to the walkthroughs folder. The directory handle lives in the extension
// origin's IndexedDB, so every extension page (options, popup, offscreen) can use it.
import { get, set } from 'idb-keyval';
import { invalidReason, WALKTHROUGH_FILE, type Walkthrough } from './walkthrough';

const HANDLE_KEY = 'walkthroughs-folder';

export type Access = 'none' | 'granted' | 'prompt' | 'denied';

export interface LibraryEntry {
  folder: string;
  walkthrough: Walkthrough;
}

export interface Library {
  entries: LibraryEntry[];
  problems: { folder: string; reason: string }[];
}

export function getFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  return get<FileSystemDirectoryHandle>(HANDLE_KEY);
}

/** Opens the folder picker. Needs a user gesture in a full tab (the options page). */
export async function chooseFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: 'code-walkthroughs', mode: 'read' });
  await set(HANDLE_KEY, handle);
  return handle;
}

/** Current permission; with `request`, asks for it (needs a user gesture). */
export async function folderAccess(handle: FileSystemDirectoryHandle | undefined, request = false): Promise<Access> {
  if (!handle) return 'none';
  const state = request
    ? await handle.requestPermission({ mode: 'read' })
    : await handle.queryPermission({ mode: 'read' });
  return state;
}

export async function readLibrary(root: FileSystemDirectoryHandle): Promise<Library> {
  const library: Library = { entries: [], problems: [] };
  for await (const entry of root.values()) {
    if (entry.kind !== 'directory') continue;
    let text: string;
    try {
      text = await (await (await entry.getFileHandle(WALKTHROUGH_FILE)).getFile()).text();
    } catch {
      continue; // Not a walkthrough folder.
    }
    try {
      const walkthrough = JSON.parse(text) as Walkthrough;
      const reason = invalidReason(walkthrough);
      if (reason) library.problems.push({ folder: entry.name, reason });
      else library.entries.push({ folder: entry.name, walkthrough });
    } catch (error) {
      library.problems.push({ folder: entry.name, reason: `invalid JSON: ${(error as Error).message}` });
    }
  }
  library.entries.sort((a, b) => a.walkthrough.title.localeCompare(b.walkthrough.title));
  return library;
}

export async function readFile(root: FileSystemDirectoryHandle, folder: string, name: string): Promise<File> {
  const dir = await root.getDirectoryHandle(folder);
  return (await dir.getFileHandle(name)).getFile();
}
