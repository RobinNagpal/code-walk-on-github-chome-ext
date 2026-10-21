---
name: code-walkthrough
description: Generate an audio code walkthrough (walkthrough.json plus one MP3 per slide) for playback on GitHub with the Code Walkthroughs Chrome extension. Two types are supported. A code tour explains a repository pinned to a commit. A PR review walks through a pull request's changes in its Files changed tab. Use when the user asks to create, generate, record, or update a code walkthrough, code tour, PR walkthrough, PR review walkthrough, or audio explanation of code or of a pull request (for example when they give a GitHub pull request URL), or to set the code walkthroughs folder or voice.
---

# Code walkthrough

A walkthrough is a folder of slides. Each slide points at a file and a line range, has a short on-screen summary, and
has narration that becomes an MP3. The Chrome extension lists the walkthroughs in the folder and plays them in a
floating player on GitHub. The `type` field says what a walkthrough shows:

| `type` | Use it for | The extension shows each slide |
| --- | --- | --- |
| `CodeTour` (default) | Explaining code as it is at one commit | in GitHub's file view at that commit, lines highlighted |
| `PRReview` | Reviewing a pull request; the user gives a PR URL or number | in the PR's Files changed tab, whitespace changes hidden, in unified or split view (the viewer picks), changed lines highlighted |

You write the content (`walkthrough.json`). The scripts in `scripts/` next to this file check it and turn the narration
into speech. `<skill-dir>` below means the directory this SKILL.md is in. Run the scripts with `node`; version 22.18 or
newer runs TypeScript directly. Prefix the command with `NODE_NO_WARNINGS=1` to hide Node's "experimental" notice.

## 1. Check the setup

```bash
NODE_NO_WARNINGS=1 node <skill-dir>/scripts/config.ts get      # the walkthroughs folder
NODE_NO_WARNINGS=1 node <skill-dir>/scripts/config.ts voice    # the voice, and whether its API key is set
```

- **`get` fails:** ask the user which folder walkthroughs should be saved in (the Chrome extension reads the same
  folder), then run `NODE_NO_WARNINGS=1 node <skill-dir>/scripts/config.ts set "<folder>"`.
- **`voice` reports a missing key:** tell the user which environment variable to set, or offer the free `edge` voice.
- **Dependencies missing:** if a script says `msedge-tts` or `lamejs` can't be found, run `npm install --prefix <skill-dir>`.

Voices:

| Provider | Key (environment variable) | Default voice / model | Other models |
| --- | --- | --- | --- |
| `edge` (default) | none, free | `en-US-AndrewMultilingualNeural` | none |
| `openai` | `OPENAI_API_KEY` | `alloy` / `gpt-4o-mini-tts` | `tts-1`, `tts-1-hd` |
| `gemini` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `Charon` / `gemini-3.8-flash-lite-tts` (cheapest) | `gemini-3.8-flash-tts`, `gemini-3.1-flash-tts-preview`, `gemini-2.5-pro-preview-tts` |

You write the narration, and one of these providers reads it aloud.

**API keys** can be set in the environment or in a `.env` file that belongs to the skill. The scripts read, in order:

1. `<skill-dir>/.env`
2. the `.env` at the root of the repository the skill is linked from
3. `~/.config/code-walkthroughs/.env`

They never read the `.env` of the repository being walked through.

