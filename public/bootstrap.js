// This small, dependency-free entry can report a failed app-module import.
(() => {
  let ready = false;
  const app = document.querySelector('#app');
  const panel = document.createElement('section');
  panel.className = 'startup-error'; panel.hidden = true; panel.setAttribute('role', 'alert');
  const heading = document.createElement('h1'); heading.textContent = 'Torch could not open';
  const detail = document.createElement('p'); detail.textContent = 'Reload to try again. If it keeps happening, run torch doctor in your terminal.';
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-link'; retry.textContent = 'Reload';
  retry.addEventListener('click', () => location.reload());
  panel.append(heading, detail, retry); document.body.append(panel);
  function failed() { if (!ready) { app.hidden = true; panel.hidden = false; } }
  const timeout = setTimeout(failed, 12000);
  window.addEventListener('torch-ready', () => {
    ready = true; clearTimeout(timeout); panel.remove(); app.hidden = false;
  }, { once: true });
  window.addEventListener('torch-startup-error', failed);
  import('./app.js').catch(error => { console.error('Torch startup failed:', error); failed(); });
})();
