// Fase 1: single-player core. Entry point.
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
console.log('Fase 1: single-player core OK');
