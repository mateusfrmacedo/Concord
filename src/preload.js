const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  signInWithDiscord: (serverUrl) => ipcRenderer.invoke('auth:discord', serverUrl),
  setWindowMode: (mode) => ipcRenderer.invoke('window:mode', mode)
});
