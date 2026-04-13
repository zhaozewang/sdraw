import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import * as http from 'http';

/**
 * Singleton that manages the FastAPI backend lifecycle.
 * Starts on first editor open, stops on extension deactivation.
 */
export class BackendManager {
  private static _instance: BackendManager | undefined;

  private _process: ChildProcess | undefined;
  private _port = 0;
  private _ready = false;
  private _starting: Promise<void> | undefined;
  private _outputChannel: vscode.OutputChannel;
  private _projectRoot: string;

  private constructor(projectRoot: string) {
    this._projectRoot = projectRoot;
    this._outputChannel = vscode.window.createOutputChannel('sDraw Backend');
  }

  static getInstance(projectRoot: string): BackendManager {
    if (!BackendManager._instance) {
      BackendManager._instance = new BackendManager(projectRoot);
    }
    return BackendManager._instance;
  }

  get port(): number {
    return this._port;
  }

  get ready(): boolean {
    return this._ready;
  }

  get outputChannel(): vscode.OutputChannel {
    return this._outputChannel;
  }

  /** Ensure the backend is running. Safe to call multiple times. */
  async ensureRunning(): Promise<number> {
    if (this._ready && this._process && !this._process.killed) {
      // Verify it's still responding
      try {
        await this._healthCheck(this._port, 2000);
        return this._port;
      } catch {
        // Backend died, restart it
        this._ready = false;
        this._process = undefined;
      }
    }

    if (this._starting) {
      await this._starting;
      return this._port;
    }

    this._starting = this._start();
    try {
      await this._starting;
    } finally {
      this._starting = undefined;
    }
    return this._port;
  }

  private async _start(): Promise<void> {
    // Check if an existing backend is already running on a known port
    const configPort = vscode.workspace.getConfiguration('sdraw').get<number>('backendPort', 0);
    if (configPort > 0) {
      try {
        await this._healthCheck(configPort, 2000);
        this._port = configPort;
        this._ready = true;
        this._outputChannel.appendLine(`Attached to existing backend on port ${configPort}`);
        return;
      } catch {
        // Not running, start it
      }
    }

    await this._ensureFrontendBuilt();

    this._port = configPort > 0 ? configPort : await this._findPort();
    const { cmd, args, cwd } = this._getBackendCommand();

    this._outputChannel.appendLine(`Starting backend: ${cmd} ${args.join(' ')} on port ${this._port}`);
    this._outputChannel.appendLine(`Working directory: ${cwd}`);

    const env = {
      ...process.env,
      SDRAW_PORT: String(this._port),
      SDRAW_WORKSPACE: path.join(this._projectRoot, 'workspace'),
    };

    this._process = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this._process.stdout?.on('data', (data: Buffer) => {
      this._outputChannel.append(data.toString());
    });

    this._process.stderr?.on('data', (data: Buffer) => {
      this._outputChannel.append(data.toString());
    });

    this._process.on('error', (err) => {
      this._outputChannel.appendLine(`Backend error: ${err.message}`);
      vscode.window.showErrorMessage(`sDraw backend failed to start: ${err.message}`);
      this._ready = false;
    });

    this._process.on('exit', (code) => {
      this._outputChannel.appendLine(`Backend exited with code ${code}`);
      this._ready = false;
      this._process = undefined;
    });

    await this._healthCheck(this._port, 30000);
    this._ready = true;
    this._outputChannel.appendLine(`Backend ready on port ${this._port}`);
  }

  private _getBackendCommand(): { cmd: string; args: string[]; cwd: string } {
    const backendDir = path.join(this._projectRoot, 'backend');
    const configPython = vscode.workspace.getConfiguration('sdraw').get<string>('pythonPath', '');

    if (configPython) {
      return { cmd: configPython, args: ['main.py'], cwd: backendDir };
    }

    // Try venv first
    const isWin = process.platform === 'win32';
    const venvPython = isWin
      ? path.join(backendDir, 'venv', 'Scripts', 'python.exe')
      : path.join(backendDir, 'venv', 'bin', 'python');

    const cmd = fs.existsSync(venvPython)
      ? venvPython
      : isWin ? 'python' : 'python3';

    return { cmd, args: ['main.py'], cwd: backendDir };
  }

