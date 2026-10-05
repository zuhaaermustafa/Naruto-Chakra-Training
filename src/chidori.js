import * as THREE from 'three';
import chidoriURL from './assets/chidori.mp4';
import { createLuminanceKeyMaterial } from './videoMaterial.js';
import { makeGlowTexture } from './effectsKit.js';

// ---------- tweak these ----------
const SCALE = 4.0;            // lightning size compared with your hand
const LIFT = 0.2;             // moves the lightning toward your fingertips (0 = on the palm)
const CORE_OFFSET_X = 0;      // the clip is centred on its bright core, so no correction is needed
const GAIN = 2.6;             // how solid the lightning is. Higher = less see-through (the palm is covered)
const FLASH_GAIN = 4.2;       // gain at the instant of a strobe
const FLASH_RATE = 1.6;       // average strobes per second while Chidori is held
const SOUND = true;           // synthesized crackle + a thousand chirping birds; false = silent
const SOUND_VOLUME = 0.45;    // master volume, 0..1
// ---------------------------------

// The clip itself is silent, so the sound is built live with the Web Audio API:
// a hum, a crackle of filtered noise, many short high chirps ("a thousand birds"),
// and a violent crack with a low thump each time the lightning strobes.
function createChidoriSound() {
  let ctx = null;
  let master = null;
  let noiseGain = null;
  let noiseBuffer = null;

  function start() {
    if (!SOUND) return;
    if (ctx) { ctx.resume?.().catch(() => {}); return; }
    try {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      ctx = new AudioContextClass();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      // crackle: looping white noise, high-passed, gated randomly every frame
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 1800;
      noiseGain = ctx.createGain();
      noiseGain.gain.value = 0;
      noise.connect(highpass);
      highpass.connect(noiseGain);
      noiseGain.connect(master);
      noise.start();

      // low electrical hum
      const hum = ctx.createOscillator();
      hum.type = 'sawtooth';
      hum.frequency.value = 58;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 220;
      const humGain = ctx.createGain();
      humGain.gain.value = 0.4;
      hum.connect(lowpass);
      lowpass.connect(humGain);
      humGain.connect(master);
      hum.start();
    } catch (error) {
      console.warn('Chidori sound unavailable:', error);
      ctx = null;
    }
  }

  function chirp() {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const base = 2200 + Math.random() * 2600;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * (0.55 + Math.random() * 0.25), t + 0.14);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  // A sharp electrical crack plus a falling thump, played on every strobe.
  function strike() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0, t);
    crackGain.gain.linearRampToValueAtTime(0.9, t + 0.004);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    crack.connect(hp);
    hp.connect(crackGain);
    crackGain.connect(master);
    crack.start(t);
    crack.stop(t + 0.25);
    crack.onended = () => { crack.disconnect(); hp.disconnect(); crackGain.disconnect(); };

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(130, t);
    thump.frequency.exponentialRampToValueAtTime(42, t + 0.28);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0, t);
    thumpGain.gain.linearRampToValueAtTime(0.8, t + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start(t);
    thump.stop(t + 0.35);
    thump.onended = () => { thump.disconnect(); thumpGain.disconnect(); };
  }

  return {
    start,
    strike,
    update(strength, dt) {
      if (!ctx) return;
      master.gain.setTargetAtTime(strength * SOUND_VOLUME, ctx.currentTime, 0.05);
      noiseGain.gain.value = (Math.random() < 0.55 ? Math.random() : 0.05) * 0.5;
      if (strength > 0.2 && Math.random() < 14 * dt * strength) chirp();
    },
    silence() { if (ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.03); },
  };
}

