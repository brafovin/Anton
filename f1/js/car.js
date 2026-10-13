import * as THREE from 'three';

// Prozedurales F1-Auto (Generation 2026). Lackteile und matte Teile werden je Team
// zu je einer Geometrie mit Vertexfarben zusammengefasst – wenig Draw-Calls bei 22 Autos.

const MATTE = { carbon: '#17191c', black: '#0a0a0b', metal: '#4d5157', halo: '#202226', tyre: '#151516', rim: '#2b2e33' };
export const COMPOUNDS = { S: '#e8202a', M: '#f2c618', H: '#f2f2f2' };

// Körper aus Querschnitten (Superellipsen) entlang der Längsachse
function loft(sections, M = 22) {
  const pos = [], idx = [];
  const ring = s => {
    const e = 2 / (s.n || 3);
    for (let k = 0; k < M; k++) {
      const a = (k / M) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
      let py = Math.sign(si) * Math.abs(si) ** e * s.h / 2;
      if (s.flat && py < 0) py *= 0.35; // flacher Unterboden
      pos.push((s.x || 0) + Math.sign(c) * Math.abs(c) ** e * s.w / 2, s.y + py, s.z);
    }
  };
  sections.forEach(ring);
  for (let r = 0; r < sections.length - 1; r++) for (let k = 0; k < M; k++) {
    const a = r * M + k, b = r * M + (k + 1) % M, c = (r + 1) * M + k, d = (r + 1) * M + (k + 1) % M;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const out = [g.toNonIndexed()];
  // Deckel vorne/hinten
  for (const [si, dir] of [[0, -1], [sections.length - 1, 1]]) {
    const s = sections[si], base = si * M, cp = [];
    let cx = 0, cy = 0; for (let k = 0; k < M; k++) { cx += pos[(base + k) * 3]; cy += pos[(base + k) * 3 + 1]; }
    cx /= M; cy /= M;
    for (let k = 0; k < M; k++) {
      const k2 = (k + 1) % M, A = (base + k) * 3, B = (base + k2) * 3;
      const tri = dir > 0 ? [cx, cy, s.z, pos[A], pos[A + 1], s.z, pos[B], pos[B + 1], s.z] : [cx, cy, s.z, pos[B], pos[B + 1], s.z, pos[A], pos[A + 1], s.z];
      cp.push(...tri);
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.computeVertexNormals();
    out.push(cg);
  }
  return out;
}

function box(w, h, l, x, y, z, { rx = 0, ry = 0, rz = 0, tf = null } = {}) {
  const g = new THREE.BoxGeometry(w, h, l);
  if (tf) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) { p.setX(i, p.getX(i) * tf[0]); p.setY(i, p.getY(i) * tf[1]); } g.computeVertexNormals(); }
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
  return g;
}

function rod(a, b, t = 0.035) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
  const g = new THREE.BoxGeometry(t, t * 0.6, len);
  const m = new THREE.Matrix4().lookAt(vb, va, new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m); const mid = va.add(vb).multiplyScalar(0.5); g.translate(mid.x, mid.y, mid.z);
  return g;
}

function merge(parts) {
  const P = [], Nn = [], C = [];
  const col = new THREE.Color();
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    col.set(color);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); Nn.push(n.getX(i), n.getY(i), n.getZ(i)); C.push(col.r, col.g, col.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeBoundingSphere();
  return g;
}

