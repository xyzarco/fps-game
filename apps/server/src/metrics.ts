// Fase 6: metrik dasar & logging terstruktur. Per-room stats diukur di GameRoom; /metrics membacanya.
export interface RoomMetrics {
  roomId: string;
  tickTimeMsLast: number;
  tickTimeMsAvg: number;
  tickTimeMsMax: number;
  tickOverrunPct: number;      // % tick yang melebihi budget (16.6ms)
  messagesPerSec: number;
}

/** Stats global process (window 600 tick ~10 dtk). */
class Metrics {
  private tickTimes: number[] = [];
  tickBudgetMs = 1000 / 60; // 16.67

  recordTick(elapsedMs: number) {
    this.tickTimes.push(elapsedMs);
    if (this.tickTimes.length > 600) this.tickTimes.shift();
  }

  summarize(): { last: number; avg: number; max: number; overrunPct: number } {
    const times = this.tickTimes;
    if (!times.length) return { last: 0, avg: 0, max: 0, overrunPct: 0 };
    const last = times[times.length - 1]!;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    const overrun = times.filter((t) => t > this.tickBudgetMs).length;
    return { last: round1(last), avg: round1(avg), max: round1(max), overrunPct: round1((overrun / times.length) * 100) };
  }

  roomMetrics(roomId: string): RoomMetrics {
    const s = this.summarize();
    return {
      roomId,
      tickTimeMsLast: s.last,
      tickTimeMsAvg: s.avg,
      tickTimeMsMax: s.max,
      tickOverrunPct: s.overrunPct,
      messagesPerSec: 0,
    };
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export const metrics = new Metrics();

/** Structured logger: single-line JSON ke stdout (mudah di-ingest Loki/Docker). */
export const log = (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
};
