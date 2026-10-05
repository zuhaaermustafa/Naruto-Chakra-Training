import * as THREE from 'three';
import rasenganURL from './assets/rasengan.mp4';
import { createVideoMaterial, createEnergyCoreMaterial } from './videoMaterial.js';
import { createRibbons, makeGlowTexture } from './effectsKit.js';

const STREAKS = 72;  // wind streaks spiraling around the orb
const POINTS = 10;   // points along each streak (head to tail)
const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;

export function createRasengan() {
  // --- Prepare the looping cartoon clip ---
  const video = document.createElement('video');
  video.src = rasenganURL;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const material = createVideoMaterial(video, 1.04, true);
  // Keep the bright colour, but let the real palm show through the core.
  let maxOpacity = 0.85;
  const orb = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  orb.renderOrder = 2;
  video.addEventListener('loadedmetadata', () => {
    orb.scale.x = video.videoWidth / video.videoHeight;
    core.scale.copy(orb.scale);
  });
  const group = new THREE.Group();
  group.add(orb);
  const coreMaterial = createEnergyCoreMaterial(material, false);
  const core = new THREE.Mesh(orb.geometry, coreMaterial);
  // Layer 1 is drawn normally above the screen-blended glow.
  core.layers.set(1);
  core.renderOrder = orb.renderOrder;
  group.add(core);
  group.visible = false;

  // --- Soft halo behind the orb; it swells while charging and flashes when ready ---
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture([
      [0, 'rgba(255,255,255,0.95)'],
      [0.3, 'rgba(120,205,255,0.55)'],
      [1, 'rgba(30,120,255,0)'],
    ]),
    transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false,
  }));
  halo.layers.set(1);
  halo.renderOrder = 1;
  group.add(halo);

  // --- Wind streaks: thin ribbons orbiting on tilted planes, drawn into the orb ---
  const ribbons = createRibbons(STREAKS, POINTS, 0x35b6ff);
  ribbons.mesh.layers.set(1);
  ribbons.mesh.renderOrder = 4;
  group.add(ribbons.mesh);
  // phase, speed, radius, start angle, tilt, roll, length, thickness (per streak)
  const seeds = new Float32Array(STREAKS * 8);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const xs = new Float32Array(POINTS);
  const ys = new Float32Array(POINTS);
  const widths = new Float32Array(POINTS);
  const alphas = new Float32Array(POINTS);

  let lastTime = null;
  let wasFull = false;
  let flash = 0;

  return {
    group, video,
    play: () => video.play(),
    setOpacity(value) { maxOpacity = THREE.MathUtils.clamp(value, 0.2, 0.95); },
    restart() { if (video.readyState >= 1) video.currentTime = 0; },
    hide() {
      group.visible = false;
      material.uniforms.opacity.value = 0;
      coreMaterial.uniforms.opacity.value = 0;
      halo.material.opacity = 0;
      flash = 0;
    },
    // progress 0..1 describes the 1.5-second buildup, not video playback time.
    update(progress, time, visibility = 1) {
      const dt = lastTime === null ? 1 / 60 : Math.min(Math.max(time - lastTime, 0), 0.05);
      lastTime = time;
      const p = THREE.MathUtils.clamp(progress, 0, 1);
      group.visible = visibility > 0;

      // A tiny bright seed appears early, then swells into the full orb.
      const reveal = smooth(p, 0.1, 1);
      orb.scale.y = 0.06 + 0.94 * reveal;
      orb.scale.x = orb.scale.y * (video.videoWidth / video.videoHeight || 1);
      // The sphere spins faster and faster as chakra packs in, then settles.
      orb.rotation.z -= dt * (1 + 9 * p * (1 - smooth(p, 0.92, 1)));
      core.rotation.z = orb.rotation.z;
      // The forming orb trembles, then steadies when it becomes stable.
      const shake = 0.014 * reveal * (1 - smooth(p, 0.9, 1));
      orb.position.set((Math.random() - 0.5) * 2 * shake, (Math.random() - 0.5) * 2 * shake, 0);
      core.position.copy(orb.position);
      core.scale.copy(orb.scale);
      material.uniforms.opacity.value = reveal * visibility * maxOpacity * 0.42;
      coreMaterial.uniforms.opacity.value = Math.min(1, (0.15 + reveal) ) * visibility * maxOpacity * smooth(p, 0.02, 0.12);
      material.uniforms.brightness.value = 1 + 0.08 * reveal;

      // One-time flash and outward gust when the charge completes.
      const full = p >= 1;
      if (full && !wasFull) flash = 1;
      wasFull = full;
      flash = Math.max(0, flash - dt * 2.2);

      halo.scale.setScalar(2.0 * (0.4 + 0.6 * reveal) + flash * 1.4);
      halo.material.opacity = Math.min(1, 0.28 * reveal + 0.6 * flash) * visibility;

      // How many streaks are alive: builds up fast, settles to a steady swirl when ready.
      const activity = smooth(p, 0, 0.1) * (1 - 0.35 * smooth(p, 0.85, 1)) * visibility;
      const alive = Math.ceil(STREAKS * smooth(p, 0, 0.35));
      const speed = 0.5 + 1.1 * p;

      for (let i = 0; i < STREAKS; i++) {
        if (i >= alive || activity <= 0.001) { ribbons.clear(i); continue; }
        const s = i * 8;
        const headPhase = (((seeds[s] + time * speed * (0.6 + 0.8 * seeds[s + 1])) % 1) + 1) % 1;
        const rOut = 0.75 + 0.95 * seeds[s + 2];
        const rIn = 0.42;
        const startAngle = seeds[s + 3] * TAU;
        const tilt = 0.2 + 1.2 * seeds[s + 4];
        const roll = seeds[s + 5] * TAU;
        const phaseSpan = 0.1 + 0.16 * seeds[s + 6];
        const thickness = 0.012 + 0.014 * seeds[s + 7];
        const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
        const cosR = Math.cos(roll), sinR = Math.sin(roll);

        for (let j = 0; j < POINTS; j++) {
          const along = j / (POINTS - 1);
          const phase = headPhase - along * phaseSpan;
          if (phase < 0) {
            // The tail has not been born yet; fold it onto the previous point.
            xs[j] = xs[j - 1]; ys[j] = ys[j - 1]; widths[j] = 0; alphas[j] = 0;
            continue;
          }
          const r = (rIn + (rOut - rIn) * Math.pow(1 - phase, 1.4)) * (1 + flash * 0.7);
          const angle = startAngle + 5 * Math.pow(phase, 0.7) + time * 0.6;
          // Orbit on a tilted plane so streaks loop around the orb, not just flat circles.
          const x3 = r * Math.cos(angle);
          const y3 = r * Math.sin(angle) * cosT;
          const z3 = r * Math.sin(angle) * sinT;
          xs[j] = x3 * cosR - y3 * sinR;
          ys[j] = x3 * sinR + y3 * cosR;
          // The far side of the orbit is dimmer, which gives depth.
          const depth = Math.max(-1, Math.min(1, z3 / Math.max(r * Math.max(sinT, 0.2), 0.001)));
          const shade = 0.7 + 0.3 * depth;
          widths[j] = thickness * Math.pow(1 - along, 0.7);
          alphas[j] = Math.pow(Math.sin(phase * Math.PI), 0.7) * Math.pow(1 - along, 0.8) * shade * activity;
        }
        ribbons.set(i, xs, ys, 0.03, widths, alphas);
      }
      ribbons.commit();
    },
  };
}