import { escape } from './format.js';

const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
function matchScore(item, query) {
  const title = normalize(item.title), id = normalize(item.reference);
  const haystack = normalize([item.title, item.reference, item.detail, item.keywords].join(' '));
  if (!query.split(/\s+/).every(word => haystack.includes(word))) return -1;
  return (id === query ? 100 : id.startsWith(query) ? 60 : 0) + (title === query ? 80 : title.startsWith(query) ? 40 : title.includes(query) ? 20 : 0);
}

export function createCommandMenu({ getItems, onSelect, onToggle }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'command-menu';
  dialog.setAttribute('aria-label', 'Search and commands');
  dialog.innerHTML = `<div class="command-search"><input type="text" placeholder="Search tasks, projects, or commands…" aria-label="Search tasks, projects, or commands" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" autocomplete="off" spellcheck="false"><button type="button" class="command-dismiss" aria-label="Close command menu"><kbd>Esc</kbd></button></div><div id="command-results" class="command-results" role="listbox" aria-label="Results"></div><footer class="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Open</span><span class="command-count" role="status" aria-live="polite"></span></footer>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input'), results = dialog.querySelector('.command-results');
  const count = dialog.querySelector('.command-count');
  let items = [], matches = [], active = 0, previousFocus = null;
  const isOpen = () => dialog.open;
  function select(index, scroll = false) {
    active = index;
    for (const row of results.querySelectorAll('[role="option"]')) row.setAttribute('aria-selected', String(Number(row.dataset.index) === active));
    const selected = results.querySelector(`[data-index="${active}"]`);
    if (selected) {
      input.setAttribute('aria-activedescendant', selected.id);
      if (scroll) selected.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function render() {
    const query = normalize(input.value.trim());
    const ranked = items.map((item, index) => ({ item, index, score: query ? matchScore(item, query) : 0 }))
      .filter(({ item, score }) => score >= 0 && (query || item.suggested))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const groups = new Map();
    for (const { item } of ranked.slice(0, 60)) {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    }
    matches = [...groups.values()].flat(); active = 0;
    let index = 0;
    results.innerHTML = [...groups].map(([group, rows], groupIndex) => `<section class="command-group" role="group" aria-labelledby="command-group-${groupIndex}"><h2 id="command-group-${groupIndex}">${escape(group)}</h2>${rows.map(item => {
      const rowIndex = index++;
      return `<div id="command-result-${rowIndex}" class="command-option" role="option" aria-selected="false" data-index="${rowIndex}"><span class="command-label"><span class="command-title">${escape(item.title)}</span>${item.detail ? `<span class="command-detail">${escape(item.detail)}</span>` : ''}</span>${item.reference ? `<span class="command-reference">${escape(item.reference)}</span>` : ''}${item.keys ? `<span class="command-keys" aria-hidden="true">${item.keys.map(key => `<kbd>${escape(key)}</kbd>`).join('')}</span>` : ''}</div>`;
    }).join('')}</section>`).join('') || '<p class="command-empty">No results. Try a task ID, title, or project name.</p>';
    count.textContent = ranked.length > matches.length ? `${matches.length} of ${ranked.length} results` : `${matches.length} result${matches.length === 1 ? '' : 's'}`;
    results.scrollTop = 0;
    select(0);
  }
  function close(restoreFocus = true) {
    if (!isOpen()) return;
    dialog.close(); onToggle(false);
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  function open() {
    items = getItems();
    if (!items.length) return;
    previousFocus = document.activeElement;
    input.value = ''; render();
    dialog.showModal(); onToggle(true);
    input.focus({ preventScroll: true });
  }
  function activate(index = active) {
    const item = matches[index];
    if (!item) return;
    close(false); onSelect(item);
  }
  input.addEventListener('input', render);
  dialog.querySelector('.command-dismiss').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  // Only a click entirely outside the panel dismisses it (not a dragged selection).
  let backdropDown = false;
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  dialog.addEventListener('pointerdown', event => { backdropDown = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => {
    if (backdropDown && event.target === dialog && outside(event)) close();
    backdropDown = false;
    const row = event.target.closest('[data-index]');
    if (row) activate(Number(row.dataset.index));
  });
  results.addEventListener('pointermove', event => {
    const row = event.target.closest('[data-index]');
    if (row && event.pointerType !== 'touch') select(Number(row.dataset.index));
  });
  // Own keyboard input while the modal is open, including Left/Right editing.
  window.addEventListener('keydown', event => {
    const shortcut = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k';
    if (shortcut && !event.isComposing) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) { if (isOpen()) close(); else open(); }
      return;
    }
    if (!isOpen()) return;
    event.stopImmediatePropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length) select((active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length, true);
    } else if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) activate(); }
    else if (event.key === 'Tab') event.preventDefault();
  }, true);
  return { isOpen, close };
}
