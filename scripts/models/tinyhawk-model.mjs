import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
// Source coordinates are millimetres, Y up, -Z forward.
export function createTinyhawkModel() {
  const M = {
    frame: new THREE.MeshPhysicalMaterial({
      color: 0xf3f3f1,
      roughness: 0.55,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
      sheen: 0.4,
      sheenColor: 0xffffff,
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 }),
    screw: new THREE.MeshStandardMaterial({
      color: 0x0c0c0c,
      roughness: 0.3,
      metalness: 0.7,
    }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.45 }),
    chip: new THREE.MeshStandardMaterial({
      color: 0x1d1d1f,
      roughness: 0.35,
      metalness: 0.2,
    }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xd8a84a,
      roughness: 0.3,
      metalness: 1,
    }),
    silver: new THREE.MeshStandardMaterial({
      color: 0xc9cbd0,
      roughness: 0.25,
      metalness: 1,
    }),
    copper: new THREE.MeshStandardMaterial({
      color: 0xb8692e,
      roughness: 0.35,
      metalness: 1,
    }),
    bell: new THREE.MeshStandardMaterial({
      color: 0xd0141c,
      roughness: 0.32,
      metalness: 0.65,
    }),
    motorBase: new THREE.MeshStandardMaterial({
      color: 0x26272a,
      roughness: 0.4,
      metalness: 0.6,
    }),
    prop: new THREE.MeshPhysicalMaterial({
      color: 0xf00a14,
      emissive: 0x3a0000,
      roughness: 0.2,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      clearcoat: 0.6,
    }),
    whitePlug: new THREE.MeshStandardMaterial({
      color: 0xf2efe6,
      roughness: 0.6,
    }),
    wireRed: new THREE.MeshStandardMaterial({
      color: 0xc8161b,
      roughness: 0.45,
    }),
    wireBlack: new THREE.MeshStandardMaterial({
      color: 0x151515,
      roughness: 0.45,
    }),
    lensGlass: new THREE.MeshPhysicalMaterial({
      color: 0x0a0d14,
      roughness: 0.05,
      metalness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      iridescence: 0.6,
    }),
    bezel: new THREE.MeshStandardMaterial({
      color: 0xd6d8dc,
      roughness: 0.35,
      metalness: 0.5,
    }),
    batteryWrap: new THREE.MeshStandardMaterial({
      color: 0x9ea2a8,
      roughness: 0.35,
      metalness: 0.7,
    }),
  }; // ---------------------------------------------------------------- helpers
  const drone = new THREE.Group();
  // everything that moves with the drone
  const body = new THREE.Group();
  // drone with hover tilt
  drone.add(body);
  function mesh(geo, mat, parent = body) {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  } // Build a closed outline of a 2D signed-distance field by casting rays from the origin // (the shapes used are star-shaped about the origin). Returns THREE.Vector2 points in (x, -z).
  function sdfOutline(sdf, steps = 360, maxR = 80) {
    const pts = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const dx = Math.cos(a),
        dz = Math.sin(a);
      let lo = 0,
        hi = maxR;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (sdf(dx * mid, dz * mid) < 0) lo = mid;
        else hi = mid;
      }
      pts.push(new THREE.Vector2(dx * lo, -dz * lo));
    }
    return pts;
  }
  const smin = (a, b, k) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };
  const sdCircle = (x, z, cx, cz, r) => Math.hypot(x - cx, z - cz) - r;
  const sdRoundRect = (x, z, hx, hz, r) => {
    const qx = Math.abs(x) - hx + r,
      qz = Math.abs(z) - hz + r;
    return (
      Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) +
      Math.min(Math.max(qx, qz), 0) -
      r
    );
  }; // Flat plate from a shape in the XZ plane, bottom at y = 0, `thick` mm tall.
  function plateGeometry(shape, thick, bevel = 0.5) {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: thick - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 48,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, bevel, 0);
    return g;
  } // Twisted pair of wires along a path.
  function twistedPair(points, matA, matB, r = 0.42, turns = 9) {
    const path = new THREE.CatmullRomCurve3(points);
    const N = 160;
    const frames = path.computeFrenetFrames(N, false);
    const a = [],
      b = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = path.getPointAt(t);
      const ang = t * turns * Math.PI * 2;
      const off = frames.normals[i]
        .clone()
        .multiplyScalar(Math.cos(ang) * r)
        .add(frames.binormals[i].clone().multiplyScalar(Math.sin(ang) * r));
      a.push(p.clone().add(off));
      b.push(p.clone().sub(off));
    }
    mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(a), 220, r, 6),
      matA,
    );
    mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(b), 220, r, 6),
      matB,
    );
  }
  function wire(points, mat, r = 0.45) {
    return mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, r, 8),
      mat,
    );
  } // ---------------------------------------------------------------- frame geometry
  const A = 26.5;
  // motor offset on X and Z (75 mm diagonal wheelbase)
  const R_IN = 22.3;
  // duct inner radius (40 mm props)
  const R_OUT = 24.4;
  // duct outer radius at the bottom
  const DUCT_H = 13.2;
  // duct wall height
  const MOTORS = [
    // Betaflight default order, props-in
    { name: "rearRight", x: A, z: A, dir: -1 },
    { name: "frontRight", x: A, z: -A, dir: 1 },
    { name: "rearLeft", x: -A, z: A, dir: 1 },
    { name: "frontLeft", x: -A, z: -A, dir: -1 },
  ]; // Bottom plate: smooth union of the four duct footprints and the centre body, with duct holes.
  const frameSdf = (x, z) => {
    let d = sdRoundRect(x, z, 17, 17, 7);
    for (const m of MOTORS) d = smin(d, sdCircle(x, z, m.x, m.z, R_OUT), 9);
    return d;
  };
  {
    const shape = new THREE.Shape(sdfOutline(frameSdf, 480, 90));
    for (const m of MOTORS) {
      const h = new THREE.Path();
      h.absarc(m.x, -m.z, R_IN, 0, Math.PI * 2, true);
      shape.holes.push(h);
    } // small lightening / strap holes between the ducts
    for (const [hx, hz, r] of [
      [0, -25.5, 1.5],
      [0, 25.5, 1.5],
    ]) {
      const h = new THREE.Path();
      h.absarc(hx, -hz, r, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    const plate = mesh(plateGeometry(shape, 1.8, 0.6), M.frame);
    plate.name = "plate";
  } // Ducts: lathe profile with a rounded, slightly flared top lip.
  {
    const prof = [
      [R_IN, 0.2],
      [R_IN, DUCT_H - 0.8],
      [R_IN + 0.3, DUCT_H + 0.2],
      [R_IN + 1.1, DUCT_H + 0.75],
      [R_IN + 2.2, DUCT_H + 0.85],
      [R_IN + 3.1, DUCT_H + 0.4],
      [R_IN + 3.5, DUCT_H - 0.6],
      [R_IN + 3.3, DUCT_H - 1.8],
      [R_OUT + 0.2, 3.0],
      [R_OUT, 0.6],
      [R_OUT - 0.4, 0.2],
      [R_IN, 0.2],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const ductGeo = new THREE.LatheGeometry(prof, 128);
    ductGeo.computeVertexNormals(); // top "spider" brace: 5 slightly curved spokes to the motor hub
    const spokeGeos = [];
    const SPOKES = 5;
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2 + 0.3;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      const tx = -sa,
        tz = ca; // tangent for the bend
      const p = (r, y, bend) =>
        new THREE.Vector3(ca * r + tx * bend, y, sa * r + tz * bend);
      const curve = new THREE.CatmullRomCurve3([
        p(3.6, DUCT_H + 1.2, 0),
        p(9, DUCT_H + 1.5, 1.4),
        p(16, DUCT_H + 1.2, 1.6),
        p(R_IN + 1.2, DUCT_H + 0.5, 0.4),
      ]);
      spokeGeos.push(new THREE.TubeGeometry(curve, 24, 0.85, 6));
    }
    for (const m of MOTORS) {
      const g = new THREE.Group();
      g.position.set(m.x, 0, m.z);
      body.add(g);
      mesh(ductGeo, M.frame, g);
      const spokes = new THREE.Group();
      const wireAng = Math.atan2(
        -Math.sign(m.z) * 0.887,
        -Math.sign(m.x) * 0.46,
      );
      spokes.rotation.y = 0.3 - wireAng - Math.PI / SPOKES;
      g.add(spokes);
      for (const sg of spokeGeos) mesh(sg, M.frame, spokes);
      const hub = mesh(
        new THREE.CylinderGeometry(4.6, 4.8, 1.8, 40),
        M.frame,
        g,
      );
      hub.position.y = DUCT_H + 1.2; // three motor screws + shaft clip
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
        const s = mesh(
          new THREE.CylinderGeometry(0.95, 0.95, 0.7, 16),
          M.screw,
          g,
        );
        s.position.set(Math.cos(a) * 2.9, DUCT_H + 2.4, Math.sin(a) * 2.9);
      }
      const clip = mesh(
        new THREE.CylinderGeometry(1.0, 1.0, 0.8, 16),
        M.screw,
        g,
      );
      clip.position.y = DUCT_H + 2.4;
      m.group = g;
    }
  } // ---------------------------------------------------------------- motors + props (inverted, hanging from the hub)
  function bladeGeometry(dir) {
    // planform in (radial, chord) — chord > 0 is the leading edge
    const s = new THREE.Shape();
    s.moveTo(2.6, -1.6);
    s.bezierCurveTo(7, -2.2, 12, -3.4, 16.5, -3.2);
    s.bezierCurveTo(19.6, -3.0, 20.4, -0.5, 19.8, 1.4);
    s.bezierCurveTo(19.0, 3.6, 15.0, 4.4, 11.5, 3.8);
    s.bezierCurveTo(7.0, 3.0, 4.0, 2.0, 2.6, 1.6);
    s.lineTo(2.6, -1.6);
    const g = new THREE.ShapeGeometry(s, 18);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const r = pos.getX(i);
      let c = pos.getY(i);
      c -= 0.012 * r * r; // swept-back tips
      const pitch = THREE.MathUtils.lerp(0.62, 0.3, (r - 2.6) / 17.8); // twist
      const y = c * Math.sin(pitch);
      const z = -dir * c * Math.cos(pitch); // leading edge faces direction of rotation
      pos.setXYZ(i, r, y, z);
    }
    g.computeVertexNormals();
    return g;
  }
  const MOTOR_TOP = DUCT_H + 0.3; // underside of the hub
  const PROP_Y = MOTOR_TOP - 7.6;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 18, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,40,40,0)");
  gradient.addColorStop(0.15, "rgba(255,40,40,0.55)");
  gradient.addColorStop(0.55, "rgba(255,30,30,0.42)");
  gradient.addColorStop(0.9, "rgba(255,60,60,0.55)");
  gradient.addColorStop(0.97, "rgba(255,90,90,0.25)");
  gradient.addColorStop(1, "rgba(255,90,90,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const blurTexture = new THREE.CanvasTexture(canvas);
  blurTexture.colorSpace = THREE.SRGBColorSpace;
  for (const m of MOTORS) {
    const g = m.group; // static stator / mount
    const base = mesh(
      new THREE.CylinderGeometry(4.7, 4.9, 1.4, 32),
      M.motorBase,
      g,
    );
    base.position.y = MOTOR_TOP - 0.7;
    const wind = mesh(
      new THREE.CylinderGeometry(4.3, 4.3, 0.9, 32),
      M.copper,
      g,
    );
    wind.position.y = MOTOR_TOP - 1.8; // rotating part
    const spin = new THREE.Group();
    spin.name = `motor-${m.name}`;
    g.add(spin);
    const bell = mesh(
      new THREE.CylinderGeometry(5.1, 5.1, 4.6, 40),
      M.bell,
      spin,
    );
    bell.position.y = MOTOR_TOP - 4.4;
    const ring = mesh(new THREE.TorusGeometry(5.1, 0.35, 8, 40), M.bell, spin);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = MOTOR_TOP - 2.1;
    const capDark = mesh(
      new THREE.CylinderGeometry(3.6, 3.6, 0.3, 32),
      M.black,
      spin,
    );
    capDark.position.y = MOTOR_TOP - 6.75;
    for (let k = 0; k < 3; k++) {
      // bell spokes visible from below
      const sp = mesh(new THREE.BoxGeometry(1.2, 0.35, 3.6), M.bell, spin);
      sp.position.y = MOTOR_TOP - 6.95;
      sp.rotation.y = (k / 3) * Math.PI * 2;
      sp.translateZ(1.8);
    }
    const propHub = mesh(
      new THREE.CylinderGeometry(2.8, 2.6, 2.4, 32),
      M.prop,
      spin,
    );
    propHub.position.y = PROP_Y;
    const shaft = mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 1.2, 12),
      M.silver,
      spin,
    );
    shaft.position.y = PROP_Y - 1.4;
    const bladeGeo = bladeGeometry(m.dir);
    const blades = new THREE.Group();
    blades.name = `blades-${m.name}`;
    blades.position.y = PROP_Y;
    spin.add(blades);
    for (let k = 0; k < 4; k++) {
      const b = mesh(bladeGeo, M.prop.clone(), blades);
      b.rotation.y = (k / 4) * Math.PI * 2;
    }
    const disc = mesh(new THREE.CircleGeometry(20.4, 64), new THREE.MeshBasicMaterial({
      map: blurTexture, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide,
    }), g);
    disc.name = `blur-${m.name}`;
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = PROP_Y;
  } // ---------------------------------------------------------------- flight controller (AIO board)
  const FC_Y = 3.6;
  {
    const fc = new THREE.Group();
    fc.position.y = FC_Y;
    body.add(fc);
    const fcSdf = (x, z) =>
      Math.max(
        sdRoundRect(x, z, 12.75, 12.75, 1),
        (Math.abs(x) + Math.abs(z) - 20.5) / Math.SQRT2,
      );
    const board = mesh(
      plateGeometry(new THREE.Shape(sdfOutline(fcSdf, 240, 30)), 1.0, 0.2),
      M.pcb,
      fc,
    );
    board.position.y = -0.5; // standoffs
    for (const [x, z] of [
      [-8, -8],
      [8, -8],
      [-8, 8],
      [8, 8],
    ]) {
      const s = mesh(
        new THREE.CylinderGeometry(1.4, 1.6, FC_Y - 1.8, 16),
        M.frame,
        body,
      );
      s.position.set(x, 1.8 + (FC_Y - 1.8) / 2 - 0.25, z);
    } // MCU + ESC FETs + passives
    const mcu = mesh(new THREE.BoxGeometry(7, 1, 7), M.chip, fc);
    mcu.position.set(0, 0.9, 1.5);
    mcu.rotation.y = Math.PI / 4;
    const rnd = (() => {
      let s = 7;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    })();
    for (const [x, z] of [
      [-7, -7],
      [7, -7],
      [-7, 7],
      [7, 7],
      [-7.5, 0],
      [7.5, 0],
    ]) {
      const f = mesh(new THREE.BoxGeometry(3.2, 0.9, 3.2), M.chip, fc);
      f.position.set(x, 0.85, z);
    }
    for (let i = 0; i < 46; i++) {
      const w = 0.6 + rnd() * 1.2,
        d = 0.4 + rnd() * 0.8;
      const x = (rnd() - 0.5) * 22,
        z = (rnd() - 0.5) * 22;
      if (Math.abs(x) + Math.abs(z) > 17) continue;
      const p = mesh(
        new THREE.BoxGeometry(w, 0.5, d),
        rnd() > 0.6 ? M.gold : rnd() > 0.5 ? M.silver : M.chip,
        fc,
      );
      p.position.set(x, 0.7, z);
    } // white motor plugs on the left and right edges
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const pl = mesh(
          new RoundedBoxGeometry(3.4, 2.4, 4.4, 2, 0.4),
          M.whitePlug,
          fc,
        );
        pl.position.set(sx * 10.8, 1.7, sz * 3.2);
      } // USB-C on the rear edge
    const usb = mesh(
      new RoundedBoxGeometry(8.9, 3.2, 7.2, 3, 1.4),
      M.silver,
      fc,
    );
    usb.position.set(0, 2.1, 10.2); // stacked VTX/receiver board under the canopy
    const vtx = mesh(new RoundedBoxGeometry(14, 0.9, 14, 2, 0.4), M.pcb, fc);
    vtx.position.set(0, 3.0, -1);
  } // ---------------------------------------------------------------- canopy (camera pod with ears)
  const DECK_Y = 11.0;
  {
    // deck plate: rounded body with four screw lobes
    const lobes = [
      [19.5, 0],
      [-19.5, 0],
      [0, 19.5],
      [0, -19.5],
    ];
    const deckSdf = (x, z) => {
      let d = sdRoundRect(x, z, 11.5, 12.5, 6);
      for (const [lx, lz] of lobes)
        d = smin(d, sdCircle(x, z, lx, lz, 3.9), 3.5);
      return d;
    };
    const deck = mesh(
      plateGeometry(new THREE.Shape(sdfOutline(deckSdf, 360, 40)), 1.6, 0.5),
      M.frame,
    );
    deck.position.y = DECK_Y;
    for (const [lx, lz] of lobes) {
      const post = mesh(
        new THREE.CylinderGeometry(2.0, 2.5, DECK_Y - 1.5, 20),
        M.frame,
      );
      post.position.set(lx, 1.6 + (DECK_Y - 1.6) / 2, lz);
      const sc = mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.7, 16), M.screw);
      sc.position.set(lx, DECK_Y + 1.85, lz);
    } // tapered skirt from deck to pod
    const skirt = mesh(new THREE.CylinderGeometry(12, 21, 4.2, 4, 1), M.frame);
    skirt.rotation.y = Math.PI / 4;
    skirt.scale.set(1, 1, 0.95);
    skirt.position.set(0, DECK_Y + 3.4, -1); // pod side profile in (forward, y) extruded across X
    const W = 18;
    const s = new THREE.Shape();
    const Y0 = DECK_Y + 1.5;
    s.moveTo(-11, Y0);
    s.lineTo(10.6, Y0);
    s.lineTo(10.4, Y0 + 2.5);
    s.quadraticCurveTo(10.2, Y0 + 7.5, 8.4, Y0 + 11.3);
    s.quadraticCurveTo(7.6, Y0 + 12.9, 4.5, Y0 + 12.7);
    s.quadraticCurveTo(-3, Y0 + 11.7, -8, Y0 + 8);
    s.quadraticCurveTo(-11.5, Y0 + 5, -11, Y0);
    const podGeo = new THREE.ExtrudeGeometry(s, {
      depth: W - 3,
      bevelEnabled: true,
      bevelThickness: 1.5,
      bevelSize: 1.4,
      bevelSegments: 5,
      curveSegments: 24,
    });
    podGeo.translate(0, 0, -(W - 3) / 2);
    podGeo.rotateY(Math.PI / 2); // shape x (forward) -> world -Z, extrusion -> world X
    mesh(podGeo, M.frame); // ears: U-shaped crown seen from the front
    const e = new THREE.Shape();
    const half = [
      [10.4, 0],
      [10.6, 3.5],
      [9.9, 7.8],
      [8.6, 9.4],
      [7.6, 7.6],
      [5.2, 4.2],
      [2.6, 3.2],
      [0, 3.0],
    ];
    e.moveTo(-half[0][0], half[0][1]);
    for (const [x, y] of half.slice(1)) e.lineTo(-x, y);
    for (const [x, y] of half.slice(0, -1).reverse()) e.lineTo(x, y);
    e.lineTo(-half[0][0], 0);
    const earGeo = new THREE.ExtrudeGeometry(new THREE.Shape(e.getPoints(6)), {
      depth: 4.5,
      bevelEnabled: true,
      bevelThickness: 1.2,
      bevelSize: 0.9,
      bevelSegments: 5,
    });
    const ears = mesh(earGeo, M.frame);
    ears.position.set(0, DECK_Y + 8.8, -9.6);
    ears.rotation.x = -0.12;
    ears.scale.set(0.92, 1, 1); // dark camera board peeking out under the lens
    const camBoard = mesh(
      new RoundedBoxGeometry(12.5, 4.2, 1.2, 2, 0.4),
      M.black,
    );
    camBoard.position.set(0, DECK_Y + 3.6, -12.0); // RunCam Nano lens, tilted up ~20°
    const lens = new THREE.Group();
    lens.position.set(0, DECK_Y + 7.6, -11.9);
    lens.rotation.x = THREE.MathUtils.degToRad(20);
    body.add(lens);
    const bez = mesh(new THREE.TorusGeometry(4.5, 1.15, 16, 48), M.bezel, lens);
    bez.position.z = -0.6;
    const barrel = mesh(
      new THREE.CylinderGeometry(3.6, 3.8, 3.4, 40),
      M.black,
      lens,
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.3;
    const glass = mesh(
      new THREE.SphereGeometry(3.2, 40, 20, 0, Math.PI * 2, 0, Math.PI / 3.2),
      M.lensGlass,
      lens,
    );
    glass.rotation.x = -Math.PI / 2;
    glass.position.z = 0.2;
    const innerRing = mesh(
      new THREE.TorusGeometry(2.85, 0.22, 8, 40),
      M.silver,
      lens,
    );
    innerRing.position.z = -1.5; // screws on the pod sides
    for (const sx of [-1, 1]) {
      const sc = mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.6, 16), M.screw);
      sc.rotation.z = Math.PI / 2;
      sc.position.set(sx * 9.1, DECK_Y + 5, 2);
    }
  } // ---------------------------------------------------------------- motor wires (twisted, over the duct lip)
  for (const m of MOTORS) {
    const sx = Math.sign(m.x),
      sz = Math.sign(m.z); // P(r): point at distance r from the motor centre, on the line toward the FC plug
    const P = (r, y) =>
      new THREE.Vector3(sx * (A - 0.46 * r), y, sz * (A - 0.887 * r));
    twistedPair(
      [
        new THREE.Vector3(sx * 12.6, FC_Y + 1.7, sz * 3.2),
        new THREE.Vector3(sx * 14.0, FC_Y + 3.4, sz * 3.1),
        P(26.6, 12.0),
        P(25.4, 15.0),
        P(23.6, 15.3),
        P(21.4, 14.0),
        P(18.5, 12.0),
        P(10, 11.6),
        P(5.6, 12.1),
      ],
      M.wireBlack,
      M.wireBlack,
      0.34,
      14,
    );
  } // ---------------------------------------------------------------- VTX antenna
  {
    const pts = [
      new THREE.Vector3(2.5, DECK_Y + 4, 7),
      new THREE.Vector3(4.5, DECK_Y + 11, 10),
      new THREE.Vector3(7.5, 28, 16.5),
      new THREE.Vector3(10.5, 38, 22),
      new THREE.Vector3(13, 47, 27),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const seg = (t0, t1, r, n = 40) => {
      const sub = [];
      for (let i = 0; i <= n; i++)
        sub.push(curve.getPointAt(t0 + (t1 - t0) * (i / n)));
      const tube = mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sub), n, r, 12),
        M.wireBlack,
      );
      return { tube, end: sub[sub.length - 1], start: sub[0] };
    };
    seg(0, 0.47, 0.55);
    const sleeve = seg(0.47, 0.66, 1.1);
    seg(0.66, 0.985, 0.9);
    const tip = mesh(new THREE.SphereGeometry(0.9, 16, 10), M.wireBlack);
    tip.position.copy(curve.getPointAt(0.985));
    for (const p of [sleeve.start, sleeve.end]) {
      const cap = mesh(new THREE.SphereGeometry(1.1, 16, 10), M.wireBlack);
      cap.position.copy(p);
    }
  } // ---------------------------------------------------------------- battery (1S 650 mAh HV, PH2.0) + holder
  function batteryLabel(kind) {
    const c = document.createElement("canvas");
    c.width = 2048;
    c.height = kind === "bottom" ? 560 : 340;
    const ctx = c.getContext("2d");
    const W = c.width,
      H = c.height;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#26272b");
    bg.addColorStop(0.5, "#141416");
    bg.addColorStop(1, "#232428");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H); // silver end bands
    const sv = ctx.createLinearGradient(0, 0, 0, H);
    sv.addColorStop(0, "#d9dbdf");
    sv.addColorStop(0.5, "#9a9ea5");
    sv.addColorStop(1, "#cfd2d6");
    ctx.fillStyle = sv;
    ctx.fillRect(0, 0, 150, H);
    ctx.fillRect(W - 150, 0, 150, H);
    ctx.textBaseline = "middle";
    if (kind === "bottom") {
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 64px Arial, sans-serif";
      ctx.fillText("LiPo Battery", 220, H * 0.68); // EMAX wordmark with a red stripe-style "E"
      ctx.save();
      ctx.translate(820, H * 0.42);
      ctx.transform(1, 0, -0.22, 1, 0, 0);
      ctx.fillStyle = "#e3262f";
      for (let i = 0; i < 3; i++) ctx.fillRect(0, -95 + i * 70, 150, 46);
      ctx.fillStyle = "#ffffff";
      ctx.font = "italic 900 230px Arial Black, Arial, sans-serif";
      ctx.fillText("MAX", 165, 0);
      ctx.restore();
      ctx.fillStyle = "#e8e8e8";
      ctx.font = "700 70px Arial, sans-serif";
      ctx.fillText("POWER THE WORLD", 820, H * 0.8);
      ctx.font = "600 46px Arial, sans-serif";
      ctx.fillStyle = "#b8bbc2";
      ctx.fillText("1S 3.8V HV", 1600, H * 0.3);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 120px Arial, sans-serif";
      ctx.fillText("EMAX1S120C650HV", 260, H / 2);
      ctx.fillStyle = "#e3262f";
      ctx.fillRect(1450, H / 2 - 40, 330, 80);
      ctx.fillStyle = "#fff";
      ctx.font = "700 60px Arial, sans-serif";
      ctx.fillText("650mAh", 1475, H / 2 + 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const BAT = { w: 17.5, h: 9.2, l: 57, y: -6.4, z: 2 };
  {
    const bat = new THREE.Group();
    bat.position.set(0, BAT.y, BAT.z);
    body.add(bat);
    mesh(
      new RoundedBoxGeometry(BAT.w, BAT.h, BAT.l, 4, 2.2),
      M.batteryWrap,
      bat,
    );
    const labelMat = (kind) =>
      new THREE.MeshStandardMaterial({
        map: batteryLabel(kind),
        roughness: 0.4,
        metalness: 0.25,
      });
    const bottom = mesh(
      new THREE.PlaneGeometry(BAT.l - 1.2, BAT.w - 2.8),
      labelMat("bottom"),
      bat,
    );
    bottom.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    bottom.position.y = -BAT.h / 2 - 0.02;
    for (const sx of [-1, 1]) {
      const side = mesh(
        new THREE.PlaneGeometry(BAT.l - 1.2, BAT.h - 3.2),
        labelMat("side"),
        bat,
      );
      side.rotation.y = (sx * Math.PI) / 2;
      side.position.x = sx * (BAT.w / 2 + 0.02);
    }
    const top = mesh(
      new THREE.PlaneGeometry(BAT.l - 1.2, BAT.w - 2.8),
      labelMat("side"),
      bat,
    );
    top.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    top.position.y = BAT.h / 2 + 0.02; // holder: two white straps wrapping the cell, hanging from the plate
    for (const zc of [-9, 11]) {
      const strap = new THREE.Group();
      strap.position.set(0, 0, BAT.z + zc);
      body.add(strap);
      const t = 1.1,
        wIn = BAT.w + 0.4,
        bottomY = BAT.y - BAT.h / 2 - t / 2 - 0.2;
      for (const sx of [-1, 1]) {
        const post = mesh(
          new RoundedBoxGeometry(t, -bottomY + 0.6, 4.2, 2, 0.4),
          M.frame,
          strap,
        );
        post.position.set(sx * (wIn / 2 + t / 2), bottomY / 2 + 0.3, 0);
      }
      const bar = mesh(
        new RoundedBoxGeometry(wIn + 2 * t, t, 4.2, 2, 0.45),
        M.frame,
        strap,
      );
      bar.position.y = bottomY;
    } // leads + PH2.0 plug pair at the rear
    const rearZ = BAT.z + BAT.l / 2;
    const plugZ = rearZ + 9.5;
    for (const [sx, mat] of [
      [-0.8, M.wireRed],
      [0.8, M.wireBlack],
    ]) {
      wire(
        [
          new THREE.Vector3(sx, BAT.y + 2.5, rearZ - 1.5),
          new THREE.Vector3(sx, BAT.y + 3.2, rearZ + 2.5),
          new THREE.Vector3(sx * 0.9, -1.5, plugZ - 5.5),
          new THREE.Vector3(sx * 0.9, -1.0, plugZ - 3.2),
        ],
        mat,
        0.5,
      );
    }
    const plugF = mesh(
      new RoundedBoxGeometry(5.2, 3.0, 4.4, 2, 0.4),
      M.whitePlug,
    );
    plugF.position.set(0, -1.0, plugZ - 1.6);
    const plugM = mesh(
      new RoundedBoxGeometry(5.8, 3.6, 3.4, 2, 0.4),
      M.whitePlug,
    );
    plugM.position.set(0, -1.0, plugZ + 2.2); // FC pigtail with inline capacitor (black heat-shrink)
    for (const [sx, mat] of [
      [-1, M.wireRed],
      [1, M.wireBlack],
    ]) {
      wire(
        [
          new THREE.Vector3(sx * 0.9, -1.0, plugZ + 3.6),
          new THREE.Vector3(sx * 0.9, 0.2, plugZ + 6.5),
          new THREE.Vector3(sx * 0.8, 2.6, plugZ + 2),
          new THREE.Vector3(sx * 0.8, 3.0, 30),
          new THREE.Vector3(sx * 0.8, 3.3, 20),
          new THREE.Vector3(sx * 4.0, 4.0, 14.5),
          new THREE.Vector3(sx * 5.6, FC_Y + 0.7, 11.2),
        ],
        mat,
        0.48,
      );
    }
    const cap = mesh(new THREE.CapsuleGeometry(1.9, 5, 6, 16), M.black);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(3.4, 1.6, plugZ + 4);
  }
  // glTF is Y up, +Z forward; both renderers convert to Z up, +X forward.
  drone.rotation.y = Math.PI;
  drone.scale.setScalar(0.001);
  body.position.y = -PROP_Y;
  drone.name = "EMAX Tinyhawk III Plus";
  return drone;
}
