// Connect camera tracking, charge timing, the flying orb and the impact clip.
import './style.css';
import { createAtmosphere } from './atmosphere.js';
import { createRasenganSound } from './rasenganSound.js';
import * as THREE from 'three';
import { createThreeSetup } from './threeSetup.js';
import { createRasengan } from './rasengan.js';
import { createChidori } from './chidori.js';
import { createShadowClone } from './shadowClone.js';
import { createImpactFx } from './impactFx.js';
import { createIntroFx } from './introFx.js';
import { assignHandRoles } from './handRoles.js';
import { createExplosion } from './explosion.js';
import { createWebcam, startCamera, stopCamera } from './webcam.js';
import { loadHandTracking, detectHands, closeHandTracking } from './handTracking.js';
import { RasenganSequence, FLIGHT_SECONDS } from './sequence.js';
import { createUI } from './ui.js';

// --- Settings and state ---
const ORB_SIZE = 1.4;
const ORB_LIFT = 0.9;
const webcam = createWebcam();
const sequence = new RasenganSequence();
const shotStart = new THREE.Vector3();
let setup, effect, explosion, chidori, atmosphere, clones, fx;
const rasenganSound = createRasenganSound();
let soundEnabled = true;
let swapped = false;
let running = false;
let smoothSize = 1;
let shotSize = 1;
let previousTime = performance.now();
let generation = 0;
let wasClones = false;
let impactOn = true;

// A title card shows once its palm has been open for CARD_CONFIRM seconds, so a one-frame
// tracking flicker or a mislabelled hand never pops one up. It can show again after the palm has
// been closed (or the jutsu finished) for CARD_REARM seconds.
const CARD_CONFIRM = 0.25;
const CARD_REARM = 0.4;
const cards = { rasengan: { held: 0, off: 0, shown: false }, chidori: { held: 0, off: 0, shown: false } };
function confirmCard(name, on, dt) {
  const card = cards[name];
  if (on) {
    card.off = 0;
    card.held += dt;
    if (!card.shown && card.held >= CARD_CONFIRM) { card.shown = true; ui.callout(name); }
  } else {
    card.held = 0;
    card.off += dt;
    if (card.off >= CARD_REARM) card.shown = false;
  }
}

createIntroFx(document.querySelector('#intro'));
const ui = createUI({
  start,
  toggleSound,
  toggleSwap,
  rasenganGlow: value => effect?.setOpacity(value),
  chidoriGlow: value => chidori?.setOpacity(value),
  impactEffects: value => { impactOn = value; fx?.setEnabled(value); },
});

// --- Error handling and cleanup ---
function stop() {
  generation++;
  running = false;
  sequence.reset();
  effect?.hide();
  chidori?.hide();
  effect?.video.pause();
  chidori?.video.pause();
  explosion?.hide();
  atmosphere?.reset();
  rasenganSound.silence();
  clones?.reset();
  clones?.close();
  fx?.reset();
  stopCamera(webcam);
  closeHandTracking();
  ui.setSeal(0, false);
  wasClones = false;
  for (const card of Object.values(cards)) { card.held = 0; card.off = 0; card.shown = false; }
  ui.setBadges({ rasengan: false, chidori: false, clone: false, charge: 0 });
}
function showError(error) {
  console.error(error);
  stop();
  const messages = {
    NotAllowedError: 'Camera or playback blocked. Allow camera access, then retry.',
    NotFoundError: 'No camera found. Connect a camera, then retry.',
    NotReadableError: 'Camera unavailable. Close other apps using it, then retry.',
  };
  ui.showIntro({
    message: messages[error.name] || `Could not start: ${error.message}`,
    button: 'Try again',
    error: true,
  });
}

