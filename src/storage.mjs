import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';

export const home = () => path.resolve(process.env.TORCH_HOME || path.join(os.homedir(), '.config/torch'));
export const hash = text => createHash('sha256').update(text).digest('hex');
export const now = () => new Date().toISOString();
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function read(file, fallback) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; } }
export function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, text, { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
// Every CLI and server writer shares this short-lived lock. A crashed process's lock is recoverable.
export function locked(dir, fn) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '.write-lock');
  for (let attempt = 0; attempt < 100; attempt++) {
    let fd;
    try {
      fd = fs.openSync(file, 'wx', 0o600);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(read(file, ''));
      if (pid > 0) {
        try { process.kill(pid, 0); }
        catch (error) { if (error.code === 'ESRCH') { fs.rmSync(file, { force: true }); continue; } }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      continue;
    }
    try {
      try { fs.writeFileSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
      // A writer's own EEXIST error must not cause the write to run again.
      return fn();
    } finally { fs.rmSync(file, { force: true }); }
  }
  fail('Another Torch writer is busy. Try again.', 409);
}
export function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(value)) fail('Invalid record ID.'); return value; }
export function text(value, name, max = 500) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${name} must be between 1 and ${max} characters.`); return value.trim(); }
export function decode(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) fail('Expected YAML frontmatter followed by Markdown.');
  const meta = parse(match[1], { maxAliasCount: 0 });
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) fail('Invalid record metadata.');
  return { ...meta, body: match[2].trim(), revision: hash(raw) };
}
export function encode(record) { const { body = '', revision, notes, projectId, projectName, sourceChanged, ...meta } = record; return `---\n${stringify(meta, { lineWidth: 0 })}---\n\n${body.trim()}\n`; }
