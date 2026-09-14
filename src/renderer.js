const $ = (id) => document.getElementById(id);
const loginScreen = $('loginScreen'), homeScreen = $('homeScreen'), roomScreen = $('roomScreen');
const state = $('connectionState'), roomCode = $('roomCode'), roomCodeTop = $('copyRoomCode');
const remoteVideo = $('remoteVideo'), localPreview = $('localPreview'), emptyStage = $('emptyStage'), emptyTitle = $('emptyTitle'), streamBar = $('streamBar'), stage = $('stage'), streamQuality = $('streamQuality');
const qualityProfiles = {
  auto: { label: 'Automática', video: { frameRate: { ideal: 30, max: 60 } } },
  1080: { label: '1080p · 30 FPS', video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } }, maxBitrate: 4500000 },
  720: { label: '720p · 30 FPS', video: { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 } }, maxBitrate: 2500000 },
  480: { label: '480p · 30 FPS', video: { width: { ideal: 854, max: 854 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 30, max: 30 } }, maxBitrate: 1200000 }
};
let socket, peer, localStream, remoteStream, currentRoom, isHost = false, queuedCandidates = [], authToken, friendState, activeQuality = 'auto';

function setState(message, kind = '') { state.textContent = message; state.className = `connection-state ${kind}`; }
function makeRoomCode() { return crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 6).toUpperCase(); }
function toast(message) { const node = $('toast'); node.textContent = message; node.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add('hidden'), 2800); }
function updateStage() {
  const hasLocal = Boolean(localStream?.getVideoTracks().some((track) => track.readyState === 'live'));
  const hasRemote = Boolean(remoteStream?.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted));
  stage.classList.toggle('has-local', hasLocal); stage.classList.toggle('has-remote', hasRemote);
  emptyStage.classList.toggle('hidden', hasLocal || hasRemote); streamBar.classList.toggle('hidden', !hasLocal && !hasRemote);
  if (hasLocal && hasRemote) { localPreview.style.cssText = 'display:block;inset:auto 14px 14px auto;width:180px;height:104px;z-index:2;border:1px solid #ffffff66;border-radius:8px;background:#1d1d1f;box-shadow:0 5px 16px #0004;'; }
  else { localPreview.style.cssText = hasLocal ? 'display:block;' : 'display:none;'; }
  streamQuality.textContent = hasLocal ? qualityProfiles[activeQuality].label : 'Tela do amigo';
}
function serverUrl() { return 'https://screen-share-server-production-cb9e.up.railway.app'; }
function escape(value = '') { return String(value).replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]); }
function avatar(user, className = 'friend-avatar') { return `<img class="${className}" src="${escape(user.picture || '')}" alt="" />`; }
async function api(path, options = {}) {
  const response = await fetch(`${serverUrl()}${path}`, { ...options, headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.'); return data;
}
function renderFriends(data) {
  friendState = data; $('accountPicture').src = data.profile.picture || ''; $('accountName').textContent = data.profile.name; $('accountEmail').textContent = data.profile.email;
  const list = $('friends'); list.innerHTML = data.friends.length ? data.friends.map((friend) => `<div class="friend-row">${avatar(friend)}<div><strong>${escape(friend.name)}</strong><small>${friend.online ? 'Online' : 'Offline'}</small></div><button class="share-friend" data-share="${escape(friend.id)}" ${friend.online ? '' : 'disabled'}>${friend.online ? 'Compartilhar' : 'Offline'}</button></div>`).join('') : '<p class="empty-list">Nenhum amigo ainda.</p>';
  list.querySelectorAll('[data-share]').forEach((button) => button.addEventListener('click', () => { const friend = friendState.friends.find((item) => item.id === button.dataset.share); if (!friend?.online) return toast('Este amigo está offline.'); const room = makeRoomCode(); connectToRoom(room, true); socket.emit('invite', { targetUserId: friend.id, room }); }));
  const requests = $('requests'); $('requestsSection').classList.toggle('hidden', !data.incoming.length);
  requests.innerHTML = data.incoming.map((friend) => `<div class="request-row">${avatar(friend)}<div><strong>${escape(friend.name)}</strong><small>${escape(friend.email)}</small></div><button data-accept="${escape(friend.id)}">Aceitar</button></div>`).join('');
  requests.querySelectorAll('[data-accept]').forEach((button) => button.addEventListener('click', async () => { try { renderFriends(await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId: button.dataset.accept }) })); } catch (error) { toast(error.message); } }));
}
async function enterHome() { renderFriends(await api('/api/me', { method: 'POST', body: '{}' })); connectSocket(); loginScreen.classList.add('hidden'); homeScreen.classList.remove('hidden'); await window.desktop.setWindowMode('home'); }
async function oauthLogin() {
  const button = $('discordLogin'); button.disabled = true; $('loginStatus').textContent = 'Abrindo navegador…';
  try { const result = await window.desktop.signInWithDiscord(serverUrl()); authToken = result.token; await enterHome(); }
  catch (error) { $('loginStatus').textContent = error.message; }
  finally { button.disabled = false; }
}
function showRoom() {
  homeScreen.classList.add('hidden'); roomScreen.classList.remove('hidden'); roomCode.textContent = currentRoom; roomCodeTop.textContent = currentRoom;
  emptyTitle.textContent = 'Aguardando compartilhamento'; updateStage(); window.desktop.setWindowMode('home');
}
function joinCurrentRoom() { if (socket?.connected && currentRoom) { socket.emit('join-room', { room: currentRoom, role: isHost ? 'host' : 'viewer' }); setState('Na sala', 'ready'); } }
function connectSocket() {
  socket?.disconnect(); socket = io(serverUrl(), { transports: ['websocket'], auth: { token: authToken } });
  socket.on('connect', joinCurrentRoom);
  socket.on('connect_error', () => setState('Servidor indisponível', 'error'));
  socket.on('room-full', () => { toast('Esta sala já está cheia.'); leaveRoom(); });
  socket.on('peer-joined', async () => { if (isHost) { await ensurePeer(); await createOffer(); } });
  socket.on('peer-left', () => { peer?.close(); peer = undefined; queuedCandidates = []; remoteStream = undefined; remoteVideo.srcObject = null; updateStage(); toast('A outra pessoa saiu.'); });
  socket.on('signal', handleSignal);
  socket.on('presence-update', ({ userId, online }) => { if (!friendState) return; const friend = friendState.friends.find((item) => item.id === userId); if (friend) { friend.online = online; renderFriends(friendState); } });
  socket.on('share-invite', ({ from, room }) => { if (window.confirm(`${from.name} quer compartilhar a tela com você. Aceitar?`)) connectToRoom(room, false); });
  socket.on('invite-error', toast);
}
function connectToRoom(room, host) {
  if (!serverUrl()) return toast('Servidor indisponível.'); currentRoom = room; isHost = host; showRoom(); setState('Conectando');
  if (!socket) connectSocket(); else joinCurrentRoom();
}
function transceiverFor(kind) { return peer?.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === kind); }
async function syncLocalTracks() {
  if (!peer) return;
  const videoTrack = localStream?.getVideoTracks()[0] || null, audioTrack = localStream?.getAudioTracks()[0] || null;
  await transceiverFor('video')?.sender.replaceTrack(videoTrack);
  await transceiverFor('audio')?.sender.replaceTrack(audioTrack);
  const videoSender = transceiverFor('video')?.sender;
  if (videoSender) {
    const parameters = videoSender.getParameters();
    if (parameters.encodings?.length) { const maximum = qualityProfiles[activeQuality].maxBitrate; if (maximum) parameters.encodings[0].maxBitrate = maximum; else delete parameters.encodings[0].maxBitrate; await videoSender.setParameters(parameters).catch(() => {}); }
  }
}
async function ensurePeer() {
  if (peer) return peer;
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.addTransceiver('video', { direction: 'sendrecv' }); peer.addTransceiver('audio', { direction: 'sendrecv' });
  peer.onicecandidate = ({ candidate }) => { if (candidate) socket.emit('signal', { room: currentRoom, data: { candidate } }); };
  peer.ontrack = ({ streams, track }) => { remoteStream = streams[0] || remoteStream || new MediaStream(); if (!streams[0] && !remoteStream.getTracks().some((item) => item.id === track.id)) remoteStream.addTrack(track); remoteVideo.srcObject = remoteStream; track.addEventListener('mute', updateStage); track.addEventListener('unmute', updateStage); track.addEventListener('ended', updateStage); updateStage(); };
  peer.onconnectionstatechange = () => { if (peer?.connectionState === 'connected') setState('Conectado', 'ready'); if (['failed','disconnected'].includes(peer?.connectionState)) setState('Reconectando'); };
  await syncLocalTracks(); return peer;
}
async function createOffer() { if (!isHost || !socket?.connected) return; const connection = await ensurePeer(); const offer = await connection.createOffer(); await connection.setLocalDescription(offer); socket.emit('signal', { room: currentRoom, data: { description: connection.localDescription } }); }
async function handleSignal({ data }) {
  if (data.description) { const connection = await ensurePeer(); await connection.setRemoteDescription(data.description); for (const candidate of queuedCandidates) await connection.addIceCandidate(candidate); queuedCandidates = []; if (data.description.type === 'offer') { const answer = await connection.createAnswer(); await connection.setLocalDescription(answer); socket.emit('signal', { room: currentRoom, data: { description: connection.localDescription } }); } }
  if (data.candidate) { if (peer?.remoteDescription) await peer.addIceCandidate(data.candidate); else queuedCandidates.push(data.candidate); }
}
async function startShare() {
  try {
    activeQuality = $('quality').value; const profile = qualityProfiles[activeQuality];
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: profile.video, audio: true }); localPreview.srcObject = localStream;
    $('quality').disabled = true; $('startShare').classList.add('hidden'); $('stopShare').classList.remove('hidden'); localStream.getVideoTracks()[0].addEventListener('ended', stopShare); await syncLocalTracks(); updateStage();
  } catch (error) { if (error.name !== 'NotAllowedError') toast('Não foi possível compartilhar a tela.'); }
}
async function stopShare() { localStream?.getTracks().forEach((track) => track.stop()); localStream = undefined; await syncLocalTracks().catch(() => {}); localPreview.srcObject = null; $('quality').disabled = false; $('startShare').classList.remove('hidden'); $('stopShare').classList.add('hidden'); emptyTitle.textContent = 'Aguardando compartilhamento'; updateStage(); }
function leaveRoom() { stopShare(); socket?.emit('leave-room'); peer?.close(); peer = undefined; remoteStream = undefined; remoteVideo.srcObject = null; currentRoom = undefined; roomScreen.classList.add('hidden'); homeScreen.classList.remove('hidden'); }

