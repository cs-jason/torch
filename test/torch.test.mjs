import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { initProject, projectAt, projectFolders, linkFolder, unlinkFolder, createTask, getTask, updateTask, sessionLink, addNote, notes, registry, read, assignDisplayIds, saveMainOwner, checkpointTask } from '../src/store.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'torch-tests-'));
process.env.TORCH_HOME = path.join(base, 'settings');
delete process.env.CODEX_THREAD_ID;
delete process.env.CLAUDE_CODE_SESSION_ID;
saveMainOwner('Jason');
function project(name) { const dir = path.join(base, name); fs.mkdirSync(dir); return dir; }
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test('init preserves instructions and is repeatable, including subdirectory lookup', () => {
  const root = project('one'); const original = '# User instructions\n\nKeep this exact text.\n';
  fs.writeFileSync(path.join(root, 'AGENTS.md'), original);
  const p = initProject(root, 'One');
  const first = read(path.join(root, 'AGENTS.md'));
  assert.ok(first.startsWith(original));
  assert.equal(initProject(root).id, p.id); assert.equal(read(path.join(root, 'AGENTS.md')), first);
  fs.mkdirSync(path.join(root, 'nested')); assert.equal(projectAt(path.join(root, 'nested')).id, p.id);
  assert.equal(registry().filter(x => x.id === p.id).length, 1);
});
test('init targets the effective AGENTS override and preserves the fallback file', () => {
  const root = project('override'); fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Base unchanged'); fs.writeFileSync(path.join(root, 'AGENTS.override.md'), '# Override\n');
  initProject(root); assert.equal(read(path.join(root, 'AGENTS.md')), 'Base unchanged'); assert.match(read(path.join(root, 'AGENTS.override.md')), /torch context/);
});
test('task editing preserves unknown metadata and rejects stale edits and bad IDs', () => {
  const p = initProject(project('editing')); const t = createTask(p, { title: 'Small task', owner: 'Jason', body: '## Next\n\nKeep **this** context.' });
  const updated = updateTask(p, t.id, { status: 'waiting' }, t.revision);
  assert.equal(updated.body, t.body); assert.throws(() => updateTask(p, t.id, { body: 'stale overwrite' }, t.revision), /changed/);
  assert.equal(getTask(p, t.id).body, t.body); assert.throws(() => getTask(p, '../escape'), /Invalid record ID/);
  assert.throws(() => updateTask(p, t.id, { status: 'imaginary' }), /Status must be one of/);
  for (const owner of ['Jason and Codex', 'Jason, Sam', 'Jason & Codex', 'Unassigned']) {
    assert.throws(() => createTask(p, { title: 'Invalid owner', owner }), /one named person, agent, or external party/);
    assert.throws(() => updateTask(p, t.id, { owner }), /one named person, agent, or external party/);
  }
  assert.equal(getTask(p, t.id).owner, 'Jason');
  const file = path.join(p.root, '.torch/tasks', t.id + '.md'); fs.writeFileSync(file, read(file).replace('title:', 'custom: retained\ntitle:'));
  assert.equal(updateTask(p, t.id, { owner: 'Sam' }).custom, 'retained');
});
test('readable task IDs survive migration and resolve through task commands', () => {
  const p = initProject(project('labels'), 'Torch');
  const first = createTask(p, { id: 'tk-00000001', title: 'First', body: '## Next\n\nKeep this text.' });
  const second = createTask(p, { id: 'tk-00000002', title: 'Second' });
  assert.equal(first.displayId, 'TO-001');
  assert.equal(second.displayId, 'TO-002');
  const projectFile = path.join(p.root, '.torch/project.json');
  const legacy = JSON.parse(read(projectFile)); delete legacy.code; delete legacy.nextTaskNumber;
  fs.writeFileSync(projectFile, JSON.stringify(legacy));
  for (const task of [first, second]) {
    const file = path.join(p.root, '.torch/tasks', `${task.id}.md`);
    fs.writeFileSync(file, read(file).replace(/^displayId: .*\n/m, ''));
  }
  assert.equal(assignDisplayIds(p, 'TO').assigned, 2);
  assert.equal(assignDisplayIds(p, 'TO').assigned, 0);
  assert.equal(getTask(p, 'to-001').id, first.id);
  assert.equal(getTask(p, 'TO-001').body, '## Next\n\nKeep this text.');
  assert.equal(updateTask(p, 'TO-002', { status: 'waiting' }).displayId, 'TO-002');
  assert.equal(addNote(p, 'TO-001', { body: 'Checkpoint' }).taskId, first.id);
  assert.equal(createTask(p, { title: 'Third' }).displayId, 'TO-003');
  const config = JSON.parse(read(projectFile)); config.nextTaskNumber = 100;
  fs.writeFileSync(projectFile, JSON.stringify(config));
  assert.equal(createTask(p, { title: 'Beyond 99' }).displayId, 'TO-100');
});
test('a task keeps multiple session IDs, renamed titles and independent checkpoints', () => {
  const p = initProject(project('sessions')), t = createTask(p, { title: 'Editorial plan' });
  sessionLink(p, t.id, { id: 'session-1', title: 'Website' }); sessionLink(p, t.id, { id: 'session-2', title: 'Review' }); sessionLink(p, t.id, { id: 'session-1', title: 'Blog and resources' });
  addNote(p, t.id, { body: 'Preserve the old website decisions.', sessionId: 'session-1' }); addNote(p, t.id, { body: 'Jason chose two briefs.', author: 'Jason' });
  assert.equal(getTask(p, t.id).sessions.length, 2); assert.equal(getTask(p, t.id).sessions.find(s => s.id === 'session-1').title, 'Blog and resources'); assert.equal(notes(p, t.id).length, 2);
});
test('simultaneous CLI writers do not lose independent updates', async () => {
  const p = initProject(project('concurrent')), t = createTask(p, { title: 'Concurrent work' });
  const edits = [ ['--owner', 'Sam'], ['--status', 'waiting'] ];
  const jobs = edits.map(args => {
    const child = spawn(process.execPath, [cli, 'task', 'update', t.id, '--revision', t.revision, '--project', p.root, ...args], { env: process.env, stdio: 'pipe' }); return once(child, 'exit');
  });
  const results = await Promise.all(jobs);
  assert.deepEqual(results.map(([code]) => code).sort(), [0, 1]);
  const retry = edits[results.findIndex(([code]) => code === 1)];
  execFileSync(process.execPath, [cli, 'task', 'update', t.id, '--revision', getTask(p, t.id).revision, '--project', p.root, ...retry], { env: process.env });
  assert.equal(getTask(p, t.id).owner, 'Sam'); assert.equal(getTask(p, t.id).status, 'waiting');
});
test('fresh process reads the project and real session from an agent checkpoint', () => {
  const p = initProject(project('handoff')), t = createTask(p, { title: 'Continue me', body: '## Decision\n\nHuman writes the articles.' });
  execFileSync(process.execPath, [cli, 'task', 'update', t.id, '--revision', t.revision, '--project', p.root, '--owner', 'Codex', '--session-title', 'Original task'], { env: { ...process.env, CODEX_THREAD_ID: 'actual-session-123' } });
  execFileSync(process.execPath, [cli, 'task', 'checkpoint', t.id, '--revision', getTask(p, t.id).revision, '--project', p.root, '--owner', 'Jason', '--note', 'Two briefs ready; human selection next.'], { env: { ...process.env, CODEX_THREAD_ID: 'actual-session-123' } });
  const output = execFileSync(process.execPath, [cli, 'context', t.id, '--project', p.root], { encoding: 'utf8', env: process.env });
  assert.match(output, /Human writes the articles/); assert.match(output, /Two briefs ready/); assert.match(output, /actual-session-123/);
  const context = JSON.parse(execFileSync(process.execPath, [cli, 'context', t.id, '--project', p.root, '--json'], { encoding: 'utf8', env: process.env }));
  assert.equal(context.tasks[0].notes[0].body, 'Two briefs ready; human selection next.');
  assert.equal(getTask(p, t.id).sessions[0].title, 'Original task');
  const before = getTask(p, t.id), checkpoints = notes(p, t.id);
  assert.throws(() => checkpointTask(p, t.id, { status: 'done' }, { body: ' ' }, before.revision), /Checkpoint/);
  assert.equal(getTask(p, t.id).revision, before.revision);
  assert.deepEqual(notes(p, t.id), checkpoints);
});
test('linked folders share canonical records across CLI processes and preserve instructions', () => {
  const p = initProject(project('link-home')), folder = project('link-notes');
  const original = '# Notes rules\n\nKeep source notes intact.\n';
  fs.writeFileSync(path.join(folder, 'AGENTS.md'), original);
  execFileSync(process.execPath, [cli, 'link', p.root, '--name', 'notes'], { cwd: folder, env: process.env });
  const instructions = read(path.join(folder, 'AGENTS.md'));
  linkFolder(p.id, folder, 'notes');
  assert.equal(read(path.join(folder, 'AGENTS.md')), instructions);
  assert.ok(instructions.startsWith(original));
  assert.equal(projectAt(folder).id, p.id);
  fs.mkdirSync(path.join(folder, 'nested'));
  const task = JSON.parse(execFileSync(process.execPath, [cli, 'task', 'add', 'Shared from notes'], { cwd: path.join(folder, 'nested'), env: process.env, encoding: 'utf8' }));
  assert.equal(getTask(p, task.id).title, 'Shared from notes');
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'context', '--json'], { cwd: folder, env: process.env, encoding: 'utf8' }));
  assert.equal(result.project.root, p.root); assert.equal(result.tasks[0].id, task.id);
  assert.equal(result.project.folders.find(f => f.name === 'notes').path, fs.realpathSync(folder));
  assert.equal(initProject(folder).id, p.id); assert.equal(fs.existsSync(path.join(folder, '.torch')), false);
  assert.equal(registry().filter(e => e.id === p.id).length, 1);
  initProject(p.root); assert.equal(projectFolders(p).length, 2);
  assert.doesNotMatch(read(path.join(p.root, '.torch/project.json')), /links|link-notes/);
  unlinkFolder(folder);
  assert.equal(read(path.join(folder, 'AGENTS.md')).trim(), original.trim());
  assert.equal(getTask(p, task.id).title, 'Shared from notes');
  assert.throws(() => projectAt(folder), /No Torch project/);
});

