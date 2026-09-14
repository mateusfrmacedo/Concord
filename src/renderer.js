const $ = (id) => document.getElementById(id);
const welcomeScreen = $('welcomeScreen'), roomScreen = $('roomScreen'), state = $('connectionState');
const roomCode = $('roomCode'), roomCodeTop = $('copyRoomCode'), remoteVideo = $('remoteVideo'), localPreview = $('localPreview');
const emptyStage = $('emptyStage'), emptyTitle = $('emptyTitle'), emptyCopy = $('emptyCopy'), streamBar = $('streamBar');
let socket, peer, localStream, currentRoom, isHost = false, queuedCandidates = [];

function setState(message, kind = '') { state.textContent = message; state.className = `connection-state ${kind}`; }
function makeRoomCode() { return crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 6).toUpperCase(); }
function toast(message) { const node = $('toast'); node.textContent = message; node.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add('hidden'), 2600); }
function signalingUrl() { return $('serverUrl').value.trim().replace(/\/$/, ''); }
function showRoom() {
  welcomeScreen.classList.add('hidden'); roomScreen.classList.remove('hidden'); roomCode.textContent = currentRoom; roomCodeTop.textContent = currentRoom;
  $('hostControls').classList.toggle('hidden', !isHost); $('viewerNote').classList.toggle('hidden', isHost);
  emptyTitle.textContent = isHost ? 'Pronto para compartilhar' : 'Aguardando compartilhamento';
  emptyCopy.textContent = isHost ? 'Clique em “Compartilhar tela” quando estiver pronto.' : 'A tela aparecerá aqui quando o apresentador iniciar a transmissão.';
}
function connectToRoom(room, host) {
  if (!signalingUrl()) return toast('Informe o endereço do servidor.'); currentRoom = room; isHost = host; showRoom(); setState('Conectando…');
  socket = io(signalingUrl(), { transports: ['websocket'] });
  socket.on('connect', () => { socket.emit('join-room', { room, role: host ? 'host' : 'viewer' }); setState('Na sala', 'ready'); });
  socket.on('connect_error', () => setState('Servidor indisponível', 'error'));
  socket.on('room-full', () => { toast('Esta sala já tem um apresentador e um espectador.'); leaveRoom(); });
  socket.on('peer-joined', async () => { if (isHost) { await ensurePeer(); await createOffer(); } });
  socket.on('peer-left', () => { peer?.close(); peer = undefined; queuedCandidates = []; remoteVideo.srcObject = null; if (!localStream) emptyStage.classList.remove('hidden'); toast('A outra pessoa saiu da sala.'); });
  socket.on('signal', handleSignal);
}
async function ensurePeer() {
  if (peer) return peer;
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.onicecandidate = ({ candidate }) => { if (candidate) socket.emit('signal', { room: currentRoom, data: { candidate } }); };
  peer.ontrack = ({ streams }) => { remoteVideo.srcObject = streams[0]; emptyStage.classList.add('hidden'); streamBar.classList.remove('hidden'); };
  peer.onconnectionstatechange = () => { if (peer?.connectionState === 'connected') setState('Conectado', 'ready'); if (['failed','disconnected'].includes(peer?.connectionState)) setState('Reconectando…'); };
  if (localStream) localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
  return peer;
}
async function createOffer() { if (!isHost || !socket?.connected) return; const connection = await ensurePeer(); const offer = await connection.createOffer(); await connection.setLocalDescription(offer); socket.emit('signal', { room: currentRoom, data: { description: connection.localDescription } }); }
async function handleSignal({ data }) {
  if (data.description) { const connection = await ensurePeer(); await connection.setRemoteDescription(data.description); for (const candidate of queuedCandidates) await connection.addIceCandidate(candidate); queuedCandidates = []; if (data.description.type === 'offer') { const answer = await connection.createAnswer(); await connection.setLocalDescription(answer); socket.emit('signal', { room: currentRoom, data: { description: connection.localDescription } }); } }
  if (data.candidate) { if (peer?.remoteDescription) await peer.addIceCandidate(data.candidate); else queuedCandidates.push(data.candidate); }
}
async function startShare() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, audio: true });
    localPreview.srcObject = localStream; localPreview.style.display = 'block'; emptyStage.classList.add('hidden'); streamBar.classList.remove('hidden'); $('startShare').classList.add('hidden'); $('stopShare').classList.remove('hidden');
    localStream.getVideoTracks()[0].addEventListener('ended', stopShare);
    if (peer) { localStream.getTracks().forEach((track) => peer.addTrack(track, localStream)); await createOffer(); }
  } catch (error) { if (error.name !== 'NotAllowedError') toast('Não foi possível iniciar o compartilhamento.'); }
}
function stopShare() {
  localStream?.getTracks().forEach((track) => track.stop()); localStream = undefined;
  peer?.getSenders().filter((sender) => sender.track).forEach((sender) => peer.removeTrack(sender));
  createOffer().catch(() => {});
  localPreview.srcObject = null; localPreview.style.display = 'none'; streamBar.classList.add('hidden'); $('startShare').classList.remove('hidden'); $('stopShare').classList.add('hidden'); emptyStage.classList.remove('hidden'); emptyTitle.textContent = 'Transmissão encerrada'; emptyCopy.textContent = 'Você pode iniciar um novo compartilhamento quando quiser.';
}
function leaveRoom() { stopShare(); socket?.disconnect(); socket = undefined; peer?.close(); peer = undefined; remoteVideo.srcObject = null; roomScreen.classList.add('hidden'); welcomeScreen.classList.remove('hidden'); }
$('createRoom').addEventListener('click', () => connectToRoom(makeRoomCode(), true));
$('joinRoomForm').addEventListener('submit', (event) => { event.preventDefault(); const code = $('roomCodeInput').value.trim().toUpperCase(); if (code.length < 3) return toast('Digite o código da sala.'); connectToRoom(code, false); });
$('startShare').addEventListener('click', startShare); $('stopShare').addEventListener('click', stopShare); $('leaveRoom').addEventListener('click', leaveRoom);
[$('copyRoomCode'), $('copyRoomCodeLarge')].forEach((button) => button.addEventListener('click', async () => { await navigator.clipboard.writeText(currentRoom); toast('Código copiado.'); }));