// Teile mit Farbschlitz: body/side/wing/accent/accent2 (Lack) oder carbon/black/metal/halo (matt)
function carParts() {
  const paint = [], matte = [];
  const add = (list, slot, geos) => (Array.isArray(geos) ? geos : [geos]).forEach(geo => list.push({ geo, slot }));
  // Chassis mit Nase und Motorabdeckung
  add(paint, 'body', loft([
    { z: -2.3, w: 0.2, h: 0.3, y: 0.4, n: 3 },
    { z: -1.8, w: 0.36, h: 0.42, y: 0.42, n: 3 },
    { z: -1.1, w: 0.62, h: 0.52, y: 0.44, n: 3.2 },
    { z: -0.4, w: 0.8, h: 0.6, y: 0.42, n: 3.4, flat: true },
    { z: 0.3, w: 0.76, h: 0.52, y: 0.4, n: 3.4, flat: true },
    { z: 1.0, w: 0.6, h: 0.44, y: 0.39, n: 3, flat: true },
    { z: 1.6, w: 0.38, h: 0.3, y: 0.33, n: 2.8 },
    { z: 2.3, w: 0.24, h: 0.18, y: 0.24, n: 2.6 },
    { z: 2.78, w: 0.13, h: 0.1, y: 0.19, n: 2.4 },
  ]));
  // Airbox über dem Fahrer
  add(paint, 'body', loft([
    { z: -1.95, w: 0.06, h: 0.1, y: 0.6, n: 2.5 },
    { z: -1.2, w: 0.2, h: 0.24, y: 0.72, n: 2.5 },
    { z: -0.6, w: 0.3, h: 0.36, y: 0.84, n: 2.6 },
    { z: -0.28, w: 0.26, h: 0.3, y: 0.87, n: 2.6 },
  ]));
  add(matte, 'black', box(0.16, 0.16, 0.02, 0, 0.88, -0.26));
  // Haifischflosse
  add(paint, 'accent', box(0.02, 0.24, 1.25, 0, 0.84, -1.55, { tf: [1, 0.5] }));
  // Seitenkästen
  for (const sx of [-1, 1]) {
    add(paint, 'side', loft([
      { z: -1.65, w: 0.14, h: 0.12, y: 0.2, x: sx * 0.3, n: 3 },
      { z: -1.1, w: 0.3, h: 0.24, y: 0.27, x: sx * 0.42, n: 3.2 },
      { z: -0.4, w: 0.44, h: 0.38, y: 0.34, x: sx * 0.56, n: 3.5 },
      { z: 0.3, w: 0.46, h: 0.42, y: 0.38, x: sx * 0.58, n: 3.6 },
      { z: 0.56, w: 0.42, h: 0.36, y: 0.37, x: sx * 0.57, n: 3.6 },
    ]));
    add(matte, 'black', box(0.36, 0.28, 0.02, sx * 0.57, 0.38, 0.565));
    // Spiegel
    add(paint, 'body', box(0.12, 0.06, 0.04, sx * 0.5, 0.72, 0.62));
    add(matte, 'carbon', rod([sx * 0.38, 0.6, 0.6], [sx * 0.5, 0.71, 0.62], 0.02));
  }
  // Unterboden, Diffusor, Front- und Heckflügel
  add(matte, 'carbon', box(1.56, 0.03, 3.4, 0, 0.06, -0.25, { tf: [0.8, 1] }));
  add(matte, 'carbon', box(0.9, 0.12, 0.34, 0, 0.12, -2.22, { rx: -0.3 }));
  // Nasenspitze in Zweitfarbe
  add(paint, 'accent2', loft([{ z: 2.4, w: 0.225, h: 0.17, y: 0.235, n: 2.6 }, { z: 2.6, w: 0.18, h: 0.135, y: 0.215, n: 2.5 }, { z: 2.8, w: 0.12, h: 0.095, y: 0.19, n: 2.4 }]));
  add(paint, 'wing', box(1.9, 0.025, 0.42, 0, 0.09, 2.56));
  add(paint, 'wing', box(1.74, 0.02, 0.2, 0, 0.145, 2.5, { rx: -0.25 }));
  add(paint, 'accent', box(1.6, 0.02, 0.18, 0, 0.2, 2.44, { rx: -0.5 }));
  for (const sx of [-1, 1]) add(paint, 'wing', box(0.025, 0.22, 0.56, sx * 0.95, 0.16, 2.52));
  add(paint, 'wing', box(1.0, 0.03, 0.3, 0, 0.82, -2.42, { rx: 0.15 }));
  add(paint, 'accent', box(1.0, 0.025, 0.2, 0, 0.95, -2.52, { rx: 0.55 }));
  for (const sx of [-1, 1]) add(paint, 'wing', box(0.03, 0.6, 0.66, sx * 0.51, 0.7, -2.44));
  add(matte, 'carbon', box(0.8, 0.03, 0.16, 0, 0.38, -2.5, { rx: 0.2 }));
  add(matte, 'carbon', box(0.05, 0.42, 0.14, 0, 0.6, -2.33));
  // Cockpit-Öffnung
  add(matte, 'black', loft([{ z: -0.32, w: 0.4, h: 0.04, y: 0.66, n: 2 }, { z: 0.05, w: 0.48, h: 0.04, y: 0.66, n: 2 }, { z: 0.45, w: 0.34, h: 0.04, y: 0.64, n: 2 }], 16));
  // Halo
  const halo = new THREE.TorusGeometry(0.3, 0.028, 8, 30, Math.PI * 1.25);
  halo.rotateX(-Math.PI / 2); halo.rotateY(Math.PI - Math.PI * 0.625 + Math.PI / 2); halo.rotateX(0.08); halo.translate(0, 0.9, 0.02);
  add(matte, 'halo', halo);
  add(matte, 'halo', rod([0, 0.9, 0.33], [0, 0.66, 0.62], 0.05));
  for (const sx of [-1, 1]) add(matte, 'halo', rod([sx * 0.27, 0.88, -0.1], [sx * 0.3, 0.66, -0.3], 0.045));
  // Radaufhängung
  for (const [z, wx] of [[1.65, 0.7], [-1.75, 0.68]]) for (const sx of [-1, 1]) {
    add(matte, 'carbon', rod([sx * 0.25, 0.5, z + 0.12], [sx * wx, 0.46, z]));
    add(matte, 'carbon', rod([sx * 0.25, 0.48, z - 0.18], [sx * wx, 0.46, z]));
    add(matte, 'carbon', rod([sx * 0.22, 0.22, z + 0.15], [sx * wx, 0.24, z]));
    add(matte, 'carbon', rod([sx * 0.22, 0.22, z - 0.2], [sx * wx, 0.24, z]));
  }
  return { paint, matte };
}

