/*
Mixes acro input into per-rotor thrust and applies impulses to a Rapier body.
Flow: integrate throttle -> mix roll/pitch/yaw per rotor -> apply impulses at
rotor offsets each step.

Usage example:
const controller = new AcroController(rotorPositions, config);
controller.update(controls, deltaTime);
controller.applyForces(body, deltaTime);
*/
import type { RigidBody } from "@dimforge/rapier3d-compat";
import type { Controls, Vec3, Quaternion } from "./types";

type RotorConfig = {
    position: Vec3;
    yawSign: number;
};

type AcroConfig = {
    maxThrustPerRotor: number;
    throttleRate: number;
    stickRate: number;
    rotorMode: boolean;
};

// Acro controller mixes input into per-rotor thrust and applies impulses.
export class AcroController {
    private readonly rotors: RotorConfig[];
    private readonly config: AcroConfig;
    private throttle = 0;
    private rotorThrusts: number[];

    constructor(rotorPositions: Vec3[], config: AcroConfig) {
        this.rotors = assignYawSigns(rotorPositions);
        this.config = {
            ...config,
            rotorMode: config.rotorMode ?? true,
        };
        this.rotorThrusts = new Array(this.rotors.length).fill(0);
    }

    reset() {
        this.throttle = 0;
        this.rotorThrusts.fill(0);
    }

    // Convert stick inputs into rotor thrusts (normalized 0..1 mix).
    update(controls: Controls, deltaTime: number) {
        const throttleDelta =
            controls.thrust *
            this.config.throttleRate *
            deltaTime *
            controls.speedMultiplier;
        this.throttle = clamp(this.throttle + throttleDelta, 0, 1);

        const pitch = controls.pitch * this.config.stickRate;
        const roll = controls.roll * this.config.stickRate;
        const yaw = controls.yaw * this.config.stickRate;

        this.rotors.forEach((rotor, index) => {
            const pitchMix = rotor.position.y >= 0 ? -pitch : pitch;
            const rollMix = rotor.position.x >= 0 ? -roll : roll;
            const yawMix = rotor.yawSign * yaw;
            const mixed = clamp(
                this.throttle + pitchMix + rollMix + yawMix,
                0,
                1,
            );
            this.rotorThrusts[index] = mixed * this.config.maxThrustPerRotor;
        });
    }

    // Apply per-rotor impulses in the body's up direction.
    applyForces(body: RigidBody, deltaTime: number) {
        const rotation = body.rotation();
        const up = rotateVector(rotation, { x: 0, y: 0, z: 1 });

        if (this.config.rotorMode) {
            this.applyRotorForces(body, rotation, up, deltaTime);
        } else {
            this.applyBodyForces(body, rotation, up, deltaTime);
        }
    }

    getThrottlePercent() {
        return this.throttle * 100;
    }

    getRotorThrusts() {
        // Return a copy so callers cannot mutate internal state.
        return [...this.rotorThrusts];
    }

    private applyRotorForces(
        body: RigidBody,
        rotation: Quaternion,
        up: Vec3,
        deltaTime: number,
    ) {
        const translation = body.translation();
        this.rotors.forEach((rotor, index) => {
            const thrust = this.rotorThrusts[index];
            if (thrust <= 0) {
                return;
            }

            const worldOffset = rotateVector(rotation, rotor.position);
            const point = {
                x: translation.x + worldOffset.x,
                y: translation.y + worldOffset.y,
                z: translation.z + worldOffset.z,
            };
            const impulse = {
                x: up.x * thrust * deltaTime,
                y: up.y * thrust * deltaTime,
                z: up.z * thrust * deltaTime,
            };

            body.applyImpulseAtPoint(impulse, point, true);
        });
    }

    private applyBodyForces(
        body: RigidBody,
        rotation: Quaternion,
        up: Vec3,
        deltaTime: number,
    ) {
        const totalImpulse = { x: 0, y: 0, z: 0 };
        const totalTorque = { x: 0, y: 0, z: 0 };

        this.rotors.forEach((rotor, index) => {
            const thrust = this.rotorThrusts[index];
            if (thrust <= 0) {
                return;
            }
            const impulse = {
                x: up.x * thrust * deltaTime,
                y: up.y * thrust * deltaTime,
                z: up.z * thrust * deltaTime,
            };
            const worldOffset = rotateVector(rotation, rotor.position);
            const torque = cross(worldOffset, impulse);

            totalImpulse.x += impulse.x;
            totalImpulse.y += impulse.y;
            totalImpulse.z += impulse.z;

            totalTorque.x += torque.x;
            totalTorque.y += torque.y;
            totalTorque.z += torque.z;
        });

        body.applyImpulse(totalImpulse, true);
        body.applyTorqueImpulse(totalTorque, true);
    }
}

function assignYawSigns(rotorPositions: Vec3[]): RotorConfig[] {
    const ordered = [...rotorPositions].sort(
        (a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x),
    );
    return ordered.map((position, index) => ({
        position,
        yawSign: index % 2 === 0 ? 1 : -1,
    }));
}

function rotateVector(rotation: Quaternion, vector: Vec3): Vec3 {
    const { x: qx, y: qy, z: qz, w: qw } = rotation;
    const { x: vx, y: vy, z: vz } = vector;

    const ix = qw * vx + qy * vz - qz * vy;
    const iy = qw * vy + qz * vx - qx * vz;
    const iz = qw * vz + qx * vy - qy * vx;
    const iw = -qx * vx - qy * vy - qz * vz;

    return {
        x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
        y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
        z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
    };
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
