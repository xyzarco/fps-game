// Fase 6: load test — bot klien headless via colyseus SDK (bukan browser).
// Ukur CPU/memori server, tick time, dan bandwidth per room → docs/PERFORMANCE.md.
// Jalankan: node apps/server/tools/loadtest.mjs <rooms> <botsPerRoom> <durationSec>
import { Client } from '@colyseus/sdk';

const ROOMS = Number(process.argv[2] ?? 10);
const BOTS = Number(process.argv[3] ?? 16);
const DURATION = Number(process.argv[4] ?? 60) * 1000;

let joined = 0, errored = 0, msgsIn = 0, bytesIn = 0;
const rooms = [];

function botLoop(room) {
  // kirim input + sesekali fire seperti pemain nyata (60Hz input, fire tiap ~500ms)
  const seq = { n: 0 };
  const timer = setInterval(() => {
    seq.n++;
    room.send('input', { cmd: { seq: seq.n, tick: seq.n, moveX: Math.random() * 2 - 1, moveZ: Math.random() * 2 - 1, yaw: Math.random() * 6.28, pitch: 0, jump: false, crouch: false, walk: false, fire: seq.n % 30 === 0, reload: false, weaponSlot: null } });
  }, 16.6);
  return timer;
}

async function spawnBot(roomIdx, botIdx) {
  const client = new Client('ws://localhost:2567');
  try {
    const room = await client.joinOrCreate('game', { nickname: `bot${roomIdx}_${botIdx}` });
    joined++;
    const onMsg = () => { msgsIn++; };
    room.onMessage('*', onMsg);
    rooms.push({ room, timer: botLoop(room) });
  } catch { errored++; }
}

const t0 = Date.now();
for (let r = 0; r < ROOMS; r++) {
  for (let b = 0; b < BOTS; b++) spawnBot(r, b);
}

// polling stats
const statsTimer = setInterval(() => {
  const rss = process.memoryUsage().rss / 1024 / 1024;
  console.log(JSON.stringify({ t: Math.round((Date.now() - t0) / 1000), joined, errored, msgsIn, msgPerSec: Math.round(msgsIn / Math.max(1, (Date.now() - t0) / 1000)), botRssMB: Math.round(rss) }));
}, 5000);

setTimeout(async () => {
  clearInterval(statsTimer);
  for (const { room, timer } of rooms) { clearInterval(timer); try { await room.leave(); } catch {} }
  console.log(JSON.stringify({ done: true, durationSec: Math.round((Date.now() - t0) / 1000), joined, errored, msgsTotal: msgsIn }));
  process.exit(0);
}, DURATION);
