import * as THREE from "three";
import type { Vec3 } from "../../types";

// Island Forge's sea and river shaders, rebuilt for its exported GLB, which bakes water to flat
// "Water" material triangles. All shading runs in the map's local frame (glTF metres, Y up), so the

const VHEAD = "#include <common>\n#include <fog_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n";
const VTAIL = "\n#include <logdepthbuf_vertex>\n#include <fog_vertex>\n";
const FHEAD = "#include <common>\n#include <fog_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n";
const FTAIL = "\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n#include <fog_fragment>\n";

/** Shares fog, log depth and tone mapping with the built-in materials, as in Island Forge. */
function fxMaterial(options: {
  uniforms: Record<string, THREE.IUniform>;
  decl: string;
  vertex: string;
  fragment: string;
  vertexDecl?: string;
  side?: THREE.Side;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: options.side ?? THREE.FrontSide,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...options.uniforms },
    vertexShader: `${VHEAD}${options.decl}${options.vertexDecl ?? ""}\nvoid main(){\n${options.vertex}${VTAIL}}`,
    fragmentShader: `${FHEAD}${options.decl}\nvoid main(){\n#include <logdepthbuf_fragment>\n${options.fragment}${FTAIL}}`,
  });
}

export interface IslandWater {
  update(seconds: number, cameraPosition: THREE.Vector3): void;
  dispose(): void;
}

/**
 * Replace the flat water of an Island Forge export with its animated shaders. `map` is the loaded
 * glTF scene, already transformed into simulator space. Returns undefined if the expected meshes are missing.
 */
export function installIslandWater(map: THREE.Object3D, sunDirection: Vec3): IslandWater | undefined {
  let terrain: THREE.Mesh | undefined;
  let sea: THREE.Mesh | undefined;
  const rivers: THREE.Mesh[] = [];
  map.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child.name === "Terrain") terrain = child;
    else if ((child.material as THREE.Material).name === "Water") {
      if (child.name === "Sea") sea = child;
      else rivers.push(child);
    }
  });
  const heightMap = terrain && terrainHeightMap(terrain.geometry);
  if (!sea || !heightMap) return undefined;

  map.updateMatrixWorld(true);
  // Sea, rivers and terrain are baked to the same frame.
  const worldToMap = sea.matrixWorld.clone().invert();
  const time = { value: 0 };
  const cameraLocal = { value: new THREE.Vector3() };
  const sunLocal = new THREE.Vector3(sunDirection.x, sunDirection.y, sunDirection.z).transformDirection(worldToMap);
  const seaLevel = sea.geometry.attributes.position.getY(0);

  // ── Sea: faceted swell, depth-tinted lagoon colours, sun glints and lapping foam ──
  const seaMaterial = fxMaterial({
    uniforms: {
      time, cameraLocal,
      heightMap: { value: heightMap.texture },
      sunDir: { value: sunLocal },
      sunColor: { value: new THREE.Color("#fff0d0") },
      shallow: { value: new THREE.Color("#5fd6c8") },
      mid: { value: new THREE.Color("#22a3b4") },
      deep: { value: new THREE.Color("#0f5f8f") },
      skyTint: { value: new THREE.Color("#c9e2ee") },
      foamColor: { value: new THREE.Color("#f6fbf6") },
    },
    decl: `uniform float time;uniform vec3 cameraLocal;uniform sampler2D heightMap;
      uniform vec3 sunDir,sunColor,shallow,mid,deep,skyTint,foamColor;varying vec3 vLocal;
      const float HALF=${heightMap.half.toFixed(1)},RES=${heightMap.res.toFixed(1)};`,
    vertex: `vec3 p=position;float fade=1.-smoothstep(900.,2600.,length(p.xz));
      p.y+=fade*(sin(p.x*.045+time*.5)*cos(p.z*.04-time*.38)*.42+sin((p.x-p.z)*.09+time*.8)*.14);
      vLocal=p;vec4 mvPosition=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;`,
    fragment: `vec3 n=normalize(cross(dFdx(vLocal),dFdy(vLocal)));if(n.y<0.)n=-n;
      vec2 uv=((vLocal.xz+HALF)/(2.*HALF)*RES+.5)/(RES+1.);float ground=-40.;
      if(uv.x>0.&&uv.y>0.&&uv.x<1.&&uv.y<1.)ground=texture2D(heightMap,uv).r;
      float depth=vLocal.y-ground;vec3 col=mix(shallow,mid,smoothstep(.0,7.,depth));col=mix(col,deep,smoothstep(7.,32.,depth));
      vec3 v=normalize(cameraLocal-vLocal);float fres=pow(1.-max(dot(n,v),0.),4.);
      col*=.82+.3*max(dot(n,sunDir),0.);col=mix(col,skyTint,fres*.6);
      col+=sunColor*pow(max(dot(n,normalize(sunDir+v)),0.),260.)*2.4;
      float band=1.-smoothstep(0.,1.6,depth);float lap=.5+.5*sin(depth*5.5-time*1.4+sin(vLocal.x*.05)*2.);
      float foam=clamp(band*(.45+.55*lap)+smoothstep(.25,0.,depth),0.,1.);
      col=mix(col,foamColor,foam*.85);gl_FragColor=vec4(col,max(mix(.55,.95,smoothstep(0.,6.,depth)),foam*.92));`,
  });
  // The exported quad has 4 vertices; the swell needs Island Forge's 9 km, 240² grid.
  const seaGeometry = new THREE.PlaneGeometry(9000, 9000, 240, 240).rotateX(-Math.PI / 2).translate(0, seaLevel, 0);
  sea.geometry.dispose();
  (sea.material as THREE.Material).dispose();
  sea.geometry = seaGeometry;
  sea.material = seaMaterial;
  sea.renderOrder = 1;
  sea.frustumCulled = false;
  sea.castShadow = false;

  // ── Rivers, waterfall curtains and spray, which the export merged into one triangle list ──
  const riverMaterial = fxMaterial({
    uniforms: {
      time,
      deepC: { value: new THREE.Color("#2a9fae") },
      lightC: { value: new THREE.Color("#68d3c6") },
      foamC: { value: new THREE.Color("#eefaf4") },
      sprayC: { value: new THREE.Color("#f2fbf7") },
    },
    side: THREE.DoubleSide,
    decl: "uniform float time;uniform vec3 deepC,lightC,foamC,sprayC;varying vec2 vUv;varying float vKind;",
    vertexDecl: "attribute float waterKind;",
    vertex: "vUv=uv;vKind=waterKind;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;",
    fragment: `if(vKind>1.5){gl_FragColor=vec4(sprayC,.5);}
      else if(vKind>.5){float ribbon=sin(vUv.x*31.+sin(vUv.y*6.+time)*2.5);float streak=sin(vUv.y*24.+time*9.+vUv.x*7.);
        float foam=clamp(.5+.25*ribbon+.3*streak,0.,1.);gl_FragColor=vec4(mix(vec3(.12,.55,.62),vec3(.93,.98,.97),foam),.78+.18*foam);}
      else{float flow=sin(vUv.y*12.-time*2.2+sin(vUv.x*9.)*.8);float edge=smoothstep(.3,.5,abs(vUv.x-.5));
        vec3 col=mix(deepC,lightC,.45+.25*flow);col=mix(col,foamC,edge*.55+smoothstep(.8,1.,flow)*.3);gl_FragColor=vec4(col,.92);}`,
  });
  for (const river of rivers) {
    if (!rebuildRiverAttributes(river.geometry)) continue;
    (river.material as THREE.Material).dispose();
    river.material = riverMaterial;
    river.renderOrder = 2;
    river.castShadow = false;
  }

  const camera = new THREE.Vector3();
  return {
    update(seconds, cameraPosition) {
      time.value = seconds;
      cameraLocal.value.copy(camera.copy(cameraPosition).applyMatrix4(worldToMap));
    },
    dispose() {
      heightMap.texture.dispose();
      seaMaterial.dispose();
      riverMaterial.dispose();
    },
  };
}

