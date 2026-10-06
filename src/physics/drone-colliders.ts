import RAPIER, { ColliderDesc } from "@dimforge/rapier3d-compat";
import type { DroneConfig } from "../config/tinyhawk-config";

export function createDroneColliders(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  config: DroneConfig,
): RAPIER.Collider[] {
  const droneColliders: RAPIER.Collider[] = [];
  const halfExtents = {
    x: config.length / 2,
    y: config.width / 2,
    z: config.height / 2,
  };

  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    halfExtents.x,
    halfExtents.y,
    halfExtents.z,
  )
    .setMass(0)
    .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
    .setFriction(config.body.friction)
    .setRestitution(config.body.restitution);

  if (config.body.collisionShape === "ducts") {
    // Central battery/canopy plus four short Z-axis cylinders. Duct interiors
    // remain solid; this approximation avoids the old square outer corners.
    const bodyCollider = ColliderDesc.cuboid(0.018, 0.012, halfExtents.z);
    const shapes = [
      bodyCollider,
      ...config.rotors.map((r) =>
        ColliderDesc.cylinder(
          config.body.ductHeight / 2,
          config.body.ductRadius,
        )
          .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 })
          .setTranslation(r.position.x, r.position.y, r.position.z),
      ),
    ];
    for (const shape of shapes)
      droneColliders.push(
        world.createCollider(
          shape
            .setMass(0)
            .setFriction(config.body.friction)
            .setRestitution(config.body.restitution)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
          body,
        ),
      );
  } else droneColliders.push(world.createCollider(colliderDesc, body));
  return droneColliders;
}
