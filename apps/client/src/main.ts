// Fase 4: menu utama (nickname, mode, room code) → connect → play. Entry point.
import { Game } from './core/game.js';

const canvas = document.getElementById('game') as HTMLCanvasElement | null
  ?? ((): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.id = 'game';
    document.body.appendChild(c);
    return c;
  })();

const game = new Game(canvas);
game.start();
(window as unknown as { __game: Game }).__game = game; // dev/test hook

// --- menu wiring ---
const $ = (id: string) => document.getElementById(id)!;
const menu = $('menu');
const statusEl = $('menu-status') as HTMLElement;
const nickInput = $('menu-nick') as HTMLInputElement;
const modeSel = $('menu-mode') as HTMLSelectElement;
const codeInput = $('menu-code') as HTMLInputElement;

// restore saved settings (localStorage)
nickInput.value = localStorage.getItem('fps.nick') ?? '';
modeSel.value = localStorage.getItem('fps.mode') ?? 'ffa';
codeInput.value = localStorage.getItem('fps.code') ?? '';

// auto-fill nick from URL (?nick=) for testing
const urlNick = new URLSearchParams(location.search).get('nick');
if (urlNick) nickInput.value = urlNick;

async function play() {
  const nick = nickInput.value.trim().slice(0, 16) || `P${Math.floor(Math.random() * 900 + 100)}`;
  const mode = modeSel.value;
  const code = codeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  localStorage.setItem('fps.nick', nick);
  localStorage.setItem('fps.mode', mode);
  localStorage.setItem('fps.code', code);
  statusEl.textContent = 'Connecting…';
  (document.querySelector('#menu-play') as HTMLButtonElement).disabled = true;
  try {
    await game.connect(nick, { mode, roomCode: code || undefined });
    statusEl.textContent = 'Connected ✓';
    menu.style.display = 'none';
    ($('lock-hint') as HTMLElement).style.display = 'flex';
  } catch (e) {
    statusEl.textContent = `Gagal connect: ${(e as Error).message}`;
    (document.querySelector('#menu-play') as HTMLButtonElement).disabled = false;
  }
}

(document.querySelector('#menu-play') as HTMLButtonElement).addEventListener('click', play);
nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
