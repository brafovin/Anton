import * as THREE from 'three';
import { clamp, lerp } from './util.js';

// ------------------------------------------------------------------
//  Pose-System: Hand-Zielpunkte (im Torso-Raum) + 2-Knochen-IK
//  Torso-Raum: +Z = vorne, +Y = oben, rechte Hand = -X
// ------------------------------------------------------------------
export const DEF = {
  hx: -0.12, hy: 0.35, hz: 0.45,      // Position der rechten Hand (= Waffengriff)
  dx: 0.1, dy: 0.55, dz: 0.85,        // Klingenrichtung
  roll: 0,                            // Drehung um die Klingenachse
  lg: -0.2,                           // Position der linken Hand entlang der Waffe
  lfree: 0, lx: 0.3, ly: 0.2, lz: 0.2,// linke Hand frei (Schild, Flasche, ...)
  twist: 0, lean: 0,                  // Torso-Drehung / -Neigung
  shift: 0, crouch: 0,                // Koerper nach vorne / abgesenkt
  bpitch: 0, tuck: 0,                 // Rolle: Koerper-Kippung / Beine anziehen
  kneel: 0,                           // 0..1: Beine nach hinten gefaltet (kniend, zusammen mit crouch ~0.45)
  head: 0,                            // Kopfneigung
  flask: 0, sheath: 0,                // Flasche sichtbar / Katana in Saya
  glow: 0, draw: 0, e: 0,
};
const FIELDS = Object.keys(DEF);

export function compile(frames, base = DEF) {
  let prev = { ...DEF, ...base };
  return frames.map((f) => { prev = { ...prev, ...f }; return prev; });
}
const easeFns = [
  (t) => t * t * (3 - 2 * t),   // 0 weich
  (t) => t * t * t,             // 1 beschleunigend (Schlag)
  (t) => 1 - (1 - t) ** 3,      // 2 abbremsend
  (t) => t,                     // 3 linear
];
const _out = { ...DEF };
export function sample(frames, t, out = _out) {
  if (t <= frames[0].t) { for (const k of FIELDS) out[k] = frames[0][k]; return out; }
  const last = frames[frames.length - 1];
  if (t >= last.t) { for (const k of FIELDS) out[k] = last[k]; return out; }
  let i = 1;
  while (frames[i].t < t) i++;
  const a = frames[i - 1], b = frames[i];
  const u = easeFns[b.e || 0]((t - a.t) / (b.t - a.t));
  for (const k of FIELDS) out[k] = k === 'e' ? 0 : lerp(a[k], b[k], u);
  return out;
}
export function blendPose(a, b, u, out = {}) {
  for (const k of FIELDS) out[k] = lerp(a[k], b[k], u);
  return out;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = V(), _b = V(), _c = V(), _d = V();
function ik(S, T, l1, l2, pole, elbow, hand) {
  _a.subVectors(T, S);
  let d = _a.length();
  const maxD = (l1 + l2) * 0.999, minD = Math.abs(l1 - l2) + 0.02;
  d = clamp(d, minD, maxD);
  _a.normalize();
  hand.copy(S).addScaledVector(_a, d);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-6) _b.set(0, -1, 0);
  _b.normalize();
  elbow.copy(S).addScaledVector(_a, a).addScaledVector(_b, h);
}
const UP = V(0, 1, 0);
const _q = new THREE.Quaternion();
function limb(mesh, a, b) {
  _c.subVectors(b, a);
  const len = _c.length();
  mesh.position.copy(a);
  if (len > 1e-5) { _q.setFromUnitVectors(UP, _c.divideScalar(len)); mesh.quaternion.copy(_q); }
  mesh.scale.y = len;
}
const unitCyl = (rt, rb, seg = 8) => { const g = new THREE.CylinderGeometry(rt, rb, 1, seg); g.translate(0, 0.5, 0); return g; };

export const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...o });