**Choosing the voice or model.** When the user names a provider, model or voice ("use Gemini", "use the cheapest
Gemini model", "use gpt-4o-mini-tts"), store it:

```bash
NODE_NO_WARNINGS=1 node <skill-dir>/scripts/config.ts models                                     # what is available
NODE_NO_WARNINGS=1 node <skill-dir>/scripts/config.ts set-voice <edge|openai|gemini> [voice|-] [model]
# e.g. set-voice gemini - gemini-3.8-flash-tts   ("-" keeps the default voice)
```

For a single run only, pass `--provider`, `--voice` or `--model` to `generate-audio.ts` instead.

If the user only asked to set the folder or the voice, stop here.

## 2. Agree on the request

You need three things. If the user didn't give them, ask once, in one question, for whatever is missing:

- **What to cover:** a feature, a folder, a flow, or a pull request. A pull request URL or number means a `PRReview`;
  follow section 3b instead of section 3.
- **Length in minutes:** default 10 for a code tour. For a PR review, size it to the change: about 2–3 minutes for a
  small PR (under 100 changed lines), plus about 1 minute per further 75 changed lines, up to 15 minutes unless the user
  asks for more.
- **Name:** derive a short hyphen-separated id from the topic (for example `auth-token-refresh`) unless the user gave one.
  For a PR review use `<repo>-pr-<number>-<short-title>`, for example `dodao-ui-pr-1613-seo-playground`.

**Budget the words before writing.** At 165 spoken words a minute, total words = minutes × 165. Pick a slide count that
gives each slide 90–200 words: 8–15 slides for 10 minutes, about 30 for 20 minutes. Use the slide count the user asks
for when they give one. Per-slide budget = total ÷ slides, so about 110 words a slide for 30 slides in 20 minutes.
Write to that budget; first drafts tend to run 20–30% long, and cutting afterwards costs more than writing short.

**Know the audience.** Unless the user says otherwise, assume the listener is new to the code and its background:
explain the problem it solves and any outside concepts it relies on before diving in. For a long walkthrough, open
with the high-level architecture (what the parts are and how data flows between them), then walk the main code path,
showing the key lines, the library calls and what they do, and the important data structures.

## 3. Find the code and pin the commit

Every link points at one commit, so the walkthrough keeps working after the code moves on.

If the code is in the current repository, `<repo>` is `.`. If it is in another one, clone it to a temporary directory
and use that path as `<repo>`.

```bash
git -C <repo> rev-parse HEAD
git -C <repo> remote get-url origin          # owner and repo name
git -C <repo> branch -r --contains <sha>     # empty means the commit is not on GitHub
```

If the commit isn't on GitHub, tell the user the links will 404 until it is pushed, and offer the newest pushed commit
(`git -C <repo> rev-parse @{upstream}`) instead. Read files as they are at the pinned commit
(`git -C <repo> show <sha>:<path>`), not from a working tree that may have changed.

## 3b. PR reviews: get the pull request

For a `PRReview`, the slides follow the pull request's diff instead of a pinned tree.

```bash
gh pr view <pr-url> --json number,title,body,headRefOid,baseRefName,files,url
```

Clone the repository to a temporary directory, or use the current one if it is the same repository. Fetch both sides
and find the merge base, which GitHub diffs against:

```bash
git -C <repo> fetch origin pull/<number>/head <baseRefName>
base=$(git -C <repo> merge-base FETCH_HEAD origin/<baseRefName>)   # or merge-base <headRefOid> origin/<baseRefName>
git -C <repo> diff -w --stat $base <headRefOid>                    # what changed, whitespace ignored
git -C <repo> diff -w $base <headRefOid> -- <file>                 # the hunks GitHub will show
```

Read the whole diff, and read enough of the surrounding code at the head to understand it. Also read the PR
description and any linked issue.

Rules for a PR review:

- **Header:** set `"type": "PRReview"`, `"pullRequest": { "number", "title", "baseCommit": <merge base>,
  "headCommit": <headRefOid> }`, and `repo.commit` = `headCommit`.
- **Lines:** each slide's `lines` must sit inside one hunk of the whitespace-ignored diff, because GitHub folds
  everything else away. Use `"side": "new"` (the default) for added or kept code, numbered as in the head. Use
  `"side": "old"` for removed code, numbered as in the base.
- **No-file slides:** a slide without `file` shows the top of the Files changed tab, which suits an overview slide.
- **Following the PR:** the extension always opens the PR's current Files changed tab. If the PR gets new commits, line
  numbers can move, so regenerate the walkthrough.
- **The story:** a reviewer wants it in this order:
  1. What the PR does, and why (one slide).
  2. The changes, in the order that makes the design clear. That is usually the core change first, then the code that
     calls it, then tests and configuration. It is not necessarily the file order.
  3. For each change: what it does, why, and what to check. Point out risks, edge cases, missing tests, and anything
     surprising. Don't just read the diff out loud.
  4. A short wrap-up of what to look at most carefully.

## 4. Read the code, then plan the story

Read every file you will talk about. Plan the walkthrough as a story a new engineer can follow:

1. What the code is for, and where it starts.
2. The main path, in the order it runs.
3. How it is tested or measured, if that helps.

Leave side details out. A slide can jump to another range in the same file, another function, or another file. The
narration may briefly mention something that isn't on screen ("problem three's ranker, which uses two hundred trees")
when that context helps. Keep such mentions short, because the viewer can't see them.

Check claims against the code. Where a README and the code disagree, follow the code. You may say that they disagree.

## 5. Write walkthrough.json

Create `<walkthroughs-folder>/<id>/walkthrough.json`. The format is in `walkthrough.schema.json`:

```json
{
  "version": 1,
  "type": "CodeTour",
  "id": "auth-token-refresh",
  "title": "How access tokens are refreshed",
  "description": "From the 401 response to the retried request, in the API client.",
  "repo": { "host": "github.com", "owner": "acme", "name": "web", "commit": "<40-character sha>" },
  "createdAt": "<today, YYYY-MM-DD>",
  "targetMinutes": 10,
  "slides": [
    {
      "id": "01-where-it-starts",
      "title": "Where a refresh starts",
      "summary": "The fetch wrapper catches 401s and hands them to the refresher before retrying once.",
      "narration": "Everything starts in the fetch wrapper. ...",
      "file": "src/api/client.ts",
      "lines": { "start": 42, "end": 71 }
    }
  ]
}
```

- **Ids:**
  - The folder name equals `id`.
  - Slide ids are `NN-short-name` (`01-overview`, `02-entry-point`), unique and hyphen-separated.
- **`lines`:**
  - Frame exactly what the narration talks about. That is usually 5–40 lines. When the slide is about a whole function,
    frame the whole function even if it is longer.
  - Don't start or end on a blank line.
  - Without `lines`, the file opens at the top.
  - A slide without `file` shows no code. Use that only for an introduction or a wrap-up.
- **Markdown files** work too: the extension opens them in GitHub's plain view, so line numbers apply.
- **Plain language, always.** Many listeners do not speak English as a first language. Write the narration and the
  summary so they can follow it:
  - Use short sentences. Aim for under 15 words, and never go over 25.
  - Use common, everyday words. Say "use", not "utilise", and "check", not "ascertain".
  - Put one idea in each sentence, and use the active voice: "The loop picks a push", not "A push is picked by the loop".
  - Don't use idioms, metaphors, jokes, wordplay or slang ("under the hood", "in a nutshell", "the heavy lifting",
    "pays for itself").
  - Explain each technical term in a few simple words the first time you use it.
  - Be direct. Say what the code does and why, with no storytelling, no build-up and no filler.
