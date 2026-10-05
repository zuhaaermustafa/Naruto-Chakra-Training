// --- Convert camera landmarks into visible screen pixels ---
// Match object-fit: cover, then mirror exactly like the webcam element.
export function landmarkToScreen(point, videoWidth, videoHeight, width, height) {
  // Cover uses whichever scale fills both dimensions; the excess is cropped.
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const drawnWidth = videoWidth * scale;
  const drawnHeight = videoHeight * scale;
  // Center the enlarged image, then flip x to match the mirrored webcam.
  return {
    x: width - (point.x * drawnWidth + (width - drawnWidth) / 2),
    y: point.y * drawnHeight + (height - drawnHeight) / 2,
  };
}

// --- Estimate whether the palm is open ---
// An extended fingertip should be farther from the wrist than its middle knuckle.
export function isPalmOpen(points) {
  const wrist = points[0];
  const distance = p => Math.hypot(p.x - wrist.x, p.y - wrist.y);
  let extended = 0;
  // Check index, middle, ring and little fingers; ignore the thumb.
  for (const [tip, knuckle] of [[8, 6], [12, 10], [16, 14], [20, 18]]) {
    if (distance(points[tip]) > distance(points[knuckle]) * 1.1) extended++;
  }
  // Require at least three extended fingers. This is a simple gesture estimate.
  return extended >= 3;
}

// A fist has all four fingertips close to the wrist. Two extended firing fingers
// deliberately prevent this from classifying the firing pose as a closed hand.
export function isPalmClosed(points) {
  const wrist = points[0];
  const distance = point => Math.hypot(point.x - wrist.x, point.y - wrist.y);
  return [[8, 6], [12, 10], [16, 14], [20, 18]].every(([tip, knuckle]) =>
    distance(points[tip]) < distance(points[knuckle]) * 1.05);
}

// ---------------------------------------------------------------------------
// Shadow clone seal scoring
// ---------------------------------------------------------------------------
const clamp01 = x => Math.min(1, Math.max(0, x));
const ramp = (x, low, high) => clamp01((x - low) / (high - low));

// How much a hand looks like the seal, from 0 (not at all) to 1 (textbook).
//
// This used to be a strict yes/no test on 2D pixel distances. That fails exactly when the
// hands cross: fingers overlap, tilt toward the camera and partly hide each other, so single
// frames land just on the wrong side of a hard cut-off. Three things make it forgiving:
//   * a soft score instead of a hard threshold, so a slightly bent finger costs a little
//     instead of everything;
//   * 3D world landmarks when available, so a finger pointing at the lens still counts as out;
//   * ring and little finger only reduce the score, they never veto it on their own,
//     because a crossing hand rarely curls them perfectly.
// The timing layer (cloneSeal.js) then smooths the score over several frames.
export function handSealScore(points, world = null) {
  if (!points || points.length !== 21) return 0;
  const hasWorld = Array.isArray(world) && world.length === 21;
  const reach = (list, tip, knuckle, useDepth) => {
    const origin = list[0];
    const d = p => Math.hypot(p.x - origin.x, p.y - origin.y, useDepth ? (p.z ?? 0) - (origin.z ?? 0) : 0);
    return d(list[tip]) / Math.max(d(list[knuckle]), 1e-6);
  };
  // Pointing toward the camera shortens a finger in 2D, so for "out" take the better view.
  const extended = (tip, knuckle) => ramp(Math.max(
    reach(points, tip, knuckle, false),
    hasWorld ? reach(world, tip, knuckle, true) : 0), 1.02, 1.22);
  const folded = (tip, knuckle) => 1 - ramp(
    hasWorld ? reach(world, tip, knuckle, true) : reach(points, tip, knuckle, false), 1.0, 1.3);

  const index = extended(8, 6);
  const middle = extended(12, 10);
  const out = 0.5 * Math.min(index, middle) + 0.5 * (index + middle) / 2;
  const curled = (folded(16, 14) + folded(20, 18)) / 2;
  // An open palm (out = 1, curled = 0) scores 0.35, safely below the seal threshold.
  return out * (0.35 + 0.65 * curled);
}

// The line a hand "points along", wrist to middle fingertip, stretched a little past the tip.
// Used to tell whether two hands form an X.
export function handAxis(points) {
  const from = points[0];
  const tip = points[12];
  return { from, to: { x: tip.x + (tip.x - from.x) * 0.15, y: tip.y + (tip.y - from.y) * 0.15 } };
}
