import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initProject, createTask, getTask, updateTask, checkpointTask, listTasks, notes, read, taskFile, saveMainOwner } from '../src/store.mjs';
import { installSkills, skillNames } from '../src/skills.mjs';
import { doctor } from '../src/doctor.mjs';
import { parse } from 'yaml';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'torch-v1-tests-'));
Object.assign(process.env, { TORCH_HOME: path.join(base, 'registry'), CODEX_HOME: path.join(base, 'codex'), CLAUDE_CONFIG_DIR: path.join(base, 'claude') });
for (const key of ['CODEX_THREAD_ID', 'CLAUDE_CODE_SESSION_ID', 'TORCH_AGENT', 'TORCH_SESSION_ID', 'TORCH_SESSION_KIND', 'TORCH_SESSION_TITLE']) delete process.env[key];
saveMainOwner('Jason');
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const run = (args, { cwd = base, env = {} } = {}) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const project = name => { const root = path.join(base, name); fs.mkdirSync(root); return initProject(root, name); };
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test('v0 records stay readable and are rewritten with v1 values on their next save', () => {
  const p = project('Legacy'), t = createTask(p, { title: 'Old style task' });
  const file = taskFile(p, t.id);
  const legacy = { attention: 'next', blocked: 'waiting', deferred: 'backlog', working: 'next' };
  for (const [old, now] of Object.entries(legacy)) {
    fs.writeFileSync(file, read(file).replace(/^status: .*$/m, `status: ${old}\npriority: high\nattentionQueued: true`));
    const current = getTask(p, t.id);
    assert.equal(current.status, now); assert.equal(current.priority, undefined); assert.equal(current.attentionQueued, undefined);
    updateTask(p, t.id, { owner: 'Jason' }, current.revision);
    const saved = read(file);
    assert.match(saved, new RegExp(`^status: ${now}$`, 'm')); assert.doesNotMatch(saved, /^priority:/m); assert.doesNotMatch(saved, /attentionQueued/);
  }
  // Old skills that still say "attention" keep working; unknown values are refused.
  assert.equal(updateTask(p, t.id, { status: 'attention' }, getTask(p, t.id).revision).status, 'next');
  assert.throws(() => updateTask(p, t.id, { status: 'imaginary' }), /Status must be one of/);
  assert.equal(createTask(p, { title: 'Default body' }).body, '## Why\n\n## Done\n\n## Access\n\n## Next');
});

test('Codex and Claude sessions link automatically and keep their saved titles', () => {
  const p = project('Sessions'), t = createTask(p, { title: 'Agent work' });
  const checkpoint = (env, ...extra) => run(['task', 'checkpoint', t.id, '--project', p.root, '--revision', getTask(p, t.id).revision, '--note', 'Progress', ...extra], { env });
  assert.equal(checkpoint({ CLAUDE_CODE_SESSION_ID: 'claude-session-1234' }, '--session-title', 'Website copy').status, 0);
  assert.equal(checkpoint({ CLAUDE_CODE_SESSION_ID: 'claude-session-1234' }).status, 0);
  assert.equal(checkpoint({ CODEX_THREAD_ID: 'codex-thread-1', CLAUDE_CODE_SESSION_ID: 'ignored' }).status, 0);
  assert.equal(checkpoint({}, '--session', 'bot-run-7', '--agent', 'ReviewBot').status, 0);
  // A link saved as generic upgrades once the kind is detected; specific kinds never swap.
  assert.equal(checkpoint({}, '--session', 'claude-later').status, 0);
  assert.equal(checkpoint({ CLAUDE_CODE_SESSION_ID: 'claude-later' }).status, 0);
  assert.match(checkpoint({ CODEX_THREAD_ID: 'claude-session-1234' }).stderr, /different session kind/);
  const sessions = Object.fromEntries(getTask(p, t.id).sessions.map(s => [s.id, [s.kind, s.title]]));
  assert.deepEqual(sessions, { 'claude-session-1234': ['claude', 'Website copy'], 'codex-thread-1': ['codex', 'Codex session codex-th'], 'bot-run-7': ['generic', 'ReviewBot session bot-run-'], 'claude-later': ['claude', 'Agent session claude-l'] });
  assert.deepEqual(notes(p, t.id).map(n => n.author).sort(), ['Agent', 'Claude', 'Claude', 'Claude', 'Codex', 'ReviewBot']);
});

