// A small synthetic hand, good enough to exercise the gesture maths without a camera.
// Produces 21 landmarks in the MediaPipe order, in image space (like `landmarks`) and in
// metres (like `worldLandmarks`).

// Seeded random numbers, so every run of the tests sees the same "people".
export function rng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  return { next, gauss, range: (a, b) => a + (b - a) * next() };
}

// Finger layout: [knuckle x, knuckle y, proximal, middle, distal] in metres, palm facing the camera.
const FINGERS = {
  index:  [-0.030, 0.090, 0.045, 0.025, 0.022],
  middle: [ 0.000, 0.095, 0.050, 0.030, 0.025],
  ring:   [ 0.027, 0.090, 0.045, 0.028, 0.024],
  pinky:  [ 0.050, 0.080, 0.035, 0.020, 0.020],
};
const ORDER = ['index', 'middle', 'ring', 'pinky'];

// curl: 0 = straight, 1 = tightly folded, for each finger.
export function buildHand({ curl, roll = 0, pitch = 0, at = [0.5, 0.7], scale = 1.6, mirror = false }) {
  const local = [];
  local[0] = [0, 0, 0];
  local[1] = [-0.03, 0.03, 0]; local[2] = [-0.05, 0.06, 0];
  local[3] = [-0.065, 0.085, 0]; local[4] = [-0.075, 0.105, 0];
  ORDER.forEach((name, k) => {
    const [bx, by, l1, l2, l3] = FINGERS[name];
    const c = curl[name] ?? 0;
    const angles = [c * 1.35, c * 1.2, c * 0.9]; // how far each joint folds toward the palm
    let x = bx, y = by, z = 0, dir = 0;
    const base = 5 + k * 4;
    local[base] = [x, y, z];
    [l1, l2, l3].forEach((len, j) => {
      dir += angles[j];
      y += Math.cos(dir) * len;
      z -= Math.sin(dir) * len; // folding moves the finger toward the palm, i.e. toward the lens
      local[base + 1 + j] = [x, y, z];
    });
  });
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const world = local.map(([x, y, z]) => {
    if (mirror) x = -x;
    const y2 = y * cp - z * sp, z2 = y * sp + z * cp; // pitch about the x axis
    return { x: x * cr - y2 * sr, y: x * sr + y2 * cr, z: z2 };
  });
  const image = world.map(p => ({ x: (at[0] + p.x * scale) * 1000, y: (at[1] - p.y * scale) * 1000, z: p.z }));
  return { image, world };
}

export const POSES = {
  seal:  { index: 0, middle: 0, ring: 1, pinky: 1 },
  open:  { index: 0, middle: 0, ring: 0, pinky: 0 },
  fist:  { index: 1, middle: 1, ring: 1, pinky: 1 },
};

export function jitter(hand, random, sigma2d, sigma3d) {
  return {
    image: hand.image.map(p => ({ x: p.x + random.gauss() * sigma2d * 1000, y: p.y + random.gauss() * sigma2d * 1000, z: p.z })),
    world: hand.world.map(p => ({ x: p.x + random.gauss() * sigma3d, y: p.y + random.gauss() * sigma3d, z: p.z + random.gauss() * sigma3d })),
  };
}
