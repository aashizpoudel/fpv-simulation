import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import { externalCameraRig, headingRotation } from "../src/renderers/three/external-camera";

describe("external drone cameras", () => {
  it("frames a 10.5 cm drone nearby instead of metres away", () => {
    const rig = externalCameraRig(0.105);
    expect(rig.thirdOffset.length()).toBeLessThan(0.4);
    expect(rig.orbitOffset.length()).toBeLessThan(0.5);
    expect(rig.thirdTarget.length()).toBeLessThan(0.06);
    expect(rig.minOrbitDistance).toBeGreaterThan(0.1);
    expect(rig.orbitFov).toBe(55);
  });
  it("scales camera framing with the configured drone dimensions", () => {
    expect(externalCameraRig(0.21).orbitOffset.length())
      .toBeCloseTo(2 * externalCameraRig(0.105).orbitOffset.length());
  });
  it("keeps chase upright while following yaw through pitch and roll", () => {
    const pose = new Quaternion().setFromEuler(new Euler(0.8, 0.4, 1.2, "ZYX"));
    const heading = headingRotation(pose, new Quaternion());
    expect(new Vector3(0, 0, 1).applyQuaternion(heading).distanceTo(new Vector3(0, 0, 1)))
      .toBeLessThan(1e-10);
    expect(new Vector3(1, 0, 0).applyQuaternion(heading).x).toBeCloseTo(Math.cos(1.2));
  });
});
