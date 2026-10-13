import * as THREE from 'three';
import { PHYS, cornerSpeed, accelAt, brakeDecel } from './phys.js';

const DS = 2; // Abstand der Streckenpunkte in Metern

// ---------- Hilfsfunktionen ----------
function resample(X, Z, ds) {
  const n = X.length, cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; cum[i + 1] = cum[i] + Math.hypot(X[j] - X[i], Z[j] - Z[i]); }
  const L = cum[n], N = Math.round(L / ds), step = L / N;
  const OX = new Float64Array(N), OZ = new Float64Array(N);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = k * step;
    while (cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1, t = (s - cum[j]) / seg, j2 = (j + 1) % n;
    OX[k] = X[j] + (X[j2] - X[j]) * t; OZ[k] = Z[j] + (Z[j2] - Z[j]) * t;
  }
  return { X: OX, Z: OZ, L, step };
}

function smoothClosed(X, Z, iters) {
  const n = X.length, TX = new Float64Array(n), TZ = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      TX[i] = (X[a] + 2 * X[i] + X[b]) / 4; TZ[i] = (Z[a] + 2 * Z[i] + Z[b]) / 4;
    }
    X.set(TX); Z.set(TZ);
  }
}

function smoothArr(A, r, iters = 1) {
  const n = A.length, T = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let o = -r; o <= r; o++) s += A[(i + o + n) % n];
      T[i] = s / (2 * r + 1);
    }
    A.set(T);
  }
}

function minFilter(A, r) {
  const n = A.length, T = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let o = -r; o <= r; o++) m = Math.min(m, A[(i + o + n) % n]);
    T[i] = m;
  }
  A.set(T);
}

// Krümmung über drei Punkte (positiv = Rechtskurve, Bildschirm-Koordinaten mit z nach unten)
function curv3(ax, az, bx, bz, cx, cz) {
  const ux = bx - ax, uz = bz - az, vx = cx - bx, vz = cz - bz;
  const cr = ux * vz - uz * vx;
  const d = Math.hypot(ux, uz) * Math.hypot(vx, vz) * Math.hypot(cx - ax, cz - az);
  return d > 1e-9 ? 2 * cr / d : 0;
}

class Grid {
  constructor(X, Z, cell = 24) {
    this.X = X; this.Z = Z; this.cell = cell; this.map = new Map();
    for (let i = 0; i < X.length; i++) {
      const k = this.key(Math.floor(X[i] / cell), Math.floor(Z[i] / cell));
      let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(i);
    }
  }
  key(ix, iz) { return ix * 100003 + iz; }
  // ruft fn(i, dist2) für alle Punkte im Umkreis r auf; fn kann true liefern = abbrechen
  near(x, z, r, fn) {
    const c = this.cell, r2 = r * r;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const a = this.map.get(this.key(ix, iz)); if (!a) continue;
      for (const i of a) {
        const dx = this.X[i] - x, dz = this.Z[i] - z, d2 = dx * dx + dz * dz;
        if (d2 <= r2 && fn(i, d2)) return true;
      }
    }
    return false;
  }
  dist(x, z, r) {
    let best = r * r;
    this.near(x, z, r, (i, d2) => { if (d2 < best) best = d2; });
    return Math.sqrt(best);
  }
}