// --- Start all media from the button click ---
async function start() {
  const currentGeneration = ++generation;
  try {
    ui.setLoading(1, 'Starting the camera…');
    if (!setup) setup = createThreeSetup();
    if (!effect) {
      effect = createRasengan();
      setup.scene.add(effect.group);
      effect.setOpacity(ui.glow);
      chidori = createChidori();
      setup.scene.add(chidori.group);
      chidori.setOpacity(ui.chidoriGlow);
      atmosphere = createAtmosphere(setup.camera);
      chidori.setSoundEnabled(soundEnabled);
      clones = createShadowClone(webcam, setup.scene, setup.camera);
      clones.setSoundEnabled(soundEnabled);
      explosion = createExplosion(setup.impactScene, setup.camera);
      fx = createImpactFx(setup, webcam);
      fx.setEnabled(impactOn);
      for (const video of [effect.video, chidori.video, explosion.video]) {
        video.addEventListener('error', () => showError(new Error('An effect video could not load. Check the MP4 files in src/assets.')));
      }
    }
    rasenganSound.start();
    clones.prepare();
    const results = await Promise.allSettled([effect.play(), chidori.play(), explosion.prime(), startCamera(webcam)]);
    if (currentGeneration !== generation) { stopCamera(webcam); return; }
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    ui.setLoading(2, 'Loading hand tracking…');
    await loadHandTracking();
    if (currentGeneration !== generation) { closeHandTracking(); return; }
    ui.setLoading(3, 'Preparing the clones…');
    await clones.load(); // optional: if it fails, the clones still appear, just uncut
    if (currentGeneration !== generation) { closeHandTracking(); clones.close(); return; }
    sequence.reset();
    running = true;
    ui.setStatus('Open your right palm to charge a Rasengan.');
    ui.hideIntro();
  } catch (error) {
    showError(error);
  }
}

