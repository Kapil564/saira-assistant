import { app, globalShortcut, ipcMain, Tray, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { createOrchestrator } from '../orchestrator';
import { startReminderPolling } from '../orchestrator/scheduler';

let tray: Tray | null = null;
let window: BrowserWindow | null = null;

function createWindow() {
  window = new BrowserWindow({
    width: 420,
    height: 680,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, '../../index.html'));

  window.on('blur', () => {
    window?.hide();
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
    window?.show();
    window?.focus();
  }
}

app.whenReady().then(async () => {
  tray = new Tray(path.join(__dirname, '../../assets/icon.png'));
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
