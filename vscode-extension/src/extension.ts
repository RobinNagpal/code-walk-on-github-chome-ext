// Code Walkthroughs for VS Code, vscode.dev and github.dev.
//
// Open a walkthrough zip (the code-walkthrough skill writes one next to each walkthrough)
// and it is copied into the extension's storage and listed in the Walkthroughs view.
// Starting one opens each slide's file at the pinned commit, or the PR's diff, highlights
// the slide's lines and plays the narration in the Player view.
import * as vscode from 'vscode';
import { Controller } from './controller.ts';
import { Library, type LibraryEntry } from './library.ts';
import { Navigator } from './navigator.ts';
import { PlayerView } from './playerView.ts';
import { GitHubSource, SCHEME } from './source.ts';

/** What tests reach through `extensions.getExtension(...).exports`. */
export interface Api {
  library: Library;
  controller: Controller;
  navigator: Navigator;
}

export function activate(context: vscode.ExtensionContext): Api {
  const library = new Library(vscode.Uri.joinPath(context.globalStorageUri, 'walkthroughs'));
  const navigator = new Navigator();
  const controller = new Controller(library, navigator, context.globalState);

  async function openZip(uri?: vscode.Uri, selected?: vscode.Uri[]): Promise<void> {
    // From the Explorer's context menu: the clicked file, or every selected one.
    let zips = selected?.length ? selected : uri ? [uri] : undefined;
    zips ??= await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Open Walkthrough',
      filters: { 'Walkthrough zip': ['zip'] },
    });
    for (const zip of zips ?? []) {
      try {
        const { entry, missingAudio } = await library.openZip(zip);
        const note = missingAudio.length ? ` ${missingAudio.length} slide(s) have no audio and will play silently.` : '';
        void vscode.window.showInformationMessage(`Added “${entry.walkthrough.title}”.${note}`, 'Start').then((choice) => {
          if (choice === 'Start') void controller.start(entry);
        });
      } catch (error) {
        void vscode.window.showErrorMessage(`Could not open ${zip.path.split('/').pop()}: ${(error as Error).message}`);
      }
    }
  }

  async function remove(entry: LibraryEntry): Promise<void> {
    const choice = await vscode.window.showWarningMessage(`Remove “${entry.walkthrough.title}”?`, { modal: true }, 'Remove');
    if (choice !== 'Remove') return;
    if (controller.current?.id === entry.id) controller.stop();
    await library.remove(entry.id);
  }

  context.subscriptions.push(
    navigator,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, new GitHubSource()),
    vscode.window.createTreeView('codeWalkthroughs.library', { treeDataProvider: library }),
    vscode.window.registerWebviewViewProvider(PlayerView.id, new PlayerView(context.extensionUri, controller), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('codeWalkthroughs.openZip', openZip),
    vscode.commands.registerCommand('codeWalkthroughs.start', (entry: LibraryEntry) => controller.start(entry)),
    vscode.commands.registerCommand('codeWalkthroughs.remove', remove),
    vscode.commands.registerCommand('codeWalkthroughs.playPause', () => controller.playPause()),
    vscode.commands.registerCommand('codeWalkthroughs.next', () => controller.next()),
    vscode.commands.registerCommand('codeWalkthroughs.previous', () => controller.previous()),
    vscode.commands.registerCommand('codeWalkthroughs.stop', () => controller.stop()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('diffEditor.renderSideBySide')) controller.sendState();
    }),
  );
  return { library, controller, navigator };
}

export function deactivate(): void {}
