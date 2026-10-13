import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { initProject, createTask, updateTask, getTask, saveMainOwner, registry } from '../src/store.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'torch-dashboard-tests-'));
Object.assign(process.env, { TORCH_HOME: path.join(base, 'registry'), CODEX_HOME: path.join(base, 'codex'), CLAUDE_CONFIG_DIR: path.join(base, 'claude') });
saveMainOwner('Jason');
const { serve } = await import('../src/dashboard.mjs');
const project = name => { const root = path.join(base, name); fs.mkdirSync(root); return initProject(root, name); };
const p = project('Studio'), second = project('Garden');
const task = createTask(p, { title: 'Write the launch post', owner: 'Jason', body: '## Next\n\nSee [the brief](notes/brief.md) and [the sheet](data.csv).' });
fs.mkdirSync(path.join(p.root, 'notes')); fs.writeFileSync(path.join(p.root, 'notes/brief.md'), '# Brief\n\nShort and local.');
fs.writeFileSync(path.join(base, 'outside.md'), 'Not part of any project.');

let origin;
const server = serve({ port: 0, onListening: o => { origin = o; } });
await once(server, 'listening');
test.after(() => { server.close(); fs.rmSync(base, { recursive: true, force: true }); });
const get = (route, headers = {}) => fetch(origin + route, { headers });
const post = (route, body, token) => fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Torch-Token': token } : {}) }, body: JSON.stringify(body) });

test('listens on the loopback address only', () => {
  assert.equal(server.address().address, '127.0.0.1');
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('state shows the same projects and tasks as the CLI, with v1 statuses', async () => {
  const state = await (await get('/api/state')).json();
  assert.deepEqual(state.statuses, ['next', 'waiting', 'backlog', 'done']);
  assert.deepEqual(state.projects.map(x => x.name).sort(), ['Garden', 'Studio']);
  const shown = state.tasks.find(t => t.id === task.id);
  assert.equal(shown.title, 'Write the launch post');
  assert.equal(shown.status, 'next');
  updateTask(p, task.id, { status: 'waiting' }, getTask(p, task.id).revision);
  const again = await (await get('/api/state')).json();
  assert.equal(again.tasks.find(t => t.id === task.id).status, 'waiting');
  assert.match(again.token, /^[a-f0-9]{64}$/);
});

test('task detail renders Markdown; only text documents become links', async () => {
  const detail = await (await get(`/api/task?project=${p.id}&task=${task.id}`)).json();
  assert.match(detail.html, /href="#project=/);
  assert.match(detail.html, /the sheet/);
  assert.doesNotMatch(detail.html, /data\.csv"/);
  const doc = await (await get(`/api/document?project=${p.id}&path=notes/brief.md`)).json();
  assert.match(doc.html, /Short and local/);
});

test('documents outside the project are refused', async () => {
  for (const reference of ['../outside.md', path.join(base, 'outside.md')]) {
    const res = await get(`/api/document?project=${p.id}&path=${encodeURIComponent(reference)}`);
    assert.equal(res.status, 403, reference);
  }
});

test('writes need the per-run token; reorder and settings work with it', async () => {
  assert.equal((await post('/api/projects/order', { projectIds: [second.id, p.id] })).status, 403);
  const { token } = await (await get('/api/state')).json();
  assert.equal((await post('/api/projects/order', { projectIds: [second.id, p.id] }, token)).status, 200);
  assert.deepEqual(registry().map(e => e.id), [second.id, p.id]);
  const settings = await (await post('/api/dashboard-settings', { dashboard: { showAllProjects: true } }, token)).json();
  assert.equal(settings.showAllProjects, true);
  assert.equal((await post('/api/settings', { defaultApps: {} }, token)).status, 404);
});

test('requests for another host name are refused', async () => {
  // fetch() cannot set Host, so use a raw request.
  const status = await new Promise((resolve, reject) => http.get(origin + '/api/state', { headers: { Host: 'example.com' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  assert.equal(status, 404);
});
