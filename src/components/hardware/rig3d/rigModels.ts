import * as THREE from "three";
import * as M from "@/components/grid/grid3d/models";
import type { ModelMaterials } from "@/components/grid/grid3d/models";

/**
 * Extra low-poly models for the rig's 3D mini campus: the relay switchyard, the INA219 meter house,
 * the ESP32 control tower and the emergency-stop pedestal. Same style and materials as the campus
 * models (see grid3d/models.ts), sized for a ~2 unit platform.
 */

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
};
const cyl = (r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 16) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
};

/**
 * The SPDT relay as a small switchyard: a coil housing, two input contacts (NC towards the
 * adapter at +z, NO towards the power bank at -z) and a blade on a pivot. `userData.arm` is the
 * pivot: rotation.y = +0.5 throws the blade to NC (adapter), -0.5 to NO (power bank).
 * `userData.contacts` = { nc, no } meshes so the live contact can be lit.
 */
export function relaySwitchyard(m: ModelMaterials, contact: { nc: THREE.Material; no: THREE.Material }) {
  const g = new THREE.Group();
  // coil housing at the back
  g.add(box(0.7, 0.42, 0.5, m.dark, 0.35, 0, -0.55));
  g.add(box(0.74, 0.04, 0.54, m.roof, 0.35, 0.42, -0.55));
  g.add(cyl(0.12, 0.18, m.roof, 0.35, 0.46, -0.55, 12));
  // insulator posts with the two input contacts
  const posts: Record<"nc" | "no", THREE.Mesh> = {} as never;
  for (const [key, z] of [["nc", 0.45], ["no", -0.15]] as const) {
    g.add(cyl(0.045, 0.42, m.body, -0.55, 0, z, 8));
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), contact[key]);
    c.position.set(-0.55, 0.47, z);
    g.add(c);
    c.userData.live = true;
    posts[key] = c;
  }
  // COM post and the blade
  g.add(cyl(0.05, 0.42, m.body, 0.45, 0, 0.15, 8));
  const arm = new THREE.Group();
  arm.position.set(0.45, 0.47, 0.15);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.05, 0.07), m.glow);
  blade.position.x = -0.51;
  arm.add(blade);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), m.roof);
  arm.add(hub);
  g.add(arm);
  // the arm keeps the same y-axis pivot at COM; its rest angle points at NC
  arm.rotation.y = 0.5;
  arm.userData.live = true;
  g.userData.arm = arm;
  g.userData.contacts = posts;
  // a low fence
  for (const x of [-0.9, 0.9]) g.add(box(0.03, 0.18, 1.5, m.trunk, x, 0, 0));
  return g;
}

/** The INA219 as a meter house: a low building with a glowing readout panel on its front. */
export function meterHouse(m: ModelMaterials, screen: THREE.Material) {
  const g = new THREE.Group();
  g.add(box(1.1, 0.6, 0.8, m.body, 0, 0, -0.1));
  g.add(box(1.18, 0.05, 0.88, m.roof, 0, 0.6, -0.1));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.26), screen);
  panel.position.set(0, 0.36, 0.305);
  g.add(panel);
  // shunt: two terminals on the roof joined by a bar
  g.add(cyl(0.05, 0.14, m.dark, -0.3, 0.65, -0.1, 8), cyl(0.05, 0.14, m.dark, 0.3, 0.65, -0.1, 8));
  g.add(box(0.66, 0.04, 0.06, m.glow, 0, 0.78, -0.1));
  panel.userData.live = true;
  g.userData.screen = panel;
  return g;
}

/**
 * The ESP32 as a control tower: a slim tower with a Wi-Fi mast and a status beacon.
 * `userData.beacon` is the beacon mesh (its material is the caller's, so it can blink).
 */
export function controlTower(m: ModelMaterials, beaconMat: THREE.Material) {
  const g = new THREE.Group();
  g.add(box(0.8, 0.35, 0.8, m.body, -0.2, 0, 0.1));
  g.add(box(0.46, 1.25, 0.46, m.body, 0.35, 0, -0.25));
  g.add(box(0.62, 0.32, 0.62, m.dark, 0.35, 1.25, -0.25));
  g.add(box(0.66, 0.04, 0.66, m.roof, 0.35, 1.57, -0.25));
  // windows band on the cab
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.12, 0.64), m.window);
  band.position.set(0.35, 1.41, -0.25);
  band.userData.isWindows = true;
  band.userData.live = true;
  g.add(band);
  // Wi-Fi mast
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.7, 6), m.roof);
  mast.position.set(0.35, 1.95, -0.25);
  g.add(mast);
  for (const y of [1.8, 1.98, 2.14]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09 - (y - 1.8) * 0.12, 0.008, 4, 20), m.roof);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0.35, y, -0.25);
    g.add(ring);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), beaconMat);
  beacon.position.set(0.35, 2.33, -0.25);
  g.add(beacon);
  beacon.userData.live = true;
  g.userData.beacon = beacon;
  // a small dish on the low block
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), m.roof);
  dish.rotation.x = -0.9;
  dish.position.set(-0.35, 0.5, 0.25);
  g.add(dish);
  return g;
}

/** The emergency-stop button: a yellow-ringed pedestal with a big mushroom head. */
export function estopPedestal(m: ModelMaterials, head: THREE.Material, collar: THREE.Material) {
  const g = new THREE.Group();
  g.add(box(0.5, 0.5, 0.5, m.dark, 0, 0, 0));
  g.add(cyl(0.26, 0.05, collar, 0, 0.5, 0, 24));
  const stem = cyl(0.08, 0.1, m.roof, 0, 0.55, 0, 12);
  g.add(stem);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), head);
  cap.scale.y = 0.6;
  cap.position.y = 0.64;
  g.add(cap);
  cap.userData.live = true;
  g.userData.cap = cap;
  return g;
}

/** The critical branch: the Electrical Lab and the CS Lab side by side on one wide platform. */
export function twinLabs(m: ModelMaterials) {
  const g = new THREE.Group();
  const a = M.lab(m);
  a.scale.setScalar(0.82);
  a.position.x = -0.95;
  const b = M.lab(m);
  b.scale.setScalar(0.82);
  b.position.x = 0.95;
  g.add(a, b);
  return g;
}
