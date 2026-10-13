import fs from 'node:fs';
import { read, decode, hash } from './storage.mjs';

// File metadata is checked every scan. Atomic replacement, same-size edits and
// deletions invalidate entries; no watcher assumes a synced folder delivered an event.
export function createReadCache({ maxBytes = 8 * 1024 * 1024, maxEntries = 1024 } = {}) {
  const entries = new Map();
  let bytes = 0;
  function load(file) {
    let stat;
    try { stat = fs.statSync(file, { bigint: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const previous = entries.get(file);
      if (previous) { bytes -= previous.bytes; entries.delete(file); }
      return { missing: true, digest: hash('') };
    }
    const version = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    const previous = entries.get(file);
    if (previous?.version === version) {
      entries.delete(file); entries.set(file, previous);
      return previous;
    }
    if (previous) { bytes -= previous.bytes; entries.delete(file); }
    const raw = read(file), entry = { version, raw, bytes: Buffer.byteLength(raw) * 3 };
    if (entry.bytes <= maxBytes) {
      entries.set(file, entry); bytes += entry.bytes;
      while (bytes > maxBytes || entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        bytes -= entries.get(oldest).bytes; entries.delete(oldest);
      }
    }
    return entry;
  }
  return {
    scan() {
      // Shared imports are statted and hashed only once within this scan.
      const files = new Map();
      const file = name => { if (!files.has(name)) files.set(name, load(name)); return files.get(name); };
      return {
        record(name) {
          const entry = file(name);
          if (entry.missing) throw Object.assign(new Error(`File not found: ${name}`), { code: 'ENOENT' });
          entry.record ||= decode(entry.raw);
          return entry.record;
        },
        sourceHash(name) {
          const entry = file(name);
          return entry.digest ||= hash(entry.raw);
        },
      };
    },
  };
}
