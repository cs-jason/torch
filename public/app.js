import { compareTaskPriority } from './task-order.js';
import { escape } from './format.js';
import { taskReference } from './task-reference.js';
import { createViews } from './views.js';
import { createMotion, disclosureOpen } from './motion.js';
import { viewKey } from './view-state.js';
import { installProjectReorder } from './project-drag.js';
import { createSoundPlayer } from './sounds.js';
import { createCommandMenu } from './command-menu.js';
import { createDocumentTrail } from './document-trail.js';

const root = document.querySelector('#app');
let data, token, stateEtag, renderedKey, navigationKey, polling = false, settingsBusy = false, startupReady = false;
const taskDetails = new Map();
const soundsEnabled = () => data?.dashboard?.uiSounds === true;
const sounds = createSoundPlayer(soundsEnabled);
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, event => {
  if (event.isTrusted && soundsEnabled()) void sounds.unlock();
}, true);
window.addEventListener('blur', () => sounds.stop());
document.addEventListener('visibilitychange', () => { if (document.hidden) sounds.stop(); });
let projectBusy = false, draggingProject = false, refreshPending = false;
const refreshWaiters = [];
const groupStates = new Map();
const copiedItems = new Map();
let taskList = history.state?.torchTaskList || null, keyboardSelection = '', restoreFocus = false;
let keyboardRegion = 'tasks', pendingTaskEntry = false;
let previousHash = location.hash;
let pendingNavigationMotion = null;
let renderedHash, renderVersion = 0, renderRequest = 0;
let commandMenu;
const documentTrail = createDocumentTrail();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const taskMarker = document.createElement('div');
taskMarker.className = 'task-marker'; taskMarker.hidden = true; taskMarker.setAttribute('aria-hidden', 'true');
document.body.append(taskMarker);
let taskInput = 'pointer', hoveredTask = null, markedTask = null, pointerPosition = null;
let keyboardActiveUntil = 0, keyboardIdleTimer, restoringTaskFocus = false;
function updateTaskMarker({ animate = true, refreshHover = false } = {}) {
  if (commandMenu?.isOpen()) { taskMarker.hidden = true; return; }
  if (taskInput === 'keyboard' && keyboardRegion === 'projects') {
    markedTask?.classList.remove('task-current'); markedTask = null;
    const link = activeSidebarLink();
    if (!link || Date.now() >= keyboardActiveUntil) { taskMarker.hidden = true; return; }
    const label = link.querySelector('.nav-label') || link;
    const range = document.createRange(); range.selectNodeContents(label);
    const rect = [...range.getClientRects()].at(-1);
    if (!rect) { taskMarker.hidden = true; return; }
    const viewport = link.closest('nav').getBoundingClientRect();
    if (rect.top < viewport.top || rect.bottom > viewport.bottom) { taskMarker.hidden = true; return; }
    positionTaskMarker(rect.right + scrollX + 8, rect.top + scrollY + rect.height / 2 - 3, animate);
    return;
  }
  if (refreshHover && taskInput === 'pointer' && pointerPosition) {
    hoveredTask = document.elementFromPoint(pointerPosition.x, pointerPosition.y)?.closest('.row');
  }
  const focused = document.activeElement?.closest('.row');
  const keyboardRow = focused && root.contains(focused) ? focused : visibleTaskLinks().find(link => link.getAttribute('href') === keyboardSelection)?.closest('.row');
  const row = taskInput === 'pointer' ? hoveredTask : Date.now() < keyboardActiveUntil ? keyboardRow : null;
  const visible = row && root.contains(row) && !row.closest('details:not([open]),details[data-collapsing]') && row.getClientRects().length;
  const sameTask = markedTask === row;
  if (markedTask !== row || !visible) {
    markedTask?.classList.remove('task-current');
    markedTask = visible ? row : null;
    markedTask?.classList.add('task-current');
  }
  if (!visible) { taskMarker.hidden = true; return; }
  // The page animation owns this position until it lands; a different row can take over.
  if (sameTask && taskMarker.getAnimations().some(animation => animation.id === 'task-marker-page' && animation.playState === 'running')) return;
  const rect = row.getBoundingClientRect();
  const idRect = row.querySelector('.task-id').getBoundingClientRect();
  positionTaskMarker(rect.left + scrollX - 22, idRect.top + scrollY + idRect.height / 2 - 3, animate);
}
function positionTaskMarker(x, y, animate) {
  const transform = `translate(${x}px, ${y}px)`;
  if (!taskMarker.hidden && taskMarker.style.transform === transform) return;
  // A new selection takes over from the marker's page-entry animation.
  for (const animation of taskMarker.getAnimations()) if (animation.id === 'task-marker-page') animation.cancel();
  const snap = !animate || taskMarker.hidden || reducedMotion.matches;
  if (snap) taskMarker.style.transition = 'none';
  taskMarker.style.transform = transform;
  taskMarker.hidden = false;
  if (snap) { void taskMarker.offsetWidth; taskMarker.style.removeProperty('transition'); }
}
function markKeyboardActivity() {
  taskInput = 'keyboard'; hoveredTask = null;
  keyboardActiveUntil = Date.now() + 5000;
  clearTimeout(keyboardIdleTimer);
  keyboardIdleTimer = setTimeout(() => { keyboardActiveUntil = 0; updateTaskMarker(); }, 5000);
}
function clearKeyboardActivity() {
  clearTimeout(keyboardIdleTimer); keyboardActiveUntil = 0;
}
function resetTaskSelection() {
  keyboardSelection = ''; restoreFocus = false; clearKeyboardActivity();
  if (document.activeElement?.matches('.row a')) document.activeElement.blur();
  hoveredTask = null; updateTaskMarker();
}
function resetHiddenTaskSelection() {
  if (keyboardRegion === 'projects') return;
  const links = visibleTaskLinks();
  if ((keyboardSelection && !links.some(link => link.getAttribute('href') === keyboardSelection)) ||
      (document.activeElement?.matches('.row a') && !links.includes(document.activeElement))) resetTaskSelection();
}
function showPointer() { document.documentElement.classList.remove('keyboard-navigation'); }
function hidePointer(event) {
  if (event.key.startsWith('Arrow')) document.documentElement.classList.add('keyboard-navigation');
}
function clearTaskActivity() {
  showPointer();
  clearKeyboardActivity();
  hoveredTask = null; pointerPosition = null; updateTaskMarker();
}
window.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  if (pointerPosition?.x === event.clientX && pointerPosition?.y === event.clientY) return;
  showPointer();
  pointerPosition = { x: event.clientX, y: event.clientY };
  const row = event.target.closest('.row');
  if (taskInput === 'pointer' && hoveredTask === row) return;
  clearKeyboardActivity();
  taskInput = 'pointer'; pendingTaskEntry = false; hoveredTask = row; updateTaskMarker();
});
root.addEventListener('pointerdown', event => {
  clearKeyboardActivity();
  keyboardRegion = event.target.closest('.sidebar,.mobile-navigation') ? 'projects' : 'tasks'; pendingTaskEntry = false;
  taskInput = 'pointer'; hoveredTask = event.pointerType === 'touch' ? null : event.target.closest('.row');
  updateTaskMarker();
});
root.addEventListener('pointerleave', () => { pointerPosition = null; hoveredTask = null; updateTaskMarker(); });
root.addEventListener('focusin', event => {
  const link = event.target.closest('.row a');
  if (!restoringTaskFocus && taskInput === 'keyboard') {
    if (link) { keyboardSelection = link.getAttribute('href'); markKeyboardActivity(); }
    else if (keyboardRegion !== 'projects') { clearTimeout(keyboardIdleTimer); keyboardActiveUntil = 0; }
    updateTaskMarker();
  }
});
window.addEventListener('pointerdown', showPointer, true);
window.addEventListener('wheel', showPointer, { passive: true });
document.documentElement.addEventListener('pointerleave', showPointer);
window.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  event.preventDefault(); showPointer();
  const focused = document.activeElement;
  if (root.contains(focused) && !focused.matches('.row a,input,textarea,select,[contenteditable]')) focused.blur();
}, true);
window.addEventListener('scroll', () => updateTaskMarker({ animate: false, refreshHover: true }), { passive: true, capture: true });
window.addEventListener('resize', () => updateTaskMarker({ animate: false, refreshHover: true }));
window.addEventListener('blur', clearTaskActivity);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTaskActivity(); });
const { clearDissolve, hitWall, moveHomeSections, dissolve, setDisclosureOpen } = createMotion({
  root, reducedMotion, updateTaskMarker,
  getTaskMarker: () => markedTask?.isConnected && !taskMarker.hidden ? taskMarker : null,
  isDragging: () => draggingProject, sounds
});
const route = () => {
  const route = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  const project = data?.projects.find(p => p.aliases?.some(alias => alias.id === route.project));
  if (project) {
    const alias = project.aliases.find(alias => alias.id === route.project);
    route.project = project.id;
    if (route.doc && !route.doc.startsWith('/') && !route.doc.startsWith('@')) route.doc = `@${alias.folder}/${route.doc}`;
    else if (route.doc?.startsWith('@')) {
      const [folder, ...parts] = route.doc.slice(1).split('/');
      if (alias.links?.[folder]) route.doc = `@${alias.links[folder]}/${parts.join('/')}`;
    }
  }
  return route;
};
const href = params => '#' + new URLSearchParams(Object.entries(params).filter(([, v]) => v));
function navigateWithMotion(destination, direction, axis = 'y', options = {}) {
  const hash = new URL(destination, location.href).hash;
  if (hash === location.hash) return;
  const documentDirection = documentTrail.prepare(hash, options);
  if (documentDirection) { direction = documentDirection; axis = 'x'; }
  void sounds.play(axis === 'y' || !direction ? 'move' : direction > 0 ? 'open' : 'close');
  pendingNavigationMotion = { hash, direction, axis };
  location.hash = destination;
}
function viewDepth(hash) {
  if (hash === '#help') return 2;
  if (['#settings', '#shortcuts', '#projects', '#archive'].includes(hash)) return 1;
  const r = Object.fromEntries(new URLSearchParams(hash.slice(1)));
  return r.doc ? (r.fromTask ? 2 : 1) : r.task ? 1 : 0;
}
const selected = () => { const r = route(); return data.tasks.find(t => t.id === r.task && t.projectId === r.project); };
const inSettings = () => ['#settings', '#help', '#shortcuts', '#projects'].includes(location.hash);
const inArchive = () => location.hash === '#archive';
const inAll = () => location.hash === '#all';
const inHome = () => !route().project && !route().task && !route().doc && !inSettings() && !inArchive() && !inAll();
const isArchivedWork = task => task.archived || task.status === 'done';
async function activateTaskId(task, target, inRow = false) {
  const project = data.projects.find(project => project.id === task.projectId);
  if (!project) { notice('This project is no longer available. Refresh Torch.'); return; }
  try {
    await navigator.clipboard.writeText(taskReference(task, project));
    if (inRow) notice('Copied to clipboard');
    else showCopied('copy-task', `${task.projectId}:${task.id}`);
    void sounds.play('copy');
  } catch { notice('Clipboard unavailable. Run torch context ' + (task.displayId || task.id)); }
  target.blur();
}
let notificationTimer;
function notice(message) {
  const el = document.querySelector('#notice');
  const change = text => { el.textContent = text; };
  change(message); clearTimeout(notificationTimer); notificationTimer = setTimeout(() => change(''), 5000);
}
async function api(url, body) {
  const res = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Torch-Token': token }, body: JSON.stringify(body) });
  const result = await res.json();
  if (!res.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { status: res.status });
  return result;
}
function nav() {
  const r = route();
  const link = (p, index, fixed = false) => {
    const current = p.id === 'all' ? inAll() : p.id ? r.project === p.id : !r.project && !inSettings() && !inArchive() && !inAll();
    return `<a class="project-nav-link" draggable="false" ${fixed ? '' : `data-project-id="${escape(p.id)}"`} data-project-shortcut="${escape(p.id)}" ${index >= 0 && index < 10 ? `aria-keyshortcuts="Meta+${shortcutNumber(index)}"` : ''} href="${projectHref(p)}" ${current ? 'aria-current="page"' : ''}><span class="nav-label">${escape(p.name)}</span>${shortcutBadge(index)}</a>`;
  };
  const fixed = [{ id: '', name: 'Home', visible: showHome() }, { id: 'all', name: 'All', visible: showAllProjects() }];
  let offset = 0;
  const slots = fixed.map(p => `<div class="fixed-project-slot" data-fixed-view="${p.id || 'home'}" data-visible="${p.visible}" aria-hidden="${!p.visible}" ${p.visible ? '' : 'inert'}><div class="fixed-project-clip">${link(p, p.visible ? offset++ : -1, true)}</div></div>`).join('');
  return `<div class="fixed-project-nav">${slots}</div><div class="project-nav-list" data-project-list>${activeProjects().map((p, index) => link(p, index + offset)).join('')}</div>`;
}
const shortcutNumber = index => (index + 1) % 10;
const shortcutBadge = index => `<span class="nav-shortcut" aria-hidden="true">${index >= 0 && index < 10 ? `⌘${shortcutNumber(index)}` : ''}</span>`;
function updateFixedProjectsVisibility() {
  for (const slot of root.querySelectorAll('.fixed-project-slot')) {
    const visible = slot.dataset.fixedView === 'home' ? showHome() : showAllProjects();
    slot.dataset.visible = String(visible);
    slot.inert = !visible;
    slot.setAttribute('aria-hidden', String(!visible));
  }
  updateProjectShortcuts();
}
function updateProjectShortcuts() {
  const shortcuts = projectShortcuts();
  for (const link of root.querySelectorAll('[data-project-shortcut]')) {
    const index = shortcuts.findIndex(project => project.id === link.dataset.projectShortcut);
    link.querySelector('.nav-shortcut').textContent = index < 0 ? '' : `⌘${shortcutNumber(index)}`;
    if (index < 0) link.removeAttribute('aria-keyshortcuts');
    else link.setAttribute('aria-keyshortcuts', `Meta+${shortcutNumber(index)}`);
  }
}
let commandHeld = false, shortcutHoldTimer;
function showProjectShortcuts(held) {
  if (held === commandHeld) return;
  commandHeld = held; clearTimeout(shortcutHoldTimer);
  if (held) shortcutHoldTimer = setTimeout(() => document.body.classList.toggle('show-project-shortcuts', commandHeld), 1500);
  else document.body.classList.remove('show-project-shortcuts');
}
window.addEventListener('keydown', event => showProjectShortcuts(!commandMenu?.isOpen() && (event.metaKey || event.key === 'Meta')), true);
window.addEventListener('keyup', event => showProjectShortcuts(!commandMenu?.isOpen() && event.metaKey), true);
window.addEventListener('blur', () => showProjectShortcuts(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) showProjectShortcuts(false); });
function sidebarFooter() { return `<nav class="sidebar-footer" aria-label="Workspace pages"><a href="#archive" ${inArchive() ? 'aria-current="page"' : ''}>Archived</a><a href="#settings" ${inSettings() ? 'aria-current="page"' : ''}>Settings</a></nav>`; }
function syncNavigation() {
  const key = JSON.stringify(activeProjects().map(p => [p.id, p.name]));
  if (!root.querySelector('.sidebar')) {
    root.innerHTML = `<aside class="sidebar" aria-label="Workspace"><nav aria-label="Projects">${nav()}</nav>${sidebarFooter()}</aside><div class="mobile-navigation"><details><summary>Projects</summary><nav aria-label="Projects on mobile">${nav()}</nav></details>${sidebarFooter()}</div><div class="shell"><main id="main"></main></div>`;
  } else if (key !== navigationKey) {
    for (const navigation of root.querySelectorAll('nav[aria-label^="Projects"]')) navigation.innerHTML = nav();
  }
  navigationKey = key;
  updateFixedProjectsVisibility();
  const current = inAll() ? 'all' : route().project || (inHome() ? '' : null);
  for (const link of root.querySelectorAll('[data-project-shortcut],.sidebar-footer a')) {
    const selected = link.hasAttribute('data-project-shortcut') ? link.dataset.projectShortcut === current : link.hash === '#settings' ? inSettings() : inArchive();
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (keyboardRegion === 'projects' && taskInput === 'keyboard') { focusSidebarLink(); updateTaskMarker(); }
}
const activeProjects = () => data.projects.filter(p => !p.archivedAt);
const showHome = () => data.dashboard?.showHome !== false;
const showAllProjects = () => data.dashboard?.showAllProjects === true;
const homeLimit = key => Number.isSafeInteger(data.dashboard?.[key]) ? Math.max(3, Math.min(10, data.dashboard[key])) : 3;
const homeLimitFill = value => `${(value - 3) / 7 * 100}%`;
function updateHomeLimitControl(input) {
  input.style.setProperty('--range-fill', homeLimitFill(input.valueAsNumber));
  input.previousElementSibling.value = input.value;
}
const projectViews = () => [...(showHome() ? [{ id: '', name: 'Home' }] : []), ...(showAllProjects() ? [{ id: 'all', name: 'All' }] : []), ...activeProjects()];
const projectShortcuts = () => projectViews().slice(0, 10);
const projectHref = project => project.id === 'all' ? '#all' : href({ project: project.id });
const landingHref = () => projectViews().length ? projectHref(projectViews()[0]) : '#settings';
function sidebarLinks() {
  const sidebar = root.querySelector('.sidebar');
  const navigation = sidebar?.getClientRects().length ? sidebar : root.querySelector('.mobile-navigation');
  return [...(navigation?.querySelectorAll('.project-nav-link,.sidebar-footer a') || [])]
    .filter(link => !link.closest('[inert],details:not([open]),details[data-collapsing]') && link.getClientRects().length);
}
function activeSidebarLink() { return sidebarLinks().find(link => link.getAttribute('aria-current') === 'page'); }
function focusSidebarLink() {
  const link = activeSidebarLink();
  if (!link || document.activeElement === link) return;
  restoringTaskFocus = true;
  link.focus({ preventScroll: true }); link.scrollIntoView({ block: 'nearest' });
  restoringTaskFocus = false;
}
function selectSidebar() {
  keyboardRegion = 'projects'; pendingTaskEntry = false; restoreFocus = false;
  markKeyboardActivity();
  if (!root.querySelector('.sidebar')?.getClientRects().length) {
    const menu = root.querySelector('.mobile-navigation>details');
    if (menu) setDisclosureOpen(menu, true);
  }
  syncNavigation();
  if (activeSidebarLink()) void sounds.play('close');
}
function cycleSidebar(direction) {
  const links = sidebarLinks().filter(link => link.matches('.project-nav-link'));
  if (!links.length) return;
  const index = links.indexOf(activeSidebarLink());
  const next = index < 0 ? (direction > 0 ? 0 : links.length - 1) : (index + direction + links.length) % links.length;
  pendingTaskEntry = false; keyboardRegion = 'projects'; markKeyboardActivity();
  navigateWithMotion(links[next].getAttribute('href'), direction);
  syncNavigation();
}
function enterTaskList() {
  // A project change may still be rendering; select only from its finished list.
  if (renderedHash !== location.hash) { pendingTaskEntry = true; return; }
  pendingTaskEntry = false;
  const link = visibleTaskLinks()[0];
  if (!link) { markKeyboardActivity(); hitWall(1, 'x'); updateTaskMarker(); return; }
  const menu = root.querySelector('.mobile-navigation>details');
  if (menu) setDisclosureOpen(menu, false);
  selectTaskLink(link);
}
const { settingsPage, helpPage, homePage, projectPage, archivePage, taskPage, projectFolders } = createViews({
  getData: () => data, route, href, groupStates, copiedItems, activeProjects, showHome, showAllProjects, soundsEnabled, homeLimit, isArchivedWork
});
function commandItems() {
  if (!data) return [];
  const navigation = [
    ...(showHome() ? [{ title: 'Home', href: '#', keywords: 'needs you recent' }] : []),
    ...(showAllProjects() ? [{ title: 'All', href: '#all', keywords: 'tasks' }] : []),
    { title: 'Archived', href: '#archive', keywords: 'completed done archive' },
    { title: 'Settings', href: '#settings', keys: ['Shift', ','], keywords: 'features appearance sound apps preferences' },
    { title: 'Keyboard shortcuts', href: '#shortcuts', keys: ['?'], keywords: 'help keys navigation' },
    { title: 'How it works', href: '#help', keywords: 'help guide instructions' }
  ].map(item => ({ ...item, group: 'Navigation', suggested: true }));
  const shortcuts = projectShortcuts();
  const availableProjects = activeProjects(), activeIds = new Set(availableProjects.map(project => project.id));
  const projects = availableProjects.map(project => {
    const index = shortcuts.findIndex(item => item.id === project.id);
    return { group: 'Projects', title: project.name, href: projectHref(project), suggested: true, ...(index >= 0 ? { keys: ['⌘', String(shortcutNumber(index))] } : {}) };
  });
  const currentProject = route().project;
  const archivedIds = new Set(data.projects.filter(project => project.archivedAt).map(project => project.id));
  const documents = availableProjects.map(project => ({
    group: 'Documents', title: `${project.name} context`, detail: 'Project context', href: href({ project: project.id, doc: '.torch/CONTEXT.md' }), suggested: project.id === currentProject
  }));
  const recent = data.tasks.filter(task => !task.archived && task.status !== 'done' && activeIds.has(task.projectId))
    .sort((a, b) => Number(b.projectId === currentProject) - Number(a.projectId === currentProject) || b.updated.localeCompare(a.updated)).slice(0, 8);
  const tasks = [...data.tasks].sort((a, b) => b.updated.localeCompare(a.updated)).map(task => ({
    group: 'Tasks', title: task.title, reference: task.displayId || task.id,
    detail: [task.projectName, data.labels[task.status], task.archived ? 'Archived' : '', archivedIds.has(task.projectId) ? 'Archived project' : ''].filter(Boolean).join(' · '),
    keywords: [task.id, task.owner].join(' '), href: href({ project: task.projectId, task: task.id }),
    task, suggested: recent.includes(task)
  }));
  return [...navigation, ...projects, ...documents, ...tasks];
}
commandMenu = createCommandMenu({
  getItems: commandItems,
  onToggle(open) {
    document.body.classList.toggle('command-menu-open', open);
    showProjectShortcuts(false); clearTaskActivity();
  },
  onSelect(item) {
    if (item.task) {
      const r = route();
      if (!r.doc && !r.task && !inSettings()) rememberTaskList();
      if (!taskListContains({ project: item.task.projectId, task: item.task.id })) taskList = null;
      keyboardSelection = item.href;
    }
    keyboardRegion = 'tasks'; pendingTaskEntry = false;
    const direction = Math.sign(viewDepth(new URL(item.href, location.href).hash) - viewDepth(location.hash));
    navigateWithMotion(item.href, direction, 'x', { resetDocuments: true });
  }
});
function showCopied(action, id) {
  const key = `${action}:${id}`;
  clearTimeout(copiedItems.get(key));
  const update = () => {
    const copied = copiedItems.has(key);
    for (const el of root.querySelectorAll('button[data-copy-label]')) {
      if (el.dataset.action !== action || el.dataset.id !== id) continue;
      el.dataset.copied = String(copied);
      const label = copied ? el.dataset.successLabel : el.dataset.copyLabel;
      el.setAttribute('aria-label', label);
      el.title = label;
    }
  };
  copiedItems.set(key, setTimeout(() => { copiedItems.delete(key); update(); }, 2000));
  update();
}
function render(scrollTop = false, direction = 0, axis = 'y', restoreScroll = null) {
  const request = ++renderRequest;
  const previousRoute = Object.fromEntries(new URLSearchParams((renderedHash || '').slice(1)));
  const nextRoute = route();
  let markerTransition;
  if (axis === 'x' && direction > 0 && nextRoute.task && !nextRoute.doc && !previousRoute.task && !previousRoute.doc) markerTransition = 'out';
  if (axis === 'x' && direction < 0 && (previousRoute.task || previousRoute.doc) && !nextRoute.task && !nextRoute.doc) markerTransition = 'in';
  const movingHome = renderedHash === location.hash && root.querySelector('[data-home-section]');
  const update = async () => {
    if (request !== renderRequest) return;
    if (scrollTop) window.scrollTo(0, 0);
    await renderView();
    if (request === renderRequest) {
      if (restoreScroll) window.scrollTo(...restoreScroll);
      if (pendingTaskEntry) enterTaskList();
      updateTaskMarker({ animate: keyboardRegion === 'projects', refreshHover: true });
    }
  };
  return movingHome ? moveHomeSections(update) : dissolve(update, direction, axis, markerTransition);
}
async function renderView() {
  if (!data) return;
  if ((inAll() && !showAllProjects()) || (inHome() && !showHome())) {
    history.replaceState(null, '', landingHref()); previousHash = location.hash; resetTaskSelection();
  }
  const version = ++renderVersion;
  for (const group of root.querySelectorAll('details[data-group-key]')) groupStates.set(group.dataset.groupKey, disclosureOpen(group));
  const hadTaskFocus = document.activeElement?.matches('.row a');
  const sameView = renderedHash === location.hash; renderedHash = location.hash;
  const r = route(); document.title = 'Torch';
  if (keyboardRegion !== 'projects') taskMarker.hidden = true;
  hoveredTask = null;
  syncNavigation();
  renderedKey = viewKey(data, r, location.hash);
  const main = document.createElement('main'); main.id = 'main';
  root.querySelector('main').replaceWith(main);
  if (location.hash === '#help') {
    document.title = 'How it works · Torch'; main.innerHTML = helpPage(); return;
  }
  if (inSettings()) {
    document.title = 'Settings · Torch'; main.innerHTML = settingsPage();
    main.querySelectorAll('[data-home-limit]').forEach(updateHomeLimitControl);
    if (location.hash === '#shortcuts') { const guide = main.querySelector('#keyboard-shortcuts'); guide.focus({ preventScroll: true }); guide.scrollIntoView({ block: 'start' }); }
    return;
  }
  if (r.doc) {
    main.innerHTML = '';
    try {
      const doc = await api('/api/document?' + new URLSearchParams({ project: r.project, path: r.doc, fromTask: r.fromTask || '' }));
      if (version !== renderVersion || route().doc !== r.doc || route().project !== r.project) return;
      document.title = `${doc.title} · Torch`;
      main.innerHTML = `<p class="small document-path">${escape(doc.path)}</p><div class="prose">${doc.html}</div>${r.doc === '.torch/CONTEXT.md' ? projectFolders(data.projects.find(project => project.id === r.project)) : ''}`;
      if (r.heading && !sameView) {
        const slug = value => value.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
        [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(el => slug(el.textContent) === slug(r.heading))?.scrollIntoView({ block: 'start' });
      }
    } catch (e) { if (version === renderVersion) main.innerHTML = `<h1>Document unavailable</h1><p>${escape(e.message)}</p>`; } return;
  }
  if (r.task) {
    const summary = selected();
    if (!summary) { main.innerHTML = taskPage(null); return; }
    const key = `${r.project}:${summary.id}`, cached = taskDetails.get(key);
    try {
      const task = cached?.contentVersion === summary.contentVersion ? cached : await api('/api/task?' + new URLSearchParams({ project: r.project, task: r.task }));
      taskDetails.delete(key);
      if (!task.errors.length) taskDetails.set(key, task);
      if (taskDetails.size > 8) taskDetails.delete(taskDetails.keys().next().value);
      if (version !== renderVersion || route().task !== r.task || route().project !== r.project) return;
      main.innerHTML = taskPage(task);
    } catch (error) {
      if (version === renderVersion) {
        renderedKey = null;
        main.innerHTML = `<h1>Task unavailable</h1><p>${escape(error.message)}</p>`;
      }
    }
    return;
  }
  main.innerHTML = inArchive() ? archivePage() : r.project || inAll() ? projectPage() : homePage();
  if (inArchive()) document.title = 'Archived · Torch';
  if (!r.task && keyboardRegion === 'tasks') {
    const link = visibleTaskLinks().find(link => link.getAttribute('href') === keyboardSelection);
    if (link) selectTaskLink(link, restoreFocus || hadTaskFocus, false);
    else resetHiddenTaskSelection();
  }
  restoreFocus = false;
}
function visibleTaskLinks() { return [...root.querySelectorAll('.row a')].filter(link => !link.closest('details:not([open]),details[data-collapsing]') && link.getClientRects().length); }
function selectTaskLink(link, focus = true, activity = true) {
  const fromSidebar = keyboardRegion === 'projects';
  keyboardRegion = 'tasks'; pendingTaskEntry = false;
  if (activity && (fromSidebar || keyboardSelection !== link.getAttribute('href'))) void sounds.play(fromSidebar ? 'open' : 'move');
  keyboardSelection = link.getAttribute('href');
  if (activity) markKeyboardActivity();
  if (focus) {
    restoringTaskFocus = true;
    link.focus({ preventScroll: true }); link.scrollIntoView({ block: 'nearest' });
    restoringTaskFocus = false;
  }
  updateTaskMarker();
}
function rememberTaskList() {
  taskList = { hash: location.hash, items: [...new Set(visibleTaskLinks().map(link => link.getAttribute('href')))], expanded: [...root.querySelectorAll('details[data-status][open]')].filter(disclosureOpen).map(el => el.dataset.status) };
}
function taskListContains(r) {
  return taskList?.items.includes(href({ project: r.project, task: r.task || r.fromTask }));
}
function exitView() {
  const r = route();
  if (!r.doc && !r.task && !inSettings() && !inArchive()) { hitWall(-1, 'x'); return; }
  const taskParent = taskListContains(r) ? taskList.hash || '#' : href({ project: r.project });
  const parentDocument = r.doc && documentTrail.parent();
  const destination = location.hash === '#help' ? '#settings' : r.doc ? parentDocument?.hash || href({ project: r.project, task: r.fromTask }) : r.task ? taskParent : landingHref();
  if (new URL(destination, location.href).hash === location.hash) { hitWall(-1, 'x'); return; }
  restoreFocus = true;
  navigateWithMotion(destination, -1, 'x', { documentReturn: Boolean(parentDocument) });
}
window.addEventListener('keydown', event => {
  if (!data || event.defaultPrevented || event.isComposing) return;
  if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault(); if (event.repeat) return;
    pendingTaskEntry = false;
    markKeyboardActivity(); exitView(); updateTaskMarker();
    return;
  }
  const editing = event.target.closest?.('input,textarea,select,[role="textbox"],[contenteditable]:not([contenteditable="false"])');
  const inControl = event.target.closest?.('input,textarea,select,button,summary,[role="textbox"],[contenteditable]:not([contenteditable="false"])');
  if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && /^[0-9]$/.test(event.key)) {
    const project = projectShortcuts()[event.key === '0' ? 9 : Number(event.key) - 1];
    if (!project) return;
    event.preventDefault();
    pendingTaskEntry = false;
    if (!editing) {
      const destination = projectHref(project);
      navigateWithMotion(destination, 0);
    }
    return;
  }
  if (editing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.shiftKey && (event.code === 'Comma' || event.key === '<')) {
    event.preventDefault();
    keyboardRegion = 'tasks'; pendingTaskEntry = false;
    if (!event.repeat) navigateWithMotion('#settings', 1, 'x');
    return;
  }
  if (event.key === '?') {
    event.preventDefault(); if (event.repeat) return;
    keyboardRegion = 'tasks'; pendingTaskEntry = false;
    if (location.hash === '#shortcuts') render(true); else navigateWithMotion('#shortcuts', 1, 'x');
    return;
  }
  if (event.shiftKey) return;
  const r = route();
  if (event.key === 'ArrowLeft') {
    event.preventDefault(); hidePointer(event);
    if (event.repeat) return;
    if (r.task || r.doc) {
      keyboardRegion = 'tasks'; pendingTaskEntry = false;
      markKeyboardActivity(); exitView(); updateTaskMarker();
    }
    else if (keyboardRegion === 'projects') { markKeyboardActivity(); hitWall(-1, 'x'); updateTaskMarker(); }
    else selectSidebar();
    return;
  }
  if (inControl) return;
  const entering = event.key === 'Enter' || event.key === 'ArrowRight';
  const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (keyboardRegion === 'projects') {
    if (direction) { event.preventDefault(); hidePointer(event); cycleSidebar(direction); }
    else if (entering) { event.preventDefault(); hidePointer(event); markKeyboardActivity(); enterTaskList(); }
    return;
  }
  // Enter on a real link keeps the link's native action.
  if (event.key === 'Enter' && event.target.closest?.('a') && !event.target.closest('.row')) return;
  if (inSettings() || r.doc) {
    if (entering) { event.preventDefault(); hidePointer(event); markKeyboardActivity(); hitWall(1, 'x'); }
    return;
  }
  if (r.task && direction) {
    event.preventDefault(); hidePointer(event); markKeyboardActivity();
    const current = href({ project: r.project, task: r.task });
    if (!taskList?.items.includes(current)) {
      const tasks = data.tasks.filter(t => !t.archived && t.projectId === r.project && (!['done','backlog'].includes(t.status) || t.id === r.task));
      tasks.sort((a,b) => data.statuses.indexOf(a.status) - data.statuses.indexOf(b.status) || compareTaskPriority(a, b));
      taskList = { hash: href({ project: r.project }), items: tasks.map(t => href({ project: t.projectId, task: t.id })), expanded: ['done','backlog'].filter(s => selected()?.status === s) };
    }
    const items = taskList.items.filter(item => { const p = Object.fromEntries(new URLSearchParams(item.slice(1))); return data.tasks.some(t => (taskList.hash === '#archive' ? isArchivedWork(t) || data.projects.some(project => project.id === t.projectId && project.archivedAt) : !t.archived) && t.id === p.task && t.projectId === p.project); });
    const next = items[items.indexOf(current) + direction];
    if (next) { void sounds.play('move'); keyboardSelection = next; history.replaceState({ torchTaskList: taskList }, '', next); previousHash = location.hash; render(true, direction); }
    else hitWall(direction);
    return;
  }
  if (r.task) {
    if (entering) { event.preventDefault(); hidePointer(event); markKeyboardActivity(); hitWall(1, 'x'); }
    return;
  }
  const links = visibleTaskLinks();
  if (!links.length) {
    if (direction || entering) { event.preventDefault(); hidePointer(event); markKeyboardActivity(); hitWall(direction || 1, direction ? 'y' : 'x'); }
    return;
  }
  const active = links.includes(document.activeElement) ? document.activeElement : links.find(link => link.getAttribute('href') === keyboardSelection);
  if (direction) {
    event.preventDefault(); hidePointer(event);
    const index = active ? links.indexOf(active) + direction : direction > 0 ? 0 : links.length - 1;
    if (index < 0 || index >= links.length) { markKeyboardActivity(); updateTaskMarker(); hitWall(direction); return; }
    selectTaskLink(links[Math.max(0, Math.min(links.length - 1, index))]);
  } else if (entering) {
    event.preventDefault(); hidePointer(event); markKeyboardActivity();
    if (active) { rememberTaskList(); navigateWithMotion(active.getAttribute('href'), 1, 'x'); }
    else hitWall(1, 'x');
  }
});
async function refresh(force = false) {
  if (polling) { if (force) return new Promise(resolve => refreshWaiters.push(resolve)); return; } polling = true;
  const busy = () => commandMenu.isOpen() || draggingProject || projectBusy || settingsBusy || document.activeElement?.matches('[data-home-limit]');
  if (!force && busy()) { polling = false; refreshPending = true; return; }
  try {
    const res = await fetch('/api/state', { signal: AbortSignal.timeout(8000), headers: stateEtag && !force && !refreshPending ? { 'If-None-Match': stateEtag } : {} });
    if (res.status === 304) {
      if (renderedKey === null) await render();
      return;
    }
    const next = await res.json();
    if (!res.ok) throw new Error(next.error || 'Request failed.');
    token = next.token; delete next.token;
    if (!force && busy()) { refreshPending = true; return; }
    stateEtag = res.headers.get('ETag');
    const hadSounds = soundsEnabled(); data = next;
    if (hadSounds && !soundsEnabled()) sounds.stop();
    syncNavigation();
    refreshPending = false;
    if (force || !startupReady || renderedKey !== viewKey(data, route(), location.hash)) await render();
    if (!startupReady) { startupReady = true; window.dispatchEvent(new Event('torch-ready')); }
  } catch (e) {
    if (!startupReady) { stateEtag = null; window.dispatchEvent(new Event('torch-startup-error')); }
    else if (force) notice(e.message);
  }
  finally {
    polling = false;
    if (refreshWaiters.length) { const waiting = refreshWaiters.splice(0); refresh(true).finally(() => waiting.forEach(resolve => resolve())); }
  }
}
function displayProjectOrder(projectIds) {
  const ordered = projectIds.map(id => data.projects.find(p => p.id === id));
  let index = 0;
  data.projects = data.projects.map(p => p.archivedAt ? p : ordered[index++] || p);
  for (const list of root.querySelectorAll('[data-project-list]')) {
    const elements = [...list.children];
    for (const id of projectIds) { const link = elements.find(el => el.dataset.projectId === id); if (link) list.append(link); }
  }
  navigationKey = JSON.stringify(activeProjects().map(p => [p.id, p.name]));
  updateProjectShortcuts();
  if (inHome()) void moveHomeSections(() => {
    root.querySelector('main').innerHTML = homePage();
    resetHiddenTaskSelection();
    updateTaskMarker({ animate: false, refreshHover: true });
  });
}
async function saveProjectOrder(projectIds) {
  if (projectBusy) return;
  const previous = activeProjects().map(p => p.id);
  projectBusy = true; displayProjectOrder(projectIds);
  try { await api('/api/projects/order', { projectIds }); void sounds.play('drop'); }
  catch (error) { displayProjectOrder(previous); notice(error.message); }
  finally { projectBusy = false; refreshPending = true; }
}
installProjectReorder(root, { projects: activeProjects, busy: () => projectBusy || settingsBusy, commit: saveProjectOrder, changed: active => { draggingProject = active; if (active) clearDissolve(); } });
root.addEventListener('click', async event => {
  const rowId = event.target.closest('button[data-action="copy-task-row"]');
  if (rowId) {
    event.preventDefault();
    const task = data.tasks.find(task => task.id === rowId.dataset.taskId && task.projectId === rowId.dataset.projectId);
    if (!task) { notice('This task is no longer available. Refresh Torch.'); return; }
    await activateTaskId(task, rowId, true);
    return;
  }
  const summary = event.target.closest('summary');
  if (summary && !event.target.closest('a,button,input,select,textarea')) {
    event.preventDefault();
    const details = summary.parentElement;
    setDisclosureOpen(details, !disclosureOpen(details), open => {
      void sounds.play(open ? 'open' : 'close');
      if (details.dataset.groupKey) groupStates.set(details.dataset.groupKey, open);
      if (!open) resetHiddenTaskSelection();
      summary.blur();
    });
    return;
  }
  const taskLink = event.target.closest('.row')?.querySelector('a');
  if (taskLink && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault(); selectTaskLink(taskLink, false, false); rememberTaskList();
    navigateWithMotion(taskLink.getAttribute('href'), 1, 'x'); return;
  }
  const viewLink = event.target.closest('a[href^="#"]');
  if (viewLink && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    const hash = new URL(viewLink.href).hash;
    navigateWithMotion(viewLink.getAttribute('href'), Math.sign(viewDepth(hash) - viewDepth(location.hash)), 'x');
    return;
  }
  const target = event.target.closest('button[data-action]'); if (!target) return;
  const action = target.dataset.action;
  if (['toggle-home', 'toggle-all-projects', 'toggle-ui-sounds'].includes(action)) {
    if (settingsBusy) return;
    settingsBusy = true; target.disabled = true;
    const key = { 'toggle-home': 'showHome', 'toggle-all-projects': 'showAllProjects', 'toggle-ui-sounds': 'uiSounds' }[action];
    const value = key === 'showHome' ? !showHome() : data.dashboard?.[key] !== true;
    if (key === 'uiSounds') { if (value) void sounds.unlock(); else sounds.stop(); }
    target.setAttribute('aria-checked', String(value));
    try {
      data.dashboard = await api('/api/dashboard-settings', { dashboard: { [key]: value } });
      if (key === 'showAllProjects' || key === 'showHome') updateFixedProjectsVisibility();
      void sounds.play('toggle');
    } catch (error) { target.setAttribute('aria-checked', String(key === 'showHome' ? showHome() : data.dashboard?.[key] === true)); notice(error.message); }
    finally { settingsBusy = false; target.disabled = false; if (inSettings()) renderedKey = viewKey(data, route(), location.hash); }
    return;
  }
  if (action === 'copy-session') { try { await navigator.clipboard.writeText(target.dataset.id); showCopied('copy-session', target.dataset.id); void sounds.play('copy'); } catch { notice('Select and copy the session ID above.'); } }
  if (action === 'copy-task') {
    const t = selected();
    if (!t) { notice('This task is no longer available. Refresh Torch.'); return; }
    await activateTaskId(t, target);
  }
});
root.addEventListener('toggle', event => {
  if (event.target.matches('details[data-group-key]') && !event.target.open) resetHiddenTaskSelection();
  if (event.target.matches('.mobile-navigation>details')) updateTaskMarker({ animate: false });
}, true);
root.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('[data-home-limit]')) { event.preventDefault(); event.target.blur(); }
});
root.addEventListener('input', event => {
  if (event.target.matches('[data-home-limit]')) updateHomeLimitControl(event.target);
});
root.addEventListener('change', async event => {
  const limit = event.target.closest('input[data-home-limit]');
  if (limit) {
    const key = limit.dataset.homeLimit, value = limit.valueAsNumber;
    if (!Number.isSafeInteger(value) || value < 3 || value > 10) {
      limit.value = homeLimit(key); updateHomeLimitControl(limit); notice('Choose a whole number from 3 to 10.'); return;
    }
    if (settingsBusy) { limit.value = homeLimit(key); updateHomeLimitControl(limit); return; }
    if (value === homeLimit(key)) return;
    const hadFocus = document.activeElement === limit;
    settingsBusy = true;
    root.querySelectorAll('[data-home-limit]').forEach(input => { input.disabled = true; });
    try {
      data.dashboard = await api('/api/dashboard-settings', { dashboard: { [key]: value } });
      void sounds.play('toggle');
    } catch (error) { limit.value = homeLimit(key); updateHomeLimitControl(limit); notice(error.message); }
    finally {
      settingsBusy = false;
      root.querySelectorAll('[data-home-limit]').forEach(input => { input.disabled = false; });
      if (hadFocus && limit.isConnected && document.activeElement === document.body) limit.focus({ preventScroll: true });
      if (inSettings()) renderedKey = viewKey(data, route(), location.hash);
    }
    return;
  }
});
window.addEventListener('hashchange', event => {
  if (new URL(event.newURL).hash !== location.hash) return;
  commandMenu.close(false);
  const documentNavigation = documentTrail.sync();
  const motion = pendingNavigationMotion?.hash === location.hash ? pendingNavigationMotion : {
    direction: documentNavigation.direction || Math.sign(viewDepth(location.hash) - viewDepth(previousHash)), axis: 'x'
  };
  pendingNavigationMotion = null;
  const previousRoute = Object.fromEntries(new URLSearchParams(previousHash.slice(1)));
  previousHash = location.hash;
  const r = route();
  if ((r.task || r.fromTask) && history.state?.torchTaskList) taskList = history.state.torchTaskList;
  if (taskListContains(r)) history.replaceState({ ...history.state, torchTaskList: taskList }, '', location.href);
  if (!r.task && !r.doc && !inSettings() && taskList?.hash !== location.hash && !(taskList?.hash === '' && location.hash === '#')) { taskList = null; keyboardSelection = ''; }
  if (!r.task && !r.doc && !inSettings() && previousRoute.task) {
    const exitedTask = data?.tasks.find(t => t.projectId === previousRoute.project && t.id === previousRoute.task);
    if (exitedTask) {
      keyboardSelection = href({ project: exitedTask.projectId, task: exitedTask.id });
      if (r.project === exitedTask.projectId || inAll()) groupStates.set(`${r.project || 'all'}:${exitedTask.status}`, true);
    }
  }
  restoreFocus = Boolean(keyboardRegion === 'tasks' && !r.task && !r.doc && keyboardSelection);
  render(true, motion.direction, motion.axis, documentNavigation.scroll);
});
refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 3000);
