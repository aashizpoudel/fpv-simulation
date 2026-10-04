import { describe, expect, it } from "vitest";
import { droneAudioParameters, motorPlaybackRate } from "../src/audio/drone-audio-engine";
import { Tinyhawk3Config } from "../src/config/tinyhawk-config";
import { MotorModel } from "../src/physics/motor-model";
import type { DroneTelemetry } from "../src/types";

function telemetry(overrides: Partial<DroneTelemetry> = {}): DroneTelemetry {
  return {
    localPosition: { x: 0, y: 0, z: 0 },
    localOrientation: { x: 0, y: 0, z: 0, w: 1 },
    localVelocity: { x: 0, y: 0, z: 0 },
    localAngularVelocity: { x: 0, y: 0, z: 0 },
    gforce: 1, throttle: 0, rotorThrusts: [0, 0, 0, 0],
    motorCommands: [0, 0, 0, 0], crashed: false, armed: false,
    ...overrides,
  };
}
const thrusts = (fraction: number) => Tinyhawk3Config.rotors.map(r => r.maxThrust * fraction);
const parameters = (state: DroneTelemetry) => droneAudioParameters(state, Tinyhawk3Config, "fpv");

describe("drone audio mapping", () => {
  it("keeps the recorded hover pitch near native and limits the throttle sweep", () => {
    const hoverSpeed = Math.sqrt(Tinyhawk3Config.mass * 9.81 /
      Tinyhawk3Config.rotors.reduce((total, rotor) => total + rotor.maxThrust, 0));
    expect(motorPlaybackRate(hoverSpeed)).toBeGreaterThan(0.95);
    expect(motorPlaybackRate(hoverSpeed)).toBeLessThan(1.05);
    expect(motorPlaybackRate(1.2)).toBeLessThan(1.3);
    expect(motorPlaybackRate(0.1)).toBeLessThan(motorPlaybackRate(hoverSpeed));
  });
  it("keeps stopped rotors silent even when controller commands jump", () => {
    const result = parameters(telemetry({ motorCommands: [1, 1, 1, 1] }));
    expect(result.rotorSpeeds).toEqual([0, 0, 0, 0]);
    expect(result.energy).toBe(0);
    expect(result.windGain).toBe(0);
  });

  it("follows physical spool-up and spool-down after disarming", () => {
    const motor = new MotorModel(Tinyhawk3Config.propulsion, Tinyhawk3Config.rotors[0].maxThrust);
    const start = motor.step(1, 3.8, 0.005);
    const running = motor.step(1, 3.8, 0.1);
    const coast = motor.step(0, 3.8, 0.005);
    const stopped = motor.step(0, 3.8, 1);
    const energy = (thrust: number) => parameters(telemetry({ rotorThrusts: [thrust, thrust, thrust, thrust] })).energy;
    expect(energy(start)).toBeLessThan(energy(running));
    expect(energy(coast)).toBeLessThan(energy(running));
    expect(energy(coast)).toBeGreaterThan(0);
    expect(energy(stopped)).toBeLessThan(0.00001);
  });

  it("does not apply battery voltage twice to physical thrust", () => {
    const state = telemetry({ rotorThrusts: thrusts(0.25) });
    expect(parameters({ ...state, batteryVoltage: 3.2 }))
      .toEqual(parameters({ ...state, batteryVoltage: 4.35 }));
    expect(parameters(state).rotorSpeeds).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("tracks the voltage-scaled RPM already present in motor thrust", () => {
    const speed = (voltage: number) => {
      const motor = new MotorModel(Tinyhawk3Config.propulsion, Tinyhawk3Config.rotors[0].maxThrust);
      const thrust = motor.step(0.5, voltage, 2);
      return parameters(telemetry({ rotorThrusts: [thrust, thrust, thrust, thrust], batteryVoltage: voltage })).energy;
    };
    expect(speed(4.2) / speed(3.4)).toBeCloseTo(4.2 / 3.4);
  });

  it("preserves motor differences during roll, pitch and yaw", () => {
    const result = parameters(telemetry({
      rotorThrusts: Tinyhawk3Config.rotors.map((r, i) => r.maxThrust * [0.16, 0.25, 0.36, 0.49][i]),
    }));
    result.rotorSpeeds.forEach((speed, i) => expect(speed).toBeCloseTo([0.4, 0.5, 0.6, 0.7][i]));
  });

  it("attenuates external sound with camera distance but keeps FPV unchanged", () => {
    const state = telemetry({ rotorThrusts: thrusts(0.36) });
    const near = { x: 1, y: 0, z: 0 }, far = { x: 30, y: 0, z: 0 };
    expect(droneAudioParameters(state, Tinyhawk3Config, "orbit", far).motorGain)
      .toBeLessThan(droneAudioParameters(state, Tinyhawk3Config, "orbit", near).motorGain * 0.2);
    expect(droneAudioParameters(state, Tinyhawk3Config, "fpv", far))
      .toEqual(droneAudioParameters(state, Tinyhawk3Config, "fpv", near));
  });

  it("adds wind only onboard and no speed-triggered external effect", () => {
    const slow = telemetry({ rotorThrusts: thrusts(0.36), localVelocity: { x: 5, y: 0, z: 0 } });
    const fast = { ...slow, localVelocity: { x: 12, y: 0, z: 0 } };
    expect(parameters(fast).windGain).toBeGreaterThan(parameters(slow).windGain);
    expect(droneAudioParameters(slow, Tinyhawk3Config, "third"))
      .toEqual(droneAudioParameters(fast, Tinyhawk3Config, "third"));
  });
});
