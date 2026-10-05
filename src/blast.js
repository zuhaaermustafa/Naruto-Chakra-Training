// The Rasengan impact: a layered synthesized explosion that is audible on laptop speakers.
// Earlier versions were mostly sub-bass and quiet noise, which small speakers cannot play,
// so the blast seemed silent. This one has a loud mid-range body and a sharp crack on top,
// with the deep bass kept underneath for headphones and desktop speakers.
//
// Layers: crack · distorted thump · noise body that sweeps down · sub bass · flying debris · room tail.

export function makeNoise(ctx, seconds = 3) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// A short decaying noise burst used as a room response, so the blast has a tail.
const impulses = new WeakMap();
function roomImpulse(ctx) {
  if (impulses.has(ctx)) return impulses.get(ctx);
  const length = Math.ceil(ctx.sampleRate * 2.2);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
  }
  impulses.set(ctx, buffer);
  return buffer;
}

// tanh curve: adds harmonics so the thump is heard on speakers that cannot reproduce deep bass.
function saturation(ctx, amount = 4) {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * amount);
  shaper.curve = curve;
  return shaper;
}

// Plays the blast into `destination` starting at `when`.
// `track(source)` is called for every source so the caller can stop them early.
export function playBlast(ctx, destination, noise, when = ctx.currentTime, track = () => {}) {
  const t = when;
  const bus = ctx.createGain();
  bus.gain.value = 0.4;
  const dry = ctx.createGain(); dry.gain.value = 0.9;
  const wet = ctx.createGain(); wet.gain.value = 0.32;
  const room = ctx.createConvolver(); room.buffer = roomImpulse(ctx);
  bus.connect(dry); dry.connect(destination);
  bus.connect(room); room.connect(wet); wet.connect(destination);
  const nodes = [bus, dry, wet, room];
  let ended = 0;
  let total = 0;

  function voice(source, chain, peak, attack, duration, start = t) {
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    let tail = source;
    for (const node of chain) { tail.connect(node); tail = node; nodes.push(node); }
    tail.connect(envelope); envelope.connect(bus);
    nodes.push(envelope);
    total++;
    track(source);
    source.onended = () => {
      source.disconnect();
      // Free everything once the last voice has finished (the room tail needs a moment longer).
      if (++ended === total) setTimeout(() => nodes.forEach(node => { try { node.disconnect(); } catch {} }), 2600);
    };
    source.start(start);
    source.stop(start + duration + 0.05);
  }
  const noiseSource = () => { const s = ctx.createBufferSource(); s.buffer = noise; return s; };
  const filter = (type, frequency, q = 0.7) => {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = q; return f;
  };

  // 1. Crack: the sharp first instant, bright and loud.
  voice(noiseSource(), [filter('highpass', 2200)], 1.0, 0.002, 0.11);
  voice(noiseSource(), [filter('bandpass', 5200, 0.9)], 0.7, 0.002, 0.07);

  // 2. Thump: a falling tone pushed through saturation so it has body in the mid-range.
  const thump = ctx.createOscillator(); thump.type = 'sine';
  thump.frequency.setValueAtTime(210, t);
  thump.frequency.exponentialRampToValueAtTime(52, t + 0.32);
  voice(thump, [saturation(ctx, 5)], 1.0, 0.004, 0.75);

  // 3. Body: a wall of noise whose brightness collapses as the fireball expands.
  const body = noiseSource();
  const bodyFilter = filter('lowpass', 7000, 0.8);
  bodyFilter.frequency.setValueAtTime(7000, t);
  bodyFilter.frequency.exponentialRampToValueAtTime(170, t + 2.0);
  voice(body, [bodyFilter], 0.95, 0.008, 2.4);

  // 4. Sub: deep weight for headphones and desktop speakers.
  const sub = ctx.createOscillator(); sub.type = 'sine';
  sub.frequency.setValueAtTime(74, t);
  sub.frequency.exponentialRampToValueAtTime(36, t + 0.9);
  voice(sub, [], 0.6, 0.012, 1.1);

  // 5. Debris: short crackles scattered over the first second and a half.
  for (let i = 0; i < 16; i++) {
    const at = t + 0.1 + Math.pow(Math.random(), 1.4) * 1.3;
    const grain = noiseSource();
    const f = filter('bandpass', 500 + Math.random() * 3800, 3);
    voice(grain, [f], 0.38 * (1 - (at - t) / 1.6), 0.002, 0.03 + Math.random() * 0.05, at);
  }
}
