// Fase 2: multiplayer core. Entry point.
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
const nick = new URLSearchParams(location.search).get('nick') ?? `P${Math.floor(Math.random() * 900 + 100)}`;
game.connect(nick).catch((e) => console.warn('server offline — sandbox mode', e));
(window as unknown as { __game: Game }).__game = game; // dev/test hook
console.log('Fase 2: multiplayer core OK, nick =', nick);
