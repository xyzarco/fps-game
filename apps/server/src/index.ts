// Colyseus 0.18 server entry — default transport (internal router handles
// matchmaking HTTP routes + WebSocket upgrade). Bind to PORT (default 2567).
// Fase 4: room-by-code — "game_<CODE>" room types didaftarkan on-demand lewat matchMaker.
// Fase 6: /metrics endpoint (JSON di metricsPort), origin check, connection rate limit.
import http from 'node:http';
import { Server, matchMaker, Room } from 'colyseus';
import { GameRoom } from './rooms/GameRoom.js';
import { metrics, log } from './metrics.js';

const PORT = Number(process.env.PORT ?? 2567);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim());

// --- connection rate limit (Fase 6): maks N koneksi/menit per IP ---
const joinCounts = new Map<string, { count: number; windowStart: number }>();
const JOIN_LIMIT_PER_MIN = Number(process.env.JOIN_LIMIT_PER_MIN ?? 60);
const ipKey = (req: http.IncomingMessage) =>
  (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '?';

function rateLimited(req: http.IncomingMessage): boolean {
  const key = ipKey(req);
  const now = Date.now();
  const rec = joinCounts.get(key);
  if (!rec || now - rec.windowStart > 60_000) {
    joinCounts.set(key, { count: 1, windowStart: now });
    return false;
  }
  rec.count++;
  if (rec.count > JOIN_LIMIT_PER_MIN) {
    log('warn', 'rate_limited', { ip: key, count: rec.count });
    return true;
  }
  return false;
}

const gameServer = new Server();

// Origin check + rate limit di level upgrade WebSocket (attach ke underlying HTTP server)
const transport = (gameServer as unknown as { transport: { server: http.Server } }).transport;
if (transport?.server) {
  transport.server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS[0] !== '*' && origin && !ALLOWED_ORIGINS.includes(origin)) {
      log('warn', 'origin_rejected', { origin });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (rateLimited(req)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
    }
  });
}

gameServer.define('game', GameRoom);

// Patch matchmake handler: roomName "game_<CODE>" di-daftarkan on-demand sebagai
// room type dengan options default sama, sehingga joinOrCreate('game_ABC') jalan.
const rawInvoke = matchMaker.controller.invokeMethod.bind(matchMaker.controller) as
  (method: string, roomName: string, options?: unknown, auth?: unknown) => Promise<unknown>;
matchMaker.controller.invokeMethod = async (method, roomName, options, auth) => {
  if (roomName.startsWith('game_') && !matchMaker.getRoomClass(roomName)) {
    matchMaker.defineRoomType(roomName, GameRoom);
    log('info', 'dynamic_room_registered', { roomName });
  }
  return rawInvoke(method, roomName, options, auth);
};

// /metrics (JSON) + /__healthcheck di port terpisah (metricsPort) — tidak menimpa router matchmaking.
const metricsPort = PORT + 1;
http.createServer((req, res) => {
  if (req.url === '/metrics') {
    void (async () => {
      // query() via matchMaker driver: daftar semua room live (roomId, clients, metadata)
      const listed = await matchMaker.query({}).catch(() => []) as Array<Record<string, unknown>>;
      const out = listed.map((r) => ({
        roomId: r.roomId,
        roomName: r.name,
        clients: r.clients,
        maxClients: r.maxClients,
        metadata: r.metadata,
        tick: metrics.roomMetrics(String(r.roomId ?? '?')),
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ts: new Date().toISOString(), rooms: out }, null, 2));
    })();
    return;
  }
  if (req.url === '/__healthcheck') { res.writeHead(200); res.end('OK'); return; }
  res.writeHead(404); res.end();
}).listen(metricsPort, () => log('info', 'metrics_http_up', { port: metricsPort }));

gameServer.listen(PORT).then(() => {
  log('info', 'server_up', { port: PORT, allowedOrigins: ALLOWED_ORIGINS });
});
