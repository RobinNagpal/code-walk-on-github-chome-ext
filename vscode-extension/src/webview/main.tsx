// The Player view's page: the controls, and the audio element that plays each slide.
import './player.css';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FromWebview, PlayerState, ToWebview } from '../core/messages.ts';
import { formatTime, SPEEDS } from '../core/walkthrough.ts';
import { Icon } from './icons.tsx';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };
const vscode = acquireVsCodeApi();
const send = (message: FromWebview) => vscode.postMessage(message);

interface Clock {
  currentTime: number;
  duration: number;
}

/**
 * Plays one slide at a time. A slide without audio runs a silent clock for its reading
 * time, so autoplay still moves on.
 */
class SlideAudio {
  readonly element = new Audio();
  private token = 0;
  private url: string | undefined;
  private silent: { duration: number; time: number; timer?: number } | undefined;
  private speed = 1;
  onClock: (clock: Clock) => void = () => {};

  constructor() {
    this.element.addEventListener('timeupdate', () => this.report());
    this.element.addEventListener('loadedmetadata', () => this.report());
    this.element.addEventListener('ended', () => send({ type: 'ended', token: this.token }));
    this.element.addEventListener('error', () => {
      if (this.url) send({ type: 'audioError', token: this.token, message: this.element.error?.message || `media error ${this.element.error?.code}` });
    });
  }

  load(message: Extract<ToWebview, { type: 'load' }>): void {
    this.stopSilent();
    this.element.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined;
    this.token = message.token;
    this.speed = message.speed;
    if (message.audio) {
      this.url = URL.createObjectURL(new Blob([message.audio], { type: 'audio/mpeg' }));
      this.element.src = this.url;
      this.element.playbackRate = message.speed;
      this.silent = undefined;
    } else {
      this.element.removeAttribute('src');
      this.silent = { duration: message.durationSec, time: 0 };
    }
    this.report();
    if (message.play) this.play();
  }

  play(): void {
    if (this.silent) {
      this.stopSilent();
      const tick = 0.25;
      this.silent.timer = window.setInterval(() => {
        const silent = this.silent!;
        silent.time = Math.min(silent.duration, silent.time + tick * this.speed);
        this.report();
        if (silent.time >= silent.duration) {
          this.stopSilent();
          send({ type: 'ended', token: this.token });
        }
      }, tick * 1000);
      return;
    }
    const token = this.token;
    this.element.playbackRate = this.speed;
    this.element.play().catch((error: Error) => {
      if (error.name === 'NotAllowedError') send({ type: 'blocked', token });
      else if (error.name !== 'AbortError') send({ type: 'audioError', token, message: error.message });
    });
  }

  pause(): void {
    this.stopSilent();
    this.element.pause();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.element.playbackRate = speed;
  }

  seek(ratio: number): void {
    if (this.silent) this.silent.time = ratio * this.silent.duration;
    else if (this.element.duration) this.element.currentTime = ratio * this.element.duration;
    this.report();
  }

  private stopSilent(): void {
    if (this.silent?.timer) window.clearInterval(this.silent.timer);
    if (this.silent) this.silent.timer = undefined;
  }

  private report(): void {
    const clock = this.silent
      ? { currentTime: this.silent.time, duration: this.silent.duration }
      : { currentTime: this.element.currentTime || 0, duration: Number.isFinite(this.element.duration) ? this.element.duration : 0 };
    this.onClock(clock);
    send({ type: 'time', token: this.token, ...clock });
  }
}

const audio = new SlideAudio();

