import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/jacquarda-bastarda-9/400.css';
import '@fontsource/silkscreen/400.css';
import './ui/styles.css';
import { audio } from './audio';
import { settings } from './core/Settings';
import { App } from './game/App';

settings.load();
audio.setVolumes(settings.data.master, settings.data.music, settings.data.sfx);
settings.onChange((d) => audio.setVolumes(d.master, d.music, d.sfx));
document.documentElement.style.setProperty('--ui-scale', String(settings.data.uiScale));

const app = new App(document.getElementById('game')!, document.getElementById('ui')!);
(window as unknown as { app: App }).app = app;
// fonts first so canvas text and the title render correctly
const fontsReady = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => app.start());
