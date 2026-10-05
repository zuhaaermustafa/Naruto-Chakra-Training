// Checks the Rasengan hit sequence without a browser: freeze, then shake and ring, then calm.
import assert from 'node:assert/strict';

const makeElement = () => ({
  style: {}, classList: { add() {} }, width: 0, height: 0, offsetWidth: 0,
  after() {}, getContext: () => ({ drawImage() {} }),
});
const stage = [makeElement(), makeElement()];
globalThis.document = {
  createElement: makeElement,
  body: { appendChild() {} },
  querySelectorAll: () => stage,
};
let reduced = false;
globalThis.matchMedia = () => ({ matches: reduced });
globalThis.innerHeight = 720;

const THREE = await import('three');
const { createImpactFx } = await import('../src/impactFx.js');

function run(label, options) {
  const scene = new THREE.Scene();
  const fx = createImpactFx({ impactScene: scene, camera: { aspect: 16 / 9 } }, makeElement());
  const ring = scene.children[0];
  let paused = 0, resumed = 0;
  fx.hit({ pause: () => paused++, resume: () => resumed++ });
  let frozenFrames = 0;
  let sawShake = false;
  let ringSeen = false;
  for (let i = 0; i < 120; i++) {
    if (fx.update(1 / 60)) frozenFrames++;
    if (stage[0].style.translate) sawShake = true;
    if (ring.visible) ringSeen = true;
  }
  options.check({ frozenFrames, sawShake, ringSeen, paused, resumed, ring });
  console.log(`PASS: ${label}`);
}

run('hit freezes a few frames, then shakes, shows the ring and resumes the clip', {
  check({ frozenFrames, sawShake, ringSeen, paused, resumed, ring }) {
    assert.ok(frozenFrames >= 4 && frozenFrames <= 8, `froze ${frozenFrames} frames`);
    assert.ok(sawShake, 'no shake was applied');
    assert.ok(ringSeen, 'ring never appeared');
    assert.equal(paused, 1);
    assert.equal(resumed, 1);
    assert.equal(ring.visible, false, 'ring should be gone after it finishes');
    assert.equal(stage[0].style.translate, '', 'shake should settle back to normal');
  },
});

// With the switch off, nothing happens and the clip is never paused.
{
  const scene = new THREE.Scene();
  const fx = createImpactFx({ impactScene: scene, camera: { aspect: 16 / 9 } }, makeElement());
  fx.setEnabled(false);
  let paused = 0;
  fx.hit({ pause: () => paused++ });
  assert.equal(fx.update(1 / 60), false);
  assert.equal(paused, 0);
  console.log('PASS: switching impact effects off disables them');
}

// The system "reduce motion" setting must not silently disable the effect any more.
reduced = true;
run('effect still plays when the system asks for reduced motion', {
  check({ sawShake, ringSeen }) { assert.ok(sawShake && ringSeen); },
});
