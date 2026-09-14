require('dotenv').config();
const { app, BrowserWindow, session, shell, ipcMain } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

let mainWindow;
const compactBounds = { width: 390, height: 500 };

function createWindow() {
  mainWindow = new BrowserWindow({
    ...compactBounds,
    minWidth: 360,
    minHeight: 460,
    resizable: false,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function base64Url(value) { return value.toString('base64url'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest(); }

async function signInWithGoogle() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('Defina GOOGLE_CLIENT_ID para ativar o login Google.');
  const state = base64Url(crypto.randomBytes(32));
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(sha256(verifier));

  const callback = await new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname !== '/oauth/callback') return response.writeHead(404).end();
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const callbackPort = server.address().port;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Concord</title><body style="font-family:-apple-system;text-align:center;padding:64px">Você pode voltar ao Concord.</body>');
      server.close();
      if (error) reject(new Error(error));
      else if (returnedState !== state || !code) reject(new Error('A validação do login falhou.'));
      else resolve({ code, redirectUri: `http://127.0.0.1:${callbackPort}/oauth/callback` });
    });
    server.listen(0, '127.0.0.1', async () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
      const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorizeUrl.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state,
        code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
      }).toString();
      try { await shell.openExternal(authorizeUrl.toString()); } catch (error) { server.close(); reject(error); }
    });
    setTimeout(() => { server.close(); reject(new Error('O login expirou.')); }, 300000).unref();
  });

  const tokens = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: callback.code, client_id: clientId, redirect_uri: callback.redirectUri, grant_type: 'authorization_code', code_verifier: verifier })
  }).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error_description || 'Não foi possível concluir o login.');
    return body;
  });
  const identity = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`).then(async (response) => {
    const body = await response.json();
    if (!response.ok || body.aud !== clientId) throw new Error('Não foi possível validar a conta Google.');
    return body;
  });
  return { idToken: tokens.id_token, profile: { id: identity.sub, name: identity.name, email: identity.email, picture: identity.picture } };
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(['media', 'display-capture'].includes(permission)));
  ipcMain.handle('auth:google', signInWithGoogle);
  ipcMain.handle('window:mode', (_event, mode) => {
    if (!mainWindow) return;
    const home = mode === 'home';
    mainWindow.setResizable(home);
    mainWindow.setMinimumSize(home ? 760 : 360, home ? 560 : 460);
    mainWindow.setSize(home ? 960 : compactBounds.width, home ? 650 : compactBounds.height);
    mainWindow.center();
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
