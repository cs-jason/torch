#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { registeredProject, mainOwner, saveMainOwner, initProject, projectAt, projectForTask, projectFolders, renameProject, setProjectArchived, linkFolder, unlinkFolder, listTasks, getTask, createTask, updateTask, sessionLink, checkpointTask, recoverCheckpoint, notes, registry, read, labels, fail, encode, compareTasks, sizeWarnings } from './store.mjs';
import { archiveTask, restoreTask, mergeTasks } from './organize.mjs';
import { installSkills } from './skills.mjs';
import { currentSession, agentName } from './session.mjs';
import { help } from './help.mjs';
import { summaries, findProject, formatHome, formatProject, formatTask, formatNeeds } from './views.mjs';

const strings = ['port', 'name', 'owner', 'status', 'body-file', 'revision', 'title', 'note', 'session', 'session-title', 'session-kind', 'agent', 'project', 'plan-file', 'reason'];
const booleans = ['no-open', 'help', 'json', 'all', 'dry-run', 'backlog', 'done', 'archived', 'public'];
const taskActions = ['list', 'show', 'add', 'update', 'checkpoint', 'link', 'merge', 'archive', 'restore', 'recover'];
const line = t => `${t.displayId || t.id} | ${t.archived ? 'Archived' : labels[t.status]} | ${t.owner} | ${t.title}${t.mergedInto ? ` [merged into ${t.mergedInto}]` : ''}`;

