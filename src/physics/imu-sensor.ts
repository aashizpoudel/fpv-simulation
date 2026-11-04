import type { ImuConfig } from "../config/drone-config";
import type { Vec3 } from "../types";

export interface ImuSample {
  gyro: Vec3;
  acc: Vec3;
  calibrated: boolean;
}

const TWO_PI = 2 * Math.PI;

/**
 * 6-axis MEMS IMU sensor model (e.g., InvenSense MPU-6000) in TypeScript.
 *
 * Models:
 * 1. Scale-factor error and turn-on zero-rate offset (`gyroBias`, `accBias`)
 * 2. Continuous-to-discrete Gaussian white noise (`gyroNoiseDensity`, `accNoiseDensity`)
 * 3. Bias random-walk drift (`gyroBiasRandomWalk`, `accBiasRandomWalk`)
 * 4. Rotor-RPM harmonic frame vibration (`gyroVibration`, `accVibration`)
 * 5. Initial 1.25s stationary gyroscope zero-offset calibration with movement detection
 */
export class ImuSensorModel {
  private prngState = 0;
  private spareNormal: number | null = null;

  private gyroWalk: Vec3 = { x: 0, y: 0, z: 0 };
  private accWalk: Vec3 = { x: 0, y: 0, z: 0 };
  private rotorPhases: [number, number, number, number] = [0, 0, 0, 0];

