// Decides when the shadow clone seal is held, and flips the jutsu on and off.
// Kept free of camera and rendering code so it is easy to test.
export const HOLD_SECONDS = 0.35;    // how long the seal must be held
export const COOLDOWN_SECONDS = 1.4; // pause after each toggle
const RELEASE_SECONDS = 0.3;         // the seal must be dropped this long before it can toggle again

export const POSE_MIN = 0.55;        // per-hand pose score that counts as "making the seal"
const PROXIMITY = 1.5;               // palms this close (in palm lengths) count as touching
const ENTER = 0.5;                   // smoothed confidence needed for the hold timer to run
const EXIT = 0.2;                    // below this the seal counts as dropped
const ATTACK = 14;                   // confidence rise speed per second (fast: react quickly)
const DECAY = 4;                     // confidence fall speed per second (slow: forgive bad frames)

const score = hand => hand?.sealScore ?? (hand?.seal ? 1 : 0);

// Do the segments p1-p2 and p3-p4 cross?
function segmentsIntersect(p1, p2, p3, p4) {
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = side(p3, p4, p1), d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3), d4 = side(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Two hands form the seal when they cross each other (an X) or are held close together.
export function handsCross(a, b) {
  const apart = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  if (apart < (a.size + b.size) * PROXIMITY) return true;
  return Boolean(a.axis && b.axis && segmentsIntersect(a.axis.from, a.axis.to, b.axis.from, b.axis.to));
}

// How strongly the seal is shown this frame: 0 (not at all) to 1.
// Works with any hands in view, whatever their Left/Right label: crossed hands often get the
// same label, and the seal must not depend on it.
export function sealStrength(hands) {
  if (!hands || hands.length < 2) return 0;
  let best = 0;
  for (let i = 0; i < hands.length; i++) {
    for (let j = i + 1; j < hands.length; j++) {
      if (!handsCross(hands[i], hands[j])) continue;
      best = Math.max(best, Math.min(score(hands[i]), score(hands[j])));
    }
  }
  return best;
}

export const handsMakeSeal = hands => sealStrength(hands) >= POSE_MIN;

export class CloneSealTracker {
  constructor() { this.reset(); }
  reset() {
    this.active = false;
    this.hold = 0;
    this.cooldown = 0;
    this.absent = 0;
    this.armed = true;
    this.confidence = 0; // the seal evidence, smoothed over recent frames
  }
  get progress() { return Math.min(1, this.hold / HOLD_SECONDS); }
  // True while a seal is being shown, even if tracking flickers for a frame or two.
  get sealing() { return this.confidence >= ENTER; }
  // Returns 'summon', 'dispel' or null.
  step(hands, dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    // Smooth the per-frame answer. Rising is fast and falling is slow, so a single frame in
    // which the crossed hands are mislabelled or half hidden does not break the hold.
    const target = handsMakeSeal(hands) ? 1 : 0;
    const rate = target > this.confidence ? ATTACK : DECAY;
    this.confidence += (target - this.confidence) * (1 - Math.exp(-rate * dt));

    if (this.confidence < EXIT) {
      this.hold = Math.max(0, this.hold - dt * 2);
      this.absent += dt;
      if (this.absent > RELEASE_SECONDS) this.armed = true;
      return null;
    }
    this.absent = 0;
    if (this.cooldown > 0 || !this.armed) return null;
    // While the seal is shown the timer runs. During a short tracking dropout (or while the
    // confidence is between EXIT and ENTER) it pauses instead of resetting, and never counts
    // frames in which no seal was seen.
    if (this.confidence < ENTER || !target) return null;
    this.hold += dt;
    if (this.hold < HOLD_SECONDS) return null;
    this.hold = 0;
    this.armed = false;
    this.cooldown = COOLDOWN_SECONDS;
    this.active = !this.active;
    return this.active ? 'summon' : 'dispel';
  }
}
