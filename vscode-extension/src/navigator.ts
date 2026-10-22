// Opens a slide's file (or a PR file's diff), scrolls to its lines and highlights them.
// The highlight is a decoration, so it is reapplied when VS Code recreates the editor
// (switching tabs, or a diff changing between inline and side by side).
import * as vscode from 'vscode';
import { newLineAfter } from './core/lineMap.ts';
import type { SlideView } from './core/slides.ts';
import type { LineRange } from './core/walkthrough.ts';
import { sourceUri } from './source.ts';

/** What is highlighted now; tests read it. */
export interface Highlight {
  uri: string;
  lines: LineRange;
}

/** Where the editor last scrolled to, in the editor the viewer sees; tests read it. */
export interface Revealed {
  uri: string;
  line: number;
}

const EDITOR_WAIT_MS = 5000;

export class Navigator implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('codeWalkthroughs.lineHighlight'),
    overviewRulerColor: new vscode.ThemeColor('codeWalkthroughs.lineHighlight'),
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  private readonly subscriptions: vscode.Disposable[];
  highlight: Highlight | undefined;
  revealed: Revealed | undefined;

  constructor() {
    this.subscriptions = [vscode.window.onDidChangeVisibleTextEditors((editors) => this.decorate(editors))];
  }

  /**
   * Opens what the slide shows. `inline` says a diff is shown in one column, where removed
   * lines have no editor of their own. Throws when the file can't be fetched.
   */
  async show(view: SlideView, inline = false): Promise<void> {
    if (view.kind === 'none') {
      this.clear();
      return;
    }
    let target: vscode.Uri;
    if (view.kind === 'file') {
      target = sourceUri(view.source);
      await vscode.window.showTextDocument(target, { preview: true, preserveFocus: true });
    } else {
      const base = sourceUri(view.base);
      const head = sourceUri(view.head);
      target = view.side === 'old' ? base : head;
      if (!this.visibleEditor(base) || !this.visibleEditor(head)) {
        // A newly opened diff jumps to its first change once VS Code has compared the files,
        // unless it opens with a selection; selecting the slide's place keeps it there.
        const line = view.lines ? await this.headLine(view, view.lines) : 1;
        const selection = new vscode.Range(line - 1, 0, line - 1, 0);
        await vscode.commands.executeCommand('vscode.diff', base, head, view.title, { preview: true, preserveFocus: true, selection });
      }
    }
    this.highlight = view.lines ? { uri: target.toString(), lines: view.lines } : undefined;
    this.revealed = undefined;
    if (view.kind === 'diff' && view.side === 'old' && inline) {
      // One column: the removed lines are drawn inside the new file, above the line after them.
      const head = await this.waitForEditor(sourceUri(view.head));
      if (head && view.lines) {
        // Put the unchanged line just above the removed block at the top, so the block reads
        // down from its start however long it is.
        const above = Math.max(1, (await this.headLine(view, view.lines)) - 1);
        head.revealRange(new vscode.Range(above - 1, 0, above - 1, 0), vscode.TextEditorRevealType.AtTop);
        this.revealed = { uri: head.document.uri.toString(), line: above };
      }
      return;
    }
    const editor = await this.waitForEditor(target, view.kind === 'diff' ? sourceUri(view.head) : undefined);
    this.decorate(vscode.window.visibleTextEditors);
    if (editor && view.lines) this.reveal(editor, view.lines);
  }

  /** Scrolls back to the current highlight, for when the viewer scrolled away. */
  revealAgain(): void {
    const last = this.revealed;
    const editor = last && this.visibleEditor(vscode.Uri.parse(last.uri));
    if (editor) editor.revealRange(new vscode.Range(last.line - 1, 0, last.line - 1, 0), vscode.TextEditorRevealType.InCenter);
  }

  clear(): void {
    this.highlight = undefined;
    this.decorate(vscode.window.visibleTextEditors);
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.decoration.dispose();
  }

  /** Where a diff slide's lines are in the new file: the lines themselves, or where removed lines sit. */
  private async headLine(view: Extract<SlideView, { kind: 'diff' }>, lines: LineRange): Promise<number> {
    if (view.side === 'new') return lines.start;
    const [base, head] = await Promise.all([
      vscode.workspace.openTextDocument(sourceUri(view.base)),
      vscode.workspace.openTextDocument(sourceUri(view.head)),
    ]);
    return newLineAfter(base.getText(), head.getText(), lines.start);
  }

  private visibleEditor(uri: vscode.Uri): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
  }

  /**
   * The editor showing `uri`, once VS Code has opened it. An inline diff has no editor for
   * the old side; then the new side's editor (`fallback`) is used, since it shows the
   * removed lines in place.
   */
  private async waitForEditor(uri: vscode.Uri, fallback?: vscode.Uri): Promise<vscode.TextEditor | undefined> {
    const started = Date.now();
    while (Date.now() - started < EDITOR_WAIT_MS) {
      const editor = this.visibleEditor(uri);
      if (editor) return editor;
      const other = fallback && this.visibleEditor(fallback);
      if (other && Date.now() - started > 500) return other;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  }

  private decorate(editors: readonly vscode.TextEditor[]): void {
    for (const editor of editors) {
      const lines = this.highlight && editor.document.uri.toString() === this.highlight.uri ? this.highlight.lines : undefined;
      editor.setDecorations(this.decoration, lines ? [this.range(editor, lines)] : []);
    }
  }

  private range(editor: vscode.TextEditor, lines: LineRange): vscode.Range {
    const last = Math.max(0, editor.document.lineCount - 1);
    return new vscode.Range(Math.min(lines.start - 1, last), 0, Math.min(lines.end - 1, last), Number.MAX_SAFE_INTEGER);
  }

  private reveal(editor: vscode.TextEditor, lines: LineRange): void {
    const visible = editor.visibleRanges[0];
    const height = visible ? visible.end.line - visible.start.line : 30;
    // Centre a range that fits; otherwise start at its top.
    const fits = lines.end - lines.start < height * 0.8;
    editor.revealRange(this.range(editor, lines), fits ? vscode.TextEditorRevealType.InCenter : vscode.TextEditorRevealType.AtTop);
    this.revealed = { uri: editor.document.uri.toString(), line: fits ? Math.round((lines.start + lines.end) / 2) : lines.start };
  }
}