  private async _ensureFrontendBuilt(): Promise<void> {
    const useDevServer = vscode.workspace.getConfiguration('sdraw').get<boolean>('useDevServer', false);
    if (useDevServer) {
      return; // User is running Vite dev server separately
    }

    const distDir = path.join(this._projectRoot, 'frontend', 'dist');
    const indexHtml = path.join(distDir, 'index.html');

    if (fs.existsSync(indexHtml)) {
      return; // Already built
    }

    // Need to build the frontend
    this._outputChannel.appendLine('Frontend not built. Building...');

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'sDraw: Building frontend...',
        cancellable: false,
      },
      () => this._buildFrontend()
    );
  }

  private _buildFrontend(): Promise<void> {
    return new Promise((resolve, reject) => {
      const frontendDir = path.join(this._projectRoot, 'frontend');

      // Install deps if needed
      const nodeModules = path.join(frontendDir, 'node_modules');
      if (!fs.existsSync(nodeModules)) {
        this._outputChannel.appendLine('Installing frontend dependencies...');
        const install = spawn('npm', ['install'], { cwd: frontendDir, shell: true });
        install.stdout?.on('data', (d: Buffer) => this._outputChannel.append(d.toString()));
        install.stderr?.on('data', (d: Buffer) => this._outputChannel.append(d.toString()));
        install.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`npm install failed with code ${code}`));
            return;
          }
          this._runBuild(frontendDir, resolve, reject);
        });
      } else {
        this._runBuild(frontendDir, resolve, reject);
      }
    });
  }

  private _runBuild(
    frontendDir: string,
    resolve: () => void,
    reject: (err: Error) => void
  ): void {
    this._outputChannel.appendLine('Running npm run build...');
    const build = spawn('npm', ['run', 'build'], { cwd: frontendDir, shell: true });
    build.stdout?.on('data', (d: Buffer) => this._outputChannel.append(d.toString()));
    build.stderr?.on('data', (d: Buffer) => this._outputChannel.append(d.toString()));
    build.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Frontend build failed with code ${code}`));
      } else {
        this._outputChannel.appendLine('Frontend build complete.');
        resolve();
      }
    });
  }

  private _findPort(): Promise<number> {
    // Let the OS assign an available port to avoid sequential/recursive search
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as net.AddressInfo).port;
        server.close(() => resolve(port));
      });
      server.on('error', () => reject(new Error('No available port found')));
    });
  }

  private _healthCheck(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        });
        req.on('error', retry);
        req.setTimeout(1000, () => {
          req.destroy();
          retry();
        });
      };

      const retry = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Backend health check timed out'));
        } else {
          setTimeout(check, 300);
        }
      };

      check();
    });
  }

  /** Install pip requirements if needed. */
  async ensureDeps(): Promise<void> {
    const backendDir = path.join(this._projectRoot, 'backend');
    const venvDir = path.join(backendDir, 'venv');

    if (!fs.existsSync(venvDir)) {
      this._outputChannel.appendLine('Creating Python venv...');
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('python3', ['-m', 'venv', 'venv'], { cwd: backendDir });
        proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`venv creation failed (${code})`))));
        proc.on('error', reject);
      });
    }

    const { cmd } = this._getBackendCommand();
    this._outputChannel.appendLine('Installing backend dependencies...');
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(cmd, ['-m', 'pip', 'install', '-q', '-r', 'requirements.txt'], {
        cwd: backendDir,
      });
      proc.stdout?.on('data', (d: Buffer) => this._outputChannel.append(d.toString()));
      proc.stderr?.on('data', (d: Buffer) => this._outputChannel.append(d.toString()));
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pip install failed (${code})`))));
      proc.on('error', reject);
    });
  }

  stop(): void {
    if (this._process && !this._process.killed) {
      this._outputChannel.appendLine('Stopping backend...');
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(this._process.pid), '/f', '/t']);
      } else {
        this._process.kill('SIGTERM');
      }
      this._process = undefined;
    }
    this._ready = false;
  }

  dispose(): void {
    this.stop();
    this._outputChannel.dispose();
    BackendManager._instance = undefined;
  }
}
