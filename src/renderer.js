const $ = (id) => document.getElementById(id);
const loginScreen = $('loginScreen'), homeScreen = $('homeScreen'), roomScreen = $('roomScreen');
const state = $('connectionState'), roomCode = $('roomCode'), roomCodeTop = $('copyRoomCode');
const remoteVideo = $('remoteVideo'), localPreview = $('localPreview'), emptyStage = $('emptyStage'), emptyTitle = $('emptyTitle'), streamBar = $('streamBar');
let socket, peer, localStream, currentRoom, isHost = false, queuedCandidates = [], authToken, friendState;

function setState(message, kind = '') { state.textContent = message; state.className = `connection-state ${kind}`; }
function makeRoomCode() { return crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 6).toUpperCase(); }
function toast(message) { const node = $('toast'); node.textContent = message; node.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add('hidden'), 2800); }
function serverUrl() { return 'https://screen-share-server-production-cb9e.up.railway.app'; }
function escape(value = '') { return String(value).replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]); }
function avatar(user, className = 'friend-avatar') { return `<img class="${className}" src="${escape(user.picture || '')}" alt="" />`; }
async function api(path, options = {}) {
  const response = await fetch(`${serverUrl()}${path}`, { ...options, headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.'); return data;
}
function renderFriends(data) {
  friendState = data; $('accountPicture').src = data.profile.picture || ''; $('accountName').textContent = data.profile.name; $('accountEmail').textContent = data.profile.email;
  const list = $('friends'); list.innerHTML = data.friends.length ? data.friends.map((friend) => `<div class="friend-row">${avatar(friend)}<div><strong>${escape(friend.name)}</strong><small>${escape(friend.email)}</small></div></div>`).join('') : '<p class="empty-list">Nenhum amigo ainda.</p>';
  const requests = $('requests'); $('requestsSection').classList.toggle('hidden', !data.incoming.length);
  requests.innerHTML = data.incoming.map((friend) => `<div class="request-row">${avatar(friend)}<div><strong>${escape(friend.name)}</strong><small>${escape(friend.email)}</small></div><button data-accept="${escape(friend.id)}">Aceitar</button></div>`).join('');
  requests.querySelectorAll('[data-accept]').forEach((button) => button.addEventListener('click', async () => { try { renderFriends(await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: button.dataset.accept }) })); } catch (error) { toast(error.message); } }));
}
async function enterHome() { renderFriends(await api('/api/me', { method: 'POST', body: '{}' })); loginScreen.classList.add('hidden'); homeScreen.classList.remove('hidden'); await window.desktop.setWindowMode('home'); }
async function oauthLogin() {
  const button = $('discordLogin'); button.disabled = true; $('loginStatus').textContent = 'Abrindo navegador…';
  try { const result = await window.desktop.signInWithDiscord(serverUrl()); authToken = result.token; await enterHome(); }
  catch (error) { $('loginStatus').textContent = error.message; }
  finally { button.disabled = false; }
}
function showRoom() {
  homeScreen.classList.add('hidden'); roomScreen.classList.remove('hidden'); roomCode.textContent = currentRoom; roomCodeTop.textContent = currentRoom;
  $('hostControls').classList.toggle('hidden', !isHost); $('viewerNote').classList.toggle('hidden', isHost); emptyTitle.textContent = isHost ? 'Pronto para compartilhar' : 'Aguardando'; window.desktop.setWindowMode('home');
}
function connectToRoom(room, host) {
  if (!serverUrl()) return toast('Servidor indisponível.'); currentRoom = room; isHost = host; showRoom(); setState('Conectando');
  socket = io(serverUrl(), { transports: ['websocket'] });
  socket.on('connect', () => { socket.emit('join-room', { room, role: host ? 'host' : 'viewer' }); setState('Na sala', 'ready'); });
  socket.on('connect_error', () => setState('Servidor indisponível', 'error'));
  socket.on('room-full', () => { toast('Esta sala já está cheia.'); leaveRoom(); });
  socket.on('peer-joined', async () => { if (isHost) { await ensurePeer(); await createOffer(); } });
  socket.on('peer-left', () => { peer?.close(); peer = undefined; queuedCandidates = []; remoteVideo.srcObject = null; if (!localStream) emptyStage.classList.remove('hidden'); toast('A outra pessoa saiu.'); });
  socket.on('signal', handleSignal);
}
async function ensurePeer() {
  if (peer) return peer;
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.onicecandidate = ({ candidate }) => { if (candidate) socket.emit('signal', { room: currentRoom, data: { candidate } }); };
  peer.ontrack = ({ streams }) => { remoteVideo.srcObject = streams[0]; emptyStage.classList.add('hidden'); streamBar.classList.remove('hidden'); };
  peer.onconnectionstatechange = () => { if (peer?.connectionState === 'connected') setState('Conectado', 'ready'); if (['failed','disconnected'].includes(peer?.connectionState)) setState('Reconectando'); };
  if (localStream) localStream.getTracks().forEach((track) => peer.addTrack(track, localStream)); return peer;
}
async function createOffer() { if (!isHost || !socket?.connected) return; const connection = await ensurePeer(); const offer = await connection.createOffer(); await connection.setLocalDescription(offer); socket.emit('signal', { room: currentRoom, data: { description: connection.localDescription } }); }
async function handleSignal({ data }) {
  if (data.description) { const connection = await ensurePeer(); await connection.setRemoteDescription(data.description); for (const candidate of queuedCandidates) await connection.addIceCandidate(candidate); queuedCandidates = []; if (data.description.type === 'offer') { const answer = await connection.createAnswer(); await connection.setLocalDescription(answer); socket.emit('signal', { room: currentRoom, data: { description: connection.localDescription } }); } }
  if (data.candidate) { if (peer?.remoteDescription) await peer.addIceCandidate(data.candidate); else queuedCandidates.push(data.candidate); }
}
async function startShare() {
  try { localStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, audio: true }); localPreview.srcObject = localStream; localPreview.style.display = 'block'; emptyStage.classList.add('hidden'); streamBar.classList.remove('hidden'); $('startShare').classList.add('hidden'); $('stopShare').classList.remove('hidden'); localStream.getVideoTracks()[0].addEventListener('ended', stopShare); if (peer) { localStream.getTracks().forEach((track) => peer.addTrack(track, localStream)); await createOffer(); } }
  catch (error) { if (error.name !== 'NotAllowedError') toast('Não foi possível compartilhar a tela.'); }
}
function stopShare() { localStream?.getTracks().forEach((track) => track.stop()); localStream = undefined; peer?.getSenders().filter((sender) => sender.track).forEach((sender) => peer.removeTrack(sender)); createOffer().catch(() => {}); localPreview.srcObject = null; localPreview.style.display = 'none'; streamBar.classList.add('hidden'); $('startShare').classList.remove('hidden'); $('stopShare').classList.add('hidden'); emptyStage.classList.remove('hidden'); emptyTitle.textContent = 'Encerrado'; }
function leaveRoom() { stopShare(); socket?.disconnect(); socket = undefined; peer?.close(); peer = undefined; remoteVideo.srcObject = null; roomScreen.classList.add('hidden'); homeScreen.classList.remove('hidden'); }

