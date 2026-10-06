import type { DroneConfig } from "../config/drone-config";
import type { CameraAudioOrientation, CameraMode, DroneTelemetry, Vec3 } from "../types";
import { clamp } from "../controllers/math-utils";

const MOTOR_AUDIO_URL = `${import.meta.env.BASE_URL}audio/drone/motor-steady-loop.wav`;

export function motorPlaybackRate(speed: number): number {
  // The recording already contains a running quad. Keep hover near its native
  // pitch instead of turning motor RPM into an exposed electronic whistle.
  return 0.55 + 0.6 * clamp(speed, 0, 1.2);
}

export function droneAudioParameters(
  telemetry: DroneTelemetry, config: DroneConfig, cameraMode: CameraMode, cameraPosition?: Vec3,
) {
  // Thrust is proportional to RPM squared; it already includes voltage and spool time.
  const rotorSpeeds = config.rotors.map((rotor, i) =>
    Math.sqrt(clamp((telemetry.rotorThrusts[i] ?? 0) / Math.max(1e-6, rotor.maxThrust), 0, 1.44)));
  const energy = rotorSpeeds.reduce((sum, value) => sum + value, 0) / Math.max(1, rotorSpeeds.length);
  const speed = Math.hypot(telemetry.localVelocity.x, telemetry.localVelocity.y, telemetry.localVelocity.z);
  const distance = cameraPosition
    ? Math.hypot(cameraPosition.x - telemetry.localPosition.x,
        cameraPosition.y - telemetry.localPosition.y, cameraPosition.z - telemetry.localPosition.z)
    : 0;
  const distanceGain = cameraMode === "fpv"
    ? 1 : 1 / (1 + (Math.max(0, distance - 0.2) / 3.5) ** 1.35);
  return {
    rotorSpeeds, energy,
    // Rotor envelopes supply the load-dependent gain, once per motor.
    motorGain: (cameraMode === "fpv" ? 0.85 : 1.2) * distanceGain,
    windGain: cameraMode === "fpv" ? clamp((speed - 1) / 13, 0, 1) * 0.12 : 0,
    filterHz: 1800 + 4200 * clamp(energy, 0, 1),
  };
}
export type DroneAudioParameters = ReturnType<typeof droneAudioParameters>;
type RotorVoice = { source: AudioBufferSourceNode; gain: GainNode };

export class DroneAudioEngine {
  private context?: AudioContext;
  private outputGain?: GainNode;
  private volume = 1;
  private prepared?: Promise<ArrayBuffer>;
  private rotors: RotorVoice[] = [];
  private noiseSource?: AudioBufferSourceNode;
  private motorGain?: GainNode;
  private windGain?: GainNode;
  private motorFilter?: BiquadFilterNode;
  private onboardGain?: GainNode;
  private externalGain?: GainNode;
  private panner?: PannerNode;
  private disposed = false;
  private suspended = false;

  constructor(private config: DroneConfig) {}

  setVolume(value: number): void {
    this.volume = Number.isFinite(value) ? clamp(value, 0, 1) : 1;
    if (this.context && this.outputGain) {
      const now = this.context.currentTime;
      const current = this.outputGain.gain.value;
      this.outputGain.gain.cancelScheduledValues(now);
      this.outputGain.gain.setValueAtTime(current, now);
      this.outputGain.gain.linearRampToValueAtTime(this.volume, now + 0.02);
    }
  }

  preload(): void {
    if (this.prepared) return;
    this.prepared = fetch(MOTOR_AUDIO_URL).then(response => {
      if (!response.ok) throw new Error(`Could not load motor texture (${response.status})`);
      return response.arrayBuffer();
    });
    void this.prepared.catch(() => undefined);
  }

  async start(): Promise<void> {
    if (this.disposed || this.context || typeof AudioContext === "undefined") return;
    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    try {
      this.preload();
      await context.resume();
      const motorBuffer = await context.decodeAudioData((await this.prepared!).slice(0));
      if (this.disposed) return;
      this.buildGraph(context, motorBuffer);
      if (this.suspended) await context.suspend();
    } catch (error) {
      console.warn("Drone audio is unavailable:", error);
      await context.close().catch(() => undefined);
      this.prepared = undefined;
      if (this.context === context) this.context = undefined;
    }
  }

