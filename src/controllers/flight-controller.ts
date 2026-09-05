import type { Controls, DroneTelemetry } from "../types";
import type { DroneConfig } from "../config/drone-config";
import type {
  ControllerTelemetry,
  IController,
  PhysicsCommand,
} from "./controller-interface";
import type { IFlightMode } from "./modes/flight-mode-interface";
import { ThrottleManager } from "./throttle-manager";
import { MotorMixer } from "./motor-mixer";
import { MotorModel } from "../physics/motor-model";
import { conjugateQuat, rotateVector } from "./math-utils";

export class FlightController implements IController {
  private throttleManager: ThrottleManager;
  private mixer: MotorMixer;
  private motors: MotorModel[];
  private thrusts: number[];
  private commands: number[];
  constructor(
    config: DroneConfig,
    private mode: IFlightMode,
  ) {
    this.throttleManager = new ThrottleManager(config.throttleRate);
    this.mixer = new MotorMixer(
      config.rotors,
      config.propulsion,
      config.yawTorquePerNewton,
      config.body.centerOfMass,
    );
    this.motors = config.rotors.map(
      (r) => new MotorModel(config.propulsion, r.maxThrust),
    );
    this.thrusts = this.motors.map(() => 0);
    this.commands = [...this.thrusts];
  }
  computePhysicsCommand(
    controls: Controls,
    telemetry: DroneTelemetry,
    dt: number,
  ): PhysicsCommand {
    const throttle = telemetry.armed
      ? this.throttleManager.update(
          controls.thrust,
          controls.speedMultiplier,
          dt,
          controls.throttle,
        )
      : 0;
    if (telemetry.armed) {
      const output = this.mode.compute({
        controls,
        bodyAngularVelocity: rotateVector(
          conjugateQuat(telemetry.localOrientation),
          telemetry.localAngularVelocity,
        ),
        orientation: telemetry.localOrientation,
        throttle,
        dt,
        saturation: this.mixer.saturation,
      });
      this.commands = this.mixer.mix(
        throttle,
        output.roll,
        output.pitch,
        output.yaw,
      );
    } else {
      this.commands.fill(0);
    }
    this.thrusts = this.motors.map((motor, i) =>
      motor.step(this.commands[i], telemetry.batteryVoltage ?? 3.8, dt),
    );
    return {
      ...this.mixer.computeForces(this.thrusts, telemetry.localOrientation),
      angularVelocity: { x: 0, y: 0, z: 0 },
      resetForces: true,
    };
  }
  disarm(): void {
    this.throttleManager.reset();
    this.mode.reset();
    this.mixer.reset();
    this.commands.fill(0);
  }
  switchMode(mode: IFlightMode): void {
    this.mode.reset();
    this.mode = mode;
    this.mixer.reset();
  }
  reset(): void {
    this.disarm();
    this.motors.forEach((m) => m.reset());
    this.thrusts.fill(0);
  }
  getMotorOutputs(): number[] {
    return this.motors.map((m) => m.output);
  }
  getTelemetry(): ControllerTelemetry {
    return {
      throttlePercent: this.throttleManager.throttle * 100,
      rotorThrusts: [...this.thrusts],
      motorCommands: [...this.commands],
      saturation: { ...this.mixer.saturation },
    };
  }
}