test('linking rejects conflicting owners, overlapping folders, duplicate names and copied records', () => {
  const p = initProject(project('owner-one')), other = initProject(project('owner-two')), folder = project('owned-notes');
  linkFolder(p.root, folder, 'notes');
  assert.throws(() => linkFolder(other.root, folder, 'notes'), /overlaps/);
  fs.mkdirSync(path.join(folder, 'child'));
  assert.throws(() => linkFolder(other.root, path.join(folder, 'child')), /overlaps/);
  assert.throws(() => linkFolder(p.root, project('other-notes'), 'notes'), /already used/);
  const copy = project('copied-checkout'); fs.cpSync(path.join(p.root, '.torch'), path.join(copy, '.torch'), { recursive: true });
  assert.throws(() => linkFolder(p.root, copy), /already has Torch records/);
  assert.throws(() => initProject(copy), /already registered/);
  assert.throws(() => projectAt(copy), /own copy/);
  assert.equal(registry().filter(e => e.id === p.id).length, 1);
});

test('moving task homes preserves links; missing folders are visible and can be relinked', () => {
  const p = initProject(project('moving-home')), folder = project('moving-notes');
  const t = createTask(p, { title: 'Survive a move' }); linkFolder(p.id, folder, 'notes');
  const moved = folder + '-new'; fs.renameSync(folder, moved);
  assert.equal(projectFolders(p).find(f => f.name === 'notes').available, false);
  unlinkFolder(folder); linkFolder(p.id, moved, 'notes');
  const newHome = p.root + '-new'; fs.renameSync(p.root, newHome);
  assert.throws(() => projectAt(moved), /Task home unavailable/);
  const relocated = initProject(newHome);
  assert.equal(relocated.id, p.id); assert.equal(projectAt(moved).root, fs.realpathSync(newHome));
  assert.equal(getTask(relocated, t.id).title, 'Survive a move');
  assert.equal(projectFolders(relocated).find(f => f.name === 'notes').available, true);
  execFileSync(process.execPath, [cli, 'unlink', '--project', newHome, '--name', 'notes'], { env: process.env });
  assert.equal(projectFolders(relocated).length, 1);
});

