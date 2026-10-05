import * as THREE from 'three';

// One shared atmosphere prevents two active hands from stacking dark filters.
export function createAtmosphere(camera) {
  const root = document.createElement('div');
  root.id = 'chakra-atmosphere';
  root.setAttribute('aria-hidden', 'true');
  const shade = document.createElement('div');
  shade.className = 'chakra-shade';
  const storm = document.createElement('div');
  storm.className = 'chakra-storm';
  const wind = document.createElement('div');
  wind.className = 'chakra-light wind-light';
  const lightning = document.createElement('div');
  lightning.className = 'chakra-light lightning-light';
  root.append(shade, storm, wind, lightning);
  document.body.appendChild(root);
  const projected = new THREE.Vector3();
  let windLevel = 0, lightningLevel = 0;
  function place(element, group, level, radius) {
    projected.copy(group.position).project(camera);
    element.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
    element.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
    const viewHeight = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const size = Math.min(innerHeight * 0.8, Math.max(100, group.scale.x / viewHeight * innerHeight * radius));
    element.style.width = element.style.height = `${size}px`;
    element.style.opacity = String(level);
  }
  return {
    reset() {
      windLevel = lightningLevel = 0;
      shade.style.opacity = storm.style.opacity = wind.style.opacity = lightning.style.opacity = '0';
    },
    update(rasengan, chidori, charge, dt) {
      const ease = 1 - Math.exp(-5 * dt);
      windLevel += (charge - windLevel) * ease;
      lightningLevel += (chidori.intensity - lightningLevel) * ease;
      // Dark edges create contrast while the middle of the camera stays readable.
      shade.style.opacity = String(Math.min(0.62, Math.max(windLevel, lightningLevel) * 0.58));
      // Each Chidori strobe briefly lifts the darkness and brightens the blue light around the palm.
      const flash = chidori.flash;
      storm.style.opacity = String(lightningLevel * 0.55 * (1 - 0.7 * flash));
      place(wind, rasengan.group, windLevel * 0.22, 3.4);
      place(lightning, chidori.group, lightningLevel * 0.18 + flash * 0.3, 1.4 + flash * 0.8);
    },
  };
}