// ---------- Streckendaten ----------
export function buildTrackData(def) {
  const raw = [];
  for (let i = 0; i < def.pts.length; i += 2) raw.push(new THREE.Vector3(def.pts[i], 0, def.pts[i + 1]));
  const curve = new THREE.CatmullRomCurve3(raw, true, 'centripetal');
  const pts = curve.getPoints(raw.length * 40); pts.pop();
  let r = resample(Float64Array.from(pts, p => p.x), Float64Array.from(pts, p => p.z), 1);
  smoothClosed(r.X, r.Z, def.smooth ?? 60);
  r = resample(r.X, r.Z, DS);
  let X = r.X, Z = r.Z;
  const N = X.length, L = r.L, ds = r.step;
  if (def.startShift) {
    const sh = Math.round(def.startShift / ds);
    const rot = A => { const B = new Float64Array(N); for (let i = 0; i < N; i++) B[i] = A[(i + sh + N) % N]; return B; };
    X = rot(X); Z = rot(Z);
  }
  const TX = new Float64Array(N), TZ = new Float64Array(N), NX = new Float64Array(N), NZ = new Float64Array(N), K = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    let tx = X[b] - X[a], tz = Z[b] - Z[a]; const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l; TX[i] = tx; TZ[i] = tz; NX[i] = -tz; NZ[i] = tx; // n = rechte Seite
  }
  for (let i = 0; i < N; i++) {
    const a = (i - 3 + N) % N, b = (i + 3) % N;
    K[i] = curv3(X[a], Z[a], X[i], Z[i], X[b], Z[b]);
  }
  const hw = def.width / 2;
  const grid = new Grid(X, Z);
  const far = Math.round(70 / ds);
  const cyc = (i, j) => { const d = Math.abs(i - j); return Math.min(d, N - d); };

  // Mauerabstand je Seite: nicht in andere Streckenteile hinein und nicht über den Kurvenmittelpunkt hinaus
  const maxW = hw + def.runoff;
  const wall = [new Float64Array(N), new Float64Array(N)]; // [links, rechts]
  const Ks = Float64Array.from(K); smoothArr(Ks, 4, 2);
  for (let i = 0; i < N; i++) {
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      let w = maxW;
      for (let rr = hw + 0.5; rr <= maxW + hw + 1; rr += 0.5) {
        const px = X[i] + NX[i] * rr * sg, pz = Z[i] + NZ[i] * rr * sg;
        if (grid.near(px, pz, hw + 0.6, j => cyc(i, j) > far)) { w = Math.min(w, (hw + rr) / 2 - 0.6); break; }
      }
      if (Ks[i] * sg > 0) w = Math.min(w, Math.max(hw + 1.2, 0.85 / Math.abs(Ks[i]))); // Kurveninnenseite
      wall[side][i] = Math.max(hw + 1.2, w);
    }
  }
  for (const w of wall) { minFilter(w, 6); smoothArr(w, 4, 2); }

  // Höhenprofil (Spa, COTA …)
  const Y = new Float64Array(N);
  if (def.elev && def.elev.length) {
    const E = def.elev, m = E.length;
    for (let i = 0; i < N; i++) {
      const f = i / N;
      let k = m - 1; for (let q = 0; q < m; q++) if (E[q][0] <= f) k = q;
      const p1 = E[k], p2 = E[(k + 1) % m], p0 = E[(k - 1 + m) % m], p3 = E[(k + 2) % m];
      const f1 = p1[0], f2 = p2[0] > f1 ? p2[0] : p2[0] + 1;
      const t = ((f < f1 ? f + 1 : f) - f1) / (f2 - f1);
      const t2 = t * t, t3 = t2 * t;
      Y[i] = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
    }
    smoothArr(Y, 12, 3);
  }
  // Brücke: Acht-Form (Suzuka) – der spätere Streckenteil führt über den früheren
  const bridge = new Uint8Array(N), opening = new Uint8Array(N);
  let bridgeAt = -1;
  if (def.bridge) {
    let bd = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < N; i++) grid.near(X[i], Z[i], hw * 2, (j, d2) => { if (cyc(i, j) > N / 10 && d2 < bd) { bd = d2; bi = i; bj = j; } });
    if (bi >= 0) {
      bridgeAt = Math.max(bi, bj);
      const R = 230, H = 8.5;
      for (let i = 0; i < N; i++) {
        const x = cyc(i, bridgeAt) * ds / R;
        if (x < 1) { Y[i] += H * (1 + Math.cos(Math.PI * x)) / 2; bridge[i] = 1; }
      }
      for (let i = 0; i < N; i++) if (bridge[i] && grid.near(X[i], Z[i], hw * 2 + 5, j => !bridge[j])) opening[i] = 1;
    }
  }
  // Steilkurven (Zandvoort)
  const bankT = new Float64Array(N), bankOut = new Float64Array(N), bankG = new Float64Array(N);
  for (const [f0, f1, deg] of def.bank || []) {
    const i0 = Math.round(f0 * N), i1 = Math.round(f1 * N), mid = Math.round((i0 + i1) / 2) % N;
    const out = Ks[mid] > 0 ? -1 : 1, len = i1 - i0;
    for (let q = 0; q <= len; q++) {
      const i = (i0 + q) % N, e = Math.min(1, Math.min(q, len - q) / (len * 0.22));
      bankT[i] = Math.tan(deg * Math.PI / 180) * (0.5 - 0.5 * Math.cos(Math.PI * e));
      bankOut[i] = out; bankG[i] = PHYS.G * Math.sin(Math.atan(bankT[i]));
    }
  }
  const slope = new Float64Array(N);
  for (let i = 0; i < N; i++) slope[i] = (Y[(i + 1) % N] - Y[(i - 1 + N) % N]) / (2 * ds);

  // Randsteine und Kiesbetten
  const kerb = new Uint8Array(N), gravel = [new Uint8Array(N), new Uint8Array(N)];
  for (let i = 0; i < N; i++) {
    const k = Math.abs(Ks[i]);
    if (k > 1 / 220) for (let o = -10; o <= 10; o++) kerb[(i + o + N) % N] = 1;
    if (k > 1 / 160 && !bridge[i]) {
      const outside = Ks[i] > 0 ? 0 : 1; // Rechtskurve → links außen
      for (let o = -4; o <= 22; o++) { const j = (i + o + N) % N; if (!bankT[j] && !bridge[j]) gravel[outside][j] = 1; }
    }
  }

  // Ideallinie (grob berechnen, dann verfeinern)
  const lim = hw - 1.5;
  const M = 4, n = Math.floor(N / M);
  const cx = new Float64Array(n), cz = new Float64Array(n), nx = new Float64Array(n), nz = new Float64Array(n), d = new Float64Array(n);
  for (let i = 0; i < n; i++) { const j = i * M; cx[i] = X[j]; cz[i] = Z[j]; nx[i] = NX[j]; nz[i] = NZ[j]; }
  const px = i => { i = (i + n) % n; return cx[i] + nx[i] * d[i]; };
  const pz = i => { i = (i + n) % n; return cz[i] + nz[i] * d[i]; };
  for (let it = 0; it < 1400; it++) {
    const bend = it > 450;
    for (let i = 0; i < n; i++) {
      let tx, tz;
      if (bend) { tx = (-px(i - 2) + 4 * px(i - 1) + 4 * px(i + 1) - px(i + 2)) / 6; tz = (-pz(i - 2) + 4 * pz(i - 1) + 4 * pz(i + 1) - pz(i + 2)) / 6; }
      else { tx = (px(i - 1) + px(i + 1)) / 2; tz = (pz(i - 1) + pz(i + 1)) / 2; }
      const delta = (tx - px(i)) * nx[i] + (tz - pz(i)) * nz[i];
      d[i] = Math.max(-lim, Math.min(lim, d[i] + delta * 0.7));
    }
  }
  const line = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const i0 = Math.floor(j / M) % n, i1 = (i0 + 1) % n, t = (j - Math.floor(j / M) * M) / M;
    line[j] = d[i0] + (d[i1] - d[i0]) * t;
  }
  smoothArr(line, 3, 2);
  for (let j = 0; j < N; j++) line[j] = Math.max(-lim, Math.min(lim, line[j]));

  // Tempoprofil auf der Ideallinie
  const LX = new Float64Array(N), LZ = new Float64Array(N);
  for (let i = 0; i < N; i++) { LX[i] = X[i] + NX[i] * line[i]; LZ[i] = Z[i] + NZ[i] * line[i]; }
  const KL = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 4 + N) % N, b = (i + 4) % N;
    KL[i] = curv3(LX[a], LZ[a], LX[i], LZ[i], LX[b], LZ[b]);
  }
  smoothArr(KL, 2, 1);
  const speed = new Float64Array(N);
  for (let i = 0; i < N; i++) speed[i] = Math.min(PHYS.VMAX * 1.02, cornerSpeed(KL[i], 0.96, bankG[i]));
  for (let rep = 0; rep < 2; rep++) for (let i = N - 1; i >= 0; i--) {
    const j = (i + 1) % N;
    speed[i] = Math.min(speed[i], Math.sqrt(speed[j] ** 2 + 2 * Math.max(4, brakeDecel(speed[j]) * 0.8 + PHYS.G * slope[i]) * ds));
  }
  for (let rep = 0; rep < 2; rep++) for (let i = 0; i < N; i++) {
    const j = (i - 1 + N) % N;
    speed[i] = Math.min(speed[i], Math.sqrt(speed[j] ** 2 + 2 * Math.max(1, accelAt(speed[j], PHYS.VMAX * 1.02) - PHYS.G * slope[j]) * ds));
  }

  // Seite für die Pole-Position: Innenseite der ersten Kurve
  let ksum = 0; for (let i = 0; i < Math.round(450 / ds); i++) ksum += K[i];
  const poleSide = ksum >= 0 ? 1 : -1;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minZ = Math.min(minZ, Z[i]); maxZ = Math.max(maxZ, Z[i]); }

  // Höhe der Fahrbahn bei Index i und Seitenversatz d (inkl. Steilkurve)
  const h = (i, d) => Y[i] + (bankT[i] ? bankT[i] * Math.max(0, Math.min(2 * hw + 4, d * bankOut[i] + hw)) : 0);

  return { def, N, L, ds, hw, X, Z, TX, TZ, NX, NZ, K: Ks, wall, kerb, gravel, line, speed, grid, poleSide,
    Y, slope, bankT, bankOut, bankG, bridge, opening, bridgeAt, h, hasElev: !!(def.elev && def.elev.length),
    bbox: { minX, maxX, minZ, maxZ }, cyc };
}

