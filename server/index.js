import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

import express from 'express';
import { WebSocketServer } from 'ws';

import Room from './Room.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const PORT = process.env.PORT || 3000;

// First non-internal IPv4 address, so phones can be told a reachable host
// instead of "localhost" (e.g. in the QR code shown on the TV).
function lanIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}
const LAN_IP = lanIp();

const app = express();
app.use(express.static(DIST));
// SPA fallback for any non-asset route.
app.get(/.*/, (_req, res) => res.sendFile(join(DIST, 'index.html')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// --- room registry ---------------------------------------------------------
const rooms = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function newCode() {
  let code;
  do {
    code = Array.from(
      { length: 4 },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join('');
  } while (rooms.has(code));
  return code;
}

function send(socket, msg) {
  if (socket.readyState === 1) socket.send(JSON.stringify(msg));
}

wss.on('connection', (socket) => {
  socket.room = null;

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handle(socket, msg);
  });

  socket.on('close', () => {
    if (socket.room) socket.room.removeSocket(socket);
  });
});

function handle(socket, msg) {
  switch (msg.t) {
    case 'host': {
      const code = newCode();
      const room = new Room(code, (c) => rooms.delete(c));
      rooms.set(code, room);
      socket.room = room;
      socket.role = 'tv';
      room.addTv(socket);
      send(socket, { t: 'hosted', code, role: 'tv', lanIp: LAN_IP });
      break;
    }

    case 'join': {
      const room = rooms.get((msg.code || '').toUpperCase());
      if (!room) {
        send(socket, { t: 'error', msg: 'Room not found' });
        return;
      }
      socket.room = room;
      socket.name = msg.name || 'Player';
      const res = room.addParticipant(socket, socket.name);
      send(socket, { t: 'joined', code: room.code, ...res });
      break;
    }

    case 'config':
      if (socket.room) socket.room.setConfig(socket, msg.rounds, msg.biomeId, msg.hp);
      break;

    case 'name':
      if (socket.room) socket.room.rename(socket, msg.name);
      break;

    case 'aim':
      if (socket.room) socket.room.handleAim(socket, msg.angle, msg.power);
      break;

    case 'ready':
      if (socket.room) socket.room.handleReady(socket, msg.value !== false);
      break;

    case 'shell':
      if (socket.room) socket.room.handleShell(socket, msg.id);
      break;

    case 'sync':
      if (socket.room) socket.room.sendRoster();
      break;

    case 'playAgain':
      if (socket.room) socket.room.playAgain(socket);
      break;

    case 'leave':
      if (socket.room) socket.room.leave(socket);
      break;

    default:
      break;
  }
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Tower Duel server listening on http://localhost:${PORT}`);
  if (LAN_IP) {
    // eslint-disable-next-line no-console
    console.log(`Reachable on the local network at http://${LAN_IP}:${PORT}`);
  }
});
