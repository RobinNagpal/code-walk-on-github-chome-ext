# Code Walkthroughs — design

Audio code walkthroughs that play on top of GitHub. A Claude skill writes them; a Chrome extension plays them.

```
 Claude Code + skill                         walkthroughs folder                     Chrome extension
 ───────────────────                         ───────────────────                     ────────────────
 reads the repo, writes  ──────────────▶  <folder>/<walkthrough-id>/   ◀──────────  reads the folder (File System
 walkthrough.json, runs                    walkthrough.json                         Access API), plays the audio,
 generate-audio.ts                         01-overview.mp3                          drives the GitHub tab
                                           02-entry-point.mp3 …
```

## 1. The walkthrough format

One folder per walkthrough, named with its hyphen-separated id. Inside: `walkthrough.json` and one MP3 per slide
(`<slide-id>.mp3`). The full schema is `skills/code-walkthrough/walkthrough.schema.json`.

- `repo.commit` is a full SHA. Every link the extension opens is `https://github.com/<owner>/<repo>/blob/<sha>/<file>#L<start>-L<end>`,
  so a walkthrough keeps pointing at the code it describes after the branch moves on.
- Markdown files are opened with `?plain=1`, because GitHub's rendered view has no line anchors.
- Each slide has `title`, `summary` (the on-screen explanation), `narration` (what is spoken), optional `file` +
  `lines`, and `audio` + `durationSec` (filled in by the audio script).
- A slide without an MP3 still plays: the extension speaks its narration with Chrome's built-in `chrome.tts` voice.

## 2. The Claude skill (`skills/code-walkthrough/`)

| File | Job |
| --- | --- |
| `SKILL.md` | The procedure Claude follows: configure the folder, agree on topic + length, pin the commit, read the code, write the JSON, validate, generate audio, report. |
| `scripts/config.ts` | Reads and writes `~/.config/code-walkthroughs/config.json`: the folder (`get` / `set <folder>`; `CODE_WALKTHROUGHS_DIR` overrides it) and the voice (`voice` / `set-voice <provider> [voice] [model]`). |
| `scripts/validate.ts` | Checks the JSON shape and that every file and line range exists at the pinned commit (local clone first, raw.githubusercontent.com as a fallback). Also flags ranges that start or end on a blank line, narration a voice will read badly (identifiers, symbols, decimals, paths), and a length more than 10% off `targetMinutes`. `--show` / `--slide` print the lines so Claude can check the framing. |
| `scripts/tts.ts` | The voice providers (below). Each returns an MP3 and its exact duration. |
| `scripts/generate-audio.ts` | Narration → `<slide-id>.mp3`. Skips unchanged slides via `.audio-manifest.json`. Retries failed requests. |
| `walkthrough.schema.json` | The format. |

Voice providers. Claude has no speech API, so Claude writes the narration and a provider reads it:

| Provider | Key | How |
| --- | --- | --- |
| `edge` (default) | none | Microsoft Edge neural voices via the pure-JS `msedge-tts` package. It returns a constant-bitrate MP3, so duration = bytes ÷ 6000. |
| `openai` | `OPENAI_API_KEY` | `/v1/audio/speech` with `response_format: pcm`. The PCM is encoded to MP3 in JavaScript (`lamejs`). |
| `gemini` | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | The Interactions API (`/v1beta/interactions`) with `response_format: {type: "audio", mime_type: "audio/l16"}` returns PCM, which is encoded the same way. The text is spoken verbatim, so the speaking style goes in a `speech_metadata` annotation. The default model is `gemini-3.8-flash-lite-tts`, the cheapest Gemini speech model; there is no Gemini 4 speech model. |

- **Tools:** no native tools (`say`, ffmpeg) are used.
- **Keys:** read from the environment, or from the skill's own `.env` files (`scripts/env.ts`), never from the repository
  being walked through.
- **Choosing a model:** `config.ts set-voice <provider> [voice|-] [model]` stores the choice, and `config.ts models`
  lists the options.

Install: `scripts/install-skill.sh` links the skill into `~/.claude/skills/code-walkthrough`, runs `npm install` for its
two dependencies, and **asks for the walkthroughs folder and the voice**. The repo is also a Claude Code plugin marketplace
(`.claude-plugin/`), so `/plugin marketplace add RobinNagpal/code-walk-on-github-chome-ext` works too; in that case the
skill asks for the folder the first time it runs.

Sizing rule in the skill: total words = minutes × 165. Budget the words per slide before writing, at 90–200 words a
slide.

## 3. The Chrome extension (`extension/`)