// Position auf der Strecke finden (lokale Suche um den letzten Index)
export function locate(T, x, z, hint = -1) {
  let best = -1, bd = Infinity;
  if (hint >= 0) {
    for (let o = -30; o <= 30; o++) {
      const i = (hint + o + T.N) % T.N, dx = x - T.X[i], dz = z - T.Z[i], d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    }
  }
  if (best < 0 || bd > (T.hw + 40) ** 2) {
    bd = Infinity;
    for (let i = 0; i < T.N; i++) { const dx = x - T.X[i], dz = z - T.Z[i], d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = i; } }
  }
  const dx = x - T.X[best], dz = z - T.Z[best];
  let s = best * T.ds + dx * T.TX[best] + dz * T.TZ[best];
  s = ((s % T.L) + T.L) % T.L;
  return { i: best, s, d: dx * T.NX[best] + dz * T.NZ[best] };
}

// Punkt bei Streckenposition s und Seitenversatz d
export function pointAt(T, s, d = 0) {
  s = ((s % T.L) + T.L) % T.L;
  const f = s / T.ds, i0 = Math.floor(f) % T.N, i1 = (i0 + 1) % T.N, t = f - Math.floor(f);
  const x = T.X[i0] + (T.X[i1] - T.X[i0]) * t, z = T.Z[i0] + (T.Z[i1] - T.Z[i0]) * t;
  const nx = T.NX[i0], nz = T.NZ[i0];
  const y = T.h(i0, d) + (T.h(i1, d) - T.h(i0, d)) * t;
  return { x: x + nx * d, y, z: z + nz * d, tx: T.TX[i0], tz: T.TZ[i0], i: i0 };
}

// Fahrbahnhöhe an einer gefundenen Position (für Autos)
export function heightAt(T, i, s, d) {
  const f = s / T.ds, i0 = Math.floor(f) % T.N, i1 = (i0 + 1) % T.N, t = f - Math.floor(f);
  return T.h(i0, d) + (T.h(i1, d) - T.h(i0, d)) * t;
}

// ---------- Texturen ----------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  return t;
}

function noise(g, w, h, n, colors, size = [1, 3]) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    const s = size[0] + Math.random() * (size[1] - size[0]);
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

const asphaltTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#3d4146'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 14000, ['#33373b', '#474b50', '#2e3135', '#52565b'], [1, 2.5]);
  // dunkle Gummispuren in der Mitte
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0.2, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(15,15,18,0.18)'); gr.addColorStop(0.8, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ecedea';
  g.fillRect(w * 0.012, 0, w * 0.026, h); g.fillRect(w * 0.962, 0, w * 0.026, h);
});

const kerbTex = () => canvasTex(64, 128, (g, w, h) => {
  g.fillStyle = '#d42020'; g.fillRect(0, 0, w, h / 2);
  g.fillStyle = '#f1f1ee'; g.fillRect(0, h / 2, w, h / 2);
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 0, w * 0.12, h);
});

const gravelTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c9b48a'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 9000, ['#b8a27a', '#d8c59d', '#a99169', '#e2d3ae'], [1, 3]);
});

function grassTex(base) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const c = new THREE.Color(base);
    const shade = f => '#' + c.clone().multiplyScalar(f).getHexString();
    g.globalAlpha = 0.25; g.fillStyle = shade(1.12); g.fillRect(0, 0, w / 2, h); g.globalAlpha = 1;
    noise(g, w, h, 6000, [shade(0.85), shade(1.15), shade(0.95), shade(1.05)], [1, 2]);
  });
}

const BOARD_WORDS = ['VOLLGAS', 'BOX BOX', 'GP 2026', 'PIT LANE', 'PUSH PUSH', 'TURBO', 'LIGHTS OUT', 'P1', 'APEX', 'OVERTAKE'];
const BOARD_COLORS = [['#e10600', '#fff'], ['#0b1f4a', '#ffd23f'], ['#111', '#fff'], ['#1c8f4a', '#fff'], ['#ffd23f', '#111'], ['#f2f2f2', '#c8102e'], ['#5b2bd9', '#fff'], ['#ff8000', '#111']];
const boardTex = () => canvasTex(2048, 128, (g, w, h) => {
  const pw = w / 8;
  for (let i = 0; i < 8; i++) {
    const [bg, fg] = BOARD_COLORS[i];
    g.fillStyle = bg; g.fillRect(i * pw, 0, pw, h);
    g.fillStyle = fg; g.font = 'italic 800 64px "Saira Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(BOARD_WORDS[(i * 3) % BOARD_WORDS.length], i * pw + pw / 2, h / 2 + 4);
  }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h - 10, w, 10); g.fillRect(0, 0, w, 6);
});

const checkerTex = () => canvasTex(128, 32, (g, w, h) => {
  const s = 16;
  for (let x = 0; x < w / s; x++) for (let y = 0; y < h / s; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * s, y * s, s, s); }
});

const crowdTex = () => canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#2a2f36'; g.fillRect(0, 0, w, h);
  const cols = ['#e10600', '#ff8000', '#ffd23f', '#f4f4f4', '#27f4d2', '#3671c6', '#229971', '#ff87bc', '#c9a43b', '#111', '#64c4ff'];
  for (let row = 0; row < 16; row++) for (let i = 0; i < 70; i++) {
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.fillRect(i * 7.3 + Math.random() * 2, row * 16 + 3 + Math.random() * 3, 5, 8);
    g.fillStyle = '#e2b48c'; g.fillRect(i * 7.3 + 1 + Math.random() * 2, row * 16 + Math.random() * 2, 3, 3);
  }
});

const windowTex = () => canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = '#e8e2d6'; g.fillRect(0, 0, w, h);
  for (let y = 8; y < h; y += 22) for (let x = 8; x < w; x += 20) {
    g.fillStyle = Math.random() < 0.3 ? '#9fb7c9' : '#5a7183'; g.fillRect(x, y, 12, 14);
  }
});

