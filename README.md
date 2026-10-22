# Code Walkthroughs on GitHub

Audio walkthroughs of code. Claude Code or Antigravity CLI writes them with the **code-walkthrough skill**, and two
players play them:

- **Chrome extension:** plays them right on GitHub.
- **VS Code extension:** plays them in desktop VS Code, vscode.dev and github.dev.

While a slide's narration plays, the player opens the right file, scrolls to the right lines and highlights them. Then
it moves on to the next slide, which can be another part of the same file, another function, or another file.

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
  clear-the-table-solution-1-one-fixed-nudge.zip  the same walkthrough in one file, for the VS Code extension
```

## Install the Chrome extension

**From the prebuilt zip (no build tools needed):** unzip
[`releases/code-walkthroughs-extension-0.2.2-chrome.zip`](releases/code-walkthroughs-extension-0.2.2-chrome.zip) into a
folder you keep, then follow the steps below and choose that folder in step 2.

**From source:** you need Node.js 22.18 or newer and pnpm.

```bash
cd chrome-extension
pnpm install
pnpm build      # or `pnpm zip` to produce the zip in chrome-extension/.output/
```

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose `chrome-extension/.output/chrome-mv3`, or the folder you unzipped.
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

## Install the VS Code extension

Works in desktop VS Code, [vscode.dev](https://vscode.dev) and [github.dev](https://github.dev).

- **Desktop VS Code:** run **Extensions: Install from VSIX…** and pick
  [`releases/code-walkthroughs-vscode-0.1.0.vsix`](releases/code-walkthroughs-vscode-0.1.0.vsix).
- **From source:** `cd vscode-extension && pnpm install && pnpm package` builds the `.vsix` in `vscode-extension/.output/`.

Then:

1. Open the **Code Walkthroughs** side bar (its icon is `<▸>`).
2. Click the zip button and pick a walkthrough's `.zip`, or right-click a `.zip` in the Explorer and choose
   **Open Walkthrough Zip…**. The walkthrough is copied into the extension's storage.
3. Click the walkthrough to start it. The **Player** below the list has the same controls as the Chrome player.

The two types show up differently:

- **Code tour:** each slide opens its file at the pinned commit.
- **PR review:** each slide opens the file's diff from the PR's merge base to its head, in VS Code's split or unified
  diff.

Files are read straight from GitHub at those commits, so no checkout is needed. Private repositories ask you to sign in
to GitHub once.

To use it on vscode.dev or github.dev, it must first be published to the Marketplace (or Open VSX); until then, use
desktop VS Code. See [vscode-extension/README.md](vscode-extension/README.md) for how it is built and tested.

## Install the skill

The skill works in **Claude Code** and in **Antigravity CLI** (`agy`, Google's replacement for Gemini CLI). Both use
the same `SKILL.md` format, so the same skill folder serves both. Install it with the install script, or as a plugin.

### Option A: install script (recommended)

```bash
scripts/install-skill.sh                          # Claude Code
scripts/install-skill.sh --antigravity            # Antigravity CLI
scripts/install-skill.sh --claude --antigravity   # both
```

The script:

1. Links the skill into `~/.claude/skills/code-walkthrough` (Claude Code) and/or
   `~/.gemini/config/skills/code-walkthrough` (Antigravity CLI). A later `git pull` updates it. Add `--copy` to
   copy it instead.
2. Installs its two small JavaScript dependencies.
3. **Asks for your walkthroughs folder and the voice to use.** Both tools share these settings.

### Option B: plugin

Claude Code:

```
/plugin install code-walkthrough --marketplace RobinNagpal/code-walk-on-github-chome-ext
```

Antigravity CLI:

```bash
agy plugin install https://github.com/RobinNagpal/code-walk-on-github-chome-ext
```

The first time the skill runs, it asks for the walkthroughs folder and installs its dependencies.

In Antigravity CLI, every skill is also a slash command, so you can type `/code-walkthrough`, or just ask for a
walkthrough as below.

### Voices

The agent (Claude or Gemini) writes the narration; a text-to-speech provider reads it aloud.

| Provider | API key (environment variable) | Models |
| --- | --- | --- |
| `edge` | none | Default. Free Microsoft Edge neural voices (`msedge-tts`, pure JavaScript). |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini-tts` (default), `tts-1`, `tts-1-hd`. Voice `alloy` by default. |
| `gemini` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-3.8-flash-lite-tts` (default, cheapest), `gemini-3.8-flash-tts`, `gemini-3.1-flash-tts-preview`, `gemini-2.5-pro-preview-tts`. Voice `Charon` by default. |
| `silent` | none | For testing: silent MP3s as long as the narration would take to read. |

**API keys.** Put them in a `.env` file at the root of this repository; it is git-ignored, and `.env.example` shows the
format. Keys already in your environment take precedence. If you installed the skill as a plugin or with `--copy`, put
them in `~/.config/code-walkthroughs/.env` instead.

```bash
cp .env.example .env    # then fill in GEMINI_API_KEY (or GOOGLE_API_KEY) / OPENAI_API_KEY
```

**Voice and model.** Change them at any time by asking the agent ("use the cheapest Gemini voice for walkthroughs"), or
directly:

```bash
node skills/code-walkthrough/scripts/config.ts models                       # list choices
node skills/code-walkthrough/scripts/config.ts set-voice gemini - gemini-3.8-flash-lite-tts
```

`-` keeps the provider's default voice. Pass `--provider`, `--voice` or `--model` to `generate-audio.ts` for a one-off
run.

No native tools are needed: no `say`, no ffmpeg. OpenAI and Gemini audio is encoded to MP3 in JavaScript.

### Generating a walkthrough

In any repository, ask Claude Code or Antigravity CLI, for example:

> Create a 10 minute code walkthrough of how requests are authenticated

The agent then does the following:

1. Pins the current pushed commit.
2. Reads the code.
3. Writes `walkthrough.json` and checks every file and line range with `validate.ts`.
4. Generates the MP3s.

When it finishes, open the Chrome extension's list and start the walkthrough. For VS Code, open the
`<id>.zip` the audio step writes next to the walkthrough's folder.

For a pull request review, give it the PR:

> Create a review walkthrough for https://github.com/RobinNagpal/dodao-ui/pull/1613

The agent reads the PR's description and its whitespace-ignored diff, and then writes a `PRReview` walkthrough. It covers
what the PR does, then each important change in a sensible order, and ends with risks and things to check.
`validate.ts` makes sure every highlighted range is inside a part of the diff that GitHub actually shows. The extension
always opens the PR's current Files changed tab, so regenerate the walkthrough if the PR gets new commits.

Every walkthrough uses plain, simple English, so that people who don't speak English as a first language can follow
it. That means short sentences, common words, no idioms, and each technical term explained the first time it is used.
`validate.ts` flags long sentences and common idioms.

## Repository layout

```
chrome-extension/          Chrome extension: WXT + Preact + TypeScript
  entrypoints/             background (controller), offscreen (audio), github.content (player), popup, options
  components/              Player, Library
  lib/                     walkthrough format, messages, folder access, highlighting
vscode-extension/          VS Code extension (desktop and web): esbuild + Preact + TypeScript
  src/                     extension, library (zips → storage), navigator (editors, diffs, highlights), player view
  test/                    unit, in-VS-Code (desktop and web) and click-through UI tests
skills/code-walkthrough/   the skill (Claude Code and Antigravity CLI): SKILL.md, scripts/ (config, validate, generate-audio, tts, pack), schema
releases/                  prebuilt Chrome extension zip and VS Code .vsix
.claude-plugin/            Claude Code plugin and marketplace manifests
plugin.json                Antigravity CLI plugin manifest (its skills are in skills/)
scripts/install-skill.sh   skill installer
docs/DESIGN.md             how it fits together
walkthroughs/              local walkthroughs (git-ignored)
```

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture.
