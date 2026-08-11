import { app, globalShortcut, ipcMain, Tray, BrowserWindow, Menu, nativeImage, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createOrchestrator } from '../orchestrator';
import { startReminderPolling } from '../orchestrator/scheduler';

let tray: Tray | null = null;
let window: BrowserWindow | null = null;
let isQuitting = false;

function getAppIcon() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  return nativeImage.createEmpty();
}

function positionTopRight() {
  if (!window) return;
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: workWidth, x: workX, y: workY } = primaryDisplay.workArea;
    const x = Math.round(workX + workWidth - 150); // 130px orb width + 20px padding
    const y = Math.round(workY + 20); // 20px padding from top
    window.setPosition(x, y);
  } catch (err) {
    console.error('[Main] Failed to position window in top-right:', err);
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 130,
    height: 130,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  positionTopRight();
  window.loadFile(path.join(__dirname, '../../index.html'));

  window.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console]: ${message}`);
  });

  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window?.hide();
    }
  });

  window.on('closed', () => {
    window = null;
  });
}

function toggleWindow() {
  if (!window) {
    createWindow();
  }
  if (window?.isVisible()) {
    window.hide();
  } else {
    positionTopRight();
    window?.show();
    window?.focus();
    window?.webContents.send('window-shown');
  }
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  tray = new Tray(getAppIcon());
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Saira', click: toggleWindow },
    {
      label: 'Quit Saira',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip('Saira');
  tray.setContextMenu(contextMenu);
  tray.on('click', toggleWindow);

  createWindow();

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    toggleWindow();
  });

  const orchestrator = await createOrchestrator();
  startReminderPolling(orchestrator.tts);
});

app.on('window-all-closed', () => {
  // Keep running in system tray on Windows
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

import { io, type Socket } from 'socket.io-client';
import { config } from '../shared/config';

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(`http://localhost:${config.server.port}`);

    socket.on('connect', () => {
      console.log('[Main Socket Bridge] Connected to Orchestrator on port', config.server.port);
    });

    socket.on('transcript', (data) => {
      window?.webContents.send('transcript', data);
    });

    socket.on('response', (data) => {
      window?.webContents.send('response', data);
    });

    socket.on('error', (data) => {
      window?.webContents.send('error', data);
    });

    socket.on('connect_error', (err) => {
      console.error('[Main Socket Connection Error]:', err.message);
    });
  }
  return socket;
}

ipcMain.on('show-window', () => {
  if (window) {
    window.show();
    window.focus();
  }
});

ipcMain.on('hide-window', () => {
  window?.hide();
});

ipcMain.on('resize-to-orb', () => {
  if (window) {
    window.setResizable(true);
    window.setSize(130, 130, true);
    window.setResizable(false);
  }
});

ipcMain.on('resize-to-panel', () => {
  if (window) {
    window.setSize(130, 130, true);
    window.setResizable(false);
  }
});

ipcMain.on('send-audio', (_event, audio: ArrayBuffer) => {
  getSocket().emit('audio', Buffer.from(audio));
});

ipcMain.on('send-text', (_event, text: string) => {
  getSocket().emit('text', text);
});

ipcMain.on('stop-speech', () => {
  getSocket().emit('stop_speech');
});