let PARTS = null;
const teamGeo = new Map();
function geosFor(team) {
  if (teamGeo.has(team.id)) return teamGeo.get(team.id);
  PARTS = PARTS || carParts();
  const pal = { body: team.body, side: team.side, wing: team.wing, accent: team.accent, accent2: team.accent2, ...MATTE };
  const r = {
    paint: merge(PARTS.paint.map(p => ({ geo: p.geo, color: pal[p.slot] }))),
    matte: merge(PARTS.matte.map(p => ({ geo: p.geo, color: pal[p.slot] }))),
  };
  teamGeo.set(team.id, r);
  return r;
}

const wheelGeo = new Map();
function wheelGeometry(width, compound) {
  const key = width + compound;
  if (wheelGeo.has(key)) return wheelGeo.get(key);
  const w = width / 2;
  const prof = [[0.235, -w], [0.33, -w], [0.352, -w + 0.03], [0.36, -w + 0.08], [0.36, w - 0.08], [0.352, w - 0.03], [0.33, w], [0.235, w]].map(([x, y]) => new THREE.Vector2(x, y));
  const tyre = new THREE.LatheGeometry(prof, 30);
  const rim = new THREE.CylinderGeometry(0.236, 0.236, width - 0.03, 24, 1, false);
  const cover = new THREE.CylinderGeometry(0.2, 0.2, width + 0.004, 24);
  const parts = [{ geo: tyre, color: MATTE.tyre }, { geo: rim, color: MATTE.rim }, { geo: cover, color: '#1f2226' }];
  for (const sy of [-1, 1]) {
    const ring = new THREE.RingGeometry(0.29, 0.31, 30); ring.rotateX(sy > 0 ? -Math.PI / 2 : Math.PI / 2); ring.translate(0, sy * (w + 0.002), 0);
    parts.push({ geo: ring, color: COMPOUNDS[compound] || COMPOUNDS.M });
  }
  const g = merge(parts);
  g.rotateZ(Math.PI / 2);
  wheelGeo.set(key, g);
  return g;
}

let shadowTex = null;
function blobTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 64, 4, 32, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.save(); g.scale(1, 1); g.fillRect(0, 0, 64, 128); g.restore();
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

function numberTexture(num, dark) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  g.font = 'italic 800 132px "Saira Condensed", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = dark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)';
  g.strokeText(String(num), 128, 86);
  g.fillStyle = dark ? '#111' : '#fff'; g.fillText(String(num), 128, 86);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const matCache = {};
