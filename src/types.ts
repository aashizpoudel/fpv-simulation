/*
Shared types for drone simulation state + rendering handoff.
Flow: physics emits telemetry -> main maps to pose -> renderer consumes pose.

Usage example:
import type { DronePose, Controls } from "./types";
const controls: Controls = { thrust: 0, pitch: 0, roll: 0, yaw: 0, speedMultiplier: 1 };
*/
import type * as Cesium from "cesium";

// Shared simulation types.
export type Vec3 = {
    x: number;
    y: number;
    z: number;
};

export type Quaternion = {
    x: number;
    y: number;
    z: number;
    w: number;
};

export type DroneTelemetry = {
    localPosition: Vec3;
    localOrientation: Quaternion;
    localVelocity: Vec3;
    gforce: number;
    throttle: number;
    rotorThrusts: number[];
    crashed: boolean;
};

export type DronePose = {
    phy_position: Vec3;
    phy_orientation: Cesium.Quaternion;
    position: Cesium.Cartesian3;
    orientation: Cesium.Quaternion;
    velocity: Cesium.Cartesian3;
    gforce: number;
    throttle: number;
    rotorThrusts: number[];
    crashed: boolean;
};

export type Controls = {
    thrust: number;
    pitch: number;
    roll: number;
    yaw: number;
    speedMultiplier: number;
};

export type CameraMode = "fpv" | "chase" | "free";
