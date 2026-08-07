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

ipcMain.on('hide-window', () => {
  window?.hide();
});
