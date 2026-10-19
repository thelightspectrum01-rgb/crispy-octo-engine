import { App } from './game/app.js';

const root = document.getElementById('app');
const app = new App(root);
app.init().catch((err) => {
  console.error(err);
  const msg = /webgl/i.test(String(err && err.message))
    ? 'Your browser could not create a WebGL context. Try enabling hardware acceleration or use a recent version of Chrome, Edge, Firefox or Safari.'
    : String((err && err.message) || err);
  app.ui ? app.ui.fatal(msg) : (document.getElementById('fatal-msg').textContent = msg, document.getElementById('fatal').classList.add('show'));
});
