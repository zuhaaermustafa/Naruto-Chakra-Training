// Use 3D joints for the firing pose: fingers aimed at the lens look short in 2D.
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function jointAngle(a, b, c) {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const denominator = Math.hypot(...u) * Math.hypot(...v);
  if (denominator < 1e-8) return 0;
  const cosine = u.reduce((sum, value, i) => sum + value * v[i], 0) / denominator;
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

export function isFingerGun(points) {
  if (!points || points.length !== 21) return false;
  const straight = base => jointAngle(points[base], points[base + 1], points[base + 2]) > 145
    && jointAngle(points[base + 1], points[base + 2], points[base + 3]) > 140;
  const palmWidth = distance(points[5], points[17]);
  if (palmWidth < 1e-6) return false;
  const twoFingers = straight(5) && straight(9) && !straight(13) && !straight(17);
  // Smaller z means nearer the camera. Require both fingertips to aim forward.
  const towardCamera = points[5].z - points[8].z > palmWidth * 0.25
    && points[9].z - points[12].z > palmWidth * 0.25;
  const together = distance(points[8], points[12]) < palmWidth * 0.8;
  return twoFingers && towardCamera && together;
}
