// Human views: short, glanceable output. Agents use torch context and --json instead.
import { registry, registeredProject, listTasks, isMainOwner, sizeWarnings, fail, limits } from './store.mjs';
import { terminal, displayPath, age } from './terminal.mjs';

const open = t => !t.archived && t.status !== 'done';
const mine = t => open(t) && ['next', 'waiting'].includes(t.status) && isMainOwner(t.owner);
const cut = (value, max) => value.length > max ? value.slice(0, Math.max(1, max - 1)) + '…' : value;
const recent = (a, b) => b.updated.localeCompare(a.updated);

export function summaries({ all = false } = {}) {
  return registry().filter(e => all || !e.archivedAt).sort((a, b) => Boolean(a.archivedAt) - Boolean(b.archivedAt)).map(entry => {
    try {
      const tasks = listTasks(registeredProject(entry.id));
      return { entry, you: tasks.filter(mine).length, next: tasks.filter(t => open(t) && t.status === 'next').length };
    } catch (error) { return { entry, error: error.message }; }
  });
}

export function findProject(query) {
  const key = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const q = key(query), entries = registry();
  if (!q) return null;
  const exact = entries.filter(e => key(e.code) === q || key(e.name) === q || key(e.root.split('/').at(-1)) === q);
  const matches = exact.length ? exact : entries.filter(e => key(e.name).startsWith(q) || key(e.root.split('/').at(-1)).startsWith(q));
  if (matches.length > 1) fail(`"${query}" matches ${matches.map(e => `${e.name} (${e.code})`).join(', ')}. Use the project code.`);
  return matches[0] || null;
}

export function formatHome(rows, { all = false, archivedCount = 0 } = {}) {
  const t = terminal();
  if (!rows.length) return `${t.mark}${t.bold('torch')}\n\nNo projects yet. Add one with ${t.bold('torch init <folder>')}.`;
  const needing = rows.reduce((sum, r) => sum + (r.you || 0), 0);
  const nameWidth = Math.max(7, ...rows.map(r => r.entry.name.length)) + 2;
  const pathWidth = Math.max(20, t.width - nameWidth - 22);
  const lines = [`${t.mark}${t.bold('torch')}  ${t.muted(`${rows.length} project${rows.length === 1 ? '' : 's'} · `)}${needing ? t.amber(`${needing} task${needing === 1 ? '' : 's'} need${needing === 1 ? 's' : ''} you`) : t.muted('nothing needs you')}`, ''];
  lines.push(t.muted(`  ${'    '} ${'project'.padEnd(nameWidth)}${'you'.padStart(3)}  ${'next'.padStart(4)}   where`));
  for (const r of rows) {
    const code = t.muted((r.entry.code || '—').padEnd(4)), name = r.entry.archivedAt ? t.muted(r.entry.name.padEnd(nameWidth)) : t.bold(r.entry.name.padEnd(nameWidth));
    if (r.error) { lines.push(`  ${code} ${name}${t.red(cut(r.error, pathWidth))}`); continue; }
    const you = r.you ? t.amber(String(r.you).padStart(3)) : ' '.repeat(3);
    const next = r.next > limits.next ? t.red(String(r.next).padStart(4)) : String(r.next || '').padStart(4);
    lines.push(`  ${code} ${name}${you}  ${next}   ${t.muted(displayPath(r.entry.root, pathWidth))}`);
  }
  lines.push('');
  if (!all && archivedCount) lines.push(t.muted(`  ${archivedCount} archived · torch project list --all`));
  lines.push(`  ${t.muted('next:')} torch needs  ${t.muted('·')}  torch <project>  ${t.muted('·')}  torch <task ID>  ${t.muted('·')}  torch help`);
  return lines.join('\n');
}

const glyphs = { next: '●', waiting: '◐', backlog: '○', done: '✓' };
function statusMark(t, status) {
  const color = { next: t.amber, waiting: t.blue, backlog: t.muted, done: t.green }[status];
  return t.styled ? color(glyphs[status]) : status.padEnd(7);
}
// The title column fits the longest title; it only shortens when the terminal is too narrow.
function titleWidth(t, rows) {
  const longest = Math.max(10, ...rows.map(([task]) => task.title.length)), detail = Math.max(0, ...rows.map(([, d]) => d.length));
  return Math.min(longest, Math.max(20, t.width - 14 - detail));
}
function taskLine(t, task, detail, titleWidth) {
  if (task.archived) return t.muted(`  ${t.styled ? '–' : 'archived'} ${(task.displayId || task.id).padEnd(7)} ${cut(task.title, titleWidth).padEnd(titleWidth)}  ${detail}`);
  return `  ${statusMark(t, task.status)} ${t.muted((task.displayId || task.id).padEnd(7))} ${cut(task.title, titleWidth).padEnd(titleWidth)}  ${t.muted(detail)}`;
}

