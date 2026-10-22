// Serves files from GitHub at a commit as read-only documents:
//   code-walkthrough://github.com/<owner>/<repo>/<commit>/<file path>
// Public repositories are read from raw.githubusercontent.com with no sign-in. Private
// ones go through the GitHub API with VS Code's GitHub sign-in (built into github.dev).
// A file that doesn't exist at the commit (added or deleted in a PR) is served empty, so
// a diff shows it as wholly added or removed.
import * as vscode from 'vscode';
import { parseSourcePath, sourcePath, type SourceRef } from './core/slides.ts';

export const SCHEME = 'code-walkthrough';

export function sourceUri(ref: SourceRef): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, authority: 'github.com', path: sourcePath(ref) });
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export class GitHubSource implements vscode.TextDocumentContentProvider {
  private readonly files = new Map<string, Promise<string>>();
  private readonly publicRepos = new Map<string, Promise<boolean>>();

  provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = parseSourcePath(uri.path);
    if (!ref) return Promise.reject(new Error(`Not a walkthrough source: ${uri.toString()}`));
    const key = sourcePath(ref);
    let text = this.files.get(key);
    if (!text) {
      text = this.fetchFile(ref);
      // A failure is not cached, so opening the slide again retries.
      text.catch(() => this.files.delete(key));
      this.files.set(key, text);
    }
    return text;
  }

  private async fetchFile(ref: SourceRef): Promise<string> {
    const raw = await fetch(`https://raw.githubusercontent.com/${ref.owner}/${ref.name}/${ref.commit}/${encodePath(ref.path)}`);
    if (raw.ok) return raw.text();
    if (raw.status !== 404) throw new Error(`GitHub answered ${raw.status} for ${ref.path}`);
    // 404: either the file isn't there at this commit, or the repository is private.
    if (await this.isPublic(ref)) return '';
    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    const api = await fetch(
      `https://api.github.com/repos/${ref.owner}/${ref.name}/contents/${encodePath(ref.path)}?ref=${ref.commit}`,
      { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.github.raw' } },
    );
    if (api.ok) return api.text();
    if (api.status === 404) return '';
    throw new Error(`GitHub answered ${api.status} for ${ref.path}`);
  }

  private isPublic(ref: SourceRef): Promise<boolean> {
    const key = `${ref.owner}/${ref.name}`;
    let answer = this.publicRepos.get(key);
    if (!answer) {
      // 404 means private (or gone). Any other failure, such as the API's rate limit, is
      // treated as public, so a missing file shows as empty instead of asking to sign in.
      answer = fetch(`https://api.github.com/repos/${key}`).then(
        (response) => response.status !== 404,
        () => true,
      );
      this.publicRepos.set(key, answer);
    }
    return answer;
  }
}
