const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  signInWithDiscord: () => ipcRenderer.invoke('auth:discord'),
  setWindowMode: (mode) => ipcRenderer.invoke('window:mode', mode)
});