// ---------- Themen ----------
export const THEMES = {
  day:   { top: '#2f6fc4', hor: '#d4e6f3', sun: '#fff1d6', sunI: 2.7, hemiS: '#d6e9ff', hemiG: '#6b7a48', hemiI: 0.95, dir: [0.45, 0.8, 0.35], exp: 1.0 },
  cloud: { top: '#6f7d8b', hor: '#cfd6dc', sun: '#f3f1ea', sunI: 1.5, hemiS: '#e2e8ee', hemiG: '#5d6650', hemiI: 1.35, dir: [0.3, 0.9, 0.2], exp: 1.0 },
  night: { top: '#03050d', hor: '#2b2350', sun: '#eef2ff', sunI: 1.7, hemiS: '#7f8fc8', hemiG: '#24222e', hemiI: 0.75, dir: [0.15, 1, 0.1], exp: 1.05 },
};
const GROUND = { park: '#4d7c33', forest: '#3e6a2b', alps: '#4f7e36', city: '#8a877f', urban: '#5b7b3a', desert: '#d6b47c', dunes: '#a9a46a' };
const TEAM_STRIPES = ['#FF8000', '#D10A0A', '#1B2A55', '#27F4D2', '#00594F', '#0A5BC0', '#1868DB', '#1634CB', '#DA291C', '#9EA3A7', '#C9A43B'];

// Gelände für Strecken mit Höhenprofil: weiche Hügel, die der Fahrbahn folgen
function buildTerrain(T, tex) {
  const b = T.bbox, M = 460, C = 20, R = 270;
  const x0 = b.minX - M, x1 = b.maxX + M, z0 = b.minZ - M, z1 = b.maxZ + M;
  const nx = Math.ceil((x1 - x0) / C) + 1, nz = Math.ceil((z1 - z0) / C) + 1;
  const sw = new Float32Array(nx * nz), sh = new Float32Array(nx * nz), dmin = new Float32Array(nx * nz).fill(1e12);
  const r = Math.ceil(R / C);
  for (let i = 0; i < T.N; i += 2) {
    if (T.bridge[i]) continue;
    const cx = Math.round((T.X[i] - x0) / C), cz = Math.round((T.Z[i] - z0) / C);
    for (let gx = Math.max(0, cx - r); gx <= Math.min(nx - 1, cx + r); gx++) for (let gz = Math.max(0, cz - r); gz <= Math.min(nz - 1, cz + r); gz++) {
      const dx = x0 + gx * C - T.X[i], dz = z0 + gz * C - T.Z[i], d2 = dx * dx + dz * dz;
      if (d2 > R * R) continue;
      const k = gz * nx + gx, w = 1 / (d2 + 900);
      sw[k] += w; sh[k] += w * T.Y[i]; if (d2 < dmin[k]) dmin[k] = d2;
    }
  }
  const field = new Float32Array(nx * nz);
  for (let k = 0; k < field.length; k++) {
    if (!sw[k]) continue;
    const d = Math.sqrt(dmin[k]), f = d < 120 ? 1 : d > R ? 0 : 1 - (d - 120) / (R - 120);
    field[k] = (sh[k] / sw[k]) * f * f * (3 - 2 * f);
  }
  const at = (x, z) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - x0) / C)), fz = Math.max(0, Math.min(nz - 1.001, (z - z0) / C));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, k = iz * nx + ix;
    return (field[k] * (1 - tx) + field[k + 1] * tx) * (1 - tz) + (field[k + nx] * (1 - tx) + field[k + nx + 1] * tx) * tz;
  };
  T.groundAt = at;
  const sx = Math.min(320, Math.ceil((x1 - x0) / 9)), sz = Math.min(320, Math.ceil((z1 - z0) / 9));
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, sx, sz);
  g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    let y = at(x, z);
    // direkt an der Strecke knapp unter der Fahrbahn bleiben
    let bi = -1, bd = (T.hw + 34) ** 2;
    T.grid.near(x, z, T.hw + 34, (i, d2) => { if (d2 < bd && !T.bridge[i]) { bd = d2; bi = i; } });
    if (bi >= 0) {
      const d = Math.sqrt(bd), lim = Math.max(T.wall[0][bi], T.wall[1][bi]);
      const t = d <= lim + 2 ? 1 : Math.max(0, 1 - (d - lim - 2) / 22);
      y = y + (T.Y[bi] - 0.35 - y) * t;
    }
    pos.setY(k, y);
    uv.setXY(k, x / 40, z / 40);
  }
  g.computeVertexNormals();
  tex.repeat.set(1, 1);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  m.receiveShadow = true;
  return m;
}

