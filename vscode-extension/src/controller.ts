// Runs a walkthrough: which slide is showing, whether it plays, and the player settings.
// The webview plays the audio and reports its clock; this side moves between slides and
// tells the navigator what to show.
import * as vscode from 'vscode';
import type { FromWebview, PlayerState, ToWebview } from './core/messages.ts';
import { afterSlideEnds, slideLocation, slideView } from './core/slides.ts';
import { slideDuration, SPEEDS, totalDuration, walkthroughType, WalkthroughType, type DiffView } from './core/walkthrough.ts';
import type { Library, LibraryEntry } from './library.ts';
import type { Navigator } from './navigator.ts';

const SPEED_KEY = 'speed';
const AUTOPLAY_KEY = 'autoplay';

export interface Progress {
  token: number;
  currentTime: number;
  duration: number;
}

export class Controller {
  private entry: LibraryEntry | undefined;
  private index = 0;
  private playing = false;
  private notice: string | undefined;
  /** Changes with every audio load, so the webview's events for an earlier slide are ignored. */
  private token = 0;
  /** The audio clock as the webview last reported it; tests read it. */
  progress: Progress = { token: 0, currentTime: 0, duration: 0 };
  private post: (message: ToWebview) => void = () => {};

  constructor(
    private readonly library: Library,
    private readonly navigator: Navigator,
    private readonly memento: vscode.Memento,
  ) {}

  get speed(): number {
    return this.memento.get<number>(SPEED_KEY, 1);
  }

  get autoplay(): boolean {
    return this.memento.get<boolean>(AUTOPLAY_KEY, true);
  }

  /** VS Code's own diff layout setting, so the player and the editor agree. */
  get diffView(): DiffView {
    return vscode.workspace.getConfiguration('diffEditor').get<boolean>('renderSideBySide', true) ? 'split' : 'unified';
  }

  get current(): { id: string; index: number; playing: boolean } | undefined {
    return this.entry && { id: this.entry.id, index: this.index, playing: this.playing };
  }

  /** Connects the player webview. When it (re)appears it gets the state and the current audio. */
  attach(post: (message: ToWebview) => void): void {
    this.post = post;
    this.sendState();
    // A walkthrough started before the view first opened plays as soon as it is ready.
    if (this.entry) void this.loadAudio(this.playing);
  }

  async start(entry: LibraryEntry): Promise<void> {
    this.entry = entry;
    await vscode.commands.executeCommand('codeWalkthroughs.player.focus');
    await this.goTo(0, true);
  }

  async goTo(index: number, play = true): Promise<void> {
    if (!this.entry) return;
    this.index = Math.max(0, Math.min(index, this.entry.walkthrough.slides.length - 1));
    this.playing = play;
    this.notice = undefined;
    this.sendState();
    await Promise.all([this.showSlide(), this.loadAudio(play)]);
  }

  next(): Promise<void> {
    return this.goTo(this.index + 1);
  }

  previous(): Promise<void> {
    return this.goTo(this.index - 1);
  }

  play(): void {
    if (!this.entry) return;
    this.playing = true;
    this.post({ type: 'play' });
    this.sendState();
  }

  pause(): void {
    this.playing = false;
    this.post({ type: 'pause' });
    this.sendState();
  }

  playPause(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  stop(): void {
    this.pause();
    this.entry = undefined;
    this.navigator.clear();
    this.sendState();
  }

  /** Shows the current slide's code again (after the viewer scrolled or opened other files). */
  async showSlide(): Promise<void> {
    if (!this.entry) return;
    const { walkthrough } = this.entry;
    try {
      await this.navigator.show(slideView(walkthrough, walkthrough.slides[this.index]), this.diffView === 'unified');
    } catch (error) {
      this.notice = `Could not open the file: ${(error as Error).message}`;
      this.sendState();
    }
  }

  async receive(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready':
        return this.attach(this.post);
      case 'control':
        if (message.action === 'play') return this.play();
        if (message.action === 'pause') return this.pause();
        if (message.action === 'next') return this.next();
        if (message.action === 'previous') return this.previous();
        if (message.action === 'stop') return this.stop();
        if (message.action === 'show') {
          this.navigator.revealAgain();
          return this.showSlide();
        }
        return;
      case 'goTo':
        return this.goTo(message.index);
      case 'settings':
        return this.updateSettings(message);
      case 'time':
        if (message.token === this.token) this.progress = { token: message.token, currentTime: message.currentTime, duration: message.duration };
        return;
      case 'ended':
        if (message.token === this.token) return this.slideEnded();
        return;
      case 'blocked':
      case 'audioError':
        if (message.token !== this.token) return;
        this.playing = false;
        this.notice = message.type === 'blocked' ? 'Press play to start the audio.' : `Could not play this slide's audio: ${message.message}`;
        this.sendState();
        return;
    }
  }

  /** What happens when a slide's audio ends: the next slide in autoplay, otherwise stop. */
  async slideEnded(): Promise<void> {
    if (!this.entry) return;
    const next = afterSlideEnds(this.index, this.entry.walkthrough.slides.length, this.autoplay);
    if (next.index !== this.index) return this.goTo(next.index, true);
    this.playing = false;
    this.sendState();
  }

  private async updateSettings(patch: { speed?: number; autoplay?: boolean; diffView?: DiffView }): Promise<void> {
    if (patch.speed !== undefined && (SPEEDS as readonly number[]).includes(patch.speed)) {
      await this.memento.update(SPEED_KEY, patch.speed);
      this.post({ type: 'speed', speed: patch.speed });
    }
    if (patch.autoplay !== undefined) await this.memento.update(AUTOPLAY_KEY, patch.autoplay);
    if (patch.diffView !== undefined && patch.diffView !== this.diffView) {
      await vscode.workspace
        .getConfiguration('diffEditor')
        .update('renderSideBySide', patch.diffView === 'split', vscode.ConfigurationTarget.Global);
      // The open diff changes layout by itself; re-show to scroll the new layout to the lines.
      await this.showSlide();
    }
    this.sendState();
  }

  private async loadAudio(play: boolean): Promise<void> {
    if (!this.entry) return;
    const token = ++this.token;
    this.progress = { token, currentTime: 0, duration: 0 };
    const slide = this.entry.walkthrough.slides[this.index];
    const audio = slide.audio ? await this.library.readFile(this.entry.id, slide.audio) : undefined;
    if (token !== this.token) return; // A later slide was chosen meanwhile.
    // Copied into an ArrayBuffer of its own: a file read can be a view into a larger buffer.
    this.post({ type: 'load', token, audio: audio?.slice().buffer, durationSec: slideDuration(slide), play, speed: this.speed });
  }

  sendState(): void {
    this.post({ type: 'state', state: this.state() });
  }

  state(): PlayerState {
    const base = { index: this.index, playing: this.playing, speed: this.speed, autoplay: this.autoplay, diffView: this.diffView, notice: this.notice };
    if (!this.entry) return base;
    const { walkthrough } = this.entry;
    const slide = walkthrough.slides[this.index];
    const isReview = walkthroughType(walkthrough) === WalkthroughType.PRReview;
    return {
      ...base,
      walkthrough: {
        title: walkthrough.title,
        label: isReview && walkthrough.pullRequest ? `PR #${walkthrough.pullRequest.number} review` : undefined,
        isReview,
        totalSec: totalDuration(walkthrough),
        slides: walkthrough.slides.map((s) => ({ title: s.title, durationSec: slideDuration(s) })),
      },
      slide: { title: slide.title, summary: slide.summary, location: slideLocation(walkthrough, slide), hasAudio: Boolean(slide.audio) },
    };
  }
}
