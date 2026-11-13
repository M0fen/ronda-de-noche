import './style.css';
import { Game } from './game';

const game = new Game();
game.init().catch(err => {
  console.error(err);
  const el = document.getElementById('boot-error');
  if (el) { el.hidden = false; el.textContent = 'Este navegador no pudo iniciar el juego: necesita WebGL.'; }
});
