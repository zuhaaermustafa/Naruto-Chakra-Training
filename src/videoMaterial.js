import * as THREE from 'three';

// Hand effects emit light through screen blending; the explosion uses alpha keying.
export function createVideoMaterial(video, brightness = 1, luminous = false) {
  const texture = new THREE.VideoTexture(video);
  // Our shader outputs the video's display colours directly; don't convert twice.
  texture.colorSpace = THREE.NoColorSpace;
  return new THREE.ShaderMaterial({
    uniforms: {
      clip: { value: texture },
      opacity: { value: 0 },
      brightness: { value: brightness },
      luminous: { value: luminous },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D clip;
      uniform float opacity;
      uniform float brightness;
      uniform bool luminous;
      varying vec2 vUv;
      void main() {
        vec3 color = texture2D(clip, vUv).rgb;
        float strongestChannel = max(color.r, max(color.g, color.b));
        // Only the dark fringe is translucent. The bright orb stays solid.
        float alpha = smoothstep(0.015, 0.18, strongestChannel) * opacity;
        if (luminous) {
          // Screen blending uses black as zero light. Premultiply once for fading.
          gl_FragColor = vec4(min(color * brightness, vec3(1.0)) * opacity, opacity);
          return;
        }
        gl_FragColor = vec4(min(color * brightness, vec3(1.0)), alpha);
      }
    `,
    transparent: true,
    // Match screen blending between overlapping effects inside the canvas too.
    blending: luminous ? THREE.CustomBlending : THREE.NormalBlending,
    blendSrc: THREE.OneMinusDstColorFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
}

// A separate, normally blended core keeps room details from showing through it.
// Reuse the glow's video texture so this does not upload the same clip twice.
export function createEnergyCoreMaterial(glow, lightning = false) {
  return new THREE.ShaderMaterial({
    uniforms: {
      clip: glow.uniforms.clip,
      opacity: { value: 0 },
      lightning: { value: lightning },
    },
    vertexShader: glow.vertexShader,
    fragmentShader: `
      uniform sampler2D clip;
      uniform float opacity;
      uniform bool lightning;
      varying vec2 vUv;
      void main() {
        vec3 color = texture2D(clip, vUv).rgb;
        float light = max(color.r, max(color.g, color.b));
        if (lightning) {
          // Key the whole bolt, including its thin branches, by brightness.
          float a = smoothstep(0.10, 0.55, light);
          // Restore full-strength colour so the branches stay vivid on a bright room.
          vec3 hue = color / max(light, 0.001);
          vec3 bolt = mix(hue, vec3(1.0), smoothstep(0.72, 1.0, light));
          gl_FragColor = vec4(bolt, a * opacity);
          return;
        }
        // Dark outer pixels never become an opaque fringe.
        float mask = smoothstep(0.30, 0.72, light);
        float radius = length(vUv - 0.5);
        mask *= 1.0 - smoothstep(0.30, 0.43, radius);
        gl_FragColor = vec4(color, mask * opacity);
      }
    `,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.NormalBlending, toneMapped: false,
  });
}

// Shows a glow-on-black clip exactly as filmed, over a bright camera picture.
// Brightness becomes opacity and the colour is "un-multiplied", so over a black
// background it looks identical to the original video, and over a bright wall the
// bolt stays vivid instead of washing out like screen blending does.
export function createLuminanceKeyMaterial(video, gain = 1.2) {
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.NoColorSpace;
  return new THREE.ShaderMaterial({
    uniforms: {
      clip: { value: texture },
      opacity: { value: 0 },
      gain: { value: gain },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D clip;
      uniform float opacity;
      uniform float gain;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(clip, vUv).rgb;
        float light = max(c.r, max(c.g, c.b));
        // Ignore video-compression noise in the black background.
        float noiseFloor = smoothstep(0.0, 0.08, light);
        float a = clamp(light * gain, 0.0, 1.0) * noiseFloor;
        vec3 color = clamp(c / max(light, 0.001), 0.0, 1.0);
        gl_FragColor = vec4(color, a * opacity);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
}