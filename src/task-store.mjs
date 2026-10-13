import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { home, read, atomic, locked, hash, now, fail, id, text, decode, encode } from './storage.mjs';
import { registry, registeredProject, loadProject } from './project-store.mjs';
import { ownerName, mainOwner } from './profile.mjs';
import { checkSecrets } from './secrets.mjs';
import { checkpointJournal, commitCheckpointFiles, recoverCheckpointFiles } from './checkpoint-journal.mjs';

export const statuses = ['next', 'waiting', 'backlog', 'done'];
export const labels = { next: 'Next', waiting: 'Waiting', backlog: 'Backlog', done: 'Done' };
// v0 records stay readable: they are mapped on read and rewritten on their next save.
const legacyStatus = { attention: 'next', working: 'next', blocked: 'waiting', deferred: 'backlog' };
export const normalizeStatus = status => legacyStatus[status] || status;
// No priority: a short `next` list is the ordering. Most recently touched first.
export const compareTasks = (a, b) => statuses.indexOf(a.status) - statuses.indexOf(b.status)
  || b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id);
export const sessionKinds = ['codex', 'claude', 'generic'];
export const bodyTemplate = '## Why\n\n## Done\n\n## Access\n\n## Next\n';
// New writes use v1 values; legacy values are accepted and mapped.
function checkStatus(task) { if (!statuses.includes(task.status)) fail(`Status must be one of: ${statuses.join(', ')}.`); }
export function taskFile(p, taskId) { return path.join(p.root, '.torch/tasks', id(taskId) + '.md'); }
export function resolveTaskId(p, reference) {
  if (/^tk-/i.test(reference) || !/^[A-Z]{2}-\d{3,}$/i.test(reference)) return id(reference);
  const wanted = reference.toUpperCase();
  const matches = fs.readdirSync(path.join(p.root, '.torch/tasks')).filter(file => file.endsWith('.md')).filter(file => decode(read(path.join(p.root, '.torch/tasks', file))).displayId === wanted);
  if (matches.length !== 1) fail(matches.length ? 'Task label is duplicated.' : 'Task not found.', matches.length ? 409 : 404);
  return matches[0].slice(0, -3);
}
export function getTask(p, taskId, scope) {
  taskStorageReady(p);
  const canonicalId = resolveTaskId(p, taskId);
  let task;
  try { task = scope ? scope.record(taskFile(p, canonicalId)) : decode(read(taskFile(p, canonicalId))); } catch (e) { if (e.code === 'ENOENT') fail('Task not found.', 404); throw e; }
  taskStorageReady(p);
  validate(task);
  if (task.id !== canonicalId) fail('Task ID does not match its filename.');
  const { attentionQueued, priority, ...current } = task;
  return { ...current, status: normalizeStatus(task.status) };
}
export function saveMainOwner(value) {
  const owner = ownerName(value);
  locked(home(), () => {
    const file = path.join(home(), 'settings.json');
    atomic(file, JSON.stringify({ ...JSON.parse(read(file, '{}')), mainOwner: owner }, null, 2) + '\n');
  });
  return { mainOwner: owner };
}
export function taskStorageReady(p) {
  if (fs.existsSync(checkpointJournal(p))) fail('A checkpoint was interrupted. Run torch task recover in this project before continuing.', 409);
}
export function requireActiveTask(t) {
  if (t.archived) fail(t.mergedInto ? `This task was merged into ${t.mergedInto}. Open that task to continue.` : 'This task is archived. Restore it before editing.', 409);
}
// ponytail: word counts as a size proxy. Hard limits on what agents write keep
// records lean regardless of model; CONTEXT.md is a plain file, so it only warns.
export const limits = { context: 600, body: 500, checkpoint: 150, next: 5 };
export const words = value => value.split(/\s+/).filter(Boolean).length;
export function checkSize(value, limit, label, fix) {
  const count = words(value);
  if (count > limit) fail(`${label} is ${count} words; maximum is ${limit}. ${fix} Nothing was written.`);
}
const checkBody = body => { checkSize(body, limits.body, 'Task body', 'Keep the current state only (Why, Done, Access, Next); put history in a checkpoint.'); checkSecrets(body, 'Task body'); };
// One line per oversized record, shown by torch context and torch doctor.
export function sizeWarnings(context, tasks) {
  const open = tasks.filter(t => !t.archived && t.status !== 'done');
  const long = open.filter(t => words(t.body) > limits.body), next = open.filter(t => t.status === 'next');
  return [
    words(context) > limits.context && { short: `CONTEXT.md ${words(context)} words`, detail: `CONTEXT.md is ${words(context)} words (limit ${limits.context}).`, next: 'Use the torch-tidy skill to bring it back to one page.' },
    long.length && { short: `${long.length} long task${long.length === 1 ? '' : 's'}`, detail: `${long.length} task body(ies) over ${limits.body} words: ${long.map(t => `${t.displayId || t.id} (${words(t.body)})`).join(', ')}.`, next: 'Use the torch-tidy skill to move history into checkpoints.' },
    next.length > limits.next && { short: `${next.length} next`, detail: `${next.length} tasks are next (limit ${limits.next}).`, next: 'Move what is not current to backlog.' },
  ].filter(Boolean);
}
export function validateTaskTitle(value) {
  const words = text(value, 'Title').split(/\s+/u).length;
  if (words > 6) fail(`Task name has ${words} words; maximum is 6. Put details in the task body.`);
  checkSecrets(value, 'Task name');
}
export function validate(t) {
  id(t.id); text(t.title, 'Title'); ownerName(t.owner);
  for (const key of ['created', 'updated']) if (typeof t[key] !== 'string' || !Number.isFinite(Date.parse(t[key]))) fail(`Invalid task ${key} date.`);
  if (t.displayId !== undefined && (!/^[A-Z]{2}-(?!0+$)\d{3,}$/.test(t.displayId) || t.displayId.startsWith('TK-'))) fail('Task label must look like TO-001.');
  if (!statuses.includes(normalizeStatus(t.status))) fail('Unknown task status.');
  if (typeof t.body !== 'string' || t.body.length > 200000) fail('Task Markdown must be under 200 KB.');
  if (!Array.isArray(t.sessions)) fail('Task sessions must be a list.');
  for (const s of t.sessions) {
    id(s.id); text(s.title, 'Session title');
    if (s.kind !== undefined && !sessionKinds.includes(s.kind)) fail(`Session kind must be ${sessionKinds.join(', ')}.`);
  }
  if (t.archived !== undefined && (!t.archived || typeof t.archived !== 'object' || !Number.isFinite(Date.parse(t.archived.at)))) fail('Invalid archive metadata.');
  if (t.archived) text(t.archived.reason, 'Archive reason', 1000);
  if (t.mergedInto !== undefined) { id(t.mergedInto); if (!t.archived || t.mergedInto === t.id) fail('Invalid merge destination.'); }
  if (t.mergedFrom !== undefined) {
    if (!Array.isArray(t.mergedFrom) || new Set(t.mergedFrom).size !== t.mergedFrom.length) fail('Invalid merged task list.');
    for (const source of t.mergedFrom) { id(source); if (source === t.id) fail('A task cannot be merged into itself.'); }
  }
}
export function listTasks(p, { scope, onError } = {}) {
  taskStorageReady(p);
  const tasks = [];
  for (const file of fs.readdirSync(path.join(p.root, '.torch/tasks')).filter(f => f.endsWith('.md')).sort()) {
    try { tasks.push(getTask(p, file.slice(0, -3), scope)); }
    catch (error) {
      if (!onError) throw error;
      onError(`.torch/tasks/${file}`, error);
    }
  }
  taskStorageReady(p);
  return tasks;
}
export function attachSession(task, session) {
  if (!session) return;
  id(session.id);
  const previous = task.sessions.find(s => s.id === session.id);
  const kind = session.kind || previous?.kind || 'codex';
  if (!sessionKinds.includes(kind)) fail(`Session kind must be ${sessionKinds.join(', ')}.`);
  // A generic link only means the kind was unknown; a detected kind may replace it.
  if (previous && previous.kind !== 'generic' && (previous.kind || 'codex') !== kind) fail('This session ID is already linked to a different session kind. Preserve the existing reference.', 409);
  const title = text(session.title || previous?.title || session.fallbackTitle || `${{ codex: 'Codex', claude: 'Claude' }[kind] || 'Agent'} session ${session.id.slice(0, 8)}`, 'Session title');
  const stamp = now();
  const link = { ...previous, id: session.id, kind, title, linked: previous?.linked || stamp, updated: stamp };
  task.sessions = [...task.sessions.filter(s => s.id !== session.id), link];
  task.updated = stamp;
  return link;
}
export function createTask(p, input, session = null) {
  return locked(path.join(p.root, '.torch'), () => {
    validateTaskTitle(input.title);
    const project = loadProject(p.root), code = project.code;
    if (!code) fail('Project task code is missing. Run torch init in the project folder.');
    const highest = listTasks(p).reduce((max, task) => task.displayId?.startsWith(code + '-') ? Math.max(max, Number(task.displayId.slice(3))) : max, 0);
    const number = Math.max(project.nextTaskNumber || 1, highest + 1);
    const displayId = `${code}-${String(number).padStart(3, '0')}`;
    const stamp = now();
    if (input.body) checkBody(input.body);
    const task = { id: input.id || `tk-${randomUUID().slice(0, 8)}`, displayId, title: input.title, status: normalizeStatus(input.status) || 'next', owner: ownerName(input.owner || mainOwner()), created: stamp, updated: stamp, sessions: [], body: input.body || bodyTemplate };
    checkStatus(task);
    attachSession(task, session);
    validate(task); const file = taskFile(p, task.id);
    if (fs.existsSync(file)) fail('Task ID already exists.', 409);
    const { root: _, ...config } = { ...project, nextTaskNumber: number + 1 };
    atomic(path.join(p.root, '.torch/project.json'), JSON.stringify(config, null, 2) + '\n');
    atomic(file, encode(task)); return getTask(p, task.id);
  });
}
function taskPatch(p, t, patch, revision, session) {
  const titleOnly = Object.keys(patch).length === 1 && Object.hasOwn(patch, 'title');
  // Name maintenance must not restore archived tasks or rewrite their work state.
  if (!titleOnly || t.mergedInto) requireActiveTask(t);
  if (titleOnly && t.archived && !revision) fail('An archived task rename requires a fresh revision.', 409);
  if (revision && t.revision !== revision) fail('This task changed after you opened it. Reload before saving; your draft has not been written.', 409);
  const allowed = ['title', 'owner', 'status', 'body'];
  for (const key of Object.keys(patch)) if (!allowed.includes(key)) fail(`Cannot update ${key}.`);
  if (Object.hasOwn(patch, 'title') && patch.title !== t.title) validateTaskTitle(patch.title);
  if (patch.body !== undefined && patch.body !== t.body) checkBody(patch.body);
  const next = { ...(titleOnly ? decode(read(taskFile(p, t.id))) : t), ...patch, updated: now() };
  if (!titleOnly) { next.status = normalizeStatus(next.status); checkStatus(next); }
  if (patch.owner !== undefined) next.owner = ownerName(patch.owner);
  attachSession(next, session); validate(next);
  return next;
}
export function updateTask(p, taskId, patch, revision, session = null) {
  return locked(path.join(p.root, '.torch'), () => {
    const t = getTask(p, taskId);
    const next = taskPatch(p, t, patch, revision, session);
    atomic(taskFile(p, t.id), encode(next)); return getTask(p, t.id);
  });
}
export function sessionLink(p, taskId, session, revision) {
  id(session.id);
  return locked(path.join(p.root, '.torch'), () => {
    const t = getTask(p, taskId); requireActiveTask(t);
    if (revision && t.revision !== revision) fail('This task changed after you opened it. Read it again before linking the session.', 409);
    const link = attachSession(t, session);
    validate(t);
    atomic(taskFile(p, t.id), encode(t)); return link;
  });
}
export function addNote(p, taskId, input, session = null) {
  return checkpointTask(p, taskId, {}, input, undefined, session).note;
}
export function checkpointTask(p, taskId, patch, input, revision, session = null) {
  // Validate the entire request before changing the task or creating a journal.
  const body = text(input.body, 'Checkpoint', 20000), author = text(input.author || 'Agent', 'Author', 120);
  const sessionId = session?.id || input.sessionId;
  if (sessionId) id(sessionId);
  checkSize(body, limits.checkpoint, 'Checkpoint', 'Write Changed / Evidence / Next in a few lines; link files for detail.');
  checkSecrets(body, 'Checkpoint');
  return locked(path.join(p.root, '.torch'), () => {
    const current = getTask(p, taskId), task = taskPatch(p, current, patch, revision, session);
    const note = { id: randomUUID(), taskId: task.id, created: now(), author, ...(sessionId ? { sessionId } : {}), body };
    const before = read(taskFile(p, task.id));
    if (hash(before) !== current.revision) fail('The task changed before saving its checkpoint.', 409);
    commitCheckpointFiles(p, task.id, [
      { path: `tasks/${task.id}.md`, before, after: encode(task) },
      { path: `notes/${task.id}/${note.created.replaceAll(':', '-')}-${note.id}.md`, before: null, after: encode(note) },
    ], validate);
    return { task: getTask(p, task.id), note };
  });
}
export function recoverCheckpoint(p) {
  return locked(path.join(p.root, '.torch'), () => recoverCheckpointFiles(p, validate));
}
export function notes(p, taskId, seen = new Set(), inherited = false, options = {}) {
  const { scope, tasks, onError } = options;
  const task = tasks?.get(taskId) || getTask(p, taskId, scope);
  if (seen.has(task.id)) fail('Merged task history contains a cycle.');
  seen.add(task.id);
  const dir = path.join(p.root, '.torch/notes', task.id);
  const own = [];
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')) : []) {
    try {
      const note = scope ? scope.record(path.join(dir, file)) : decode(read(path.join(dir, file)));
      id(note.id); text(note.author, 'Checkpoint author', 120); text(note.body, 'Checkpoint', 20000);
      if (note.taskId !== task.id || typeof note.created !== 'string' || !Number.isFinite(Date.parse(note.created))) fail('Invalid checkpoint metadata.');
      own.push({ ...note, ...(inherited ? { originTaskId: task.id, originDisplayId: task.displayId || task.id } : {}) });
    } catch (error) {
      if (!onError) throw error;
      onError(`.torch/notes/${task.id}/${file}`, error);
    }
  }
  const combined = [...own];
  for (const source of task.mergedFrom || []) {
    try { combined.push(...notes(p, source, seen, true, options)); }
    catch (error) { if (!onError) throw error; onError(`.torch/tasks/${source}.md`, error); }
  }
  return combined.sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id));
}
