import type { DroneConfig } from "../config/tinyhawk-config";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import { RapierPhysics } from "../physics/rapier-physics";

const DEFAULT_FIXED_TIME_STEP = 1 / 240;
const DEFAULT_MAX_SUB_STEPS = 5;

export type SimulationEngineOptions = {
  fixedTimeStep?: number;
  maxSubSteps?: number;
  clampY?: number;
  config?: DroneConfig;
  physics?: RapierPhysics;
};

export class SimulationEngine {
  private physics: RapierPhysics;
  private accumulator = 0;
  private fixedTimeStep: number;
  private maxSubSteps: number;
  private clampY: number;
  private lastTelemetry: DroneTelemetry;

  constructor(options: SimulationEngineOptions = {}) {
    this.fixedTimeStep = options.fixedTimeStep ?? DEFAULT_FIXED_TIME_STEP;
    this.maxSubSteps = options.maxSubSteps ?? DEFAULT_MAX_SUB_STEPS;
    this.clampY = options.clampY ?? 0;
    this.physics = options.physics ?? new RapierPhysics(options.config);
    this.lastTelemetry = this.physics.getTelemetry();
  }

  async init(startPosition: Vec3): Promise<void> {
    await this.physics.init(startPosition);
    this.lastTelemetry = this.physics.getTelemetry();
  }

  step(input: Controls, dt: number): DroneTelemetry {
    if (!Number.isFinite(dt) || dt <= 0) {
      return this.lastTelemetry;
    }

    const maxAccumulator = this.fixedTimeStep * this.maxSubSteps;
    this.accumulator = Math.min(this.accumulator + dt, maxAccumulator);

    while (this.accumulator >= this.fixedTimeStep) {
      this.lastTelemetry = this.physics.step(input, this.fixedTimeStep, this.clampY);
      this.accumulator -= this.fixedTimeStep;
    }

    return this.lastTelemetry;
  }

  setArmed(armed: boolean): void {
    this.physics.setArmed(armed);
  }

  reset(): void {
    this.accumulator = 0;
    this.physics.reset();
    this.lastTelemetry = this.physics.getTelemetry();
  }

  getTelemetry(): DroneTelemetry {
    return this.lastTelemetry;
  }
}