// ------------------------------------------------------------------
//  Waffen
// ------------------------------------------------------------------
export function makeKatana() {
  const g = new THREE.Group();
  const steel = mat(0xdce4ee, { metalness: 0.85, roughness: 0.22, emissive: 0x112233, emissiveIntensity: 0.4 });
  const edge = mat(0xffffff, { metalness: 0.9, roughness: 0.1, emissive: 0x6688aa, emissiveIntensity: 0.6 });
  const black = mat(0x15151a, { roughness: 0.6 });
  const wrap = mat(0x2a1a14, { roughness: 0.9 });
  const gold = mat(0xb8962e, { metalness: 0.8, roughness: 0.35 });
  // Griff (Tsuka)
  const tsuka = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8), wrap);
  tsuka.position.y = -0.13; g.add(tsuka);
  for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 4, 10), black); r.rotation.x = Math.PI / 2; r.position.y = -0.25 + i * 0.045; g.add(r); }
  const kashira = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), gold); kashira.position.y = -0.29; kashira.scale.y = 0.6; g.add(kashira);
  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 14), black); tsuba.position.y = 0.035; g.add(tsuba);
  const habaki = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.016), gold); habaki.position.y = 0.065; g.add(habaki);
  // gebogene Klinge aus Segmenten
  const blade = new THREE.Group(); g.add(blade);
  const N = 10, L = 0.92; let y = 0.085, z = 0, ang = 0;
  const bladeMeshes = [];
  for (let i = 0; i < N; i++) {
    const seg = L / N, w = lerp(0.034, 0.02, i / N);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.006, seg * 1.05, w), steel);
    ang -= 0.028;
    m.rotation.x = ang + (i === N - 1 ? 0 : 0);
    m.position.set(0, y + Math.cos(ang) * seg / 2, z + Math.sin(ang) * seg / 2);
    y += Math.cos(ang) * seg; z += Math.sin(ang) * seg;
    blade.add(m); bladeMeshes.push(m);
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.004, seg * 1.05, 0.006), edge);
    e.position.copy(m.position); e.position.z += Math.cos(ang) * w / 2; e.position.y -= Math.sin(ang) * w / 2;
    e.rotation.x = ang; blade.add(e);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 4), steel);
  tip.rotation.set(ang, Math.PI / 4, 0); tip.position.set(0, y + 0.02, z - 0.005); tip.scale.set(0.3, 1, 1); blade.add(tip);
  // Marker fuer Slash-Trail
  const mBase = new THREE.Object3D(); mBase.position.set(0, 0.2, 0); g.add(mBase);
  const mTip = new THREE.Object3D(); mTip.position.set(0, y + 0.04, z); g.add(mTip);
  g.userData = { trailBase: mBase, trailTip: mTip, steel, edge, glowMats: [steel, edge], length: y };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeSaya() {
  const g = new THREE.Group();
  const lacquer = mat(0x120d12, { roughness: 0.35, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.065), lacquer);
  body.position.y = 0.45; g.add(body);
  const kojiri = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), mat(0xb8962e, { metalness: 0.8 })); kojiri.position.y = 0.9; g.add(kojiri);
  const koiguchi = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.075), mat(0xb8962e, { metalness: 0.8 })); koiguchi.position.y = 0.02; g.add(koiguchi);
  const sageo = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.05, 0.07), mat(0x7a1a1a)); sageo.position.y = 0.2; g.add(sageo);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeSword({ len = 0.8, width = 0.06, color = 0x8a7a6a, rusty = true, glow = 0, glowColor = 0xff5a10 } = {}) {
  const g = new THREE.Group();
  const steel = mat(color, { metalness: 0.7, roughness: rusty ? 0.7 : 0.3, emissive: glow ? glowColor : 0x000000, emissiveIntensity: glow });
  const dark = mat(0x2a2018, { roughness: 0.9 });
  const gold = mat(0x8a7030, { metalness: 0.7, roughness: 0.4 });
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 8), dark); grip.position.y = -0.12; g.add(grip);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), gold); pom.position.y = -0.27; g.add(pom);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(width * 3.2, 0.04, 0.05), gold); guard.position.y = 0.03; g.add(guard);
  const bl = new THREE.Mesh(new THREE.BoxGeometry(width, len, 0.016), steel); bl.position.y = 0.05 + len / 2; g.add(bl);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(width * 0.72, 0.14, 4), steel); tip.rotation.y = Math.PI / 4; tip.scale.z = 0.25; tip.position.y = 0.05 + len + 0.06; g.add(tip);
  const mBase = new THREE.Object3D(); mBase.position.set(0, 0.25, 0); g.add(mBase);
  const mTip = new THREE.Object3D(); mTip.position.set(0, 0.05 + len + 0.1, 0); g.add(mTip);
  g.userData = { trailBase: mBase, trailTip: mTip, glowMats: [steel], steel, length: len };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function makeStaff() {
  const g = new THREE.Group();
  const wood = mat(0x2a1c22, { roughness: 0.8 });
  const orbM = new THREE.MeshStandardMaterial({ color: 0xc8a0ff, emissive: 0x8a3aff, emissiveIntensity: 2.0, roughness: 0.2 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 2.0, 7), wood); shaft.position.y = 0.5; g.add(shaft);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const pr = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.4, 5), wood); pr.position.set(Math.cos(a) * 0.1, 1.62, Math.sin(a) * 0.1); pr.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); g.add(pr); }
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), orbM); orb.position.y = 1.58; g.add(orb);
  const mBase = new THREE.Object3D(); mBase.position.set(0, 0.8, 0); g.add(mBase);
  const mTip = new THREE.Object3D(); mTip.position.set(0, 1.6, 0); g.add(mTip);
  g.userData = { trailBase: mBase, trailTip: mTip, glowMats: [], steel: orbM, length: 1.6, orb };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeClub() {
  const g = new THREE.Group();
  const wood = mat(0x4a3a2c, { roughness: 1 });
  const iron = mat(0x3a3a40, { metalness: 0.6, roughness: 0.6 });
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.07, 1.9, 9), wood); head.position.y = 0.8; g.add(head);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 * 2.3, y = 0.9 + (i % 7) * 0.2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 5), iron); sp.position.set(Math.cos(a) * 0.27, y, Math.sin(a) * 0.27); sp.rotation.set(Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4); g.add(sp); }
  for (const y of [0.4, 1.0, 1.6]) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.2 - y * 0.03 + 0.05, 0.03, 5, 12), iron); b.rotation.x = Math.PI / 2; b.position.y = y; g.add(b); }
  const mBase = new THREE.Object3D(); mBase.position.set(0, 0.8, 0); g.add(mBase);
  const mTip = new THREE.Object3D(); mTip.position.set(0, 1.75, 0); g.add(mTip);
  g.userData = { trailBase: mBase, trailTip: mTip, glowMats: [], steel: wood, length: 1.8 };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeScythe() {
  const g = new THREE.Group();
  const wood = mat(0x1a1416, { roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc8, metalness: 0.85, roughness: 0.25, emissive: 0x401010, emissiveIntensity: 0.5, side: THREE.DoubleSide });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.9, 7), wood); shaft.position.y = 0.55; g.add(shaft);
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(0.55, 0.34, 1.05, -0.28); sh.quadraticCurveTo(0.6, 0.1, 0, -0.16); sh.closePath();
  const blade = new THREE.Mesh(new THREE.ShapeGeometry(sh, 10), steel); blade.rotation.y = -Math.PI / 2; blade.position.y = 1.45; g.add(blade);
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.14), wood); mount.position.y = 1.45; g.add(mount);
  const mBase = new THREE.Object3D(); mBase.position.set(0, 1.4, 0.2); g.add(mBase);
  const mTip = new THREE.Object3D(); mTip.position.set(0, 1.2, 1.05); g.add(mTip);
  g.userData = { trailBase: mBase, trailTip: mTip, glowMats: [], steel, length: 1.5 };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}


