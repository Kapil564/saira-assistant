import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('assistant', {
  showWindow: () => ipcRenderer.send('show-window'),
  hideWindow: () => ipcRenderer.send('hide-window'),
  resizeToOrb: () => ipcRenderer.send('resize-to-orb'),
  resizeToPanel: () => ipcRenderer.send('resize-to-panel'),
  sendAudio: (audio: ArrayBuffer) => ipcRenderer.send('send-audio', audio),
  sendText: (text: string) => ipcRenderer.send('send-text', text),
  stopSpeech: () => ipcRenderer.send('stop-speech'),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (enable: boolean) => ipcRenderer.invoke('autostart:set', enable),
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  pullOllamaModel: () => ipcRenderer.invoke('ollama:pull'),
  getSetupStatus: () => ipcRenderer.invoke('setup:status'),
  runSetupSequence: () => ipcRenderer.invoke('setup:run'),
  setSttModel: (modelName: string) => ipcRenderer.invoke('stt:set-model', modelName),
  setTtsVoice: (voiceName: string) => ipcRenderer.invoke('tts:set-voice', voiceName),
  onTranscript: (cb: (data: { text: string }) => void) =>
    ipcRenderer.on('transcript', (_event, data) => cb(data)),
  onResponse: (cb: (response: { spoken?: string; display?: string }) => void) =>
    ipcRenderer.on('response', (_event, data) => cb(data)),
  onError: (cb: (error: { message: string }) => void) =>
    ipcRenderer.on('error', (_event, data) => cb(data)),
  onWindowShown: (cb: () => void) =>
    ipcRenderer.on('window-shown', () => cb()),
});
