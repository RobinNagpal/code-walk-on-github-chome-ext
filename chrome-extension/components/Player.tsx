// The floating player shown on GitHub while a walkthrough runs. Drag it by its header.
import { useEffect, useRef, useState } from 'preact/hooks';
import { sendToBackground, type PlayerCommand, type PlayerView, type Progress } from '@/lib/messages';
import { loadLayout, saveLayout, type Layout, type Position } from '@/lib/settings';
import { formatTime, SPEEDS, totalDuration, walkthroughType, WalkthroughType } from '@/lib/walkthrough';
import { Icon } from './icons';

const WIDTH = 360;
const MARGIN = 12;

function clamp(position: Position, element: HTMLElement | null): Position {
  const width = element?.offsetWidth ?? WIDTH;
  const height = element?.offsetHeight ?? 200;
  return {
    x: Math.min(Math.max(MARGIN, position.x), Math.max(MARGIN, window.innerWidth - width - MARGIN)),
    y: Math.min(Math.max(MARGIN, position.y), Math.max(MARGIN, window.innerHeight - height - MARGIN)),
  };
}

function command(name: PlayerCommand): void {
  sendToBackground({ target: 'background', type: 'command', command: name });
}

export function Player({ view, progress }: { view: PlayerView; progress: Progress }) {
  const { state, settings } = view;
  const { walkthrough, slideIndex, playing } = state;
  const slide = walkthrough.slides[slideIndex];
  const count = walkthrough.slides.length;

  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position>({ x: window.innerWidth - WIDTH - 16, y: 72 });
  const [minimized, setMinimizedState] = useState(false);
  const [listOpen, setListOpenState] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const remember = (patch: Layout) => saveLayout(patch).catch(() => {});
  const setMinimized = (value: boolean) => (setMinimizedState(value), remember({ minimized: value }));
  const setListOpen = (value: boolean) => (setListOpenState(value), remember({ listOpen: value }));

  useEffect(() => {
    loadLayout().then((saved) => {
      setMinimizedState(saved.minimized ?? false);
      setListOpenState(saved.listOpen ?? false);
      if (saved.position) setPosition(clamp(saved.position, root.current));
    });
    const onResize = () => setPosition((p) => clamp(p, root.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Growing (expanding, opening the list) can push the card off screen.
  useEffect(() => setPosition((p) => clamp(p, root.current)), [minimized, listOpen]);

  useEffect(() => {
    if (listOpen) listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [listOpen, slideIndex]);

  function startDrag(event: PointerEvent): void {
    if ((event.target as HTMLElement).closest('button, select, input')) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const offset = { x: event.clientX - position.x, y: event.clientY - position.y };
    let latest = position;
    const move = (e: PointerEvent) => {
      latest = clamp({ x: e.clientX - offset.x, y: e.clientY - offset.y }, root.current);
      setPosition(latest);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      remember({ position: latest });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function seek(event: MouseEvent): void {
    if (!progress.duration) return;
    const bar = event.currentTarget as HTMLElement;
    const { left, width } = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - left) / width));
    sendToBackground({ target: 'background', type: 'seek', time: ratio * progress.duration });
  }

  const goTo = (index: number) => sendToBackground({ target: 'background', type: 'goTo', index });
  const playPause = (
    <button class="primary" title={playing ? 'Pause' : 'Play'} onClick={() => command(playing ? 'pause' : 'play')}>
      <Icon name={playing ? 'pause' : 'play'} size={22} />
    </button>
  );
  const percent = progress.duration ? Math.min(100, (progress.currentTime / progress.duration) * 100) : 0;
  // The file name and lines matter most; the full path is in the tooltip.
  const isReview = walkthroughType(walkthrough) === WalkthroughType.PRReview;
  const lineLabel = isReview ? (slide.side === 'old' ? 'removed lines' : 'new lines') : 'lines';
  const location = slide.file && `${slide.file.split('/').pop()}${slide.lines ? ` · ${lineLabel} ${slide.lines.start}–${slide.lines.end}` : ''}`;

  if (minimized) {
    return (
      <div ref={root} class="player mini" style={{ left: `${position.x}px`, top: `${position.y}px` }} onPointerDown={startDrag}>
        {playPause}
        <span class="mini-label" title={slide.title}>
          {slideIndex + 1}/{count} · {slide.title}
        </span>
        <button title="Expand" onClick={() => setMinimized(false)}>
          <Icon name="expand" />
        </button>
      </div>
    );
  }

  return (
    <div ref={root} class="player" style={{ left: `${position.x}px`, top: `${position.y}px` }} role="dialog" aria-label="Code walkthrough">
      <header onPointerDown={startDrag}>
        <span class="grip">
          <Icon name="grip" size={14} />
        </span>
        <div class="heading">
          <div class="walkthrough-title" title={walkthrough.title}>
            {walkthrough.title}
          </div>
          <div class="meta">
            {isReview && walkthrough.pullRequest ? `PR #${walkthrough.pullRequest.number} review · ` : ''}
            Slide {slideIndex + 1} of {count} · {formatTime(totalDuration(walkthrough))} total
          </div>
        </div>
        <button title="Minimize" onClick={() => setMinimized(true)}>
          <Icon name="minimize" />
        </button>
        <button title="Close walkthrough" onClick={() => command('close')}>
          <Icon name="close" />
        </button>
      </header>

      <section class="slide">
        <h2>{slide.title}</h2>
        <p>{slide.summary}</p>
        {location && (
          <button
            class="location"
            title={`${slide.file} — click to show these lines again`}
            onClick={() => sendToBackground({ target: 'background', type: 'showSlide' })}
          >
            {location}
          </button>
        )}
      </section>

      <div class="progress" onClick={seek} title="Seek">
        <div class="bar" style={{ width: `${percent}%` }} />
      </div>
      <div class="times">
        <span>{formatTime(progress.currentTime)}</span>
        <span>{formatTime(progress.duration)}</span>
      </div>

      <div class="controls">
        <button title="Previous slide" disabled={slideIndex === 0} onClick={() => command('prev')}>
          <Icon name="prev" />
        </button>
        {playPause}
        <button title="Next slide" disabled={slideIndex === count - 1} onClick={() => command('next')}>
          <Icon name="next" />
        </button>
        <select
          title="Playback speed"
          value={String(settings.speed)}
          onChange={(e) => sendToBackground({ target: 'background', type: 'settings', settings: { speed: Number(e.currentTarget.value) } })}
        >
          {SPEEDS.map((speed) => (
            <option value={String(speed)}>{speed}×</option>
          ))}
        </select>
        <div class="mode" role="group" aria-label="Play mode">
          <button
            class={settings.autoplay ? 'on' : ''}
            title="Autoplay: go on to the next slide when this one ends"
            onClick={() => sendToBackground({ target: 'background', type: 'settings', settings: { autoplay: true } })}
          >
            Auto
          </button>
          <button
            class={settings.autoplay ? '' : 'on'}
            title="Manual: stop at the end of each slide"
            onClick={() => sendToBackground({ target: 'background', type: 'settings', settings: { autoplay: false } })}
          >
            Manual
          </button>
        </div>
      </div>

      {isReview && (
        <div class="review-options">
          <span>Diff view</span>
          <div class="mode" role="group" aria-label="Diff view">
            {(['unified', 'split'] as const).map((diffView) => (
              <button
                class={settings.diffView === diffView ? 'on' : ''}
                title={diffView === 'unified' ? 'Show changes in one column' : 'Show old and new code side by side'}
                onClick={() => sendToBackground({ target: 'background', type: 'settings', settings: { diffView } })}
              >
                {diffView === 'unified' ? 'Unified' : 'Split'}
              </button>
            ))}
          </div>
          <span class="muted">Whitespace changes hidden</span>
        </div>
      )}

      {state.notice && (
        <div class="notice">
          {state.notice}
          {state.needsAccess && (
            <button class="notice-action" onClick={() => sendToBackground({ target: 'background', type: 'openOptions' })}>
              Open settings to grant access
            </button>
          )}
        </div>
      )}

      <button class={`list-toggle ${listOpen ? 'open' : ''}`} onClick={() => setListOpen(!listOpen)}>
        <Icon name="chevron" size={16} /> All slides
      </button>
      {listOpen && (
        <ol class="slides" ref={listRef}>
          {walkthrough.slides.map((s, i) => (
            <li>
              <button aria-current={i === slideIndex ? 'true' : undefined} onClick={() => goTo(i)}>
                <span class="number">{i + 1}</span>
                <span class="title">{s.title}</span>
                <span class="duration">{s.durationSec ? formatTime(s.durationSec) : ''}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