  update(telemetry: DroneTelemetry, cameraMode: CameraMode, cameraPosition?: Vec3,
    orientation?: CameraAudioOrientation): void {
    const context = this.context;
    if (!context || !this.motorGain || !this.windGain || !this.motorFilter || !this.panner) return;
    const parameters = droneAudioParameters(telemetry, this.config, cameraMode, cameraPosition);
    const now = context.currentTime;
    for (let i = 0; i < this.rotors.length; i++) {
      const speed = parameters.rotorSpeeds[i];
      this.rotors[i].source.playbackRate.setTargetAtTime(motorPlaybackRate(speed), now, 0.035);
      this.rotors[i].gain.gain.setTargetAtTime(speed ** 0.8 / this.rotors.length, now, 0.02);
    }
    this.motorGain.gain.setTargetAtTime(parameters.motorGain, now, 0.025);
    this.windGain.gain.setTargetAtTime(parameters.windGain, now, 0.08);
    this.motorFilter.frequency.setTargetAtTime(parameters.filterHz, now, 0.025);
    const external = cameraMode !== "fpv" && !!cameraPosition;
    this.onboardGain!.gain.setTargetAtTime(external ? 0 : 1, now, 0.02);
    this.externalGain!.gain.setTargetAtTime(external ? 1 : 0, now, 0.02);
    if (external) {
      const listener = context.listener;
      const forward = orientation?.forward ?? { x: 1, y: 0, z: 0 };
      const up = orientation?.up ?? { x: 0, y: 0, z: 1 };
      if (listener.positionX) {
        this.setVector(listener.positionX, listener.positionY, listener.positionZ, cameraPosition!, now);
        this.setVector(listener.forwardX, listener.forwardY, listener.forwardZ, forward, now);
        this.setVector(listener.upX, listener.upY, listener.upZ, up, now);
      } else {
        // Firefox exposes the legacy listener methods instead of AudioParams.
        listener.setPosition(cameraPosition!.x, cameraPosition!.y, cameraPosition!.z);
        listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
      }
      const position = telemetry.localPosition;
      if (this.panner.positionX) {
        this.setVector(this.panner.positionX, this.panner.positionY, this.panner.positionZ, position, now);
      } else {
        this.panner.setPosition(position.x, position.y, position.z);
      }
    }
  }

  async setSuspended(suspended: boolean): Promise<void> {
    this.suspended = suspended;
    if (!this.context) return;
    if (suspended) await this.context.suspend();
    else await this.context.resume();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const rotor of this.rotors) rotor.source.stop();
    this.noiseSource?.stop();
    this.rotors = [];
    const context = this.context;
    this.context = undefined;
    if (context) void context.close().catch(() => undefined);
  }

  private setVector(x: AudioParam, y: AudioParam, z: AudioParam, value: Vec3, now: number): void {
    x.setValueAtTime(value.x, now);
    y.setValueAtTime(value.y, now);
    z.setValueAtTime(value.z, now);
  }

  private buildGraph(context: AudioContext, motorBuffer: AudioBuffer): void {
    this.motorGain = context.createGain();
    this.windGain = context.createGain();
    this.onboardGain = context.createGain();
    this.externalGain = context.createGain();
    this.motorFilter = context.createBiquadFilter();
    this.panner = context.createPanner();
    const master = context.createDynamicsCompressor();
    this.outputGain = context.createGain();
    this.outputGain.gain.value = this.volume;
    this.motorGain.gain.value = this.windGain.gain.value = 0;
    this.onboardGain.gain.value = this.externalGain.gain.value = 0;
    this.motorFilter.type = "lowpass";
    this.motorFilter.frequency.value = 1200;
    this.motorFilter.Q.value = 0.7;
    this.panner.panningModel = "HRTF";
    // Apply distance attenuation only once, in droneAudioParameters.
    this.panner.rolloffFactor = 0;
    master.threshold.value = -9;
    master.knee.value = 12;
    master.ratio.value = 3;
    master.attack.value = 0.004;
    master.release.value = 0.12;
    this.motorGain.connect(this.motorFilter);
    this.motorFilter.connect(this.onboardGain).connect(master);
    this.motorFilter.connect(this.panner).connect(this.externalGain).connect(master);
    this.windGain.connect(master);
    master.connect(this.outputGain).connect(context.destination);

    // Use the leveled real propeller texture at different offsets. Four voices
    // preserve mixer response without layering phase-locked synthetic tones.
    this.rotors = this.config.rotors.map((_, i) => {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = motorBuffer;
      source.loop = true;
      source.playbackRate.value = motorPlaybackRate(0);
      gain.gain.value = 0;
      source.connect(gain).connect(this.motorGain!);
      source.start(context.currentTime, motorBuffer.duration * i / this.config.rotors.length);
      return { source, gain };
    });

    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseSource = context.createBufferSource();
    this.noiseSource.buffer = buffer;
    this.noiseSource.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 650;
    windFilter.Q.value = 0.5;
    this.noiseSource.connect(windFilter).connect(this.windGain);
    this.noiseSource.start();
  }
}
