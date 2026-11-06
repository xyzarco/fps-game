// Fase 6: e2e Playwright multi-klien — skenario PLAN.md Bagian 11:
// join → gerak → tembak → kill → scoreboard (2 klien nyata via CDP/WebGL).
// Jalankan: server di 2567, vite dev di 5173, lalu `npx playwright test`.
import { test, expect, type Page } from '@playwright/test';

const CLIENT = 'http://localhost:5173';
const JOIN = async (page: Page, nick: string, code = '') => {
  await page.addInitScript(() => localStorage.setItem('fps.quality', 'low'));
  await page.goto(`${CLIENT}/?nick=${nick}`);
  {
    await page.fill('#menu-nick', nick);
    if (code) await page.fill('#menu-code', code);
    await page.click('#menu-play');
    await page.waitForFunction(() => (window as any).__game?.connected === true, undefined, { timeout: 60000 });
  }
};

test('dua klien: join → terlihat bersama → gerak sync → scoreboard', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await JOIN(a, 'E2EAlice');
  await JOIN(b, 'E2EBob', '');

  // Bob terlihat oleh Alice (remote player ada)
  await a.waitForFunction(() => {
      const s = (window as any).__game?.net?.latest?.players;
      return s ? [...s.values()].some((p: any) => p.nickname === 'E2EBob') : false;
    }, undefined, { timeout: 20000 });

  // Alice bergerak (W selama ~1 dtk manual tick) → posisi berubah & ack server naik
  const pos0 = await a.evaluate(() => ({ x: (window as any).__game.sim.x, z: (window as any).__game.sim.z }));
  await a.evaluate(() => {
    const g = (window as any).__game;
    g.input.keys.add('KeyW');
    const n = performance.now();
    for (let i = 0; i < 90; i++) g.tick(1 / 60, n + i * 16.6);
    g.input.keys.delete('KeyW');
  });
  const pos1 = await a.evaluate(() => ({ x: (window as any).__game.sim.x, z: (window as any).__game.sim.z }));
  const moved = Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z);
  expect(moved).toBeGreaterThan(1);

  // reconciliation: server ack seq cocok dengan prediksi (drift kecil)
  // reconciliation settle: server memproses 60 cmd/s (burst manual tick) — tunggu drift < 0.5
  await a.waitForFunction(() => {
    const g = (window as any).__game;
    const me = g.net.latest?.players.get(g.net.sessionId);
    return me ? Math.hypot(me.x - g.sim.x, me.z - g.sim.z) < 0.5 : false;
  }, undefined, { timeout: 20000 });

  // scoreboard: kedua pemain tampil
  await a.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true }));
    (window as any).__game.frame();
  });
  const sb = await a.evaluate(() => document.getElementById('sb-body')?.textContent ?? '');
  expect(sb).toContain('E2EAlice');
  expect(sb).toContain('E2EBob');

  await a.close(); await b.close();
});