export function makeBow() {
  const g = new THREE.Group();
  const wood = mat(0x4a2a14, { roughness: 0.7 });
  const gold = mat(0xe0b848, { metalness: 0.85, roughness: 0.3, emissive: 0x6a4a10, emissiveIntensity: 0.7 });
  const strM = new THREE.MeshBasicMaterial({ color: 0xf0e6c0 });
  const pts = []; for (let i = 0; i <= 20; i++) { const y = -0.9 + i * 0.09; pts.push(new THREE.Vector3(0, y, 0.28 * (1 - (y / 0.9) ** 2))); }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.032, 6), wood));
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 8), gold); grip.position.set(0, 0, 0.28); g.add(grip);
  for (const sy of [-1, 1]) { const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), gold); tip.position.set(0, sy * 0.9, 0); g.add(tip); }
  for (const y of [-0.55, 0.55]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 5, 10), gold); ring.position.set(0, y, 0.28 * (1 - (y / 0.9) ** 2)); ring.rotation.x = Math.PI / 2; g.add(ring); }
  const s1 = new THREE.Mesh(unitCyl(0.007, 0.007, 4), strM), s2 = new THREE.Mesh(unitCyl(0.007, 0.007, 4), strM); g.add(s1, s2);
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.0, 6), mat(0xcfc6a8)); shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.5; arrow.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 6), gold); head.rotation.x = Math.PI / 2; head.position.z = 1.08; arrow.add(head);
  for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.16), new THREE.MeshBasicMaterial({ color: 0xffd060, side: THREE.DoubleSide })); f.position.z = 0.1; f.rotation.z = (i / 3) * Math.PI; arrow.add(f); }
  g.add(arrow);
  const A = V(0, -0.9, 0), B = V(0, 0.9, 0), N = V();
  const setDraw = (d) => {
    N.set(0, 0, -0.62 * d);
    limb(s1, A, N); limb(s2, N, B);
    arrow.visible = d > 0.04; arrow.position.copy(N);
  };
  setDraw(0);
  const mid = new THREE.Object3D(); mid.position.set(0, 0, 0.3); g.add(mid);
  g.userData = { bow: { setDraw }, orb: mid, trailBase: mid, trailTip: mid, glowMats: [], steel: gold, length: 1.8 };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function makeShield(color = 0x555a63, trim = 0x8a7030) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.06, 5, 1), mat(color, { metalness: 0.5, roughness: 0.5 }));
  face.rotation.x = Math.PI / 2; face.rotation.z = Math.PI / 5 * 0; g.add(face);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(trim, { metalness: 0.7, roughness: 0.4 })); boss.position.z = 0.05; boss.scale.z = 0.6; g.add(boss);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.01), mat(trim, { metalness: 0.7 })); cross.position.z = 0.032; g.add(cross);
  const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.01), mat(trim, { metalness: 0.7 })); cross2.position.z = 0.032; g.add(cross2);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeFlask() {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0xffcc88, transparent: true, opacity: 0.45, roughness: 0.1 }));
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.058, 0.11, 10), new THREE.MeshStandardMaterial({ color: 0xff9a2a, emissive: 0xff7a10, emissiveIntensity: 1.6 }));
  liquid.position.y = -0.02;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.07, 8), glass.material); neck.position.y = 0.11;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.03, 8), mat(0x5a3a20)); cork.position.y = 0.16;
  g.add(glass, liquid, neck, cork);
  const l = new THREE.PointLight(0xff9a3a, 2.5, 3, 2); l.position.y = 0.0; g.add(l);
  g.userData.liquid = liquid; g.userData.light = l;
  return g;
}

