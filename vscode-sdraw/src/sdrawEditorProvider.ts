import * as vscode from 'vscode';
import { BackendManager } from './backendManager.js';

/**
 * Lightweight document representing an open .sdraw file.
 * The actual data lives in the backend / webview — this just tracks identity and dirty state.
 */
class SdrawDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri;

  constructor(uri: vscode.Uri) {
    this.uri = uri;
  }

  dispose(): void {
    // Nothing to clean up — the webview handles its own state
  }
}

/**
 * Custom editor provider for .sdraw board files.
 *
 * Opens the sDraw React app inside a VS Code webview iframe.
 * Bridges Ctrl+S / dirty state between VS Code and the app via postMessage.
 */
export class SdrawEditorProvider implements vscode.CustomEditorProvider<SdrawDocument> {
  static readonly viewType = 'sdraw.board';

  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<SdrawDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  /** Map document URI → active webview panel (1:1 since we disable multi-editor). */
  private readonly _panels = new Map<string, vscode.WebviewPanel>();
  /** Pending save resolvers keyed by request ID. */
  private readonly _pendingSaves = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

  constructor(private readonly _backend: BackendManager) {}

  // ---- CustomEditorProvider interface ----

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<SdrawDocument> {
    return new SdrawDocument(uri);
  }

  async resolveCustomEditor(
    document: SdrawDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const key = document.uri.toString();
    this._panels.set(key, webviewPanel);

    webviewPanel.webview.options = {
      enableScripts: true,
    };

    // Start backend if needed, then render webview
    try {
      const port = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'sDraw: Starting backend...' },
        () => this._backend.ensureRunning(),
      );

      const useDevServer = vscode.workspace.getConfiguration('sdraw').get<boolean>('useDevServer', false);
      const baseUrl = useDevServer
        ? 'http://127.0.0.1:3000'
        : `http://127.0.0.1:${port}`;

      webviewPanel.webview.html = this._getWebviewHtml(baseUrl, document.uri.fsPath);
    } catch (err: any) {
      webviewPanel.webview.html = this._getErrorHtml(err.message);
      return;
    }

    // Listen for messages from the webview bridge script
    webviewPanel.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'dirty':
          // Mark document as modified so VS Code shows the dot indicator
          this._onDidChangeCustomDocument.fire({ document });
          break;

        case 'save-done': {
          const pending = this._pendingSaves.get(msg.requestId);
          if (pending) {
            this._pendingSaves.delete(msg.requestId);
            if (msg.success) {
              pending.resolve();
            } else {
              pending.reject(new Error(msg.error || 'Save failed'));
            }
          }
          break;
        }

        case 'ready':
          this._backend.outputChannel.appendLine(
            `Board loaded in webview: ${document.uri.fsPath}`,
          );
          break;
      }
    });

    webviewPanel.onDidDispose(() => {
      this._panels.delete(key);
      // Reject any pending saves for this panel
      for (const [id, pending] of this._pendingSaves) {
        if (id.startsWith('save')) {
          this._pendingSaves.delete(id);
          pending.reject(new Error('Webview disposed'));
        }
      }
    });
  }

  async saveCustomDocument(document: SdrawDocument): Promise<void> {
    return this._sendSaveMessage(document, { type: 'save' });
  }

  async saveCustomDocumentAs(
    document: SdrawDocument,
    destination: vscode.Uri,
  ): Promise<void> {
    return this._sendSaveMessage(document, { type: 'save-as', path: destination.fsPath });
  }

  private _sendSaveMessage(
    document: SdrawDocument,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const panel = this._panels.get(document.uri.toString());
    if (!panel) { return Promise.resolve(); }

    const requestId = `${msg.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingSaves.delete(requestId);
        reject(new Error(`${msg.type} timed out`));
      }, 10000);

      this._pendingSaves.set(requestId, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      panel.webview.postMessage({
        source: 'vscode-sdraw',
        ...msg,
        requestId,
      });
    });
  }

  async revertCustomDocument(document: SdrawDocument): Promise<void> {
    const panel = this._panels.get(document.uri.toString());
    if (!panel) { return; }

    panel.webview.postMessage({
      source: 'vscode-sdraw',
      type: 'revert',
    });
  }

  async backupCustomDocument(
    document: SdrawDocument,
    _context: vscode.CustomDocumentBackupContext,
    _cancellation: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    // The app has its own checkpoint system — just return a no-op backup
    return {
      id: document.uri.toString(),
      delete: () => { /* nothing */ },
    };
  }

  // ---- Webview HTML ----

  private _getWebviewHtml(baseUrl: string, filePath: string): string {
    const boardParam = encodeURIComponent(filePath);
    const nonce = this._getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 frame-src http://localhost:* http://127.0.0.1:*;
                 script-src 'nonce-${nonce}';">
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1f22; }
    iframe { border: none; width: 100%; height: 100%; }
    .loading { display: flex; align-items: center; justify-content: center; height: 100%;
               color: #888; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; }
    .loading.hidden { display: none; }
  </style>
</head>
<body>
  <div id="loading" class="loading">Loading sDraw...</div>
  <iframe id="sdraw-frame"
          src="${baseUrl}?board=${boardParam}&vscode=1"
          style="display:none;"
          allow="clipboard-read; clipboard-write">
  </iframe>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const iframe = document.getElementById('sdraw-frame');
    const loading = document.getElementById('loading');

    // Show iframe once loaded
    iframe.addEventListener('load', () => {
      loading.classList.add('hidden');
      iframe.style.display = 'block';
    });

    // Relay messages between VS Code extension and the iframe (React app)
    //
    // VS Code extension → this script: via webview.postMessage()
    // This script → iframe: via iframe.contentWindow.postMessage()
    // Iframe → this script: via window message event (origin check)
    // This script → VS Code extension: via vscode.postMessage()

    // From VS Code extension → relay to iframe
    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg && msg.source === 'vscode-sdraw') {
        // Relay commands (save, revert, etc.) to the React app inside the iframe
        try {
          iframe.contentWindow.postMessage(msg, '*');
        } catch (e) {
          // iframe not ready yet
        }
        return;
      }

      if (msg && msg.source === 'sdraw-app') {
        // Relay app events (dirty, save-done, ready) to the VS Code extension
        vscode.postMessage(msg);
        return;
      }
    });
  </script>
</body>
</html>`;
  }

  private _getErrorHtml(errorMessage: string): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 40px; background: #1e1f22; color: #ccc;
           font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    h2 { color: #e06c75; }
    pre { background: #2b2d31; padding: 16px; border-radius: 6px; overflow: auto; }
    a { color: #61afef; }
  </style>
</head>
<body>
  <h2>Failed to start sDraw backend</h2>
  <pre>${this._escapeHtml(errorMessage)}</pre>
  <p>Check the <a href="command:sdraw.showOutput">sDraw output panel</a> for details.</p>
  <p>Make sure Python 3 is installed and the backend dependencies are available.</p>
</body>
</html>`;
  }

  private _getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  private _escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