test('a readable task ID resolves from any folder; --project still wins', () => {
  const one = project('Alpha'), two = project('Bravo');
  const a = createTask(one, { title: 'Alpha task' }), b = createTask(two, { title: 'Bravo task' });
  const elsewhere = path.join(base, 'unrelated'); fs.mkdirSync(elsewhere);
  const context = run(['context', a.displayId, '--json'], { cwd: two.root });
  assert.equal(context.status, 0, context.stderr); assert.equal(JSON.parse(context.stdout).tasks[0].title, 'Alpha task');
  assert.equal(JSON.parse(run(['task', 'show', b.displayId, '--json'], { cwd: elsewhere }).stdout).title, 'Bravo task');
  assert.match(run(['context'], { cwd: elsewhere }).stderr, /No Torch project found/);
  assert.match(run(['task', 'show', b.displayId, '--project', one.root]).stderr, /Task not found/);
});

test('doctor warns about oversized context and task bodies', async () => {
  const p = project('Sizes');
  fs.writeFileSync(path.join(p.root, '.torch/CONTEXT.md'), 'word '.repeat(700));
  // Older records can already be oversized; the limit only applies to new writes.
  const t = createTask(p, { title: 'Long task' });
  fs.writeFileSync(taskFile(p, t.id), read(taskFile(p, t.id)).replace('## Why', 'word '.repeat(600)));
  createTask(p, { title: 'Short task' });
  const warnings = (await doctor(p.root)).checks.filter(c => c.level === 'warning' && c.name === 'Sizes').map(c => c.detail);
  assert.ok(warnings.some(w => /CONTEXT.md is 700 words/.test(w)));
  assert.ok(warnings.some(w => w.includes(`${t.displayId} (606)`)));
  assert.equal(warnings.length, 2);
  for (let i = 0; i < 5; i++) createTask(p, { title: `Extra ${i}` });
  assert.ok((await doctor(p.root)).checks.some(c => c.detail === '7 tasks are next (limit 5).'));
});

test('writes over the size limits are refused; context flags what to tidy first', () => {
  const p = project('Limits'), t = createTask(p, { title: 'Lean task' });
  const long = 'word '.repeat(501);
  assert.throws(() => createTask(p, { title: 'Too long', body: long }), /Task body is 501 words; maximum is 500/);
  assert.throws(() => updateTask(p, t.id, { body: long }, getTask(p, t.id).revision), /maximum is 500/);
  assert.throws(() => checkpointTask(p, t.id, {}, { body: 'word '.repeat(151) }, getTask(p, t.id).revision), /Checkpoint is 151 words; maximum is 150/);
  assert.deepEqual(notes(p, t.id), []); assert.equal(getTask(p, t.id).body, t.body);
  // An oversized legacy body still allows status and owner changes.
  fs.writeFileSync(taskFile(p, t.id), read(taskFile(p, t.id)).replace('## Why', long));
  assert.equal(updateTask(p, t.id, { status: 'waiting' }, getTask(p, t.id).revision).status, 'waiting');
  fs.writeFileSync(path.join(p.root, '.torch/CONTEXT.md'), 'word '.repeat(700));
  const shown = run(['context', '--project', p.root]).stdout;
  assert.match(shown, /^Tidy first:\n- CONTEXT.md is 700 words/); assert.match(shown, /LI-001 \(50\d\)/);
  assert.equal(JSON.parse(run(['context', '--json', '--project', p.root]).stdout).warnings.length, 2);
});

test('human views: home table, project card, task view, needs and path', () => {
  const p = project('Views Demo');
  const mineTask = createTask(p, { title: 'Approve the pricing copy', status: 'waiting', body: '## Why\n\nBlocks launch.\n\n## Next\n\nPick option B.' });
  createTask(p, { title: 'Build upload flow', owner: 'Codex' });
  const plain = args => { const r = run(args, { cwd: base }); assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(r.stdout, /\x1b/); return r.stdout; };
  assert.match(plain(['project', 'list']), new RegExp(`${p.code}\\s+Views Demo\\s+1\\s+1`));
  for (const query of [p.code.toLowerCase(), 'views demo', 'viewsdemo']) assert.match(plain([query]), /needs you\n\s+waiting\s+\S+\s+Approve the pricing copy/);
  assert.match(plain(['project', 'views']), /others\n\s+next\s+\S+\s+Build upload flow\s+Codex/);
  const task = plain([mineTask.displayId]);
  assert.match(task, /^waiting  Approve the pricing copy/); assert.match(task, /why\s+Blocks launch\./); assert.match(task, /next\s+Pick option B\./);
  assert.match(plain(['needs']), /Views Demo\s+\S+ · 1\n\s+waiting\s+\S+\s+Approve the pricing copy/);
  createTask(p, { title: 'Someday idea', status: 'backlog' });
  assert.doesNotMatch(plain([p.code]), /Someday idea/);
  assert.match(plain([p.code, '--all']), /backlog\n\s+backlog\s+\S+\s+Someday idea/);
  assert.match(plain([p.code, '--backlog']), /Someday idea/); assert.match(plain([p.code, '--done']), /no done tasks/);
  assert.match(plain(['help']), /Flags\n\s+--backlog/);
  assert.equal(plain(['path', p.code]).trim(), p.root);
  assert.match(run(['nonsense-word']).stderr, /Unknown command or project/);
});

