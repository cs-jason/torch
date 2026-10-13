// The local dashboard: a small HTTP server on 127.0.0.1 over the same .torch/ files as the CLI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { hash, read, fail } from './storage.mjs';
import { reorderProjects, registeredProject, documentLocation } from './project-store.mjs';
import { getTask, notes, taskStorageReady } from './task-store.mjs';
import { snapshot } from './snapshot.mjs';
import { createReadCache } from './read-cache.mjs';
import { dashboardSettings, saveDashboardSettings } from './settings.mjs';
import { fileKind } from './file-types.mjs';
import { markdown } from './markdown.mjs';

const version = JSON.parse(read(fileURLToPath(new URL('../package.json', import.meta.url)))).version;
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ...['bootstrap.js', 'app.js', 'views.js', 'format.js', 'task-reference.js', 'motion.js', 'view-state.js', 'sounds.js', 'project-drag.js', 'task-order.js', 'icons.js', 'command-menu.js', 'document-trail.js'].map(file => ['/' + file, [file, 'text/javascript; charset=utf-8']]),
  ...['torch-logo.svg', 'torch-logo-dark.svg', 'favicon.svg', 'favicon-dark.svg'].map(file => ['/' + file, [file, 'image/svg+xml']]),
]);

const cache = createReadCache();
const plainSessions = task => task.sessions.map(s => ({ ...s, url: null }));
const contentVersion = task => hash(JSON.stringify([task.revision, task.sourceChanged, task.sessions, task.notes.map(n => [n.id, n.revision, n.originTaskId])]));

export function dashboardState() {
  const state = snapshot({ scope: cache.scan() });
  state.tasks = state.tasks.map(task => {
    const { id, displayId, title, owner, status, created, updated, archived, mergedInto, mergedFrom, projectId, projectName } = task;
    return { id, displayId, title, owner, status, created, updated, archived, mergedInto, mergedFrom, projectId, projectName, contentVersion: contentVersion(task) };
  });
  return { ...state, version, dashboard: dashboardSettings() };
}

export function taskDetail(p, reference) {
  const scope = cache.scan(), task = getTask(p, reference, scope), errors = [];
  const onError = (file, error) => errors.push({ file, message: `${file}: ${error.message}` });
  let checkpoints = [];
  try { checkpoints = notes(p, task.id, new Set(), false, { scope, onError }); }
  catch (error) { onError(`.torch/notes/${task.id}`, error); }
  const result = { ...task, projectId: p.id, projectName: p.name, sessions: plainSessions(task), notes: checkpoints };
  result.contentVersion = contentVersion(result);
  result.html = markdown(task.body, p.id, '', task.id);
  result.notes = checkpoints.map(note => ({ ...note, html: markdown(note.body, p.id, '', task.id) }));
  taskStorageReady(p);
  return { ...result, errors };
}

// Listens on the loopback address only. A per-run token guards every write.
export function serve({ port = 6421, onListening } = {}) {
  const token = randomBytes(32).toString('hex');
  let origin;
  const server = http.createServer(async (req, res) => {
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      // Refuse requests addressed to any other host name (DNS rebinding).
      const host = (req.headers.host || '').toLowerCase(), port = new URL(origin).port;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) fail('Not found.', 404);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/api/health') return json({ app: 'torch', version });
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const state = { ...dashboardState(), token };
        const etag = `"${hash(JSON.stringify(state))}"`;
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
        return json(state);
      }
      if (req.method === 'GET' && url.pathname === '/api/task') return json(taskDetail(registeredProject(url.searchParams.get('project')), url.searchParams.get('task')));
      if (req.method === 'GET' && url.pathname === '/api/document') {
        const p = registeredProject(url.searchParams.get('project'));
        const relative = url.searchParams.get('path') || '.torch/CONTEXT.md';
        if (fileKind(relative) !== 'reader') fail('Only Markdown and text documents can be opened in the reader.');
        const { full, path: documentPath } = documentLocation(p, relative);
        const stat = fs.statSync(full);
        if (!stat.isFile()) fail('Choose a document file.');
        if (stat.size > 500000) fail('This document is too large for the reader.');
        return json({ title: path.basename(documentPath), path: documentPath, html: markdown(read(full), p.id, path.posix.dirname(documentPath), url.searchParams.get('fromTask') || '') });
      }
      if (req.method === 'POST') {
        if (req.headers['x-torch-token'] !== token) fail('Reload the dashboard before saving.', 403);
        if (!req.headers['content-type']?.startsWith('application/json')) fail('Expected JSON.', 415);
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 250000) fail('Request too large.', 413); chunks.push(chunk); }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Expected a JSON object.');
        if (url.pathname === '/api/dashboard-settings') return json(saveDashboardSettings(data.dashboard));
        if (url.pathname === '/api/projects/order') return json(reorderProjects(data.projectIds));
        fail('Unknown action.', 404);
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': type }); res.end(read(path.join(publicDir, file))); return;
      }
      fail('Not found.', 404);
    } catch (e) { json({ error: e.message }, e.status || (e instanceof SyntaxError ? 400 : e.code === 'ENOENT' ? 404 : 500)); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(port, '127.0.0.1', () => {
    origin = `http://127.0.0.1:${server.address().port}`;
    onListening?.(origin);
  });
  return server;
}
