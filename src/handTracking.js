import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { landmarkToScreen, isPalmOpen, isPalmClosed, handSealScore, handAxis } from './coordinates.js';
import { isFingerGun } from './gestures.js';

let tracker = null;
let lastVideoTime = -1;
let lastResult = null;
let lastFrameAt = 0;
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();

// --- Load tracking for both hands ---
export async function loadHandTracking() {
  if (tracker) return;
  const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
  const options = {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO', numHands: 2,
    // Slightly lower than the usual 0.65: two crossed hands overlap and hide each other, and
    // stricter limits make the model drop one of them for a few frames.
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    tracker = await HandLandmarker.createFromOptions(vision, options);
  } catch (error) {
    console.warn('Trying CPU tracking after GPU initialization failed.', error);
    options.baseOptions.delegate = 'CPU';
    tracker = await HandLandmarker.createFromOptions(vision, options);
  }
  lastVideoTime = -1;
  lastResult = null;
}

// Convert one tracked palm to scene coordinates; each hand gets its own Vector3.
function describeHand(landmarks, world, label, score, video, camera) {
  const points = landmarks.map(point => landmarkToScreen(point,
    video.videoWidth, video.videoHeight, innerWidth, innerHeight));
  const palm = { x: 0, y: 0 };
  for (const index of [0, 5, 9, 13, 17]) {
    palm.x += points[index].x / 5;
    palm.y += points[index].y / 5;
  }
  const pixels = Math.hypot(points[9].x - points[0].x, points[9].y - points[0].y);
  ndc.set(palm.x / innerWidth * 2 - 1, 1 - palm.y / innerHeight * 2);
  raycaster.setFromCamera(ndc, camera);
  const position = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, position);
  const worldPerPixel = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / innerHeight;
  // Unit vector pointing from the wrist toward the fingers (scene axes: y is up).
  const dx = points[9].x - points[0].x;
  const dy = points[9].y - points[0].y;
  const length = Math.hypot(dx, dy) || 1;
  const direction = new THREE.Vector2(dx / length, -dy / length);
  return { position, direction, size: pixels * worldPerPixel, label, score,
    open: isPalmOpen(points), closed: isPalmClosed(points), gun: isFingerGun(world),
    sealScore: handSealScore(landmarks, world), axis: handAxis(points) };
}

export function detectHands(video, camera) {
  if (!tracker || video.readyState < 2 || !video.videoWidth) return [];
  // Process once per camera frame. Reuse results between display refreshes.
  if (video.currentTime !== lastVideoTime) {
    lastResult = tracker.detectForVideo(video, performance.now());
    lastVideoTime = video.currentTime;
    lastFrameAt = performance.now();
  }
  if (!lastResult || performance.now() - lastFrameAt > 250) return [];
  // Return every tracked hand. Do not merge by Left/Right label here: crossed hands are often
  // both labelled the same, and dropping one made the shadow clone seal fail about half the time.
  return lastResult.landmarks.map((landmarks, i) => {
    const category = lastResult.handedness[i]?.[0];
    return describeHand(landmarks, lastResult.worldLandmarks?.[i], category?.categoryName ?? null,
      category?.score ?? 0, video, camera);
  });
}

export function closeHandTracking() {
  tracker?.close();
  tracker = null;
  lastResult = null;
  lastVideoTime = -1;
}