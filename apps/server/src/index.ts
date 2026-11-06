// Colyseus 0.18 server entry — default transport (internal router handles
// matchmaking HTTP routes + WebSocket upgrade). Bind to PORT (default 2567).
// Fase 4: room-by-code — "game_<CODE>" room types didaftarkan on-demand lewat matchMaker.
import { Server, matchMaker } from 'colyseus';
import { GameRoom } from './rooms/GameRoom.js';

const PORT = Number(process.env.PORT ?? 2567);

const gameServer = new Server();

gameServer.define('game', GameRoom);

// Patch matchmake handler: roomName "game_<CODE>" di-daftarkan on-demand sebagai
// room type dengan options default sama, sehingga joinOrCreate('game_ABC') jalan.
const rawInvoke = matchMaker.controller.invokeMethod.bind(matchMaker.controller) as
  (method: string, roomName: string, options?: unknown, auth?: unknown) => Promise<unknown>;
matchMaker.controller.invokeMethod = async (method, roomName, options, auth) => {
  if (roomName.startsWith('game_') && !matchMaker.getRoomClass(roomName)) {
    matchMaker.defineRoomType(roomName, GameRoom);
    console.log(`[server] registered dynamic room type: ${roomName}`);
  }
  return rawInvoke(method, roomName, options, auth);
};

gameServer.listen(PORT).then(() => {
  console.log(`Colyseus server on ws://localhost:${PORT}`);
});

