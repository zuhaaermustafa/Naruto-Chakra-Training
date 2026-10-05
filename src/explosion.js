import * as THREE from 'three';
import explosionURL from './assets/explosion.mp4';
import { createVideoMaterial } from './videoMaterial.js';

export function createExplosion(scene, camera) {
  // A separate video plays once at impact; it must not loop like the Rasengan.
  const video = document.createElement('video');
  video.src = explosionURL;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.loop = false;
  const material = createVideoMaterial(video);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 10;
  mesh.visible = false;
  scene.add(mesh);

  let playbackId = 0;
  function hide() {
    playbackId++;
    mesh.visible = false;
    material.uniforms.opacity.value = 0;
    video.pause();
  }
  video.addEventListener('ended', hide);

  return {
    video, hide,
    // Call on the Start click to prepare playback before a later hand gesture.
    async prime() {
      await video.play();
      video.pause();
      video.currentTime = 0;
    },
    play() {
      const currentPlayback = ++playbackId;
      video.currentTime = 0;
      return video.play().then(() => {
        if (currentPlayback !== playbackId) return;
        mesh.visible = true;
        material.uniforms.opacity.value = 1;
      });
    },
    update() {
      if (!mesh.visible) return;
      // Fit over the whole view without stretching the 16:9 explosion clip.
      const height = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const aspect = video.videoWidth / video.videoHeight || 16 / 9;
      const displayHeight = Math.max(height, height * camera.aspect / aspect);
      mesh.scale.set(displayHeight * aspect, displayHeight, 1);
    },
  };
}
