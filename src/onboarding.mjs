import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { read, atomic, locked, fail, text, now, hash } from './storage.mjs';
import { registry, projectAt, loadProject, availableProjectCode, register } from './project-store.mjs';
import { listTasks, taskFile } from './task-store.mjs';
import { guardWorkflow } from './secrets.mjs';

export const guide = `# Torch

This folder holds the project's Torch records. Change them through the \`torch\` CLI or the Torch skills, not by hand.

- \`CONTEXT.md\`: the project on one page (what it is, goal now, current state, decisions, sources).
- \`tasks/\`: one Markdown file per task. The body holds the current state only.
- \`notes/\`: checkpoints, which are each task's history.

Start with \`torch context\`. Read one task with \`torch context <ID>\`. The rules for statuses, owners, task bodies and checkpoints are in \`torch help rules\`.

Skills: torch-start, torch-list, torch-plan, torch-work, torch-tidy.
`;

function instructions(root) {
  // Codex chooses AGENTS.override.md over AGENTS.md in the same directory.
  const file = path.join(root, fs.existsSync(path.join(root, 'AGENTS.override.md')) ? 'AGENTS.override.md' : 'AGENTS.md');
  const begin = '<!-- torch:start -->', end = '<!-- torch:end -->';
  const block = `${begin}\n## Torch\n\nThis project tracks work in Torch. Before relevant work, run \`torch context\` (or \`torch context <ID>\` for one task) and follow \`torch help rules\`. Leave a checkpoint with \`torch task checkpoint\` when work changes, pauses or finishes.\n${end}`;
  const current = read(file, '');
  const start = current.indexOf(begin), finish = current.indexOf(end);
  if ((start === -1) !== (finish === -1) || (start !== -1 && finish < start)) fail('Incomplete Torch instruction markers; existing instructions were left unchanged.');
  const next = start === -1 ? `${current}${current.endsWith('\n') || !current ? '' : '\n'}\n${block}\n` : current.slice(0, start) + block + current.slice(finish + end.length);
  if (next !== current) atomic(file, next);
}
export function initProject(dir, name, { public: isPublic = false } = {}) {
  const root = fs.realpathSync(path.resolve(dir));
  if (!fs.existsSync(path.join(root, '.torch/project.json'))) {
    try { return projectAt(root); } catch (e) { if (!e.message.startsWith('No Torch project found.')) throw e; }
  } else {
    const local = loadProject(root), existing = registry().find(p => p.id === local.id && p.root !== root && fs.existsSync(p.root));
    if (existing) fail(`This project ID is already registered at ${existing.root}. Use that checkout for shared Torch records.`);
  }
  const base = path.join(root, '.torch');
  const project = locked(base, () => {
    const file = path.join(base, 'project.json');
    let p;
    if (fs.existsSync(file)) {
      p = loadProject(root);
      if (!p.code) {
        p.code = availableProjectCode(p.name);
        const { root: _, ...config } = p; atomic(file, JSON.stringify(config, null, 2) + '\n');
      }
    }
    else {
      const projectName = text(name || path.basename(root), 'Project name');
      p = { version: 1, id: randomUUID(), name: projectName, code: availableProjectCode(projectName), nextTaskNumber: 1, created: now(), root };
      const { root: _, ...config } = p; atomic(file, JSON.stringify(config, null, 2) + '\n');
    }
    fs.mkdirSync(path.join(base, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(base, 'notes'), { recursive: true });
    atomic(path.join(base, 'README.md'), guide);
    if (!fs.existsSync(path.join(base, 'CONTEXT.md'))) atomic(path.join(base, 'CONTEXT.md'), `# ${p.name}\n\nOne page: what this is, the goal now, current state, decisions and sources.\n`);
    const ignore = path.join(base, '.gitignore');
    if (!fs.existsSync(ignore)) atomic(ignore, '.write-lock\n*.tmp\n');
    instructions(root);
    const guard = path.join(root, '.github/workflows/torch-guard.yml');
    if (isPublic && !fs.existsSync(guard)) atomic(guard, guardWorkflow);
    return p;
  });
  register(project); assignDisplayIds(project, project.code); return project;
}
export function assignDisplayIds(project, code) {
  if (!/^[A-Z]{2}$/.test(code) || code === 'TK') fail('Task code must be two capital letters other than TK.');
  const result = locked(path.join(project.root, '.torch'), () => {
    const p = loadProject(project.root);
    if (p.code && p.code !== code) fail(`This project already uses task code ${p.code}.`);
    const tasks = listTasks(p).sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    const used = new Set();
    let next = p.nextTaskNumber || 1;
    for (const task of tasks) if (task.displayId) {
      if (![code, ...(p.legacyCodes || [])].some(prefix => task.displayId.startsWith(prefix + '-')) || used.has(task.displayId)) fail('Existing task labels conflict; no records were changed.');
      used.add(task.displayId);
      if (task.displayId.startsWith(code + '-')) next = Math.max(next, Number(task.displayId.slice(3)) + 1);
    }
    let assigned = 0;
    for (const task of tasks) if (!task.displayId) {
      const displayId = `${code}-${String(next++).padStart(3, '0')}`;
      const file = taskFile(p, task.id), raw = read(file);
      if (hash(raw) !== task.revision) fail('A task changed during label assignment. Rerun the assignment.');
      atomic(file, raw.replace(/^---\r?\n/, match => `${match}displayId: ${displayId}\n`));
      assigned++;
    }
    if (p.code !== code || !p.nextTaskNumber || p.nextTaskNumber < next) {
      const { root: _, ...config } = { ...p, code, nextTaskNumber: Math.max(p.nextTaskNumber || 1, next) };
      atomic(path.join(p.root, '.torch/project.json'), JSON.stringify(config, null, 2) + '\n');
    }
    return { project: p.name, code, assigned, total: tasks.length };
  });
  register(loadProject(project.root));
  return result;
}
