import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { home, now, fail } from './storage.mjs';

export const skillNames = ['torch-start', 'torch-list', 'torch-plan', 'torch-work', 'torch-tidy'];
const retired = ['torch-reconcile', 'torch-consolidate'];
export const skillHomes = () => [
  path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills'),
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills'),
];

// Links each skill to this checkout, so skills update with Torch. Anything already
// there under a Torch skill name is moved aside, never deleted.
export function installSkills() {
  const source = name => fileURLToPath(new URL(`../skills/${name}`, import.meta.url));
  for (const name of skillNames) if (!fs.existsSync(path.join(source(name), 'SKILL.md'))) fail(`Bundled skill missing: ${name}.`);
  const backup = path.join(home(), 'replaced-skills', now().replaceAll(':', '-'));
  const installed = [], moved = [];
  for (const dir of skillHomes()) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of [...skillNames, ...retired]) {
      const target = path.join(dir, name);
      let stat = null; try { stat = fs.lstatSync(target); } catch {}
      if (stat?.isSymbolicLink()) fs.unlinkSync(target);
      else if (stat) { fs.mkdirSync(backup, { recursive: true }); const to = path.join(backup, `${path.basename(path.dirname(dir))}-${name}`); fs.renameSync(target, to); moved.push(to); }
      if (skillNames.includes(name)) { fs.symlinkSync(source(name), target); installed.push(target); }
    }
  }
  return { installed, moved };
}
