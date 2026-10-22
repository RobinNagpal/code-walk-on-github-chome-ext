// Messages between the extension and the player webview.
import type { DiffView } from './walkthrough.ts';

/** Everything the player shows except the audio clock, which the webview keeps itself. */
export interface PlayerState {
  walkthrough?: {
    title: string;
    /** "PR #12 review" for PR reviews. */
    label?: string;
    isReview: boolean;
    totalSec: number;
    slides: { title: string; durationSec: number }[];
  };
  index: number;
  slide?: { title: string; summary: string; location?: string; hasAudio: boolean };
  playing: boolean;
  speed: number;
  autoplay: boolean;
  diffView: DiffView;
  notice?: string;
}

export type ToWebview =
  | { type: 'state'; state: PlayerState }
  /**
   * Load a slide's audio. `token` changes with every load, so events from an earlier
   * slide are ignored. Without `audio` the slide plays silently for `durationSec`. The MP3
   * is an ArrayBuffer: VS Code passes those to a webview intact, but not typed arrays.
   */
  | { type: 'load'; token: number; audio?: ArrayBuffer; durationSec: number; play: boolean; speed: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; speed: number };

export type FromWebview =
  | { type: 'ready' }
  | { type: 'control'; action: 'play' | 'pause' | 'next' | 'previous' | 'show' | 'stop' }
  | { type: 'goTo'; index: number }
  | { type: 'settings'; speed?: number; autoplay?: boolean; diffView?: DiffView }
  | { type: 'time'; token: number; currentTime: number; duration: number }
  | { type: 'ended'; token: number }
  /** The browser refused to start audio without a click in the player. */
  | { type: 'blocked'; token: number }
  /** The audio could not be loaded or decoded. */
  | { type: 'audioError'; token: number; message: string };
