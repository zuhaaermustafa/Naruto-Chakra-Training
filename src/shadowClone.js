import * as THREE from 'three';
import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import { CloneSealTracker } from './cloneSeal.js';

// ---------- tweak these ----------
const CLONE_SPREAD = 0.34;  // how far the clones stand from you, as a fraction of the screen width
const CUT_WIDTH = 640;      // resolution of the cut-out copies (lower = faster)
const CLONE_DELAY = { left: 4, right: 8 }; // camera frames each clone lags behind you (about 30 frames per second)
const SMOKE_PUFFS = 16;     // puffs of smoke per clone
const SOUND_VOLUME = 0.5;   // volume of the poof sound, 0..1
const SEGMENTER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
// ---------------------------------

const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// A soft, shaded cloud puff drawn once into a canvas and reused for every sprite.
function makeSmokeTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    const reach = Math.random() * 62;
    const x = size / 2 + Math.cos(angle) * reach;
    const y = size / 2 + Math.sin(angle) * reach;
    const radius = 28 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // Light from the top left, a little shadow at the bottom right.
  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(0, 0, size, size);
  shade.addColorStop(0, 'rgba(255,255,255,1)');
  shade.addColorStop(1, 'rgba(160,170,185,1)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  // Fade the edges so a puff never shows a hard border.
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size / 2);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// A short "poof": a puff of filtered noise plus a soft low pop. Built live, no audio file needed.
function createPoofSound() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let enabled = true;
  return {
    // Call from a click, so the browser allows sound.
    prepare() {
      if (ctx) { ctx.resume?.(); return; }
      try {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        ctx = new AudioContextClass();
        master = ctx.createGain();
        master.gain.value = SOUND_VOLUME;
        master.connect(ctx.destination);
        noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      } catch (error) {
        console.warn('Shadow clone sound unavailable:', error);
        ctx = null;
      }
    },
    setEnabled(value) { enabled = value; },
    poof() {
      if (!ctx || !enabled) return;
      const t = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.8;
      filter.frequency.setValueAtTime(1800, t);
      filter.frequency.exponentialRampToValueAtTime(300, t + 0.55);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, t);
      noiseGain.gain.linearRampToValueAtTime(0.9, t + 0.03);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      source.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(master);
      source.start(t);
      source.stop(t + 0.7);
      const pop = ctx.createOscillator();
      pop.type = 'sine';
      pop.frequency.setValueAtTime(220, t);
      pop.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      const popGain = ctx.createGain();
      popGain.gain.setValueAtTime(0.7, t);
      popGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      pop.connect(popGain);
      popGain.connect(master);
      pop.start(t);
      pop.stop(t + 0.25);
    },
  };
}

