/*
  FlightController — modular composer that replaces AcroController.
  Delegates to: ThrottleManager, MotorMixer, and a pluggable IFlightMode.
*/

import type { Controls, DroneTelemetry, Vec3 } from "../types";
import type { ControllerTelemetry, IController, PhysicsCommand } from "./controller-interface";
import type { IFlightMode } from "./modes/flight-mode-interface";
import { ThrottleManager } from "./throttle-manager";
import { MotorMixer } from "./motor-mixer";
import { conjugateQuat, rotateVector } from "./math-utils";

type FlightControllerConfig = {
  throttleRate: number;
  maxThrustPerRotor: number;
  rotorMode: boolean;
  yawTorquePerNewton: number;
};

export class FlightController implements IController {
  private readonly throttleManager: ThrottleManager;
  private readonly mixer: MotorMixer;
  private mode: IFlightMode;

  constructor(
    rotorPositions: Vec3[],
    config: FlightControllerConfig,
    initialMode: IFlightMode,
  ) {
    this.throttleManager = new ThrottleManager(config.throttleRate);
    this.mixer = new MotorMixer(
      rotorPositions,
      config.maxThrustPerRotor,
      config.yawTorquePerNewton,
      config.rotorMode,
    );
    this.mode = initialMode;
  }

  computePhysicsCommand(
    controls: Controls,
    telemetry: DroneTelemetry,
    dt: number,
  ): PhysicsCommand {
    // 1. Update throttle
    const throttle = this.throttleManager.update(
      controls.thrust,
      controls.speedMultiplier,
      dt,
    );

    // 2. Convert world angular velocity to body frame
    const conjQ = conjugateQuat(telemetry.localOrientation);
    const bodyAngVel = rotateVector(conjQ, telemetry.localAngularVelocity);

    // 3. Run flight mode
    const modeOutput = this.mode.compute({
      controls,
      bodyAngularVelocity: bodyAngVel,
      orientation: telemetry.localOrientation,
      throttle,
      dt,
    });

    // 4. Mix into per-rotor thrusts
    const rotorThrusts = this.mixer.mix(
      throttle,
      modeOutput.roll,
      modeOutput.pitch,
      modeOutput.yaw,
    );

    // 5. Compute world-space forces and torques
    const { force, torque } = this.mixer.computeForces(
      rotorThrusts,
      telemetry.localOrientation,
    );

    // 6. Return physics command
    return {
      force,
      torque,
      angularVelocity: { x: 0, y: 0, z: 0 },
      resetForces: true,
    };
  }

  switchMode(mode: IFlightMode): void {
    this.mode.reset();
    this.mode = mode;
  }

  reset(): void {
    this.throttleManager.reset();
    this.mixer.reset();
    this.mode.reset();
  }

  getTelemetry(): ControllerTelemetry {
    return {
      throttlePercent: this.throttleManager.throttle * 100,
      rotorThrusts: this.mixer.getRotorThrusts(),
    };
  }
}
