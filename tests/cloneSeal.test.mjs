import assert from 'node:assert/strict';
import { CloneSealTracker, handsMakeSeal, handsCross, sealStrength, HOLD_SECONDS, COOLDOWN_SECONDS } from '../src/cloneSeal.js';

const hand = (x, seal = true, size = 1) => ({ seal, size, position: { x, y: 0 } });
const together = [hand(0), hand(1)];
const apart = [hand(0), hand(4)];
const oneBad = [hand(0), hand(1, false)];

assert.equal(handsMakeSeal(together), true);
assert.equal(handsMakeSeal(apart), false);
assert.equal(handsMakeSeal(oneBad), false);
assert.equal(handsMakeSeal([hand(0)]), false);
assert.equal(handsMakeSeal([]), false);

// The seal must not depend on Left/Right labels: crossed hands often share one.
const labelled = (x, label) => ({ ...hand(x), label });
assert.equal(handsMakeSeal([labelled(0, 'Right'), labelled(1, 'Right')]), true);
// Soft scores: a slightly weak hand still counts, a very weak one does not.
const soft = (x, sealScore) => ({ sealScore, size: 1, position: { x, y: 0 } });
assert.equal(handsMakeSeal([soft(0, 0.7), soft(1, 0.6)]), true);
assert.equal(handsMakeSeal([soft(0, 0.7), soft(1, 0.3)]), false);
// Two hands far apart still count when their pointing lines cross, as in an X.
const crossing = (x, tilt) => ({ ...hand(x), axis: { from: { x, y: 0 }, to: { x: x + tilt * 10, y: 10 } } });
assert.equal(handsCross(hand(0), hand(4)), false);
assert.equal(handsCross(crossing(0, 1), crossing(4, -1)), true);
assert.equal(handsCross(crossing(0, 1), crossing(4, 1)), false); // parallel, not crossed
assert.equal(sealStrength([hand(0), hand(1), hand(9)]), 1); // a third hand never spoils it

function run(tracker, hands, seconds) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / 0.01); i++) {
    const e = tracker.step(hands, 0.01);
    if (e) events.push(e);
  }
  return events;
}

const t = new CloneSealTracker();
// Holding the seal too briefly does nothing.
assert.deepEqual(run(t, together, HOLD_SECONDS - 0.1), []);
run(t, [], 1);
// A full hold summons exactly once, even if the seal keeps being held.
assert.deepEqual(run(t, together, HOLD_SECONDS + 3), ['summon']);
assert.equal(t.active, true);
// The seal must be dropped before it can dispel.
run(t, [], 0.5);
run(t, [], COOLDOWN_SECONDS);
assert.deepEqual(run(t, together, HOLD_SECONDS + 0.2), ['dispel']);
assert.equal(t.active, false);
// Cooldown blocks an immediate re-summon.
run(t, [], 0.4);
assert.deepEqual(run(t, together, HOLD_SECONDS + 0.2), []);
run(t, [], 2);
assert.deepEqual(run(t, together, HOLD_SECONDS + 0.2), ['summon']);
// One dropped tracking frame does not reset a nearly finished hold.
const f = new CloneSealTracker();
run(f, together, HOLD_SECONDS - 0.05);
f.step([], 0.02);
assert.deepEqual(run(f, together, 0.2), ['summon']);
// A few frames of lost tracking (a hand hidden behind the other) do not break the hold...
const g = new CloneSealTracker();
run(g, together, 0.15);
run(g, [], 0.1);
assert.deepEqual(run(g, together, 0.4), ['summon']);
// ...but a real release does, and short flickers of the seal never summon on their own.
const h = new CloneSealTracker();
for (let i = 0; i < 10; i++) { run(h, together, 0.08); run(h, [], 0.6); }
assert.equal(h.active, false);
console.log('cloneSeal tests passed');
