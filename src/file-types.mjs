import { fileURLToPath } from 'node:url';
import path from 'node:path';

const readers = new Set(['md', 'markdown', 'txt']);
const spreadsheets = new Set(['csv', 'tsv', 'xls', 'xlsx', 'xlsm', 'ods', 'numbers']);
const browser = new Set(['html', 'htm']);
const code = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro', 'py', 'pyi', 'rb', 'php', 'go', 'rs', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'java', 'kt', 'kts', 'sh', 'bash', 'zsh', 'fish', 'sql', 'r', 'lua', 'ex', 'exs', 'erl', 'hs', 'dart', 'prisma', 'graphql', 'gql', 'conf', 'ini', 'env', 'lock']);
const documents = new Set(['pdf', 'doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'key', 'pages', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
const codeNames = new Set(['dockerfile', 'makefile', 'gemfile', 'procfile', '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc', '.env']);

export function fileKind(file) {
  const name = path.posix.basename(file).toLowerCase();
  const extension = name.slice(name.lastIndexOf('.') + 1);
  if (readers.has(extension)) return 'reader';
  if (spreadsheets.has(extension)) return 'spreadsheets';
  if (browser.has(extension)) return 'browser';
  if (code.has(extension) || codeNames.has(name) || name.startsWith('.env.')) return 'code';
  if (documents.has(extension)) return 'other';
  return null;
}

// Keep headings separate from paths; extension checks do not treat URLs as files.
export function splitFileReference(value) {
  if (fileKind(value)) return { file: value, fragment: '' };
  for (let at = value.lastIndexOf('#'); at >= 0; at = value.lastIndexOf('#', at - 1)) {
    if (fileKind(value.slice(0, at))) return { file: value.slice(0, at), fragment: value.slice(at + 1) };
    if (at === 0) break;
  }
  return null;
}

const decode = value => decodeURIComponent(value.replace(/%(?![\da-f]{2})/gi, '%25'));
// Turn a Markdown link into a project document reference, or null for web links.
export function documentReference(href, base = '', decoded = false) {
  if (/^obsidian:\/\/open\?/i.test(href)) {
    const url = new URL(href);
    const full = url.searchParams.get('path');
    // Accept only an open action with a concrete file. Never pass write parameters.
    return full && path.isAbsolute(full) ? documentReference(full, base, true) : null;
  }
  if (href.startsWith('#') || href.startsWith('//') || (/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('file://'))) return null;
  const match = splitFileReference(href);
  if (!match) return null;
  try {
    const file = match.file.startsWith('file://') ? fileURLToPath(match.file) : decoded ? match.file : decode(match.file);
    const reference = path.isAbsolute(file) || file.startsWith('@') ? file : path.posix.join(base, file);
    return { reference, fragment: match.fragment ? (decoded ? match.fragment : decode(match.fragment)) : '' };
  } catch { return null; }
}
