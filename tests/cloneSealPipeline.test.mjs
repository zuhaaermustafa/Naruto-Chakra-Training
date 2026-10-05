// Simulates the crossed-hands seal with realistic trouble (tilted fingers, jitter, the tracker
// giving both hands the same Left/Right label, a hand dropped for a frame) and compares the
// old pipeline with the new one. No camera is needed: hands come from a synthetic model.
import assert from 'node:assert/strict';
import { CloneSealTracker as NewTracker } from '../src/cloneSeal.js';
import { handSealScore, handAxis } from '../src/coordinates.js';
import { buildHand, jitter, rng, POSES } from './helpers/handModel.mjs';

const FPS = 30;
const dt = 1 / FPS;

// ---- The previous implementation, kept here as the baseline ----
function legacyIsSeal(points) {
  const wrist = points[0];
  const distance = point => Math.hypot(point.x - wrist.x, point.y - wrist.y);
  const out = (tip, knuckle) => distance(points[tip]) > distance(points[knuckle]) * 1.1;
  const folded = (tip, knuckle) => distance(points[tip]) < distance(points[knuckle]) * 1.05;
  return out(8, 6) && out(12, 10) && folded(16, 14) && folded(20, 18);
}
class LegacyTracker {
  constructor() { this.active = false; this.hold = 0; this.cooldown = 0; this.absent = 0; this.armed = true; }
  step(hands, dtSeconds) {
    const ok = hands.length === 2 && hands.every(h => h.seal) &&
      Math.hypot(hands[0].position.x - hands[1].position.x, hands[0].position.y - hands[1].position.y)
        < (hands[0].size + hands[1].size) * 1.5;
    if (!ok) { this.hold = Math.max(0, this.hold - dtSeconds * 2); return null; }
    this.hold += dtSeconds;
    if (this.hold < 0.35) return null;
    this.hold = 0;
    return 'summon';
  }
}

// ---- Turn raw landmarks into the hand object the app uses ----
function describe(raw, label, score = 0.9) {
  const pts = raw.image;
  const palm = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + pts[i].x / 5, y: a.y + pts[i].y / 5 }), { x: 0, y: 0 });
  return {
    position: palm, size: Math.hypot(pts[9].x - pts[0].x, pts[9].y - pts[0].y), label, score,
    seal: legacyIsSeal(pts), sealScore: handSealScore(pts, raw.world), axis: handAxis(pts),
  };
}

// One trial: a person holds the crossed seal for 1.2 seconds. Did a summon happen?
function trial(seed, TrackerClass, { dropout = 0.08, sameLabel = 0.5 } = {}) {
  const r = rng(seed);
  const tracker = new TrackerClass();
  // Each "person" folds ring/little finger a bit differently and tilts the hands.
  const foldA = r.range(0.45, 1), foldB = r.range(0.45, 1);
  const rollA = r.range(0.3, 0.7), pitchA = r.range(-0.5, 0.5);
  const pitchB = r.range(-0.5, 0.5);
  const baseA = buildHand({ curl: { ...POSES.seal, ring: foldA, pinky: foldA }, roll: -rollA, pitch: pitchA, at: [0.52, 0.72] });
  const baseB = buildHand({ curl: { ...POSES.seal, ring: foldB, pinky: foldB }, roll: rollA, pitch: pitchB, at: [0.48, 0.72], mirror: true });
  const needed = Math.round(1.2 * FPS);
  for (let frame = 0; frame < needed; frame++) {
    const a = jitter(baseA, r, 0.006, 0.004);
    const b = jitter(baseB, r, 0.006, 0.004);
    const labels = r.next() < sameLabel ? ['Right', 'Right'] : ['Left', 'Right'];
    // The old code kept one hand per label, so equal labels left a single hand.
    let hands = [describe(a, labels[0]), describe(b, labels[1])];
    if (TrackerClass === LegacyTracker && labels[0] === labels[1]) hands = [hands[0]];
    if (r.next() < dropout) hands = hands.slice(0, 1);
    if (tracker.step(hands, dt) === 'summon') return true;
  }
  return false;
}

const TRIALS = 1500;
const rate = Cls => { let ok = 0; for (let i = 0; i < TRIALS; i++) ok += trial(i + 1, Cls) ? 1 : 0; return ok / TRIALS; };
const oldRate = rate(LegacyTracker);
const newRate = rate(NewTracker);
console.log(`crossed seal summoned in 1.2 s:  old ${(oldRate * 100).toFixed(1)}%   new ${(newRate * 100).toFixed(1)}%  (simulated, ${TRIALS} trials)`);
assert.ok(newRate >= 0.97, `new pipeline should be reliable, got ${newRate}`);
assert.ok(newRate > oldRate + 0.25, 'new pipeline should clearly beat the old one');

// ---- It must not fire when it should not ----
function falsePositive(label, build, seconds = 3) {
  const r = rng(99);
  const tracker = new NewTracker();
  for (let frame = 0; frame < seconds * FPS; frame++) {
    if (tracker.step(build(r), dt) === 'summon') assert.fail(`false summon: ${label}`);
  }
}
const hand = (pose, at, roll = 0, mirror = false) => r => describe(jitter(buildHand({ curl: pose, roll, at, mirror }), r, 0.006, 0.004), 'Right');
falsePositive('two open palms together', r => [hand(POSES.open, [0.47, 0.7])(r), hand(POSES.open, [0.53, 0.7], 0, true)(r)]);
falsePositive('two fists together', r => [hand(POSES.fist, [0.47, 0.7])(r), hand(POSES.fist, [0.53, 0.7], 0, true)(r)]);
falsePositive('one hand making the seal', r => [hand(POSES.seal, [0.5, 0.7])(r)]);
falsePositive('seal in one hand, open palm in the other', r => [hand(POSES.seal, [0.47, 0.7], -0.4)(r), hand(POSES.open, [0.53, 0.7], 0.4, true)(r)]);
falsePositive('two peace signs far apart', r => [hand(POSES.seal, [0.2, 0.7])(r), hand(POSES.seal, [0.8, 0.7], 0, true)(r)]);
falsePositive('Rasengan palm plus Chidori palm', r => [hand(POSES.open, [0.25, 0.7])(r), hand(POSES.open, [0.75, 0.7], 0, true)(r)]);
console.log('no false summons in 6 non-seal scenarios');
