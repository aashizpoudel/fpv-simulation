import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DroneSimPhysics } from "../src/physics/dronesim-physics";
import { ImuSensorModel } from "../src/physics/imu-sensor";
import { Tinyhawk3Config } from "../src/config/tinyhawk-config";
import type { DroneConfig } from "../src/config/drone-config";
import type { DroneSimModule } from "../src/vendor/dronesim";
import { SimulationEngine } from "../src/core/simulation-engine";

describe("DroneSimPhysics (Unified Betaflight + Motor WASM)", () => {
  let sim: DroneSimPhysics;

  beforeEach(async () => {
    sim = new DroneSimPhysics(Tinyhawk3Config);
    await sim.init({ x: 0, y: 0, z: 1.0 });
  });

  afterEach(() => {
    sim.dispose();
  });

  it("initializes with full battery and disarmed state", () => {
    const telemetry = sim.getTelemetry();
    expect(telemetry.armed).toBe(false);
    expect(telemetry.crashed).toBe(false);
    expect(telemetry.batteryVoltage).toBeCloseTo(4.35, 1);
    expect(telemetry.localPosition.z).toBeCloseTo(1.0, 2);
  });

  it("sends raw channels in the numeric order from the drone config", () => {
    const internal = sim as unknown as { config: DroneConfig; wasm: DroneSimModule };
    internal.config.rcChannelOrder = [4, 3, 2, 1, 8, 7, 6, 5];
    const original = internal.wasm._dronesim_flight_step_raw;
    let rawChannels: number[] = [];
    internal.wasm._dronesim_flight_step_raw = (...args) => {
      rawChannels = Array.from(new Float32Array(internal.wasm.HEAPU8.buffer, args[1], 8));
      return original(...args);
    };
    sim.setArmed(true);
    sim.step({ thrust: 0, throttle: 0.2, roll: 0.25, pitch: -0.5, yaw: 0.75,
      arm: true, reset: false, speedMultiplier: 1 }, 0.001, 0);
    const expected = [-0.6, 0.75, -0.5, 0.25, -1, -1, -1, 1];
    expect(rawChannels).toHaveLength(8);
    rawChannels.forEach((value, i) => expect(value).toBeCloseTo(expected[i]));
  });

  it("arms and produces lift under positive throttle", () => {
    sim.setArmed(true);
    expect(sim.getTelemetry().armed).toBe(false);

    // In Betaflight, throttle must be zero when arming to clear throttle arming prevention
    for (let i = 0; i < 50; i++) {
      sim.step(
        {
          thrust: 0,
          throttle: 0,
          roll: 0,
          pitch: 0,
          yaw: 0,
          arm: true,
          reset: false,
          speedMultiplier: 1,
        },
        0.001,
        0,
      );
    }

    // Now raise throttle to 100%
    expect(sim.getTelemetry().armed).toBe(true);
    for (let i = 0; i < 100; i++) {
      sim.step(
        {
          thrust: 1,
          throttle: 1,
          roll: 0,
          pitch: 0,
          yaw: 0,
          arm: true,
          reset: false,
          speedMultiplier: 1,
        },
        0.001,
        0,
      );
    }

    const telemetry = sim.getTelemetry();
    expect(telemetry.armed).toBe(true);
    // Rotor thrusts and RPMs should be non-zero
    const totalThrust = telemetry.rotorThrusts.reduce((a, b) => a + b, 0);
    expect(totalThrust).toBeGreaterThan(0.05);
    expect(telemetry.rotorRpms?.every((rpm) => rpm > 10000)).toBe(true);
    // Battery voltage should sag under load
    expect(telemetry.batteryVoltage).toBeLessThan(4.35);
  });

  it("keeps Betaflight disarmed when the arm switch is raised at full throttle", () => {
    sim.setArmed(true);
    for (let i = 0; i < 20; i++) {
      sim.step(
        {
          thrust: 1,
          throttle: 1,
          roll: 0,
          pitch: 0,
          yaw: 0,
          arm: true,
          reset: false,
          speedMultiplier: 1,
        },
        0.001,
        0,
      );
    }
    expect(sim.getTelemetry().armed).toBe(false);
    expect(sim.getTelemetry().rotorThrusts.every((thrust) => thrust === 0)).toBe(true);
  });

  it.each(["roll", "pitch", "yaw"] as const)("maps positive %s input to positive body rotation and damps when centered", (axis) => {
    const input = (roll: number, pitch: number, yaw: number, throttle: number) => ({
      thrust: 0, throttle, roll, pitch, yaw, arm: true, reset: false, speedMultiplier: 1,
    });
    sim.setArmed(true);
    for (let i = 0; i < 50; i++) sim.step(input(0, 0, 0, 0), 0.001, 0);
    for (let i = 0; i < 50; i++) sim.step(input(0, 0, 0, 0.5), 0.001, 0);
    let t = sim.getTelemetry();
    for (let i = 0; i < 80; i++) {
      t = sim.step(input(axis === "roll" ? 0.5 : 0, axis === "pitch" ? 0.5 : 0, axis === "yaw" ? 0.5 : 0, 0.5), 0.001, 0);
    }
    const readRate = (tel: typeof t) =>
      axis === "roll" ? tel.localAngularVelocity.x
        : axis === "pitch" ? tel.localAngularVelocity.y : tel.localAngularVelocity.z;
    const peakRate = readRate(t);
    expect(peakRate).toBeGreaterThan(0);

    for (let i = 0; i < 350; i++) {
      t = sim.step(input(0, 0, 0, 0.5), 0.001, 0);
    }
    expect(Math.abs(readRate(t))).toBeLessThan(peakRate * 0.25);
  });

  it.each(["roll", "pitch"] as const)("self-levels from a %s tilt in angle mode", (axis) => {
    const input = (roll: number, pitch: number, throttle: number) => ({
      thrust: 0, throttle, roll, pitch, yaw: 0, arm: true, reset: false, speedMultiplier: 1,
    });
    sim.switchFlightMode("angle");
    sim.setArmed(true);
    for (let i = 0; i < 50; i++) sim.step(input(0, 0, 0), 0.001, 0);
    for (let i = 0; i < 150; i++) {
      sim.step(input(axis === "roll" ? 0.4 : 0, axis === "pitch" ? 0.4 : 0, 0.5), 0.001, 0);
    }
    const tilted = sim.getTelemetry().localOrientation;
    const initialTilt = Math.abs(axis === "roll" ? tilted.x : tilted.y);
    expect(initialTilt).toBeGreaterThan(0.05);

    for (let i = 0; i < 500; i++) {
      sim.step(input(0, 0, 0.5), 0.001, 0);
    }
    const leveled = sim.getTelemetry().localOrientation;
    const finalTilt = Math.abs(axis === "roll" ? leveled.x : leveled.y);
    expect(finalTilt).toBeLessThan(initialTilt * 0.35);
  });

  it("resets position and disarms cleanly", () => {
    sim.setArmed(true);
    for (let i = 0; i < 50; i++) {
      sim.step(
        {
          thrust: 0,
          throttle: 0,
          roll: 0,
          pitch: 0,
          yaw: 0,
          arm: true,
          reset: false,
          speedMultiplier: 1,
        },
        0.001,
        0,
      );
    }
    expect(sim.getTelemetry().armed).toBe(true);
    sim.step(
      {
        thrust: 1,
        throttle: 1,
        roll: 0,
        pitch: 0,
        yaw: 0,
        arm: true,
        reset: false,
        speedMultiplier: 1,
      },
      0.001,
      0,
    );

    sim.reset();
    const telemetry = sim.getTelemetry();
    expect(telemetry.armed).toBe(false);
    expect(telemetry.localPosition.x).toBe(0);
    expect(telemetry.localPosition.y).toBe(0);
    expect(telemetry.localPosition.z).toBeCloseTo(1.0, 2);
    sim.step(
      {
        thrust: 0,
        throttle: 0,
        roll: 0,
        pitch: 0,
        yaw: 0,
        arm: false,
        reset: false,
        speedMultiplier: 1,
      },
      0.001,
      0,
    );
    expect(sim.getTelemetry().armed).toBe(false);
  });
});

