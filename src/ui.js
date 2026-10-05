// All DOM work for the interface lives here, so main.js only deals with state and effects.
import { POSE_MIN, handsCross } from './cloneSeal.js';

const $ = selector => document.querySelector(selector);

export function createUI(handlers) {
  const el = {
    intro: $('#intro'), introMessage: $('#intro-message'), start: $('#start'), startLabel: $('#start-label'),
    progress: $('#progress'), progressFill: $('#progress-fill'),
    status: $('#status'), callout: $('#callout'), bars: $('#bars'),
    cKanji: $('#callout .c-kanji'), cName: $('#callout .c-name'),
    rasengan: $('#rasengan-badge'), chidori: $('#chidori-badge'), clone: $('#clone-badge'),
    rasenganHand: $('#rasengan-hand'), chidoriHand: $('#chidori-hand'), charge: $('#charge-fill'),
    sealRing: $('#seal-ring'), sealFill: $('#seal-fill'),
    sound: $('#sound'), fullscreen: $('#fullscreen'),
    settingsToggle: $('#settings-toggle'), settings: $('#settings-panel'),
    glow: $('#opacity'), chidoriGlow: $('#chidori-opacity'),
    swap: $('#swap'), impactToggle: $('#impact-toggle'), debugToggle: $('#debug-toggle'), debug: $('#debug'),
  };

  // --- Status caption: only touch the DOM when the text changes ---
  let statusText = '';
  const setStatus = text => {
    if (text === statusText) return;
    statusText = text;
    el.status.textContent = text;
    // Restart the pop animation so each new line lands like a fresh subtitle.
    el.status.classList.remove('pop');
    void el.status.offsetWidth;
    el.status.classList.add('pop');
  };

  // --- Jutsu title card: flash, speed lines, kanji slam, name ---
  const CARDS = {
    rasengan: { kanji: '螺旋丸', name: 'Rasengan!' },
    chidori: { kanji: '千鳥', name: 'Chidori!' },
    clone: { kanji: '影分身', name: 'Shadow clone!' },
    dispel: { kanji: '解', name: 'Release!' },
  };
  let calloutTimer = 0;
  function callout(tone) {
    const card = CARDS[tone];
    if (!card) return;
    el.cKanji.textContent = card.kanji;
    el.cName.textContent = card.name;
    el.callout.dataset.tone = tone;
    for (const node of [el.callout, el.bars]) { node.classList.remove('play'); void node.offsetWidth; node.classList.add('play'); }
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => { el.callout.classList.remove('play'); el.bars.classList.remove('play'); }, 1650);
  }

  // --- Intro, loading and error states ---
  const STEPS = 4;
  function showIntro({ message, button = 'Start training', error = false } = {}) {
    el.intro.hidden = false;
    // Two frames so the fade-in transition runs after the element is displayed again.
    requestAnimationFrame(() => requestAnimationFrame(() => el.intro.classList.remove('leaving')));
    if (message) {
      el.introMessage.textContent = message;
      el.introMessage.classList.toggle('error', error);
    }
    el.startLabel.textContent = button;
    el.start.disabled = false;
    el.progress.hidden = true;
  }
  function setLoading(step, message) {
    el.start.disabled = true;
    el.startLabel.textContent = 'Loading…';
    el.introMessage.classList.remove('error');
    el.introMessage.textContent = message;
    el.progress.hidden = false;
    el.progressFill.style.transform = `scaleX(${step / STEPS})`;
  }
  function hideIntro() {
    el.progressFill.style.transform = 'scaleX(1)';
    el.intro.classList.add('leaving');
    setTimeout(() => { if (el.intro.classList.contains('leaving')) el.intro.hidden = true; }, 650);
  }

  // --- HUD ---
  function setBadges({ rasengan, chidori, clone, charge }) {
    el.rasengan.classList.toggle('active', rasengan);
    el.rasengan.classList.toggle('charging', rasengan && charge > 0 && charge < 1);
    el.chidori.classList.toggle('active', chidori);
    el.clone.classList.toggle('active', clone);
    el.charge.parentElement.style.setProperty('--charge', charge.toFixed(3));
  }
  function setHandLabels(swapped) {
    el.rasengan.querySelector('.jutsu-hand').textContent = swapped ? 'Left palm' : 'Right palm';
    el.chidori.querySelector('.jutsu-hand').textContent = swapped ? 'Right palm' : 'Left palm';
  }
  function setSeal(progress, sealing) {
    const visible = sealing || progress > 0.04;
    el.sealRing.classList.toggle('visible', visible);
    el.sealFill.style.strokeDashoffset = String(100 - progress * 100);
  }
  function setSound(enabled) {
    el.sound.setAttribute('aria-pressed', String(!enabled));
    el.sound.setAttribute('aria-label', enabled ? 'Sound on' : 'Sound off');
  }
  function setSwapped(swapped) {
    el.swap.setAttribute('aria-checked', String(swapped));
    setHandLabels(swapped);
  }

  // --- Settings panel ---
  function toggleSettings(force) {
    const open = force ?? el.settings.hidden;
    el.settings.hidden = !open;
    el.settingsToggle.setAttribute('aria-expanded', String(open));
  }

  // --- Detection view: shows what the tracker sees, to tune the cross-hands seal ---
  let debugOn = false;
  function setDebug(on) {
    debugOn = on;
    el.debug.hidden = !on;
    el.debugToggle.setAttribute('aria-checked', String(on));
  }
  const bar = value => `<span class="bar${value >= POSE_MIN ? ' ok' : ''}"><i style="width:${Math.round(value * 100)}%"></i><b style="left:${POSE_MIN * 100}%"></b></span>`;
  function renderDebug(hands, tracker) {
    if (!debugOn) return;
    const rows = hands.length
      ? hands.map((hand, i) => `<div class="row"><span>${hand.label ?? '?'} ${i + 1}</span>${bar(hand.sealScore ?? 0)}<span>${(hand.sealScore ?? 0).toFixed(2)}</span></div>`).join('')
      : '<div class="row"><span>no hands</span></div>';
    const crossing = hands.length > 1 && handsCross(hands[0], hands[1]);
    el.debug.innerHTML = `<h3>Detection view</h3>${rows}
      <div class="row"><span>seal</span>${bar(tracker.confidence)}<span>${tracker.confidence.toFixed(2)}</span></div>
      <div class="row"><span>hold</span>${bar(tracker.progress)}<span>${tracker.progress.toFixed(2)}</span></div>
      <div class="tag"><span>hands ${hands.length}</span><span class="${crossing ? 'on' : ''}">${crossing ? 'crossed' : 'not crossed'}</span></div>`;
  }

  // --- Wiring ---
  el.start.addEventListener('click', () => handlers.start());
  el.glow.addEventListener('input', e => handlers.rasenganGlow(Number(e.target.value)));
  el.chidoriGlow.addEventListener('input', e => handlers.chidoriGlow(Number(e.target.value)));
  el.sound.addEventListener('click', () => handlers.toggleSound());
  el.swap.addEventListener('click', () => handlers.toggleSwap());
  el.impactToggle.addEventListener('click', () => {
    const on = el.impactToggle.getAttribute('aria-checked') !== 'true';
    el.impactToggle.setAttribute('aria-checked', String(on));
    handlers.impactEffects(on);
  });
  el.debugToggle.addEventListener('click', () => setDebug(!debugOn));
  el.settingsToggle.addEventListener('click', () => toggleSettings());
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  el.fullscreen.addEventListener('click', toggleFullscreen);
  if (!document.documentElement.requestFullscreen) el.fullscreen.hidden = true;
  addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.matches?.('input')) return;
    const key = event.key.toLowerCase();
    if (key === 'm') handlers.toggleSound();
    else if (key === 'f') toggleFullscreen();
    else if (key === 's') toggleSettings();
    else if (key === 'd') setDebug(!debugOn);
    else if (key === 'escape') toggleSettings(false);
  });

  return {
    setStatus, callout, showIntro, setLoading, hideIntro, setBadges, setSeal, setSound, setSwapped, renderDebug,
    get glow() { return Number(el.glow.value); },
    get chidoriGlow() { return Number(el.chidoriGlow.value); },
  };
}
