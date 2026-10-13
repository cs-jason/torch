export const disclosureOpen = details => details.open && !details.hasAttribute('data-collapsing');

export function createMotion({ root, reducedMotion, updateTaskMarker, getTaskMarker, isDragging, sounds }) {
  let fadingLayer, markerLayer;
  let boundaryAnimation, markerMotionFrame;
  const viewAnimations = new Set();
  const disclosures = new Map();
  function clearDissolve() {
    cancelAnimationFrame(markerMotionFrame);
    for (const state of disclosures.values()) state.finish();
    boundaryAnimation = null;
    viewAnimations.forEach(animation => animation.cancel());
    viewAnimations.clear();
    fadingLayer?.remove(); fadingLayer = null;
    markerLayer?.remove(); markerLayer = null;
  }
  function motion(element, frames, timing) {
    const animation = element.animate(frames, timing);
    viewAnimations.add(animation);
    const finish = () => { viewAnimations.delete(animation); animation.cancel(); };
    animation.finished.then(finish, finish);
    return animation;
  }
  function followTaskMarker() {
    cancelAnimationFrame(markerMotionFrame);
    const follow = () => {
      updateTaskMarker({ animate: false });
      if (viewAnimations.size) markerMotionFrame = requestAnimationFrame(follow);
    };
    follow();
  }
  function setDisclosureOpen(details, open, changed = () => {}) {
    if (open === disclosureOpen(details)) return;
    const start = details.getBoundingClientRect().height;
    const previous = disclosures.get(details);
    disclosures.delete(details);
    previous?.animation?.cancel();
    // Measure the destination, but retain content while its container shrinks.
    details.classList.add('disclosure-moving');
    details.open = open;
    const end = details.getBoundingClientRect().height;
    details.open = true;
    details.toggleAttribute('data-collapsing', !open);
    const state = { animation: null, finish: () => {
      if (disclosures.get(details) !== state) return;
      disclosures.delete(details);
      details.open = open;
      details.removeAttribute('data-collapsing');
      details.classList.remove('disclosure-moving');
      state.animation?.cancel();
      updateTaskMarker({ animate: false, refreshHover: true });
    } };
    disclosures.set(details, state);
    changed(open);
    if (reducedMotion.matches || isDragging() || Math.abs(start - end) < .5) { state.finish(); return; }
    state.animation = motion(details, [{ height: `${start}px` }, { height: `${end}px` }], {
      duration: 150, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both'
    });
    state.animation.finished.then(state.finish, state.finish);
    followTaskMarker();
  }
  function hitWall(direction, axis = 'y') {
    if (isDragging() || boundaryAnimation?.playState === 'running') return;
    const main = root.querySelector('main');
    if (!main) return;
    void sounds.play('boundary');
    if (reducedMotion.matches) return;
    clearDissolve();
    const distance = 2;
    const translate = value => axis === 'x' ? `translateX(${value}px)` : `translateY(${value}px)`;
    boundaryAnimation = motion(main, [
      { transform: translate(0), offset: 0, easing: 'cubic-bezier(.2,.8,.2,1)' },
      { transform: translate(direction * distance), offset: .3, easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: translate(direction * distance * -.125), offset: .78, easing: 'ease-out' },
      { transform: translate(0), offset: 1 }
    ], { duration: 240 });
    followTaskMarker();
  }
  async function moveHomeSections(update) {
    const positions = new Map([...root.querySelectorAll('[data-home-section]')].map(section => [section.dataset.homeSection, section.getBoundingClientRect().top + scrollY]));
    clearDissolve();
    await update();
    if (reducedMotion.matches) return;
    for (const section of root.querySelectorAll('[data-home-section]')) {
      const previous = positions.get(section.dataset.homeSection);
      if (previous === undefined) continue;
      const offset = previous - section.getBoundingClientRect().top - scrollY;
      if (Math.abs(offset) < .5) continue;
      motion(section, [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: 150, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    followTaskMarker();
  }
  async function dissolve(update, direction = 0, axis = 'y', markerTransition) {
    clearDissolve();
    if (reducedMotion.matches || isDragging()) return update();
    // The old view fades out while directional navigation brings the new content in.
    const previousMain = root.querySelector('main');
    if (!previousMain) return update();
    // Keep the departing task square visible while its old page is replaced.
    const departingMarker = markerTransition === 'out' ? getTaskMarker() : null;
    let markerSnapshot;
    if (departingMarker) {
      const rect = departingMarker.getBoundingClientRect();
      markerSnapshot = departingMarker.cloneNode(false);
      Object.assign(markerSnapshot.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, transform: 'none', transition: 'none' });
      document.body.append(markerSnapshot); markerLayer = markerSnapshot;
    }
    const bounds = previousMain.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'dissolve-snapshot'; layer.inert = true; layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    const previous = previousMain.cloneNode(true);
    previous.removeAttribute('id');
    previous.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    previous.style.margin = '0'; previous.style.maxWidth = 'none';
    layer.append(previous);
    document.body.append(layer); fadingLayer = layer;
    try { await update(); }
    catch (error) { if (fadingLayer === layer) clearDissolve(); else layer.remove(); throw error; }
    if (fadingLayer !== layer) { layer.remove(); return; }
    const timing = { duration: 150, easing: 'ease', fill: 'forwards' };
    const animations = [layer.animate({ opacity: [1, 0] }, timing)];
    if (markerSnapshot) animations.push(markerSnapshot.animate([
      { opacity: 1, transform: 'translateX(0)' },
      { opacity: 0, transform: 'translateX(16px)' }
    ], timing));
    const returningMarker = markerTransition === 'in' ? getTaskMarker() : null;
    if (returningMarker) {
      const position = returningMarker.style.transform;
      const animation = returningMarker.animate([
        { opacity: 0, transform: `${position} translateX(16px)` },
        { opacity: 1, transform: position }
      ], timing);
      animation.id = 'task-marker-page';
      animations.push(animation);
    }
    const incoming = root.querySelector('main'), outgoing = previous;
    if (direction || incoming !== previousMain) {
      // Horizontal keys follow their arrow; vertical cycling brings the next item up.
      const offset = Math.sign(direction) * 8 * (axis === 'x' ? -1 : 1);
      const translate = value => axis === 'x' ? `translateX(${value}px)` : `translateY(${value}px)`;
      if (incoming) animations.push(incoming.animate([
        { opacity: 0, transform: translate(offset) },
        { opacity: 1, transform: translate(0) }
      ], timing));
      if (outgoing) animations.push(outgoing.animate([
        { transform: translate(0) },
        { transform: translate(-offset) }
      ], timing));
    }
    animations.forEach(animation => viewAnimations.add(animation));
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      animations.forEach(animation => { viewAnimations.delete(animation); animation.cancel(); });
      layer.remove();
      if (fadingLayer === layer) { fadingLayer = null; updateTaskMarker({ animate: false }); }
      markerSnapshot?.remove(); if (markerLayer === markerSnapshot) markerLayer = null;
    });
  }
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) clearDissolve(); });
  return { clearDissolve, hitWall, moveHomeSections, dissolve, setDisclosureOpen };
}
