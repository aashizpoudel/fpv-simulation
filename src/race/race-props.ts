import type { Vec3 } from "../types";
import type { WorldConfig } from "../config/world-config";

export type RaceProp = { kind: "gate" | "hoop"; position: Vec3; yaw: number; radius: number };

/** Scatter independent props in clear air, with no route or required order. */
export function generateRaceProps(world: WorldConfig, clear: (p: Vec3, radius: number) => boolean, random = Math.random): RaceProp[] {
  const props: RaceProp[] = [];
  const radius = 1.5;
  const clearance = 2.5;
  const minX = Math.max(world.bounds.min.x + clearance, world.spawnPosition.x - 50);
  const maxX = Math.min(world.bounds.max.x - clearance, world.spawnPosition.x + 50);
  const minY = Math.max(world.bounds.min.y + clearance, world.spawnPosition.y - 50);
  const maxY = Math.min(world.bounds.max.y - clearance, world.spawnPosition.y + 50);
  const low = Math.max(world.groundLevel, world.spawnPosition.z) + clearance;
  const high = Math.min(world.roofHeight - clearance, low + 22);
  for (let attempt = 0; attempt < 12000 && props.length < 12; attempt++) {
    const position = {
      x: minX + random() * (maxX - minX),
      y: minY + random() * (maxY - minY),
      z: low + random() * Math.max(0, high - low),
    };
    if (Math.hypot(position.x - world.spawnPosition.x, position.y - world.spawnPosition.y, position.z - world.spawnPosition.z) < 6) continue;
    if (props.some(p => Math.hypot(p.position.x - position.x, p.position.y - position.y, p.position.z - position.z) < 6)) continue;
    if (!clear(position, clearance)) continue;
    props.push({ kind: props.length % 2 === 0 ? "gate" : "hoop", position, yaw: random() * Math.PI * 2, radius });
  }
  if (props.length < 12) throw new Error("Could not find clear space for 12 race props.");
  return props;
}

/** A full traversal must enter the negative-X side and leave the positive-X side, inside the opening. */
export class RacePropTracker {
  private previous?: Vec3;
  private entry = new Map<number, number>();
  private crossed = new Set<number>();
  private lastPass = new Map<number, number>();
  constructor(private props: RaceProp[], private margin = 0.15) {}
  reset(): void { this.previous = undefined; this.entry.clear(); this.crossed.clear(); this.lastPass.clear(); }
  update(position: Vec3, time: number): number[] {
    const previous = this.previous;
    this.previous = { ...position };
    if (!previous) return [];
    const passed: number[] = [];
    this.props.forEach((prop, i) => {
      const c = Math.cos(prop.yaw), s = Math.sin(prop.yaw);
      const local = (p: Vec3) => ({ x: (p.x - prop.position.x) * c + (p.y - prop.position.y) * s,
        y: -(p.x - prop.position.x) * s + (p.y - prop.position.y) * c, z: p.z - prop.position.z });
      const a = local(previous), b = local(position);
      const opening = prop.radius - this.margin;
      const inside = (y: number, z: number) => prop.kind === "hoop" ? Math.hypot(y, z) < opening : Math.abs(y) < opening && Math.abs(z) < opening;
      if (Math.abs(a.x) >= 0.3) { this.entry.set(i, Math.sign(a.x)); this.crossed.delete(i); }
      if (a.x * b.x < 0 || (a.x !== 0 && b.x === 0)) {
        const t = a.x / (a.x - b.x);
        if (inside(a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)) this.crossed.add(i);
        else this.crossed.delete(i);
      }
      if (!inside(b.y, b.z) && Math.abs(b.x) < 0.3) this.crossed.delete(i);
      if (Math.abs(b.x) >= 0.3 && this.entry.get(i) === -1 && b.x > 0 && this.crossed.has(i)) {
        if (time - (this.lastPass.get(i) ?? -Infinity) > 1) { passed.push(i); this.lastPass.set(i, time); }
        this.entry.set(i, Math.sign(b.x)); this.crossed.delete(i);
      }
    });
    return passed;
  }
}
