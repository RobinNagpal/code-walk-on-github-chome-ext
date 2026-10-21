# Code Walkthroughs on GitHub

Audio walkthroughs of code that play right on GitHub. Claude Code writes them with the **code-walkthrough skill**, and
the **Code Walkthroughs Chrome extension** plays them. While a slide's narration plays, the extension opens the right
file on GitHub, scrolls to the right lines and highlights them. Then it moves on to the next slide, which can be
another part of the same file, another function, or another file.

There are two types of walkthrough (`type` in `walkthrough.json`):

- **`CodeTour`** explains code as it is at one commit. Its links keep pointing at the code it describes after the
  branch moves on.
- **`PRReview`** walks a reviewer through a pull request. It plays on the PR's **Files changed** tab, with whitespace
  changes hidden, and highlights the changed lines being discussed. The player has a **Unified | Split** switch for
  the diff layout.

```
<walkthroughs folder>/
  clear-the-table-solution-1-one-fixed-nudge/     one folder per walkthrough, hyphen-separated name
    walkthrough.json                              slides: title, summary, narration, file, line range
    01-the-problem.mp3                            one MP3 per slide
    02-what-is-new.mp3
    …
```

## Install the Chrome extension

**From the prebuilt zip (no build tools needed):** unzip
[`releases/code-walkthroughs-extension-0.2.2-chrome.zip`](releases/code-walkthroughs-extension-0.2.2-chrome.zip) into a
folder you keep, then follow the steps below and choose that folder in step 2.

**From source:** you need Node.js 22.18 or newer and pnpm.

```bash
cd extension
pnpm install
pnpm build      # or `pnpm zip` to produce the zip in extension/.output/
```

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose `extension/.output/chrome-mv3`, or the folder you unzipped.
3. Pin **Code Walkthroughs** to the toolbar and click it, then click **Settings**.
4. Click **Choose folder** and pick your walkthroughs folder. This is the same folder you give the skill.
5. Chrome may later ask for access again, for example after a restart. When it does, the toolbar list and the player
   show **Grant access**. Click it, then choose **Allow on every visit** so Chrome stops asking.

For development, `pnpm dev` rebuilds on every change (see the [WXT docs](https://wxt.dev)); `pnpm compile` type-checks.

### Playing a walkthrough

Click the toolbar icon and **Start** a walkthrough. A player appears on the right of the GitHub page. Drag it anywhere by
its header; it remembers where you put it.

| Control | What it does |
| --- | --- |
| ▶ / ❚❚ | Play or pause the narration. |
| ⏮ / ⏭ | Previous or next slide. |
| Progress bar | Click to jump within the slide. |
| Speed | 1×, 1.2×, 1.4×, 1.6×, 1.8× or 2×. |
| **Auto** | When a slide ends, go to the next one and keep playing. |
| **Manual** | Stop at the end of each slide; pick the next one yourself. |
| File · lines | Bring the slide's code back into view if you scrolled away. |
| All slides | The full list; click any slide to jump there. |
| Unified / Split | PR reviews only: show the diff in one column or side by side. The page reloads in that layout and the walkthrough carries on. |
| – / × | Minimise to a small pill, or end the walkthrough. |

The narration keeps playing while GitHub loads the next file. If a slide has no MP3, the extension reads its narration
with Chrome's built-in voice.

## Install the Claude skill

You can install it with the install script or as a Claude Code plugin.

### Option A: install script (recommended)

```bash
scripts/install-skill.sh
```

The script:

1. Links the skill into `~/.claude/skills/code-walkthrough`, so a later `git pull` updates it. Use `--copy` to copy it
   instead.
2. Installs its two small JavaScript dependencies.
3. **Asks for your walkthroughs folder and the voice to use.**

### Option B: Claude Code plugin

```
/plugin install code-walkthrough --marketplace RobinNagpal/code-walk-on-github-chome-ext
```

The first time the skill runs, it asks for the walkthroughs folder.

### Voices

Claude writes the narration; a text-to-speech provider reads it. Claude has no speech API.

| Provider | API key (environment variable) | Models |
| --- | --- | --- |
| `edge` | none | Default. Free Microsoft Edge neural voices (`msedge-tts`, pure JavaScript). |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini-tts` (default), `tts-1`, `tts-1-hd`. Voice `alloy` by default. |
| `gemini` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-3.8-flash-lite-tts` (default, cheapest), `gemini-3.8-flash-tts`, `gemini-3.1-flash-tts-preview`, `gemini-2.5-pro-preview-tts`. Voice `Charon` by default. |

**API keys.** Put them in a `.env` file at the root of this repository; it is git-ignored, and `.env.example` shows the
format. Keys already in your environment take precedence.

```bash
cp .env.example .env    # then fill in GEMINI_API_KEY (or GOOGLE_API_KEY) / OPENAI_API_KEY
```

**Voice and model.** Change them at any time by asking Claude ("use the cheapest Gemini voice for walkthroughs"), or
directly:

```bash
node ~/.claude/skills/code-walkthrough/scripts/config.ts models                       # list choices
node ~/.claude/skills/code-walkthrough/scripts/config.ts set-voice gemini - gemini-3.8-flash-lite-tts
```

`-` keeps the provider's default voice. Pass `--provider`, `--voice` or `--model` to `generate-audio.ts` for a one-off
run.

No native tools are needed: no `say`, no ffmpeg. OpenAI and Gemini audio is encoded to MP3 in JavaScript.

### Generating a walkthrough

In any repository, ask Claude Code, for example:

> Create a 10 minute code walkthrough of how requests are authenticated

Claude then does the following:

1. Pins the current pushed commit.
2. Reads the code.
3. Writes `walkthrough.json` and checks every file and line range with `validate.ts`.
4. Generates the MP3s.

When it finishes, open the extension's list and start the walkthrough.

For a pull request review, give Claude the PR:

> Create a review walkthrough for https://github.com/RobinNagpal/dodao-ui/pull/1613

Claude reads the PR's description and its whitespace-ignored diff, and then writes a `PRReview` walkthrough. It covers
what the PR does, then each important change in a sensible order, and ends with risks and things to check.
`validate.ts` makes sure every highlighted range is inside a part of the diff that GitHub actually shows. The extension
always opens the PR's current Files changed tab, so regenerate the walkthrough if the PR gets new commits.

Every walkthrough uses plain, simple English, so that people who don't speak English as a first language can follow
it. That means short sentences, common words, no idioms, and each technical term explained the first time it is used.
`validate.ts` flags long sentences and common idioms.

## Repository layout

```
extension/                 Chrome extension: WXT + Preact + TypeScript
  entrypoints/             background (controller), offscreen (audio), github.content (player), popup, options
  components/              Player, Library
  lib/                     walkthrough format, messages, folder access, highlighting
skills/code-walkthrough/   the Claude skill: SKILL.md, scripts/ (config, validate, generate-audio, tts), schema
.claude-plugin/            plugin and marketplace manifests
scripts/install-skill.sh   skill installer
docs/DESIGN.md             how it fits together
walkthroughs/              local walkthroughs (git-ignored)
```

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture.
