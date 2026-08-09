import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('assistant', {
  hideWindow: () => ipcRenderer.send('hide-window'),
  sendAudio: (audio: ArrayBuffer) => ipcRenderer.send('send-audio', audio),
  sendText: (text: string) => ipcRenderer.send('send-text', text),
  onTranscript: (cb: (data: { text: string }) => void) =>
    ipcRenderer.on('transcript', (_event, data) => cb(data)),
  onResponse: (cb: (response: { spoken?: string; display?: string }) => void) =>
    ipcRenderer.on('response', (_event, data) => cb(data)),
  onError: (cb: (error: { message: string }) => void) =>
    ipcRenderer.on('error', (_event, data) => cb(data)),
});
