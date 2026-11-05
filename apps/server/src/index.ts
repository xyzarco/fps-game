import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { GameRoom } from './rooms/GameRoom.js';

const PORT = Number(process.env.PORT ?? 2567);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('fps-game server');
});
const wss = new WebSocketServer({ server });

const room = new GameRoom();
room.onMessageToClient = (id, data) => { wsById.get(id)?.send(data); };

const wsById = new Map<string, WebSocket>();
let nextId = 1;

wss.on('connection', (ws) => {
  const id = `p${nextId++}`;
  wsById.set(id, ws);
  room.join(id);
  ws.on('message', (buf) => {
    try { room.onClientMessage(id, JSON.parse(buf.toString())); }
    catch (e) { console.error('bad msg', e); }
  });
  ws.on('close', () => { wsById.delete(id); room.leave(id); });
});

server.listen(PORT, () => console.log(`Game server on ws://localhost:${PORT}`));
