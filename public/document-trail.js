const documentRoute = hash => {
  const route = Object.fromEntries(new URLSearchParams(hash.slice(1)));
  return route.project && route.doc ? route : null;
};
const sameDocument = (a, b) => {
  const left = documentRoute(a), right = documentRoute(b);
  return left && right && left.project === right.project && left.doc === right.doc && left.fromTask === right.fromTask;
};
const validScroll = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

// Each browser entry owns its ancestry, so refresh and browser Back/Forward keep
// the same document parent without retracing unrelated workspace pages.
export function createDocumentTrail() {
  function read() {
    const saved = history.state?.torchDocument;
    if (!documentRoute(location.hash) || saved?.hash !== location.hash) return { hash: location.hash, parents: [] };
    return {
      hash: saved.hash,
      parents: (Array.isArray(saved.parents) ? saved.parents : []).filter(parent =>
        typeof parent?.hash === 'string' && parent.hash.startsWith('#') && documentRoute(parent.hash) && validScroll(parent.scroll)
      ).slice(-80),
      scroll: validScroll(saved.scroll) ? saved.scroll : null
    };
  }
  let current = read(), pending = null;
  function save() {
    history.replaceState({ ...history.state, torchDocument: documentRoute(current.hash) ? current : null }, '', location.href);
  }
  return {
    parent: () => current.parents.at(-1),
    prepare(hash, { documentReturn = false, resetDocuments = false } = {}) {
      if (current.hash === location.hash && documentRoute(current.hash)) {
        current.scroll = [scrollX, scrollY];
        save();
      }
      pending = { hash, parents: [], direction: 0 };
      if (!documentRoute(hash)) return 0;
      if (documentReturn && current.parents.at(-1)?.hash === hash) {
        pending = { ...current.parents.at(-1), parents: current.parents.slice(0, -1), direction: -1 };
      } else if (!resetDocuments && documentRoute(current.hash)) {
        pending.parents = sameDocument(current.hash, hash) ? current.parents :
          [...current.parents, { hash: current.hash, scroll: current.scroll }].slice(-80);
        pending.direction = sameDocument(current.hash, hash) ? 0 : 1;
      }
      return pending.direction;
    },
    sync() {
      const previous = current;
      const prepared = pending?.hash === location.hash ? pending : null;
      current = prepared || read(); pending = null;
      const direction = prepared ? prepared.direction :
        previous.parents.at(-1)?.hash === current.hash ? -1 : current.parents.at(-1)?.hash === previous.hash ? 1 : 0;
      save();
      return { direction, scroll: current.scroll || null };
    }
  };
}
