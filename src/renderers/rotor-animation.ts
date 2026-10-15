import { clamp } from "../controllers/math-utils";
import type { DroneConfig } from "../config/drone-config";
import type { DroneTelemetry } from "../types";

const DIRECTIONS: Record<string, number> = {
  frontRight: 1,
  frontLeft: -1,
  rearLeft: 1,
  rearRight: -1,
};

export class RotorAnimation {
  readonly rotors;
  private previousTime?: number;

  constructor(config: DroneConfig) {
    this.rotors = config.rotors.map((rotor) => ({
      name: rotor.name,
      maxThrust: rotor.maxThrust,
      direction: DIRECTIONS[rotor.name] ?? 1,
      angle: 0,
      blur: 0,
    }));
  }

  update(frame: DroneTelemetry, now = performance.now()): void {
    const dt = this.previousTime === undefined ? 0 : clamp((now - this.previousTime) / 1000, 0, 0.1);
    this.previousTime = now;
    this.rotors.forEach((rotor, i) => {
      // Actual thrust includes motor spool time and battery voltage. Do not cut
      // the visual rotation on disarm while the physical motor is still coasting.
      const thrust = frame.rotorThrusts[i] ?? 0;
      const speed = Number.isFinite(thrust)
        ? Math.sqrt(clamp(thrust / Math.max(1e-6, rotor.maxThrust), 0, 1.44)) : 0;
      const omega = speed < 0.001 ? 0 : speed * 95;
      rotor.angle = (rotor.angle + rotor.direction * omega * dt) % (Math.PI * 2);
      const blend = clamp((omega - 10) / (42 - 10), 0, 1);
      rotor.blur = blend * blend * (3 - 2 * blend);
    });
  }
}