function goal(context) {
  const section = /^##\s+Goal[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/mi.exec(context)?.[1] || '';
  return section.split('\n').map(line => line.replace(/^[-*>\s]+|[*_`]/g, '').trim()).find(Boolean) || '';
}

// extra: which hidden lists to add, from --backlog, --done, --archived or --all.
export function formatProject(p, tasks, context, folders, { extra = [] } = {}) {
  const t = terminal();
  const active = tasks.filter(open).sort(recent);
  const yours = active.filter(mine), others = active.filter(x => !mine(x) && x.status !== 'backlog');
  const rest = extra.map(name => [name, tasks.filter(x => name === 'archived' ? x.archived : !x.archived && x.status === name).sort(recent)]);
  const detail = x => `${x.owner} · ${age(x.updated)}`;
  const width = titleWidth(t, [...yours.map(x => [x, age(x.updated)]), ...[...others, ...rest.flatMap(([, list]) => list)].map(x => [x, detail(x)])]);
  const lines = [`${t.mark}${t.bold(p.name)}  ${t.muted(`${p.code} · ${displayPath(p.root, t.width - p.name.length - 10)}`)}`];
  const g = goal(context);
  if (g) lines.push(`  ${t.muted('goal')}  ${cut(g, t.width - 10)}`);
  if (p.archivedAt) lines.push(`  ${t.red('archived')} ${t.muted('· torch project restore --project ' + displayPath(p.root))}`);
  lines.push('', yours.length ? t.amber('needs you') : t.muted('nothing needs you'));
  for (const task of yours) lines.push(taskLine(t, task, age(task.updated), width));
  if (others.length) { lines.push(t.bold('others')); for (const task of others) lines.push(taskLine(t, task, detail(task), width)); }
  for (const [name, list] of rest) { lines.push(t.muted(list.length ? name : `no ${name} tasks`)); for (const task of list) lines.push(taskLine(t, task, detail(task), width)); }
  const backlog = tasks.filter(x => !x.archived && x.status === 'backlog').length, done = tasks.filter(x => !x.archived && x.status === 'done').length;
  if (!extra.length) lines.push(t.muted(`${backlog} backlog · ${done} done · --backlog, --done or --all to list them`));
  lines.push('');
  const linked = folders.filter(f => f.name !== 'project').map(f => f.available ? f.name : `${f.name} (missing)`);
  if (linked.length) lines.push(`  ${t.muted('linked')}  ${linked.join('  ')}`);
  const warnings = sizeWarnings(context, tasks);
  if (warnings.length) lines.push(`  ${t.red('tidy first')}  ${t.muted(warnings.map(w => w.short).join(' · '))}`);
  return lines.join('\n').trimEnd();
}

function sections(body) {
  const found = {};
  for (const match of body.matchAll(/^##\s+(\w+)[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/gm)) found[match[1].toLowerCase()] = match[2].trim();
  return found;
}

export function formatTask(task, notes) {
  const t = terminal(), width = t.width - 12;
  const status = task.archived ? t.muted(task.mergedInto ? `merged into ${task.mergedInto}` : 'archived') : `${t.styled ? statusMark(t, task.status) + ' ' : ''}${task.status}`;
  const lines = [`${status}  ${t.bold(task.title)}  ${t.muted(`${task.displayId || task.id} · ${task.owner} · ${age(task.updated)}`)}`, ''];
  const parts = sections(task.body), shown = ['why', 'done', 'next'].filter(key => parts[key]);
  if (shown.length) for (const key of shown) {
    parts[key].split('\n').filter(Boolean).slice(0, 3).forEach((line, i) => lines.push(`  ${t.muted((i ? '' : key).padEnd(6))} ${cut(line.trim(), width)}`));
  } else task.body.split('\n').filter(line => line.trim()).slice(0, 6).forEach(line => lines.push(`  ${cut(line.trim(), width + 7)}`));
  if (notes.length) {
    lines.push('', t.muted('  ── checkpoints ──'));
    for (const note of notes.slice(0, 3)) lines.push(`  ${t.muted(`${age(note.created).padEnd(4)} ${cut(note.author, 10).padEnd(10)}`)} ${cut(note.body.replace(/\s+/g, ' '), width - 6)}`);
  }
  lines.push('', t.muted(`  full record: torch task show ${task.displayId || task.id}`));
  return lines.join('\n');
}

export function formatNeeds() {
  const t = terminal();
  const items = [];
  for (const entry of registry().filter(e => !e.archivedAt)) {
    try { for (const task of listTasks(registeredProject(entry.id)).filter(mine)) items.push({ task, entry }); } catch {}
  }
  if (!items.length) return `${t.mark}${t.bold('Nothing needs you.')}`;
  items.sort((a, b) => recent(a.task, b.task));
  const groups = Map.groupBy(items, item => item.entry), width = titleWidth(t, items.map(({ task }) => [task, age(task.updated)]));
  const lines = [`${t.mark}${t.amber(`${items.length} need${items.length === 1 ? 's' : ''} you`)}`];
  for (const [entry, group] of groups) {
    lines.push('', `${t.bold(entry.name)}  ${t.muted(`${entry.code} · ${group.length}`)}`);
    for (const { task } of group) lines.push(taskLine(t, task, age(task.updated), width));
  }
  return lines.join('\n');
}
