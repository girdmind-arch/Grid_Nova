import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GridState, Zone } from "@/types/grid";
import { formatKw, formatNumber } from "@/utils/format";
import * as M from "./models";

/**
 * The 3D campus grid: platforms for every source and building, glowing feeder
 * lines with power flowing along them, and floating labels with live numbers.
 * Plain three.js (no React) so the canvas can be updated in place every few
 * seconds without re-creating anything. All colours come from theme tokens.
 */

/** What the host (React) needs to know when a building is picked. */
export type PickId = string;

type Tone = "solar" | "battery" | "grid" | "zone" | "fault" | "reroute" | "idle";

interface Palette {
  ground: THREE.Color;
  gridLine: THREE.Color;
  platform: THREE.Color;
  platformEdge: THREE.Color;
  body: THREE.Color;
  roof: THREE.Color;
  dark: THREE.Color;
  window: THREE.Color;
  accent: THREE.Color;
  success: THREE.Color;
  warning: THREE.Color;
  danger: THREE.Color;
  ai: THREE.Color;
  solar: THREE.Color;
  idle: THREE.Color;
  leaf: THREE.Color;
  trunk: THREE.Color;
  panel: THREE.Color;
  lamp: THREE.Color;
  dark_mode: boolean;
}

function readPalette(): Palette {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const c = (n: string, f: string) => {
    try {
      return new THREE.Color(v(n) || f);
    } catch {
      return new THREE.Color(f);
    }
  };
  const dark = root.dataset.theme === "dark";
  return {
    dark_mode: dark,
    ground: c("--bg", dark ? "#0a0d0c" : "#e9e6df"),
    gridLine: dark ? new THREE.Color("#6f8f86") : new THREE.Color("#8a8478"),
    platform: dark ? new THREE.Color("#1d2523") : new THREE.Color("#f6f4ef"),
    platformEdge: dark ? new THREE.Color("#2c3633") : new THREE.Color("#d9d4ca"),
    body: dark ? new THREE.Color("#c9d3cf") : new THREE.Color("#fbfaf7"),
    roof: dark ? new THREE.Color("#7f8c88") : new THREE.Color("#cfc9bd"),
    dark: dark ? new THREE.Color("#2a3a4a") : new THREE.Color("#34495e"),
    window: dark ? new THREE.Color("#ffd29a") : new THREE.Color("#f2b35a"),
    accent: c("--accent", "#0d6b5f"),
    success: c("--success", "#3b7414"),
    warning: c("--warning", "#a14f00"),
    danger: c("--danger", "#b3261e"),
    ai: c("--ai", "#2d5b88"),
    solar: c("--solar", "#965400"),
    idle: dark ? new THREE.Color("#3a4743") : new THREE.Color("#c7c1b5"),
    leaf: dark ? new THREE.Color("#4f7a58") : new THREE.Color("#6f9a5e"),
    trunk: dark ? new THREE.Color("#6b5d50") : new THREE.Color("#8a7762"),
    panel: dark ? new THREE.Color("#23405f") : new THREE.Color("#2f5176"),
    lamp: new THREE.Color("#ffe2a6"),
  };
}

// ---------- layout (world units; x → right, z → towards the viewer) ----------
const ZONE_X = [0, 3.1, 6.2, 9.3, 12.4];
const ROW_Z = { top: -4.6, bottom: 4.6 };
const SPINE_Z = 0;
const NARROW_STRETCH = 1.24;
const HUB = new THREE.Vector3(-3.6, 0, 0);
const SRC = {
  solar: new THREE.Vector3(-9.6, 0, -4.6),
  battery: new THREE.Vector3(-3.6, 0, -5.4),
  grid: new THREE.Vector3(-9.6, 0, 4.6),
};

interface NodeView {
  group: THREE.Group;
  ring: THREE.LineLoop;
  label: CSS2DObject;
  model: THREE.Group;
  slot?: number; // position along the campus (zones only)
  heat: THREE.Mesh; // coloured pad under the building: how hard it is working
  lift: number; // current hover/selection lift
  liftTarget: number;
  windowLevel?: number; // last window brightness applied (skip identical updates)
  labelHtml?: string; // last label markup written (skip identical updates)
}

type LineArgs = [points: THREE.Vector3[], kw: number, maxKw: number, tone: Tone, opts?: { reverse?: boolean }];

interface FlowLine {
  group: THREE.Group;
  curve: THREE.CurvePath<THREE.Vector3>;
  length: number;
  dots: THREE.InstancedMesh | null;
  packets: THREE.InstancedMesh | null;
  packetGlow: THREE.InstancedMesh | null;
  phase: number;
  reverse: boolean;
}

/** Orthogonal route with rounded corners through the given points (on the ground). */
function route(points: THREE.Vector3[], r = 0.55, y = 0.06) {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const p = points.map((q) => new THREE.Vector3(q.x, y, q.z));
  let start = p[0];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1];
    const b = p[i];
    const c = p[i + 1];
    const din = b.clone().sub(a).normalize();
    const dout = c.clone().sub(b).normalize();
    const rr = Math.min(r, b.distanceTo(a) / 2, c.distanceTo(b) / 2);
    const p1 = b.clone().sub(din.clone().multiplyScalar(rr));
    const p2 = b.clone().add(dout.clone().multiplyScalar(rr));
    if (start.distanceTo(p1) > 1e-4) path.add(new THREE.LineCurve3(start, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, b, p2));
    start = p2;
  }
  path.add(new THREE.LineCurve3(start, p[p.length - 1]));
  return path;
}