test('skills install as links into Codex and Claude, moving old copies aside', () => {
  const codex = path.join(process.env.CODEX_HOME, 'skills'), claude = path.join(process.env.CLAUDE_CONFIG_DIR, 'skills');
  fs.mkdirSync(path.join(codex, 'torch-plan'), { recursive: true }); fs.writeFileSync(path.join(codex, 'torch-plan', 'SKILL.md'), 'old copy');
  fs.mkdirSync(path.join(codex, 'torch-reconcile'), { recursive: true });
  fs.mkdirSync(path.join(codex, 'my-skill'), { recursive: true });
  const first = installSkills();
  assert.equal(first.moved.length, 2);
  assert.equal(read(path.join(first.moved.find(m => m.endsWith('torch-plan')), 'SKILL.md')), 'old copy');
  for (const dir of [codex, claude]) for (const name of skillNames) assert.ok(fs.lstatSync(path.join(dir, name)).isSymbolicLink());
  assert.equal(fs.existsSync(path.join(codex, 'torch-reconcile')), false); assert.ok(fs.existsSync(path.join(codex, 'my-skill')));
  assert.equal(installSkills().moved.length, 0);
});

test('init writes the short guide, one AGENTS.md block and stays repeatable', () => {
  const p = project('Guide');
  assert.match(read(path.join(p.root, '.torch/README.md')), /torch help rules/);
  assert.equal(read(path.join(p.root, 'AGENTS.md')).match(/torch:start/g).length, 1);
  initProject(p.root);
  assert.equal(read(path.join(p.root, 'AGENTS.md')).match(/torch:start/g).length, 1);
  assert.match(run(['help', 'rules']).stdout, /waiting\s+on a person or another task/);
  assert.equal(listTasks(p).length, 0);
});

test('credential-shaped text is refused on write and flagged by doctor', async () => {
  const p = project('Secrets'), t = createTask(p, { title: 'Wire up payments' });
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP', token = 'ghp_' + 'a'.repeat(36);
  assert.throws(() => createTask(p, { title: 'Leaky', body: `Use ${key}` }), /Task body looks like it contains a credential \(AWS access key\)/);
  assert.throws(() => updateTask(p, t.id, { body: `Token ${token}` }, getTask(p, t.id).revision), /GitHub token/);
  assert.throws(() => checkpointTask(p, t.id, {}, { body: 'Changed: db at postgres://app:hunter2@db.example.com/x' }, getTask(p, t.id).revision), /password in a URL/);
  assert.deepEqual(notes(p, t.id), []);
  // Ordinary links and SSH remotes are not credentials.
  checkpointTask(p, t.id, {}, { body: 'Changed: see https://example.com/a@b and git@github.com:me/app.git' }, getTask(p, t.id).revision);
  assert.equal((await doctor(p.root)).ok, true);
  fs.writeFileSync(path.join(p.root, '.torch/CONTEXT.md'), `Key: ${key}`);
  const flagged = (await doctor(p.root)).checks.find(c => c.level === 'error');
  assert.match(flagged.detail, /CONTEXT\.md looks like it contains a credential \(AWS access key\)/); assert.doesNotMatch(flagged.detail, /AKIA/);
});

test('init --public adds the guard workflow once and keeps an edited copy', () => {
  const root = path.join(base, 'Public'); fs.mkdirSync(root);
  const r = run(['init', root, '--public']);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /torch-guard\.yml/);
  const file = path.join(root, '.github/workflows/torch-guard.yml'), workflow = parse(read(file));
  assert.ok(workflow.on.pull_request_target !== undefined); assert.equal(workflow.jobs['pull-request'].steps.some(s => s.uses), false);
  fs.writeFileSync(file, 'edited');
  run(['init', root, '--public']); assert.equal(read(file), 'edited');
  assert.equal(fs.existsSync(path.join(project('Private').root, '.github')), false);
});
