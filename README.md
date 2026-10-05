# Chakra Training

Real-time augmented-reality hand jutsu that runs in your browser. Your webcam is the training
ground: charge a **Rasengan**, call down **Chidori**, and cross your hands for **Shadow Clones**.
Everything is driven by hand tracking, with no controller and nothing to install for the player.

## Quick start

```bash
npm install
npm run dev      # then open the printed localhost URL and press "Begin training"
```

Requirements: Node 20+, a webcam, and a connection for the first load (the hand-tracking and
person-cut-out models are fetched from Google's MediaPipe model storage). The camera feed is
processed locally and is never uploaded. Use `localhost` or HTTPS, since browsers only allow
camera access there.

## How to play

| Jutsu | Gesture | Notes |
| --- | --- | --- |
| **Rasengan** | Open your right palm and hold for 1.5 s, then point index and middle fingers at the camera | Closing the palm dismisses it before launch |
| **Chidori** | Open your left palm | Close the palm to dismiss |
| **Shadow Clone** | Make the two-finger seal with both hands and **cross** them, hold for about a third of a second | Repeat the seal to dispel |

Keyboard: `M` sound · `F` fullscreen · `S` settings · `D` detection view. If Rasengan and Chidori
feel swapped on your camera, use **Swap hand assignments** in settings.

## Shadow clone detection

The seal is recognised from three independent pieces of evidence, then smoothed over time:

1. **Pose score per hand** (`handSealScore` in `src/coordinates.js`): index and middle finger out,
   ring and little finger folded, as a soft 0–1 score rather than a yes/no. It uses MediaPipe's
   3D world landmarks, so a finger pointing at the lens still counts as extended, and a
   half-curled ring finger lowers the score instead of vetoing the seal.
2. **Crossing test** (`handsCross` in `src/cloneSeal.js`): the pointing lines of the two hands
   intersect (an X), or the palms are close together.
3. **Temporal smoothing** (`CloneSealTracker`): confidence rises quickly and falls slowly, with
   hysteresis, so one frame of lost or mislabelled tracking does not reset the hold.

The seal also never depends on the tracker's Left/Right labels. When hands cross, MediaPipe often
gives both the same label; earlier versions discarded one of them, which made the seal fail roughly
half the time. All tracked hands are now kept, and only Rasengan and Chidori use the labels.

Turn on the **detection view** (`D`) to see each hand's seal score, whether the hands count as
crossed, and the smoothed confidence. The tuning constants are at the top of
`src/cloneSeal.js` (`HOLD_SECONDS`, `POSE_MIN`, `PROXIMITY`) and in `handSealScore`.

## Project layout

```
index.html              markup for the HUD, intro screen and settings
src/
  main.js               state machine: ties tracking, effects, sound and UI together
  ui.js                 all DOM updates, shortcuts and the detection view
  style.css             interface styling
  handTracking.js       MediaPipe hand landmarker, converts landmarks to scene hands
  coordinates.js        screen mapping, palm open/closed, seal pose score
  gestures.js           3D finger-gun (Rasengan launch) check
  cloneSeal.js          seal crossing test and hold/toggle timing
  handRoles.js          maps tracked hands to Rasengan / Chidori
  sequence.js           Rasengan charge, launch and impact timing
  rasengan.js  chidori.js  shadowClone.js  explosion.js  atmosphere.js
                        the visual effects
  introFx.js            pointer parallax on the opening screen (the rest is CSS)
  impactFx.js           Rasengan hit: hit-stop freeze, white flash, screen shake, shockwave ring
  rasenganSound.js      wind loop and audio routing
  blast.js              the layered Rasengan impact explosion sound
  videoMaterial.js  effectsKit.js  threeSetup.js  webcam.js
scripts/                MediaPipe WASM copy step, Chidori clip generator
tests/                  gesture and timing tests (no camera needed)
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Gesture, timing and crossed-hands simulation tests |
| `npm run check` | Tests, then a production build |

`npm test` includes a simulation of the crossed seal under tilted fingers, landmark jitter,
duplicate hand labels and dropped frames. It runs on a synthetic hand model, so it checks the
logic rather than your camera: always confirm on a real device.

## Customising

- **Blast sound:** the layers (crack, thump, noise body, sub, debris, room tail) are in `src/blast.js`; the overall level is `bus.gain.value` there.
- **Rasengan sound:** `WIND_VOLUME`, `WIND_LOOP_START`, `FLIGHT_PITCH` in `src/rasenganSound.js`.
  The wind comes from `src/assets/rasengan-wind.wav`; the impact is synthesised.
- **Chidori:** `GAIN` in `src/chidori.js` controls palm coverage. The clip is generated from
  `scripts/chidori-source.gif`:
  `python3 scripts/make-chidori.py scripts/chidori-source.gif src/assets/chidori.mp4 --frames 24`
  (needs numpy, opencv-python, scipy, pillow and ffmpeg).
- **Shadow clones:** `CLONE_SPREAD`, `CUT_WIDTH`, `SMOKE_PUFFS`, `SOUND_VOLUME` in `src/shadowClone.js`.
  `CLONE_DELAY` sets how many camera frames each clone lags behind you (left 4, right 8), so they
  move like separate people. Set both to 0 for perfect copies.
- **Impact feel:** `HIT_STOP`, `SHAKE_PIXELS`, `SHAKE_TILT`, `PUNCH`, `FLASH`, `RING_SECONDS` in `src/impactFx.js`.
  Can be switched off in Settings ("Impact shake and flash").

## Look and feel

The opening screen is a poster: flat red, giant white type, and a cut-out figure (`src/assets/hokage.webp`)
standing in front of the letters with its shadow falling across them. The pointer moves the figure and the
title in opposite directions. It is plain CSS in `src/style.css` (section "Intro / loading / error") plus
`src/introFx.js`. To swap the figure, replace the WebP with another transparent cut-out of similar proportions,
or change `width` on `.subject` in the CSS.

Inside the game the interface is drawn like an anime opening: ink black and manga paper, slanted tags and
panels, hard offset shadows, outlined italic subtitles, and kanji (螺旋丸 Rasengan, 千鳥 Chidori, 影分身
shadow clone). Each jutsu triggers a full-screen title card (flash, speed lines, letterbox bars, kanji slam)
from `callout()` in `src/ui.js`. Fonts (Anton, Dela Gothic One, Outfit, Zen Kaku Gothic New) load from Google
Fonts in `index.html`; without a connection the page falls back to system fonts. With reduced motion enabled,
the opening animation is skipped and the title card becomes a short fade with no flashing.

## Notes

- Both hand effects are overlays: fingers do not occlude them, and the light patches approximate
  lighting rather than simulate it.
- Sounds other than the supplied Rasengan wind are synthesised in the browser.
- Leaving or hiding the tab stops the camera and audio; press **Resume training** to continue.
