import { loadCollider } from "./lib/load-collider.mjs";
import { createServer } from "vite";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const output = resolve(process.env.FPV_BENCH_OUTPUT || "reports/physics");
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { RapierPhysics } = await server.ssrLoadModule(
    "/src/physics/rapier-physics.ts",
  );
  const { defaultPreset, normalizePreset, PHYSICS_VERSION } =
    await server.ssrLoadModule("/src/config/presets.ts");
  const { rateTarget } = await server.ssrLoadModule(
    "/src/controllers/rates.ts",
  );
  const { conjugateQuat, rotateVector } = await server.ssrLoadModule(
    "/src/controllers/math-utils.ts",
  );
  const { parseRecording } = await server.ssrLoadModule(
    "/src/core/flight-recording.ts",
  );
  const { SimulationEngine } = await server.ssrLoadModule(
    "/src/core/simulation-engine.ts",
  );
  const revision = execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
  const dirty = !!execFileSync("git", ["status", "--porcelain"])
    .toString()
    .trim();
  const summary = [];
  await mkdir(output, { recursive: true });
  const base = defaultPreset();
  base.battery.fixedVoltage = base.propulsion.referenceVoltage;
  const neutral = {
    thrust: 0,
    roll: 0,
    pitch: 0,
    yaw: 0,
    arm: true,
    reset: false,
    speedMultiplier: 1,
  };
  async function run(name, config, hz, seconds, input, initialize, axis) {
    config = normalizePreset(config);
    const physics = new RapierPhysics(config);
    try {
      await physics.init({ x: 0, y: 0, z: 100 });
      if (initialize) initialize(physics);
      const samples = [];
      const start = performance.now();
      for (let step = 0; step < Math.round(hz * seconds); step++) {
        const controls = {
          ...neutral,
          throttle: config.hoverThrottle,
          ...input(step / hz),
        };
        physics.setArmed(controls.arm);
        const t = physics.step(controls, 1 / hz, -Infinity);
        const bodyRate = rotateVector(
          conjugateQuat(t.localOrientation),
          t.localAngularVelocity,
        );
        const target = ["roll", "pitch", "yaw"].map(
          (a) =>
            (rateTarget(
              controls[a],
              config.pidRateConfig.maxRate[a],
              config.rates.expo,
            ) *
              180) /
            Math.PI,
        );
        samples.push({
          time: (step + 1) / hz,
          throttleCommand: controls.throttle,
          rollStick: controls.roll, pitchStick: controls.pitch, yawStick: controls.yaw,
          targetRoll: target[0],
          targetPitch: target[1],
          targetYaw: target[2],
          roll: (bodyRate.x * 180) / Math.PI,
          pitch: (bodyRate.y * 180) / Math.PI,
          yaw: (bodyRate.z * 180) / Math.PI,
          ...Object.fromEntries(
            Object.entries(t.localPosition).map(([k, v]) => ["p" + k, v]),
          ),
          ...Object.fromEntries(
            Object.entries(t.localVelocity).map(([k, v]) => ["v" + k, v]),
          ),
          ...Object.fromEntries(
            Object.entries(t.localOrientation).map(([k, v]) => ["q" + k, v]),
          ),
          voltage: t.batteryVoltage,
          charge: t.batteryCharge,
          thrusts: t.rotorThrusts.join(";"),
          commands: t.motorCommands?.join(";"),
          saturation: Object.values(t.saturation ?? {}).join(";"),
        });
      }
      const cpuMs = performance.now() - start;
      const tail = samples.slice(-hz / 2);
      const result = {
        name,
        hz,
        seconds,
        cpuMs,
        cpuMsPerSimulatedSecond: cpuMs / seconds,
        finalPosition: physics.getTelemetry().localPosition,
        finalVelocity: physics.getTelemetry().localVelocity,
        finalOrientation: physics.getTelemetry().localOrientation,
        finalRates: [
          samples.at(-1).roll,
          samples.at(-1).pitch,
          samples.at(-1).yaw,
        ],
      };
      if (axis) {
        const target =
          samples.at(-1)["target" + axis[0].toUpperCase() + axis.slice(1)];
        const values = tail.map((s) => s[axis]);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const tolerance = Math.max(2, Math.abs(target) * 0.05);
        const lastOutside = samples.findLastIndex(
          (s) => Math.abs(s[axis] - target) > tolerance,
        );
        Object.assign(result, {
          axis,
          target,
          mean,
          errorPercent: (Math.abs(mean - target) / Math.abs(target)) * 100,
          ripple: Math.max(...values) - Math.min(...values),
          overshootPercent: Math.max(
            0,
            ((Math.max(...samples.map((s) => s[axis])) - target) / target) *
              100,
          ),
          settlingSeconds:
            lastOutside === samples.length - 1 ? null : (lastOutside + 1) / hz,
        });
      }
      summary.push(result);
      await writeFile(
        resolve(output, `${name}-${hz}.csv`),
        Object.keys(samples[0]).join(",") +
          "\n" +
          samples.map((s) => Object.values(s).join(",")).join("\n"),
      );
      await writeFile(
        resolve(output, `${name}-${hz}.json`),
        JSON.stringify(
          { physicsVersion: PHYSICS_VERSION, revision, dirty, config, result },
          null,
          2,
        ),
      );
      return result;
    } finally {
      physics.dispose();
    }
  }
  for (const hz of [240, 480, 960])
    for (const axis of ["roll", "pitch", "yaw"])
      await run(
        axis + "-step",
        base,
        hz,
        2,
        () => ({ [axis]: 0.1 }),
        undefined,
        axis,
      );
  for (const axis of ["roll", "pitch", "yaw"])
    await run(axis + "-release", base, 480, 4, (t) => ({
      [axis]: t < 1 ? 0.6 : 0,
    }));
  for (const throttle of [0, 0.2, 1])
    await run("combined-" + throttle, base, 480, 4, (t) =>
      t < 1 ? { throttle, roll: 1, pitch: 0.6, yaw: 0.4 } : {},
    );
  await run("hover", base, 480, 5, () => ({}));
  await run("throttle-punch", base, 480, 3, (t) => ({
    throttle: t < 1 ? 0.3 : t < 2 ? 1 : base.hoverThrottle,
  }));
  await run(
    "angle-recovery",
    base,
    480,
    4,
    () => ({}),
    (p) => {
      p.switchFlightMode("angle");
      p.body.setRotation(
        { x: Math.sin(Math.PI / 12), y: 0, z: 0, w: Math.cos(Math.PI / 12) },
        true,
      );
    },
  );
  await run(
    "coast-down",
    base,
    480,
    5,
    () => ({ arm: false }),
    (p) => p.body.setLinvel({ x: 5, y: 0, z: 0 }, true),
  );
  await run("terminal-descent", base, 480, 10, () => ({ arm: false }));
  for (const charge of [1, 0.5, 0.1]) {
    const c = defaultPreset();
    c.battery.initialCharge = charge;
    await run("battery-" + charge, c, 480, 3, () => ({ throttle: 0.8 }));
  }
  // Exploratory ±20% sensitivity ranges, not statistical confidence intervals.
  for (const parameter of ["thrust", "inertia", "drag", "lag"])
    for (const factor of [0.8, 1.2]) {
      const c = structuredClone(base);
      if (parameter === "thrust")
        c.rotors.forEach((r) => (r.maxThrust *= factor));
      if (parameter === "inertia")
        for (const a of ["x", "y", "z"]) c.body.inertia[a] *= factor;
      if (parameter === "drag")
        for (const group of Object.values(c.aerodynamics))
          for (const a of ["x", "y", "z"]) group[a] *= factor;
      if (parameter === "lag") {
        c.propulsion.riseTime *= factor;
        c.propulsion.fallTime *= factor;
      }
      await run(
        "sweep-" + parameter + "-" + factor,
        c,
        480,
        2,
        () => ({ roll: 0.1 }),
        undefined,
        "roll",
      );
    }
  const cadence = [];
  for (const fps of [30, 60, 120]) {
    const physics = new RapierPhysics(base);
    const engine = new SimulationEngine({ physics });
    try {
      await engine.init({ x: 0, y: 0, z: 100 });
      engine.setArmed(true);
      let tick = 0;
      engine.beforeFixedStep = () => ({
        ...neutral,
        throttle: base.hoverThrottle,
        roll: tick++ < 240 ? 0 : 0.1,
      });
      const start = performance.now();
      for (let frame = 0; frame < fps * 2; frame++)
        engine.step(neutral, 1 / fps);
      cadence.push({
        fps,
        cpuMs: performance.now() - start,
        droppedTime: engine.droppedTime,
        steps: tick,
        final: engine.getTelemetry(),
      });
    } finally {
      engine.dispose();
    }
  }
  const report = {
    physicsVersion: PHYSICS_VERSION,
    revision,
    dirty,
    reference: "estimated generic 75 mm 1S whoop; no real flight measurements",
    summary,
    cadence,
  };
  await writeFile(
    resolve(output, "summary.json"),
    JSON.stringify(report, null, 2),
  );
  console.table(
    summary
      .filter((r) => r.axis)
      .map(
        ({
          name,
          hz,
          target,
          mean,
          errorPercent,
          ripple,
          settlingSeconds,
        }) => ({
          name,
          hz,
          target,
          mean,
          errorPercent,
          ripple,
          settlingSeconds,
        }),
      ),
  );
  const failed = summary.filter(
    (r) => r.axis && (r.errorPercent >= 5 || r.ripple >= 5),
  );
  if (failed.length) {
    console.error(
      "Tracking gate failed:",
      failed.map((r) => r.name),
    );
    process.exitCode = 1;
  }
  if (
    JSON.stringify(cadence[0].final) !== JSON.stringify(cadence[1].final) ||
    JSON.stringify(cadence[1].final) !== JSON.stringify(cadence[2].final)
  ) {
    console.error("Render cadence independence failed");
    process.exitCode = 1;
  }
  // Optional replay of a browser recording, with the matching repository collider.
  const replayPath = process.argv[2];
  if (replayPath) {
    const recording = parseRecording(await readFile(replayPath, "utf8"));
    const physics = new RapierPhysics(recording.config);
    try {
      await physics.init(recording.initialPosition);
      if (recording.world !== "empty") {
        const { FactorySplatWorldConfig } = await server.ssrLoadModule(
          "/src/config/factory-splat-world-config.ts",
        );
        const { DedustWorldConfig } = await server.ssrLoadModule(
          "/src/config/dedust-world-config.ts",
        );
        const world = [FactorySplatWorldConfig, DedustWorldConfig].find(
          (w) => w.name === recording.world,
        );
        if (!world)
          throw new Error(
            "Headless replay supports empty, Factory, and DeDust worlds",
          );
        const map = await loadCollider(resolve("public", world.collisionGlbPath ?? world.mapGlbPath), world);
        physics.createCollider(map);
        if (Number.isFinite(world.roofHeight)) {
          physics.setRoofHeight(world.roofHeight);
          physics.dispose();
          await physics.init(recording.initialPosition);
        }
      }
      let mode = recording.config.controllerType;
      const rows = [];
      for (const step of recording.steps) {
        if (step.controls.reset) physics.reset();
        if (step.mode !== mode || step.controls.reset)
          physics.switchFlightMode(step.mode);
        mode = step.mode;
        physics.setArmed(step.controls.arm);
        rows.push(
          physics.step(step.controls, recording.fixedTimeStep, -Infinity),
        );
      }
      await writeFile(
        resolve(output, "replay.json"),
        JSON.stringify({
          physicsVersion: PHYSICS_VERSION,
          revision,
          world: recording.world,
          final: rows.at(-1),
          samples: rows,
        }),
      );
      console.log("Replay steps:", rows.length);
    } finally {
      physics.dispose();
    }
  }
  console.log(`Reports: ${output}`);
} finally {
  await server.close();
}