function App() {
  const [state, setState] = useState<PlayerState | undefined>();
  const [clock, setClock] = useState<Clock>({ currentTime: 0, duration: 0 });
  const [listOpen, setListOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    audio.onClock = setClock;
    const onMessage = (event: MessageEvent<ToWebview>) => {
      const message = event.data;
      if (message.type === 'state') setState(message.state);
      else if (message.type === 'load') audio.load(message);
      else if (message.type === 'play') audio.play();
      else if (message.type === 'pause') audio.pause();
      else if (message.type === 'speed') audio.setSpeed(message.speed);
    };
    window.addEventListener('message', onMessage);
    send({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (listOpen) listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [listOpen, state?.index]);

  const walkthrough = state?.walkthrough;
  if (!state || !walkthrough || !state.slide) {
    return (
      <div class="empty">
        <p>Start a walkthrough from the list above.</p>
        <p class="muted">Open a walkthrough zip with the zip button in the Walkthroughs view.</p>
      </div>
    );
  }
  const { slide, index, playing } = state;
  const count = walkthrough.slides.length;
  const percent = clock.duration ? Math.min(100, (clock.currentTime / clock.duration) * 100) : 0;
  const control = (action: Extract<FromWebview, { type: 'control' }>['action']) => send({ type: 'control', action });
  const settings = (patch: Omit<Extract<FromWebview, { type: 'settings' }>, 'type'>) => send({ type: 'settings', ...patch });

  function seek(event: MouseEvent): void {
    const { left, width } = (event.currentTarget as HTMLElement).getBoundingClientRect();
    audio.seek(Math.min(1, Math.max(0, (event.clientX - left) / width)));
  }

  return (
    <div class="player">
      <header>
        <div class="walkthrough-title" title={walkthrough.title}>
          {walkthrough.title}
        </div>
        <div class="meta">
          {walkthrough.label ? `${walkthrough.label} · ` : ''}
          Slide {index + 1} of {count} · {formatTime(walkthrough.totalSec)} total
        </div>
      </header>

      <section class="slide">
        <h2>{slide.title}</h2>
        <p>{slide.summary}</p>
        {slide.location && (
          <button class="location" title="Show these lines again" onClick={() => control('show')}>
            {slide.location}
          </button>
        )}
      </section>

      <div class="progress" onClick={seek} title="Seek">
        <div class="bar" style={{ width: `${percent}%` }} />
      </div>
      <div class="times">
        <span>{formatTime(clock.currentTime)}</span>
        <span>{formatTime(clock.duration)}</span>
      </div>

      <div class="controls">
        <button title="Previous slide" disabled={index === 0} onClick={() => control('previous')}>
          <Icon name="prev" />
        </button>
        <button class="primary" title={playing ? 'Pause' : 'Play'} onClick={() => control(playing ? 'pause' : 'play')}>
          <Icon name={playing ? 'pause' : 'play'} size={22} />
        </button>
        <button title="Next slide" disabled={index === count - 1} onClick={() => control('next')}>
          <Icon name="next" />
        </button>
        <select title="Playback speed" value={String(state.speed)} onChange={(e) => settings({ speed: Number(e.currentTarget.value) })}>
          {SPEEDS.map((speed) => (
            <option value={String(speed)}>{speed}×</option>
          ))}
        </select>
        <div class="mode" role="group" aria-label="Play mode">
          <button class={state.autoplay ? 'on' : ''} title="Autoplay: go on to the next slide when this one ends" onClick={() => settings({ autoplay: true })}>
            Auto
          </button>
          <button class={state.autoplay ? '' : 'on'} title="Manual: stop at the end of each slide" onClick={() => settings({ autoplay: false })}>
            Manual
          </button>
        </div>
      </div>

      {walkthrough.isReview && (
        <div class="review-options">
          <span>Diff view</span>
          <div class="mode" role="group" aria-label="Diff view">
            {(['unified', 'split'] as const).map((diffView) => (
              <button
                class={state.diffView === diffView ? 'on' : ''}
                title={diffView === 'unified' ? 'Show changes in one column' : 'Show old and new code side by side'}
                onClick={() => settings({ diffView })}
              >
                {diffView === 'unified' ? 'Unified' : 'Split'}
              </button>
            ))}
          </div>
        </div>
      )}

      {!slide.hasAudio && <div class="notice">This slide has no audio; it moves on after its reading time.</div>}
      {state.notice && <div class="notice">{state.notice}</div>}

      <button class={`list-toggle ${listOpen ? 'open' : ''}`} onClick={() => setListOpen(!listOpen)}>
        <Icon name="chevron" size={16} /> All slides
      </button>
      {listOpen && (
        <ol class="slides" ref={listRef}>
          {walkthrough.slides.map((s, i) => (
            <li>
              <button aria-current={i === index ? 'true' : undefined} onClick={() => send({ type: 'goTo', index: i })}>
                <span class="number">{i + 1}</span>
                <span class="title">{s.title}</span>
                <span class="duration">{formatTime(s.durationSec)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <button class="stop" onClick={() => control('stop')}>
        <Icon name="close" size={14} /> End walkthrough
      </button>
    </div>
  );
}

render(<App />, document.getElementById('root')!);
