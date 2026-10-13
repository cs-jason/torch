import { splitFileReference } from './file-types.mjs';

const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Handle the common agent-written [label](/path with spaces/note.md) form.
// An inline tokenizer leaves fenced code and inline code untouched.
export const localLinks = {
  name: 'localFileLink',
  level: 'inline',
  start(source) { return source.indexOf('['); },
  tokenizer(source) {
    const label = source.match(/^\[([^\]\n]+)\]\(/);
    if (!label) return;
    let depth = 1, end = label[0].length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === '\n') return;
      if (char === '\\') { end++; continue; }
      if (char === '(') depth++;
      if (char === ')' && --depth === 0) break;
    }
    if (depth !== 0) return;
    const href = source.slice(label[0].length, end);
    if (!/\s/.test(href) || /[<>]/.test(href) || /^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('file://')) return;
    if (!splitFileReference(href)) return;
    return { type: 'localFileLink', raw: source.slice(0, end + 1), href: href.replace(/\\([()])/g, '$1'), tokens: this.lexer.inlineTokens(label[1]) };
  },
  renderer(token) { return `<a href="${escape(token.href)}">${this.parser.parseInline(token.tokens)}</a>`; },
};