// --- Charge, launch, impact, then wait for another open palm ---
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  if (!setup || !effect) return;
  // The impact freezes the picture for a few frames; shake and the shockwave keep running after it.
  const frozen = fx?.update(dt) ?? false;
  if (running && !frozen) {
    try {
      const hands = detectHands(webcam, setup.camera);
      // Shadow clones use both hands, so check them before the orb lift moves a hand.
      clones.update(hands, dt);
      // While the seal is shown, Rasengan and Chidori ignore those hands: the seal looks like
      // the launch pose, and crossing hands must not set off a second jutsu.
      const roles = clones.sealing ? { rasengan: null, chidori: null } : assignHandRoles(hands, swapped);
      const hand = roles.rasengan;
      // Rasengan floats above the palm. Chidori gathers directly around the other palm.
      if (hand) hand.position.y += hand.size * ORB_LIFT;
      chidori.update(roles.chidori, dt, now / 1000);
      const event = sequence.step(hand, dt, explosion.video.ended);
      if (event === 'charge' && hand) {
        effect.restart();
        effect.group.position.copy(hand.position);
        smoothSize = hand.size * ORB_SIZE;
      }
      if (event === 'launch') {
        // Copy the starting point once. The projectile stops following the hand.
        shotStart.copy(effect.group.position);
        shotSize = smoothSize;
      }
      if (event === 'impact') {
        effect.hide();
        explosion.play().then(() => {
          if (!running || sequence.phase !== 'blast') return;
          rasenganSound.impact();
          // Hit-stop: hold the explosion on its first frame, then let it play.
          fx.hit({
            pause: () => explosion.video.pause(),
            resume: () => { if (running && sequence.phase === 'blast') explosion.video.play().catch(() => {}); },
          });
        }).catch(showError);
      }
      if (event === 'blast-end') explosion.hide();

      const phase = sequence.phase;
      if (phase === 'charging' || phase === 'ready') {
        if (hand) {
          effect.group.position.lerp(hand.position, 1 - Math.exp(-18 * dt));
          smoothSize += (hand.size * ORB_SIZE - smoothSize) * (1 - Math.exp(-12 * dt));
        }
        effect.group.scale.setScalar(Math.max(0.01, smoothSize));
        effect.update(sequence.charge, now / 1000);
        ui.setStatus(phase === 'charging'
          ? 'Charging… keep your palm open'
          : 'Ready. Point two fingers at the camera.');
      } else if (phase === 'flying') {
        const t = Math.min(sequence.age / FLIGHT_SECONDS, 1);
        const travel = t * t;
        // Approach the virtual camera while moving toward the screen centre.
        effect.group.position.set(shotStart.x * (1 - travel), shotStart.y * (1 - travel), travel * 3.8);
        effect.group.scale.setScalar(shotSize * (1 + travel * 0.65));
        effect.update(1, now / 1000);
        ui.setStatus('Rasengan!');
      } else {
        effect.hide();
        ui.setStatus(phase === 'blast' ? 'Direct hit!'
          : phase === 'cooldown' ? 'Open your right palm to go again.'
          : (chidori.active ? 'Chidori!' : 'Open a palm, or cross your hands.'));
      }
      if (chidori.active && phase === 'ready') ui.setStatus('Wind and lightning, both at once.');
      if (clones.holdProgress > 0.1 && !clones.active) ui.setStatus('Hold the seal…');
      else if (clones.active && phase === 'idle' && !chidori.active) ui.setStatus('Shadow clones! Cross your hands again to dispel.');
      // Title cards for the two palm jutsu appear when the open palm is confirmed.
      confirmCard('rasengan', phase === 'charging' || phase === 'ready', dt);
      confirmCard('chidori', Boolean(roles.chidori?.open && !roles.chidori?.closed) && chidori.active, dt);
      if (clones.active !== wasClones) { ui.callout(clones.active ? 'clone' : 'dispel'); wasClones = clones.active; }
      const rasenganActive = ['charging', 'ready', 'flying'].includes(phase);
      ui.setBadges({ rasengan: rasenganActive, chidori: chidori.active, clone: clones.active,
        charge: rasenganActive ? (phase === 'flying' ? 1 : sequence.charge) : 0 });
      ui.setSeal(clones.holdProgress, clones.sealing && !clones.active);
      ui.renderDebug(hands, clones.tracker);
      const windPower = phase === 'flying' ? 1 : ['charging', 'ready'].includes(phase) ? sequence.charge : 0;
      atmosphere.update(effect, chidori, windPower, dt);
      rasenganSound.update(phase, sequence.charge);
      explosion.update();
    } catch (error) {
      showError(error);
    }
  }
  // Glow is screened over the webcam; cores use normal blending for contrast.
  setup.camera.layers.set(0);
  setup.renderer.render(setup.scene, setup.camera);
  setup.camera.layers.set(1);
  setup.impactRenderer.render(setup.scene, setup.camera);
  setup.camera.layers.set(0);
  setup.impactRenderer.autoClear = false;
  setup.impactRenderer.render(setup.impactScene, setup.camera);
  setup.impactRenderer.autoClear = true;
}
requestAnimationFrame(animate);

// Stop the camera when leaving, and offer a fresh start after browser Back.
window.addEventListener('pagehide', stop);
window.addEventListener('pageshow', event => {
  if (event.persisted) ui.showIntro({ message: 'Make the signs. Your hands are the controller.' });
});

// Camera/model conventions can reverse hand labels. This switches assignments only.
function toggleSwap() {
  swapped = !swapped;
  ui.setSwapped(swapped);
  sequence.reset();
  effect?.hide();
  chidori?.hide();
  explosion?.hide();
  atmosphere?.reset();
  fx?.reset();
  rasenganSound.silence();
}

// Sound is optional; visuals and gestures continue while muted.
function toggleSound() {
  soundEnabled = !soundEnabled;
  ui.setSound(soundEnabled);
  rasenganSound.setEnabled(soundEnabled);
  chidori?.setSoundEnabled(soundEnabled);
  clones?.setSoundEnabled(soundEnabled);
}

// Avoid audio continuing from a hidden tab. Returning requires the Start button.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) {
    stop();
    ui.showIntro({ message: 'Paused while the tab was hidden.', button: 'Resume' });
  }
});
