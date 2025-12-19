/*
Parses a Collada (.dae) drone mesh to extract rotor centers and model bounds.
Flow: parse XML -> read scale + vertices -> collect rotor-material indices ->
center vertices -> cluster into 4 rotors -> compute centers.

Usage example:
const daeText = await fetch("/drone_models/drone.dae").then((r) => r.text());
const { rotorPositions, dimensions } = parseDroneDae(daeText);
*/
import type { Vec3 } from "./types";

type ParsedDroneModel = {
  rotorPositions: Vec3[];
  dimensions: Vec3;
};

const ROTOR_MATERIALS = new Set(["RotorGrey", "RotorGrey2"]);

// Parse the Collada file and extract rotor centers + body bounds.
export function parseDroneDae(daeText: string): ParsedDroneModel {
  const parser = new DOMParser();
  const doc = parser.parseFromString(daeText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Failed to parse drone.dae");
  }

  const scale = parseVec3(doc.querySelector("visual_scene node scale")?.textContent);
  const verticesNode = doc.querySelector("library_geometries geometry mesh vertices");
  if (!verticesNode) {
    throw new Error("Missing vertices node in drone.dae");
  }

  const positionsSourceId = verticesNode
    .querySelector('input[semantic="POSITION"]')
    ?.getAttribute("source")
    ?.replace("#", "");

  if (!positionsSourceId) {
    throw new Error("Missing POSITION source for vertices");
  }

  const positionsArray = doc.querySelector(
    `source#${positionsSourceId} float_array`,
  )?.textContent;

  if (!positionsArray) {
    throw new Error("Missing positions array in drone.dae");
  }

  const positions = parseFloatArray(positionsArray);
  const vertices: Vec3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    vertices.push({
      x: positions[i] * scale.x,
      y: positions[i + 1] * scale.y,
      z: positions[i + 2] * scale.z,
    });
  }

  const bounds = computeBounds(vertices);
  const center = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };

  // Collect vertex indices used by rotor materials.
  const rotorIndices = new Set<number>();
  const polylists = doc.querySelectorAll("polylist[material]");
  polylists.forEach((polylist) => {
    const material = polylist.getAttribute("material");
    if (!material || !ROTOR_MATERIALS.has(material)) {
      return;
    }

    const inputs = Array.from(polylist.querySelectorAll("input"));
    const vertexInput = inputs.find(
      (input) => input.getAttribute("semantic") === "VERTEX",
    );
    const vertexOffset = vertexInput
      ? Number(vertexInput.getAttribute("offset") ?? "0")
      : 0;

    let stride = 0;
    inputs.forEach((input) => {
      const offset = Number(input.getAttribute("offset") ?? "0");
      stride = Math.max(stride, offset + 1);
    });

    const indexText = polylist.querySelector("p")?.textContent;
    if (!indexText) {
      return;
    }

    const indices = parseIntArray(indexText);
    for (let i = 0; i + vertexOffset < indices.length; i += stride) {
      rotorIndices.add(indices[i + vertexOffset]);
    }
  });

  // Center rotor vertices around the model's bounding box center.
  const rotorVertices: Vec3[] = [];
  rotorIndices.forEach((index) => {
    const vertex = vertices[index];
    if (!vertex) {
      return;
    }
    rotorVertices.push({
      x: vertex.x - center.x,
      y: vertex.y - center.y,
      z: vertex.z - center.z,
    });
  });

  const rotorPositions = computeRotorCenters(rotorVertices);

  return {
    rotorPositions,
    dimensions: {
      x: bounds.max.x - bounds.min.x,
      y: bounds.max.y - bounds.min.y,
      z: bounds.max.z - bounds.min.z,
    },
  };
}

function parseVec3(raw?: string | null): Vec3 {
  if (!raw) {
    return { x: 1, y: 1, z: 1 };
  }
  const values = raw.trim().split(/\s+/).map(Number);
  return {
    x: values[0] ?? 1,
    y: values[1] ?? 1,
    z: values[2] ?? 1,
  };
}

function parseFloatArray(raw: string): number[] {
  return raw.trim().split(/\s+/).map((value) => Number(value));
}

function parseIntArray(raw: string): number[] {
  return raw.trim().split(/\s+/).map((value) => Number(value));
}

function computeBounds(vertices: Vec3[]) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  vertices.forEach((vertex) => {
    min.x = Math.min(min.x, vertex.x);
    min.y = Math.min(min.y, vertex.y);
    min.z = Math.min(min.z, vertex.z);
    max.x = Math.max(max.x, vertex.x);
    max.y = Math.max(max.y, vertex.y);
    max.z = Math.max(max.z, vertex.z);
  });
  return { min, max };
}

function computeRotorCenters(rotorVertices: Vec3[]): Vec3[] {
  // Bucket vertices into four quadrants to find each rotor cluster.
  const quadrants: Vec3[][] = [[], [], [], []];

  rotorVertices.forEach((vertex) => {
    const index = vertex.x >= 0 ? (vertex.y >= 0 ? 0 : 3) : vertex.y >= 0 ? 1 : 2;
    quadrants[index].push(vertex);
  });

  if (quadrants.some((group) => group.length === 0)) {
    // Fallback: bucket by angle if quadrant bins are empty.
    const angleBins: Vec3[][] = [[], [], [], []];
    rotorVertices.forEach((vertex) => {
      const angle = Math.atan2(vertex.y, vertex.x);
      const bin = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 4) % 4;
      angleBins[bin].push(vertex);
    });
    angleBins.forEach((bin, index) => {
      if (quadrants[index].length === 0) {
        quadrants[index] = bin;
      }
    });
  }

  const centers = quadrants.map((group) => averageVec3(group));
  if (centers.some((center) => !center)) {
    throw new Error("Unable to detect four rotor positions from drone.dae");
  }

  return centers.filter((center): center is Vec3 => Boolean(center));
}

function averageVec3(points: Vec3[]): Vec3 | null {
  if (!points.length) {
    return null;
  }
  const sum = points.reduce(
    (acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
      z: acc.z + point.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
    z: sum.z / points.length,
  };
}
