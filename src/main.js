const { app, BrowserWindow, session } = require('electron');
const path = require('path');

function createWindow() {
  const window = new BrowserWindow({
    width: 1024, height: 720, minWidth: 760, minHeight: 560, backgroundColor: '#101828', titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  window.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(['media', 'display-capture'].includes(permission)));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
