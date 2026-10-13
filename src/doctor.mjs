import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { home, read } from './storage.mjs';
import { mainOwner } from './profile.mjs';
import { registry, registeredProject, projectAt, projectFolders } from './project-store.mjs';
import { listTasks, sizeWarnings } from './task-store.mjs';
import { skillNames, skillHomes } from './skills.mjs';
import { secretWarnings } from './secrets.mjs';
import { terminal, displayPath } from './terminal.mjs';


export async function doctor(projectPath) {
  const checks = [];
  const add = (level, name, detail, next) => checks.push({ level, name, detail, ...(next ? { next } : {}) });
  add(Number(process.versions.node.split('.')[0]) >= 22 ? 'ok' : 'error', 'Node', process.version, 'Node 22 or newer is required.');
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  const binary = (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'torch')).find(file => {
    try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
  });
  add(binary ? fs.realpathSync(binary) === fs.realpathSync(cli) ? 'ok' : 'warning' : 'warning', 'CLI on PATH', binary || 'Not found', binary ? 'If this is an older installation, update the command your shell finds first.' : 'Install the package globally or use its absolute CLI path.');
  for (const dir of skillHomes()) {
    const missing = skillNames.filter(name => !fs.existsSync(path.join(dir, name, 'SKILL.md')));
    add(missing.length ? 'warning' : 'ok', 'Skills', `${displayPath(dir)}${missing.length ? ` missing ${missing.join(', ')}` : ''}`, missing.length ? 'Run torch skills install.' : undefined);
  }
  try { add('ok', 'Main owner', mainOwner()); }
  catch (error) { add('error', 'Settings', error.message, `Inspect ${path.join(home(), 'settings.json')}; preserve a backup before repairing it.`); }
  let entries = [];
  try {
    entries = registry();
    if (!Array.isArray(entries)) throw new Error('Expected an array of registered projects.');
    if (entries.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.root !== 'string')) throw new Error('A registry entry is missing its project ID or task-home path.');
    add('ok', 'Registry', `${entries.length} project(s) in ${home()}`);
  } catch (error) { entries = []; add('error', 'Registry', error.message, 'Restore a known-good registry backup; do not delete task folders.'); }
  let projects = entries;
  if (projectPath) {
    try { projects = [projectAt(projectPath)]; }
    catch (error) { projects = []; add('error', 'Selected project', error.message, 'Choose an initialized task home or linked folder.'); }
  }
  if (!projects.length) add('info', 'Projects', 'No projects to inspect.', 'Run torch init from your first project folder.');
  for (const entry of projects) {
    try {
      const p = registeredProject(entry.id, entries);
      for (const folder of projectFolders(p, entries)) add(folder.available ? 'ok' : 'warning', `${p.name} / ${folder.name}`, folder.path, folder.available ? undefined : 'Restore the folder or use torch unlink and torch link to update its location.');
      const tasks = listTasks(p, { onError: (file, error) => add('error', p.name, `${file}: ${error.message}`, 'Read the original record and preserve its content before repair.') });
      add('ok', p.name, `${tasks.length} readable task(s)`);
      if (!fs.existsSync(path.join(p.root, '.torch/README.md'))) add('warning', p.name, 'Agent guide is missing.', 'Run torch init in the task home to restore it.');
      for (const w of sizeWarnings(read(path.join(p.root, '.torch/CONTEXT.md'), ''), tasks)) add('warning', p.name, w.detail, w.next);
      for (const detail of secretWarnings(p.root)) add('error', p.name, detail, 'Remove it from the record and rotate the credential; git history keeps old versions.');
    } catch (error) { add('error', entry.name || 'Project', error.message, 'Inspect the task home; use torch task recover for an interrupted operation.'); }
  }
  return { ok: !checks.some(check => check.level === 'error'), readOnly: true, checks };
}

export function formatDiagnosis(result, options) {
  const { bold, muted, heading } = terminal(options);
  const errors = result.checks.filter(check => check.level === 'error');
  const warnings = result.checks.filter(check => check.level === 'warning');
  const passed = result.checks.filter(check => check.level === 'ok');
  const problems = [errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : '', warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''].filter(Boolean);
  const lines = [heading('Doctor'), '', bold(problems.length ? problems.join(' · ') : 'No problems found.'), muted(`Read-only · ${passed.length} checks passed`)];
  for (const check of [...errors, ...warnings]) {
    lines.push('', `  ${bold(`${check.level === 'error' ? 'Error' : 'Warning'} · ${check.name}`)}`, `    ${check.detail}`);
    if (check.next) lines.push(`    ${bold('Next:')} ${check.next}`);
  }
  // Keep the full diagnostic records in --json; the human overview emphasizes
  // problems and useful setup details rather than every healthy folder/file.
  const overview = new Set(['Node', 'CLI on PATH', 'Main owner', 'Registry', 'Skills']);
  const healthy = passed.filter(check => overview.has(check.name));
  if (healthy.length) lines.push('', bold('Setup'));
  const labels = { 'CLI on PATH': 'Command', 'Main owner': 'Owner', Registry: 'Projects' };
  for (const check of healthy) {
    const label = labels[check.name] || check.name;
    let detail = displayPath(check.detail);
    if (check.name === 'Registry') detail = check.detail.replace(/^(\d+) project\(s\) in (.*)$/, (_, count, folder) => `${count} registered · ${displayPath(folder)}`);
    lines.push(`  ${label.padEnd(12)}${muted(detail)}`);
  }
  for (const check of result.checks.filter(check => check.level === 'info')) {
    lines.push('', `  ${bold(check.name)} · ${muted(check.detail)}`);
    if (check.next) lines.push(`    ${check.next}`);
  }
  return lines.join('\n');
}
