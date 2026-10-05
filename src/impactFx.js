import * as THREE from 'three';

// The "weight" of a Rasengan hit: the picture freezes for a moment (like an anime hit-stop) under
// a white flash, then the whole view punches in, shakes, and a shockwave ring rolls outward.

// ---------- tweak these ----------
const HIT_STOP = 0.1;        // seconds the picture freezes on impact
const SHAKE_PIXELS = 34;     // strongest shake, in pixels
const SHAKE_TILT = 1.6;      // strongest tilt, in degrees
const SHAKE_DECAY = 1.5;     // how fast the shake dies (per second). Lower = longer shake
const PUNCH = 0.07;          // extra zoom at the moment of impact (0.07 = 7%)
const FLASH = 0.8;           // opacity of the white flash, 0..1
const RING_SECONDS = 0.8;    // how long the shockwave takes to cross the screen
// ---------------------------------

export function createImpactFx(setup, webcam) {
  const { impactScene, camera } = setup;

  // A copy of the camera frame, shown for the length of the hit-stop.
  const freeze = document.createElement('canvas');
  freeze.id = 'hit-freeze';
  webcam.after(freeze);
  const flash = document.createElement('div');
  flash.id = 'hit-flash';
  document.body.appendChild(flash);

  // Shockwave: a full-screen shader drawing two expanding rings (bright leading edge, soft trail).
  const ringMaterial = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uAspect: { value: camera.aspect } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uT;
      uniform float uAspect;
      varying vec2 vUv;
      // Sharp on the outside, a long soft trail on the inside. Returns 0..1 across the band.
      float band(float d, float r, float w) {
        return smoothstep(r - w, r, d) * (1.0 - smoothstep(r, r + w * 0.22, d));
      }
      // A thin dark edge just outside the bright front, so the ring stands out on the fireball.
      float rimOf(float d, float r, float w) {
        return smoothstep(r + w * 0.1, r + w * 0.14, d) * (1.0 - smoothstep(r + w * 0.14, r + w * 0.34, d));
      }
      void main() {
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
        float d = length(p);
        float reach = length(vec2(uAspect, 1.0)) * 1.15;
        float e1 = 1.0 - pow(1.0 - uT, 3.0);
        float t2 = clamp((uT - 0.1) / 0.9, 0.0, 1.0);
        float e2 = 1.0 - pow(1.0 - t2, 3.0);
        float w1 = mix(0.34, 0.07, uT);
        float w2 = mix(0.16, 0.04, t2);
        float b1 = band(d, e1 * reach, w1);
        float b2 = band(d, e2 * reach, w2) * step(0.001, t2);
        float fade = pow(1.0 - uT, 1.4);
        // The trail is deep blue so the ring reads on a bright room; the front edge is white.
        vec3 trail = vec3(0.12, 0.4, 1.0);
        float front1 = smoothstep(e1 * reach - w1 * 0.25, e1 * reach, d);
        float front2 = smoothstep(e2 * reach - w2 * 0.3, e2 * reach, d);
        vec3 c1 = mix(trail, vec3(1.0), front1);
        vec3 c2 = mix(trail, vec3(0.85, 0.95, 1.0), front2);
        float core = exp(-d * d * 7.0) * (1.0 - smoothstep(0.0, 0.22, uT));
        vec3 colour = (c1 * b1 + c2 * b2 * 0.7 + vec3(1.0) * core) / max(b1 + b2 * 0.7 + core, 0.0001);
        float ringA = clamp((b1 * 0.95 + b2 * 0.55) * fade + core, 0.0, 1.0);
        float rimA = clamp((rimOf(d, e1 * reach, w1) + rimOf(d, e2 * reach, w2) * 0.6) * fade * 0.8, 0.0, 1.0) * step(0.001, uT);
        float a = ringA + rimA * (1.0 - ringA);
        vec3 rimColour = vec3(0.03, 0.06, 0.2);
        gl_FragColor = vec4((colour * ringA + rimColour * rimA * (1.0 - ringA)) / max(a, 0.0001), a);
      }
    `,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMaterial);
  ring.frustumCulled = false;
  ring.renderOrder = 11; // above the explosion clip
  ring.visible = false;
  impactScene.add(ring);

  let freezeLeft = 0;
  let resume = null;
  let trauma = 0;
  let shakeTime = 0;
  let ringTime = -1;
  let targets = [];
  let enabled = true;

  function clearShake() {
    for (const element of targets) { element.style.translate = ''; element.style.rotate = ''; element.style.scale = ''; }
  }

  // The freeze is over: shake, punch in and send the ring out.
  function release() {
    freeze.style.display = 'none';
    trauma = 1;
    ringTime = 0;
    ring.visible = true;
    const call = resume;
    resume = null;
    call?.();
  }

  return {
    // Call the instant the explosion appears. `pause` stops the explosion clip on its first frame,
    // `resume` lets it go again when the hit-stop ends. Does nothing while switched off.
    hit({ pause, resume: onResume } = {}) {
      if (!enabled) return;
      clearShake();
      targets = [...document.querySelectorAll('#webcam, #hit-freeze, #three-canvas, #impact-canvas, #chakra-atmosphere, .stage-layer')];
      if (webcam.videoWidth) {
        freeze.width = webcam.videoWidth;
        freeze.height = webcam.videoHeight;
        freeze.getContext('2d').drawImage(webcam, 0, 0);
        freeze.style.display = 'block';
      }
      flash.style.transition = 'none';
      flash.style.opacity = String(FLASH);
      void flash.offsetWidth;
      flash.style.transition = 'opacity .38s ease-out';
      flash.style.opacity = '0';
      freezeLeft = HIT_STOP;
      resume = onResume;
      pause?.();
    },

    // Call once per frame. Returns true while the picture is frozen: skip the game update then.
    update(dt) {
      if (freezeLeft > 0) {
        freezeLeft -= dt;
        if (freezeLeft > 0) return true;
        release();
      }
      if (ringTime >= 0) {
        ringTime += dt / RING_SECONDS;
        if (ringTime >= 1) { ringTime = -1; ring.visible = false; }
        else {
          ringMaterial.uniforms.uT.value = ringTime;
          ringMaterial.uniforms.uAspect.value = camera.aspect;
        }
      }
      if (trauma > 0) {
        trauma = Math.max(0, trauma - SHAKE_DECAY * dt);
        shakeTime += dt;
        const power = trauma * trauma;
        const x = (Math.sin(shakeTime * 61) * 0.6 + Math.sin(shakeTime * 37 + 1) * 0.4) * power * SHAKE_PIXELS;
        const y = (Math.sin(shakeTime * 47 + 2) * 0.6 + Math.sin(shakeTime * 29 + 4) * 0.4) * power * SHAKE_PIXELS;
        const tilt = Math.sin(shakeTime * 43 + 3) * power * SHAKE_TILT;
        // Zoom in enough that the moving edges never show a gap.
        const cover = (SHAKE_PIXELS * 1.3) / (innerHeight / 2);
        const scale = 1 + power * (PUNCH + cover);
        for (const element of targets) {
          element.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
          element.style.rotate = `${tilt.toFixed(2)}deg`;
          element.style.scale = scale.toFixed(4);
        }
        if (trauma === 0) clearShake();
      }
      return false;
    },

    // Settings switch: false turns the freeze, flash, shake and ring off.
    setEnabled(value) { enabled = Boolean(value); if (!enabled) this.reset(); },

    // Cancel everything at once (used when stopping or switching hands).
    reset() {
      freezeLeft = 0;
      resume = null;
      trauma = 0;
      ringTime = -1;
      ring.visible = false;
      freeze.style.display = 'none';
      flash.style.transition = 'none';
      flash.style.opacity = '0';
      clearShake();
    },
  };
}
