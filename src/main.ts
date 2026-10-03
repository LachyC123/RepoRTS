import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/jacquarda-bastarda-9/400.css';
import '@fontsource/silkscreen/400.css';
import './ui/styles.css';
import { settings } from './core/Settings';
import { GameClient } from './game/GameClient';
import { buildMatchSetup, DEFAULT_CHOICES } from './game/matchSetup';

settings.load();

const params = new URLSearchParams(location.search);
const gameEl = document.getElementById('game')!;

function startMatch() {
  const setup = buildMatchSetup({ ...DEFAULT_CHOICES, seed: params.has('seed') ? Number(params.get('seed')) : undefined, spectate: params.has('spectate') });
  const client = new GameClient(setup, gameEl);
  client.start();
  (window as unknown as { client: GameClient }).client = client;
}

startMatch();