  private calibrated = false;
  private targetCycles = 1250;
  private cyclesRemaining = 1250;
  private calSum: Vec3 = { x: 0, y: 0, z: 0 };
  private calSumSq: Vec3 = { x: 0, y: 0, z: 0 };
  private gyroZero: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly config: ImuConfig,
    private readonly maxRpm = 57000,
  ) {
    this.reset();
  }

  public isCalibrated(): boolean {
    return this.calibrated;
  }

  public getCalibratedGyroZero(): Vec3 {
    return { ...this.gyroZero };
  }

  public getCalibrationCyclesRemaining(): number {
    return this.cyclesRemaining;
  }

  public reset(dt = 0.001): void {
    this.prngState = (this.config.seed | 0) || 1;
    this.spareNormal = null;
    this.gyroWalk = { x: 0, y: 0, z: 0 };
    this.accWalk = { x: 0, y: 0, z: 0 };
    this.rotorPhases = [0, 0, 0, 0];
    this.gyroZero = { x: 0, y: 0, z: 0 };
    this.startCalibration(dt);
  }

  public startCalibration(dt = 0.001): void {
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0.001;
    this.targetCycles = Math.max(1, Math.round(this.config.calibrationDuration / safeDt));
    this.cyclesRemaining = this.targetCycles;
    this.calSum = { x: 0, y: 0, z: 0 };
    this.calSumSq = { x: 0, y: 0, z: 0 };
    this.calibrated = false;
  }

  /**
   * Sample noisy gyroscope (rad/s) and accelerometer (m/s^2) measurements.
   * While uncalibrated, accumulates samples over `calibrationDuration` (1.25s),
   * checks standard deviation against `calibrationMovementThreshold`, and
   * locks in `gyroZero` once stationary calibration completes.
   */
  public sample(
    trueGyro: Vec3,
    trueAcc: Vec3,
    rotorRpms: readonly number[],
    dt: number,
  ): ImuSample {
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0.001;
    const sqrtDt = Math.sqrt(safeDt);
    const invSqrt2Dt = 1 / Math.sqrt(2 * safeDt);

    // 1. Update random-walk bias drift
    const gwSigma = this.config.gyroBiasRandomWalk * sqrtDt;
    this.gyroWalk.x += gwSigma * this.nextGaussian();
    this.gyroWalk.y += gwSigma * this.nextGaussian();
    this.gyroWalk.z += gwSigma * this.nextGaussian();

    const awSigma = this.config.accBiasRandomWalk * sqrtDt;
    this.accWalk.x += awSigma * this.nextGaussian();
    this.accWalk.y += awSigma * this.nextGaussian();
    this.accWalk.z += awSigma * this.nextGaussian();

    // 2. Advance rotor electrical/mechanical phases and synthesize frame harmonics
    let vibX = 0;
    let vibY = 0;
    let vibZ = 0;
    const invMaxRpm = this.maxRpm > 0 ? 1 / this.maxRpm : 0;

    for (let i = 0; i < 4; i++) {
      const rpm = Math.max(0, rotorRpms[i] ?? 0);
      const omega = (rpm * TWO_PI) / 60;
      const phase = (this.rotorPhases[i] + omega * safeDt) % TWO_PI;
      this.rotorPhases[i] = phase;
      const amp = Math.min(1, rpm * invMaxRpm) ** 2 * 0.25;
      vibX += amp * Math.sin(phase);
      vibY += amp * Math.cos(phase);
      vibZ += amp * Math.sin(2 * phase);
    }

    // 3. White Gaussian noise
    const gNoiseSigma = this.config.gyroNoiseDensity * invSqrt2Dt;
    const aNoiseSigma = this.config.accNoiseDensity * invSqrt2Dt;

    const rawGyro: Vec3 = {
      x:
        (1 + this.config.gyroScaleError.x) * trueGyro.x +
        this.config.gyroBias.x +
        this.gyroWalk.x +
        gNoiseSigma * this.nextGaussian() +
        this.config.gyroVibration * vibX,
      y:
        (1 + this.config.gyroScaleError.y) * trueGyro.y +
        this.config.gyroBias.y +
        this.gyroWalk.y +
        gNoiseSigma * this.nextGaussian() +
        this.config.gyroVibration * vibY,
      z:
        (1 + this.config.gyroScaleError.z) * trueGyro.z +
        this.config.gyroBias.z +
        this.gyroWalk.z +
        gNoiseSigma * this.nextGaussian() +
        this.config.gyroVibration * vibZ,
    };

    const rawAcc: Vec3 = {
      x:
        (1 + this.config.accScaleError.x) * trueAcc.x +
        this.config.accBias.x +
        this.accWalk.x +
        aNoiseSigma * this.nextGaussian() +
        this.config.accVibration * vibX,
      y:
        (1 + this.config.accScaleError.y) * trueAcc.y +
        this.config.accBias.y +
        this.accWalk.y +
        aNoiseSigma * this.nextGaussian() +
        this.config.accVibration * vibY,
      z:
        (1 + this.config.accScaleError.z) * trueAcc.z +
        this.config.accBias.z +
        this.accWalk.z +
        aNoiseSigma * this.nextGaussian() +
        this.config.accVibration * vibZ,
    };

    // 4. Perform 1.25s startup gyroscope calibration in TypeScript
    if (!this.calibrated) {
      this.calSum.x += rawGyro.x;
      this.calSum.y += rawGyro.y;
      this.calSum.z += rawGyro.z;
      this.calSumSq.x += rawGyro.x * rawGyro.x;
      this.calSumSq.y += rawGyro.y * rawGyro.y;
      this.calSumSq.z += rawGyro.z * rawGyro.z;
      this.cyclesRemaining -= 1;

      if (this.cyclesRemaining <= 0) {
        const n = this.targetCycles;
        const meanX = this.calSum.x / n;
        const meanY = this.calSum.y / n;
        const meanZ = this.calSum.z / n;
        const stdX = Math.sqrt(Math.max(0, this.calSumSq.x / n - meanX * meanX));
        const stdY = Math.sqrt(Math.max(0, this.calSumSq.y / n - meanY * meanY));
        const stdZ = Math.sqrt(Math.max(0, this.calSumSq.z / n - meanZ * meanZ));
        const threshold = this.config.calibrationMovementThreshold;

        if (stdX > threshold || stdY > threshold || stdZ > threshold) {
          // Motion exceeded threshold during calibration — restart 1.25s window
          this.startCalibration(safeDt);
        } else {
          this.gyroZero = { x: meanX, y: meanY, z: meanZ };
          this.calibrated = true;
        }
      }
    }

    return {
      gyro: {
        x: rawGyro.x - this.gyroZero.x,
        y: rawGyro.y - this.gyroZero.y,
        z: rawGyro.z - this.gyroZero.z,
      },
      acc: rawAcc,
      calibrated: this.calibrated,
    };
  }

  private nextUniform(): number {
    // Mulberry32 deterministic PRNG in (0, 1)
    let t = (this.prngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return u <= 1e-12 ? 1e-12 : u;
  }

  private nextGaussian(): number {
    if (this.spareNormal !== null) {
      const val = this.spareNormal;
      this.spareNormal = null;
      return val;
    }
    const u1 = this.nextUniform();
    const u2 = this.nextUniform();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    const angle = TWO_PI * u2;
    this.spareNormal = mag * Math.sin(angle);
    return mag * Math.cos(angle);
  }
}
