import * as THREE from 'three';

// --- Create the scene, virtual camera and renderer ---
export function createThreeSetup() {
  const scene = new THREE.Scene();
  // This is a virtual camera for viewing the 3D scene, not the webcam.
  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 100);
  camera.position.z = 5;
  // Make its new position available to raycasting before the first render.
  camera.updateMatrixWorld();

  // A transparent canvas lets the real webcam picture show underneath.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.domElement.id = 'three-canvas';
  renderer.setClearColor(0x000000, 0);
  // Limit pixel density to avoid unnecessary GPU work on high-resolution displays.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  // Keep the explosion separate so only the hand effects use CSS screen blending.
  const impactScene = new THREE.Scene();
  const impactRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  impactRenderer.domElement.id = 'impact-canvas';
  impactRenderer.setClearColor(0x000000, 0);
  impactRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  impactRenderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(impactRenderer.domElement);

  // --- Keep the 3D view aligned when the window size changes ---
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    impactRenderer.setSize(innerWidth, innerHeight);
    impactRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  });
  return { scene, camera, renderer, impactScene, impactRenderer };
}
