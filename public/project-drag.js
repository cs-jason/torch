// Pointer-driven sorting keeps the original slot and avoids native drag badges.
export function installProjectReorder(root, { projects, busy, commit, changed }) {
  let drag = null, frame = 0, suppressClick = false, cancelledPointer = null;
  const links = list => [...list.querySelectorAll('a[data-project-id]')];
  function position() {
    if (!drag?.started) return;
    const { preview, marker, list, link, x, y, dx, dy } = drag;
    preview.style.transform = `translate(${x - dx}px, ${y - dy}px)`;
    const rect = list.getBoundingClientRect(), nav = list.closest('nav'), viewport = nav.getBoundingClientRect();
    if (x >= viewport.left && x <= viewport.right && nav.scrollHeight > nav.clientHeight) {
      if (y < viewport.top + 28) nav.scrollTop -= 7;
      else if (y > viewport.bottom - 28) nav.scrollTop += 7;
    }
    const items = links(list).filter(item => item !== link);
    const within = x >= rect.left - 24 && x <= rect.right + 24 && y >= Math.max(viewport.top, rect.top - 16) && y <= Math.min(viewport.bottom, rect.bottom + 16);
    drag.order = null; marker.hidden = true;
    if (!within || !items.length) return;
    const before = items.find(item => { const r = item.getBoundingClientRect(); return y < r.top + r.height / 2; });
    const order = items.map(item => item.dataset.projectId);
    order.splice(before ? order.indexOf(before.dataset.projectId) : order.length, 0, link.dataset.projectId);
    drag.order = order;
    if (order.every((id, i) => id === projects()[i]?.id)) return;
    const gap = parseFloat(getComputedStyle(list).rowGap) || 20;
    const edge = before ? before.getBoundingClientRect().top - gap / 2 : items.at(-1).getBoundingClientRect().bottom + gap / 2;
    marker.hidden = false;
    marker.style.left = `${rect.left}px`; marker.style.top = `${Math.round(edge)}px`; marker.style.width = `${rect.width}px`;
  }
  function tick() { position(); if (drag?.started) frame = requestAnimationFrame(tick); }
  function cleanup() {
    if (!drag) return;
    const previous = drag; drag = null;
    cancelAnimationFrame(frame);
    previous.link.classList.remove('project-drag-source');
    previous.preview?.remove(); previous.marker?.remove();
    if (previous.link.hasPointerCapture(previous.pointerId)) previous.link.releasePointerCapture(previous.pointerId);
    document.body.classList.remove('project-dragging');
    changed(false);
    return previous;
  }
  function cancel() { if (drag?.started) cancelledPointer = drag.pointerId; cleanup(); }
  root.addEventListener('pointerdown', event => {
    const link = event.target.closest('[data-project-list] a[data-project-id]');
    if (!link || event.button !== 0 || !event.isPrimary || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || busy()) return;
    cancelledPointer = null;
    const rect = link.getBoundingClientRect();
    drag = { link, list: link.closest('[data-project-list]'), pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, dx: event.clientX - rect.left, dy: event.clientY - rect.top, rect };
    changed(true);
  });
  window.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    event.preventDefault();
    if (!drag.started) {
      drag.started = true; drag.link.setPointerCapture(event.pointerId);
      drag.preview = document.createElement('div'); drag.preview.className = 'project-drag-preview';
      const label = drag.link.querySelector('.nav-label') || drag.link;
      drag.preview.textContent = label.textContent; drag.preview.setAttribute('aria-hidden', 'true');
      drag.preview.style.width = `${label.getBoundingClientRect().width}px`;
      const style = getComputedStyle(drag.link); drag.preview.style.font = style.font; drag.preview.style.lineHeight = style.lineHeight;
      drag.marker = document.createElement('div'); drag.marker.className = 'project-drop-line'; drag.marker.hidden = true;
      drag.marker.setAttribute('aria-hidden', 'true');
      document.body.append(drag.preview, drag.marker);
      drag.link.classList.add('project-drag-source'); document.body.classList.add('project-dragging');
      tick();
    }
    position();
  }, { passive: false });
  window.addEventListener('pointerup', event => {
    if (event.pointerId === cancelledPointer) { cancelledPointer = null; suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); return; }
    if (!drag || event.pointerId !== drag.pointerId) return;
    position();
    const previous = cleanup();
    if (!previous.started) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    if (previous.order && !previous.order.every((id, i) => id === projects()[i]?.id)) commit(previous.order);
  });
  root.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  root.addEventListener('dragstart', event => { if (event.target.closest('[data-project-list]')) event.preventDefault(); });
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  window.addEventListener('hashchange', cancel);
  window.addEventListener('resize', cancel);
  window.addEventListener('keydown', event => {
    if (drag?.started && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); return; }
    const link = event.target.closest?.('[data-project-list] a[data-project-id]');
    if (!link || busy() || !event.altKey || event.metaKey || event.ctrlKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const order = projects().map(p => p.id), from = order.indexOf(link.dataset.projectId), to = from + (event.key === 'ArrowDown' ? 1 : -1);
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]]; commit(order);
  }, true);
}
