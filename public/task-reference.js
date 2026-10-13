// The clipboard and Codex composer receive the same pointer to current records.
export function taskReference(task, project) {
  const label = task.displayId || task.id;
  return `Read Torch task ${label} in ${project.root}. Run \`torch context ${label}\` from that folder for its context, sources, and checkpoints.`;
}
