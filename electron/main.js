const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow = null;
let backendProcess = null;
let backendPort = 8000;

/** Find an available port starting from `start`. */
function findPort(start = 8000) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(start, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // Port in use, try next
      resolve(findPort(start + 1));
    });
  });
}

/** Determine the path to the backend executable or script. */
function getBackendCommand() {
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    // In packaged mode, look for PyInstaller-built binary next to the app
    const platform = process.platform;
    const ext = platform === 'win32' ? '.exe' : '';
    const binaryName = `sdraw-backend${ext}`;

    // macOS: inside .app/Contents/Resources
    // Windows: next to the exe in resources
    const resourcesPath = process.resourcesPath;
    const binaryPath = path.join(resourcesPath, 'backend', binaryName);

    return { cmd: binaryPath, args: [], cwd: path.join(resourcesPath, 'backend') };
  } else {
    // Dev mode: run the Python script directly
    const backendDir = path.join(__dirname, '..', 'backend');
    const isWin = process.platform === 'win32';

    // Try venv first
    const venvPython = isWin
      ? path.join(backendDir, 'venv', 'Scripts', 'python.exe')
      : path.join(backendDir, 'venv', 'bin', 'python');

    const fs = require('fs');
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : (isWin ? 'python' : 'python3');

    return { cmd: pythonCmd, args: ['main.py'], cwd: backendDir };
  }
}

/** Start the Python backend. */
async function startBackend() {
  backendPort = await findPort(8000);
  const { cmd, args, cwd } = getBackendCommand();

  console.log(`Starting backend: ${cmd} ${args.join(' ')} (port ${backendPort})`);

  const env = {
    ...process.env,
    SDRAW_PORT: String(backendPort),
    SDRAW_WORKSPACE: path.join(app.getPath('userData'), 'workspace'),
  };

  backendProcess = spawn(cmd, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
  });

  backendProcess.on('exit', (code) => {
    console.log(`Backend exited with code ${code}`);
    backendProcess = null;
  });

  // Wait for the backend to be ready
  await waitForBackend(backendPort, 30000);
}

/** Poll the health endpoint until the backend responds. */
function waitForBackend(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const http = require('http');
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Backend startup timed out'));
      } else {
        setTimeout(check, 300);
      }
    };

    check();
  });
}

function getIconPath() {
  const ext = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ext);
  }
  return path.join(__dirname, '..', 'assets', ext);
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

/** Build the application menu (macOS-style). */
function buildAppMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: `About ${app.name}` },
        { type: 'separator' },
        {
          label: 'Preferences\u2026',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-preferences');
            }
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.executeJavaScript(
                'document.dispatchEvent(new CustomEvent("electron-save"))'
              );
            }
          },
        },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [
          {
            label: 'Preferences\u2026',
            accelerator: 'CmdOrCtrl+,',
            click: () => {
              if (mainWindow) {
                mainWindow.webContents.send('show-preferences');
              }
            },
          },
          { type: 'separator' },
          { role: 'quit' },
        ]),
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' },
        ] : [
          { role: 'close' },
        ]),
      ],
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'sDraw Documentation',
          click: async () => {
            await shell.openExternal('https://github.com/zhaozewang/sdraw');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'sDraw',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: getPreloadPath(),
    },
    // Use default title bar on all platforms to avoid traffic light overlap
    titleBarStyle: 'default',
  });

  mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend...');
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t']);
    } else {
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }
}

// IPC handlers
ipcMain.handle('get-app-version', () => app.getVersion());

app.whenReady().then(async () => {
  try {
    buildAppMenu();
    await startBackend();
    createWindow();
  } catch (err) {
    console.error('Failed to start:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('before-quit', () => {
  stopBackend();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
