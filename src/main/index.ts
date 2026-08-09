import { app, globalShortcut, ipcMain, Tray, BrowserWindow, Menu, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createOrchestrator } from '../orchestrator';
import { startReminderPolling } from '../orchestrator/scheduler';

let tray: Tray | null = null;
let window: BrowserWindow | null = null;

function getAppIcon() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  return nativeImage.createEmpty();
}

function createWindow() {
  window = new BrowserWindow({
    width: 450,
    height: 700,
    show: true,
    frame: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, '../../index.html'));

  window.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console]: ${message}`);
  });

  window.webContents.openDevTools({ mode: 'detach' });

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
    window?.show();
    window?.focus();
  }
}

app.whenReady().then(async () => {
  tray = new Tray(getAppIcon());
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Saira', click: toggleWindow },
    { label: 'Quit', click: () => app.quit() },
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
  // Keep running in tray on Windows
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

ipcMain.on('hide-window', () => {
  window?.hide();
});

ipcMain.on('send-audio', (_event, audio: ArrayBuffer) => {
  getSocket().emit('audio', Buffer.from(audio));
});

ipcMain.on('send-text', (_event, text: string) => {
  getSocket().emit('text', text);
});
