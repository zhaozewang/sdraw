import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BackendManager } from './backendManager.js';
import { SdrawEditorProvider } from './sdrawEditorProvider.js';

let backendManager: BackendManager | undefined;

/**
 * Find the sdraw project root (the directory containing backend/ and frontend/).
 *
 * Search order:
 * 1. Workspace folders (if the user opened the sdraw repo)
 * 2. Relative to this extension's install path (dev mode: vscode-sdraw/ is inside the repo)
 */
function findProjectRoot(extensionPath: string): string | undefined {
  // Check workspace folders first
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const candidate = folder.uri.fsPath;
    if (
      fs.existsSync(path.join(candidate, 'backend', 'main.py')) &&
      fs.existsSync(path.join(candidate, 'frontend', 'package.json'))
    ) {
      return candidate;
    }
  }

  // Dev mode: extension lives at <repo>/vscode-sdraw/
  const parentDir = path.dirname(extensionPath);
  if (
    fs.existsSync(path.join(parentDir, 'backend', 'main.py')) &&
    fs.existsSync(path.join(parentDir, 'frontend', 'package.json'))
  ) {
    return parentDir;
  }

  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const projectRoot = findProjectRoot(context.extensionPath);

  if (!projectRoot) {
    vscode.window.showErrorMessage(
      'sDraw: Could not find the sdraw project (backend/main.py + frontend/). ' +
      'Open the sdraw repository folder in VS Code, or install the extension from within the repo.',
    );
    return;
  }

  backendManager = BackendManager.getInstance(projectRoot);

  // Register the custom editor for .sdraw files
  const editorProvider = new SdrawEditorProvider(backendManager);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SdrawEditorProvider.viewType,
      editorProvider,
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );

  // Command: create a new board
  context.subscriptions.push(
    vscode.commands.registerCommand('sdraw.newBoard', async () => {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        filters: { 'sDraw Board': ['sdraw'] },
        title: 'Create New sDraw Board',
      });
      if (!uri) { return; }

      // Write a minimal empty board JSON
      const board = {
        schema_version: 2,
        id: crypto.randomUUID(),
        name: path.basename(uri.fsPath, '.sdraw'),
        canvas: {
          width: 1920,
          height: 1080,
          infinite: true,
          background: '#ffffff',
          grid_enabled: false,
          grid_size: 20,
          grid_pattern: 'lines',
          snap_enabled: true,
          snap_size: 10,
        },
        elements: [],
        setup: { code: '', timeout: 120 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        app_version: '0.1.0',
      };

      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(JSON.stringify(board, null, 2)),
      );

      // Open the newly created board
      await vscode.commands.executeCommand('vscode.openWith', uri, SdrawEditorProvider.viewType);
    }),
  );

  // Command: show backend output
  context.subscriptions.push(
    vscode.commands.registerCommand('sdraw.showOutput', () => {
      backendManager?.outputChannel.show();
    }),
  );
}

export function deactivate(): void {
  backendManager?.dispose();
  backendManager = undefined;
}