- **`summary`** is what the viewer reads: 1–3 short, plain sentences giving the slide's key point.
- **`narration`** is what the viewer hears, so write for the ear:
  - **Names, as a person would say them:**
    - `jaw_paths.py` → "the jaw paths module"
    - `OneFixedNudge` → "One Fixed Nudge"
    - `__init__` → "the init method"
    - `self._choose(x)` → "the choose method"
  - **Numbers and symbols, in words:**
    - `0.35` → "zero point three five"
    - `65 mm` → "sixty five millimetres"
    - `x >= 2` → "x is at least two"
  - Leave out backticks, underscores, brackets, file extensions, paths, URLs, markdown and emoji. Don't read code out
    symbol by symbol.
  - Point at the screen ("the loop at the top", "the last five lines") so the listener knows where to look.
  - Explain why the code does what it does, not just what each line says.

## 6. Validate

```bash
NODE_NO_WARNINGS=1 node <skill-dir>/scripts/validate.ts "<walkthroughs-folder>/<id>" --repo <repo>
```

It checks the following:

- the JSON is well formed;
- every file exists at the commit;
- every range fits inside its file;
- no range starts or ends on a blank line;
- no narration contains text a voice reads badly;
- no sentence in the narration or the summary is longer than 25 words, and each slide's narration averages at most
  16 words a sentence. Each slide's line shows its average and longest sentence;
- no common idioms appear;
- the total length is within 10% of `targetMinutes`.

Each slide prints the first and last line of its range. Use `--show` to print every line, and `--slide <id|number>` to
look at one slide. Read the lines against the narration and fix any range that doesn't match. Repeat until there are no
errors and no warnings you can fix.

## 7. Generate the audio

```bash
NODE_NO_WARNINGS=1 node <skill-dir>/scripts/generate-audio.ts "<walkthroughs-folder>/<id>"
```

- **Output:** one `<slide-id>.mp3` per slide, with `audio` and `durationSec` filled in on each slide. The voice is the
  configured one; override it with `--provider`, `--voice` or `--model`.
- **Network:** every provider needs it.
- **Re-runs:** only slides whose narration or voice changed are regenerated. `--force` redoes all of them.
- **Speed:** about 3 seconds per slide with `edge`.

If the total printed at the end is more than 10% off the target, edit the narration, then validate and generate again.
Voices don't speak at a fixed pace (Gemini runs a few percent slower than 165 words a minute), so aim the word count
about 3% under the target.

## 8. Report

Tell the user:

- the folder path;
- the number of slides and the total length;
- the voice used;
- that the walkthrough appears in the Code Walkthroughs extension's list (toolbar icon) the next time it is opened.