// ------------------------------------------------------------------
//  Humanoid
// ------------------------------------------------------------------
const HIP = 0.95, THIGH = 0.47, SHIN = 0.47, UPPER = 0.34, FORE = 0.34, SH_X = 0.25, SH_Y = 0.52;

export function makeHumanoid(o) {
  const O = {
    scale: 1, skin: 0xc8a888, cloth: 0x3a3028, armor: 0x555a63, trim: 0x8a7030, accent: 0x7a1a1a,
    head: 'hollow', hunch: 0, cape: false, tabard: false, pauldrons: true, plates: true,
    weapon: 'sword', shield: false, twoHand: false, eye: 0x000000, bulk: 1, ...o,
  };
  const h = { opts: O, mats: [], flashT: 0 };
  const M = (c, extra) => { const m = mat(c, extra); h.mats.push(m); return m; };
  const skin = M(O.skin, { roughness: 0.85 });
  const cloth = M(O.cloth, { roughness: 0.95 });
  const armor = M(O.armor, { metalness: 0.55, roughness: 0.45 });
  const trim = M(O.trim, { metalness: 0.7, roughness: 0.4 });
  const accent = M(O.accent, { roughness: 0.9 });
  h.flashMats = [skin, cloth, armor, trim, accent];

  const root = new THREE.Group(); h.root = root;
  const inner = new THREE.Group(); inner.scale.setScalar(O.scale); root.add(inner); h.inner = inner;
  const pivot = new THREE.Group(); pivot.position.y = HIP; inner.add(pivot); h.pivot = pivot;
  const torso = new THREE.Group(); pivot.add(torso); h.torso = torso;
  const bulk = O.bulk;

  // Becken
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34 * bulk, 0.18, 0.22 * bulk), cloth); pelvis.position.y = -0.04; pivot.add(pelvis);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * bulk, 0.2 * bulk, 0.07, 10), M(0x2a1a10, { roughness: 0.8 })); belt.position.y = 0.06; belt.scale.z = 0.75; torso.add(belt);
  // Brust
  const chestGeo = new THREE.CylinderGeometry(0.25 * bulk, 0.19 * bulk, 0.62, 10);
  const chest = new THREE.Mesh(chestGeo, O.plates ? armor : cloth); chest.position.y = 0.36; chest.scale.z = 0.68; torso.add(chest);
  if (O.plates) {
    const breast = new THREE.Mesh(new THREE.SphereGeometry(0.2 * bulk, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), armor);
    breast.rotation.x = Math.PI / 2; breast.position.set(0, 0.4, 0.05); breast.scale.set(1.15, 0.7, 0.95); breast.visible = false; torso.add(breast);
  }
  const under = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * bulk, 0.2 * bulk, 0.24, 10), cloth); under.position.y = 0.1; under.scale.z = 0.7; torso.add(under);
  if (O.tabard) {
    const tf = new THREE.Mesh(new THREE.BoxGeometry(0.26 * bulk, 0.62, 0.018), accent); tf.position.set(0, -0.02, 0.135 * bulk); tf.rotation.x = -0.05; torso.add(tf);
    const tb = tf.clone(); tb.position.z = -0.135 * bulk; tb.rotation.x = 0.05; torso.add(tb);
  }
  // Kopf
  const head = new THREE.Group(); head.position.y = 0.73; torso.add(head); h.head = head;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), skin); neck.position.y = -0.07; head.add(neck);
  buildHead(head, O, { skin, cloth, armor, trim, accent, M });
  // Schultern
  if (O.pauldrons) for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.15 * bulk, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), armor);
    p.position.set(s * SH_X * 1.02, SH_Y + 0.02, 0); p.scale.set(1.1, 0.8, 1); p.rotation.z = -s * 0.25; torso.add(p);
    const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * bulk, 0.13 * bulk, 0.05, 10), trim); p2.position.set(s * (SH_X + 0.06), SH_Y - 0.06, 0); p2.rotation.z = -s * 0.5; torso.add(p2);
  }
  // Robe (Hexe): langer Rock ueber den Beinen
  if (O.robe) {
    const rb = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * bulk, 0.52 * bulk, 0.95, 14, 1, true), M(O.robeColor ?? O.cloth, { roughness: 1, side: THREE.DoubleSide }));
    rb.position.y = -0.46; pivot.add(rb); h.robe = rb;
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.5 * bulk, 0.02, 5, 20), trim); hem.rotation.x = Math.PI / 2; hem.position.y = -0.93; pivot.add(hem);
  }
  // Opulente Ruestung (Boss): Stachel-Schulterpanzer, Beinplatten, glühendes Emblem, Kragen
  if (O.ornate) {
    const ember = new THREE.MeshStandardMaterial({ color: 0xff8a20, emissive: 0xff5a10, emissiveIntensity: 2.2, roughness: 0.4 });
    h.mats.push(ember);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.045 * bulk, 0.3 - i * 0.05, 6), trim);
        sp.position.set(s * (SH_X + 0.08 + i * 0.05), SH_Y + 0.18 - i * 0.02, (i - 1) * 0.08); sp.rotation.z = -s * (0.5 + i * 0.28); torso.add(sp);
      }
      const big = new THREE.Mesh(new THREE.SphereGeometry(0.2 * bulk, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), armor);
      big.position.set(s * (SH_X + 0.03), SH_Y + 0.05, 0); big.scale.set(1.25, 0.85, 1.15); big.rotation.z = -s * 0.3; torso.add(big);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19 * bulk, 0.022, 6, 14), trim);
      rim.position.set(s * (SH_X + 0.05), SH_Y - 0.03, 0); rim.rotation.set(Math.PI / 2, 0, -s * 0.3); rim.scale.set(1.25, 1.1, 1); torso.add(rim);
    }
    // Brustemblem
    const em = new THREE.Mesh(new THREE.CircleGeometry(0.075, 8), ember); em.position.set(0, 0.42, 0.172 * bulk); torso.add(em);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 16), trim); ring.position.copy(em.position); ring.position.z += 0.004; torso.add(ring);
    for (const [ox, oy] of [[0, 0.17], [0, -0.17], [0.17, 0], [-0.17, 0]]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 4), trim); t.position.set(ox, 0.42 + oy, 0.172 * bulk); t.rotation.z = ox ? (ox > 0 ? -Math.PI / 2 : Math.PI / 2) : (oy > 0 ? 0 : Math.PI); torso.add(t); }
    // Kragen + Beinplatten (Tassets)
    const gorget = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * bulk, 0.22 * bulk, 0.1, 10), trim); gorget.position.y = 0.66; gorget.scale.z = 0.8; torso.add(gorget);
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.42, pl = new THREE.Mesh(new THREE.BoxGeometry(0.15 * bulk, 0.34, 0.025), i % 2 ? armor : trim);
      pl.geometry.translate(0, -0.17, 0); pl.position.set(Math.sin(a) * 0.2 * bulk, 0.0, Math.cos(a) * 0.15 * bulk); pl.rotation.y = a; pl.rotation.x = 0.1; torso.add(pl);
      const pb = pl.clone(); pb.position.set(Math.sin(a) * 0.2 * bulk, 0.0, -Math.cos(a) * 0.15 * bulk); pb.rotation.y = Math.PI - a; pb.rotation.x = 0.1; torso.add(pb);
    }
  }
  // Cape
  if (O.cape) {
    const geo = new THREE.BoxGeometry(0.5 * bulk, 0.95, 0.025); geo.translate(0, -0.475, 0);
    const c = new THREE.Mesh(geo, M(O.accent === 0 ? 0x222222 : O.capeColor ?? O.accent, { roughness: 0.95 })); c.position.set(0, SH_Y + 0.05, -0.17); torso.add(c); h.cape = c;
  }
  // Waffe
  const mkWeapon = (n) => n === 'katana' ? makeKatana() : n === 'kingbow' ? makeBow() : n === 'kingsword' ? makeSword({ len: 1.8, width: 0.21, color: 0xe6d49a, rusty: false, glow: 1.5 }) : n === 'ironblade' ? makeSword({ len: 1.4, width: 0.14, color: 0x9a9ea8, rusty: false }) : n === 'staff' ? makeStaff() : n === 'club' ? makeClub() : n === 'scythe' ? makeScythe()
    : n === 'greatsword' ? makeSword({ len: 1.45, width: 0.15, color: 0x3a3438, rusty: false, glow: 0.4 })
    : n === 'keule' ? makeClub() : n === 'sichel' ? makeScythe()
    : n === 'mondklinge' ? makeSword({ len: 1.2, width: 0.11, color: 0xb4ccf4, rusty: false, glow: 0.7, glowColor: 0x4a78ff })
      : makeSword({ len: 0.75, width: 0.06, color: O.weaponColor ?? 0x8a7a6a, rusty: O.weaponRusty ?? true });
  h.weapons = {};
  for (const n of (O.weapons || [O.weapon])) { const w = mkWeapon(n); w.visible = n === O.weapon; torso.add(w); h.weapons[n] = w; }
  h.weapon = h.weapons[O.weapon];
  h.setWeapon = (n) => {
    if (!h.weapons[n]) return;
    for (const k in h.weapons) h.weapons[k].visible = k === n;
    h.weapon = h.weapons[n]; h.opts.weapon = n;
    if (h.saya) h.saya.visible = n === 'katana';
  };
  if (O.weapon === 'katana' || (O.weapons || []).includes('katana')) {
    const saya = makeSaya(); saya.position.set(0.27, 0.02, 0.1); saya.rotation.x = -1.3; saya.rotation.z = -0.1; torso.add(saya); h.saya = saya;
  }
  if (O.shield) { h.shield = makeShield(O.shieldColor ?? 0x555a63, O.trim); torso.add(h.shield); }
  h.flask = makeFlask(); h.flask.visible = false; torso.add(h.flask);

  // Gliedmassen (Zylinder, die zwischen Gelenken aufgespannt werden)
  const armMat = O.plates ? armor : cloth;
  const mk = (rt, rb, m) => { const me = new THREE.Mesh(unitCyl(rt, rb), m); me.castShadow = true; return me; };
  const sph = (r, m) => { const me = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m); me.castShadow = true; return me; };
  h.arm = [0, 1].map((i) => {
    const up = mk(0.055 * bulk, 0.045 * bulk, armMat), fo = mk(0.05 * bulk, 0.04 * bulk, O.plates ? armor : skin);
    const el = sph(0.05 * bulk, armMat), hd = sph(0.055 * bulk, i ? armor : armor);
    torso.add(up, fo, el, hd);
    return { up, fo, el, hd, S: V(i ? SH_X : -SH_X, SH_Y, 0), E: V(), H: V(), pole: V(i ? 0.6 : -0.6, -1, -0.35) };
  });
  const legMat = O.plates ? armor : cloth;
  h.leg = [0, 1].map((i) => {
    const th = mk(0.085 * bulk, 0.06 * bulk, cloth), sh = mk(0.06 * bulk, 0.05 * bulk, legMat);
    const kn = sph(0.065 * bulk, legMat), ft = new THREE.Mesh(new THREE.BoxGeometry(0.115 * bulk, 0.09, 0.3 * bulk), M(0x1e1612, { roughness: 0.9 })); ft.castShadow = true;
    pivot.add(th, sh, kn, ft);
    return { th, sh, kn, ft, S: V(i ? 0.13 : -0.13, -0.02, 0), K: V(), A: V(), T: V() };
  });
  inner.traverse((m) => { if (m.isMesh) m.castShadow = true; });

  h.phase = 0; h.capeSwing = 0;
  h.update = (p, gait = {}, dt = 0.016) => applyPose(h, p, gait, dt);
  h.flash = (t = 0.15) => { h.flashT = t; };
  h.tickFlash = (dt) => {
    if (h.flashT > 0) { h.flashT -= dt; const k = clamp(h.flashT / 0.15, 0, 1); h.flashMats.forEach((m) => { m.emissive.setRGB(0.9 * k, 0.12 * k, 0.05 * k); }); }
    else if (h.flashT !== -1) { h.flashMats.forEach((m) => m.emissive.setRGB(0, 0, 0)); h.flashT = -1; }
  };
  return h;
}

