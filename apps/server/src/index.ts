// Colyseus 0.18 server entry — default transport (internal router handles
// matchmaking HTTP routes + WebSocket upgrade). Bind to PORT (default 2567).
import { Server } from 'colyseus';
import { GameRoom } from './rooms/GameRoom.js';

const PORT = Number(process.env.PORT ?? 2567);

const gameServer = new Server();

gameServer.define('game', GameRoom);

gameServer.listen(PORT).then(() => {
  console.log(`Colyseus server on ws://localhost:${PORT}`);
});
