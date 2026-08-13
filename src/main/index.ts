import { app, globalShortcut, ipcMain, Tray, BrowserWindow, Menu, nativeImage, screen, powerMonitor } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Resolve the bundled assets directory across dev, packaged (asar), and portable builds.
 */
function assetsPath(): string {
  // Packaged app with electron-builder: resources/app/dist/main/index.js
  // __dirname -> resources/app/dist/main, two levels up -> resources/app
  const resourcesApp = path.join(__dirname, '..', '..');
  const candidateA = path.join(resourcesApp, 'assets');
  if (fs.existsSync(candidateA)) return candidateA;

  // Unpacked / non-asar / dev fallback
  const candidateB = path.join(__dirname, '..', '..', 'assets');
  if (fs.existsSync(candidateB)) return candidateB;

  // Electron resources dir fallback (for extraResources or unpacked assets)
  if (process.resourcesPath) {
    const candidateC = path.join(process.resourcesPath, 'assets');
    if (fs.existsSync(candidateC)) return candidateC;
  }

  // Final fallback to cwd (dev source tree)
  return path.join(process.cwd(), 'assets');
}
import { createOrchestrator } from '../orchestrator';
import { startReminderPolling, checkAndFireDueReminders } from '../orchestrator/scheduler';
import type { TTSProvider } from '../providers/tts';

let tray: Tray | null = null;
let window: BrowserWindow | null = null;
let isQuitting = false;
let orchestratorTts: TTSProvider | null = null;

function getAppIcon() {
  const iconPath = path.join(assetsPath(), 'icon.png');
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

function isAutostartEnabled(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

function setAutostartEnabled(enable: boolean): boolean {
  try {
    app.setLoginItemSettings({
      openAtLogin: enable,
      path: process.execPath,
      args: ['--hidden'],
    });
    updateTrayMenu();
    return isAutostartEnabled();
  } catch (err) {
    console.error('[Main] Failed to set login item settings:', err);
    return false;
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const autostartActive = isAutostartEnabled();
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Saira', click: toggleWindow },
    {
      label: 'Autostart on Login',
      type: 'checkbox',
      checked: autostartActive,
      click: (item) => {
        setAutostartEnabled(item.checked);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Saira',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
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

  window.webContents.on('console-message', (_event, _level, message) => {
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
  // 1. Configure System Tray
  tray = new Tray(getAppIcon());
  tray.setToolTip('Saira');
  tray.on('click', toggleWindow);
  updateTrayMenu();

  // 2. Default register autostart if not configured
  if (!isAutostartEnabled()) {
    setAutostartEnabled(true);
  }

  // 3. Create Main UI Window
  createWindow();

  // If launching normally (without --hidden), show UI window
  const startHidden = process.argv.includes('--hidden');
  if (!startHidden) {
    toggleWindow();
  } else {
    console.log('[Main] Saira launched silently into System Tray (--hidden).');
  }

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    toggleWindow();
  });

  // 4. Initialize Orchestrator & Background Scheduler
  const orchestrator = await createOrchestrator();
  orchestratorTts = orchestrator.tts;
  startReminderPolling(orchestrator.tts);

  // 5. Power Monitor Handlers (Sleep/Wake & Screen Unlock)
  powerMonitor.on('resume', () => {
    console.log('[Main PowerMonitor] System resumed from sleep. Scanning for overdue reminders...');
    if (orchestratorTts) {
      checkAndFireDueReminders(orchestratorTts);
    }
  });

  powerMonitor.on('unlock-screen', () => {
    console.log('[Main PowerMonitor] Screen unlocked. Scanning for overdue reminders...');
    if (orchestratorTts) {
      checkAndFireDueReminders(orchestratorTts);
    }
  });
});

app.on('window-all-closed', () => {
  // Keep process running in system tray on Windows
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

import { getOllamaStatus, pullLocalModel } from '../providers/ollama-manager';
import { getFullSetupStatus, runFullSetupSequence } from '../providers/setup-manager';
import { setSelectedModelName, downloadWhisperModel } from '../providers/whisper-manager';
import { setSelectedVoiceName, downloadPiperVoice } from '../providers/piper-manager';

ipcMain.handle('autostart:get', () => {
  return isAutostartEnabled();
});

ipcMain.handle('autostart:set', (_event, enable: boolean) => {
  return setAutostartEnabled(enable);
});

ipcMain.handle('ollama:status', async () => {
  return await getOllamaStatus();
});

ipcMain.handle('ollama:pull', async () => {
  return await pullLocalModel();
});

ipcMain.handle('setup:status', async () => {
  return await getFullSetupStatus();
});

ipcMain.handle('setup:run', async () => {
  return await runFullSetupSequence();
});

ipcMain.handle('stt:set-model', async (_event, modelName: string) => {
  setSelectedModelName(modelName);
  return await downloadWhisperModel(modelName);
});

ipcMain.handle('tts:set-voice', async (_event, voiceName: string) => {
  setSelectedVoiceName(voiceName);
  return await downloadPiperVoice(voiceName);
});



