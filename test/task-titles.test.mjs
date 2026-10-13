import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initProject, createTask, getTask, updateTask, checkpointTask, notes, read, encode, decode } from '../src/store.mjs';
import { mergeTasks } from '../src/organize.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'torch-titles-'));
process.env.TORCH_HOME = path.join(base, 'registry');
for (const key of ['CODEX_THREAD_ID', 'CLAUDE_CODE_SESSION_ID', 'TORCH_SESSION_ID', 'TORCH_SESSION_KIND']) delete process.env[key];
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const project = name => { const root = path.join(base, name); fs.mkdirSync(root); return initProject(root, name); };
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: process.env });
const longTitle = 'Write clear task names with seven words';
const error = /Task name has 7 words; maximum is 6/;
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test('CLI creation and renaming enforce six words without consuming IDs or changing records', () => {
  const p = project('Names');
  const config = read(path.join(p.root, '.torch/project.json'));
  const rejected = run('task', 'add', longTitle, '--project', p.root, '--session', 'actual-session');
  assert.equal(rejected.status, 1); assert.match(rejected.stderr, error);
  assert.equal(read(path.join(p.root, '.torch/project.json')), config);
  assert.deepEqual(fs.readdirSync(path.join(p.root, '.torch/tasks')), []);
  const added = run('task', 'add', 'Write clear task names with details', '--project', p.root);
  assert.equal(added.status, 0, added.stderr);
  const task = JSON.parse(added.stdout); assert.equal(task.displayId, 'NA-001');
  const rename = run('task', 'update', task.id, '--project', p.root, '--revision', task.revision, '--title', longTitle, '--session', 'actual-session');
  assert.equal(rename.status, 1); assert.match(rename.stderr, error);
  assert.equal(getTask(p, task.id).revision, task.revision); assert.deepEqual(getTask(p, task.id).sessions, []);
  const spaced = '  Write\tclear\u00a0task names with details  ';
  assert.equal(createTask(p, { title: spaced }).title, spaced);
  assert.equal(createTask(p, { title: 'Keep six-word names clear and useful' }).title.split(' ').length, 6);
  const renamed = run('task', 'update', task.id, '--project', p.root, '--revision', task.revision, '--title', 'Keep names short');
  assert.equal(renamed.status, 0, renamed.stderr);
  assert.equal(getTask(p, task.id).title, 'Keep names short');
});

test('legacy names allow ordinary edits, but new merge names respect the limit', () => {
  const p = project('Legacy'), initial = createTask(p, { title: 'Original task' }), source = createTask(p, { title: 'Related task' });
  const file = path.join(p.root, '.torch/tasks', initial.id + '.md');
  fs.writeFileSync(file, encode({ ...initial, title: longTitle }));
  let task = getTask(p, initial.id);
  task = updateTask(p, task.id, { title: longTitle, body: 'Updated details' }, task.revision);
  assert.equal(task.title, longTitle);
  const before = read(file);
  assert.throws(() => checkpointTask(p, task.id, { title: longTitle + ' again' }, { body: 'Do not save' }, task.revision), /maximum is 6/);
  assert.equal(read(file), before); assert.deepEqual(notes(p, task.id), []);
  task = checkpointTask(p, task.id, { status: 'next' }, { body: 'Ordinary checkpoint' }, task.revision).task;
  const plan = { targetRevision: task.revision, sources: [{ id: source.id, revision: source.revision }], body: 'Combined details', reason: 'Same outcome', title: longTitle + ' again' };
  assert.throws(() => mergeTasks(p, task.id, plan, true), /maximum is 6/);
  assert.throws(() => mergeTasks(p, task.id, plan), /maximum is 6/);
  assert.equal(getTask(p, task.id).revision, task.revision); assert.equal(getTask(p, source.id).archived, undefined);
  delete plan.title;
  mergeTasks(p, task.id, plan);
  assert.equal(getTask(p, task.id).title, longTitle); assert.equal(getTask(p, source.id).mergedInto, task.id);
});

test('title-only CLI checkpoints preserve omitted defaults, legacy states and archived metadata', () => {
  for (const archived of [false, true]) {
    const p = project(archived ? 'Archived names' : 'Legacy names');
    const initial = createTask(p, { title: 'Original name', body: 'Keep **exact** details and references.' });
    const file = path.join(p.root, '.torch/tasks', initial.id + '.md');
    const original = { ...initial, status: archived ? 'done' : 'working', owner: 'ReviewBot', custom: { keep: ['unknown', 'metadata'] } };
    delete original.priority;
    if (archived) original.archived = { at: initial.created, reason: 'Old experiment', custom: 'retained' };
    fs.writeFileSync(file, encode(original));
    const task = getTask(p, initial.id), before = decode(read(file));
    const result = run('task', 'checkpoint', task.id, '--project', p.root, '--revision', task.revision, '--title', 'Keep a shorter name', '--note', 'Renamed only; work state unchanged.');
    assert.equal(result.status, 0, result.stderr);
    const after = decode(read(file));
    for (const key of Object.keys(before).filter(key => !['title', 'updated', 'revision'].includes(key))) assert.deepEqual(after[key], before[key]);
    assert.equal(Object.hasOwn(after, 'priority'), false);
    assert.equal(after.title, 'Keep a shorter name');
    assert.equal(notes(p, task.id).length, 1);
    const current = getTask(p, task.id);
    const stale = run('task', 'update', task.id, '--project', p.root, '--revision', task.revision, '--title', 'Another short name');
    assert.equal(stale.status, 1); assert.match(stale.stderr, /changed/);
    assert.equal(getTask(p, task.id).revision, current.revision);
    if (archived) {
      assert.throws(() => updateTask(p, task.id, { title: 'Another name', owner: 'Jason' }, current.revision), /archived/);
      assert.throws(() => updateTask(p, task.id, { body: 'Changed work' }, current.revision), /archived/);
      fs.writeFileSync(file, encode({ ...after, mergedInto: 'tk-merged-target' }));
      const merged = getTask(p, task.id);
      assert.throws(() => updateTask(p, task.id, { title: 'Another name' }, merged.revision), /merged/);
    }
  }
});
