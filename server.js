require('dotenv').config();
const { createServer } = require('node:http');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { Server } = require('socket.io');

const port = Number(process.env.PORT || 3000);
const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const dataFile = process.env.SCREEN_SHARE_DATA_FILE || join(process.cwd(), 'data', 'users.json');
const oauthAttempts = new Map();
const oauthTickets = new Map();
const onlineSockets = new Map();
const httpServer = createServer(route);
const io = new Server(httpServer, { cors: { origin: '*' } });

function readDatabase() {
  if (!existsSync(dataFile)) return { users: {}, sessions: {} };
  try { const data = JSON.parse(readFileSync(dataFile, 'utf8')); return { users: data.users || {}, sessions: data.sessions || {} }; } catch { return { users: {}, sessions: {} }; }
}
function writeDatabase(data) { mkdirSync(dirname(dataFile), { recursive: true }); writeFileSync(dataFile, JSON.stringify(data, null, 2)); }
function json(response, status, data) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); response.end(JSON.stringify(data)); }
function text(response, status, data) { response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' }); response.end(data); }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
function token() { return require('node:crypto').randomBytes(32).toString('base64url'); }
function cleanExpired(map) { const now = Date.now(); for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key); }
function localReturnUrl(value) { try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/oauth/callback' ? url : null; } catch { return null; } }
async function authenticatedUser(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Login necessário.');
  return userForSession(token);
}
function userForSession(sessionToken) { const data = readDatabase(); const session = data.sessions[sessionToken]; if (!session || session.expiresAt <= Date.now() || !data.users[session.userId]) throw new Error('Sessão inválida.'); return data.users[session.userId]; }
function ensureUser(data, user) {
  const current = data.users[user.id] || { ...user, friends: [], incoming: [] };
  data.users[user.id] = { ...current, ...user, friends: current.friends || [], incoming: current.incoming || [] };
  return data.users[user.id];
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, picture: user.picture, online: onlineSockets.has(user.id) }; }
function friendData(data, user) { return { profile: publicUser(user), friends: user.friends.map((id) => data.users[id]).filter(Boolean).map(publicUser), incoming: user.incoming.map((id) => data.users[id]).filter(Boolean).map(publicUser) }; }

