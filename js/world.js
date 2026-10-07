import * as THREE from 'three';
import { clamp, lerp, rand, smoothstep, fbm, noise2, mulberry } from './util.js';
import { mat } from './models.js';

export const BOUNDS = { x0: -85, x1: 85, z0: -196, z1: 48 };
export const ARENA = { x: 0, z: -152, r: 24 };
export const FOG_GATE = { x: 0, z: -127.5, w: 8 };

// ------------------------------------------------------------------
//  Gelaendehoehe (analytisch -> Kollision + Platzierung ohne Raycasts)
// ------------------------------------------------------------------
function baseProfile(z) { return 2.6 * smoothstep(-46, -64, z); }
export function groundHeight(x, z) {
  const open = 1 - smoothstep(30, 62, Math.abs(x));
  const castle = smoothstep(-58, -66, z) * (1 - smoothstep(34, 62, Math.abs(x)));
  const rollK = 0.4 + 0.6 * (1 - castle) ;
  const rolling = (fbm(x * 0.03, z * 0.03, 3) * 2.4 + fbm(x * 0.12, z * 0.12, 2) * 0.3) * rollK * (1 - castle * 0.85);
  const hill = (1 - open) * (7 + fbm(x * 0.05 + 9, z * 0.05, 3) * 9) + smoothstep(34, 58, z) * 9 + smoothstep(-186, -205, z) * 12;
  // Vorplatz der Leuchtfeuer abflachen
  let h = baseProfile(z) + rolling + hill;
  return h;
}