$('discordLogin').addEventListener('click', oauthLogin);
$('signOut').addEventListener('click', async () => { authToken = undefined; friendState = undefined; homeScreen.classList.add('hidden'); loginScreen.classList.remove('hidden'); $('loginStatus').textContent = ''; await window.desktop.setWindowMode('login'); });
$('friendSearch').addEventListener('submit', async (event) => { event.preventDefault(); const query = $('friendQuery').value.trim(); if (!query) return; try { const { users } = await api(`/api/users?q=${encodeURIComponent(query)}`); const results = $('searchResults'); results.classList.remove('hidden'); results.innerHTML = users.length ? users.map((user) => `<div class="result">${avatar(user)}<div><strong>${escape(user.name)}</strong><small>${escape(user.email)}</small></div><button data-user="${escape(user.id)}">Adicionar</button></div>`).join('') : '<p class="empty-list">Nenhum resultado.</p>'; results.querySelectorAll('[data-user]').forEach((button) => button.addEventListener('click', async () => { try { await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: button.dataset.user }) }); toast('Pedido enviado.'); button.textContent = 'Enviado'; button.disabled = true; } catch (error) { toast(error.message); } })); } catch (error) { toast(error.message); } });
$('createRoom').addEventListener('click', () => connectToRoom(makeRoomCode(), true)); $('startShare').addEventListener('click', startShare); $('stopShare').addEventListener('click', stopShare); $('leaveRoom').addEventListener('click', leaveRoom);
[$('copyRoomCode'), $('copyRoomCodeLarge')].forEach((button) => button.addEventListener('click', async () => { await navigator.clipboard.writeText(currentRoom); toast('Código copiado.'); }));
