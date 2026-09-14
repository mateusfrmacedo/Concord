const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  signInWithGoogle: () => ipcRenderer.invoke('auth:google'),
  signInWithDiscord: () => ipcRenderer.invoke('auth:discord'),
  setWindowMode: (mode) => ipcRenderer.invoke('window:mode', mode)
});
