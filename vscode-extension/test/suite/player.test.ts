// Layer 2: the extension inside a real VS Code (desktop, and VS Code for the web). Opens
// the fixture zips, plays a code tour and a PR review, and checks what the editor shows.
import * as vscode from 'vscode';
import { api, editorFor, equal, fixture, ok, PR_ZIP, showsLine, TOUR_ZIP, waitFor } from './helpers.ts';

const PRESS_PLAY = 'Press play to start the audio.';

describe('Code Walkthroughs', function () {
  this.timeout(90_000);

  before(async () => {
    const { library } = await api();
    for (const entry of await library.entries()) await library.remove(entry.id);
  });

  after(async () => {
    (await api()).controller.stop();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // Mocha runs a suite's own tests before its nested suites, so every step sits in a
  // nested suite to keep them in order.
  describe('opening zips', () => {
    it('opens walkthrough zips into its storage and lists them', async () => {
      const { library } = await api();
      await vscode.commands.executeCommand('codeWalkthroughs.openZip', undefined, [fixture(PR_ZIP), fixture(TOUR_ZIP)]);
      const entries = await library.entries();
      equal(
        entries.map((e) => e.id).sort(),
        ['clear-the-table-solution-1-one-fixed-nudge', 'robotics-basics-pr-6-frames-3d-and-motion'],
        'library ids',
      );
      const audio = await library.readFile('robotics-basics-pr-6-frames-3d-and-motion', '02-one-turn-four-ways.mp3');
      ok(audio && audio.length > 1000, 'the MP3 was stored');
    });
  });

  describe('a code tour', () => {
    it('opens the slide file at the pinned commit and highlights its lines', async () => {
      const { library, controller, navigator } = await api();
      await controller.start((await library.get('clear-the-table-solution-1-one-fixed-nudge'))!);
      await controller.goTo(4, false);
      const highlight = await waitFor('slide 5 highlight', () => navigator.highlight);
      ok(highlight.uri.includes('/7fdba598590d77542ff4d998f6e8c7120db27b81/v5-pick-glasses/04-clear-the-table/bench/contract.py'), `opened ${highlight.uri}`);
      equal(highlight.lines, { start: 58, end: 84 }, 'slide 5 lines');
      const editor = await waitFor('the contract.py editor', () => editorFor(highlight.uri));
      ok(editor.document.lineCount >= 84, 'the file was fetched from GitHub');
      ok(editor.document.lineAt(57).text.length > 0, 'line 58 has code');
      await waitFor('line 58 on screen', () => showsLine(editor, 58));
      equal(vscode.window.activeTextEditor?.document.uri.scheme, 'code-walkthrough', 'the slide is the active editor');
    });

    it('moves within the same file without opening another editor', async () => {
      const { controller, navigator } = await api();
      await controller.goTo(2, false);
      const first = await waitFor('slide 3', () => navigator.highlight?.lines.start === 3 && navigator.highlight);
      await controller.goTo(3, false);
      const second = await waitFor('slide 4', () => navigator.highlight?.lines.start === 28 && navigator.highlight);
      equal(second.uri, first.uri, 'same README.md document');
      await waitFor('line 28 on screen', () => showsLine(editorFor(second.uri)!, 28));
    });

    it('goes to the next slide when the audio ends in Auto, and stays in Manual', async () => {
      const { controller } = await api();
      await controller.receive({ type: 'settings', autoplay: true });
      await controller.goTo(5, true);
      await controller.slideEnded();
      equal(controller.current?.index, 6, 'autoplay moved on');
      // It plays on, unless the test VS Code refused to start audio without a click (see the audio test).
      ok(controller.current?.playing || controller.state().notice === PRESS_PLAY, 'and kept playing');
      await controller.receive({ type: 'settings', autoplay: false });
      await controller.slideEnded();
      equal(controller.current?.index, 6, 'manual stays');
      equal(controller.current?.playing, false, 'and stops');
      await controller.receive({ type: 'settings', autoplay: true });
    });
  });

  describe('a PR review', () => {
    const base = 'c6663d697a5cd5e121cb78fb16393ae1f6fb5d90';
    const head = 'd0a2e1b1c5b9d8f0d6a44da6838ec4b653296073';

    it('opens the diff from the merge base to the head and highlights new lines', async () => {
      const { library, controller, navigator } = await api();
      await controller.receive({ type: 'settings', diffView: 'split' });
      await controller.start((await library.get('robotics-basics-pr-6-frames-3d-and-motion'))!);
      equal(navigator.highlight, undefined, 'the overview slide highlights nothing');
      await controller.goTo(1, false);
      const highlight = await waitFor('slide 2 highlight', () => navigator.highlight);
      ok(highlight.uri.includes(`/${head}/code/src/frames_3d/orientation.py`), `new side is the head: ${highlight.uri}`);
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      ok(tab?.input instanceof vscode.TabInputTextDiff, 'the active tab is a diff');
      const input = tab.input as vscode.TabInputTextDiff;
      ok(input.original.path.includes(`/${base}/`), 'left side is the merge base');
      ok(input.modified.path.includes(`/${head}/`), 'right side is the head');
      const editor = await waitFor('the head editor', () => editorFor(highlight.uri));
      await waitFor('line 101 on screen', () => showsLine(editor, 101));
      // orientation.py is new in this PR, so the base side is empty.
      const original = await waitFor('the base editor', () => editorFor(input.original.toString()));
      equal(original.document.getText(), '', 'an added file has an empty old side');
    });

    it('scrolls a changed file to the slide when its diff first opens, not to the first change', async () => {
      const { controller, navigator } = await api();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await controller.goTo(6, false);
      // kinematics.py changed in several places; the slide is new lines 509–554, far below the first change.
      const highlight = await waitFor('slide 7 highlight', () => navigator.highlight?.lines.start === 509 && navigator.highlight);
      const editor = await waitFor('the head editor', () => editorFor(highlight.uri));
      // Give VS Code time to finish comparing the files, when it would jump to the first change.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      ok(showsLine(editor, 520), `lines 509–554 are on screen (showing ${JSON.stringify(editor.visibleRanges[0])})`);
      const original = vscode.window.visibleTextEditors.find((e) => e.document.uri.path.includes(`/${base}/docs/diagrams/kinematics.py`));
      ok(original && original.document.lineCount > 300, 'the old side shows the file before the PR');
    });

    it('highlights removed lines on the old side in split view', async () => {
      const { controller, navigator } = await api();
      await controller.goTo(7, false);
      const highlight = await waitFor('slide 8 highlight', () => navigator.highlight?.lines.start === 480 && navigator.highlight);
      ok(highlight.uri.includes(`/${base}/docs/01_robotics-intro/03_arm/01_overview.md`), `old side is the base: ${highlight.uri}`);
      const editor = await waitFor('the base editor', () => editorFor(highlight.uri));
      await waitFor('line 480 on screen', () => showsLine(editor, 480));
    });

    it('switches the diff to unified and back', async () => {
      const { controller, navigator } = await api();
      await controller.receive({ type: 'settings', diffView: 'unified' });
      equal(vscode.workspace.getConfiguration('diffEditor').get('renderSideBySide'), false, 'inline diff');
      equal(controller.state().diffView, 'unified', 'player state');
      await controller.goTo(5, false);
      const highlight = await waitFor('slide 6 highlight', () => navigator.highlight?.lines.start === 125 && navigator.highlight);
      const editor = await waitFor('the head editor in inline view', () => editorFor(highlight.uri));
      await waitFor('line 125 on screen', () => showsLine(editor, 125));
    });

    it('shows removed lines in the unified diff', async () => {
      const { controller, navigator } = await api();
      await controller.goTo(7, false);
      await waitFor('slide 8', () => navigator.highlight?.lines.start === 480);
      // One column: the removed lines are drawn in the new file between new lines 478 and 479
      // ("## 6. Making the arm bigger"); the editor puts line 478 at the top.
      const revealed = await waitFor('the scroll position', () => navigator.revealed);
      ok(revealed.uri.includes(`/${head}/docs/01_robotics-intro/03_arm/01_overview.md`), `scrolled the new file: ${revealed.uri}`);
      const editor = editorFor(revealed.uri)!;
      equal(editor.document.lineAt(revealed.line).text, '## 6. Making the arm bigger', 'the line after the removed block');
      // Near the top: sticky headings can cover the first few lines.
      await waitFor('the line above the block at the top', () => {
        const top = editor.visibleRanges[0]?.start.line;
        return top !== undefined && top >= revealed.line - 6 && top <= revealed.line - 1;
      });
      await controller.receive({ type: 'settings', diffView: 'split' });
      equal(vscode.workspace.getConfiguration('diffEditor').get('renderSideBySide'), true, 'side by side again');
    });

    it('loads the slide audio in the Player view, and plays it or asks for a click', async () => {
      const { controller } = await api();
      await controller.goTo(2, true);
      // The webview reports the MP3's length once it has decoded it.
      const { duration } = await waitFor('the audio to load', () => controller.progress.duration > 0 && controller.progress, 30_000).catch(() => {
        throw new Error(`The audio did not load: ${controller.state().notice ?? 'no error reported'}`);
      });
      ok(duration > 25 && duration < 40, `slide 3 audio is about 31s long (got ${duration})`);
      // Chromium starts audio only after a click in the Player, and nothing clicks here, so the
      // Player either plays (where autoplay is allowed) or asks for the click. The UI test clicks.
      await waitFor('the clock to move, or the press-play notice', () => controller.progress.currentTime > 1 || controller.state().notice === PRESS_PLAY, 30_000);
    });
  });

  describe('removing', () => {
    it('removes a walkthrough from storage', async () => {
      const { library } = await api();
      await library.remove('clear-the-table-solution-1-one-fixed-nudge');
      equal(
        (await library.entries()).map((e) => e.id),
        ['robotics-basics-pr-6-frames-3d-and-motion'],
        'one walkthrough left',
      );
    });
  });
});
