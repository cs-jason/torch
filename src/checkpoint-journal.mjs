import fs from 'node:fs';
import path from 'node:path';
import { atomic, read, fail, id, decode, text } from './storage.mjs';

export const checkpointJournal = p => path.join(p.root, '.torch/.pending-checkpoint.json');
const recordPath = (p, relative) => path.join(p.root, '.torch', relative);

export function recoverCheckpointFiles(p, validateTask) {
  const journal = JSON.parse(read(checkpointJournal(p), 'null'));
  if (!journal) return { recovered: false };
  if (journal.version !== 1 || journal.projectId !== p.id || !Array.isArray(journal.files) || journal.files.length !== 2) fail('Invalid checkpoint recovery journal.');
  const taskId = id(journal.taskId), [task, note] = journal.files;
  if (task.path !== `tasks/${taskId}.md` || typeof task.before !== 'string' || typeof task.after !== 'string') fail('Invalid checkpoint task snapshot.');
  for (const raw of [task.before, task.after]) {
    const value = decode(raw); validateTask(value);
    if (value.id !== taskId) fail('Checkpoint task ID mismatch.');
  }
  if (typeof note.path !== 'string' || !note.path.startsWith(`notes/${taskId}/`) || !/^[\w.-]+\.md$/.test(note.path.slice(`notes/${taskId}/`.length)) || note.before !== null || typeof note.after !== 'string') fail('Invalid checkpoint note snapshot.');
  const value = decode(note.after);
  id(value.id); text(value.body, 'Checkpoint', 20000); text(value.author, 'Author', 120);
  if (value.taskId !== taskId || !Number.isFinite(Date.parse(value.created))) fail('Invalid checkpoint note metadata.');
  for (const file of journal.files) {
    const current = read(recordPath(p, file.path), null);
    if (current !== file.before && current !== file.after) fail(`Checkpoint recovery stopped: ${file.path} has an unrelated edit. Preserve it before recovering.`, 409);
  }
  for (const file of journal.files) {
    if (file.before === null) fs.rmSync(recordPath(p, file.path), { force: true });
    else atomic(recordPath(p, file.path), file.before);
  }
  fs.rmSync(checkpointJournal(p));
  return { recovered: true, taskId, result: 'Restored the state before the interrupted checkpoint.' };
}

// Caller holds the project lock. Readers stop until both records are committed.
export function commitCheckpointFiles(p, taskId, files, validateTask) {
  if (fs.existsSync(checkpointJournal(p))) fail('Run torch task recover before saving another checkpoint.', 409);
  for (const file of files) {
    if (read(recordPath(p, file.path), null) !== file.before) fail('A checkpoint record changed before saving. Read the task again.', 409);
  }
  atomic(checkpointJournal(p), JSON.stringify({ version: 1, projectId: p.id, taskId, files }) + '\n');
  try {
    for (const file of files) atomic(recordPath(p, file.path), file.after);
    fs.rmSync(checkpointJournal(p));
  } catch (error) {
    try { recoverCheckpointFiles(p, validateTask); }
    catch (recovery) { fail(`${error.message} ${recovery.message}`, 409); }
    throw error;
  }
}
