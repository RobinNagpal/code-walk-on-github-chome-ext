// The controller. It owns the player state, drives the GitHub tab to each slide,
// and tells the offscreen document which MP3 to play. Slides without an MP3 are
// spoken with chrome.tts instead.
import { browser } from 'wxt/browser';
import { defineBackground } from '#imports';
import type {
  BackgroundMessage,
  OffscreenMessage,
  OffscreenReply,
  PageReadyReply,
  PlayerCommand,
  PlayerState,
  PlayerView,
  Progress,
  Settings,
  TabMessage,
} from '@/lib/messages';
import { loadSettings, saveSettings } from '@/lib/settings';
import { slideUrl, withoutHash, type Walkthrough } from '@/lib/walkthrough';

const STATE_KEY = 'player';
// The service worker is stopped when idle (for example during a long pause), so the
// audio token and position are kept in session storage too.
const RUNTIME_KEY = 'playerRuntime';
const PROGRESS_SAVE_MS = 5000;
// Chrome closes an AUDIO_PLAYBACK offscreen document after 30 s it considers silent (a long
// pause, or a machine without audio output). If audio should be playing but no progress has
// arrived for this long and the document is gone, the slide is reloaded where it stopped.
const STALL_MS = 4000;
const WATCHDOG_MS = 2000;
const WORDS_PER_SECOND = 165 / 60;

