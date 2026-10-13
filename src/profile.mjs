import path from 'node:path';
import os from 'node:os';
import { home, read, text, fail } from './storage.mjs';

export function ownerName(value) {
  const owner = text(value, 'Owner', 120);
  if (/^(?:unassigned|unknown|tbd|none|n\/a)$/i.test(owner) || /[,;&/+]|\b(?:and|with)\b/i.test(owner)) fail('Owner must be one named person, agent, or external party. Put collaborators and dependencies in the task document.');
  return owner;
}
export function mainOwner() {
  const saved = JSON.parse(read(path.join(home(), 'settings.json'), '{}'));
  return ownerName(saved.mainOwner || os.userInfo().username);
}
export function isMainOwner(owner) { return owner.trim().toLocaleLowerCase() === mainOwner().toLocaleLowerCase(); }
