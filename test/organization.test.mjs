import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initProject, createTask, getTask, updateTask, sessionLink, addNote, read, taskFile, saveMainOwner } from '../src/store.mjs';
import { archiveTask, restoreTask, mergeTasks } from '../src/organize.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'torch-organization-tests-'));
process.env.TORCH_HOME = path.join(base, 'registry');
delete process.env.CODEX_THREAD_ID;
delete process.env.CLAUDE_CODE_SESSION_ID;
saveMainOwner('Jason');
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const run = (p, ...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args, '--project', p.root], { env: process.env, encoding: 'utf8' }));
function project(name) { const root = path.join(base, name); fs.mkdirSync(root); return initProject(root, name); }
function task(p, title) { return createTask(p, { title, owner: 'Jason', body: `## Next\n\n${title}` }); }
function plan(p, target, sources) { return { targetRevision: getTask(p, target.id).revision, sources: sources.map(t => ({ id: t.displayId, revision: getTask(p, t.id).revision })), body: '## Next\n\nOne shared outcome.', reason: 'Shared outcome' }; }
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test('archive hides a task without changing it; restore needs a fresh revision', () => {
  const p = project('Archive'), original = task(p, 'Historical task');
  const archived = archiveTask(p, original.displayId, original.revision, 'No longer needed');
  assert.equal(archived.status, original.status); assert.equal(archived.body, original.body);
  assert.equal(run(p, 'task', 'list', '--json').length, 0);
  assert.equal(run(p, 'task', 'list', '--all', '--json').length, 1);
  for (const write of [() => updateTask(p, original.id, { title: 'No' }), () => addNote(p, original.id, { body: 'No' }), () => sessionLink(p, original.id, { id: 'session-1' })]) assert.throws(write, /archived/);
  assert.throws(() => restoreTask(p, original.id, original.revision), /changed/);
  assert.equal(restoreTask(p, original.id, archived.revision).archived, undefined);
});

test('merge keeps metadata, sessions and checkpoints; dry run changes nothing', () => {
  const p = project('Merge'), target = task(p, 'Outcome'), source = task(p, 'Small step');
  fs.writeFileSync(taskFile(p, target.id), read(taskFile(p, target.id)).replace('title:', 'custom: preserve-me\ntitle:'));
  sessionLink(p, target.id, { id: 'session-a', title: 'Original session' });
  sessionLink(p, source.id, { id: 'session-b', title: 'Another session' });
  addNote(p, source.id, { body: 'Keep the decision', sessionId: 'session-b' });
  const originals = [target, source].map(t => read(taskFile(p, t.id)));
  const file = path.join(base, 'plan.json'); fs.writeFileSync(file, JSON.stringify(plan(p, target, [source])));
  assert.equal(run(p, 'task', 'merge', target.displayId, '--plan-file', file, '--dry-run').dryRun, true);
  assert.deepEqual([target, source].map(t => read(taskFile(p, t.id))), originals);
  run(p, 'task', 'merge', target.displayId, '--plan-file', file);
  const merged = run(p, 'task', 'show', target.displayId, '--json');
  assert.equal(merged.custom, 'preserve-me'); assert.equal(merged.body, '## Next\n\nOne shared outcome.');
  assert.equal(merged.sessions.length, 2);
  assert.equal(merged.notes[0].body, 'Keep the decision'); assert.equal(merged.notes[0].originDisplayId, source.displayId);
  const old = getTask(p, source.displayId);
  assert.equal(old.mergedInto, target.id); assert.equal(old.body, source.body);
  assert.throws(() => restoreTask(p, old.id, old.revision), /merged into/);
});

test('merge refuses stale, self and duplicate plans without changing records', () => {
  const p = project('Refuse'), a = task(p, 'First'), b = task(p, 'Second');
  const before = [a, b].map(t => read(taskFile(p, t.id)));
  assert.throws(() => mergeTasks(p, a.id, { ...plan(p, a, [b]), targetRevision: 'stale' }), /changed/);
  assert.throws(() => mergeTasks(p, a.id, plan(p, a, [a])), /distinct/);
  assert.throws(() => mergeTasks(p, a.id, plan(p, a, [b, b])), /distinct/);
  assert.throws(() => mergeTasks(p, a.id, { ...plan(p, a, [b]), extra: 1 }), /Unknown merge plan field/);
  assert.deepEqual([a, b].map(t => read(taskFile(p, t.id))), before);
});
