import { describe, expect, it, vi } from "vitest";

import { SimulationEngine } from "../src/core/simulation-engine";
import type { Controls, DroneTelemetry, Vec3 } from "../src/types";
import type { RapierPhysics } from "../src/physics/rapier-physics";

const baseTelemetry: DroneTelemetry = {
  localPosition: { x: 0, y: 0, z: 0 },
  localOrientation: { x: 0, y: 0, z: 0, w: 1 },
  localVelocity: { x: 0, y: 0, z: 0 },
  localAngularVelocity: { x: 0, y: 0, z: 0 },
  gforce: 0,
  throttle: 0,
  rotorThrusts: [0, 0, 0, 0],
  crashed: false,
  armed: false,
};

const neutralControls: Controls = {
  thrust: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  speedMultiplier: 1,
  arm: false,
  reset: false,
};

class FakePhysics {
  init = vi.fn(async (_: Vec3) => undefined);
  setArmed = vi.fn();
  reset = vi.fn();
  private telemetry = { ...baseTelemetry };

  getTelemetry = vi.fn(() => this.telemetry);

  step = vi.fn(() => {
    this.telemetry = {
      ...this.telemetry,
      throttle: this.telemetry.throttle + 1,
    };
    return this.telemetry;
  });
}

describe("SimulationEngine", () => {
  it("accumulates time and steps on fixed cadence", () => {
    const physics = new FakePhysics();
    const engine = new SimulationEngine({
      fixedTimeStep: 0.1,
      maxSubSteps: 3,
      physics: physics as unknown as RapierPhysics,
    });

    expect(engine.step(neutralControls, 0.05).throttle).toBe(0);
    expect(physics.step).not.toHaveBeenCalled();

    expect(engine.step(neutralControls, 0.05).throttle).toBe(1);
    expect(physics.step).toHaveBeenCalledTimes(1);

    engine.step(neutralControls, 0.35);
    expect(physics.step).toHaveBeenCalledTimes(4);
  });

  it("caps substeps with maxSubSteps", () => {
    const physics = new FakePhysics();
    const engine = new SimulationEngine({
      fixedTimeStep: 0.1,
      maxSubSteps: 2,
      physics: physics as unknown as RapierPhysics,
    });

    engine.step(neutralControls, 0.5);
    expect(physics.step).toHaveBeenCalledTimes(2);
  });
});
