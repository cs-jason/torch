import { marked } from 'marked';
import sanitize from 'sanitize-html';
import { localLinks } from './local-links.mjs';
import { fileKind, documentReference } from './file-types.mjs';
import { hash } from './storage.mjs';

marked.use({ extensions: [localLinks] });
function renderMarkdown(body, projectId, base = '', fromTask = '') {
  return sanitize(marked.parse(body.replace(/^([ \t]*[-*] )\[x\] (.+)$/gim, '$1~~$2~~').replace(/^([ \t]*[-*] )\[ \] /gm, '$1'), { async: false, gfm: true }), {
    allowedTags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'del', 'blockquote', 'pre', 'code', 'a', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary'],
    allowedAttributes: { a: ['href', 'target', 'rel'], code: ['class'], ol: ['start'] },
    allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false,
    transformTags: {
      a: (tag, attrs) => {
        const href = attrs.href || '';
        if (/^https?:\/\//.test(href)) return { tagName: 'a', attribs: { href, target: '_blank', rel: 'noopener noreferrer' } };
        const doc = documentReference(href, base);
        if (doc) {
          const link = '#' + new URLSearchParams({ project: projectId, doc: doc.reference, ...(fromTask ? { fromTask } : {}), ...(doc.fragment ? { heading: doc.fragment } : {}) });
          // Markdown and text open in the dashboard reader; other files stay plain text.
          return { tagName: 'a', attribs: fileKind(doc.reference) === 'reader' ? { href: link } : {} };
        }
        return { tagName: 'a', attribs: { href } };
      },
    },
  });
}

const cache = new Map();
let cacheBytes = 0;
export function markdown(body, projectId, base = '', fromTask = '') {
  const key = hash(JSON.stringify([body, projectId, base, fromTask]));
  if (cache.has(key)) {
    const entry = cache.get(key); cache.delete(key); cache.set(key, entry);
    return entry.html;
  }
  const html = renderMarkdown(body, projectId, base, fromTask), bytes = Buffer.byteLength(html);
  if (bytes <= 4 * 1024 * 1024) {
    cache.set(key, { html, bytes }); cacheBytes += bytes;
    while (cache.size > 256 || cacheBytes > 4 * 1024 * 1024) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).bytes; cache.delete(oldest);
    }
  }
  return html;
}
