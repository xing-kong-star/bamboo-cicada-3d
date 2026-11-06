export const TAU = Math.PI * 2;
export const MAX_RPM = 5200;
export const MAX_OMEGA = (MAX_RPM * TAU) / 60;
export const SING_RPM = 1200;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sign = (value) => (value < 0 ? -1 : 1);

/**
 * Lightweight rigid-rotor model.
 *
 * The bamboo wing is treated as a single rotor with one degree of freedom.
 * User rubbing adds angular momentum; aerodynamic drag (proportional to ω²)
 * and bearing friction (proportional to ω) bleed it away. A small breakaway
 * torque brings the rotor to a complete stop instead of asymptotically drifting.
 */
export class BambooPhysics {
  constructor() {
    this.maxOmega = MAX_OMEGA;
    this.reset();
  }

  reset() {
    this.omega = 0;
    this.angle = 0;
    this.spinDirection = 1;
    this.rubPulse = 0;
    this.lastInputAt = -10;
    this.wobblePhase = 0;
    this.wobbleX = 0;
    this.wobbleZ = 0;
    this.tiltX = 0;
    this.tiltZ = 0;
    this.temperature = 0;
    this.time = 0;
    this._lastSign = 1;
  }

  get rpm() {
    return (Math.abs(this.omega) * 60) / TAU;
  }

  get speedRatio() {
    return clamp(Math.abs(this.omega) / this.maxOmega, 0, 1);
  }

  get audibleRatio() {
    return clamp((this.rpm - 220) / 4200, 0, 1);
  }

  setRpm(rpm, direction = 1) {
    this.omega = (clamp(rpm, 0, MAX_RPM) * TAU) / 60 * (direction < 0 ? -1 : 1);
    this.spinDirection = direction < 0 ? -1 : 1;
  }

  setOmega(omega) {
    this.omega = clamp(omega, -this.maxOmega, this.maxOmega);
    if (Math.abs(this.omega) > 0.01) this.spinDirection = sign(this.omega);
  }

  /**
   * Convert a normalized pointer stroke into an angular impulse.
   * @param {number} distance normalized screen distance (0..~2)
   * @param {number} direction -1 or 1
   * @param {number} strength 0..1 multiplier (slower drags impart less energy)
   */
  rub(distance, direction = 1, strength = 1) {
    const d = Math.abs(distance);
    if (d < 0.0005) return 0;

    if (this.rpm < 30 && Math.abs(direction) > 0) {
      this.spinDirection = direction < 0 ? -1 : 1;
    }

    // Diminishing returns near the top speed: it becomes harder to accelerate
    // the rotor as aerodynamic resistance rises.
    const headroom = Math.pow(1 - this.speedRatio, 0.55);
    const gain = 250 * clamp(strength, 0.25, 1.35);
    const impulse = Math.min(d * gain * (0.32 + 0.68 * headroom), 34);
    this.addAngularImpulse(impulse * this.spinDirection, 'rub');
    this.rubPulse = Math.min(1, this.rubPulse + d * 5.5 + 0.08);
    this.lastInputAt = this.time;
    return impulse;
  }

  addAngularImpulse(amount, source = 'impulse') {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.omega += amount;
    if (Math.abs(this.omega) > this.maxOmega) {
      this.omega = sign(this.omega) * this.maxOmega;
    }
    this.lastInputAt = this.time;
    if (source === 'shake' || source === 'gesture') {
      this.rubPulse = Math.min(1, this.rubPulse + 0.18);
    }
  }

  kick(strength = 1) {
    const direction = this.omega < -1 ? -1 : 1;
    this.addAngularImpulse((90 + Math.random() * 25) * strength * direction, 'shake');
  }

  step(dt) {
    dt = clamp(dt, 0, 0.05);
    this.time += dt;

    if (Math.abs(this.omega) > 0.01) {
      const absOmega = Math.abs(this.omega);
      const aerodynamic = 0.000074 * absOmega * absOmega;
      const bearing = 0.128 * absOmega;
      const breakaway = absOmega < 14 ? 0.55 : 0;
      const drag = (aerodynamic + bearing + breakaway) * dt;
      const next = absOmega - drag;
      if (next <= 0.16) {
        this.omega = 0;
      } else {
        this.omega = sign(this.omega) * next;
      }
      this.angle += this.omega * dt;
      if (this.angle > TAU * 1000) this.angle %= TAU * 1000;
      if (this.angle < -TAU * 1000) this.angle %= -TAU * 1000;
    }

    const ratio = this.speedRatio;
    this.wobblePhase += dt * (3.5 + ratio * 34);
    const wobbleTargetX = Math.sin(this.wobblePhase * 1.07) * ratio * 0.028;
    const wobbleTargetZ = Math.cos(this.wobblePhase * 0.83) * ratio * 0.021;
    this.wobbleX += (wobbleTargetX - this.wobbleX) * Math.min(1, dt * 8);
    this.wobbleZ += (wobbleTargetZ - this.wobbleZ) * Math.min(1, dt * 8);
    this.tiltX = this.wobbleX + Math.sin(this.wobblePhase * 2.3) * ratio * 0.007;
    this.tiltZ = this.wobbleZ + Math.cos(this.wobblePhase * 2.9) * ratio * 0.005;

    this.rubPulse *= Math.exp(-dt * 4.7);
    this.temperature += (ratio * 0.65 - this.temperature) * dt * 1.4;

    if (Math.abs(this.omega) < 0.08 && this.rpm < 1) this.omega = 0;
  }

  get bob() {
    return Math.sin(this.wobblePhase * 3.1) * this.speedRatio * 0.035;
  }
}
