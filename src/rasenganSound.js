import windURL from './assets/rasengan-wind.wav';
import { playBlast } from './blast.js';

// ---------- tweak these ----------
const WIND_VOLUME = 0.9;      // loudness of the Rasengan wind, 0..1
const WIND_LOOP_START = 3.25; // seconds into the file where the swell ends and the steady swirl repeats
const FLIGHT_PITCH = 1.15;    // the wind rises in pitch (1 = unchanged) once the orb is launched
// ---------------------------------

// The charging wind comes from After_Effects_Animated_Rasengan.mp4: a swell that peaks and
// settles into a seamless loop (src/assets/rasengan-wind.wav, extracted from that video).
// If the file cannot load, the original synthesized wind plays instead.
// The impact blast is synthesized (see blast.js), because that clip has no blast in it.
export function createRasenganSound() {
  let ctx, master, filter, hum, swirl, overtone, output, blastBus, noiseBuffer;
  let windBuffer = null;   // the decoded wind sample
  let windVoice = null;    // { source, gain } while the sample is playing
  let enabled = true;
  const shots = new Set();
  function stopShots() {
    for (const source of shots) { try { source.stop(); } catch {} }
    shots.clear();
  }
  // Each play gets its own gain node, so a quick restart never overlaps the fading one.
  function startWind() {
    const source = ctx.createBufferSource();
    source.buffer = windBuffer;
    source.loop = true;
    source.loopStart = Math.min(WIND_LOOP_START, Math.max(0, windBuffer.duration - 0.5));
    source.loopEnd = windBuffer.duration;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(output);
    source.start();
    windVoice = { source, gain };
  }
  function stopWind() {
    if (!windVoice || !ctx) return;
    const { source, gain } = windVoice;
    windVoice = null;
    const t = ctx.currentTime;
    gain.gain.setTargetAtTime(0, t, 0.06);
    try { source.stop(t + 0.5); } catch {}
    source.onended = () => { source.disconnect(); gain.disconnect(); };
  }
  function silence() {
    if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.025);
    stopWind();
    stopShots();
  }
  return {
    start() {
      try {
        if (ctx) { ctx.resume().catch(() => {}); return; }
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio) return;
        ctx = new Audio();
        output = ctx.createDynamicsCompressor();
        output.threshold.value = -12; output.ratio.value = 5;
        output.attack.value = 0.003; output.release.value = 0.2;
        output.connect(ctx.destination);
        master = ctx.createGain(); master.gain.value = 0; master.connect(output);
        blastBus = ctx.createGain(); blastBus.gain.value = 1; blastBus.connect(output);
        noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const wind = ctx.createBufferSource(); wind.buffer = noiseBuffer; wind.loop = true;
        filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 1.4;
        wind.connect(filter); filter.connect(master); wind.start();
        hum = ctx.createOscillator(); hum.type = 'triangle';
        const humGain = ctx.createGain(); humGain.gain.value = 0.3;
        hum.connect(humGain); humGain.connect(master); hum.start();
        overtone = ctx.createOscillator(); overtone.type = 'sine';
        const overtoneGain = ctx.createGain(); overtoneGain.gain.value = 0.09;
        overtone.connect(overtoneGain); overtoneGain.connect(master); overtone.start();
        // A rotating sweep gives the sustained charge motion instead of a flat hum.
        swirl = ctx.createOscillator(); swirl.frequency.value = 4;
        const modulation = ctx.createGain(); modulation.gain.value = 280;
        swirl.connect(modulation); modulation.connect(filter.frequency); swirl.start();
        ctx.resume().catch(() => {});
        // Load the wind from your clip. Until it is ready (or if it fails) the synthesized wind plays.
        const context = ctx;
        fetch(windURL)
          .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.arrayBuffer(); })
          .then(data => context.decodeAudioData(data))
          .then(buffer => { if (context === ctx) windBuffer = buffer; })
          .catch(error => console.warn('Rasengan wind sample unavailable, using synthesized wind:', error));
      } catch (error) {
        if (master) master.gain.value = 0;
        ctx?.close().catch(() => {}); ctx = master = null;
        windBuffer = null; windVoice = null;
        console.warn('Jutsu sound unavailable:', error);
      }
    },
    setEnabled(value) { enabled = value; if (!value) silence(); },
    silence,
    impact() {
      if (!ctx || !master || !enabled) return;
      // A browser can leave the context suspended; wake it so the blast is never swallowed.
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      stopShots();
      playBlast(ctx, blastBus, noiseBuffer, ctx.currentTime, source => {
        shots.add(source);
        source.addEventListener('ended', () => shots.delete(source));
      });
    },
    update(phase, charge) {
      if (!master) return;
      const active = ['charging', 'ready', 'flying'].includes(phase);
      const power = phase === 'flying' ? 1 : charge;
      const t = ctx.currentTime;
      const useSample = Boolean(windBuffer);
      // The clip's own wind plays from the start of each charge: swell, peak, then the steady loop.
      if (enabled && active && useSample && !windVoice) startWind();
      if (windVoice && !(enabled && active)) stopWind();
      if (windVoice) {
        const level = WIND_VOLUME * (phase === 'flying' ? 1 : 0.8 + 0.2 * power);
        windVoice.gain.gain.setTargetAtTime(level, t, 0.08);
        windVoice.source.playbackRate.setTargetAtTime(phase === 'flying' ? FLIGHT_PITCH : 1, t, 0.15);
      }
      // The synthesized wind is only the fallback while the sample is missing.
      const synth = enabled && active && !useSample;
      master.gain.setTargetAtTime(synth ? 0.025 + power * 0.19 : 0, t, 0.08);
      filter.frequency.setTargetAtTime(phase === 'flying' ? 2800 : 550 + power * 1400, t, 0.08);
      hum.frequency.setTargetAtTime(100 + power * 150, t, 0.12);
      overtone.frequency.setTargetAtTime(430 + power * 620, t, 0.12);
      swirl.frequency.setTargetAtTime(4 + power * 15, t, 0.12);
    },
  };
}
