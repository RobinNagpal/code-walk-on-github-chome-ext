import { browser } from 'wxt/browser';
import type { Settings } from './messages';

const SETTINGS_KEY = 'settings';
const LAYOUT_KEY = 'playerLayout';

export const DEFAULT_SETTINGS: Settings = { speed: 1, autoplay: true, diffView: 'unified' };

export interface Position {
  x: number;
  y: number;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

/** How the player was left. GitHub reloads the page for every new file, so this is restored on each page. */
export interface Layout {
  position?: Position;
  minimized?: boolean;
  listOpen?: boolean;
}

export async function loadLayout(): Promise<Layout> {
  const stored = await browser.storage.local.get(LAYOUT_KEY);
  return (stored[LAYOUT_KEY] as Layout | undefined) ?? {};
}

export async function saveLayout(patch: Layout): Promise<void> {
  await browser.storage.local.set({ [LAYOUT_KEY]: { ...(await loadLayout()), ...patch } });
}
