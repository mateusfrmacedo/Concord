require('dotenv').config();
const { createServer } = require('node:http');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { Server } = require('socket.io');

const port = Number(process.env.PORT || 3000);
const clientId = process.env.GOOGLE_CLIENT_ID;
const dataFile = process.env.CONCORD_DATA_FILE || join(process.cwd(), 'data', 'concord.json');
const httpServer = createServer(route);
const io = new Server(httpServer, { cors: { origin: '*' } });

function readDatabase() {
  if (!existsSync(dataFile)) return { users: {} };
  try { return JSON.parse(readFileSync(dataFile, 'utf8')); } catch { return { users: {} }; }
}
function writeDatabase(data) { mkdirSync(dirname(dataFile), { recursive: true }); writeFileSync(dataFile, JSON.stringify(data, null, 2)); }
function json(response, status, data) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); response.end(JSON.stringify(data)); }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
async function googleUser(request) {
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID não está configurado no servidor.');
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Login necessário.');
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  const identity = await response.json();
  if (!response.ok || identity.aud !== clientId || !identity.sub) throw new Error('Sessão Google inválida.');
  return { id: identity.sub, name: identity.name || identity.email, email: identity.email, picture: identity.picture || '' };
}
function ensureUser(data, user) {
  const current = data.users[user.id] || { ...user, friends: [], incoming: [] };
  data.users[user.id] = { ...current, ...user, friends: current.friends || [], incoming: current.incoming || [] };
  return data.users[user.id];
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, picture: user.picture }; }
function friendData(data, user) { return { profile: publicUser(user), friends: user.friends.map((id) => data.users[id]).filter(Boolean).map(publicUser), incoming: user.incoming.map((id) => data.users[id]).filter(Boolean).map(publicUser) }; }

async function route(request, response) {
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' }).end(); return; }
  if (!request.url.startsWith('/api/')) return json(response, 404, { error: 'Not found' });
  try {
    const user = await googleUser(request); const data = readDatabase(); const current = ensureUser(data, user);
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

io.on('connection', (socket) => {
  socket.on('join-room', ({ room, role }) => { if ((io.sockets.adapter.rooms.get(room)?.size || 0) >= 2) return socket.emit('room-full'); socket.join(room); socket.data.room = room; socket.data.role = role; socket.to(room).emit('peer-joined', { role }); });
  socket.on('signal', ({ room, data }) => socket.to(room).emit('signal', { data }));
  socket.on('disconnect', () => { if (socket.data.room) socket.to(socket.data.room).emit('peer-left'); });
});
httpServer.listen(port, () => console.log(`Concord server listening on :${port}`));
