import fs from 'node:fs';
import path from 'node:path';
import { home, read, locked, atomic, id, text, fail, now } from './storage.mjs';

export function projectAt(start = process.cwd()) {
  let dir = fs.realpathSync(start);
  const entries = registry();
  while (true) {
    const linked = entries.filter(p => (p.links || []).some(link => link.path === dir));
    if (linked.length > 1) fail('This folder is linked to more than one project. Unlink the conflicting mapping.');
    if (fs.existsSync(path.join(dir, '.torch/project.json'))) {
      const p = loadProject(dir), existing = entries.find(entry => entry.id === p.id);
      if (linked.length || (existing && existing.root !== p.root)) fail(`This checkout has its own copy of Torch records. Use --project ${existing?.root || linked[0].root} for shared records; do not edit both copies.`);
      return p;
    }
    if (linked.length) return registeredProject(linked[0].id);
    const parent = path.dirname(dir); if (parent === dir) fail('No Torch project found. Run torch init first.'); dir = parent;
  }
}
export function loadProject(dir) {
  const project = JSON.parse(read(path.join(dir, '.torch/project.json')));
  id(project.id); text(project.name, 'Project name');
  if (project.code !== undefined && (!/^[A-Z]{2}$/.test(project.code) || project.code === 'TK')) fail('Project code must be two capital letters other than TK.');
  if (project.legacyCodes !== undefined && (!Array.isArray(project.legacyCodes) || project.legacyCodes.some(code => !/^[A-Z]{2}$/.test(code) || code === 'TK'))) fail('Invalid retained task codes.');
  if (project.aliases !== undefined) {
    if (!Array.isArray(project.aliases)) fail('Invalid project aliases.');
    for (const alias of project.aliases) { id(alias.id); id(alias.folder); }
  }
  if (project.nextTaskNumber !== undefined && (!Number.isSafeInteger(project.nextTaskNumber) || project.nextTaskNumber < 1)) fail('Invalid next task number.');
  if (project.archivedAt !== undefined && !Number.isFinite(Date.parse(project.archivedAt))) fail('Invalid project archive date.');
  return { ...project, root: fs.realpathSync(dir) };
}
export function registry() { return JSON.parse(read(path.join(home(), 'projects.json'), '[]')); }
export function availableProjectCode(name) {
  const letters = (name.toUpperCase().match(/[A-Z]/g) || []).join('');
  if (letters.length < 2) fail('Project names need at least two letters for task IDs.');
  const used = new Set(['TK', ...registry().flatMap(p => [p.code, ...(p.legacyCodes || [])]).filter(Boolean)]);
  const candidates = [letters.slice(0, 2), ...letters.slice(1).split('').map(letter => letters[0] + letter)];
  const code = candidates.find(value => !used.has(value));
  if (!code) fail('No available two-letter task code for this project.');
  return code;
}
export function register(project) {
  locked(home(), () => {
    const entries = registry();
    if (entries.some(p => p.id !== project.id && p.aliases?.some(alias => alias.id === project.id))) fail('This project was combined into another task home. Use its linked folder instead of registering the old records.');
    const collision = entries.find(p => p.id === project.id && p.root !== project.root && fs.existsSync(p.root));
    if (collision) fail(`This project ID is already registered at ${collision.root}. Use that checkout for shared Torch records.`);
    const codes = [project.code, ...(project.legacyCodes || [])].filter(Boolean);
    if (entries.some(p => p.id !== project.id && [p.code, ...(p.legacyCodes || [])].some(code => codes.includes(code)))) fail('A task code is already used by another project.');
    const previous = entries.find(p => p.id === project.id);
    const entry = { ...project, ...(previous?.links ? { links: previous.links } : {}) };
    const retained = entries.filter(p => p.id === project.id || p.root !== project.root);
    saveRegistry(previous ? retained.map(p => p.id === project.id ? entry : p) : [...retained, entry]);
  });
}
function saveRegistry(entries) { atomic(path.join(home(), 'projects.json'), JSON.stringify(entries, null, 2) + '\n'); }
export function setProjectArchived(p, archived) {
  if (typeof archived !== 'boolean') fail('Choose archive or restore.');
  const updated = locked(path.join(p.root, '.torch'), () => {
    const next = loadProject(p.root);
    if (archived) next.archivedAt ||= now(); else delete next.archivedAt;
    const { root, ...config } = next;
    atomic(path.join(root, '.torch/project.json'), JSON.stringify(config, null, 2) + '\n');
    return next;
  });
  register(updated);
  return updated;
}
export function renameProject(p, name) {
  const updated = locked(path.join(p.root, '.torch'), () => {
    const next = { ...loadProject(p.root), name: text(name, 'Project name') };
    const { root, ...config } = next;
    atomic(path.join(root, '.torch/project.json'), JSON.stringify(config, null, 2) + '\n');
    return next;
  });
  register(updated);
  for (const folder of projectFolders(updated).filter(f => f.name !== 'project' && f.available)) {
    const instruction = routeInstructions(folder.path, updated);
    if (instruction.next !== instruction.current) atomic(instruction.file, instruction.next);
  }
  return updated;
}
const contains = (root, file) => file === root || file.startsWith(root + path.sep);
function canonicalPath(file) {
  const absolute = path.resolve(file);
  try { return fs.realpathSync(absolute); }
  catch (e) { if (e.code !== 'ENOENT' || path.dirname(absolute) === absolute) throw e; return path.join(canonicalPath(path.dirname(absolute)), path.basename(absolute)); }
}
function folderAvailable(folder) {
  try { return fs.realpathSync(folder) === folder && fs.statSync(folder).isDirectory(); } catch { return false; }
}
export function projectFolders(p, entries = registry()) {
  const entry = entries.find(entry => entry.id === p.id && entry.root === p.root);
  return [{ name: 'project', path: p.root }, ...(entry?.links || [])].map(folder => ({ ...folder, available: folderAvailable(folder.path) }));
}
function routeInstructions(root, project) {
  const file = path.join(root, fs.existsSync(path.join(root, 'AGENTS.override.md')) ? 'AGENTS.override.md' : 'AGENTS.md');
  const current = read(file, ''), begin = '<!-- torch-route:start -->', end = '<!-- torch-route:end -->';
  const start = current.indexOf(begin), finish = current.indexOf(end);
  if ((start === -1) !== (finish === -1) || (start !== -1 && finish < start)) fail('Incomplete Torch route markers; instructions were left unchanged.');
  const block = project ? `${begin}\n## Torch: ${project.name}\n\nThis folder is linked to the Torch project ${project.name}; its records live in ${project.root}. Run \`torch context\` here (or \`torch context <ID>\` for one task) and follow \`torch help rules\`. Do not create Torch records in this folder. If this machine cannot find the project, run \`torch link ${project.id}\` here.\n${end}` : '';
  const next = start === -1 ? (project ? `${current}${current.endsWith('\n') || !current ? '' : '\n'}\n${block}\n` : current) : current.slice(0, start) + block + current.slice(finish + end.length);
  return { file, current, next };
}
export function linkFolder(target, directory = process.cwd(), name) {
  const p = registry().some(p => p.id === target) ? registeredProject(target) : projectAt(target);
  const folder = fs.realpathSync(path.resolve(directory));
  if (!fs.statSync(folder).isDirectory()) fail('Link a directory.');
  if (folder === p.root || contains(p.root, folder)) fail('This folder already belongs to the task home; no link is needed.');
  if (fs.existsSync(path.join(folder, '.torch/project.json'))) fail('This folder already has Torch records. Use --project to choose one task home; linking never merges or deletes records.');
  const linkName = id(name || path.basename(folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
  if (linkName === 'project') fail('The name project is reserved for the task home.');
  return locked(home(), () => {
    const entries = registry(), entry = entries.find(e => e.id === p.id && e.root === p.root);
    if (!entry) fail('Register the task home with torch init first.');
    for (const other of entries) for (const root of [other.root, ...(other.links || []).map(l => l.path)]) {
      if (contains(folder, root) || contains(root, folder)) {
        if (other.id !== p.id || root !== folder) fail(`Folder overlaps ${other.name} at ${root}. Choose a folder with one clear owner.`);
      }
    }
    const collision = (entry.links || []).find(l => l.name === linkName && l.path !== folder);
    if (collision) fail(`Link name ${linkName} is already used at ${collision.path}. Unlink that name before moving it.`);
    const edit = routeInstructions(folder, p);
    if (edit.next !== edit.current) atomic(edit.file, edit.next);
    entry.links = [...(entry.links || []).filter(l => l.path !== folder), { name: linkName, path: folder }];
    try { saveRegistry(entries); } catch (e) { atomic(edit.file, edit.current); throw e; }
    return { project: p, folder: { name: linkName, path: folder } };
  });
}
export function unlinkFolder(directory = process.cwd(), projectId, name) {
  // A missing or moved folder can still be unlinked by its saved path or name.
  const folder = canonicalPath(directory);
  return locked(home(), () => {
    const entries = registry();
    const matches = entries.flatMap(p => (p.links || []).filter(l => (!projectId || p.id === projectId) && (name ? l.name === name : l.path === folder)).map(link => ({ p, link })));
    if (matches.length !== 1) fail(matches.length ? 'Specify --project to disambiguate this link name.' : 'No matching linked folder. The task home cannot be unlinked.');
    const { p, link } = matches[0];
    const edit = folderAvailable(link.path) ? routeInstructions(link.path, null) : null;
    if (edit && edit.next !== edit.current) atomic(edit.file, edit.next);
    p.links = p.links.filter(l => l !== link);
    try { saveRegistry(entries); } catch (e) { if (edit) atomic(edit.file, edit.current); throw e; }
    return { project: p.name, folder: link.path };
  });
}
export function registeredProject(projectId, entries = registry()) {
  const p = entries.find(p => p.id === projectId || p.aliases?.some(alias => alias.id === projectId)); if (!p) fail('Project not registered.', 404);
  if (!folderAvailable(p.root)) fail(`Task home unavailable: ${p.root}. If it moved, run torch init in its new location.`, 404);
  const loaded = loadProject(p.root);
  if (loaded.id !== p.id) fail('Registered project ID no longer matches the task home. Run torch init there to reconcile it.');
  return loaded;
}
// Resolve a readable task ID such as JC-010 to its project from any folder.
export function projectForTask(reference, entries = registry()) {
  const code = /^([A-Z]{2})-\d{3,}$/i.exec(reference)?.[1]?.toUpperCase();
  const entry = code && entries.find(p => !p.archivedAt && [p.code, ...(p.legacyCodes || [])].includes(code));
  return entry ? registeredProject(entry.id, entries) : null;
}

export function reorderProjects(projectIds) {
  if (!Array.isArray(projectIds) || new Set(projectIds).size !== projectIds.length) fail('Supply each active project once.');
  return locked(home(), () => {
    const entries = registry(), active = entries.filter(p => !p.archivedAt);
    if (active.length !== projectIds.length || projectIds.some(id => !active.some(p => p.id === id))) fail('Projects changed while you were reordering. Refresh and try again.', 409);
    const order = projectIds.map(id => active.find(p => p.id === id));
    let index = 0;
    saveRegistry(entries.map(p => p.archivedAt ? p : order[index++]));
    return { projectIds };
  });
}

export function documentLocation(p, reference) {
  const folders = projectFolders(p);
  const match = reference.match(/^@([^/]+)\/(.*)$/s);
  const folder = match ? folders.find(f => f.name === match[1]) : folders[0];
  if (!folder) fail('Linked folder not found. Check torch context for available folder names.', 404);
  if (!folder.available) fail(`Folder unavailable: ${folder.path}. Relink it if it moved.`, 404);
  let candidate = path.resolve(folder.path, match ? match[2] : reference);
  if (path.isAbsolute(reference)) candidate = path.join(canonicalPath(path.dirname(candidate)), path.basename(candidate));
  if (match && !contains(folder.path, candidate)) fail('Document must be inside its linked folder.', 403);
  // Check both the lexical path and real path to reject traversal and symlink escapes.
  const allowed = folders.filter(f => f.available && contains(f.path, candidate));
  if (!allowed.length) fail('Document must be inside the project or an explicitly linked folder.', 403);
  const full = fs.realpathSync(candidate);
  const owner = allowed.find(f => contains(f.path, full));
  if (!owner) fail('Document must be inside the project or an explicitly linked folder.', 403);
  return { full, path: (owner.name === 'project' ? '' : `@${owner.name}/`) + path.relative(owner.path, full).split(path.sep).join('/') };
}
