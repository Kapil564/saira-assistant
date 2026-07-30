import { contextBridge, ipcRenderer } from 'electron';
import { io } from 'socket.io-client';

const socket = io('http://localhost:16123');

contextBridge.exposeInMainWorld('assistant', {
  hideWindow: () => ipcRenderer.send('hide-window'),
  sendAudio: (audio: ArrayBuffer) => socket.emit('audio', Buffer.from(audio)),
  onResponse: (cb: (response: { spoken?: string; display?: string; intent?: string }) => void) =>
    socket.on('response', cb),
});