function buildHead(head, O, { skin, cloth, armor, trim, accent, M }) {
  const dark = M(0x050505, { roughness: 1 });
  const add = (m) => { m.castShadow = true; head.add(m); return m; };
  if (O.head === 'hollow') {
    const s = add(new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skin)); s.scale.set(0.95, 1.1, 1);
    for (const x of [-0.04, 0.04]) { const e = add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), dark)); e.position.set(x, 0.02, 0.1); }
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.02), dark)); m.position.set(0, -0.05, 0.105);
    if (O.hunch) head.rotation.x = 0.35;
  } else if (O.head === 'helm' || O.head === 'knight') {
    const s = add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), armor)); s.scale.set(0.95, 1.08, 1.05); s.position.y = 0.02;
    const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.115, 0.14, 12), armor)); b.position.y = -0.06;
    const slit = add(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.022, 0.05), dark)); slit.position.set(0, 0.0, 0.1);
    const ridge = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.26), trim)); ridge.position.set(0, 0.14, -0.02);
    if (O.eye) { for (const x of [-0.04, 0.04]) { const e = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: O.eye }))); e.position.set(x, 0.0, 0.127); } }
    if (O.plume) { const pl = add(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 6), accent)); pl.position.set(0, 0.2, -0.06); pl.rotation.x = -0.6; }
  } else if (O.head === 'greathelm') {
    const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.3, 8), armor)); b.position.y = 0.0;
    const top = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.15, 0.1, 8), armor)); top.position.y = 0.2;
    const slit = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.05), dark)); slit.position.set(0, 0.04, 0.14);
    for (const x of [-0.045, 0.05]) { const e = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: O.eye || 0xff6a10 }))); e.position.set(x, 0.04, 0.166); }
    for (const s of [-1, 1]) {
      const horn = add(new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.4, 6), M(0xc8bfa8, { roughness: 0.6 })));
      horn.position.set(s * 0.19, 0.18, 0); horn.rotation.z = -s * 0.9; horn.rotation.x = -0.1;
    }
    const crest = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.34), accent)); crest.position.set(0, 0.27, -0.02);
  } else if (O.head === 'ninja') {
    const cowl = add(new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 10), cloth)); cowl.scale.set(0.98, 1.1, 1.05); cowl.position.y = 0.01;
    const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.04, 12), accent)); band.position.y = 0.075;
    const eyes = add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.03), skin)); eyes.position.set(0, 0.025, 0.1);
    for (const x of [-0.04, 0.04]) { const e = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.012), dark)); e.position.set(x, 0.03, 0.118); }
    const mask = add(new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.1, 0.09, 12, 1, false, -1.3, 2.6), cloth)); mask.position.set(0, -0.05, 0.012);
    const tail = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.025), accent)); tail.geometry.translate(0, -0.25, 0); tail.position.set(0.02, 0.07, -0.13); tail.rotation.set(0.5, 0, 0.12);
  } else if (O.head === 'crown') {
    const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.3, 10), armor)); b.position.y = 0.0;
    const top = add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), armor)); top.position.y = 0.15;
    const slit = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.05), dark)); slit.position.set(0, 0.04, 0.14);
    for (const x of [-0.05, 0.05]) { const e = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: O.eye || 0xffd060 }))); e.position.set(x, 0.04, 0.152); }
    const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.07, 10), trim)); band.position.y = 0.2;
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, sp = add(new THREE.Mesh(new THREE.ConeGeometry(0.035, i % 2 ? 0.18 : 0.28, 5), trim)); sp.position.set(Math.cos(a) * 0.16, 0.34, Math.sin(a) * 0.16); }
    const halo = add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.018, 8, 36), new THREE.MeshBasicMaterial({ color: 0xffd060 }))); halo.position.set(0, 0.06, -0.2);
    const glow = add(new THREE.Mesh(new THREE.CircleGeometry(0.34, 30), new THREE.MeshBasicMaterial({ color: 0xffb830, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }))); glow.position.set(0, 0.06, -0.21);
  } else if (O.head === 'witch') {
    const s = add(new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), skin)); s.position.z = 0.01; s.scale.set(0.95, 1.08, 1);
    const hat = add(new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 10), cloth)); hat.position.set(0, 0.34, -0.03); hat.rotation.x = -0.18;
    const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.025, 14), cloth)); brim.position.set(0, 0.1, -0.01);
    const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.19, 0.06, 10), accent)); band.position.set(0, 0.14, -0.01);
    const hair = add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.08), M(0x1a1220, { roughness: 1 }))); hair.position.set(0, -0.12, -0.1);
    for (const x of [-0.04, 0.04]) { const e = add(new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), new THREE.MeshBasicMaterial({ color: 0xb06aff }))); e.position.set(x, 0.02, 0.1); }
  } else if (O.head === 'reaper') {
    const cowl = add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.75), cloth)); cowl.position.set(0, 0.02, -0.02); cowl.scale.set(1, 1.15, 1.15);
    const face = add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), dark)); face.position.set(0, 0.0, 0.05);
    for (const x of [-0.04, 0.04]) { const e = add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }))); e.position.set(x, 0.015, 0.145); }
    const tail = add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 8), cloth)); tail.position.set(0, -0.12, -0.14); tail.rotation.x = 0.4;
  } else if (O.head === 'hood') {
    const s = add(new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), skin)); s.position.z = 0.015;
    const hood = add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), cloth)); hood.position.set(0, 0.015, -0.015); hood.scale.set(1, 1.05, 1.1);
    const scarf = add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.045, 6, 12), accent)); scarf.rotation.x = Math.PI / 2; scarf.position.y = -0.09;
    for (const x of [-0.04, 0.04]) { const e = add(new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), dark)); e.position.set(x, 0.02, 0.105); }
  }
}

