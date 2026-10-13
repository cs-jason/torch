import { compareTaskPriority } from './task-order.js';
import { check } from './icons.js';
import { escape, button, date } from './format.js';

export function createViews({ getData, route, href, groupStates, copiedItems, activeProjects, showHome, showAllProjects, soundsEnabled, homeLimit, isArchivedWork }) {
  const groupHeading = (label, count) => `${escape(label)} <span class="group-count">${count}</span>`;
  const keyCombo = keys => `<span class="key-combo">${keys.map(key => `<kbd>${escape(key)}</kbd>`).join('')}</span>`;
  function shortcutRow(label, combinations) {
    return `<div class="shortcut-row"><span>${escape(label)}</span><span class="shortcut-keys">${combinations.map(keys => keyCombo(keys)).join('<span class="shortcut-or">or</span>')}</span></div>`;
  }
  function shortcutGuide() {
    const shortcuts = [
      shortcutRow('Exit page / select sidebar', [['←']]),
      shortcutRow('Select first task / open task', [['→'], ['Enter']]),
      shortcutRow('Previous task or project', [['↑']]),
      shortcutRow('Next task or project', [['↓']]),
      shortcutRow('Exit current view', [['Esc']]),
      shortcutRow('Search tasks, projects, and commands', [['⌘', 'K']]),
      shortcutRow('Move focused project', [['⌥', '↑'], ['⌥', '↓']]),
      shortcutRow('Open Settings', [['Shift', ',']]),
      shortcutRow('Open shortcut guide', [['?']]),
    ].join('');
    return `<section id="keyboard-shortcuts" class="settings-section shortcut-guide" tabindex="-1"><h2>Keyboard shortcuts</h2><div class="shortcut-list">${shortcuts}</div></section>`;
  }
  function archivePage() {
    const tasks = getData().tasks.filter(isArchivedWork).sort((a, b) => (b.archived?.at || b.updated).localeCompare(a.archived?.at || a.updated));
    const projectGroup = (project, items) => `<section class="archive-project"><h3><a href="${href({ project: project.id })}">${escape(project.name)}</a></h3>${items.length ? `<ul class="rows" role="list">${items.map(task => row(task, task.owner, true)).join('')}</ul>` : '<p class="small">No tasks.</p>'}</section>`;
    const active = activeProjects().map(project => {
      const items = tasks.filter(t => t.projectId === project.id);
      return items.length ? projectGroup(project, items) : '';
    }).join('');
    const archived = getData().projects.filter(p => p.archivedAt);
    const archivedGroups = archived.map(project => projectGroup(project, getData().tasks.filter(t => t.projectId === project.id).sort(compareTaskPriority))).join('');
    return `<h1>Archived</h1><section class="archive-section"><h2>Active Projects</h2>${active || '<p class="small">No completed or archived tasks.</p>'}</section>${archived.length ? `<details class="archive-section" data-group-key="archive:projects" ${groupStates.get('archive:projects') ? 'open' : ''}><summary>Archived Projects</summary>${archivedGroups}</details>` : '<section class="archive-section group-empty"><h2>Archived Projects</h2></section>'}`;
  }
  function projectFolders(project) {
    if (!project) return '';
    const folders = project.folders || [{ name: 'project', path: project.root, available: true }];
    return `<section class="prose settings-section"><h2>Project folders</h2>${folders.map(folder => `<p><strong>${folder.name === 'project' ? 'Task home' : '@' + escape(folder.name)}</strong>${folder.available ? '' : ' (unavailable)'}<br><code>${escape(folder.path)}</code></p>`).join('')}</section>`;
  }
  function taskReference(t, id) {
    const task = getData().tasks.find(item => item.projectId === t.projectId && item.id === id);
    return `<a href="${href({ project: t.projectId, task: id })}">${escape(task?.displayId || id)}${task ? ': ' + escape(task.title) : ''}</a>`;
  }
  function archiveBanner(t) {
    return t.archived ? `<p class="message">${t.mergedInto ? `Merged into ${taskReference(t, t.mergedInto)}.` : 'Archived.'} ${escape(t.archived.reason)}</p>` : '';
  }
  function organizationHistory(t) {
    return t.mergedFrom?.length ? `<section class="related"><h2>Consolidated records</h2><p class="small">Original documents and decisions are preserved in these records.</p><ul>${t.mergedFrom.map(id => `<li>${taskReference(t, id)}</li>`).join('')}</ul></section>` : '';
  }
  function settingsPage() {
    return `<h1>Settings</h1><section class="settings-section settings-about"><h2>What is Torch?</h2><p>A local workspace for you and your AI agents. Ask your agent to manage your projects, tasks, decisions, and progress. Use Torch to see where things stand and hand work to the next session.</p><p class="settings-help"><a class="text-link" href="#help">How it works</a></p></section>${featuresSettings()}${shortcutGuide()}<p class="settings-version"><picture><source srcset="/torch-logo-dark.svg" media="(prefers-color-scheme: dark)"><img src="/torch-logo.svg" alt="" width="18" height="18"></picture>Torch ${escape(getData().version || '')}</p>`;
  }
  function helpPage() {
    return `<h1>How it works</h1><div class="prose"><h2>Manage projects and tasks with your agent</h2><p>Just tell your agent (Claude Code, Codex or another) what you want to do. It can add, rename, archive, or restore projects, and create, organize, and update their tasks. Use Torch to read, review, and hand work to another session. Drag projects in the sidebar to put them in your preferred order.</p><h2>Home and All</h2><p>Home shows Next and Recent across active projects. Next follows the sidebar project order, using the usual task order within each project. Next and Recent each show up to three tasks by default; change either limit in Settings → Features. Features also lets you show or hide Home and All. Visible Home stays first, followed by All when enabled; both stay fixed while projects can be reordered. If Home is hidden, Torch lands on the first visible sidebar entry. Number shortcuts follow the visible order.</p><h2>Add a project</h2><p>Ask Codex to add your project folder to Torch. It runs <code>torch init</code>, and the project joins this dashboard with instructions for reading and updating its tasks.</p><h2>Link code and notes</h2><p>From another folder, run <code>torch link /path/to/task-home --name notes</code>. Both folders use the same records. <code>torch context</code> shows their locations. <code>torch unlink</code> removes the current folder's mapping and keeps task records.</p><h2>Keep working in Codex</h2><p>Torch automatically attaches the current Codex session when an agent creates or updates a task through the CLI. Session titles open Codex. Related sessions are saved links; Torch does not scan their conversations or monitor whether they are running. Agents leave short checkpoints so the next session can continue. Choose what task IDs do in Settings → Features. With Open task IDs in Codex enabled, clicking an ID opens a new draft in its project folder with the task reference prefilled; review it and press Send. With it off, IDs copy that reference to the clipboard. List IDs show a bottom confirmation; metadata IDs briefly show the confirmation in place. The reference points Codex to current context, sources, and checkpoints. Ask your AI agent to create tasks, record decisions, and update progress. Use this dashboard to read and review the work. Work stays readable when a conversation changes.</p><h2>Torch skills</h2><p>Use <code>$torch-plan</code> to turn future ideas into a small plan using existing tasks, with future work in Backlog and selected work in Next. Planning does not start execution. Use <code>$torch-consolidate</code> in Codex to merge overlapping tasks and retain useful steps. Use <code>$torch-reconcile</code> to update owners, blockers and status from relevant work. Install all three with <code>torch skills install</code>; run it again after updates. Routine tracking still follows each project’s instructions.</p><h2>Bring your existing list</h2><p><code>torch import tasks.md</code> copies top-level checkboxes into tasks and preserves the full original file. Importing is a snapshot, not a two-way sync. Torch flags later source changes so agents can reconcile them.</p><h2>Open or stop</h2><p><code>torch dashboard start</code> opens this dashboard. It continues running after the terminal closes. <code>torch dashboard stop</code> stops it. Agents can still read and update task files while it is stopped.</p><h2>Prioritization</h2><p>Attention holds up to three tasks per project, owned by you, the person using Torch. Tell Codex your name to configure the main owner. Reviews for other people go to Waiting on people. Blocked can belong to anyone. Additional reviews for you stay in Next with their owner and review requirements preserved. Codex infers priorities from your current goal and project stage: meaningful impact, removing blockers, speed to useful results, less duplication and right timing. Your explicit choices come first. A quick task is not automatically important. Codex records why priorities change when the plan changes or important work finishes. High comes before Normal, then Low; ties use oldest first. Edits do not move a task up the list, and Attention slots are not automatically refilled.</p><h2>What status means</h2><p>Backlog holds future ideas and postponed work. Next holds actionable work selected for your current focus. Ask Codex to organize the plan using existing tasks; planning does not start the work.</p><p>Tasks stay in Next while an agent works. Checkpoints record what changed; Attention and waiting states stay open until the required person has acted.</p></div>`;
  }
  const taskIdLabel = t => `Copy reference to ${t.displayId || t.id}`;
  function row(t, label = route().project ? t.owner : t.projectName, ownerLabel = !!route().project) {
    const completed = t.status === 'done';
    return `<li class="row" data-status="${escape(t.status)}">${button(escape(t.displayId || t.id), 'copy-task-row', `class="task-id task-id-copy" data-task-id="${escape(t.id)}" data-project-id="${escape(t.projectId)}" aria-label="${escape(taskIdLabel(t))}" title="${escape(taskIdLabel(t))}"`)}<a href="${href({ project: t.projectId, task: t.id })}" title="${escape(t.id)}" aria-label="${escape(`${t.displayId || t.id}: ${t.title}${completed ? ', completed' : ''}`)}">${escape(t.title)}${completed ? check : ''}</a><span class="project${ownerLabel ? ' owner-label' : ''}">${escape(label)}</span></li>`;
  }
  function group(status, tasks) {
    const items = tasks.filter(t => t.status === status);
    const folded = ['done', 'backlog'].includes(status);
    const heading = groupHeading(getData().labels[status], items.length);
    if (!items.length) return `<section class="group group-empty" data-status="${status}"><h2>${heading}</h2></section>`;
    const rows = `<ul class="rows" role="list">${items.map(task => row(task)).join('')}</ul>`;
    const key = `${route().project || 'all'}:${status}`;
    const open = groupStates.get(key) ?? !folded;
    return `<details class="group" data-status="${status}" data-group-key="${escape(key)}" ${open ? 'open' : ''}><summary>${heading}</summary>${rows}</details>`;
  }
  function projectPage() {
    const r = route(), project = getData().projects.find(p => p.id === r.project);
    if (r.project && !project) return '<h1>Project unavailable</h1><p class="small">This project could not be loaded.</p>';
    const active = new Set(activeProjects().map(p => p.id));
    const tasks = getData().tasks.filter(t => !t.archived && (project ? t.projectId === project.id : active.has(t.projectId))).sort(compareTaskPriority);
    const populated = new Set(tasks.map(t => t.status));
    const statusOrder = [...getData().statuses.filter(s => populated.has(s)), ...getData().statuses.filter(s => !populated.has(s))];
    const errors = getData().errors.filter(e => !project || e.project === project.name).map(e => `<p class="message">${escape(e.project)}: ${escape(e.message)}</p>`).join('');
    document.title = `${project?.name || 'All projects'} · Torch`;
    const context = project ? `<p class="project-context-footer"><a class="project-context" href="${href({ project: project.id, doc: '.torch/CONTEXT.md' })}">Project context</a></p>` : '';
    return `<header class="title-line project-heading"><h1>${escape(project?.name || 'All projects')}</h1></header>${project?.archivedAt ? '<p class="small">Archived project</p>' : ''}${errors}${statusOrder.map(s => group(s, tasks)).join('')}${context}`;
  }
  function homePage() {
    document.title = 'Home · Torch';
    const projects = activeProjects();
    const active = new Set(projects.map(p => p.id));
    const tasks = getData().tasks.filter(t => !t.archived && active.has(t.projectId));
    const upNext = projects.flatMap(project => tasks.filter(t => t.projectId === project.id && t.status === 'next').sort(compareTaskPriority)).slice(0, homeLimit('homeReviewLimit'));
    const recent = [...tasks].sort((a, b) => b.updated.localeCompare(a.updated) || b.created.localeCompare(a.created)).slice(0, homeLimit('homeRecentLimit'));
    const rows = items => `<ul class="rows" role="list">${items.map(t => row(t, t.projectName, false)).join('')}</ul>`;
    const errors = getData().errors.map(e => `<p class="message">${escape(e.project)}: ${escape(e.message)}</p>`).join('');
    const nextSection = `<section class="group ${upNext.length ? '' : 'group-empty'}" data-home-section="next"><h2>${groupHeading('Next', upNext.length)}</h2>${upNext.length ? rows(upNext) : ''}</section>`;
    const recentSection = `<section class="group ${recent.length ? '' : 'group-empty'}" data-home-section="recent"><h2>${groupHeading('Recent', recent.length)}</h2>${recent.length ? rows(recent) : ''}</section>`;
    return `<h1>Home</h1>${errors}${nextSection}${recentSection}`;
  }
  function featuresSettings() {
    const toggle = (id, label, checked, action) => `<div class="toggle-row"><label id="${id}-label" for="${id}">${label}</label><button id="${id}" type="button" role="switch" aria-checked="${checked}" aria-labelledby="${id}-label" class="toggle" data-action="${action}"><span aria-hidden="true"></span></button></div>`;
    const limits = [['homeReviewLimit', 'Next tasks on Home'], ['homeRecentLimit', 'Recent tasks on Home']].map(([key, label]) => `<div class="home-limit-row"><label for="${key}">${label}</label><div class="home-limit-control"><output for="${key}" aria-hidden="true">${homeLimit(key)}</output><input id="${key}" data-home-limit="${key}" type="range" min="3" max="10" step="1" value="${homeLimit(key)}" aria-label="Maximum ${label.toLowerCase()}"></div></div>`).join('');
    return `<section class="settings-section features"><h2>Features</h2>${toggle('show-home', 'Show Home in sidebar', showHome(), 'toggle-home')}${toggle('show-all-projects', 'Show All in sidebar', showAllProjects(), 'toggle-all-projects')}${toggle('ui-sounds', 'UI sound effects', soundsEnabled(), 'toggle-ui-sounds')}${limits}</section>`;
  }
  function sessionAnchor(t, sessionId, title) {
    return `<span class="session-title">${escape(title || sessionId)}</span>`;
  }
  function copyButton(action, id, text, copyLabel = text) {
    const copied = copiedItems.has(`${action}:${id}`);
    const label = copied ? 'Copied to clipboard' : copyLabel;
    return button(`<span class="copy-value" aria-hidden="true">${escape(text)}</span><span class="copy-success" aria-hidden="true">Copied to clipboard</span>`, action, `class="text-copy ${action === 'copy-task' ? 'task-reference-copy' : 'session-id session-copy'}" data-id="${escape(id)}" data-copied="${copied}" data-copy-label="${escape(copyLabel)}" data-success-label="Copied to clipboard" aria-label="${escape(label)}" title="${escape(label)}"`);
  }
  function sessionCopyButton(sessionId) {
    return copyButton('copy-session', sessionId, sessionId, `Copy session ID ${sessionId}`);
  }
  function sessionSection(t) {
    return `<section class="related"><h2>Related sessions</h2>${t.sessions.length ? `<ul class="session-list" role="list">${t.sessions.map(s => `<li class="session-row"><div class="session-heading"><h3>${sessionAnchor(t, s.id, s.title)}</h3><time class="session-date" datetime="${escape(s.updated)}" title="Last recorded">${date(s.updated)}</time></div><div class="session-reference">${sessionCopyButton(s.id)}</div></li>`).join('')}</ul>` : '<p class="small">No related sessions.</p>'}</section>`;
  }
  function taskPage(t) {
    if (!t) return '<h1>Task unavailable</h1><p>The task may have moved or its project is unavailable.</p><a href="#">Home</a>';
    document.title = `${t.title} · Torch`;
    const notesHtml = t.notes.length ? t.notes.map(n => `<section class="note"><h3>${date(n.created)} / ${escape(n.author)}${n.originTaskId ? ` / From ${taskReference(t, n.originTaskId)}` : ''}${n.sessionId ? ` / ${sessionAnchor(t, n.sessionId, t.sessions.find(s => s.id === n.sessionId)?.title || n.sessionId)}` : ''}</h3><div class="prose">${n.html}</div></section>`).join('') : '<p class="small">No checkpoints yet.</p>';
    return `<article><header class="task-header"><h1>${escape(t.title)}</h1><p class="meta">${copyButton('copy-task', `${t.projectId}:${t.id}`, t.displayId || t.id, taskIdLabel(t))} · <span class="owner-label">${escape(t.owner)}</span> · ${getData().labels[t.status]} · ${date(t.updated)}</p></header>${archiveBanner(t)}${(t.errors || []).map(error => `<p class="message">${escape(error.message)}</p>`).join('')}${t.sourceChanged ? '<p class="message">The original source has changed since this import. Check it before continuing this task.</p>' : ''}<div class="prose">${t.html}</div>${organizationHistory(t)}${sessionSection(t)}<section class="related"><h2>Session notes</h2>${notesHtml}</section></article>`;
  }
  return { settingsPage, helpPage, homePage, projectPage, archivePage, taskPage, projectFolders };
}
