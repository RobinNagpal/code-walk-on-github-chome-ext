// Messages between the extension's parts. Runtime messages carry a `target` because
// every extension page (popup, options, offscreen) hears every runtime message.
import { browser } from 'wxt/browser';
import type { LineRange, Walkthrough } from './walkthrough';

export interface Settings {
  speed: number;
  autoplay: boolean;
}

export interface PlayerState {
  /** Name of the walkthrough's folder inside the walkthroughs folder. */
  folder: string;
  walkthrough: Walkthrough;
  slideIndex: number;
  playing: boolean;
  tabId: number;
  /** Shown in the player, e.g. when an MP3 could not be read. */
  notice?: string;
  /** The notice is about folder permission; the player offers to open the settings page. */
  needsAccess?: boolean;
}

export interface Progress {
  currentTime: number;
  duration: number;
}

/** What the player in the GitHub tab renders. */
export interface PlayerView {
  state: PlayerState;
  settings: Settings;
  progress: Progress;
}

export type PlayerCommand = 'play' | 'pause' | 'next' | 'prev' | 'close';

/** Popup, options and content script → background. */
export type BackgroundMessage =
  | { target: 'background'; type: 'start'; folder: string; walkthrough: Walkthrough }
  | { target: 'background'; type: 'pageReady' }
  | { target: 'background'; type: 'command'; command: PlayerCommand }
  | { target: 'background'; type: 'goTo'; index: number }
  | { target: 'background'; type: 'showSlide' }
  | { target: 'background'; type: 'seek'; time: number }
  | { target: 'background'; type: 'settings'; settings: Partial<Settings> }
  | { target: 'background'; type: 'openOptions' }
  // Offscreen document → background. `token` ties an event to the load that caused it.
  | { target: 'background'; type: 'audioProgress'; token: number; currentTime: number; duration: number }
  | { target: 'background'; type: 'audioEnded'; token: number }
  | { target: 'background'; type: 'audioError'; token: number; message: string };

/** Background → offscreen document. */
export type OffscreenMessage =
  | { target: 'offscreen'; type: 'load'; token: number; folder: string; audio: string; play: boolean; speed: number; startAt?: number }
  | { target: 'offscreen'; type: 'play' }
  | { target: 'offscreen'; type: 'pause' }
  | { target: 'offscreen'; type: 'seek'; time: number }
  | { target: 'offscreen'; type: 'speed'; speed: number }
  | { target: 'offscreen'; type: 'stop' };

export type OffscreenReply = { ok: true } | { ok: false; error: string };

/** Background → content script in the walkthrough tab. */
export type TabMessage =
  | { type: 'view'; view: PlayerView }
  | { type: 'progress'; progress: Progress }
  | { type: 'focus'; lines?: LineRange }
  | { type: 'clear' }
  | { type: 'closed' };

/** Reply to `pageReady`: the view to render if this tab runs the walkthrough, and lines to show if it is on the slide's file. */
export interface PageReadyReply {
  view?: PlayerView;
  /** True when the page shows the current slide's file. */
  onSlide?: boolean;
  focus?: LineRange;
}

export function sendToBackground<T = unknown>(message: BackgroundMessage): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}
