import { describe, expect, it } from "vitest";
import * as THREE from "three";
import * as Cesium from "cesium";
import { RotorAnimation } from "../src/renderers/rotor-animation";
import { RotorMeshAnimation } from "../src/renderers/three/rotor-mesh-animation";
import { rotorNodeTransformations } from "../src/renderers/cesium/rotor-node-animation";
import { Tinyhawk3Config } from "../src/config/tinyhawk-config";
import type { DroneTelemetry } from "../src/types";

function frame(speeds: number[], armed = true): DroneTelemetry {
  return {
    localPosition: { x: 0, y: 0, z: 0 },
    localOrientation: { x: 0, y: 0, z: 0, w: 1 },
    localVelocity: { x: 0, y: 0, z: 0 },
    localAngularVelocity: { x: 0, y: 0, z: 0 },
    gforce: 1, throttle: 0, crashed: false, armed,
    rotorThrusts: speeds.map((speed, i) => speed ** 2 * Tinyhawk3Config.rotors[i].maxThrust),
  };
}

describe("rotor animation", () => {
  it("uses each motor's actual thrust and alternating rotation direction", () => {
    const animation = new RotorAnimation(Tinyhawk3Config);
    const telemetry = frame([0.1, 0.2, 0.3, 0.4]);
    animation.update(telemetry, 0);
    animation.update(telemetry, 20);
    const angles = animation.rotors.map((rotor) => rotor.angle);
    [0.19, -0.38, 0.57, -0.76].forEach((value, i) => expect(angles[i]).toBeCloseTo(value));
    expect(animation.rotors[0].blur).toBe(0);
    expect(animation.rotors[3].blur).toBeGreaterThan(animation.rotors[1].blur);
  });

  it("keeps coasting on disarm and stops when physical thrust reaches zero", () => {
    const animation = new RotorAnimation(Tinyhawk3Config);
    animation.update(frame([0.8, 0.8, 0.8, 0.8]), 0);
    animation.update(frame([0.2, 0.2, 0.2, 0.2], false), 20);
    expect(animation.rotors[0].angle).toBeGreaterThan(0);
    const angle = animation.rotors[0].angle;
    animation.update(frame([0, 0, 0, 0], false), 40);
    animation.update(frame([0, 0, 0, 0], false), 60);
    expect(animation.rotors[0].angle).toBe(angle);
    expect(animation.rotors[0].blur).toBe(0);
  });

  it("is frame-rate independent and limits jumps after a suspended tab", () => {
    const run = (step: number) => {
      const animation = new RotorAnimation(Tinyhawk3Config);
      for (let now = 0; now <= 1000; now += step) animation.update(frame([0.5, 0.5, 0.5, 0.5]), now);
      return animation;
    };
    expect(run(10).rotors[0].angle).toBeCloseTo(run(20).rotors[0].angle);
    const animation = new RotorAnimation(Tinyhawk3Config);
    animation.update(frame([0.1, 0.1, 0.1, 0.1]), 0);
    animation.update(frame([0.1, 0.1, 0.1, 0.1]), 60000);
    expect(animation.rotors[0].angle).toBeCloseTo(0.95);
  });

  it("handles absent or invalid thrust without leaving a spinning propeller", () => {
    const animation = new RotorAnimation(Tinyhawk3Config);
    const telemetry = frame([0.7, 0.7, 0.7, 0.7]);
    animation.update(telemetry, 0);
    telemetry.rotorThrusts = [NaN, -1];
    animation.update(telemetry, 20);
    expect(animation.rotors.every((rotor) => rotor.angle === 0 && rotor.blur === 0)).toBe(true);
  });

  it("updates Three.js rotation, fades blades, and restores them at rest", () => {
    const animation = new RotorAnimation(Tinyhawk3Config);
    const model = new THREE.Group();
    for (const rotor of animation.rotors) {
      const motor = new THREE.Group();
      motor.name = `motor-${rotor.name}`;
      const blades = new THREE.Group();
      blades.name = `blades-${rotor.name}`;
      blades.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.88 })));
      motor.add(blades);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
      disc.name = `blur-${rotor.name}`;
      model.add(motor, disc);
    }
    const meshes = new RotorMeshAnimation(model, animation);
    const disc = model.getObjectByName("blur-frontRight") as THREE.Mesh;
    expect(disc.visible).toBe(false);
    animation.update(frame([0.8, 0, 0, 0]), 0);
    animation.update(frame([0.8, 0, 0, 0]), 20);
    meshes.update();
    expect(model.getObjectByName("motor-frontRight")!.rotation.y).not.toBe(0);
    expect(model.getObjectByName("motor-frontLeft")!.rotation.y).toBe(0);
    expect(disc.visible).toBe(true);
    expect(model.getObjectByName("blur-frontLeft")!.visible).toBe(false);
    const blade = model.getObjectByName("blades-frontRight")!.children[0] as THREE.Mesh;
    expect((blade.material as THREE.Material).opacity).toBeLessThan(0.2);
    animation.update(frame([0, 0, 0, 0], false), 40);
    meshes.update();
    expect(disc.visible).toBe(false);
    expect((blade.material as THREE.Material).opacity).toBe(0.88);
    expect((blade.material as THREE.Material).depthWrite).toBe(true);
  });

  it("provides live Cesium node transforms for each motor and blur disc", () => {
    const animation = new RotorAnimation(Tinyhawk3Config);
    const properties = rotorNodeTransformations(animation);
    const time = Cesium.JulianDate.now();
    expect(properties.getValue(time)["blur-frontRight"].scale.x).toBe(0);
    animation.update(frame([0.8, 0, 0, 0]), 0);
    animation.update(frame([0.8, 0, 0, 0]), 20);
    const nodes = properties.getValue(time);
    expect(nodes["motor-frontRight"].rotation.y).not.toBe(0);
    expect(nodes["motor-frontLeft"].rotation.y).toBe(0);
    expect(nodes["blur-frontRight"].scale.x).toBe(1);
    expect(nodes["blades-frontRight"].scale.x).toBe(0);
    animation.update(frame([0, 0, 0, 0], false), 40);
    expect(properties.getValue(time)["blur-frontRight"].scale.x).toBe(0);
    expect(properties.getValue(time)["blades-frontRight"].scale.x).toBe(1);
  });
});