it("selects the Betaflight backend through serializable simulation options", async () => {
  const engine = new SimulationEngine({ backend: "dronesim", config: Tinyhawk3Config });
  try {
    expect(engine.timestep).toBe(0.001);
    await engine.init({ x: 0, y: 0, z: 1 });
    expect(engine.getTelemetry().localPosition.z).toBeCloseTo(1);
  } finally {
    engine.dispose();
  }
});

describe("ImuSensorModel (TypeScript 6-axis MEMS IMU & 1.25s calibration)", () => {
  it("calibrates out turn-on gyro bias over 1.25s and restarts if moved", () => {
    const imu = new ImuSensorModel(Tinyhawk3Config.imu, 57000);
    expect(imu.isCalibrated()).toBe(false);
    expect(imu.getCalibrationCyclesRemaining()).toBe(1250);

    // Disturb the drone mid-calibration so stddev exceeds threshold -> restarts 1.25s window
    for (let i = 0; i < 1250; i++) {
      const rate = i < 600 ? 0.5 : 0;
      imu.sample({ x: rate, y: 0, z: 0 }, { x: 0, y: 0, z: 9.81 }, [0, 0, 0, 0], 0.001);
    }
    expect(imu.isCalibrated()).toBe(false);
    expect(imu.getCalibrationCyclesRemaining()).toBe(1250);

    // Hold stationary for 1.25s (1250 ticks at 1 ms)
    let lastSample = imu.sample({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 9.81 }, [0, 0, 0, 0], 0.001);
    for (let i = 1; i < 1250; i++) {
      lastSample = imu.sample({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 9.81 }, [0, 0, 0, 0], 0.001);
    }
    expect(imu.isCalibrated()).toBe(true);
    expect(lastSample.calibrated).toBe(true);

    const zero = imu.getCalibratedGyroZero();
    expect(zero.x).toBeCloseTo(Tinyhawk3Config.imu.gyroBias.x, 3);
    expect(zero.y).toBeCloseTo(Tinyhawk3Config.imu.gyroBias.y, 3);
    expect(zero.z).toBeCloseTo(Tinyhawk3Config.imu.gyroBias.z, 3);

    // Post-calibration stationary readings are centered near zero
    expect(Math.abs(lastSample.gyro.x)).toBeLessThan(0.01);
    expect(Math.abs(lastSample.gyro.y)).toBeLessThan(0.01);
    expect(Math.abs(lastSample.gyro.z)).toBeLessThan(0.01);
  });
});

