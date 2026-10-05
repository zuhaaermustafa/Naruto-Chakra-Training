// Opening screen: the figure and the title drift in opposite directions as the pointer moves.
// The CSS reads --px and --py (each -1..1). Runs only while the intro is on screen.

export function createIntroFx(intro) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let targetX = 0, targetY = 0, x = 0, y = 0, frameId = 0;

  function tick() {
    frameId = requestAnimationFrame(tick);
    x += (targetX - x) * 0.07;
    y += (targetY - y) * 0.07;
    intro.style.setProperty('--px', x.toFixed(3));
    intro.style.setProperty('--py', y.toFixed(3));
  }
  function sync() {
    const visible = !intro.hidden && !intro.classList.contains('leaving');
    if (visible && !frameId && !reduced.matches) frameId = requestAnimationFrame(tick);
    else if (!visible && frameId) { cancelAnimationFrame(frameId); frameId = 0; }
  }

  intro.addEventListener('pointermove', event => {
    targetX = event.clientX / innerWidth * 2 - 1;
    targetY = event.clientY / innerHeight * 2 - 1;
  });
  intro.addEventListener('pointerleave', () => { targetX = targetY = 0; });
  new MutationObserver(sync).observe(intro, { attributes: true, attributeFilter: ['hidden', 'class'] });
  sync();
}
