import Phaser from 'phaser';
import GameScene, { GAME_W, GAME_H, Tool } from './GameScene';

export const scene = new GameScene();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#3a7d44',
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
  scene,
});

// ---- Toolbar (plain DOM; the scene exposes a handful of methods) ----

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'));
const buildTools = $('#build-tools');
const modeBtn = $<HTMLButtonElement>('#mode');
const restartBtn = $<HTMLButtonElement>('#restart');
const hint = $('#hint');

const HINTS: Record<Tool, string> = {
  road: 'Click or drag on the canvas to lay road points. "Undo point" removes the last one.',
  checkpoint: 'Click on the road to add a checkpoint. They must be passed in numbered order.',
  finish: 'Click on the road to set the finish line (the car starts at the green START dot).',
  blocker: 'Click anywhere to drop a blocker.',
  erase: 'Click a blocker, checkpoint or finish line to remove it. Right-click erases with any tool.',
};

function sync() {
  const racing = scene.mode === 'race';
  buildTools.hidden = racing;
  restartBtn.hidden = !racing;
  modeBtn.textContent = racing ? 'Back to Build' : 'Start Race';
  hint.textContent = racing ? 'Drive with WASD or arrow keys. R restarts the race.' : HINTS[scene.tool];
  toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === scene.tool));
}

toolButtons.forEach((b) => (b.onclick = () => ((scene.tool = b.dataset.tool as Tool), sync())));
$('#undo').onclick = () => scene.undoPoint();
$('#clear').onclick = () => scene.clearTrack();
restartBtn.onclick = () => scene.restartRace();
modeBtn.onclick = () => {
  if (scene.mode === 'race') scene.enterBuild();
  else scene.startRace();
  sync();
};
// Don't leave a button focused, so keyboard input goes to the game.
$('#toolbar').addEventListener('click', (e) => (e.target as HTMLElement).blur());

sync();
