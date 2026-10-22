// The walkthroughs opened from zips, kept in the extension's global storage (on disk in
// desktop VS Code, in the browser's storage on vscode.dev and github.dev):
//   <globalStorage>/walkthroughs/<id>/walkthrough.json, <slide-id>.mp3 …
// and shown in the Walkthroughs view.
import * as vscode from 'vscode';
import { formatTime, totalDuration, walkthroughType, WalkthroughType, WALKTHROUGH_FILE, type Walkthrough } from './core/walkthrough.ts';
import { unpackWalkthrough } from './core/zip.ts';

export interface LibraryEntry {
  id: string;
  walkthrough: Walkthrough;
}

export class Library implements vscode.TreeDataProvider<LibraryEntry> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private cache: Promise<LibraryEntry[]> | undefined;

  constructor(private readonly root: vscode.Uri) {}

  entries(): Promise<LibraryEntry[]> {
    this.cache ??= this.load();
    return this.cache;
  }

  async get(id: string): Promise<LibraryEntry | undefined> {
    return (await this.entries()).find((e) => e.id === id);
  }

  /** Copies a walkthrough zip into storage, replacing one with the same id. */
  async openZip(zip: vscode.Uri): Promise<{ entry: LibraryEntry; missingAudio: string[] }> {
    const { walkthrough, files, missingAudio } = unpackWalkthrough(await vscode.workspace.fs.readFile(zip));
    const folder = vscode.Uri.joinPath(this.root, walkthrough.id);
    await vscode.workspace.fs.delete(folder, { recursive: true, useTrash: false }).then(undefined, () => {});
    await vscode.workspace.fs.createDirectory(folder);
    for (const [name, data] of files) await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, name), data);
    this.refresh();
    return { entry: { id: walkthrough.id, walkthrough }, missingAudio };
  }

  async remove(id: string): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.root, id), { recursive: true, useTrash: false });
    this.refresh();
  }

  /** A file of a stored walkthrough, or undefined when it is missing. */
  async readFile(id: string, name: string): Promise<Uint8Array | undefined> {
    try {
      return await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.root, id, name));
    } catch {
      return undefined;
    }
  }

  refresh(): void {
    this.cache = undefined;
    this.changed.fire();
  }

  getTreeItem(entry: LibraryEntry): vscode.TreeItem {
    const w = entry.walkthrough;
    const isReview = walkthroughType(w) === WalkthroughType.PRReview;
    const item = new vscode.TreeItem(w.title, vscode.TreeItemCollapsibleState.None);
    item.id = entry.id;
    item.contextValue = 'walkthrough';
    item.iconPath = new vscode.ThemeIcon(isReview ? 'git-pull-request' : 'book');
    item.description = `${isReview ? `PR #${w.pullRequest?.number}` : 'Code tour'} · ${w.slides.length} slides · ${formatTime(totalDuration(w))}`;
    item.tooltip = new vscode.MarkdownString(
      `**${w.title}**\n\n${w.description ?? ''}\n\n${w.repo.owner}/${w.repo.name} @ \`${w.repo.commit.slice(0, 7)}\``,
    );
    item.command = { command: 'codeWalkthroughs.start', title: 'Start Walkthrough', arguments: [entry] };
    return item;
  }

  async getChildren(entry?: LibraryEntry): Promise<LibraryEntry[]> {
    return entry ? [] : this.entries();
  }

  private async load(): Promise<LibraryEntry[]> {
    let folders: [string, vscode.FileType][];
    try {
      folders = await vscode.workspace.fs.readDirectory(this.root);
    } catch {
      return [];
    }
    const entries: LibraryEntry[] = [];
    for (const [id, type] of folders) {
      if (type !== vscode.FileType.Directory) continue;
      const json = await this.readFile(id, WALKTHROUGH_FILE);
      if (!json) continue;
      try {
        entries.push({ id, walkthrough: JSON.parse(new TextDecoder().decode(json)) });
      } catch {
        // A damaged copy; opening its zip again replaces it.
      }
    }
    return entries.sort((a, b) => a.walkthrough.title.localeCompare(b.walkthrough.title));
  }
}