function roundedRect(w: number, d: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Shorter names for small screens, where full labels would overlap. */
const SHORT: Record<string, string> = {
  "Electrical Lab": "Elec. Lab",
  "Computer Science Lab": "CS Lab",
  "Central Library": "Library",
  "Lecture Theatres": "Lectures",
  "Admin Block": "Admin",
  "Faculty Compound": "Faculty",
  "Campus load": "Campus",
  "Main grid": "Grid",
};
const shortName = (n: string) => SHORT[n] ?? n;

export class GridScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private pal: Palette;
  private mats: {
    platform: THREE.MeshStandardMaterial;
    platformSide: THREE.MeshStandardMaterial;
    models: M.ModelMaterials;
    batteryFill: THREE.MeshStandardMaterial;
    ground: THREE.ShaderMaterial;
  };
  private nodes = new Map<string, NodeView>();
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private rim!: THREE.DirectionalLight;
  private shadowGround!: THREE.Mesh;
  private motes!: THREE.Points;
  private night = 0; // 0 = full day, 1 = deep night
  private sunAngle = Math.PI / 2;
  private shadowK = 1;
  private solarFrac = 0;
  private solarPeak = 300;
  private batteryDir = 0;
  private loadFrac = 0;
  private t = 0;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hoverId: PickId | null = null;
  private selectedId: PickId | null = null;
  private home = { target: new THREE.Vector3(), dist: 30 };
  private fly: { t: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromD: number; toD: number } | null = null;
  private down: { x: number; y: number; at: number } | null = null;
  private cleanup: (() => void)[] = [];
  private flags: THREE.Object3D[] = [];
  /** Called when the user picks (or un-picks) a building. */
  onPick: ((id: PickId | null) => void) | null = null;
  private lines: FlowLine[] = [];
  private lineGroup = new THREE.Group();
  private dotGeo = new THREE.SphereGeometry(0.075, 10, 8);
  private packetGeo = new THREE.SphereGeometry(0.13, 12, 10);
  private clock = new THREE.Clock();
  private raf = 0;
  private running = false;
  private disposed = false;
  private reduceMotion: boolean;
  private narrow = false;
  private compact = false;
  /** Phones and small screens: lower resolution, 30 fps, cheaper shadows and glass. */
  private lowPower: boolean;
  private lastTick = 0;
  /** Materials shared by the flow lines, so rebuilding lines never recompiles shaders. */
  private lineMats = new Map<string, THREE.Material>();
  private windowMats = new Map<number, THREE.MeshStandardMaterial>();
  private lineSig = "";
  private labelsDirty = true;
  private shadowsDirty = true;
  private shadowAge = 0;
  private lastCam = new Float32Array(18);
  private width = 1;
  private height = 1;
  private state: GridState | null = null;
  private faultT = 0;

  constructor(private host: HTMLElement) {
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.pal = readPalette();

    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    this.lowPower = coarsePointer || window.matchMedia("(max-width: 700px)").matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: this.lowPower ? "default" : "high-performance" });
    // A phone at 3x would render ~9x the pixels of a laptop: 1.25x is sharp enough for this scene.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.25 : 1.75));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.lowPower ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    // Shadows only change when something moves: re-render them on demand, not every frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.style.display = "block";
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    const ld = this.labels.domElement;
    ld.style.position = "absolute";
    ld.style.inset = "0";
    ld.style.pointerEvents = "none";
    ld.className = "grid3d-labels";
    host.appendChild(ld);

    // lights
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1e0, 1.4);
    this.sun.position.set(-8, 14, 10);
    const small = window.matchMedia("(max-width: 700px)").matches;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.sun.target.position.set(1.5, 0, 0);
    this.rim = new THREE.DirectionalLight(0xbfd8ff, 0.5);
    this.rim.position.set(10, 6, -10);
    this.scene.add(this.rim);

    this.mats = {
      platform: new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 }),
      platformSide: new THREE.MeshStandardMaterial({ roughness: 0.8 }),
      batteryFill: new THREE.MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 0.9 }),
      models: {
        body: new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }),
        roof: new THREE.MeshStandardMaterial({ roughness: 0.7 }),
        dark: new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 }),
        window: new THREE.MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 1 }),
        // Transmission renders the scene a second time every frame: desktop only.
        glass: this.lowPower
          ? new THREE.MeshStandardMaterial({ roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.4 })
          : new THREE.MeshPhysicalMaterial({ roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.35, thickness: 0.2 }),
        metal: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 }),
        panel: new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.5, emissiveIntensity: 0 }),
        leaf: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
        trunk: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
        lamp: new THREE.MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.2 }),
        glow: new THREE.MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 1.1 }),
      },
      ground: this.groundMaterial(),
    };

    this.scene.add(this.root);
    this.buildGround();
    this.buildNodes();
    this.root.add(this.lineGroup);
    this.buildMotes();
    this.applyPalette();
    this.setAtmosphere(12);
    this.bindPointer();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.5;
    this.controls.maxPolarAngle = 1.15;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.6;
    // Touch screens keep normal page scrolling; mouse users can drag and zoom.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.controls.enabled = !coarse;
    this.controls.enableZoom = false;
    this.controls.addEventListener("change", () => this.requestFrame());
  }

  // ---------- ground: soft grid that fades out at the edges ----------
  private groundMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uLine: { value: new THREE.Color() },
        uAlpha: { value: 0.5 },
      },
      vertexShader: `varying vec2 vXZ; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform vec3 uLine; uniform float uAlpha; varying vec2 vXZ;
        float gridLine(vec2 p, float s, float w){ vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s); return 1.0 - min(min(g.x, g.y) / w, 1.0); }
        void main(){
          float minor = gridLine(vXZ, 1.0, 1.0) * 0.35;
          float major = gridLine(vXZ, 4.0, 1.2) * 0.7;
          vec2 c = (vXZ - vec2(1.5, 0.0)) / vec2(20.0, 12.0);
          float fade = 1.0 - smoothstep(0.55, 1.0, length(c));
          float a = max(minor, major) * fade * uAlpha;
          gl_FragColor = vec4(uLine, a);
        }`,
      extensions: { derivatives: true } as never,
    });
  }

  private buildGround() {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), this.mats.ground);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(1.5, -0.001, 0);
    this.root.add(plane);
    // soft shadows land on a see-through plane so the page background shows through
    this.shadowGround = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.ShadowMaterial({ opacity: 0.2 }));
    this.shadowGround.rotation.x = -Math.PI / 2;
    this.shadowGround.position.set(1.5, 0.002, 0);
    this.shadowGround.receiveShadow = true;
    this.root.add(this.shadowGround);
  }

  /** A few drifting specks of light, like dust in low sun. Purely decorative. */
  private buildMotes() {
    const n = 70;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -14 + Math.random() * 32;
      pos[i * 3 + 1] = 0.3 + Math.random() * 4.5;
      pos[i * 3 + 2] = -9 + Math.random() * 18;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.06, transparent: true, opacity: 0.4, depthWrite: false, sizeAttenuation: true }));
    this.root.add(this.motes);
  }

  // ---------- platforms + models ----------
  private platform(size: [number, number]) {
    const [w, d] = size;
    const shape = roundedRect(w, d, 0.35);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 8 });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, [this.mats.platform, this.mats.platformSide]);
    const pts = shape.getPoints(32).map((p) => new THREE.Vector3(p.x * 1.04, 0.3, -p.y * 1.04));
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }));
    return { mesh, ring };
  }

  private addNode(id: string, pos: THREE.Vector3, size: [number, number], model: THREE.Group, lift = 0, labelInFront = false, slot?: number) {
    const group = new THREE.Group();
    group.position.copy(pos);
    const { mesh, ring } = this.platform(size);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh, ring);
    // heat pad: a thin coloured plate that glows with the load
    const pad = new THREE.Mesh(
      new THREE.ShapeGeometry(roundedRect(size[0] - 0.3, size[1] - 0.3, 0.25), 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.282;
    group.add(pad);
    model.position.y = 0.27;
    model.traverse((o) => {
      const me = o as THREE.Mesh;
      if (me.isMesh) {
        me.castShadow = !(me as THREE.InstancedMesh).isInstancedMesh && !o.userData.flag;
        me.receiveShadow = true;
      }
    });
    model.traverse((o) => o.userData.flag && this.flags.push(o));
    this.mergeStatic(model);
    group.add(model);
    group.userData.nodeId = id;
    const el = document.createElement("div");
    el.className = "grid3d-label";
    const label = new CSS2DObject(el);
    const top = new THREE.Box3().setFromObject(model).max.y;
    if (labelInFront) label.position.set(0, 0.2, size[1] / 2 + 0.75 + lift);
    else label.position.set(0, Math.max(1.2, top) + 0.75 + lift, 0);
    group.add(label);
    this.root.add(group);
    this.nodes.set(id, { group, ring, label, model, heat: pad, lift: 0, liftTarget: 0, slot });
  }

  /**
   * Fuses a model's static parts into one mesh per material. Each building is made of
   * dozens of small boxes; drawing them one by one cost ~350 draw calls per frame, which
   * is what slowed phones down. Moving parts (solar panels, battery fills and rings,
   * the bus halo, flags), windows, lines and see-through parts are left as they are.
   */
  private mergeStatic(model: THREE.Group) {
    const skip = new Set<THREE.Object3D>();
    const ud = model.userData;
    for (const k of ["panels", "fills", "rings"]) for (const o of (ud[k] ?? []) as THREE.Object3D[]) o.traverse((c) => skip.add(c));
    if (ud.halo) (ud.halo as THREE.Object3D).traverse((c) => skip.add(c));
    model.traverse((o) => {
      if (o.userData.flag) o.traverse((c) => skip.add(c));
    });
    model.updateMatrixWorld(true);
    const inv = model.matrixWorld.clone().invert();
    const buckets = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || skip.has(m) || Array.isArray(m.material)) return;
      const mat = m.material as THREE.Material;
      if (mat.transparent) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
      if (!g.getAttribute("normal")) g.computeVertexNormals();
      g.morphAttributes = {};
      g.clearGroups();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const key = `${mat.uuid}|${m.castShadow}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat, cast: m.castShadow, geos: [], meshes: [] }));
      b.geos.push(g);
      b.meshes.push(m);
    });
    for (const b of buckets.values()) {
      if (b.meshes.length < 2) {
        b.geos.forEach((g) => g.dispose());
        continue;
      }
      const merged = mergeGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      for (const m of b.meshes) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = true;
      model.add(mesh);
    }
  }

  private buildNodes() {
    const m = this.mats.models;
    this.addNode("solar", SRC.solar, [3.4, 2.8], M.solarFarm(m));
    this.addNode("battery", SRC.battery, [3.0, 2.2], M.batteryBank(m, this.mats.batteryFill));
    this.addNode("grid", SRC.grid, [3.4, 2.8], M.gridSubstation(m));
    this.addNode("bus", HUB, [2.0, 2.0], M.campusBus(m));
  }

  /** Builds or refreshes zone platforms from the state (ids are stable). */
  private ensureZones(zones: Zone[]) {
    const placed = this.zoneSlots(zones);
    for (const { zone, pos, index, row } of placed) {
      if (this.nodes.has(zone.id)) continue;
      const m = this.mats.models;
      const model =
        zone.kind === "hostel" ? M.hostel(m)
        : zone.kind === "lab" ? M.lab(m)
        : zone.kind === "library" ? M.library(m)
        : zone.kind === "academic" ? M.lecture(m)
        : zone.kind === "residence" ? M.faculty(m)
        : M.admin(m);
      // Neighbouring labels sit at alternating heights so they never overlap.
      // Back row: labels above the roofs at alternating heights. Front row: labels
      // in front of the platforms (also alternating), so neighbours never overlap.
      if (row === "top") this.addNode(zone.id, pos, [2.4, 2.2], model, index % 2 === 1 ? 1.25 : 0, false, index);
      else this.addNode(zone.id, pos, [2.4, 2.2], model, index % 2 === 1 ? 1.9 : 0, true, index);
    }
  }

  /**
   * x of the i-th building slot. On a phone the campus is turned to run top to
   * bottom, where the card has spare height but little width, so the slots
   * are spread out along it (this gives the labels room).
   */
  private zx(i: number) {
    return ZONE_X[i] * (this.narrow ? NARROW_STRETCH : 1);
  }

  /** Residential buildings along the back row, academic/admin along the front. */
  private zoneSlots(zones: Zone[]) {
    const residential = (z: Zone) => z.kind === "hostel" || z.kind === "residence";
    const back = zones.filter(residential).slice(0, ZONE_X.length);
    const front = zones.filter((z) => !residential(z)).slice(0, ZONE_X.length);
    return [
      ...back.map((zone, i) => ({ zone, index: i, pos: new THREE.Vector3(this.zx(i), 0, ROW_Z.top), row: "top" as const, x: this.zx(i) })),
      ...front.map((zone, i) => ({ zone, index: i, pos: new THREE.Vector3(this.zx(i), 0, ROW_Z.bottom), row: "bottom" as const, x: this.zx(i) })),
    ];
  }

  // ---------- time of day ----------
  /** Light follows the simulated hour: warm low sun at the edges of the day, cool dim light at night. */
  private setAtmosphere(hour: number) {
    const a = Math.PI * ((hour - 6) / 12); // 0 at 06:00, π/2 at noon, π at 18:00
    const elev = Math.sin(a); // −1 … 1
    const day = THREE.MathUtils.smoothstep(elev, -0.08, 0.32);
    this.night = 1 - day;
    this.sunAngle = a;
    const sx = -Math.cos(a) * 15;
    const sy = 3 + Math.max(0.1, elev) * 13;
    // after dusk the same light becomes soft moonlight from a high, fixed angle (short shadows)
    this.sun.position.set(sx, sy, 9).lerp(new THREE.Vector3(-6, 15, 9), this.night);
    const warm = new THREE.Color("#ff9d5c").lerp(new THREE.Color("#fff1e0"), THREE.MathUtils.smoothstep(elev, 0.05, 0.6));
    this.sun.color.copy(warm);
    this.sun.intensity = 0.25 + 1.25 * day;
    this.hemi.intensity = 0.95 + 0.7 * day;
    this.hemi.color.set(day > 0.5 ? "#ffffff" : "#aebbe0");
    this.rim.intensity = 0.35 + 0.25 * this.night;
    this.rim.color.set(this.night > 0.5 ? "#8fa8e8" : "#bfd8ff");
    this.renderer.toneMappingExposure = 1.05 - 0.12 * this.night;
    this.shadowK = 1 - 0.6 * this.night;
    (this.shadowGround.material as THREE.ShadowMaterial).opacity = (this.pal.dark_mode ? 0.38 : 0.15) * this.shadowK;
    // windows and lamps brighten as the light fades
    this.mats.models.window.emissiveIntensity = 0.55 + 1.1 * this.night;
    this.mats.models.lamp.emissiveIntensity = 0.15 + 2.2 * this.night;
    this.mats.models.glow.emissiveIntensity = 0.9 + 0.8 * this.night;
  }

  /**
   * The hour (0–24) of the state's timestamp. An explicit offset (the backend sends
   * IST) is read as written; a UTC "Z" stamp (demo data) is shown in the viewer's clock.
   */
  private hourOf(ts: string) {
    if (/Z$/.test(ts)) {
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? 12 : d.getHours() + d.getMinutes() / 60;
    }
    const m = /T(\d{2}):(\d{2})/.exec(ts);
    return m ? Number(m[1]) + Number(m[2]) / 60 : 12;
  }

  // ---------- colours ----------
  applyPalette() {
    this.pal = readPalette();
    const p = this.pal;
    this.mats.platform.color.copy(p.platform);
    this.mats.platformSide.color.copy(p.platformEdge);
    this.mats.models.body.color.copy(p.body);
    this.mats.models.roof.color.copy(p.roof);
    this.mats.models.dark.color.copy(p.dark);
    this.mats.models.window.color.copy(p.window);
    this.mats.models.window.emissive.copy(p.window);
    this.mats.models.glass.color.set(p.dark_mode ? "#9fd8ff" : "#ffffff");
    this.mats.models.metal.color.copy(p.dark_mode ? p.body : p.roof).multiplyScalar(p.dark_mode ? 1 : 0.7);
    const mm = this.mats.models;
    mm.leaf.color.copy(p.leaf);
    mm.trunk.color.copy(p.trunk);
    mm.panel.color.copy(p.panel);
    mm.panel.emissive.copy(p.solar);
    mm.lamp.color.copy(p.lamp);
    mm.lamp.emissive.copy(p.lamp);
    mm.glow.color.copy(p.accent);
    mm.glow.emissive.copy(p.accent);
    (this.shadowGround.material as THREE.ShadowMaterial).opacity = (p.dark_mode ? 0.38 : 0.15) * this.shadowK;
    (this.motes.material as THREE.PointsMaterial).color.copy(p.dark_mode ? p.window : p.solar);
    this.mats.batteryFill.color.copy(p.success);
    this.mats.batteryFill.emissive.copy(p.success);
    this.mats.ground.uniforms.uLine.value.copy(p.gridLine);
    this.mats.ground.uniforms.uAlpha.value = p.dark_mode ? 0.45 : 0.4;
    // colours changed: drop the cached line and window looks so they are rebuilt in the new palette
    this.clearLines();
    this.lineMats.forEach((m) => m.dispose());
    this.lineMats.clear();
    this.lineSig = "";
    this.windowMats.forEach((m) => m.dispose());
    this.windowMats.clear();
    for (const n of this.nodes.values()) n.windowLevel = undefined;
    if (this.state) this.update(this.state);
    this.shadowsDirty = true;
    this.requestFrame();
  }

  private tone(t: Tone) {
    const p = this.pal;
    return t === "solar" ? p.solar : t === "battery" ? p.success : t === "fault" ? p.danger : t === "reroute" ? p.ai : t === "idle" ? p.idle : p.accent;
  }

  // ---------- flow lines ----------
  private clearLines() {
    for (const l of this.lines) {
      l.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry && mesh.geometry !== this.dotGeo && mesh.geometry !== this.packetGeo) mesh.geometry.dispose();
        // materials come from lineMats and are shared: they stay alive for the next build
      });
      if (l.dots) l.dots.dispose();
      if (l.packets) l.packets.dispose();
      if (l.packetGlow) l.packetGlow.dispose();
      this.lineGroup.remove(l.group);
    }
    this.lines = [];
  }

  /** One shared material per look, so line rebuilds reuse compiled shaders. */
  private lineMat(key: string, make: () => THREE.Material) {
    let m = this.lineMats.get(key);
    if (!m) {
      m = make();
      this.lineMats.set(key, m);
    }
    return m;
  }

  private addLine(points: THREE.Vector3[], kw: number, maxKw: number, tone: Tone, opts: { reverse?: boolean } = {}) {
    const curve = route(points);
    const length = curve.getLength();
    const group = new THREE.Group();
    const active = kw > 1 && tone !== "fault";
    const color = this.tone(active || tone === "fault" ? tone : "idle");
    const r = 0.035 + 0.055 * Math.sqrt(Math.min(Math.max(kw, 0), maxKw) / maxKw);
    const segs = Math.max(24, Math.round(length * 10));

    const hex = color.getHexString();
    const dark = this.pal.dark_mode;
    const core = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segs, tone === "fault" ? 0.05 : r, this.lowPower ? 6 : 8, false),
      this.lineMat(`core|${hex}|${tone === "fault"}`, () => new THREE.MeshBasicMaterial({ color, transparent: tone === "fault", opacity: 1 })),
    );
    group.add(core);
    if (active || tone === "fault") {
      const glow = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segs, r * 3.2 + 0.05, this.lowPower ? 6 : 8, false),
        this.lineMat(`glow|${hex}|${dark}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: dark ? 0.22 : 0.16, depthWrite: false, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending })),
      );
      group.add(glow);
    }

    let dots: THREE.InstancedMesh | null = null;
    let packets: THREE.InstancedMesh | null = null;
    let packetGlow: THREE.InstancedMesh | null = null;
    if (active) {
      // a few bigger "packets" of energy ride the line; heavier flow, more packets
      const np = Math.max(1, Math.min(5, Math.round(length / 6 + Math.sqrt(Math.min(kw, maxKw) / maxKw) * 2)));
      packets = new THREE.InstancedMesh(this.packetGeo, this.lineMat(`packet|${hex}`, () => new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color("#ffffff"), 0.7) })), np);
      packetGlow = new THREE.InstancedMesh(
        this.packetGeo,
        this.lineMat(`packetGlow|${hex}|${dark}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: dark ? 0.35 : 0.22, depthWrite: false, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending })),
        np,
      );
      group.add(packets, packetGlow);
    }
    if (active) {
      const n = Math.max(2, Math.min(16, Math.round(length * (0.35 + 0.9 * Math.sqrt(Math.min(kw, maxKw) / maxKw)))));
      dots = new THREE.InstancedMesh(this.dotGeo, this.lineMat(`dot|${hex}`, () => new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color("#ffffff"), 0.45) })), n);
      group.add(dots);
    }
    if (tone === "fault") {
      // a red break marker in the middle of the line
      const mid = curve.getPointAt(0.5);
      const x = new THREE.Group();
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), this.lineMat(`bar|${this.pal.danger.getHexString()}`, () => new THREE.MeshBasicMaterial({ color: this.pal.danger })));
        bar.rotation.y = a;
        x.add(bar);
      }
      x.position.copy(mid).add(new THREE.Vector3(0, 0.25, 0));
      x.userData.fault = true;
      group.add(x);
    }
    this.lineGroup.add(group);
    const line: FlowLine = { group, curve, length, dots, packets, packetGlow, phase: Math.random(), reverse: !!opts.reverse };
    this.placeDots(line);
    this.lines.push(line);
  }

  private placeDots(l: FlowLine) {
    if (l.packets && l.packetGlow) {
      const np = l.packets.count;
      const mt = new THREE.Matrix4();
      const sc = new THREE.Matrix4();
      for (let i = 0; i < np; i++) {
        let t = (l.phase * 1.25 + i / np) % 1;
        if (l.reverse) t = 1 - t;
        const p = l.curve.getPointAt(t);
        // swell slightly as they pass, like a pulse
        const k = 1 + 0.25 * Math.sin((t + this.t * 0.4) * Math.PI * 2);
        mt.makeTranslation(p.x, p.y + 0.04, p.z);
        l.packets.setMatrixAt(i, mt.clone().multiply(sc.makeScale(k, k, k)));
        l.packetGlow.setMatrixAt(i, mt.clone().multiply(sc.makeScale(2.6 * k, 2.6 * k, 2.6 * k)));
      }
      l.packets.instanceMatrix.needsUpdate = true;
      l.packetGlow.instanceMatrix.needsUpdate = true;
    }
    if (!l.dots) return;
    const m = new THREE.Matrix4();
    const n = l.dots.count;
    for (let i = 0; i < n; i++) {
      let t = (l.phase + i / n) % 1;
      if (l.reverse) t = 1 - t;
      const p = l.curve.getPointAt(t);
      m.makeTranslation(p.x, p.y + 0.02, p.z);
      l.dots.setMatrixAt(i, m);
    }
    l.dots.instanceMatrix.needsUpdate = true;
  }

  // ---------- data ----------
  update(state: GridState) {
    this.state = state;
    this.shadowsDirty = true; // the sun may have moved with the clock
    const before = this.nodes.size;
    this.ensureZones(state.zones);
    if (this.nodes.size !== before) {
      this.root.updateMatrixWorld(true);
      this.fitCamera();
    }
    this.setAtmosphere(this.hourOf(state.timestamp));
    this.solarPeak = Math.max(this.solarPeak, state.solarKw);
    this.solarFrac = Math.min(1, state.solarKw / this.solarPeak);
    this.loadFrac = Math.min(1, state.demandKw / Math.max(600, this.solarPeak * 2));
    const outage = state.activeFault?.type === "grid_outage";
    const batteryOut = Math.max(0, -state.battery.powerKw);
    const batteryIn = Math.max(0, state.battery.powerKw);
    const maxKw = Math.max(400, state.demandKw / 2);

    // labels + rings for sources
    this.setLabel("solar", "Solar", formatKw(state.solarKw), state.solarKw > 0 ? "Generating" : "No output", "solar");
    this.setLabel(
      "battery",
      "Battery",
      `${state.battery.socPct}%`,
      batteryOut > 0 ? `Supplying ${formatKw(batteryOut)}` : batteryIn > 0 ? `Charging ${formatKw(batteryIn)}` : "Standby · ready",
      "battery",
    );
    this.setLabel("grid", "Main grid", outage ? "Offline" : formatKw(state.gridImportKw), outage ? "Supply lost" : `₹${state.tariff.ratePerKwh.toFixed(2)}/kWh`, outage ? "fault" : "grid");
    this.setLabel("bus", "Campus load", `${formatNumber(state.demandKw)} kW`, undefined, "zone");
    this.ring("solar", state.solarKw > 0 ? "solar" : "idle");
    this.ring("battery", "battery");
    this.ring("grid", outage ? "fault" : "zone");
    this.ring("bus", "zone");
    this.setHeat("solar", this.pal.solar, 0.06 + 0.3 * this.solarFrac);
    this.setHeat("battery", this.pal.success, 0.1 + 0.15 * (state.battery.socPct / 100));
    this.setHeat("grid", outage ? this.pal.danger : this.pal.accent, outage ? 0.35 : 0.08 + 0.2 * Math.min(1, state.gridImportKw / Math.max(400, state.demandKw)));
    this.setHeat("bus", this.pal.accent, 0.1 + 0.25 * this.loadFrac);

    this.batteryDir = batteryIn > 1 ? 1 : batteryOut > 1 ? -1 : 0;
    // battery fill height follows the state of charge
    const fills = (this.nodes.get("battery")?.model.userData.fills ?? []) as THREE.Mesh[];
    const frac = Math.max(0.05, Math.min(1, state.battery.socPct / 100));
    for (const f of fills) {
      const h = (f.userData.maxH as number) * frac;
      f.scale.y = h;
      f.position.y = (f.userData.baseY as number) + h / 2;
    }

    // lines: collected first, rebuilt only when what they look like changes
    const specs: LineArgs[] = [];
    const line = (...a: LineArgs) => {
      specs.push(a);
    };
    const bus = HUB.clone();
    line([SRC.solar, new THREE.Vector3(-6.6, 0, SRC.solar.z), new THREE.Vector3(-6.6, 0, -0.5), new THREE.Vector3(bus.x - 0.6, 0, -0.5)], state.solarKw, maxKw, "solar");
    line([SRC.grid, new THREE.Vector3(-6.6, 0, SRC.grid.z), new THREE.Vector3(-6.6, 0, 0.5), new THREE.Vector3(bus.x - 0.6, 0, 0.5)], outage ? 0 : state.gridImportKw, maxKw, outage ? "fault" : "grid");
    line(
      batteryIn > 0 ? [bus, SRC.battery] : [SRC.battery, bus],
      batteryOut || batteryIn,
      maxKw,
      "battery",
    );

    const slots = this.zoneSlots(state.zones);
    const maxZone = Math.max(1, ...state.zones.map((z) => z.demandKw));
    // feeder spine from the bus along the campus
    const lastX = Math.max(...slots.map((s) => s.x));
    line([bus, new THREE.Vector3(lastX, 0, SPINE_Z)], Math.max(0, state.demandKw), maxKw * 2, "zone");
    for (const s of slots) {
      const z = s.zone;
      const faulted = z.status === "faulted" || z.status === "isolated";
      const rerouted = z.status === "reduced" && !!z.note?.includes("backup feeder");
      const sign = s.row === "top" ? -1 : 1;
      const end = new THREE.Vector3(s.x, 0, s.pos.z - sign * 1.2);
      if (rerouted) {
        // dead normal feeder, and power arriving from the neighbour on the backup feeder
        line([new THREE.Vector3(s.x, 0, SPINE_Z), end], 0, maxKw / 2, "idle");
        const same = slots.filter((o) => o.row === s.row && o.zone.id !== z.id);
        // nearest neighbour in the row (ties go to the one further along the feeder)
        const nb = same.sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x) || b.x - a.x)[0];
        if (nb) {
          // a tie line between the two platforms, in front of them
          const edge = s.pos.z - sign * 1.15;
          const tie = s.pos.z - sign * 1.95;
          const dx = nb.x > s.x ? 0.55 : -0.55;
          line(
            [new THREE.Vector3(nb.x - dx, 0, edge), new THREE.Vector3(nb.x - dx, 0, tie), new THREE.Vector3(s.x + dx, 0, tie), new THREE.Vector3(s.x + dx, 0, edge)],
            z.demandKw,
            maxKw / 2,
            "reroute",
          );
        }
      } else {
        line([new THREE.Vector3(s.x, 0, SPINE_Z), end], faulted ? 0 : z.demandKw, maxKw / 2, faulted ? "fault" : "zone");
      }
      const peakSaving = z.status === "reduced" && !!z.note?.startsWith("Pre-cool");
      const status = faulted ? "Fault" : rerouted ? "Rerouted" : peakSaving ? "Peak saving" : z.status === "reduced" ? "Reduced" : undefined;
      this.setLabel(z.id, z.name, formatKw(z.demandKw), status, faulted ? "fault" : rerouted ? "reroute" : z.status === "reduced" && !peakSaving ? "warning" : "zone", z.priority === "critical");
      this.ring(z.id, faulted ? "fault" : rerouted ? "reroute" : "zone", z.status === "reduced" && !peakSaving && !rerouted);
      // heat pad: share of the busiest building's load, tinted calm → amber; red on a fault
      const heat = Math.min(1, z.demandKw / maxZone);
      this.setHeat(z.id, faulted ? this.pal.danger : this.pal.accent.clone().lerp(this.pal.warning, Math.max(0, heat - 0.55) / 0.45), faulted ? 0.35 : 0.08 + 0.3 * heat);
      // windows dim when the building is dark or running reduced
      this.setWindows(z.id, faulted ? 0.04 : z.status === "reduced" ? 0.55 : 1);
    }
    // Flow widths and dot counts follow kW in 5% steps, so small changes in the load
    // (every few seconds) no longer rebuild every tube and re-upload it to the GPU.
    const q = (kw: number, max: number) => (kw <= 1 ? 0 : Math.max(2, (Math.round((Math.min(kw, max) / max) * 20) / 20) * max));
    const sig = specs
      .map(([pts, kw, max, tone, o]) => `${pts.map((v) => `${v.x.toFixed(2)},${v.z.toFixed(2)}`).join(";")}|${q(kw, max)}|${Math.round(max)}|${tone}|${o?.reverse ? 1 : 0}`)
      .join("/");
    if (sig !== this.lineSig) {
      this.lineSig = sig;
      this.clearLines();
      for (const [pts, kw, max, tone, o] of specs) this.addLine(pts, q(kw, max), max, tone, o);
      this.shadowsDirty = true;
    }
    this.requestFrame();
  }

  private setHeat(id: string, color: THREE.Color, opacity: number) {
    const node = this.nodes.get(id);
    if (!node) return;
    const mat = node.heat.material as THREE.MeshBasicMaterial;
    mat.color.copy(color);
    mat.opacity = opacity;
  }

  private setWindows(id: string, level: number) {
    const node = this.nodes.get(id);
    if (!node || node.windowLevel === level) return;
    node.windowLevel = level;
    // one shared material per brightness level (no new material, and no shader compile, per update)
    let mat = this.mats.models.window;
    if (level !== 1) {
      const key = Math.round(level * 100);
      let m = this.windowMats.get(key);
      if (!m) {
        m = this.mats.models.window.clone();
        m.emissiveIntensity = level * this.mats.models.window.emissiveIntensity;
        m.color.copy(this.mats.models.window.color).multiplyScalar(0.4 + 0.6 * level);
        this.windowMats.set(key, m);
      }
      mat = m;
    }
    node.model.traverse((o) => {
      if (o.userData.isWindows) (o as THREE.InstancedMesh).material = mat;
    });
  }

  private ring(id: string, tone: Tone, warn = false) {
    const node = this.nodes.get(id);
    if (!node) return;
    const mat = node.ring.material as THREE.LineBasicMaterial;
    mat.color.copy(warn ? this.pal.warning : this.tone(tone));
    node.ring.userData.fault = tone === "fault";
  }

  private setLabel(id: string, rawName: string, rawValue: string, rawSub: string | undefined, tone: string, shield = false) {
    const node = this.nodes.get(id);
    if (!node) return;
    const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const name = esc(this.compact ? shortName(rawName) : rawName);
    const value = esc(rawValue);
    const sub = rawSub === undefined ? undefined : esc(rawSub);
    const html =
      `<span class="grid3d-label__name">${name}${shield ? ' <span aria-hidden="true" class="grid3d-label__shield">◆</span>' : ""}</span>` +
      `<span class="grid3d-label__value">${value}</span>` +
      (sub ? `<span class="grid3d-label__sub">${sub}</span>` : "");
    if (node.labelHtml === html + tone) return; // unchanged: no DOM write, no relayout
    node.labelHtml = html + tone;
    const el = node.label.element;
    el.dataset.tone = tone;
    el.innerHTML = html;
    this.labelsDirty = true;
  }

  // ---------- sizing / camera ----------
  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const wasNarrow = this.narrow;
    this.narrow = width < 520;
    if (wasNarrow !== this.narrow) for (const n of this.nodes.values()) if (n.slot !== undefined) n.group.position.x = this.zx(n.slot);
    const wasCompact = this.compact;
    this.compact = width < 760;
    if ((wasCompact !== this.compact || wasNarrow !== this.narrow) && this.state) this.update(this.state);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = `${this.width}px`;
    this.renderer.domElement.style.height = `${this.height}px`;
    this.labels.setSize(this.width, this.height);
    this.host.classList.toggle("grid3d--narrow", this.narrow);
    this.host.classList.toggle("grid3d--compact", this.compact);

    // On phones the campus is turned so its long side runs top to bottom.
    this.root.rotation.y = this.narrow ? -Math.PI / 2 : 0;
    this.root.updateMatrixWorld(true);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.fitCamera();
    this.requestFrame();
  }

  /** Moves the camera back until every platform and label fits in the frame. */
  private fitCamera() {
    const pts: THREE.Vector3[] = [];
    const labelPts: THREE.Vector3[] = [];
    for (const n of this.nodes.values()) {
      const c = n.group.getWorldPosition(new THREE.Vector3());
      for (const [dx, dz] of [[-1.3, -1.2], [1.3, -1.2], [-1.3, 1.2], [1.3, 1.2]]) pts.push(c.clone().add(new THREE.Vector3(dx, 0, dz)));
      const lp = n.label.getWorldPosition(new THREE.Vector3());
      pts.push(lp);
      labelPts.push(lp);
    }
    // Labels are ~120 x 44 px boxes centred on their anchor.
    const padX = (this.compact ? 40 : 62) / (this.width / 2);
    const padY = (this.compact ? 18 : 26) / (this.height / 2);
    if (!pts.length) return;
    const box = new THREE.Box3().setFromPoints(pts);
    const target = box.getCenter(new THREE.Vector3());
    target.y = 0.4;
    const dir = (this.narrow ? new THREE.Vector3(-0.06, 0.9, 0.44) : new THREE.Vector3(-0.12, 0.74, 0.66)).normalize();
    const margin = this.narrow ? 0.985 : 0.99;
    const place = (d: number) => {
      this.camera.position.copy(target).add(dir.clone().multiplyScalar(d));
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld(true);
    };
    const bounds = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        const q = p.clone().project(this.camera);
        const isLabel = labelPts.includes(p);
        const px = isLabel ? padX : 0;
        const py = isLabel ? padY : 0;
        x0 = Math.min(x0, q.x - px); x1 = Math.max(x1, q.x + px); y0 = Math.min(y0, q.y - py); y1 = Math.max(y1, q.y + py);
      }
      return { x0, x1, y0, y1 };
    };
    const search = () => {
      let lo = 4;
      let hi = 220;
      for (let i = 0; i < 26; i++) {
        const mid = (lo + hi) / 2;
        place(mid);
        const b = bounds();
        if (Math.max(-b.x0, b.x1, -b.y0, b.y1) <= margin) hi = mid;
        else lo = mid;
      }
      place(hi);
      return hi;
    };
    let hi = search();
    // Re-centre on what is actually drawn (labels make the top heavier), then fit again.
    for (let k = 0; k < 3; k++) {
      const b = bounds();
      const ox = (b.x0 + b.x1) / 2;
      const oy = (b.y0 + b.y1) / 2;
      const halfH = hi * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const halfW = halfH * this.camera.aspect;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      target.add(right.multiplyScalar(ox * halfW)).add(up.multiplyScalar(oy * halfH));
      hi = search();
    }
    this.home.target.copy(target);
    this.home.dist = hi;
    this.controls.target.copy(target);
    this.controls.minDistance = hi * 0.45;
    this.controls.maxDistance = hi * 1.3;
    this.controls.minAzimuthAngle = -0.8;
    this.controls.maxAzimuthAngle = 0.6;
    this.controls.update();
    if (this.selectedId) this.focus(this.selectedId, true);
  }

  // ---------- picking: hover, click, fly-to ----------
  private pick(cx: number, cy: number): PickId | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    this.pointer.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.params.Line = { threshold: 0.04 };
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.nodes.values()].map((n) => n.group), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.nodeId) return o.userData.nodeId as PickId;
        o = o.parent;
      }
    }
    return null;
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      el.addEventListener(t, fn);
      this.cleanup.push(() => el.removeEventListener(t, fn));
    };
    on("pointerdown", (e) => {
      this.down = { x: e.clientX, y: e.clientY, at: performance.now() };
    });
    on("pointermove", (e) => {
      if (this.down || e.pointerType === "touch") return;
      const id = this.pick(e.clientX, e.clientY);
      if (id !== this.hoverId) {
        this.hoverId = id;
        el.style.cursor = id ? "pointer" : "";
        this.refreshLift();
      }
    });
    on("pointerleave", () => {
      this.down = null;
      if (this.hoverId) {
        this.hoverId = null;
        el.style.cursor = "";
        this.refreshLift();
      }
    });
    on("pointerup", (e) => {
      const d = this.down;
      this.down = null;
      if (!d) return;
      // only a short, still tap counts as a click (a drag turns the model)
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.at > 700) return;
      const id = this.pick(e.clientX, e.clientY);
      this.select(id && id === this.selectedId ? null : id);
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.selectedId) this.select(null);
    };
    window.addEventListener("keydown", key);
    this.cleanup.push(() => window.removeEventListener("keydown", key));
  }

  private refreshLift() {
    for (const [id, n] of this.nodes) n.liftTarget = id === this.selectedId ? 0.16 : id === this.hoverId ? 0.09 : 0;
    this.requestFrame();
  }

  /** Select a building (or none) and fly the camera to it (or back home). */
  select(id: PickId | null, notify = true) {
    this.selectedId = id && this.nodes.has(id) ? id : null;
    this.refreshLift();
    this.focus(this.selectedId, false);
    if (notify) this.onPick?.(this.selectedId);
  }

  private focus(id: PickId | null, instant: boolean) {
    this.root.updateMatrixWorld(true);
    const toT = this.home.target.clone();
    let toD = this.home.dist;
    if (id) {
      const p = this.nodes.get(id)!.group.getWorldPosition(new THREE.Vector3());
      // keep some of the campus in view: lean towards the building, don't centre on it fully
      toT.set(p.x, 0.5, p.z).lerp(this.home.target, 0.18);
      toD = this.home.dist * 0.72;
    }
    const fromD = this.camera.position.distanceTo(this.controls.target);
    this.fly = { t: instant || this.reduceMotion ? 1 : 0, fromT: this.controls.target.clone(), toT, fromD, toD };
    if (instant || this.reduceMotion) this.stepFly(0);
    this.requestFrame();
  }

  private stepFly(dt: number) {
    const f = this.fly;
    if (!f) return;
    f.t = Math.min(1, f.t + dt / 0.85);
    const k = 1 - Math.pow(1 - f.t, 3);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.lerpVectors(f.fromT, f.toT, k);
    const d = THREE.MathUtils.lerp(f.fromD, f.toD, k);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, d);
    if (f.t >= 1) this.fly = null;
  }

  // ---------- loop ----------
  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clock.getDelta();
    this.lastTick = 0;
    const minGap = this.lowPower ? 1000 / 30 - 2 : 0; // phones: 30 fps is smooth for this slow motion
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      if (minGap && now - this.lastTick < minGap) return;
      this.lastTick = now;
      this.frame(Math.min(0.1, this.clock.getDelta()));
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** One frame when animation is off (reduced motion / paused). */
  requestFrame() {
    this.labelsDirty = true;
    this.shadowsDirty = true;
    if (this.running || this.disposed) return;
    requestAnimationFrame(() => this.frame(0));
  }

  /** Slow ambient motion: lifts, solar tracking, battery rings, flag, dust. */
  private animate(dt: number) {
    const moving = !this.reduceMotion && dt > 0;
    if (moving) this.t += dt;
    const t = this.t;
    for (const [id, n] of this.nodes) {
      if (Math.abs(n.liftTarget - n.lift) > 1e-4) {
        this.labelsDirty = true;
        this.shadowsDirty = true;
      }
      n.lift = moving ? n.lift + (n.liftTarget - n.lift) * Math.min(1, dt * 12) : n.liftTarget;
      n.group.position.y = n.lift;
      const mat = n.ring.material as THREE.LineBasicMaterial;
      if (!n.ring.userData.fault) mat.opacity = id === this.selectedId ? (moving ? 0.7 + 0.3 * Math.sin(t * 4) : 1) : id === this.hoverId ? 1 : 0.9;
    }
    // solar farm: panels follow the sun and glow with output
    const solar = this.nodes.get("solar");
    const panels = (solar?.model.userData.panels ?? []) as THREE.Group[];
    const tilt = THREE.MathUtils.clamp(-Math.cos(this.sunAngle) * 0.7, -0.7, 0.7);
    for (const p of panels) p.rotation.z = THREE.MathUtils.lerp(p.rotation.z, tilt, moving ? Math.min(1, dt * 2) : 1);
    this.mats.models.panel.emissiveIntensity = 0.05 + 0.85 * this.solarFrac * (1 - this.night);
    // battery: rings climb while charging, sink while discharging; fill breathes
    const rings = (this.nodes.get("battery")?.model.userData.rings ?? []) as THREE.Mesh[];
    rings.forEach((r, i) => {
      r.visible = this.batteryDir !== 0;
      if (!r.visible) return;
      const u = (t * 0.45 + i / 3) % 1;
      r.position.y = this.batteryDir > 0 ? 0.15 + u * 1.0 : 1.15 - u * 1.0;
      r.scale.setScalar(1.02 + 0.03 * Math.sin(u * Math.PI));
    });
    this.mats.batteryFill.emissiveIntensity = 0.9 + 0.3 * Math.sin(t * (this.batteryDir === 0 ? 1.4 : 4));
    // the campus bus breathes with the load
    const halo = this.nodes.get("bus")?.model.userData.halo as THREE.Mesh | undefined;
    if (halo) halo.scale.setScalar(1 + (0.03 + 0.08 * this.loadFrac) * Math.sin(t * 2.2));
    for (const f of this.flags) f.rotation.y = 0.25 * Math.sin(t * 3 + f.position.x * 4);
    // dust
    if (moving) {
      const pos = this.motes.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, pos.getY(i) + dt * 0.1);
        pos.setX(i, pos.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.05);
        if (pos.getY(i) > 5) pos.setY(i, 0.3);
      }
      pos.needsUpdate = true;
    }
    (this.motes.material as THREE.PointsMaterial).opacity = 0.22 + 0.3 * this.night;
  }

  private frame(dt: number) {
    if (this.disposed) return;
    this.stepFly(this.reduceMotion ? 1 : dt);
    this.controls.update();
    this.animate(dt);
    if (!this.reduceMotion && dt > 0) {
      const speed = 1.6; // world units per second
      for (const l of this.lines) {
        if (!l.dots) continue;
        l.phase = (l.phase + (dt * speed) / l.length) % 1;
        this.placeDots(l);
      }
      // faults blink
      this.faultT += dt;
      const blink = 0.55 + 0.45 * Math.sin(this.faultT * 6);
      this.lineGroup.traverse((o) => {
        if (o.userData.fault) o.visible = blink > 0.3;
      });
      for (const n of this.nodes.values()) {
        if (n.ring.userData.fault) (n.ring.material as THREE.LineBasicMaterial).opacity = 0.4 + 0.6 * blink;
      }
    }
    // Shadows: on demand, plus a slow refresh for the small moving parts (panels, flags, rings).
    this.shadowAge += dt;
    if (this.shadowsDirty || this.shadowAge > (this.lowPower ? 1 : 0.25)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
      this.shadowAge = 0;
    }
    this.renderer.render(this.scene, this.camera);
    // The HTML labels only move when the camera or the labels change: skip the DOM work otherwise.
    this.camera.updateMatrixWorld();
    const e = this.camera.matrixWorld.elements;
    const pm = this.camera.projectionMatrix.elements;
    let moved = this.labelsDirty;
    for (let i = 0; i < 16; i++) if (this.lastCam[i] !== e[i]) { this.lastCam[i] = e[i]; moved = true; }
    if (this.lastCam[16] !== pm[0] || this.lastCam[17] !== pm[5]) { this.lastCam[16] = pm[0]; this.lastCam[17] = pm[5]; moved = true; }
    if (moved) {
      this.labels.render(this.scene, this.camera);
      this.labelsDirty = false;
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    // OrbitControls removes its document-level listeners from canvas.getRootNode(). React has
    // usually detached the canvas by now, so that lookup misses the document and the listeners
    // (and this whole scene with them) leaked on every page visit. Re-attach it for the call.
    const el = this.renderer.domElement;
    if (!el.isConnected) {
      el.style.display = "none";
      document.body.appendChild(el);
    }
    this.controls.dispose();
    this.clearLines();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    });
    this.dotGeo.dispose();
    this.packetGeo.dispose();
    this.lineMats.forEach((m) => m.dispose());
    this.windowMats.forEach((m) => m.dispose());
    this.renderer.dispose();
    // Free the WebGL context now: phones allow only a few, and page switches create new ones.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}

