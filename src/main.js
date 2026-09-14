require('dotenv').config();
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
function sha256(value) { return crypto.createHash('sha256').update(value).digest(); }

async function receiveAuthorizationCode({ provider, clientId, authorizationEndpoint, scope, extra = {}, redirectUri, usePkce = false }) {
  const state = base64Url(crypto.randomBytes(32));
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(sha256(verifier));
  const target = redirectUri ? new URL(redirectUri) : new URL('http://127.0.0.1:0/oauth/callback');
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const received = new URL(request.url, `http://${target.hostname}`);
      if (received.pathname !== target.pathname) return response.writeHead(404).end();
      const callbackPort = server.address().port;
      const code = received.searchParams.get('code'), returnedState = received.searchParams.get('state'), error = received.searchParams.get('error');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system;text-align:center;padding:64px">Login concluído. Você pode fechar esta aba.</body>');
      server.close();
      if (error) reject(new Error(error)); else if (returnedState !== state || !code) reject(new Error('A validação do login falhou.'));
      else resolve({ code, verifier, redirectUri: `${target.protocol}//${target.hostname}:${callbackPort}${target.pathname}` });
    });
    server.listen(Number(target.port) || 0, target.hostname, async () => {
      const port = server.address().port;
      const callback = `${target.protocol}//${target.hostname}:${port}${target.pathname}`;
      const authorizationUrl = new URL(authorizationEndpoint);
      authorizationUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope, state, ...(usePkce ? { code_challenge: challenge, code_challenge_method: 'S256' } : {}), ...extra }).toString();
      try { await shell.openExternal(authorizationUrl.toString()); } catch (error) { server.close(); reject(error); }
    });
    setTimeout(() => { server.close(); reject(new Error('O login expirou.')); }, 300000).unref();
  });
}
async function signInWithGoogle() {
  const clientId = process.env.GOOGLE_CLIENT_ID; if (!clientId) throw new Error('Defina GOOGLE_CLIENT_ID para ativar o login Google.');
  const auth = await receiveAuthorizationCode({ provider: 'google', clientId, authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth', scope: 'openid email profile', extra: { prompt: 'select_account' }, usePkce: true });
  const tokens = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: auth.code, client_id: clientId, redirect_uri: auth.redirectUri, grant_type: 'authorization_code', code_verifier: auth.verifier }) }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error_description || 'Não foi possível concluir o login.'); return body; });
  return { provider: 'google', token: tokens.id_token };
}
async function signInWithDiscord() {
  const clientId = process.env.DISCORD_CLIENT_ID, clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Defina DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET para ativar o login Discord.');
  const auth = await receiveAuthorizationCode({ provider: 'discord', clientId, authorizationEndpoint: 'https://discord.com/oauth2/authorize', scope: 'identify email', redirectUri: process.env.DISCORD_REDIRECT_URI || 'http://127.0.0.1:8912/oauth/callback', extra: { prompt: 'consent' } });
  const tokens = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: auth.code, redirect_uri: auth.redirectUri, grant_type: 'authorization_code' }) }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error_description || 'Não foi possível concluir o login.'); return body; });
  return { provider: 'discord', token: tokens.access_token };
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(['media', 'display-capture'].includes(permission)));
  ipcMain.handle('auth:google', signInWithGoogle); ipcMain.handle('auth:discord', signInWithDiscord);
  ipcMain.handle('window:mode', (_event, mode) => { if (!mainWindow) return; const home = mode === 'home'; mainWindow.setResizable(home); mainWindow.setMinimumSize(home ? 760 : 360, home ? 560 : 410); mainWindow.setSize(home ? 960 : compactBounds.width, home ? 650 : compactBounds.height); mainWindow.center(); });
  createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
