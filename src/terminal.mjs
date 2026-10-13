import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Styling only reaches a person's terminal; pipes and agents get plain text.
export function terminal({ styled = Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb' && !Object.hasOwn(process.env, 'NO_COLOR') } = {}) {
  const paint = (open, close) => text => styled ? `\x1b[${open}m${text}\x1b[${close}m` : String(text);
  const bold = paint(1, 22), muted = paint('38;5;243', 39), amber = paint('38;5;214', 39), red = paint('38;5;210', 39), blue = paint('38;5;117', 39), green = paint('38;5;150', 39);
  const heading = title => `${bold('Torch')} ${muted(version)}${title ? ' ' + muted('· ' + title) : ''}`;
  const mark = styled ? amber('▲') + ' ' : '';
  return { styled, bold, muted, amber, red, blue, green, heading, mark, width: process.stdout.columns || 100 };
}

// Obsidian's iCloud folder is shortened to Obsidian/<vault>/….
const obsidian = path.join(os.homedir(), 'Library/Mobile Documents/iCloud~md~obsidian/Documents');
export function displayPath(value, max = Infinity) {
  const root = os.homedir();
  let shown = value.startsWith(obsidian + path.sep) ? 'Obsidian' + value.slice(obsidian.length)
    : value === root ? '~' : value.startsWith(root + path.sep) ? '~' + value.slice(root.length) : value;
  // Long paths keep their first two segments and the folder name: ~/Workspace/…/name.
  const parts = shown.split('/');
  if (shown.length > max && parts.length > 3) shown = [...parts.slice(0, 2), '…', parts.at(-1)].join('/');
  return shown;
}

export function age(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : minutes < 20160 ? `${Math.round(minutes / 1440)}d` : `${Math.round(minutes / 10080)}w`;
}
