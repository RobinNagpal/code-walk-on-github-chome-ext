// Offscreen document: reads slide MP3s from the walkthroughs folder and plays them.
// It lives outside the GitHub tab, so narration continues while GitHub loads the next file.
import { browser } from 'wxt/browser';
import { folderAccess, getFolder, readFile } from '@/lib/folder';
import type { BackgroundMessage, OffscreenMessage, OffscreenReply } from '@/lib/messages';

const audio = new Audio();
let token = -1;
let objectUrl: string | undefined;
// Token of the newest load request; an older load that finishes reading later is dropped.
let requested = -1;
// What the user wants right now. A pause or speed change can arrive while a load is still reading the file.
let wantPlaying = false;
let speed = 1;

function notify(message: BackgroundMessage): void {
  browser.runtime.sendMessage(message).catch(() => {});
}

audio.addEventListener('timeupdate', () => {
  notify({ target: 'background', type: 'audioProgress', token, currentTime: audio.currentTime, duration: audio.duration || 0 });
});
audio.addEventListener('ended', () => notify({ target: 'background', type: 'audioEnded', token }));
audio.addEventListener('error', () => {
  if (audio.src) notify({ target: 'background', type: 'audioError', token, message: audio.error?.message || 'cannot decode audio' });
});

function applySpeed(): void {
  // Loading a new source resets playbackRate to defaultPlaybackRate, so set both.
  audio.defaultPlaybackRate = speed;
  audio.playbackRate = speed;
}

async function play(): Promise<void> {
  try {
    await audio.play();
  } catch (error) {
    // A pause that lands while play() is starting rejects it; that is the user's choice, not a failure.
    if ((error as Error).name !== 'AbortError') throw error;
  }
}

function stop(): void {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
}

async function handle(message: OffscreenMessage): Promise<OffscreenReply> {
  switch (message.type) {
    case 'load': {
      requested = message.token;
      wantPlaying = message.play;
      speed = message.speed;
      stop();
      const root = await getFolder();
      if ((await folderAccess(root)) !== 'granted') return { ok: false, error: 'no folder access' };
      const file = await readFile(root!, message.folder, message.audio);
      if (message.token !== requested) return { ok: true };
      objectUrl = URL.createObjectURL(file);
      token = message.token;
      audio.src = objectUrl;
      applySpeed();
      if (message.startAt) audio.currentTime = message.startAt;
      if (wantPlaying) await play();
      return { ok: true };
    }
    case 'play':
      wantPlaying = true;
      if (!audio.src) return { ok: false, error: 'no audio loaded' };
      await play();
      return { ok: true };
    case 'pause':
      wantPlaying = false;
      audio.pause();
      return { ok: true };
    case 'seek':
      if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(message.time, audio.duration));
      return { ok: true };
    case 'speed':
      speed = message.speed;
      applySpeed();
      return { ok: true };
    case 'stop':
      // Also cancels a load that is still reading its file.
      requested = -1;
      wantPlaying = false;
      stop();
      return { ok: true };
  }
}

browser.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return;
  handle(message).then(sendResponse, (error: Error) => sendResponse({ ok: false, error: error.message } satisfies OffscreenReply));
  return true;
});