function sharedMats() {
  if (matCache.paint) return matCache;
  matCache.paint = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.28, envMapIntensity: 1.1 });
  matCache.matte = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.6 });
  matCache.wheel = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.75 });
  matCache.blob = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return matCache;
}

export class CarModel {
  constructor(team, driver, { compound = 'M', teammateIndex = 0 } = {}) {
    const M = sharedMats();
    const g = geosFor(team);
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    const paint = new THREE.Mesh(g.paint, M.paint), matte = new THREE.Mesh(g.matte, M.matte);
    paint.castShadow = matte.castShadow = true;
    this.group.add(paint, matte);
    // Helm
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 12), new THREE.MeshStandardMaterial({ color: driver.helmet, roughness: 0.25, metalness: 0.3 }));
    helmet.position.set(0, 0.76, -0.14); helmet.castShadow = true; this.group.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.138, 18, 6, -0.9, 1.8, 1.25, 0.42), new THREE.MeshStandardMaterial({ color: '#0d0f14', roughness: 0.05, metalness: 0.9 }));
    visor.position.copy(helmet.position); this.group.add(visor); this.visor = visor;
    // T-Kamera: schwarz für den ersten, gelb für den zweiten Fahrer im Team
    const tcam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.22), new THREE.MeshStandardMaterial({ color: teammateIndex ? '#e6ff00' : '#0b0b0b', roughness: 0.4 }));
    tcam.position.set(0, 1.04, -0.5); this.group.add(tcam); this.tcam = tcam;
    // Startnummer
    const lum = new THREE.Color(team.body).getHSL({}).l;
    const nt = numberTexture(driver.num, lum > 0.62);
    const nm = new THREE.MeshStandardMaterial({ map: nt, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -1, depthWrite: false });
    const nose = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), nm);
    nose.rotation.set(-Math.PI / 2 + 0.2, 0, 0); nose.position.set(0, 0.49, 1.6); this.group.add(nose);
    this.numberMat = nm; this.numberMeshes = [nose];
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.2), nm);
      side.rotation.y = sx * Math.PI / 2; side.position.set(sx * 0.322, 0.56, -0.95); this.group.add(side); this.numberMeshes.push(side);
    }
    // Räder
    this.wheels = [];
    const spots = [[0.78, 1.65, 0.3], [-0.78, 1.65, 0.3], [0.76, -1.75, 0.38], [-0.76, -1.75, 0.38]];
    spots.forEach(([x, z, w], k) => {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.36, z);
      const spin = new THREE.Mesh(wheelGeometry(w, compound), M.wheel); spin.castShadow = true;
      pivot.add(spin); this.group.add(pivot);
      this.wheels.push({ pivot, spin, front: k < 2 });
    });
    // Regenlicht hinten (blinkt beim Energie-Sammeln)
    this.light = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.03), new THREE.MeshStandardMaterial({ color: '#400', emissive: '#ff1a1a', emissiveIntensity: 0 }));
    this.light.position.set(0, 0.42, -2.56); this.group.add(this.light);
    // weicher Schatten
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 6.2), M.blob);
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; this.group.add(blob); this.blob = blob;
    this.helmet = helmet;
    this.compound = compound;
    this.t = Math.random() * 10;
  }

  // nur die eigenen Teile freigeben; Team- und Radgeometrien sind geteilt
  dispose() {
    for (const o of [this.helmet, this.visor, this.tcam, this.light]) { o.geometry.dispose(); o.material.dispose(); }
    this.numberMat.map.dispose(); this.numberMat.dispose();
    this.numberMeshes.forEach(m => m.geometry.dispose());
    this.blob.geometry.dispose();
  }

  setCompound(c) {
    if (c === this.compound) return;
    this.compound = c;
    this.wheels.forEach((w, k) => { w.spin.geometry = wheelGeometry(k < 2 ? 0.3 : 0.38, c); });
  }

  update(dt, v, steer, harvesting) {
    this.t += dt;
    const ang = (v / 0.36) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x += ang;
      if (w.front) w.pivot.rotation.y = -steer * 0.32;
    }
    this.light.material.emissiveIntensity = harvesting && Math.floor(this.t * 6) % 2 ? 3 : 0;
  }
}
