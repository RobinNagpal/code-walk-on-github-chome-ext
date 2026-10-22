// Shared by the suites that run inside VS Code (desktop and web). No Node modules here:
// the same bundle runs in a browser worker.
import * as vscode from 'vscode';
import type { Api } from '../../src/extension.ts';

export const EXTENSION_ID = 'robinnagpal.code-walkthroughs';
export const PR_ZIP = 'robotics-basics-pr-6-frames-3d-and-motion.zip';
export const TOUR_ZIP = 'clear-the-table-solution-1-one-fixed-nudge.zip';

export async function api(): Promise<Api> {
  const extension = vscode.extensions.getExtension<Api>(EXTENSION_ID);
  if (!extension) throw new Error(`${EXTENSION_ID} is not loaded`);
  return extension.activate();
}

/** A fixture zip in the opened folder (the test runners open a folder holding them). */
export function fixture(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('The tests need a folder with the fixture zips open');
  return vscode.Uri.joinPath(folder.uri, name);
}

export async function waitFor<T>(what: string, check: () => T | undefined | false, timeoutMs = 20_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function ok(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export function editorFor(uri: string): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri);
}

/** Whether the editor shows the start of the range on screen. */
export function showsLine(editor: vscode.TextEditor, line: number): boolean {
  return editor.visibleRanges.some((range) => range.start.line <= line - 1 && line - 1 <= range.end.line);
}
