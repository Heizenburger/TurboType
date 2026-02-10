const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let waitingPlayer = null;

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        socket.username = username;
        
        if (waitingPlayer) {
            const roomName = `room_${waitingPlayer.id}_${socket.id}`;
            socket.join(roomName);
            waitingPlayer.join(roomName);

            // Notify both players to start
            io.to(roomName).emit('matchFound', {
                players: [
                    { id: waitingPlayer.id, name: waitingPlayer.username },
                    { id: socket.id, name: socket.username }
                ]
            });
            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            socket.emit('waiting', 'Searching for opponent...');
        }
    });

    socket.on('updateProgress', (data) => {
        // Broadcast typing progress to the opponent in the room
        socket.to(Array.from(socket.rooms)[1]).emit('opponentProgress', data);
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));