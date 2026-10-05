import * as THREE from 'three';

// A soft round gradient, e.g. [[0, 'rgba(255,255,255,1)'], [1, 'rgba(0,100,255,0)']]
export function makeGlowTexture(stops) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Thin glowing ribbons (wind streaks, lightning bolts, spark trails).
// Every ribbon is a strip of `points` points. Call set() to place a ribbon,
// then commit() once per frame. Normal blending keeps them visible on a bright room.
export function createRibbons(count, points, color = 0x2fb2ff) {
  const vertices = count * points * 2;
  const positions = new Float32Array(vertices * 3);
  const alphas = new Float32Array(vertices);
  const sides = new Float32Array(vertices);
  for (let v = 0; v < vertices; v++) sides[v] = v % 2 === 0 ? -1 : 1;

  const indices = [];
  for (let r = 0; r < count; r++) {
    for (let j = 0; j < points - 1; j++) {
      const a = (r * points + j) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `
      attribute float aAlpha;
      attribute float aSide;
      varying float vAlpha;
      varying float vSide;
      void main() {
        vAlpha = aAlpha;
        vSide = aSide;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      varying float vSide;
      void main() {
        // 1 in the middle of the ribbon, 0 at its edges
        float e = 1.0 - abs(vSide);
        vec3 c = mix(uColor, vec3(1.0), pow(e, 3.0));
        gl_FragColor = vec4(c, vAlpha * smoothstep(0.0, 0.55, e));
      }
    `,
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    // xs, ys, widths, alphas each have `points` entries
    set(ribbon, xs, ys, z, widths, alphaValues) {
      for (let j = 0; j < points; j++) {
        const before = Math.max(j - 1, 0);
        const after = Math.min(j + 1, points - 1);
        const tx = xs[after] - xs[before];
        const ty = ys[after] - ys[before];
        const length = Math.hypot(tx, ty) || 1;
        const nx = -ty / length;
        const ny = tx / length;
        const half = widths[j] * 0.5;
        const v = (ribbon * points + j) * 2;
        positions[v * 3] = xs[j] + nx * half;
        positions[v * 3 + 1] = ys[j] + ny * half;
        positions[v * 3 + 2] = z;
        positions[(v + 1) * 3] = xs[j] - nx * half;
        positions[(v + 1) * 3 + 1] = ys[j] - ny * half;
        positions[(v + 1) * 3 + 2] = z;
        alphas[v] = alphas[v + 1] = alphaValues[j];
      }
    },
    clear(ribbon) {
      const start = ribbon * points * 2;
      alphas.fill(0, start, start + points * 2);
    },
    commit() {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
    },
  };
}