/** The exported terrain is Island Forge's (RES + 1)² height grid, row-major in Z then X. */
function terrainHeightMap(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position;
  const n = Math.round(Math.sqrt(position.count));
  if (n < 2 || n * n !== position.count) return undefined;
  const heights = new Uint16Array(n * n);
  for (let i = 0; i < n * n; i++) heights[i] = THREE.DataUtils.toHalfFloat(position.getY(i));
  const texture = new THREE.DataTexture(heights, n, n, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, half: Math.abs(position.getX(0)), res: n - 1 };
}

const CURTAIN_ACROSS = 10;
const CURTAIN_ROWS = 12;
const CURTAIN_TRIANGLES = CURTAIN_ACROSS * CURTAIN_ROWS * 2;

/**
 * Recover the UVs the river shaders need. Per river, the export wrote the ribbon (quads of
 * (L_i, R_i, L_i+1), (R_i, R_i+1, L_i+1)), then a 10×12 waterfall curtain, then 90 white spray
 * rocks; ribbons have even length, so triangle parity gives the side of the river.
 * waterKind: 0 river, 1 waterfall, 2 spray.
 */
function rebuildRiverAttributes(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.attributes.position;
  const color = geometry.attributes.color;
  if (geometry.index || !color || position.count % 3) return false;
  const triangles = position.count / 3;
  const kind = new Float32Array(triangles).fill(0);
  for (let t = 0; t < triangles; t++) {
    if (color.getX(t * 3) <= 0.5) continue;
    kind[t] = 2;
    if (t > 0 && kind[t - 1] !== 2) kind.fill(1, Math.max(0, t - CURTAIN_TRIANGLES), t);
  }
  const uv = new Float32Array(position.count * 2);
  const waterKind = new Float32Array(position.count);
  const ribbonA = [0, 1, 0];
  const ribbonB = [1, 1, 0];
  let curtainStart = 0;
  for (let t = 0; t < triangles; t++) {
    if (kind[t] === 1 && kind[t - 1] !== 1) curtainStart = t;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = t * 3 + corner;
      waterKind[vertex] = kind[t];
      if (kind[t] === 0) {
        uv[vertex * 2] = (t % 2 === 0 ? ribbonA : ribbonB)[corner];
        uv[vertex * 2 + 1] = position.getZ(vertex) / 24;
      } else if (kind[t] === 1) {
        // Cell (row, col) is (k, k + 11, k + 1), (k + 1, k + 11, k + 12) for k = row * 11 + col.
        const i = t - curtainStart;
        const cell = i >> 1;
        const row = Math.floor(cell / CURTAIN_ACROSS) + (i % 2 === 0 ? [0, 1, 0] : [0, 1, 1])[corner];
        const col = (cell % CURTAIN_ACROSS) + (i % 2 === 0 ? [0, 0, 1] : [1, 0, 1])[corner];
        uv[vertex * 2] = col / CURTAIN_ACROSS;
        uv[vertex * 2 + 1] = row / CURTAIN_ROWS;
      }
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("waterKind", new THREE.BufferAttribute(waterKind, 1));
  return true;
}
