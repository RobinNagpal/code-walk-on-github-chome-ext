# Code Walkthroughs for VS Code

Plays audio code walkthroughs and pull request reviews in desktop VS Code, vscode.dev and github.dev. The
[code-walkthrough skill](../skills/code-walkthrough/SKILL.md) writes them, and saves each one as a zip.

1. **Open a walkthrough zip.** Use the zip button in the **Code Walkthroughs** side bar, or right-click a `.zip` in the
   Explorer and choose **Open Walkthrough Zip…**. The walkthrough is copied into the extension's own storage, so the zip
   is no longer needed.
2. **Start it.** Click it in the **Walkthroughs** list. Each slide opens its file and highlights the slide's lines, and
   the **Player** below the list reads the narration.
   - **Code tour:** the file at the walkthrough's pinned commit.
   - **PR review:** the file's diff, from the PR's merge base to its head.

Files come straight from GitHub at the walkthrough's commit. No checkout is needed and nothing in your workspace is
changed. Public repositories need no sign-in; for a private one, VS Code asks you to sign in to GitHub once.

| Player control | What it does |
| --- | --- |
| ▶ / ❚❚ | Play or pause. The browser may need this one click before it starts audio. |
| ⏮ / ⏭ | Previous or next slide. |
| Progress bar | Click to jump within the slide. |
| Speed | 1×, 1.2×, 1.4×, 1.6×, 1.8× or 2×. |
| **Auto** / **Manual** | Go on to the next slide when one ends, or stop at the end of each slide. |
| File · lines | Show the slide's lines again. |
| **Unified** / **Split** | PR reviews: the diff in one column or side by side (VS Code's `diffEditor.renderSideBySide`). |
| All slides | Jump to any slide. |

## Build and test

```bash
pnpm install
pnpm build          # dist/: the desktop and web bundles and the Player page
pnpm package        # .output/code-walkthroughs-<version>.vsix
pnpm test           # all four layers below
```

The tests run on real walkthrough zips from the repository's `walkthroughs/` folder (or `CODE_WALKTHROUGHS_DIR`):
`robotics-basics-pr-6-frames-3d-and-motion.zip` and `clear-the-table-solution-1-one-fixed-nudge.zip`. Make them
with the skill. `generate-audio.ts --provider silent` writes silent audio of the right length, which is enough.

| Layer | Command | What it checks |
| --- | --- | --- |
| 1 | `pnpm test:unit` | Reading zips, slide targets, line mapping and timing, in plain Node. |
| 2 | `pnpm test:vscode` | Inside a downloaded desktop VS Code: opening zips, files at the commit, diffs, highlights, scrolling, autoplay, the Player loading the MP3. |
| 2 | `pnpm test:web` | The same tests in VS Code for the web (the build vscode.dev serves), in a headless Chromium. |
| 3 | `pnpm test:ui`, `node test/ui-desktop.mjs` | Clicks through a PR review and a code tour like a person, in the web build and in desktop VS Code, and checks what is on screen. Screenshots go to `.vscode-test/ui-web/` and `.vscode-test/ui-desktop/`. |
