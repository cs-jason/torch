import { compareTaskPriority } from './task-order.js';

// Match the visible content, so polling another project does not replace this view.
export function viewKey(data, route, hash) {
  const { projects, tasks, errors, dashboard } = data;
  const project = projects.find(p => p.id === route.project);
  const active = projects.filter(p => !p.archivedAt);
  const activeIds = new Set(active.map(p => p.id));
  const projectErrors = route.project ? errors.filter(e => e.project === project?.name) : errors;
  let content;
  if (hash === '#help') content = 'help';
  else if (['#settings', '#shortcuts', '#projects'].includes(hash)) content = [dashboard];
  else if (route.doc) content = [project, tasks.filter(t => t.projectId === route.project), projectErrors];
  else if (route.task) {
    const task = tasks.find(t => t.projectId === route.project && t.id === route.task);
    const references = tasks.filter(t => t.projectId === route.project && (t.id === task?.mergedInto || task?.mergedFrom?.includes(t.id))).map(t => [t.id, t.displayId, t.title]);
    content = [task?.contentVersion, task?.title, project?.name, references, projectErrors];
  } else if (hash === '#archive') content = [projects, tasks.filter(t => t.archived || t.status === 'done' || !activeIds.has(t.projectId)), errors];
  else if (route.project || hash === '#all') content = [project, tasks.filter(t => !t.archived && (project ? t.projectId === project.id : activeIds.has(t.projectId))), projectErrors];
  else {
    const available = tasks.filter(t => !t.archived && activeIds.has(t.projectId));
    const upNext = active.flatMap(p => available.filter(t => t.projectId === p.id && t.status === 'next').sort(compareTaskPriority)).slice(0, dashboard.homeReviewLimit);
    const recent = [...available].sort((a, b) => b.updated.localeCompare(a.updated) || b.created.localeCompare(a.created)).slice(0, dashboard.homeRecentLimit);
    content = [upNext, recent, errors];
  }
  return JSON.stringify([hash, dashboard.showHome, dashboard.showAllProjects, content]);
}
