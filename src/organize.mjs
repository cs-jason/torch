import path from 'node:path';
import { checkSecrets } from './secrets.mjs';
import { locked, atomic, now, text, fail, encode, validate, validateTaskTitle, getTask, taskFile, requireActiveTask, attachSession, checkSize, limits, normalizeStatus } from './store.mjs';

const base = p => path.join(p.root, '.torch');
function revision(task, expected) {
  text(expected, 'Revision');
  if (task.revision !== expected) fail(`${task.displayId || task.id} changed. Read it again before organizing tasks.`, 409);
}

export function archiveTask(p, reference, expected, reason, session = null) {
  return locked(base(p), () => {
    const task = getTask(p, reference); revision(task, expected); requireActiveTask(task);
    task.archived = { at: now(), reason: text(reason, 'Archive reason', 1000) };
    task.updated = task.archived.at;
    attachSession(task, session);
    atomic(taskFile(p, task.id), encode(task));
    return getTask(p, task.id);
  });
}
export function restoreTask(p, reference, expected, session = null) {
  return locked(base(p), () => {
    const task = getTask(p, reference); revision(task, expected);
    if (!task.archived) fail('This task is not archived.');
    if (task.mergedInto) fail(`This task was merged into ${task.mergedInto}. Its history lives there; copy what you need into a new task.`, 409);
    delete task.archived; task.updated = now();
    attachSession(task, session);
    atomic(taskFile(p, task.id), encode(task));
    return getTask(p, task.id);
  });
}

// ponytail: no transaction journal. The survivor is written first, so an interrupted
// merge can leave a source unarchived (a visible duplicate) but never loses content.
// Syncthing versions and Time Machine are the undo.
export function mergeTasks(p, reference, plan, dryRun = false, session = null) {
  return locked(base(p), () => {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('Supply a merge plan object.');
    const allowed = ['targetRevision', 'sources', 'body', 'reason', 'title', 'owner', 'status'];
    for (const key of Object.keys(plan)) if (!allowed.includes(key)) fail(`Unknown merge plan field: ${key}.`);
    const target = getTask(p, reference); requireActiveTask(target); revision(target, plan.targetRevision);
    if (!Array.isArray(plan.sources) || !plan.sources.length) fail('Choose at least one source task to merge.');
    const sources = plan.sources.map(source => {
      if (!source || typeof source !== 'object') fail('Each source needs an ID and revision.');
      const task = getTask(p, source.id); requireActiveTask(task); revision(task, source.revision); return task;
    });
    if (new Set([target.id, ...sources.map(t => t.id)]).size !== sources.length + 1) fail('Choose distinct source tasks and a different surviving task.');
    const stamp = now(), reason = text(plan.reason, 'Merge reason', 1000);
    const sessions = new Map();
    for (const task of [target, ...sources]) for (const s of task.sessions) if (!sessions.has(s.id)) sessions.set(s.id, s);
    const merged = { ...target, body: text(plan.body, 'Merged Markdown', 200000), sessions: [...sessions.values()], updated: stamp, mergedFrom: [...(target.mergedFrom || []), ...sources.map(t => t.id)] };
    checkSize(merged.body, limits.body, 'Merged body', 'Keep the current state only; source history stays in checkpoints.');
    checkSecrets(merged.body, 'Merged body');
    for (const key of ['title', 'owner', 'status']) if (plan[key] !== undefined) merged[key] = plan[key];
    if (merged.title !== target.title) validateTaskTitle(merged.title);
    merged.status = normalizeStatus(merged.status);
    attachSession(merged, session);
    validate(merged);
    const result = { target: target.displayId || target.id, archived: sources.map(t => t.displayId || t.id), owner: merged.owner, status: merged.status, reason };
    if (dryRun) return { ...result, dryRun: true, body: merged.body };
    atomic(taskFile(p, target.id), encode(merged));
    for (const task of sources) atomic(taskFile(p, task.id), encode({ ...task, updated: stamp, archived: { at: stamp, reason }, mergedInto: target.id }));
    return result;
  });
}
