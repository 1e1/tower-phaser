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
// Optional override for the host advertised in the QR code. Useful when the
// auto-detected IP is unreachable from phones (e.g. a Docker bridge address
// like 172.17.x.x) or to point at a fixed name/IP behind a reverse proxy.
const PUBLIC_HOST = process.env.PUBLIC_HOST || null;
// Explicit override always wins; otherwise fall back to the detected LAN IP.
const ADVERTISED_HOST = PUBLIC_HOST || LAN_IP;

const app = express();
app.use(express.static(DIST));
// Lightweight health/diagnostic endpoint, declared BEFORE the SPA fallback so it
// is actually reached. If this returns JSON, the Node process is the one serving
// requests (and you can read its pid); if it returns index.html or a platform
// 404, requests are being served statically and the WebSocket has no backend.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, pid: process.pid, uptime: Math.round(process.uptime()) });
});
// SPA fallback for any non-asset route.
app.get(/.*/, (_req, res) => res.sendFile(join(DIST, 'index.html')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// --- heartbeat -------------------------------------------------------------
// Browsers answer protocol-level pings automatically. Pinging every 30s keeps
// otherwise-idle lobby connections alive through reverse proxies that drop idle
// sockets, and lets us terminate connections that have silently died (so a TV
// whose socket is really gone disposes its room instead of lingering).
const HEARTBEAT_MS = 30_000;
const heartbeat = function () {
  this.isAlive = true;
};
const pinger = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(pinger));

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
  socket.isAlive = true;
  socket.on('pong', heartbeat);

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
      send(socket, { t: 'hosted', code, role: 'tv', lanIp: ADVERTISED_HOST, publicHost: PUBLIC_HOST });
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
      if (socket.room) socket.room.setConfig(socket, msg);
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
  if (ADVERTISED_HOST) {
    const tag = PUBLIC_HOST ? ' (PUBLIC_HOST override)' : '';
    // eslint-disable-next-line no-console
    console.log(`Reachable on the local network at http://${ADVERTISED_HOST}:${PORT}${tag}`);
  }
});