export default defineBackground(() => {
  let state: PlayerState | undefined;
  let settings: Settings | undefined;
  let progress: Progress = { currentTime: 0, duration: 0 };
  // Incremented on every audio load or stop; events from older loads are ignored.
  let token = 0;
  let speaking: 'none' | 'speaking' | 'paused' = 'none';
  let loaded: Promise<void> | undefined;
  let creatingOffscreen: Promise<void> | undefined;
  let progressSavedAt = 0;
  let lastProgressAt = 0;
  let watchdog: ReturnType<typeof setInterval> | undefined;

  function load(): Promise<void> {
    loaded ??= (async () => {
      const stored = await browser.storage.session.get([STATE_KEY, RUNTIME_KEY]);
      state = stored[STATE_KEY] as PlayerState | undefined;
      const runtime = stored[RUNTIME_KEY] as { token: number; currentTime: number } | undefined;
      token = runtime?.token ?? 0;
      settings = await loadSettings();
      const slide = state?.walkthrough.slides[state.slideIndex];
      progress = { currentTime: runtime?.currentTime ?? 0, duration: slide?.durationSec ?? 0 };
    })();
    return loaded;
  }

  async function persist(): Promise<void> {
    if (state) await browser.storage.session.set({ [STATE_KEY]: state });
    else await browser.storage.session.remove(STATE_KEY);
    saveRuntime();
  }

  function saveRuntime(): void {
    progressSavedAt = Date.now();
    browser.storage.session.set({ [RUNTIME_KEY]: { token, currentTime: progress.currentTime } }).catch(() => {});
  }

  function view(): PlayerView | undefined {
    return state && settings ? { state, settings, progress } : undefined;
  }

  function toTab(message: TabMessage): Promise<unknown> {
    return state ? browser.tabs.sendMessage(state.tabId, message) : Promise.resolve();
  }

  function broadcast(): void {
    const v = view();
    if (v) toTab({ type: 'view', view: v }).catch(() => {});
  }

  // ── Offscreen audio ────────────────────────────────────────────────────────

  function ensureOffscreen(): Promise<void> {
    creatingOffscreen ??= (async () => {
      if (await browser.offscreen.hasDocument()) return;
      await browser.offscreen.createDocument({
        url: browser.runtime.getURL('/offscreen.html'),
        reasons: [browser.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Plays the narration of a code walkthrough.',
      });
    })().finally(() => (creatingOffscreen = undefined));
    return creatingOffscreen;
  }

  async function toOffscreen(message: OffscreenMessage): Promise<OffscreenReply> {
    // A document still being created will exist in a moment; wait so a pause or stop isn't dropped.
    if (creatingOffscreen) await creatingOffscreen;
    if (message.type !== 'load' && !(await browser.offscreen.hasDocument())) {
      return { ok: false, error: 'no audio loaded' };
    }
    await ensureOffscreen();
    return browser.runtime.sendMessage(message) as Promise<OffscreenReply>;
  }

  /** Invalidates events from whatever was playing and silences the spoken fallback. */
  function interrupt(): number {
    token++;
    if (speaking !== 'none') browser.tts.stop();
    speaking = 'none';
    saveRuntime();
    return token;
  }

  async function stopAudio(): Promise<void> {
    interrupt();
    await toOffscreen({ target: 'offscreen', type: 'stop' }).catch(() => {});
  }

  function watchForStalls(): void {
    watchdog ??= setInterval(async () => {
      if (!state) {
        clearInterval(watchdog);
        watchdog = undefined;
        return;
      }
      const slide = state.walkthrough.slides[state.slideIndex];
      if (!state.playing || !slide.audio || speaking !== 'none' || Date.now() - lastProgressAt < STALL_MS) return;
      if (creatingOffscreen || (await browser.offscreen.hasDocument())) return;
      await loadAudio(true, progress.currentTime);
    }, WATCHDOG_MS);
  }

  /** Starts the current slide's narration from `startAt` seconds (MP3) or from the top (spoken fallback). */
  async function loadAudio(play: boolean, startAt = 0): Promise<void> {
    if (!state || !settings) return;
    const slide = state.walkthrough.slides[state.slideIndex];
    // Take the token before any await, so a newer slide change always wins.
    const myToken = interrupt();
    lastProgressAt = Date.now();
    watchForStalls();
    if (slide.audio) {
      // A load replaces whatever the offscreen document was playing.
      const reply = await toOffscreen({
        target: 'offscreen',
        type: 'load',
        token: myToken,
        folder: state.folder,
        audio: slide.audio,
        play,
        speed: settings.speed,
        startAt,
      }).catch((error: Error): OffscreenReply => ({ ok: false, error: error.message }));
      if (reply.ok || myToken !== token || !state) return;
      state.needsAccess = reply.error.includes('access');
      state.notice = state.needsAccess
        ? 'Chrome needs permission to read the walkthroughs folder again. Using the browser voice until then.'
        : `Couldn't play ${slide.audio} (${reply.error}). Using the browser voice.`;
      await persist();
      broadcast();
    } else {
      await toOffscreen({ target: 'offscreen', type: 'stop' }).catch(() => {});
    }
    if (play && myToken === token && state?.playing) speak(slide.narration, myToken);
  }

  function speak(text: string, myToken: number): void {
    if (!settings) return;
    const estimate = text.split(/\s+/).length / WORDS_PER_SECOND / settings.speed;
    progress = { currentTime: 0, duration: estimate };
    speaking = 'speaking';
    browser.tts.speak(text, {
      rate: settings.speed,
      onEvent: (event) => {
        if (myToken !== token) return;
        if (event.type === 'word' && event.charIndex !== undefined) {
          onProgress({ currentTime: (event.charIndex / text.length) * estimate, duration: estimate });
        } else if (event.type === 'end') {
          speaking = 'none';
          onEnded();
        } else if (event.type === 'error') {
          speaking = 'none';
          if (state) state.playing = false;
          broadcast();
        }
      },
    });
  }

  function onProgress(next: Progress): void {
    progress = next;
    lastProgressAt = Date.now();
    toTab({ type: 'progress', progress }).catch(() => {});
    if (Date.now() - progressSavedAt > PROGRESS_SAVE_MS) saveRuntime();
  }

  async function onEnded(): Promise<void> {
    if (!state || !settings) return;
    const last = state.slideIndex >= state.walkthrough.slides.length - 1;
    if (settings.autoplay && !last) {
      await goTo(state.slideIndex + 1, true);
      return;
    }
    state.playing = false;
    progress = { ...progress, currentTime: progress.duration };
    await persist();
    broadcast();
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async function showSlide(): Promise<void> {
    if (!state) return;
    const slide = state.walkthrough.slides[state.slideIndex];
    const url = slideUrl(state.walkthrough, slide);
    if (!url) {
      // An introduction or wrap-up: stay on the page, drop the previous slide's highlight.
      toTab({ type: 'clear' }).catch(() => {});
      return;
    }
    const tab = await browser.tabs.get(state.tabId).catch(() => undefined);
    if (!tab) {
      const created = await browser.tabs.create({ url });
      state.tabId = created.id!;
      await persist();
    } else if (withoutHash(tab.pendingUrl || tab.url || '') === withoutHash(url)) {
      // Already there, or already loading it (a tab just opened by start()). A page
      // without the content script (opened before the extension loaded) gets reloaded.
      if (!tab.pendingUrl) await toTab({ type: 'focus', lines: slide.lines }).catch(() => browser.tabs.update(tab.id!, { url }));
    } else {
      await browser.tabs.update(state.tabId, { url });
    }
  }

  async function goTo(index: number, play: boolean): Promise<void> {
    if (!state) return;
    state.slideIndex = Math.max(0, Math.min(index, state.walkthrough.slides.length - 1));
    state.playing = play;
    state.notice = undefined;
    state.needsAccess = undefined;
    progress = { currentTime: 0, duration: state.walkthrough.slides[state.slideIndex].durationSec ?? 0 };
    await persist();
    broadcast();
    await Promise.all([showSlide(), loadAudio(play)]);
  }

  async function start(folder: string, walkthrough: Walkthrough): Promise<void> {
    await stopAudio();
    const { owner, name, commit } = walkthrough.repo;
    const first = slideUrl(walkthrough, walkthrough.slides[0]) ?? `https://github.com/${owner}/${name}/tree/${commit}`;
    const [active] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    let tabId: number;
    if (active?.id !== undefined && active.url?.startsWith('https://github.com/')) {
      // Load the first page even if the tab is on it already, so the player always gets a fresh content script.
      tabId = active.id;
      await browser.tabs.update(tabId, { url: first });
    } else {
      tabId = (await browser.tabs.create({ url: first })).id!;
    }
    if (state && state.tabId !== tabId) await toTab({ type: 'closed' }).catch(() => {});
    state = { folder, walkthrough, slideIndex: 0, playing: true, tabId };
    await goTo(0, true);
  }

  async function command(name: PlayerCommand): Promise<void> {
    if (!state) return;
    switch (name) {
      case 'play': {
        state.playing = true;
        const atEnd = progress.duration > 0 && progress.currentTime >= progress.duration - 0.25;
        if (speaking === 'paused') {
          browser.tts.resume();
          speaking = 'speaking';
        } else if (atEnd || speaking === 'none') {
          const resumed = !atEnd && (await toOffscreen({ target: 'offscreen', type: 'play' }).catch(() => ({ ok: false }))).ok;
          if (!resumed && state?.playing) await loadAudio(true, atEnd ? 0 : progress.currentTime);
        }
        break;
      }
      case 'pause':
        state.playing = false;
        if (speaking === 'speaking') {
          browser.tts.pause();
          speaking = 'paused';
        } else {
          await toOffscreen({ target: 'offscreen', type: 'pause' }).catch(() => {});
        }
        break;
      case 'next':
      case 'prev': {
        // Like a click in the slide list, moving on always plays.
        const index = state.slideIndex + (name === 'next' ? 1 : -1);
        if (index >= 0 && index < state.walkthrough.slides.length) await goTo(index, true);
        return;
      }
      case 'close':
        await stopAudio();
        await toTab({ type: 'closed' }).catch(() => {});
        state = undefined;
        await persist();
        return;
    }
    await persist();
    broadcast();
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    settings = { ...settings!, ...patch };
    await saveSettings(settings);
    if (patch.speed !== undefined) await toOffscreen({ target: 'offscreen', type: 'speed', speed: patch.speed }).catch(() => {});
    broadcast();
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  async function handle(message: BackgroundMessage, tabId: number | undefined): Promise<unknown> {
    await load();
    switch (message.type) {
      case 'start':
        await start(message.folder, message.walkthrough);
        return { ok: true };
      case 'pageReady': {
        if (!state || tabId !== state.tabId) return {} satisfies PageReadyReply;
        const slide = state.walkthrough.slides[state.slideIndex];
        const url = slideUrl(state.walkthrough, slide);
        const tab = await browser.tabs.get(tabId);
        const onSlide = url !== undefined && tab.url !== undefined && withoutHash(tab.url) === withoutHash(url);
        return { view: view(), onSlide, focus: onSlide ? slide.lines : undefined } satisfies PageReadyReply;
      }
      case 'command':
        await command(message.command);
        return { ok: true };
      case 'goTo':
        if (state) await goTo(message.index, true);
        return { ok: true };
      case 'showSlide':
        await showSlide();
        return { ok: true };
      case 'seek':
        if (speaking === 'none') {
          await toOffscreen({ target: 'offscreen', type: 'seek', time: message.time }).catch(() => {});
          progress = { ...progress, currentTime: message.time };
          saveRuntime();
        }
        return { ok: true };
      case 'settings':
        await updateSettings(message.settings);
        return { ok: true };
      case 'openOptions':
        await browser.runtime.openOptionsPage();
        return { ok: true };
      case 'audioProgress':
        if (message.token === token) onProgress({ currentTime: message.currentTime, duration: message.duration });
        return;
      case 'audioEnded':
        if (message.token === token) await onEnded();
        return;
      case 'audioError':
        if (message.token === token && state) {
          state.notice = `Audio error: ${message.message}`;
          state.playing = false;
          await persist();
          broadcast();
        }
        return;
    }
  }

  browser.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
    if (message?.target !== 'background') return;
    handle(message, sender.tab?.id).then(sendResponse, (error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  browser.tabs.onRemoved.addListener(async (tabId) => {
    await load();
    if (state?.tabId !== tabId) return;
    await stopAudio();
    state = undefined;
    await persist();
  });
});
