const { createServer } = require('node:http');
const { Server } = require('socket.io');
const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: '*' } });
io.on('connection', (socket) => {
  socket.on('join-room', ({ room, role }) => {
    if ((io.sockets.adapter.rooms.get(room)?.size || 0) >= 2) return socket.emit('room-full');
    socket.join(room); socket.data.room = room; socket.data.role = role; socket.to(room).emit('peer-joined', { role });
  });
  socket.on('signal', ({ room, data }) => socket.to(room).emit('signal', { data }));
  socket.on('disconnect', () => { if (socket.data.room) socket.to(socket.data.room).emit('peer-left'); });
});
const port = Number(process.env.PORT || 3000);
httpServer.listen(port, () => console.log(`ScreenLink signaling server listening on :${port}`));