// The lightning is solid: it covers the palm instead of letting it show through, and it
// strobes now and then, lighting up the room for an instant.
export function createChidori() {
  const video = document.createElement('video');
  video.src = chidoriURL;
  video.loop = true; // the clip is a seamless loop
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  const material = createLuminanceKeyMaterial(video, GAIN);
  const bolt = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  bolt.renderOrder = 4;
  bolt.layers.set(1); // normally blended canvas, so it stays vivid on a bright wall
  const group = new THREE.Group();
  group.add(bolt);

  const glowTexture = makeGlowTexture([
    [0, 'rgba(190,225,255,0.95)'],
    [0.35, 'rgba(70,140,255,0.4)'],
    [1, 'rgba(20,80,255,0)'],
  ]);
  const makeHalo = (layer, order, size) => {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, transparent: true, opacity: 0,
      depthWrite: false, depthTest: false, toneMapped: false,
    }));
    halo.scale.setScalar(size);
    halo.layers.set(layer);
    halo.renderOrder = order;
    group.add(halo);
    return halo;
  };
  const bloom = makeHalo(0, 3, 0.8);  // screen-blended: glows brightly on the darkened room
  const spill = makeHalo(1, 3, 0.9);  // normally blended: tints even a bright wall

  const sound = createChidoriSound();

  group.visible = false;
  let strength = 0;
  let maxOpacity = 1.0;
  let baseScale = 1;
  let soundEnabled = true;
  let flicker = 1;
  let flash = 0;          // 1 at the instant of a strobe, then fades quickly
  let aspect = 3 / 2;
  const target = new THREE.Vector3();

  video.addEventListener('loadedmetadata', () => {
    aspect = video.videoWidth / video.videoHeight;
    bolt.scale.x = aspect;
  });

  return {
    group, video,
    // Called from the Start click, which is what lets the browser play sound.
    play: () => { sound.start(); return video.play(); },
    setOpacity(value) { maxOpacity = THREE.MathUtils.clamp(value, 0.2, 1.0); },
    setSoundEnabled(value) { soundEnabled = value; if (!value) sound.silence(); },
    get intensity() { return strength; },
    get flash() { return flash * strength; }, // the room lights up with each strobe
    get active() { return strength > 0.05; },
    hide() {
      strength = 0;
      flash = 0;
      material.uniforms.opacity.value = 0;
      bloom.material.opacity = 0;
      spill.material.opacity = 0;
      sound.silence();
      group.visible = false;
    },
    update(hand, dt, time = performance.now() / 1000) {
      const wanted = Boolean(hand?.open && !hand?.closed);
      if (hand && wanted) {
        // Sit on the palm, nudged toward the fingers so it floats just above the skin.
        target.copy(hand.position);
        if (hand.direction) {
          target.x += hand.direction.x * hand.size * LIFT;
          target.y += hand.direction.y * hand.size * LIFT;
        }
        if (strength < 0.02) {
          group.position.copy(target);
          baseScale = Math.max(0.01, hand.size * SCALE);
          // Restart the clip when summoning, and strobe once so it bursts into being.
          if (video.readyState >= 1) video.currentTime = 0;
          flash = 1;
          if (soundEnabled) sound.strike();
        }
        group.position.lerp(target, 1 - Math.exp(-20 * dt));
        baseScale += (Math.max(0.01, hand.size * SCALE) - baseScale) * (1 - Math.exp(-12 * dt));
      }
      strength += ((wanted ? 1 : 0) - strength) * (1 - Math.exp(-(wanted ? 9 : 28) * dt));
      group.visible = strength > 0.01;

      // Now and then it strobes: a hard white-blue flash that also lights the room.
      if (strength > 0.3 && Math.random() < FLASH_RATE * dt) {
        flash = 1;
        if (soundEnabled) sound.strike();
      }
      flash = Math.max(0, flash - dt * 7);

      // It vibrates with power: tiny jitter, scale pulse, and wavering brightness.
      flicker += ((0.93 + Math.random() * 0.07) - flicker) * Math.min(1, dt * 30);
      const shake = 0.002 + 0.008 * flash;
      bolt.position.set(
        CORE_OFFSET_X * aspect + (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake,
        0
      );
      group.scale.setScalar(baseScale * (0.88 + 0.12 * strength) * (1 + Math.sin(time * 9) * 0.012 + flash * 0.05));

      // Solid and bright: the lightning covers the palm, and each strobe hits harder.
      material.uniforms.gain.value = GAIN + (FLASH_GAIN - GAIN) * flash;
      material.uniforms.opacity.value = strength * maxOpacity * Math.min(1, flicker + flash);
      bloom.material.opacity = Math.min(1, strength * (0.22 + 0.5 * flash) * flicker);
      spill.material.opacity = Math.min(1, strength * (0.05 + 0.12 * flash) * flicker);

      sound.update(soundEnabled ? strength : 0, dt);
    },
  };
}