async function route(request, response) {
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' }).end(); return; }
  const requestUrl = new URL(request.url, publicUrl || `http://localhost:${port}`);
  if (request.method === 'GET' && requestUrl.pathname === '/health') return text(response, 200, 'ok');
  if (request.method === 'GET' && requestUrl.pathname === '/oauth/discord/start') {
    const returnTo = localReturnUrl(requestUrl.searchParams.get('return_to'));
    const appState = requestUrl.searchParams.get('state');
    if (!publicUrl || !discordClientId || !discordClientSecret) return json(response, 503, { error: 'Login Discord não está configurado no servidor.' });
    if (!returnTo || !appState) return json(response, 400, { error: 'Solicitação de login inválida.' });
    cleanExpired(oauthAttempts);
    const discordState = token(); oauthAttempts.set(discordState, { appState, returnTo: returnTo.toString(), expiresAt: Date.now() + 300000 });
    const authorizationUrl = new URL('https://discord.com/oauth2/authorize');
    authorizationUrl.search = new URLSearchParams({ client_id: discordClientId, redirect_uri: `${publicUrl}/oauth/discord/callback`, response_type: 'code', scope: 'identify email', state: discordState, prompt: 'consent' }).toString();
    response.writeHead(302, { location: authorizationUrl.toString() }); response.end(); return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/oauth/discord/callback') {
    cleanExpired(oauthAttempts); cleanExpired(oauthTickets);
    const attempt = oauthAttempts.get(requestUrl.searchParams.get('state')); oauthAttempts.delete(requestUrl.searchParams.get('state'));
    if (!attempt || !publicUrl || !discordClientId || !discordClientSecret) return text(response, 400, 'Login expirado ou inválido.');
    const returnTo = new URL(attempt.returnTo); const fail = (message) => { returnTo.searchParams.set('state', attempt.appState); returnTo.searchParams.set('error', message); response.writeHead(302, { location: returnTo.toString() }); response.end(); };
    const code = requestUrl.searchParams.get('code'); if (!code) return fail('O login foi cancelado.');
    try {
      const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: discordClientId, client_secret: discordClientSecret, code, redirect_uri: `${publicUrl}/oauth/discord/callback`, grant_type: 'authorization_code' }) });
      const tokens = await tokenResponse.json(); if (!tokenResponse.ok || !tokens.access_token) throw new Error(tokens.error_description || 'Não foi possível concluir o login Discord.');
      const identityResponse = await fetch('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bearer ${tokens.access_token}` } });
      const identity = await identityResponse.json(); if (!identityResponse.ok || !identity.id) throw new Error('Não foi possível identificar a conta Discord.');
      const picture = identity.avatar ? `https://cdn.discordapp.com/avatars/${identity.id}/${identity.avatar}.png?size=128` : '';
      const data = readDatabase(); const user = ensureUser(data, { id: `discord:${identity.id}`, name: identity.global_name || identity.username, email: identity.email || identity.username, picture });
      const sessionToken = token(); data.sessions[sessionToken] = { userId: user.id, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30 };
      for (const [key, session] of Object.entries(data.sessions)) if (session.expiresAt <= Date.now()) delete data.sessions[key];
      writeDatabase(data);
      const ticket = token(); oauthTickets.set(ticket, { sessionToken, expiresAt: Date.now() + 60000 });
      returnTo.searchParams.set('state', attempt.appState); returnTo.searchParams.set('ticket', ticket); response.writeHead(302, { location: returnTo.toString() }); response.end();
    } catch (error) { fail(error.message); }
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/oauth/discord/ticket') {
    cleanExpired(oauthTickets); const ticket = oauthTickets.get(requestUrl.searchParams.get('ticket')); oauthTickets.delete(requestUrl.searchParams.get('ticket'));
    return ticket ? json(response, 200, { token: ticket.sessionToken }) : json(response, 401, { error: 'Login expirado. Tente novamente.' });
  }
  if (!request.url.startsWith('/api/')) return json(response, 404, { error: 'Not found' });
  try {
    const user = await authenticatedUser(request); const data = readDatabase(); const current = ensureUser(data, user);
    if (request.method === 'POST' && request.url === '/api/me') { writeDatabase(data); return json(response, 200, friendData(data, current)); }
    if (request.method === 'GET' && request.url.startsWith('/api/users')) {
      const query = new URL(request.url, `http://localhost:${port}`).searchParams.get('q')?.toLowerCase().trim() || '';
      const users = Object.values(data.users).filter((candidate) => candidate.id !== current.id && `${candidate.name} ${candidate.email}`.toLowerCase().includes(query)).slice(0, 8).map(publicUser);
      return json(response, 200, { users });
    }
    const input = await body(request);
    if (request.method === 'POST' && request.url === '/api/friends/request') {
      const target = data.users[input.userId]; if (!target || target.id === current.id) return json(response, 404, { error: 'Amigo não encontrado.' });
      if (!target.friends.includes(current.id) && !target.incoming.includes(current.id)) target.incoming.push(current.id);
      writeDatabase(data); return json(response, 200, { ok: true });
    }
    if (request.method === 'POST' && request.url === '/api/friends/accept') {
      const target = data.users[input.userId]; if (!target || !current.incoming.includes(input.userId)) return json(response, 404, { error: 'Pedido não encontrado.' });
      current.incoming = current.incoming.filter((id) => id !== target.id); if (!current.friends.includes(target.id)) current.friends.push(target.id); if (!target.friends.includes(current.id)) target.friends.push(current.id);
      writeDatabase(data); return json(response, 200, friendData(data, current));
    }
    return json(response, 404, { error: 'Not found' });
  } catch (error) { json(response, /necessário|inválida/.test(error.message) ? 401 : 503, { error: error.message }); }
}

function broadcastPresence(userId, online) { io.emit('presence-update', { userId, online }); }
function leaveRoom(socket) { if (!socket.data.room) return; const room = socket.data.room; socket.leave(room); socket.to(room).emit('peer-left'); delete socket.data.room; }
io.use((socket, next) => {
  try { socket.data.user = userForSession(socket.handshake.auth?.token); next(); } catch { next(new Error('unauthorized')); }
});
io.on('connection', (socket) => {
  const userId = socket.data.user.id; const sockets = onlineSockets.get(userId) || new Set(); const wasOffline = sockets.size === 0;
  sockets.add(socket.id); onlineSockets.set(userId, sockets); if (wasOffline) broadcastPresence(userId, true);
  socket.on('join-room', ({ room, role }) => {
    if (!room || !['host', 'viewer'].includes(role)) return; leaveRoom(socket);
    if ((io.sockets.adapter.rooms.get(room)?.size || 0) >= 2) return socket.emit('room-full');
    socket.join(room); socket.data.room = room; socket.to(room).emit('peer-joined', { role });
  });
  socket.on('leave-room', () => leaveRoom(socket));
  socket.on('signal', ({ room, data }) => { if (room && socket.data.room === room) socket.to(room).emit('signal', { data }); });
  socket.on('invite', ({ targetUserId, room }) => {
    const data = readDatabase(); const sender = data.users[userId]; const recipient = data.users[targetUserId];
    if (!room || !recipient || !sender?.friends?.includes(targetUserId)) return socket.emit('invite-error', 'Não foi possível convidar este amigo.');
    for (const socketId of onlineSockets.get(targetUserId) || []) io.to(socketId).emit('share-invite', { from: publicUser(sender), room });
  });
  socket.on('disconnect', () => {
    leaveRoom(socket); const connected = onlineSockets.get(userId); connected?.delete(socket.id);
    if (!connected?.size) { onlineSockets.delete(userId); broadcastPresence(userId, false); }
  });
});
httpServer.listen(port, () => console.log(`Screen sharing server listening on :${port}`));
