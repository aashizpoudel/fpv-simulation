import * as Cesium from "cesium";
import type { RotorAnimation } from "../rotor-animation";

export function rotorNodeTransformations(animation: RotorAnimation): Cesium.PropertyBag {
  const nodes: Record<string, Cesium.NodeTransformationProperty> = {};
  for (const rotor of animation.rotors) {
    nodes[`motor-${rotor.name}`] = new Cesium.NodeTransformationProperty({
      rotation: new Cesium.CallbackProperty((_time, result) =>
        Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, rotor.angle, result), false),
    });
    // Entity models expose node transforms rather than per-material opacity.
    // Blend in the translucent disc, then hide the individual blades at full blur.
    nodes[`blur-${rotor.name}`] = new Cesium.NodeTransformationProperty({
      scale: new Cesium.CallbackProperty((_time, result) =>
        Cesium.Cartesian3.fromElements(rotor.blur, rotor.blur, rotor.blur, result), false),
    });
    nodes[`blades-${rotor.name}`] = new Cesium.NodeTransformationProperty({
      scale: new Cesium.CallbackProperty((_time, result) => {
        const scale = rotor.blur >= 0.95 ? 0 : 1;
        return Cesium.Cartesian3.fromElements(scale, scale, scale, result);
      }, false),
    });
  }
  return new Cesium.PropertyBag(nodes);
}