// Shadow clone jutsu: make the seal with both hands and two copies of you step out of smoke.
// The copies are cut out of the live camera picture, so they copy every move you make.
export function createShadowClone(webcam, scene, camera) {
  const tracker = new CloneSealTracker();
  const sound = createPoofSound();

  // --- Three picture layers just above the camera: left clone, right clone, and you on top ---
  const makeLayer = () => {
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', objectFit: 'cover',
      pointerEvents: 'none', zIndex: '0', display: 'none', opacity: '0',
    });
    canvas.classList.add('stage-layer');
    return canvas;
  };
  const cloneLeft = makeLayer();
  const cloneRight = makeLayer();
  const real = makeLayer(); // your own cut-out, drawn over the clones so you always stay in front
  webcam.after(cloneLeft, cloneRight, real);
  const layers = [cloneLeft, cloneRight, real];
  const cut = document.createElement('canvas');
  const cutCtx = cut.getContext('2d', { willReadFrequently: true });
  const layerCtx = layers.map(layer => layer.getContext('2d'));

  // --- A short memory of recent cut-outs, so each clone moves a moment after you, not in lockstep ---
  const HISTORY = Math.max(CLONE_DELAY.left, CLONE_DELAY.right) + 1;
  const history = [];
  let head = -1;
  let stored = 0;
  function remember(width, height) {
    if (history.length !== HISTORY || history[0].canvas.width !== width || history[0].canvas.height !== height) {
      history.length = 0;
      for (let i = 0; i < HISTORY; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        history.push({ canvas, ctx: canvas.getContext('2d') });
      }
      head = -1;
      stored = 0;
    }
    head = (head + 1) % HISTORY;
    history[head].ctx.clearRect(0, 0, width, height);
    history[head].ctx.drawImage(cut, 0, 0);
    stored = Math.min(stored + 1, HISTORY);
  }
  // The cut-out from `frames` camera frames ago (or the oldest we have, right after the jutsu starts).
  const delayed = frames => history[(head - Math.min(frames, stored - 1) + HISTORY) % HISTORY].canvas;

  // --- Smoke ---
  const smokeTexture = makeSmokeTexture();
  const puffs = [];
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();
  function screenToWorld(x, y) {
    ndc.set(x / innerWidth * 2 - 1, 1 - y / innerHeight * 2);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }
  function spawnSmoke(screenX, screenY) {
    const center = screenToWorld(screenX, screenY);
    if (!center) return;
    const viewHeight = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const shade = 0.82 + Math.random() * 0.18;
      const material = new THREE.SpriteMaterial({
        map: smokeTexture, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
        color: new THREE.Color(shade, shade, shade * 1.02), toneMapped: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.layers.set(1); // the normally blended layer, so smoke stays white on a bright room
      sprite.renderOrder = 8;
      scene.add(sprite);
      puffs.push({
        sprite, material, age: -Math.random() * 0.18, life: 0.9 + Math.random() * 0.7,
        base: new THREE.Vector3(
          center.x + (Math.random() - 0.5) * viewHeight * 0.26,
          center.y + (Math.random() - 0.5) * viewHeight * 0.34, 0.1),
        startSize: viewHeight * (0.12 + Math.random() * 0.1),
        grow: 1.8 + Math.random() * 1.2,
        spin: (Math.random() - 0.5) * 1.2,
        drift: new THREE.Vector2((Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.5),
      });
    }
  }
  function updateSmoke(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const puff = puffs[i];
      puff.age += dt;
      if (puff.age < 0) { puff.sprite.visible = false; continue; }
      const t = puff.age / puff.life;
      if (t >= 1) {
        scene.remove(puff.sprite);
        puff.material.dispose();
        puffs.splice(i, 1);
        continue;
      }
      puff.sprite.visible = true;
      const eased = 1 - (1 - t) * (1 - t);
      puff.sprite.position.set(puff.base.x + puff.drift.x * puff.age, puff.base.y + puff.drift.y * puff.age, puff.base.z);
      puff.sprite.scale.setScalar(puff.startSize * (0.4 + puff.grow * eased));
      puff.material.rotation = puff.spin * puff.age;
      puff.material.opacity = 0.9 * Math.min(1, t / 0.12) * Math.pow(1 - t, 1.3);
    }
  }
  const clearSmoke = () => {
    for (const puff of puffs) { scene.remove(puff.sprite); puff.material.dispose(); }
    puffs.length = 0;
  };

  // --- Cutting you out of the camera picture ---
  let segmenter = null;
  let loading = null;
  let personIndex = -1;
  let invertVotes = 0;
  let voteCount = 0;
  let lastFrame = -1;

  async function load() {
    if (segmenter) return true;
    if (!loading) {
      loading = (async () => {
        try {
          const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
          const options = {
            baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
          };
          try {
            segmenter = await ImageSegmenter.createFromOptions(vision, options);
          } catch (error) {
            console.warn('Trying CPU person cut-out after GPU failed.', error);
            options.baseOptions.delegate = 'CPU';
            segmenter = await ImageSegmenter.createFromOptions(vision, options);
          }
          personIndex = segmenter.getLabels().findIndex(label => /person|foreground|selfie/i.test(label));
          invertVotes = 0;
          voteCount = 0;
        } catch (error) {
          console.warn('Person cut-out unavailable. Clones will show the whole camera picture.', error);
          segmenter = null;
        }
        loading = null;
        return Boolean(segmenter);
      })();
    }
    return loading;
  }

  // Read the model's person mask. Returns the values plus whether they need flipping.
  function readMask(result) {
    const masks = result.confidenceMasks;
    if (!masks?.length) return null;
    const index = personIndex >= 0 && personIndex < masks.length ? personIndex : (masks.length > 1 ? 1 : 0);
    const mask = masks[index];
    const values = mask.getAsFloat32Array();
    const width = mask.width;
    const height = mask.height;
    // Some models mark the person with high values, others mark the background.
    // The top corners of a camera picture are almost always wall, so use them to decide.
    if (voteCount < 12) {
      let sum = 0;
      let count = 0;
      for (let y = Math.floor(height * 0.02); y < height * 0.14; y += 3) {
        for (const x0 of [0.02, 0.86]) {
          for (let x = Math.floor(width * x0); x < width * (x0 + 0.12); x += 3) {
            sum += values[y * width + x];
            count++;
          }
        }
      }
      invertVotes += sum / Math.max(1, count) > 0.5 ? 1 : -1;
      voteCount++;
    }
    return { values, width, height, invert: invertVotes > 0 };
  }

  // Turn the person mask into transparency on the cut-out picture.
  function paintCut(mask, width, height) {
    const { values, width: maskWidth, height: maskHeight, invert } = mask;
    const image = cutCtx.getImageData(0, 0, width, height);
    const pixels = image.data;
    for (let y = 0; y < height; y++) {
      const row = Math.min(maskHeight - 1, Math.floor(y * maskHeight / height)) * maskWidth;
      for (let x = 0; x < width; x++) {
        let value = values[row + Math.min(maskWidth - 1, Math.floor(x * maskWidth / width))];
        if (invert) value = 1 - value;
        pixels[(y * width + x) * 4 + 3] = smooth(0.3, 0.7, value) * 255;
      }
    }
    cutCtx.putImageData(image, 0, 0);
  }

  // One pass per new camera frame: cut you out and redraw the clone pictures.
  function processFrame() {
    if (webcam.readyState < 2 || !webcam.videoWidth) return;
    if (webcam.currentTime === lastFrame) return; // wait for a new camera frame
    lastFrame = webcam.currentTime;
    const width = CUT_WIDTH;
    const height = Math.round(CUT_WIDTH * webcam.videoHeight / webcam.videoWidth);
    if (cut.width !== width || cut.height !== height) {
      cut.width = width;
      cut.height = height;
      for (const layer of layers) { layer.width = width; layer.height = height; }
    }
    cutCtx.clearRect(0, 0, width, height);
    cutCtx.drawImage(webcam, 0, 0, width, height);
    if (segmenter) {
      try {
        segmenter.segmentForVideo(webcam, performance.now(), result => {
          const mask = readMask(result);
          if (!mask) return;
          paintCut(mask, width, height);
        });
      } catch (error) {
        console.warn('Person cut-out failed for one frame.', error);
      }
    }
    remember(width, height);
    // Each clone shows you a few frames ago; the real you, on top, is always live.
    layerCtx[0].clearRect(0, 0, width, height);
    layerCtx[0].drawImage(delayed(CLONE_DELAY.left), 0, 0);
    layerCtx[1].clearRect(0, 0, width, height);
    layerCtx[1].drawImage(delayed(CLONE_DELAY.right), 0, 0);
    layerCtx[2].clearRect(0, 0, width, height);
    layerCtx[2].drawImage(cut, 0, 0);
  }

  // --- Showing and hiding the clones ---
  let visible = false;
  let hideTimer = 0;
  const spread = () => innerWidth * CLONE_SPREAD;
  const pose = (x, shown) => `translateX(${x}px) scaleX(-1)${shown ? '' : ' scale(0.9)'}`;
  function applyLayout(shown) {
    const dx = spread();
    cloneLeft.style.transform = pose(-dx * (shown ? 1 : 0.35), shown);
    cloneRight.style.transform = pose(dx * (shown ? 1 : 0.35), shown);
    real.style.transform = 'scaleX(-1)';
    cloneLeft.style.opacity = cloneRight.style.opacity = shown ? '1' : '0';
    real.style.opacity = shown && segmenter ? '1' : '0';
  }
  function showClones() {
    clearTimeout(hideTimer);
    visible = true;
    stored = 0;
    for (const layer of layers) { layer.style.transition = 'none'; layer.style.display = 'block'; }
    // Without the person cut-out, fade the whole picture out at the edges instead of showing a hard box.
    const feather = segmenter ? '' : 'radial-gradient(ellipse 38% 60% at 50% 58%, #000 60%, transparent 100%)';
    for (const layer of [cloneLeft, cloneRight]) layer.style.maskImage = layer.style.webkitMaskImage = feather;
    applyLayout(false);
    void cloneLeft.offsetWidth; // let the browser register the starting pose
    for (const layer of layers) {
      layer.style.transition = 'opacity .35s ease .15s, transform .5s cubic-bezier(.2,.9,.2,1) .1s';
    }
    applyLayout(true);
  }
  function hideClones(immediately = false) {
    clearTimeout(hideTimer);
    if (immediately) {
      visible = false;
      for (const layer of layers) { layer.style.transition = 'none'; layer.style.display = 'none'; layer.style.opacity = '0'; }
      return;
    }
    for (const layer of layers) layer.style.transition = 'opacity .3s ease, transform .35s ease';
    applyLayout(false);
    hideTimer = setTimeout(() => {
      visible = false;
      for (const layer of layers) layer.style.display = 'none';
    }, 450);
  }
  addEventListener('resize', () => { if (tracker.active) applyLayout(true); });

  const smokeSpots = () => [[innerWidth / 2 - spread(), innerHeight * 0.58], [innerWidth / 2 + spread(), innerHeight * 0.58]];

  return {
    load,
    // Call from the Start click, so the poof sound is allowed.
    prepare: () => sound.prepare(),
    setSoundEnabled: value => sound.setEnabled(value),
    get active() { return tracker.active; },
    get holdProgress() { return tracker.progress; },
    // True while the seal is being shown. Used to keep other jutsu from reacting to the same hands.
    get sealing() { return tracker.sealing; },
    get tracker() { return tracker; },
    // hands: the list from detectHands. Call once per frame.
    update(hands, dt) {
      const event = tracker.step(hands, dt);
      if (event === 'summon' || event === 'dispel') {
        for (const [x, y] of smokeSpots()) spawnSmoke(x, y);
        sound.poof();
        if (event === 'summon') showClones(); else hideClones();
      }
      if (visible) processFrame();
      updateSmoke(dt);
    },
    // Remove the clones at once (used when stopping).
    reset() {
      tracker.reset();
      hideClones(true);
      clearSmoke();
    },
    close() {
      segmenter?.close();
      segmenter = null;
      loading = null;
    },
  };
}
