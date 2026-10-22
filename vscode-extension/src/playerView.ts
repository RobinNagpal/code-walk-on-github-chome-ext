// The Player view: a webview in the Code Walkthroughs side bar that plays the audio and
// holds the controls. It is kept alive while hidden, so the audio keeps playing.
import * as vscode from 'vscode';
import type { FromWebview, ToWebview } from './core/messages.ts';
import type { Controller } from './controller.ts';

export class PlayerView implements vscode.WebviewViewProvider {
  static readonly id = 'codeWalkthroughs.player';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: Controller,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    view.webview.html = this.html(view.webview, dist);
    view.webview.onDidReceiveMessage((message: FromWebview) => {
      if (message.type === 'ready') this.controller.attach((m: ToWebview) => void view.webview.postMessage(m));
      else void this.controller.receive(message);
    });
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, name));
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; media-src blob:;">
  <link rel="stylesheet" href="${asset('player.css')}">
  <title>Player</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${asset('player.js')}"></script>
</body>
</html>`;
  }
}
