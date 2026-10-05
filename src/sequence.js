// Gesture timing lives here so rendering and camera code stay easier to follow.
export const CHARGE_SECONDS = 1.5;
export const FLIGHT_SECONDS = 0.42;
const GUN_HOLD_SECONDS = 0.18;
const BLAST_TIMEOUT = 3;

export class RasenganSequence {
  constructor() { this.reset(); }
  reset() {
    this.phase = 'idle';
    this.age = 0;
    this.charge = 0;
    this.gunTime = 0;
    this.invalidTime = 0;
    this.rearmTime = 0;
  }
  enter(phase) {
    this.phase = phase;
    this.age = 0;
    this.invalidTime = 0;
    this.gunTime = 0;
  }
  step(hand, dt, blastFinished = false) {
    this.age += dt;
    let event = null;
    // Closing the palm cancels a held orb immediately. An already-fired shot finishes.
    if (hand?.closed && !hand?.gun && ['charging', 'ready'].includes(this.phase)) {
      this.reset();
      return 'dismiss';
    }
    if (this.phase === 'idle') {
      if (hand?.open) {
        this.enter('charging');
        this.charge = 0;
        event = 'charge';
      }
    } else if (this.phase === 'charging') {
      if (hand?.open) {
        this.invalidTime = 0;
        this.charge = Math.min(1, this.charge + dt / CHARGE_SECONDS);
        if (this.charge >= 1) this.enter('ready');
      } else {
        // Ignore a brief tracking flicker; a sustained closed/missing hand cancels.
        this.invalidTime += dt;
        if (this.invalidTime > 0.2) this.reset();
      }
    } else if (this.phase === 'ready') {
      if (hand?.gun) {
        this.invalidTime = 0;
        this.gunTime += dt;
        if (this.gunTime >= GUN_HOLD_SECONDS) {
          this.enter('flying');
          event = 'launch';
        }
      } else {
        this.gunTime = 0;
        this.invalidTime = hand?.open ? 0 : this.invalidTime + dt;
        // Allow time to fold the ring/little fingers when changing poses.
        if (this.invalidTime > (hand ? 0.8 : 0.2)) this.reset();
      }
    } else if (this.phase === 'flying') {
      // Once fired, finish the shot even if the hand leaves the camera.
      if (this.age >= FLIGHT_SECONDS) {
        this.enter('blast');
        event = 'impact';
      }
    } else if (this.phase === 'blast') {
      if (blastFinished || this.age > BLAST_TIMEOUT) {
        this.enter('cooldown');
        this.rearmTime = 0;
        event = 'blast-end';
      }
    } else if (this.phase === 'cooldown') {
      // Holding the gun pose must not repeatedly fire. Open the palm to rearm.
      this.rearmTime = hand?.open ? this.rearmTime + dt : 0;
      if (this.age >= 0.4 && this.rearmTime >= 0.2) {
        this.enter('charging');
        this.charge = 0;
        event = 'charge';
      }
    }
    return event;
  }
}