// ------------------------------------------------------------------
//  Prozedurale Texturen
// ------------------------------------------------------------------
function canvasTex(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function speckle(g, s, base, n, spread) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rand(-spread, spread));
    g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    g.fillRect(rand(s), rand(s), rand(1, 4), rand(1, 4));
  }
}
const stoneTex = () => canvasTex(256, (g, s) => {
  speckle(g, s, '#8a8a8a', 2500, 60);
  g.strokeStyle = 'rgba(20,20,20,0.55)'; g.lineWidth = 3;
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const y = (r * s) / rows;
    g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
    const off = r % 2 ? s / 8 : 0;
    for (let x = off; x < s; x += s / 4) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + s / rows); g.stroke(); }
  }
  for (let i = 0; i < 80; i++) { g.fillStyle = `rgba(40,60,30,${rand(0.05, 0.2)})`; g.fillRect(rand(s), rand(s), rand(3, 20), rand(3, 10)); }
});
const groundTex = () => canvasTex(256, (g, s) => { speckle(g, s, '#808080', 6000, 55); });
const woodTex = () => canvasTex(128, (g, s) => {
  g.fillStyle = '#6a5038'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(0,0,0,${rand(0.05, 0.25)})`; g.lineWidth = rand(1, 3); const x = rand(s); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + rand(-5, 5), s); g.stroke(); }
});
const glowTex = (inner = 'rgba(255,200,90,1)', mid = 'rgba(255,110,20,0.55)') => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, mid); gr.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
export const GLOW = { fire: null };

// Box mit weltmassstaeblichen UVs (Ziegel wirken nicht gestreckt)
function boxGeo(w, h, d, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile);
  }
  return g;
}

// ------------------------------------------------------------------
export function buildWorld(scene) {
  const W = { colliders: [], bonfires: [], dynamicColliders: [], updaters: [] };
  const rnd = mulberry(1337);
  const R = (a, b) => (b === undefined ? rnd() * a : a + rnd() * (b - a));

  const stoneM = new THREE.MeshStandardMaterial({ map: stoneTex(), color: 0x9a9690, roughness: 0.95 });
  const stoneDark = new THREE.MeshStandardMaterial({ map: stoneTex(), color: 0x6a6862, roughness: 1 });
  const woodM = new THREE.MeshStandardMaterial({ map: woodTex(), color: 0x8a7a68, roughness: 1 });
  const blackWood = mat(0x2a2018, { roughness: 1 });
  const thatch = mat(0x4a3d2a, { roughness: 1 });

  // ---------------- Himmel ----------------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x0a0f1e) }, mid: { value: new THREE.Color(0x2a3550) }, bot: { value: new THREE.Color(0x3b4458) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top,mid,bot;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){ vec3 d = normalize(vP); float y = d.y;
        vec3 c = mix(bot, mid, smoothstep(-0.05,0.25,y)); c = mix(c, top, smoothstep(0.2,0.9,y));
        vec2 g = floor(vec2(atan(d.x,d.z)*220., y*220.)); float s = step(0.9965, h(g)) * smoothstep(0.1,0.5,y);
        c += vec3(s)*0.9; gl_FragColor = vec4(c,1.); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), skyMat); sky.renderOrder = -10; scene.add(sky); W.sky = sky;
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(235,240,255,1)', 'rgba(150,170,230,0.35)'), fog: false, depthWrite: false, transparent: true }));
  moon.scale.set(70, 70, 1); moon.position.set(-140, 200, -250); scene.add(moon);
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(11, 24), new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false }));
  moonDisc.position.copy(moon.position).multiplyScalar(0.98); moonDisc.lookAt(0, 0, 0); scene.add(moonDisc);

  // ---------------- Terrain ----------------
  const SZ = 330, SEG = 220, CX = 0, CZ = -74;
  const geo = new THREE.PlaneGeometry(SZ, SZ, SEG, SEG); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position; const col = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x3d4a2a), dirt = new THREE.Color(0x4d4132), rock = new THREE.Color(0x56565a), moss = new THREE.Color(0x2d3a22), path = new THREE.Color(0x6a5d4a);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + CX, z = pos.getZ(i) + CZ;
    pos.setX(i, x); pos.setZ(i, z);
    const y = groundHeight(x, z); pos.setY(i, y);
    const s = (groundHeight(x + 1.2, z) - y) ** 2 + (groundHeight(x, z + 1.2) - y) ** 2;
    const n = noise2(x * 0.08, z * 0.08);
    tmp.copy(grass).lerp(moss, n); tmp.lerp(dirt, smoothstep(0.35, 0.75, noise2(x * 0.05 + 40, z * 0.05)) * 0.6);
    tmp.lerp(rock, smoothstep(0.7, 2.5, s) * 0.9);
    // Weg entlang der Mittelachse
    const pd = Math.abs(x - Math.sin(z * 0.045) * 4); tmp.lerp(path, (1 - smoothstep(2.5, 5.5, pd)) * 0.9 * (z < 10 ? 1 : 0));
    // Innenhof gepflastert
    if (z < -62 && Math.abs(x) < 33) tmp.lerp(new THREE.Color(0x5a5852), 0.8);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const gt = groundTex(); gt.repeat.set(70, 70);
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: gt, roughness: 1 }));
  terrain.receiveShadow = true; scene.add(terrain);

  // ---------------- Hilfsfunktionen ----------------
  const solid = (x, z, hx, hz, rot = 0, topY = 99) => W.colliders.push({ type: 'box', x, z, hx, hz, rot, c: Math.cos(rot), s: Math.sin(rot), topY });
  const circle = (x, z, r) => W.colliders.push({ type: 'circle', x, z, r });
  // Mauerstueck: Box auf dem Boden von (x1,z1) nach (x2,z2)
  function wall(x1, z1, x2, z2, { h = 7, t = 2.4, mat: m = stoneM, crenel = true, sink = 3 } = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1), cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, ang = Math.atan2(x2 - x1, z2 - z1);
    const gy = Math.min(groundHeight(x1, z1), groundHeight(x2, z2), groundHeight(cx, cz)) - sink;
    const mesh = new THREE.Mesh(boxGeo(t, h + sink, len), m); mesh.position.set(cx, gy + (h + sink) / 2, cz); mesh.rotation.y = ang;
    mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    if (crenel) {
      const n = Math.floor(len / 2.2);
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.22) continue;
        const u = ((i + 0.5) / n - 0.5) * len;
        const b = new THREE.Mesh(boxGeo(t * 0.9, 1.1, 1.0), m); b.position.set(cx + Math.sin(ang) * u, gy + h + sink + 0.55, cz + Math.cos(ang) * u); b.rotation.y = ang;
        b.castShadow = true; scene.add(b);
      }
    }
    solid(cx, cz, t / 2, len / 2, ang);
  }
  function tower(x, z, r = 5, h = 14) {
    const gy = groundHeight(x, z) - 3;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h + 3, 14), stoneM);
    m.material = stoneM.clone(); m.material.map = stoneM.map.clone(); m.material.map.repeat.set(r * 1.1, (h + 3) / 4); m.material.map.needsUpdate = true;
    m.position.set(x, gy + (h + 3) / 2, z); m.castShadow = m.receiveShadow = true; scene.add(m);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.6, r + 0.6, 0.9, 14), stoneDark); top.position.set(x, gy + h + 3.4, z); top.castShadow = true; scene.add(top);
    for (let i = 0; i < 9; i++) { if (rnd() < 0.2) continue; const a = (i / 9) * Math.PI * 2; const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.0), stoneDark); b.position.set(x + Math.cos(a) * (r + 0.4), gy + h + 4.4, z + Math.sin(a) * (r + 0.4)); b.rotation.y = -a + Math.PI / 2; b.castShadow = true; scene.add(b); }
    circle(x, z, r + 0.3);
  }

  // ---------------- Burgmauern ----------------
  const gateX = 6;
  wall(-34, -62, -gateX - 2, -62, { h: 9 }); wall(gateX + 2, -62, 34, -62, { h: 9 });
  tower(-gateX - 3, -62, 4.6, 15); tower(gateX + 3, -62, 4.6, 15);
  // Torbogen
  const lintel = new THREE.Mesh(boxGeo(gateX * 2 + 1, 3.2, 3.2), stoneM); lintel.position.set(0, 2.6 + 8.2, -62); lintel.castShadow = true; scene.add(lintel);
  for (let i = 0; i < 7; i++) { const a = (i / 6) * Math.PI; const b = new THREE.Mesh(boxGeo(1.4, 1.4, 2.6), stoneDark); b.position.set(Math.cos(a) * (gateX - 0.6), 2.6 + 6.4 + Math.sin(a) * 1.0, -62); b.rotation.z = a; scene.add(b); }
  wall(-34, -62, -34, -125, { h: 9 }); wall(34, -62, 34, -125, { h: 9 });
  wall(-34, -125, -22, -125, { h: 9 }); wall(34, -125, 22, -125, { h: 9 });
  tower(-34, -62, 5, 16); tower(34, -62, 5, 16); tower(-34, -125, 5.5, 18); tower(34, -125, 5.5, 18);
  // Aeussere Hangmauern zur Begrenzung des Dorfes nach Westen/Osten bleiben Huegel (natuerlich).

  // ---------------- Boss-Arena Ring ----------------
  const NA = 28, gapA = 0.19;
  for (let i = 0; i < NA; i++) {
    const a0 = Math.PI / 2 + gapA + (i / NA) * (Math.PI * 2 - gapA * 2), a1 = Math.PI / 2 + gapA + ((i + 1) / NA) * (Math.PI * 2 - gapA * 2);
    // a=pi/2 zeigt nach +Z im (cos->x, sin->z)-Mapping
    const x0 = ARENA.x + Math.cos(a0) * ARENA.r, z0 = ARENA.z + Math.sin(a0) * ARENA.r, x1 = ARENA.x + Math.cos(a1) * ARENA.r, z1 = ARENA.z + Math.sin(a1) * ARENA.r;
    wall(x0, z0, x1, z1, { h: 10, t: 2.6, sink: 4, crenel: i % 2 === 0 });
  }
  // Torpfeiler am Nebeltor
  for (const s of [-1, 1]) {
    const px = s * (FOG_GATE.w / 2 + 1.2);
    const p = new THREE.Mesh(boxGeo(2.4, 13, 2.8), stoneM); p.position.set(px, groundHeight(px, -127) + 5.5, -127.2); p.castShadow = true; scene.add(p);
    const c = new THREE.Mesh(boxGeo(3.2, 1.2, 3.6), stoneDark); c.position.set(px, groundHeight(px, -127) + 12.3, -127.2); scene.add(c);
    solid(px, -127.2, 1.2, 1.4);
  }
  // Der Bergfried als Kulisse
  const keepM = stoneM;
  const keep = new THREE.Mesh(boxGeo(38, 52, 22), keepM); keep.position.set(0, groundHeight(0, -190) + 22, -198); keep.castShadow = true; scene.add(keep);
  for (const x of [-22, 22]) tower(x, -196, 6.5, 44);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(8, 22, 8), mat(0x2a2e3a, { roughness: 0.9 })); spire.position.set(0, groundHeight(0, -190) + 58, -198); scene.add(spire);
  // Arena-Boden: gepflasterter Kreis mit Runenring
  const arenaFloor = new THREE.Mesh(new THREE.CircleGeometry(ARENA.r - 1.2, 48), new THREE.MeshStandardMaterial({ map: stoneTex(), color: 0x6a6660, roughness: 1 }));
  arenaFloor.map = null; arenaFloor.rotation.x = -Math.PI / 2; arenaFloor.position.set(ARENA.x, groundHeight(ARENA.x, ARENA.z) + 0.04, ARENA.z); arenaFloor.receiveShadow = true;
  arenaFloor.material.map.repeat.set(8, 8); scene.add(arenaFloor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(10, 10.5, 64), new THREE.MeshBasicMaterial({ color: 0x884422, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(ARENA.x, groundHeight(ARENA.x, ARENA.z) + 0.08, ARENA.z); scene.add(ring);
  // Arena-Saeulen
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, x = ARENA.x + Math.cos(a) * 15, z = ARENA.z + Math.sin(a) * 15;
    const h = R(3, 7);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, h, 8), stoneM); p.position.set(x, groundHeight(x, z) + h / 2, z); p.castShadow = true; p.rotation.z = R(-0.03, 0.03); scene.add(p);
    circle(x, z, 1.4);
  }

  // ---------------- Dorf: Ruinenhaeuser ----------------
  function ruin(x, z, w, d, rot) {
    const g = new THREE.Group(); g.position.set(x, groundHeight(x, z) - 0.5, z); g.rotation.y = rot;
    const walls = [[0, d / 2, w, 0], [0, -d / 2, w, 0], [w / 2, 0, d, Math.PI / 2], [-w / 2, 0, d, Math.PI / 2]];
    walls.forEach(([px, pz, len, r], i) => {
      if (i === 1 && rnd() < 0.5) { return; }
      const hh = R(1.8, 4.4);
      const m = new THREE.Mesh(boxGeo(len, hh, 0.55), i % 2 ? stoneDark : stoneM); m.position.set(px, hh / 2, pz); m.rotation.y = r; m.castShadow = m.receiveShadow = true; g.add(m);
      // Einbruchkante
      const gap = new THREE.Mesh(boxGeo(len * R(0.2, 0.4), hh * 0.5, 0.6), i % 2 ? stoneDark : stoneM); gap.position.set(px + (r ? 0 : R(-len / 3, len / 3)), hh + 0.2, pz + (r ? R(-len / 3, len / 3) : 0)); gap.rotation.y = r; g.add(gap);
      const c = Math.cos(rot), s = Math.sin(rot);
      const wx = x + px * c + pz * s, wz = z - px * s + pz * c;
      solid(wx, wz, (r ? 0.3 : len / 2), (r ? len / 2 : 0.3), rot);
    });
    // Dachbalken
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, d * 0.8), woodM); b.position.set(R(-w / 2, w / 2), R(3, 4.4), R(-0.3, 0.3)); b.rotation.set(R(-0.4, 0.4), R(-0.2, 0.2), R(-0.3, 0.3)); b.castShadow = true; g.add(b);
    }
    if (rnd() < 0.6) { const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.12, d * 0.6), thatch); roof.position.set(w * 0.2, 3.2, 0); roof.rotation.z = R(0.4, 0.8); roof.castShadow = true; g.add(roof); }
    scene.add(g);
  }
  [[-22, 8, 10, 8, 0.3], [20, -6, 9, 8, -0.5], [-30, -22, 8, 7, 1.2], [28, -26, 10, 9, 0.2], [-15, -36, 9, 8, -0.2], [14, -42, 8, 7, 0.9], [-34, 20, 8, 8, 0.1]].forEach((r) => ruin(...r));

  // Zaun / Karren / Fass
  const crates = [[-6, -12], [8, -18], [-10, 4], [12, 12], [-4, -48], [6, -50]];
  crates.forEach(([x, z]) => {
    const t = rnd();
    if (t < 0.5) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.1, 10), woodM); b.position.set(x, groundHeight(x, z) + 0.55, z); b.castShadow = true; scene.add(b); circle(x, z, 0.6); }
    else { const b = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1, 1.1), woodM); b.position.set(x, groundHeight(x, z) + 0.5, z); b.rotation.y = R(3); b.castShadow = true; scene.add(b); circle(x, z, 0.8); }
  });

  // Friedhof (links vom Startpunkt)
  for (let i = 0; i < 28; i++) {
    const x = R(-48, -26), z = R(-8, 14), hgt = R(0.7, 1.4);
    const g = new THREE.Mesh(boxGeo(0.7, hgt, 0.18, 1.5), stoneDark); g.position.set(x, groundHeight(x, z) + hgt / 2 - 0.1, z); g.rotation.set(R(-0.15, 0.15), R(-0.5, 0.5), R(-0.2, 0.2)); g.castShadow = true; scene.add(g);
    if (rnd() < 0.5) circle(x, z, 0.4);
  }

  // ---------------- Baeume (tot) ----------------
  const barkM = mat(0x2b2119, { roughness: 1 });
  function deadTree(x, z, s = 1) {
    const g = new THREE.Group(); g.position.set(x, groundHeight(x, z) - 0.3, z); g.rotation.y = R(6.28);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.4 * s, 5.5 * s, 7), barkM); trunk.position.y = 2.6 * s; trunk.rotation.z = R(-0.08, 0.08); trunk.castShadow = true; g.add(trunk);
    const nb = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < nb; i++) {
      const L = R(1.4, 3) * s, br = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.13 * s, L, 5), barkM);
      br.geometry.translate(0, L / 2, 0);
      br.position.y = R(2.2, 5) * s; br.rotation.set(R(-1, 1), R(6.28), R(0.5, 1.2)); br.castShadow = true; g.add(br);
      if (rnd() < 0.6) { const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.06, L * 0.6, 4), barkM); s2.geometry.translate(0, L * 0.3, 0); s2.position.copy(br.position); s2.position.addScaledVector(new THREE.Vector3(0, 1, 0).applyEuler(br.rotation), L * 0.6); s2.rotation.set(br.rotation.x + R(-0.8, 0.8), br.rotation.y, br.rotation.z + R(-0.8, 0.8)); g.add(s2); }
    }
    scene.add(g); circle(x, z, 0.5 * s);
  }
  for (let i = 0; i < 70; i++) {
    const x = R(-80, 80), z = R(-58, 44);
    if (Math.abs(x) < 7 && z > -56) continue;                 // Weg freihalten
    if (Math.hypot(x, z) < 10) continue;
    deadTree(x, z, R(0.8, 1.5));
  }
  // Baeume ausserhalb der Mauern (Kulisse)
  for (let i = 0; i < 30; i++) { const side = rnd() < 0.5 ? -1 : 1; const x = side * R(40, 75), z = R(-190, -66); deadTree(x, z, R(1, 1.7)); }

  // Felsen
  const rockM = mat(0x5a5a5e, { roughness: 1 });
  for (let i = 0; i < 40; i++) {
    const x = R(-80, 80), z = R(-58, 44), s = R(0.6, 2.2);
    if (Math.abs(x) < 6 && z > -56) continue;
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockM); r.position.set(x, groundHeight(x, z) + s * 0.2, z); r.scale.set(1, R(0.5, 0.9), R(0.8, 1.2)); r.rotation.set(R(3), R(3), R(3)); r.castShadow = true; scene.add(r); circle(x, z, s * 0.9);
  }
  // Gras-Buesche (instanziert)
  const tuft = new THREE.ConeGeometry(0.045, 0.45, 3); tuft.translate(0, 0.35, 0);
  const NT = 5000, grassI = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ color: 0x4f6034, roughness: 1 }), NT);
  const dm = new THREE.Object3D(), gc = new THREE.Color();
  for (let i = 0; i < NT; i++) {
    const x = R(-82, 82), z = R(-60, 46);
    const onPath = Math.abs(x - Math.sin(z * 0.045) * 4) < 3 && z < 10;
    dm.position.set(x, onPath ? -50 : groundHeight(x, z), z); dm.rotation.set(R(-0.2, 0.2), R(6.28), R(-0.2, 0.2)); dm.scale.set(R(0.7, 1.4), R(0.6, 1.5), R(0.7, 1.4));
    dm.updateMatrix(); grassI.setMatrixAt(i, dm.matrix); gc.setHSL(R(0.2, 0.28), 0.35, R(0.16, 0.3)); grassI.setColorAt(i, gc);
  }
  grassI.receiveShadow = true; scene.add(grassI);

  // Innenhof-Dekor: zerbrochene Statuen, Fackelstaender, Waffenstaender
  for (const [x, z] of [[-14, -86], [16, -96], [-18, -104], [14, -74]]) {
    const base = new THREE.Mesh(boxGeo(2, 1.2, 2), stoneM); base.position.set(x, groundHeight(x, z) + 0.6, z); base.castShadow = true; scene.add(base);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 3, 8), stoneDark); body.position.set(x, groundHeight(x, z) + 2.7, z); body.rotation.z = R(-0.06, 0.06); body.castShadow = true; scene.add(body);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), stoneDark); hd.position.set(x, groundHeight(x, z) + 4.5, z); hd.castShadow = true; if (rnd() < 0.5) hd.visible = false; scene.add(hd);
    circle(x, z, 1.3);
  }
  // Truemmer
  for (let i = 0; i < 50; i++) {
    const x = R(-32, 32), z = R(-120, -66), s = R(0.2, 0.7);
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stoneDark); r.position.set(x, groundHeight(x, z) + s * 0.3, z); r.rotation.set(R(3), R(3), R(3)); r.castShadow = true; scene.add(r);
  }

  // ---------------- Leuchtfeuer ----------------
  GLOW.fire = glowTex();
  const sparkTex = glowTex('rgba(255,230,160,1)', 'rgba(255,140,40,0.4)');
  function makeBonfire(id, name, x, z) {
    const y = groundHeight(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z);
    // Asche-Huegel
    const ash = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.55, 12), mat(0x3a3836, { roughness: 1 })); ash.position.y = 0.2; ash.scale.set(1, 1, 1); ash.receiveShadow = true; g.add(ash);
    for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.DodecahedronGeometry(R(0.12, 0.22), 0), stoneDark); const a = R(6.28); b.position.set(Math.cos(a) * R(0.7, 1.2), 0.1, Math.sin(a) * R(0.7, 1.2)); g.add(b); }
    // Gewundenes Schwert
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.5, 0.02), mat(0xb0b0b0, { metalness: 0.8, roughness: 0.3 })); blade.position.y = 0.95; g.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.05), mat(0x7a7040, { metalness: 0.6 })); guard.position.y = 1.7; g.add(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6), blackWood); grip.position.y = 1.85; g.add(grip);
    const pts = []; for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * Math.PI * 9; pts.push(new THREE.Vector3(Math.cos(a) * 0.17 * (1.1 - t * 0.4), 0.3 + t * 1.2, Math.sin(a) * 0.17 * (1.1 - t * 0.4))); }
    const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.012, 5), mat(0x555555, { metalness: 0.7, roughness: 0.4 })); g.add(coil);
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    // Flamme (mehrere additive Sprites)
    const flame = new THREE.Group(); flame.position.y = 0.7; g.add(flame);
    const sprites = [];
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW.fire, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: i < 3 ? 0xff9a3a : 0xffd080 }));
      sp.userData = { ph: R(6.28), s: R(0.8, 1.5) * (1 - i * 0.08), oy: i * 0.12 };
      flame.add(sp); sprites.push(sp);
    }
    const light = new THREE.PointLight(0xff8a30, 0, 32, 2); light.position.y = 1.6; g.add(light);
    // Funken
    const NS = 28, sg = new THREE.BufferGeometry(); const sp = new Float32Array(NS * 3); const sd = [];
    for (let i = 0; i < NS; i++) sd.push({ t: R(3), x: 0, z: 0, vx: R(-0.3, 0.3), vz: R(-0.3, 0.3), vy: R(0.8, 1.8) });
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const sparks = new THREE.Points(sg, new THREE.PointsMaterial({ map: sparkTex, size: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffb060 })); sparks.frustumCulled = false; g.add(sparks);
    scene.add(g);
    circle(x, z, 0.9);
    const b = { id, name, pos: new THREE.Vector3(x, y, z), lit: false, group: g, sprites, light, flame, sparks, sd, spPos: sp, blend: 0, ember: 0 };
    W.bonfires.push(b); return b;
  }
  W.makeBonfire = makeBonfire;
  makeBonfire(0, 'Verfallenes Dorf', 0, -6);
  makeBonfire(1, 'Burghof', 0, -78);
  makeBonfire(2, 'Vor dem Nebeltor', 0, -112);

  W.updateBonfires = (t, dt, camPos) => {
    for (const b of W.bonfires) {
      b.blend = lerp(b.blend, b.lit ? 1 : 0, 1 - Math.exp(-2.5 * dt));
      const k = b.blend;
      b.flame.visible = k > 0.01;
      b.sprites.forEach((s, i) => {
        const u = s.userData, f = 0.8 + Math.sin(t * 9 + u.ph) * 0.12 + Math.sin(t * 17 + u.ph * 2) * 0.08;
        const sc = u.s * f * k * 1.9;
        s.scale.set(sc, sc * (1.25 + i * 0.1), 1);
        s.position.set(Math.sin(t * 3 + u.ph) * 0.06, u.oy * f, Math.cos(t * 2.4 + u.ph) * 0.06);
        s.material.opacity = 0.75;
      });
      b.light.intensity = k * (62 + Math.sin(t * 11 + b.id) * 6 + Math.sin(t * 23 + b.id * 3) * 4);
      // Funken (lebendig wenn entfacht, schwach glimmend sonst)
      const arr = b.spPos;
      b.sparks.material.opacity = 0.25 + 0.75 * k;
      b.sd.forEach((s, i) => {
        s.t += dt * (0.5 + k);
        if (s.t > 3) { s.t = 0; s.x = rand(-0.25, 0.25); s.z = rand(-0.25, 0.25); }
        arr[i * 3] = s.x + s.vx * s.t + Math.sin(s.t * 5 + i) * 0.1; arr[i * 3 + 1] = 0.8 + s.vy * s.t * (0.5 + k * 0.8); arr[i * 3 + 2] = s.z + s.vz * s.t;
      });
      b.sparks.geometry.attributes.position.needsUpdate = true;
    }
  };

  // ---------------- Nebeltor ----------------
  const fogCanvas = document.createElement('canvas'); fogCanvas.width = fogCanvas.height = 256;
  const fg = fogCanvas.getContext('2d');
  for (let i = 0; i < 160; i++) { const gr = fg.createRadialGradient(rand(256), rand(256), 0, 0, 0, 0); const x = rand(256), y = rand(256), r = rand(20, 70); const gg = fg.createRadialGradient(x, y, 0, x, y, r); gg.addColorStop(0, 'rgba(255,255,255,0.22)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); fg.fillStyle = gg; for (const ox of [-256, 0, 256]) { fg.save(); fg.translate(ox, 0); fg.fillRect(x - r, y - r, r * 2, r * 2); fg.restore(); } }
  const fogT = new THREE.CanvasTexture(fogCanvas); fogT.wrapS = fogT.wrapT = THREE.RepeatWrapping; fogT.repeat.set(2, 1.4);
  const gateMat = new THREE.MeshBasicMaterial({ map: fogT, color: 0xd8e4ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const gateMesh = new THREE.Mesh(new THREE.PlaneGeometry(FOG_GATE.w, 11), gateMat);
  gateMesh.position.set(FOG_GATE.x, groundHeight(0, -127.5) + 5.5, FOG_GATE.z); scene.add(gateMesh);
  const fogGate = { mesh: gateMesh, sealed: false, collider: { type: 'box', x: 0, z: -126.8, hx: 5, hz: 0.5, rot: 0, c: 1, s: 0, topY: 99 }, active: true };
  W.fogGate = fogGate;
  W.setGateSealed = (v) => { fogGate.sealed = v; const i = W.colliders.indexOf(fogGate.collider); if (v && i < 0) W.colliders.push(fogGate.collider); if (!v && i >= 0) W.colliders.splice(i, 1); };
  W.setGateVisible = (v) => { gateMesh.visible = v; };
  W.updateGate = (t) => { fogT.offset.set(t * 0.03, t * 0.015); gateMat.opacity = 0.7 + Math.sin(t * 1.5) * 0.12; };

  // Halo-Nebel: tiefliegende Nebelkarten, die langsam driften
  const mistMat = new THREE.MeshBasicMaterial({ map: fogT, color: 0x8a96b0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(R(30, 60), R(30, 60)), mistMat); m.rotation.x = -Math.PI / 2; const x = R(-70, 70), z = R(-170, 40); m.position.set(x, groundHeight(x, z) + R(0.4, 1.2), z); scene.add(m);
  }

  // ---------------- Kollisionsaufloesung ----------------
  W.resolve = (p, r) => {
    for (const c of W.colliders) {
      if (c.type === 'circle') {
        const dx = p.x - c.x, dz = p.z - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.001; p.x = c.x + (dx / d) * rr; p.z = c.z + (dz / d) * rr; }
      } else {
        const dx = p.x - c.x, dz = p.z - c.z;
        // ins lokale System (Rotation um Y: Mauer-Laengsachse = lokale Z)
        const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
        const ex = c.hx + r, ez = c.hz + r;
        if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
          const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
          let nx = lx, nz = lz;
          if (px < pz) nx = Math.sign(lx || 1) * ex; else nz = Math.sign(lz || 1) * ez;
          p.x = c.x + nx * c.c + nz * c.s; p.z = c.z - nx * c.s + nz * c.c;
        }
      }
    }
    p.x = clamp(p.x, BOUNDS.x0, BOUNDS.x1); p.z = clamp(p.z, BOUNDS.z0, BOUNDS.z1);
    // Arena: ausserhalb des Rings nicht hinein/heraus (Kollision uebernimmt Ringwand)
  };
  return W;
}
