import { registry, registeredProject, projectFolders } from './project-store.mjs';
import { listTasks, notes, statuses, labels, taskStorageReady } from './task-store.mjs';

export function snapshot({ scope } = {}) {
  const projects = [], tasks = [], errors = [];
  const entries = registry();
  for (const entry of entries) {
    try {
      const p = registeredProject(entry.id, entries), folders = projectFolders(p, entries);
      projects.push({ ...p, folders });
      for (const folder of folders.filter(f => !f.available)) errors.push({ project: p.name, message: `Linked folder unavailable: ${folder.path}. Unlink and relink it if it moved.` });
      const onError = (file, error) => errors.push({ project: p.name, file, message: `${file}: ${error.message}` });
      const records = listTasks(p, { scope, onError }), byId = new Map(records.map(t => [t.id, t]));
      const projectTasks = records.map(t => {
        let checkpoints = [];
        try { checkpoints = notes(p, t.id, new Set(), false, { scope, tasks: byId, onError }); }
        catch (error) { onError(`.torch/notes/${t.id}`, error); }
        return { ...t, projectId: p.id, projectName: p.name, notes: checkpoints };
      });
      taskStorageReady(p);
      tasks.push(...projectTasks);
    } catch (e) { errors.push({ project: entry.name, message: e.message }); }
  }
  return { projects, tasks, errors, statuses, labels };
}
