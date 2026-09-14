const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('concord', {
  signInWithGoogle: () => ipcRenderer.invoke('auth:google'),
  setWindowMode: (mode) => ipcRenderer.invoke('window:mode', mode)
});
