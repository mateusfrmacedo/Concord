const { app, BrowserWindow, session, shell, ipcMain } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

let mainWindow;
const compactBounds = { width: 390, height: 440 };
function createWindow() {
  mainWindow = new BrowserWindow({ ...compactBounds, minWidth: 360, minHeight: 410, resizable: false, backgroundColor: '#ffffff', titleBarStyle: 'hiddenInset', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}
function base64Url(value) { return value.toString('base64url'); }

async function signInWithDiscord(serverUrl) {
  let origin;
  try { origin = new URL(serverUrl); } catch { throw new Error('Informe o endereço do servidor.'); }
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('O endereço do servidor deve começar com http:// ou https://.');
  origin.pathname = origin.pathname.replace(/\/$/, ''); origin.search = ''; origin.hash = '';
  const state = base64Url(crypto.randomBytes(32));
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const received = new URL(request.url, 'http://127.0.0.1');
      if (received.pathname !== '/oauth/callback') return response.writeHead(404).end();
      const ticket = received.searchParams.get('ticket'), returnedState = received.searchParams.get('state'), error = received.searchParams.get('error');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system;text-align:center;padding:64px">Login concluído. Você pode fechar esta aba.</body>');
      server.close();
      if (error) return reject(new Error(error));
      if (returnedState !== state || !ticket) return reject(new Error('A validação do login falhou.'));
      fetch(new URL(`/oauth/discord/ticket?ticket=${encodeURIComponent(ticket)}`, origin).toString()).then(async (result) => {
        const body = await result.json(); if (!result.ok || !body.token) throw new Error(body.error || 'Não foi possível concluir o login.'); return body;
      }).then((body) => resolve({ provider: 'discord', token: body.token }), reject);
    });
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const callback = `http://127.0.0.1:${port}/oauth/callback`;
      const authorizationUrl = new URL('/oauth/discord/start', origin);
      authorizationUrl.search = new URLSearchParams({ state, return_to: callback }).toString();
      try { await shell.openExternal(authorizationUrl.toString()); } catch (error) { server.close(); reject(error); }
    });
    setTimeout(() => { server.close(); reject(new Error('O login expirou.')); }, 300000).unref();
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(['media', 'display-capture'].includes(permission)));
  ipcMain.handle('auth:discord', (_event, serverUrl) => signInWithDiscord(serverUrl));
  ipcMain.handle('window:mode', (_event, mode) => { if (!mainWindow) return; const home = mode === 'home'; mainWindow.setResizable(home); mainWindow.setMinimumSize(home ? 760 : 360, home ? 560 : 410); mainWindow.setSize(home ? 960 : compactBounds.width, home ? 650 : compactBounds.height); mainWindow.center(); });
  createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
