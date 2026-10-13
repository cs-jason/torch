import { id, fail } from './storage.mjs';
import { ownerName } from './profile.mjs';
import { sessionKinds } from './task-store.mjs';

// The agent writing right now: Codex and Claude Code identify themselves through their environment.
function detected() {
  if (process.env.CODEX_THREAD_ID) return { name: 'Codex', kind: 'codex', id: process.env.CODEX_THREAD_ID };
  if (process.env.CLAUDE_CODE_SESSION_ID) return { name: 'Claude', kind: 'claude', id: process.env.CLAUDE_CODE_SESSION_ID };
  return { name: 'Agent' };
}

export function agentName(options = {}) {
  return ownerName(options.agent || process.env.TORCH_AGENT || detected().name);
}

export function currentSession(options = {}) {
  const supplied = options.session || process.env.TORCH_SESSION_ID, found = detected();
  const kind = options['session-kind'] || process.env.TORCH_SESSION_KIND || (supplied ? 'generic' : found.kind);
  const sessionId = supplied || (kind === found.kind ? found.id : undefined);
  if (!sessionId) return null;
  if (!sessionKinds.includes(kind)) fail(`Session kind must be ${sessionKinds.join(', ')}.`);
  // An explicit title renames the link; the fallback only names a new one.
  return { id: id(sessionId), kind, title: options['session-title'] || process.env.TORCH_SESSION_TITLE, fallbackTitle: `${agentName(options)} session ${sessionId.slice(0, 8)}` };
}
