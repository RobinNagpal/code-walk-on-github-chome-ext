// Runs on github.com. In the tab that is playing a walkthrough it mounts the
// floating player (in a shadow root, away from GitHub's CSS) and highlights the
// current slide's lines.
import './style.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { createShadowRootUi, defineContentScript, type ShadowRootContentScriptUi } from '#imports';
import { Player } from '@/components/Player';
import { clearHighlight, focusLines } from '@/lib/highlight';
import { sendToBackground, type PageReadyReply, type PlayerView, type Progress, type TabMessage } from '@/lib/messages';
import { focusHash, samePage, type FocusTarget } from '@/lib/walkthrough';

// GitHub renders a soft navigation shortly after the URL changes; wait before looking for lines.
const SOFT_NAVIGATION_SETTLE_MS = 400;

// The newest view, kept outside the component so one that arrives before it mounts isn't lost.
let latest: PlayerView | undefined;
const viewListeners = new Set<(view: PlayerView) => void>();

function App() {
  const [view, setView] = useState(latest!);
  const [progress, setProgress] = useState<Progress>(latest!.progress);

  useEffect(() => {
    const onView = (next: PlayerView) => {
      setView(next);
      setProgress(next.progress);
    };
    viewListeners.add(onView);
    onView(latest!);
    const onMessage = (message: TabMessage) => {
      if (message.type === 'progress') setProgress(message.progress);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      viewListeners.delete(onView);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  return <Player view={view} progress={progress} />;
}

/** Shows the lines, and points the URL at them so GitHub's own highlight matches ours. */
function showLines(target: FocusTarget): void {
  const hash = focusHash(target);
  if (hash && location.hash !== hash) location.replace(hash);
  // A slide with no lines (a PR overview) drops the previous slide's anchor, so GitHub's highlight goes too.
  else if (!hash && location.hash) history.replaceState(history.state, '', location.pathname + location.search);
  focusLines(target);
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    let ui: ShadowRootContentScriptUi<HTMLElement> | undefined;
    let mounting: Promise<void> | undefined;
    // False once the walkthrough is closed, so a mount still in progress is undone.
    let wanted = false;

    function setView(view: PlayerView): void {
      latest = view;
      viewListeners.forEach((listener) => listener(view));
      wanted = true;
      if (ui || mounting) return;
      mounting = createShadowRootUi(ctx, {
        name: 'code-walkthrough-player',
        position: 'inline',
        anchor: 'body',
        onMount(container) {
          render(<App />, container);
          return container;
        },
        onRemove(container) {
          if (container) render(null, container);
        },
      }).then((created) => {
        mounting = undefined;
        if (!wanted) return;
        ui = created;
        ui.mount();
      });
    }

    function unmount(): void {
      wanted = false;
      ui?.remove();
      ui = undefined;
      clearHighlight();
    }

    async function syncWithBackground(): Promise<void> {
      const reply = await sendToBackground<PageReadyReply>({ target: 'background', type: 'pageReady' }).catch(
        (): PageReadyReply => ({}),
      );
      if (!reply.view) {
        unmount();
        return;
      }
      setView(reply.view);
      if (reply.onSlide) focusLines(reply.focus);
      else clearHighlight();
    }

    browser.runtime.onMessage.addListener((message: TabMessage) => {
      if (message.type === 'view') setView(message.view);
      else if (message.type === 'focus') showLines(message.target);
      else if (message.type === 'clear') clearHighlight();
      else if (message.type === 'closed') unmount();
    });

    // GitHub moves between files without reloading. Only a different file matters:
    // hash changes (clicking a line number, or showLines above) must not pull the view back.
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl, oldUrl }) => {
      if (samePage(newUrl.href, oldUrl.href)) return;
      clearHighlight();
      ctx.setTimeout(syncWithBackground, SOFT_NAVIGATION_SETTLE_MS);
    });

    await syncWithBackground();
  },
});