async function main() {
  const { positionals: args, values: options } = parseArgs({ allowPositionals: true, options: Object.fromEntries([...strings.map(k => [k, { type: 'string' }]), ...booleans.map(k => [k, { type: 'boolean' }])]) });
  const [command, action, value] = args;
  if (command === 'help' || options.help) { console.log(help(command === 'help' ? action : options.help ? command : undefined)); return; }
  const output = value => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const card = p => output(formatProject(p, listTasks(p), read(path.join(p.root, '.torch/CONTEXT.md'), ''), projectFolders(p), { extra: ['backlog', 'done', 'archived'].filter(name => options.all || options[name]) }));
  const home = (all = options.all) => { if (options.json) return output(registry()); output(formatHome(summaries({ all }), { all, archivedCount: registry().filter(e => e.archivedAt).length })); };
  // Bare torch: this project's card inside a project, otherwise every project.
  if (!command) { let here = null; try { here = projectAt(process.cwd()); } catch {} return here ? card(here) : home(); }
  if (command === 'needs') { output(formatNeeds()); return; }
  if (command === 'dashboard') {
    const port = Number(options.port || 6421);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('Port must be between 1024 and 65535.');
    const { serve } = await import('./dashboard.mjs');
    serve({ port, onListening: origin => {
      console.log(`Torch dashboard: ${origin} (only this computer can open it). Press Control-C to stop.`);
      if (options['no-open']) return;
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
      spawn(opener, [origin], { stdio: 'ignore' }).on('error', () => {}).unref();
    } }).on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is in use. Try torch dashboard --port ${port + 1}.` : e.message); process.exitCode = 1; });
    return;
  }
  if (command === 'path') { const entry = findProject(action); if (!entry) fail(`No project matches "${action || ''}".`); output(entry.root); return; }
  if (command === 'projects' || (command === 'project' && (action === 'list' || !action))) return home();
  if (command === 'project' && !['rename', 'archive', 'restore'].includes(action)) { const entry = findProject(action); if (!entry) fail(`No project matches "${action}". Run torch project list.`); return card(registeredProject(entry.id)); }
  // Shorthand: torch ST-003 shows a task; torch studio shows a project.
  if (!['dashboard', 'doctor', 'skills', 'init', 'owner', 'link', 'unlink', 'project', 'context', 'task'].includes(command)) {
    const p = projectForTask(command);
    if (p) { const t = getTask(p, command); output(options.json ? { ...t, notes: notes(p, command) } : formatTask(t, notes(p, command))); return; }
    const entry = findProject(command);
    if (entry) return card(registeredProject(entry.id));
    fail(`Unknown command or project "${command}". Run torch help.`);
  }
  if (command === 'doctor') {
    const { doctor, formatDiagnosis } = await import('./doctor.mjs');
    const result = await doctor(options.project); output(options.json ? result : formatDiagnosis(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'skills') { if (action !== 'install') fail('Use torch skills install.'); output(installSkills()); return; }
  if (command === 'init') {
    const p = initProject(action || options.project || process.cwd(), options.name, { public: options.public });
    output(`Torch is ready in ${p.root}\nProject: ${p.name} (${p.code})\nMain owner: ${mainOwner()} (change with torch owner "Your name")${options.public ? '\nPublic repo: .github/workflows/torch-guard.yml blocks outside edits and credentials in .torch/. Make its pull-request check required in branch protection to block merges.' : ''}\n\nNext: ask your agent to use the torch-start skill here.`); return;
  }
  if (command === 'owner') { output(action ? saveMainOwner(action) : { mainOwner: mainOwner() }); return; }
  if (command === 'link') {
    if (!action) fail('Specify the task home path or registered project ID.');
    const result = linkFolder(action, value || process.cwd(), options.name);
    output(`Linked ${result.folder.path} to ${result.project.name} as @${result.folder.name}.\nRun torch context from either folder. Task records stay in ${result.project.root}.`); return;
  }
  if (command === 'unlink') {
    const result = unlinkFolder(action || process.cwd(), options.project ? projectAt(options.project).id : undefined, options.name);
    output(`Unlinked ${result.folder} from ${result.project}. Task records are unchanged.`); return;
  }
  if (command === 'task' && !taskActions.includes(action)) fail(`Unknown task command. Use one of: ${taskActions.join(', ')}.`);
  const reference = command === 'context' ? action : command === 'task' ? value : undefined;
  const p = options.project ? projectAt(options.project) : (reference && projectForTask(reference)) || projectAt(process.cwd());

  if (command === 'project') { output(action === 'rename' ? renameProject(p, value) : setProjectArchived(p, action === 'archive')); return; }
  if (command === 'context') {
    const tasks = action ? [getTask(p, action)] : listTasks(p).filter(t => !t.archived && t.status !== 'done').sort(compareTasks);
    const folders = projectFolders(p), context = read(path.join(p.root, '.torch/CONTEXT.md'), '');
    const checkpoints = action ? notes(p, action).slice(0, 5) : [];
    // Every session starts here, so oversized records are flagged before any work.
    const warnings = sizeWarnings(context, listTasks(p)).map(w => `${w.detail} ${w.next}`);
    if (options.json) { output({ mainOwner: mainOwner(), warnings, project: { ...p, folders }, context, tasks: action ? [{ ...tasks[0], notes: checkpoints }] : tasks }); return; }
    if (warnings.length) output(`Tidy first:\n${warnings.map(w => `- ${w}`).join('\n')}\n`);
    output(`Project: ${p.name} (${p.code}) · main owner ${mainOwner()}\nTask home: ${p.root}${p.archivedAt ? '\nProject archived: restore it before resuming work.' : ''}`);
    for (const f of folders.filter(f => f.name !== 'project')) output(`@${f.name}: ${f.path}${f.available ? '' : ' [unavailable; unlink and relink if moved]'}`);
    output('\n' + context);
    output(tasks.map(line).join('\n') || 'No open tasks.');
    if (action) { output('\n' + encode(tasks[0])); for (const note of checkpoints) output(`${note.created} / ${note.author}\n${note.body}\n`); }
    return;
  }
  if (action === 'list') { const tasks = listTasks(p).filter(t => options.all || !t.archived).sort(compareTasks); output(options.json ? tasks : tasks.map(line).join('\n')); return; }
  if (action === 'add') { output(createTask(p, { title: value, owner: options.owner, status: options.status, body: options['body-file'] ? read(path.resolve(options['body-file'])) : undefined }, currentSession(options))); return; }
  if (action === 'recover') { output(recoverCheckpoint(p)); return; }
  if (!value) fail('Specify a task ID.');
  if (action === 'show') { const t = getTask(p, value); output(options.json ? { ...t, notes: notes(p, value) } : encode(t)); return; }
  if (action === 'merge') {
    if (!options['plan-file']) fail('Supply --plan-file with targetRevision, sources, body, and reason.');
    output(mergeTasks(p, value, JSON.parse(read(path.resolve(options['plan-file']))), options['dry-run'], currentSession(options))); return;
  }
  if (!options.revision) fail('A fresh --revision is required. Read torch task show <id> --json, then retry with its revision. Nothing was written.');
  const s = currentSession(options);
  if (action === 'archive') { output(archiveTask(p, value, options.revision, options.reason, s)); return; }
  if (action === 'restore') { output(restoreTask(p, value, options.revision, s)); return; }
  if (action === 'link') { if (!s) fail('Supply an actual --session ID or TORCH_SESSION_ID.'); output(sessionLink(p, value, s, options.revision)); return; }
  const patch = Object.fromEntries(['status', 'owner', 'title'].filter(key => options[key] !== undefined).map(key => [key, options[key]]));
  if (action === 'update') {
    if (options['body-file']) patch.body = read(path.resolve(options['body-file']));
    output(updateTask(p, value, patch, options.revision, s)); return;
  }
  if (!options.note) fail('Checkpoint requires --note.');
  output(checkpointTask(p, value, patch, { body: options.note, author: agentName(options) }, options.revision, s).note);
}
main().catch(e => { console.error(`Torch: ${e.message}`); process.exitCode = 1; });
