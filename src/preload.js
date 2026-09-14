const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('screenlink', { platform: process.platform });