const _S = V(), _T = V(), _el = V(), _hd = V(), _wq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _dir = V(), _lg = V();
const _ankle = V(), _hipW = V(), _ZERO = V();
export function applyPose(h, p, gait, dt) {
  const { speed = 0, moving = false, stance = 1, lx = 0, lz = 1 } = gait;
  const { pivot, torso } = h;
  // Gang-Zyklus
  if (moving) h.phase += dt * (3.2 + speed * 7.5);
  const stride = moving ? 0.16 + speed * 0.3 : 0.0;
  const bob = moving ? Math.abs(Math.sin(h.phase)) * 0.035 * (0.5 + speed) : 0;
  // Pivot / Torso
  pivot.position.set(0, HIP - p.crouch - bob + (p.bpitch ? 0 : 0), p.shift);
  pivot.rotation.set(p.bpitch, 0, 0);
  torso.rotation.set(p.lean, p.twist, 0);
  h.head.rotation.x = p.head - p.lean * 0.6;
  h.head.rotation.y = -p.twist * 0.6;
  if (h.opts.hunch) torso.rotation.x += h.opts.hunch;

  // Beine
  const stanceZ = (moving ? 0 : 0.14) * stance;
  for (let i = 0; i < 2; i++) {
    const L = h.leg[i], side = i ? 1 : -1;
    const ph = h.phase + (i ? Math.PI : 0);
    const zf = Math.sin(ph) * stride * lz + (i ? 1 : -1) * stanceZ * (h.opts.stanceFlip ? -1 : 1);
    const xf = Math.sin(ph) * stride * lx;
    const lift = moving ? Math.max(0, Math.cos(ph)) * (0.06 + speed * 0.12) : 0;
    const groundY = -(HIP - p.crouch - bob) + 0.075;
    // normal
    _T.set(side * 0.15 * (1 + (1 - stance) * 0.2) + xf, groundY + lift, zf);
    // zusammengerollt (Rolle)
    if (p.tuck > 0.001) { _ankle.set(side * 0.13, -0.28, 0.36); _T.lerp(_ankle, p.tuck); }
    if (p.kneel > 0.001) { _ankle.set(side * 0.14, groundY + 0.1, -0.44); _T.lerp(_ankle, p.kneel); }
    L.S.x = side * 0.13;
    ik(L.S, _T, THIGH, SHIN, V(0, 0.1, 1), L.K, L.A);
    limb(L.th, L.S, L.K); limb(L.sh, L.K, L.A); L.kn.position.copy(L.K);
    L.ft.position.set(L.A.x, L.A.y - 0.02, L.A.z + 0.06);
    L.ft.rotation.set(p.tuck * 0.5 + p.kneel * 0.9 + (lift > 0.02 ? -0.3 : 0), 0, 0);
  }

  // Waffe + Arme
  _dir.set(p.dx, p.dy, p.dz).normalize();
  _wq.setFromUnitVectors(UP, _dir);
  _rq.setFromAxisAngle(UP, p.roll);
  _wq.multiply(_rq);
  const R = h.arm[0], Lf = h.arm[1];
  _T.set(p.hx, p.hy, p.hz);
  ik(R.S, _T, UPPER, FORE, R.pole, R.E, R.H);
  h.weapon.position.copy(R.H);
  h.weapon.quaternion.copy(_wq);
  // linke Hand
  _lg.set(0, p.lg, 0).applyQuaternion(_wq).add(R.H);
  if (h.weapon.userData.bow) { _lg.set(0, 0, -0.62 * (p.draw || 0) - 0.04).applyQuaternion(_wq).add(R.H); h.weapon.userData.bow.setDraw(p.draw || 0); }
  if (p.lfree > 0) { _T.set(p.lx, p.ly, p.lz); _lg.lerp(_T, p.lfree); }
  ik(Lf.S, _lg, UPPER, FORE, Lf.pole, Lf.E, Lf.H);
  for (const A of h.arm) {
    limb(A.up, A.S, A.E); limb(A.fo, A.E, A.H); A.el.position.copy(A.E); A.hd.position.copy(A.H);
  }
  // Schild am linken Unterarm
  if (h.shield) {
    h.shield.position.set(Lf.H.x + 0.1, Lf.H.y + 0.05, Lf.H.z + 0.12);
    h.shield.rotation.set(0.1, 0.35 - p.lfree * 0.1, 0);
  }
  // Flasche
  if (h.flask) {
    h.flask.visible = p.flask > 0.5;
    h.flask.position.set(Lf.H.x, Lf.H.y + 0.05, Lf.H.z + 0.03);
    h.flask.rotation.set(-0.5 * p.flask, 0, 0.15);
  }
  // Cape
  if (h.cape) {
    h.capeSwing += dt * (2 + speed * 6);
    h.cape.rotation.x = 0.08 + speed * 0.5 + Math.sin(h.capeSwing) * 0.04 * (0.4 + speed) + (p.bpitch ? -0.5 : 0);
    h.cape.rotation.z = Math.sin(h.capeSwing * 0.7) * 0.05 * (0.4 + speed);
  }
  // Glow
  const ud = h.weapon.userData;
  if (ud.glowMats && p.glow !== undefined) {
    for (const m of ud.glowMats) { if (m.emissive) { if (h.opts.weapon === 'katana') { m.emissive.setRGB(0.2 + p.glow * 0.8, 0.3 + p.glow * 0.5, 0.45 + p.glow * 0.6); m.emissiveIntensity = 0.4 + p.glow * 2.2; } } }
  }
  if (ud.orb && ud.steel) ud.steel.emissiveIntensity = 1.6 + (p.glow || 0) * 5;
  h.tickFlash(dt);
}
