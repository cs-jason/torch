export const attentionLimit = 3;
export const priorities = ['high', 'normal', 'low'];

// Routine edits and checkpoints do not change a task's place in the queue.
export function compareTaskPriority(a, b) {
  return priorities.indexOf(a.priority || 'normal') - priorities.indexOf(b.priority || 'normal')
    || a.created.localeCompare(b.created)
    || (a.projectId || '').localeCompare(b.projectId || '')
    || a.id.localeCompare(b.id);
}
