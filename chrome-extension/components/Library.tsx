// The list of walkthroughs in the chosen folder, shared by the popup and the settings page.
import { useCallback, useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { chooseFolder, folderAccess, getFolder, readLibrary, type Access, type Library as LibraryData } from '@/lib/folder';
import { sendToBackground } from '@/lib/messages';
import { formatTime, totalDuration, walkthroughType, WalkthroughType } from '@/lib/walkthrough';

type Mode = 'popup' | 'options';

interface Loaded {
  folder?: FileSystemDirectoryHandle;
  access: Access;
  library?: LibraryData;
  error?: string;
}

export function Library({ mode }: { mode: Mode }) {
  const [loaded, setLoaded] = useState<Loaded>();

  const load = useCallback(async () => {
    try {
      const folder = await getFolder();
      const access = await folderAccess(folder);
      const library = access === 'granted' ? await readLibrary(folder!) : undefined;
      setLoaded({ folder, access, library });
    } catch (error) {
      setLoaded({ access: 'none', error: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openOptions = () => {
    browser.runtime.openOptionsPage();
    if (mode === 'popup') window.close();
  };

  async function pick() {
    try {
      await chooseFolder();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setLoaded((l) => ({ ...l!, error: (error as Error).message }));
      return;
    }
    await load();
  }

  async function grant() {
    if (mode === 'popup') return openOptions();
    await folderAccess(loaded?.folder, true);
    await load();
  }

  if (!loaded) return <p class="muted">Loading…</p>;

  const folderBar =
    mode === 'options' ? (
      <div class="folder">
        <div>
          <div class="label">Walkthroughs folder</div>
          <div class="value">{loaded.folder ? loaded.folder.name : 'Not chosen yet'}</div>
        </div>
        <div class="actions">
          {loaded.folder && loaded.access !== 'granted' && (
            <button class="button primary" onClick={grant}>
              Grant access
            </button>
          )}
          <button class="button" onClick={pick}>
            {loaded.folder ? 'Change folder' : 'Choose folder'}
          </button>
          {loaded.access === 'granted' && (
            <button class="button" onClick={load}>
              Reload
            </button>
          )}
        </div>
      </div>
    ) : null;

  let body;
  if (loaded.access === 'none') {
    body = (
      <div class="empty">
        <p>Choose the folder your code walkthroughs are saved in. It is the folder you gave the Claude skill.</p>
        {mode === 'popup' && (
          <button class="button primary" onClick={openOptions}>
            Choose folder
          </button>
        )}
      </div>
    );
  } else if (loaded.access !== 'granted') {
    body = (
      <div class="empty">
        <p>
          Chrome needs your permission to read <strong>{loaded.folder?.name}</strong> again.
          {mode === 'options' && ' Choose “Allow on every visit” so it doesn’t ask after each restart.'}
        </p>
        {mode === 'popup' && (
          <button class="button primary" onClick={grant}>
            Grant access
          </button>
        )}
      </div>
    );
  } else if (!loaded.library?.entries.length) {
    body = (
      <div class="empty">
        <p>
          No walkthroughs in <strong>{loaded.folder?.name}</strong> yet. Ask Claude Code for one with the code-walkthrough
          skill, then reopen this list.
        </p>
      </div>
    );
  } else {
    body = (
      <ul class="walkthroughs">
        {loaded.library.entries.map(({ folder, walkthrough }) => (
          <li>
            <div class="info">
              <div class="title">{walkthrough.title}</div>
              {walkthrough.description && <div class="description">{walkthrough.description}</div>}
              <div class="meta">
                {walkthroughType(walkthrough) === WalkthroughType.PRReview && walkthrough.pullRequest
                  ? `PR review · ${walkthrough.repo.owner}/${walkthrough.repo.name} #${walkthrough.pullRequest.number}`
                  : `Code tour · ${walkthrough.repo.owner}/${walkthrough.repo.name} @ ${walkthrough.repo.commit.slice(0, 7)}`}{' '}
                · {walkthrough.slides.length} slides · {formatTime(totalDuration(walkthrough))}
              </div>
            </div>
            <button
              class="button primary"
              onClick={async () => {
                await sendToBackground({ target: 'background', type: 'start', folder, walkthrough });
                if (mode === 'popup') window.close();
              }}
            >
              Start
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div class={`library ${mode}`}>
      {folderBar}
      {loaded.error && <p class="error">{loaded.error}</p>}
      {body}
      {loaded.library?.problems.map((p) => (
        <p class="warning">
          Skipped <strong>{p.folder}</strong>: {p.reason}
        </p>
      ))}
    </div>
  );
}