$('discordLogin').addEventListener('click', oauthLogin);
$('signOut').addEventListener('click', async () => { socket?.disconnect(); socket = undefined; authToken = undefined; friendState = undefined; homeScreen.classList.add('hidden'); loginScreen.classList.remove('hidden'); $('loginStatus').textContent = ''; await window.desktop.setWindowMode('login'); });
$('friendSearch').addEventListener('submit', async (event) => { event.preventDefault(); const query = $('friendQuery').value.trim(); if (!query) return; try { const { users } = await api(`/api/users?q=${encodeURIComponent(query)}`); const results = $('searchResults'); results.classList.remove('hidden'); results.innerHTML = users.length ? users.map((user) => `<div class="result">${avatar(user)}<div><strong>${escape(user.name)}</strong><small>${escape(user.email)}</small></div><button data-user="${escape(user.id)}">Adicionar</button></div>`).join('') : '<p class="empty-list">Nenhum resultado.</p>'; results.querySelectorAll('[data-user]').forEach((button) => button.addEventListener('click', async () => { try { await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: button.dataset.user }) }); toast('Pedido enviado.'); button.textContent = 'Enviado'; button.disabled = true; } catch (error) { toast(error.message); } })); } catch (error) { toast(error.message); } });
$('createRoom').addEventListener('click', () => connectToRoom(makeRoomCode(), true)); $('startShare').addEventListener('click', startShare); $('stopShare').addEventListener('click', stopShare); $('leaveRoom').addEventListener('click', leaveRoom);
[$('copyRoomCode'), $('copyRoomCodeLarge')].forEach((button) => button.addEventListener('click', async () => { await navigator.clipboard.writeText(currentRoom); toast('Código copiado.'); }));