// ---------- Meshes ----------
function ribbon(T, from, to, mat, opts = {}) {
  // from/to: Seitenversatz (Funktion i → d), optional nur wo mask(i) gilt
  const { y = 0.02, vScale = 20, mask = null, yIn = y, yOut = y, uFlip = false } = opts;
  const pos = [], uv = [], idx = [];
  const N = T.N;
  for (let i = 0; i <= N; i++) {
    const j = i % N, a = from(j), b = to(j);
    pos.push(T.X[j] + T.NX[j] * a, yIn + T.h(j, a), T.Z[j] + T.NZ[j] * a, T.X[j] + T.NX[j] * b, yOut + T.h(j, b), T.Z[j] + T.NZ[j] * b);
    const v = (i * T.ds) / vScale;
    uv.push(uFlip ? 1 : 0, v, uFlip ? 0 : 1, v);
  }
  for (let i = 0; i < N; i++) {
    if (mask && !mask(i)) continue;
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // Normalen nach oben zwingen (Reihenfolge der Seiten kann wechseln)
  const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}

function wallMesh(T, side, mat, h = 1.1) {
  const sg = side ? 1 : -1, pos = [], uv = [], idx = [];
  let u = 0;
  for (let i = 0; i <= T.N; i++) {
    const j = i % T.N, w = T.wall[side][j] * sg;
    const x = T.X[j] + T.NX[j] * w, z = T.Z[j] + T.NZ[j] * w;
    if (i) { const k = (i - 1) % T.N, wp = T.wall[side][k] * sg; u += Math.hypot(x - (T.X[k] + T.NX[k] * wp), z - (T.Z[k] + T.NZ[k] * wp)) / 34; }
    const y0 = T.h(j, w);
    pos.push(x, y0 - 0.3, z, x, y0 + h, z); uv.push(u, 0, u, 1);
  }
  for (let i = 0; i < T.N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = false; m.receiveShadow = true;
  return m;
}

function makeSky(theme) {
  const g = new THREE.SphereGeometry(4000, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(theme.top) }, hor: { value: new THREE.Color(theme.hor) }, sunDir: { value: new THREE.Vector3(...theme.dir).normalize() }, sunCol: { value: new THREE.Color(theme.sun) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vP;
      void main(){ float h = max(vP.y, 0.0); vec3 c = mix(hor, top, pow(h, 0.55));
        float s = max(dot(vP, sunDir), 0.0); c += sunCol * (pow(s, 400.0) * 1.5 + pow(s, 12.0) * 0.18);
        if (vP.y < 0.0) c = hor * 0.92; gl_FragColor = vec4(c, 1.0); }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = -10; mesh.frustumCulled = false;
  return mesh;
}

function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function buildTrackScene(T, scene) {
  const def = T.def, theme = THEMES[def.theme] || THEMES.day;
  const root = new THREE.Group(); scene.add(root);
  const R = rand(def.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const hw = T.hw, N = T.N;
  const night = def.theme === 'night';

  // Himmel, Licht, Nebel
  root.add(makeSky(theme));
  scene.fog = new THREE.Fog(theme.hor, 350, 2600);
  const hemi = new THREE.HemisphereLight(theme.hemiS, theme.hemiG, theme.hemiI); root.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun, theme.sunI);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 500;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  root.add(sun); root.add(sun.target);
  const sunDir = new THREE.Vector3(...theme.dir).normalize();

  // Boden
  const b = T.bbox, cxm = (b.minX + b.maxX) / 2, czm = (b.minZ + b.maxZ) / 2;
  const groundCol = GROUND[def.scenery] || GROUND.park;
  const gTex = def.scenery === 'city' ? canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#8b8880'; g.fillRect(0, 0, w, h); noise(g, w, h, 5000, ['#7f7c75', '#97948c', '#85827a'], [1, 3]); g.strokeStyle = '#77746d'; g.lineWidth = 3; g.strokeRect(0, 0, w, h); }) : grassTex(groundCol);
  gTex.repeat.set(200, 200);
  if (def.scenery === 'city') {
    // Monaco: Land rund um die Strecke, außen das Meer
    const land = new THREE.Mesh(new THREE.PlaneGeometry(b.maxX - b.minX + 260, b.maxZ - b.minZ + 260, 48, 48), new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.95 }));
    gTex.repeat.set((b.maxX - b.minX + 260) / 20, (b.maxZ - b.minZ + 260) / 20);
    land.rotation.x = -Math.PI / 2; land.position.set(cxm, -0.12, czm); land.receiveShadow = true; root.add(land);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 30, 30), new THREE.MeshStandardMaterial({ color: '#1b5f8a', roughness: 0.15, metalness: 0.4 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(cxm, -0.6, czm); root.add(sea);
  } else {
    let gx = cxm;
    if (def.scenery === 'dunes') {
      // Zandvoort: Nordsee im Westen
      gx = b.minX - 260 + 4000;
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000, 30, 30), new THREE.MeshStandardMaterial({ color: '#2f6b86', roughness: 0.2, metalness: 0.35 }));
      sea.rotation.x = -Math.PI / 2; sea.position.set(b.minX - 260 - 4000, -0.5, czm); root.add(sea);
    }
    // fein unterteilt: riesige Dreiecke führen sonst zu Tiefenfehlern (Gras über der Fahrbahn)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000, 80, 80), new THREE.MeshStandardMaterial({ map: gTex, roughness: 1 }));
    gTex.repeat.set(8000 / 40, 8000 / 40);
    ground.rotation.x = -Math.PI / 2; ground.position.set(gx, T.hasElev ? -0.6 : -0.12, czm); ground.receiveShadow = true; root.add(ground);
    if (T.hasElev) root.add(buildTerrain(T, grassTex(groundCol)));
  }
  const groundAt = T.groundAt || (() => 0);

  // Asphalt-Auslaufzone unter den Mauern (schmaler Streifen hinter dem Randstein)
  const runoffMat = new THREE.MeshStandardMaterial({ color: night ? '#3a3d44' : '#55595e', roughness: 0.95 });
  if (def.scenery === 'city' || def.runoff < 6) {
    root.add(ribbon(T, i => -T.wall[0][i] - 0.2, i => -hw, runoffMat, { y: 0.012 }));
    root.add(ribbon(T, i => hw, i => T.wall[1][i] + 0.2, runoffMat, { y: 0.012 }));
  }

  // Erhöhte Abschnitte ohne Gelände: Asphalt bis zur Mauer, Böschung und Brückendeck
  if (!T.hasElev) {
    const raised = i => Math.max(T.h(i, -T.wall[0][i]), T.h(i, T.wall[1][i]), T.Y[i]) > 0.12;
    const rm = i => raised(i) || raised((i + 1) % N);
    root.add(ribbon(T, i => -T.wall[0][i] - 0.2, i => -hw, runoffMat, { y: 0.012, mask: rm }));
    root.add(ribbon(T, i => hw, i => T.wall[1][i] + 0.2, runoffMat, { y: 0.012, mask: rm }));
    const concrete = new THREE.MeshStandardMaterial({ color: '#a9a69c', roughness: 0.9, side: THREE.DoubleSide });
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1, pos = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const j = i % N, w = (T.wall[side][j] + 0.2) * sg, top = T.h(j, w);
        const deck = T.opening[j] ? top - 1.1 : -0.2;
        pos.push(T.X[j] + T.NX[j] * w, top, T.Z[j] + T.NZ[j] * w, T.X[j] + T.NX[j] * w, Math.min(deck, top), T.Z[j] + T.NZ[j] * w);
      }
      for (let i = 0; i < N; i++) if (rm(i)) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, concrete); m.receiveShadow = true; root.add(m);
    }
    // Unterseite der Brücke
    const under = ribbon(T, i => -T.wall[0][i] - 0.2, i => T.wall[1][i] + 0.2, concrete, { y: -1.1, mask: i => T.opening[i] && T.opening[(i + 1) % N] });
    root.add(under);
  }

  // Fahrbahn
  const aTex = asphaltTex();
  const road = ribbon(T, () => -hw, () => hw, new THREE.MeshStandardMaterial({ map: aTex, roughness: 0.9, metalness: 0 }), { y: 0.03, vScale: 20 });
  root.add(road);

  // Randsteine
  const kTex = kerbTex();
  const kMat = new THREE.MeshStandardMaterial({ map: kTex, roughness: 0.7 });
  const kmask = i => T.kerb[i] && T.kerb[(i + 1) % N];
  root.add(ribbon(T, () => -hw - 1.5, () => -hw + 0.05, kMat, { y: 0.035, vScale: 2.4, mask: kmask, yIn: 0.07 }));
  root.add(ribbon(T, () => hw - 0.05, () => hw + 1.5, kMat, { y: 0.035, vScale: 2.4, mask: kmask, yOut: 0.07 }));

  // Kiesbetten
  if (def.scenery !== 'city') {
    const gMat = new THREE.MeshStandardMaterial({ map: gravelTex(), roughness: 1 });
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      const m = i => T.gravel[side][i] && T.gravel[side][(i + 1) % N];
      const inner = i => sg * (hw + 1.5), outer = i => sg * Math.min(T.wall[side][i] - 0.5, hw + 12);
      root.add(ribbon(T, side ? inner : outer, side ? outer : inner, gMat, { y: 0.02, vScale: 12, mask: m }));
    }
  }

  // Werbebanden / Mauern
  const wTex = boardTex();
  const wMat = new THREE.MeshStandardMaterial({ map: wTex, roughness: 0.6, side: THREE.DoubleSide, emissive: night ? '#ffffff' : '#000000', emissiveMap: night ? wTex : null, emissiveIntensity: night ? 0.35 : 0 });
  root.add(wallMesh(T, 0, wMat)); root.add(wallMesh(T, 1, wMat));

  // Start/Ziel-Linie und Startaufstellung
  const st = pointAt(T, 0);
  const lineGeo = new THREE.PlaneGeometry(def.width, 2.2);
  const lineMesh = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ map: checkerTex(), roughness: 0.8 }));
  lineMesh.material.map.repeat.set(def.width / 2.2 / 2, 1);
  lineMesh.rotation.x = -Math.PI / 2; lineMesh.rotation.z = Math.atan2(st.tx, st.tz) + Math.PI / 2;
  lineMesh.position.set(st.x, st.y + 0.04, st.z); lineMesh.receiveShadow = true; root.add(lineMesh);
  const slotMat = new THREE.MeshBasicMaterial({ color: '#f2f2f2' });
  for (let k = 0; k < 22; k++) {
    const g = gridSlot(T, k);
    const p = pointAt(T, g.s + 2.6, g.d);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.25), slotMat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(p.tx, p.tz) + Math.PI / 2;
    m.position.set(p.x, p.y + 0.045, p.z); root.add(m);
  }

  // Startampel-Brücke
  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.5, metalness: 0.6 });
  const span = def.width + 4;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.7, 0.8), steel); beam.position.y = 7; gantry.add(beam);
  for (const sx of [-span / 2, span / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.4, 0.6), steel); p.position.set(sx, 3.7, 0); p.castShadow = true; gantry.add(p); }
  const lamps = [];
  const lampOff = new THREE.MeshStandardMaterial({ color: '#2a0b0b', roughness: 0.4 });
  for (let i = 0; i < 5; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.5), new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.6 }));
    box.position.set((i - 2) * 1.25, 5.8, -0.45); gantry.add(box);
    const pair = [];
    for (const ly of [0.45, -0.25]) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), lampOff.clone());
      l.position.set((i - 2) * 1.25, 5.8 + ly, -0.71); l.rotation.y = Math.PI; gantry.add(l); pair.push(l);
    }
    lamps.push(pair);
  }
  gantry.position.set(st.x, st.y, st.z); gantry.rotation.y = Math.atan2(st.tx, st.tz);
  root.add(gantry);

  // Boxengebäude und Tribünen entlang der Start-Ziel-Geraden
  const clear = (x, z, r) => !T.grid.near(x, z, r, () => true);
  const pitSide = -T.poleSide; // Boxen auf der Außenseite der ersten Kurve
  const pitMat = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.7 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#2c3e50', roughness: 0.15, metalness: 0.8, emissive: night ? '#7fb2ff' : '#000', emissiveIntensity: night ? 0.4 : 0 });
  const crowdMat = new THREE.MeshStandardMaterial({ map: crowdTex(), roughness: 0.9 });
  const standMat = new THREE.MeshStandardMaterial({ color: '#c3c7cc', roughness: 0.8 });
  const garageMat = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.7, emissive: night ? '#334' : '#000' });
  let pitCount = 0;
  for (let s = -240; s <= 120; s += 24) {
    const pi = pointAt(T, s, 0); const idx = pi.i;
    const wsP = T.wall[pitSide > 0 ? 1 : 0][idx], wsS = T.wall[pitSide > 0 ? 0 : 1][idx];
    const ang = Math.atan2(pi.tx, pi.tz);
    let p = pointAt(T, s, pitSide * (wsP + 9));
    if (clear(p.x, p.z, hw + 9)) {
      const g = new THREE.Group();
      const bld = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 24.5), pitMat); bld.position.y = 3.5; bld.castShadow = true; bld.receiveShadow = true; g.add(bld);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(12.2, 2.2, 24.6), glassMat); gl.position.y = 5.2; g.add(gl);
      const gar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.8, 22), garageMat); gar.position.set(pitSide * 6.02, 1.9, 0); g.add(gar);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 22), new THREE.MeshStandardMaterial({ color: TEAM_STRIPES[(pitCount++) % TEAM_STRIPES.length], emissive: night ? '#222' : '#000' }));
      stripe.position.set(pitSide * 6.03, 4.1, 0); g.add(stripe);
      g.position.set(p.x, p.y, p.z); g.rotation.y = ang; root.add(g);
    }
    p = pointAt(T, s, -pitSide * (wsS + 8));
    if (clear(p.x, p.z, hw + 8)) {
      const g = new THREE.Group();
      for (let r = 0; r < 5; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2 + r * 1.2, 24), r === 4 ? standMat : crowdMat);
        step.position.set(pitSide * r * 2.2, (1.2 + r * 1.2) / 2, 0); g.add(step);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(13, 0.4, 24.5), standMat); roof.position.set(pitSide * 4.4, 9.5, 0); g.add(roof);
      g.position.set(p.x, p.y, p.z); g.rotation.y = ang; root.add(g);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    }
  }

  // Bäume, Häuser, Palmen, Berge
  const maxWall = i => Math.max(T.wall[0][i], T.wall[1][i]);
  const spots = (count, dmin, dmax, keep) => {
    const out = [];
    for (let tries = 0; tries < count * 8 && out.length < count; tries++) {
      const i = (R() * N) | 0, sg = R() < 0.5 ? -1 : 1;
      const dist = T.wall[sg > 0 ? 1 : 0][i] + dmin + R() * (dmax - dmin);
      const x = T.X[i] + T.NX[i] * dist * sg, z = T.Z[i] + T.NZ[i] * dist * sg;
      if (clear(x, z, hw + dmin + 2 + (keep || 0)) && T.grid.dist(x, z, 60) > maxWall(i) + dmin - hw) out.push({ x, z, a: Math.atan2(T.TX[i], T.TZ[i]) });
    }
    return out;
  };
  const sc2 = def.scenery;
  if (sc2 === 'park' || sc2 === 'forest' || sc2 === 'alps' || sc2 === 'urban') {
    const count = sc2 === 'forest' ? 1600 : sc2 === 'park' ? 700 : 900;
    const pts = spots(count, 8, sc2 === 'forest' ? 70 : 120);
    const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 3, 6); trunkG.translate(0, 1.5, 0);
    const crownG = sc2 === 'forest' || sc2 === 'alps' ? new THREE.ConeGeometry(2.6, 9, 7) : new THREE.IcosahedronGeometry(3.2, 0);
    crownG.translate(0, sc2 === 'forest' || sc2 === 'alps' ? 7 : 5.5, 0);
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#5a3d26', roughness: 1 }), pts.length);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), pts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3(), col = new THREE.Color();
    const greens = sc2 === 'forest' || sc2 === 'alps' ? ['#24502a', '#2d5e31', '#1f4626', '#356b38'] : ['#3c7a2f', '#4f8a35', '#2f6a2a', '#5d9440', '#6f8f2f'];
    pts.forEach((p, k) => {
      const s = 0.8 + R() * 0.7;
      q.setFromAxisAngle(v.set(0, 1, 0), R() * 6.28); sv.set(s, s * (0.85 + R() * 0.4), s);
      m4.compose(v.set(p.x, groundAt(p.x, p.z) - 0.2, p.z), q, sv); trunks.setMatrixAt(k, m4); crowns.setMatrixAt(k, m4);
      crowns.setColorAt(k, col.set(greens[(R() * greens.length) | 0]));
    });
    crowns.castShadow = true; trunks.castShadow = true;
    root.add(trunks, crowns);
  }
  if (sc2 === 'city' || sc2 === 'urban') {
    const pts = spots(sc2 === 'city' ? 420 : 160, sc2 === 'city' ? 4 : 40, sc2 === 'city' ? 70 : 220, 6);
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
    const wt = windowTex();
    const mat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.8 });
    const houses = new THREE.InstancedMesh(g, mat, pts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3(), col = new THREE.Color();
    const cols = ['#f3e3c3', '#f0c9a0', '#e8d7b5', '#f7efe1', '#d9a07a', '#f2d8a7', '#cfd8dc', '#efe0d0'];
    pts.forEach((p, k) => {
      q.setFromAxisAngle(v.set(0, 1, 0), p.a);
      sv.set(10 + R() * 14, (sc2 === 'city' ? 10 : 6) + R() * (sc2 === 'city' ? 34 : 24), 10 + R() * 16);
      m4.compose(v.set(p.x, groundAt(p.x, p.z) - 0.5, p.z), q, sv); houses.setMatrixAt(k, m4); houses.setColorAt(k, col.set(cols[(R() * cols.length) | 0]));
    });
    houses.castShadow = true; houses.receiveShadow = true;
    root.add(houses);
  }
  if (sc2 === 'city') {
    // Jachten im Hafen
    const hull = new THREE.BoxGeometry(5, 2, 18); hull.translate(0, 0.4, 0);
    const yachts = new THREE.InstancedMesh(hull, new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.4 }), 40);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < 40; k++) {
      const side = (R() * 4) | 0, t = R();
      const x = side < 2 ? b.minX - 140 + t * (b.maxX - b.minX + 280) : (side === 2 ? b.minX - 150 : b.maxX + 150);
      const z = side < 2 ? (side === 0 ? b.minZ - 150 : b.maxZ + 150) : b.minZ - 140 + t * (b.maxZ - b.minZ + 280);
      q.setFromAxisAngle(v.set(0, 1, 0), R() * 6.28); m4.compose(v.set(x + (R() - 0.5) * 30, -0.6, z + (R() - 0.5) * 30), q, sv); yachts.setMatrixAt(k, m4);
    }
    root.add(yachts);
  }
  if (sc2 === 'desert') {
    const pts = spots(260, 6, 90);
    const trunkG = new THREE.CylinderGeometry(0.22, 0.4, 8, 6); trunkG.translate(0, 4, 0);
    const leafG = new THREE.ConeGeometry(3.2, 1.6, 7, 1, true); leafG.rotateX(Math.PI); leafG.translate(0, 8.4, 0);
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 1 }), pts.length);
    const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ color: '#3f7a35', roughness: 0.9, side: THREE.DoubleSide, flatShading: true }), pts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3();
    pts.forEach((p, k) => { const s = 0.8 + R() * 0.5; q.setFromAxisAngle(v.set(0, 1, 0), R() * 6.28); sv.set(s, s, s); m4.compose(v.set(p.x, groundAt(p.x, p.z), p.z), q, sv); trunks.setMatrixAt(k, m4); leaves.setMatrixAt(k, m4); });
    root.add(trunks, leaves);
  }
  if (sc2 === 'dunes') {
    const pts = spots(900, 6, 120);
    const g = new THREE.IcosahedronGeometry(1, 0); g.scale(1.6, 0.7, 1.6);
    const bushes = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }), pts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3(), col = new THREE.Color();
    const cols = ['#8f9a4c', '#a6a85a', '#7d8a44', '#c2b47a', '#d8c993'];
    pts.forEach((p, k) => { const s = 0.6 + R() * 2.4; q.setFromAxisAngle(v.set(0, 1, 0), R() * 6.28); sv.set(s * (1 + R()), s, s * (1 + R())); m4.compose(v.set(p.x, 0, p.z), q, sv); bushes.setMatrixAt(k, m4); bushes.setColorAt(k, col.set(cols[(R() * cols.length) | 0])); });
    root.add(bushes);
  }
  const anim = [];
  // Suzuka: das Riesenrad am Freizeitpark
  if (def.id === 'jpn') {
    let pos = null;
    for (let s = 60; s < 900 && !pos; s += 40) for (const sg of [-1, 1]) {
      const p = pointAt(T, s, sg * (T.wall[sg > 0 ? 1 : 0][pointAt(T, s, 0).i] + 70));
      if (!pos && clear(p.x, p.z, 52)) pos = p;
    }
    if (pos) {
      const wheel = new THREE.Group(), rad = 28;
      const wm = new THREE.MeshStandardMaterial({ color: '#e8ecef', metalness: 0.5, roughness: 0.4 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.5, 6, 48), wm); wheel.add(rim);
      const rim2 = rim.clone(); rim2.position.z = 3; wheel.add(rim2);
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.3, rad * 2, 0.3), wm); sp.rotation.z = a; sp.position.z = 1.5; wheel.add(sp);
        const gon = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.4), new THREE.MeshStandardMaterial({ color: ['#e8202a', '#ffd23f', '#2bb3ff', '#25d46d'][k % 4], roughness: 0.6 }));
        gon.position.set(Math.cos(a) * rad, Math.sin(a) * rad, 1.5); wheel.add(gon);
      }
      const holder = new THREE.Group();
      holder.add(wheel); wheel.position.y = rad + 4;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, rad + 8, 0.8), wm);
        leg.position.set(sx * 8, (rad + 4) / 2, sz * 4 + 1.5); leg.rotation.z = -sx * 0.27; holder.add(leg);
      }
      holder.position.set(pos.x, 0, pos.z); holder.rotation.y = Math.atan2(pos.tx, pos.tz);
      holder.traverse(o => { if (o.isMesh) o.castShadow = true; });
      root.add(holder);
      anim.push(t => { wheel.rotation.z = t * 0.05; });
    }
  }
  // Yas Marina: Hotel mit leuchtender Gitterkuppel über der Strecke
  if (def.hotel) {
    const i = Math.round(def.hotel * N) % N, p = pointAt(T, i * T.ds, 0), ang = Math.atan2(p.tx, p.tz);
    const hg = new THREE.Group();
    const facade = new THREE.MeshStandardMaterial({ color: '#d8dde3', roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: '#1d2b3a', roughness: 0.1, metalness: 0.9, emissive: '#3b6ea8', emissiveIntensity: night ? 0.6 : 0.1 });
    const off = Math.max(T.wall[0][i], T.wall[1][i]) + 22;
    for (const sx of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(34, 30, 70), facade); tower.position.set(sx * off, 15, 0); hg.add(tower);
      const win = new THREE.Mesh(new THREE.BoxGeometry(34.4, 24, 66), glass); win.position.set(sx * off, 16, 0); hg.add(win);
    }
    const bridgeB = new THREE.Mesh(new THREE.BoxGeometry(off * 2 - 30, 7, 26), facade); bridgeB.position.set(0, 22, 0); hg.add(bridgeB);
    const bridgeW = new THREE.Mesh(new THREE.BoxGeometry(off * 2 - 30, 4.5, 26.4), glass); bridgeW.position.set(0, 22, 0); hg.add(bridgeW);
    const shellMat = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#7a3cff', emissiveIntensity: 1.6, wireframe: true, transparent: true, opacity: 0.85 });
    // nur die obere Kuppel (über Auto- und Kamerahöhe)
    const ico = new THREE.IcosahedronGeometry(1, 4).toNonIndexed(), ip = ico.attributes.position, keep = [];
    for (let k = 0; k < ip.count; k += 3) if (ip.getY(k) > 0.38 && ip.getY(k + 1) > 0.38 && ip.getY(k + 2) > 0.38) for (let q = 0; q < 3; q++) keep.push(ip.getX(k + q), ip.getY(k + q), ip.getZ(k + q));
    const dome = new THREE.BufferGeometry(); dome.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3)); dome.computeVertexNormals();
    const shell = new THREE.Mesh(dome, shellMat);
    shell.scale.set(off + 30, 40, 120); hg.add(shell);
    hg.position.set(p.x, p.y, p.z); hg.rotation.y = ang;
    root.add(hg);
    anim.push(t => { shellMat.emissive.setHSL((0.72 + 0.12 * Math.sin(t * 0.3)) % 1, 0.9, 0.5); });
  }
  // Flutlichtmasten bei Nacht
  if (night) {
    const cnt = Math.floor(N * T.ds / 60);
    const poleG = new THREE.BoxGeometry(0.4, 16, 0.4); poleG.translate(0, 8, 0);
    const headG = new THREE.BoxGeometry(2.4, 0.8, 1.2); headG.translate(0, 16.2, 0);
    const poles = new THREE.InstancedMesh(poleG, steel, cnt);
    const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff8e8', emissiveIntensity: 2.2 }), cnt);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < cnt; k++) {
      const i = Math.floor(k * N / cnt), side = k % 2, sg = side ? 1 : -1, w = T.wall[side][i] + 1.5;
      q.setFromAxisAngle(v.set(0, 1, 0), Math.atan2(T.TX[i], T.TZ[i]));
      m4.compose(v.set(T.X[i] + T.NX[i] * w * sg, T.h(i, w * sg), T.Z[i] + T.NZ[i] * w * sg), q, sv); poles.setMatrixAt(k, m4); heads.setMatrixAt(k, m4);
    }
    root.add(poles, heads);
  }
  // Berge am Horizont
  {
    const big = def.scenery === 'alps', cnt = big ? 26 : 18;
    const geo = new THREE.ConeGeometry(1, 1, 9, 4); geo.translate(0, 0.5, 0);
    const pos = geo.attributes.position, colors = [];
    const lowC = new THREE.Color(def.scenery === 'desert' ? '#c49a62' : '#3c5e33'), midC = new THREE.Color(def.scenery === 'desert' ? '#a87d4f' : '#6d7466'), topC = new THREE.Color(big ? '#f4f6f8' : (def.scenery === 'desert' ? '#d8b483' : '#5b6b55'));
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i); const c = y > 0.72 ? topC : (y > 0.35 ? midC : lowC);
      colors.push(c.r, c.g, c.b);
      if (y > 0.01 && y < 0.99) { pos.setX(i, pos.getX(i) * (0.85 + Math.random() * 0.3)); pos.setZ(i, pos.getZ(i) * (0.85 + Math.random() * 0.3)); }
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
    const mts = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), cnt);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sv = new THREE.Vector3();
    const rad = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    for (let k = 0; k < cnt; k++) {
      const a = (k / cnt) * Math.PI * 2 + R() * 0.2, dist = rad + (big ? 700 : 1100) + R() * 600;
      const hgt = big ? 380 + R() * 420 : 90 + R() * 160, wid = big ? 500 + R() * 400 : 500 + R() * 500;
      sv.set(wid, hgt, wid); q.identity();
      m4.compose(v.set(cxm + Math.cos(a) * dist, -2, czm + Math.sin(a) * dist), q, sv); mts.setMatrixAt(k, m4);
    }
    if (def.scenery !== 'city') root.add(mts);
  }

  return {
    root, sun, sunDir, lamps,
    update(t) { anim.forEach(f => f(t)); },
    setLamps(n, green = false) {
      lamps.forEach((pair, i) => pair.forEach(l => {
        const on = i < n;
        l.material.color.set(on ? (green ? '#3bff6a' : '#ff1a1a') : '#2a0b0b');
        l.material.emissive = new THREE.Color(on ? (green ? '#30ff60' : '#ff1010') : '#000');
        l.material.emissiveIntensity = on ? 2.5 : 0;
      }));
    },
    dispose() {
      scene.remove(root); scene.fog = null;
      root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
      });
    },
  };
}

// Startplatz k (0 = Pole): Abstand 8 m, abwechselnd links/rechts
export function gridSlot(T, k) {
  return { s: T.L - (12 + k * 8), d: (k % 2 === 0 ? T.poleSide : -T.poleSide) * Math.min(3.2, T.hw - 2) };
}