**Stack:** [WXT](https://wxt.dev) (Vite-based extension framework, Manifest V3) + [Preact](https://preactjs.com)
(3 kB React-compatible UI) + TypeScript. `idb-keyval` stores the folder handle.

### Entry points

| Entry point | What it does |
| --- | --- |
| `popup/` | Toolbar popup. Lists every walkthrough in the folder (title, repo, slide count, length) with a **Start** button. Links to settings when no folder is chosen or access must be re-granted. |
| `options/` | Settings page (opens in a tab). **Choose folder** (`showDirectoryPicker`), **Grant access** when Chrome asks again after a restart, and the same list as the popup. |
| `background.ts` | The controller. Owns the player state (walkthrough, slide, playing, speed, autoplay, controlled tab), persists it in `chrome.storage.session`, navigates the tab, tells the offscreen document what to play, advances slides in autoplay, and broadcasts state to the tab. |
| `offscreen/` | An offscreen document (reason `AUDIO_PLAYBACK`). It reads the folder (the handle lives in IndexedDB on the extension origin) and plays the slide MP3 with `playbackRate` = speed. It reports time updates and `ended` to the background. It lives outside the GitHub tab, so audio keeps playing while GitHub loads a new file. Chrome closes such a document after 30 s it considers silent (a long pause, or no audio output). The background keeps the position in session storage and has a watchdog: if audio should be playing, no progress has arrived for 4 s and the document is gone, it reloads the slide where it stopped. |
| `github.content.ts` | Runs on `github.com`. Mounts the floating player in a shadow root (GitHub's CSS can't leak in) when this tab is the walkthrough tab, and highlights and scrolls to the slide's lines. |

### Starting a walkthrough

1. The popup sends `start(walkthroughId)`.
2. The background uses the active tab if it is on github.com, otherwise it opens a new tab.
3. It sets state `{ walkthroughId, slideIndex: 0, playing: true, tabId }` and calls `goTo(0)`.

### goTo(index)

1. The background computes the slide URL.
2. If the tab already shows that file (same URL without the hash), it sends `focus(lines)` to the content script.
   No reload happens. Otherwise it calls `chrome.tabs.update(tabId, { url })`. After the page loads, the content
   script asks for the state and focuses the lines itself.
3. It tells the offscreen document to load `<slide-id>.mp3` and play it if `playing` is true. A slide with no audio is
   spoken with `chrome.tts` instead.

### Highlighting and scrolling

GitHub's code view gives each line `id="LC<n>"`, and its line-number cells carry `data-line-number="<n>"`.

- **Highlight:** the content script writes a `<style>` rule that highlights those selectors for the range. A CSS rule
  survives GitHub's React re-renders, which an inline style would not.
- **Scroll:** it calls `scrollIntoView({ block: 'center' })` on the first line (or on the start of the range, if the
  range is taller than the viewport).
- **Lines not rendered yet** (very long files are virtualised): it sets `location.hash` so GitHub scrolls there
  itself, then retries.

### Autoplay vs manual

- **Autoplay on:** when a slide's audio ends, the background moves to the next slide and keeps playing until the last
  slide. A slide can point at another range in the same file, another function, or another file.
- **Autoplay off (manual):** the audio stops at the end of the slide, and you choose the next slide with Next or by
  clicking one in the list.

**Speed:** 1×, 1.2×, 1.4×, 1.6×, 1.8×, 2×, applied to `audio.playbackRate` (pitch preserved). Speed, autoplay and the
player's position are remembered in `chrome.storage.local`.

### The floating player

A draggable card, top-right by default. You drag it by its header, and its position is clamped to the window and
remembered. It contains:

- The walkthrough title and "slide 3 of 12".
- The current slide's title and summary.
- A seekable progress bar with elapsed and total time.
- Controls: previous, play/pause, next, the speed menu, an Auto/Manual toggle, minimise, and close.
- A collapsible list of all slides. Clicking one jumps there and plays it.
- The slide's file name and lines. Clicking them brings the code back into view without restarting the audio.

Close stops the audio and removes the card. Minimise shrinks it to a pill with play/pause.

### Folder access

`showDirectoryPicker({ mode: 'read' })` runs on the options page because the picker needs a full tab. The handle is
stored in IndexedDB. When Chrome forgets the permission (after a restart, unless "Allow on every visit" was chosen),
the popup and the player show **Grant access**, which opens the options page. One click there calls
`requestPermission`. New walkthroughs show up when the popup reopens, because the folder is re-read each time.

### Permissions

`storage`, `offscreen`, `tabs` (to read the controlled tab's URL), `tts` (spoken fallback), and the host permission
`https://github.com/*`.

## 4. Repository layout

```
extension/                 WXT + Preact + TypeScript Chrome extension
  entrypoints/             popup, options, background, offscreen, github.content
  components/              Player (floating card), Library (walkthrough list)
  lib/                     walkthrough format, messages, folder access, settings
  public/icon/             icons
skills/code-walkthrough/   the Claude skill (SKILL.md, scripts/, schema)
.claude-plugin/            plugin + marketplace manifests for /plugin install
scripts/install-skill.sh   installs the skill and asks for the folder
walkthroughs/              local walkthroughs (git-ignored)
docs/DESIGN.md             this file
```

## 5. Delivery steps

1. Skill + scripts. Dogfood them by generating two ~10-minute walkthroughs (`robot-arm-projects`,
   `v5-pick-glasses/04-clear-the-table`, solutions 1 and 2, pinned to `7fdba59`). Feed what the authoring agents hit
   back into `SKILL.md` and the scripts.
2. Extension: shared libs, then background, offscreen, content script and player, then popup and options.
3. `pnpm build`, which produces `extension/.output/chrome-mv3`, loadable unpacked. Type-check with `tsc --noEmit`.
4. README: install the extension (build, then Load unpacked) and install the skill (script or plugin).
5. Review pass 1 (self), fix. Review pass 2 (independent reviewer agent), fix. Then commit to `main` and push.
