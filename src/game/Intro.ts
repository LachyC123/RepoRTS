import { audio } from '../audio';
import { TILE } from '../data/constants';
import type { GameClient } from './GameClient';
import { el, onPress } from '../ui/hud/dom';

/**
 * Opening cinematic: letterboxed camera tour over the valley's landmarks with title cards,
 * ending with a drop onto the player's capital. Skippable.
 */
export function playIntro(client: GameClient, root: HTMLElement, done: () => void) {
  const scene = client.scene!;
  const cam = scene.camCtl;
  const w = client.world;
  scene.frozenSim = true;
  client.cinematic = true;
  client.ui.emit('cinematic', { on: true });
  // the tour shows the whole valley, so the fog is only a light veil until play begins
  scene.fog.fadeTo(0.22, 0);
  const top = el('div', 'letterbox top out', root);
  const bot = el('div', 'letterbox bottom out', root);
  const text = el('div', 'cine-text', root);
  const skip = el('button', 'hud-btn skip', root, 'SKIP ▸▸') as HTMLButtonElement;
  requestAnimationFrame(() => {
    top.classList.remove('out');
    bot.classList.remove('out');
  });
  const byName = (n: string) => w.settlements.find((s) => s.name === n);
  const stops = w.mapDef.tour.map(byName).filter((s): s is NonNullable<typeof s> => !!s);
  const lines: [string, boolean][] = [
    ['YEAR 846', true],
    ['Four kingdoms claim this valley.', false],
    ['Only one will rule it.', false],
  ];
  let finished = false;
  const timers: number[] = [];
  const say = (t: string, small: boolean, at: number, dur: number) => {
    timers.push(
      window.setTimeout(() => {
        text.textContent = t;
        text.classList.toggle('small', small);
        text.classList.add('show');
      }, at),
    );
    timers.push(window.setTimeout(() => text.classList.remove('show'), at + dur));
  };
  // start high over the valley
  cam.x = (w.map.w * TILE) / 2;
  cam.y = (w.map.h * TILE) / 2;
  cam.zoom = cam.targetZoom = Math.max(cam.minZoom, cam.fitZoom() * 1.1);
  let t = 900;
  const legs = stops.slice(0, 5);
  legs.forEach((s, i) => {
    timers.push(
      window.setTimeout(() => {
        scene.terrain.prioritize(s.cx, s.cy);
        cam.flyTo(s.cx, s.cy, 1.5 + (i % 2) * 0.3, 2.2, (k) => k * k * (3 - 2 * k));
      }, t),
    );
    t += 2300;
  });
  say(lines[0][0], lines[0][1], 1000, 2600);
  say(lines[1][0], lines[1][1], 4200, 3400);
  say(lines[2][0], lines[2][1], 8200, 3000);
  const [px, py] = client.startFocus();
  timers.push(
    window.setTimeout(() => {
      scene.terrain.prioritize(px, py);
      cam.flyTo(px, py, cam.normalZoom(), 2.4, (k) => 1 - Math.pow(1 - k, 3));
      scene.fog.fadeTo(1, 2200);
      text.textContent = 'Your kingdom begins.';
      text.classList.remove('small');
      text.classList.add('show');
      audio.play('horn_victory', { volume: 0.5 });
    }, t),
  );
  t += 2900;
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const id of timers) clearTimeout(id);
    text.classList.remove('show');
    top.classList.add('out');
    bot.classList.add('out');
    skip.remove();
    cam.cancelFly();
    scene.fog.fadeTo(1, 400);
    cam.x = px;
    cam.y = py;
    cam.zoom = cam.targetZoom = cam.normalZoom();
    setTimeout(() => {
      top.remove();
      bot.remove();
      text.remove();
    }, 900);
    scene.frozenSim = false;
    client.cinematic = false;
    client.ui.emit('cinematic', { on: false });
    done();
  };
  timers.push(window.setTimeout(finish, t));
  onPress(skip, finish, { sound: () => audio.play('ui_click') });
}
