import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, angleDiff, turnToward, rand, pick } from './util.js';
import { makeHumanoid, compile, sample, blendPose, DEF } from './models.js';
import { Sound } from './audio.js';
import { groundHeight, REGIONS } from './world.js';

const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const fwd = (y) => new THREE.Vector3(Math.sin(y), 0, Math.cos(y));

// ------------------------- Basis-Posen -------------------------
const IDLE = {
  hollow: { ...DEF, hx: -0.3, hy: 0.2, hz: 0.3, dx: 0.05, dy: 0.1, dz: 1, lfree: 1, lx: 0.3, ly: 0.1, lz: 0.12, lean: 0.05, twist: 0, crouch: 0.03 },
  knight: { ...DEF, hx: -0.2, hy: 0.38, hz: 0.38, dx: 0.1, dy: 0.7, dz: 0.8, lfree: 1, lx: 0.22, ly: 0.42, lz: 0.42, lean: 0.03, twist: 0.2, crouch: 0.04 },
  boss: { ...DEF, hx: -0.1, hy: 0.3, hz: 0.42, dx: 0.1, dy: 0.15, dz: 1, lg: -0.32, lean: 0.05, twist: 0.1, crouch: 0.06 },
};
IDLE.witch = { ...DEF, hx: -0.28, hy: 0.4, hz: 0.25, dx: 0.05, dy: 1, dz: 0.12, lfree: 1, lx: 0.3, ly: 0.25, lz: 0.15, lean: 0.04, twist: 0, crouch: 0.02 };
IDLE.giant = { ...DEF, hx: -0.35, hy: 0.55, hz: 0.05, dx: -0.15, dy: 0.9, dz: -0.35, lfree: 1, lx: 0.35, ly: 0.2, lz: 0.1, lean: 0.15, twist: 0.1, crouch: 0.05 };
IDLE.reaper = { ...DEF, hx: -0.18, hy: 0.32, hz: 0.38, dx: 0.1, dy: 0.85, dz: 0.5, lg: -0.3, lean: 0.08, twist: 0.15, crouch: 0.1 };
IDLE.shade = { ...IDLE.hollow, lean: 0.12 };
const REACT = { // Torso-Reaktionen
  stagger: (b) => compile([{ t: 0 }, { t: 0.12, lean: -0.5, shift: -0.2, hx: b.hx - 0.1, hy: b.hy + 0.2, head: 0.4, e: 2 }, { t: 0.55, ...b, e: 0 }], b),
  // Benommen (Parry / Ansturm gegen die Wand): taumelt, sinkt auf die Knie und bleibt gebeugt hocken (wie Elden Ring), steht am Ende wieder auf
  parried: (b, dur = 2.6) => {
    const KN = { lean: 0.4, shift: 0.1, crouch: 0.45, kneel: 1, head: 0.55, twist: -0.2, hx: -0.05, hy: -0.05, hz: 0.35, dx: 0, dy: -0.7, dz: 0.75, lg: -0.2, lfree: 1, lx: 0.25, ly: -0.1, lz: 0.3, glow: 0 };
    return compile([{ t: 0 }, { t: 0.18, lean: -0.5, shift: -0.25, hx: -0.3, hy: 0.85, hz: 0.1, dx: -0.4, dy: 0.8, dz: -0.4, twist: -0.6, head: 0.5, lfree: 0, e: 2 },
      { t: 0.62, ...KN, e: 2 }, { t: Math.max(1, dur - 0.55), ...KN, lean: 0.46, e: 3 }, { t: dur, ...b, e: 0 }], b);
  },
  dead: (b) => compile([{ t: 0 }, { t: 0.4, lean: -0.3, bpitch: -0.5, crouch: 0.3, hx: -0.3, hy: 0.5, e: 2 }, { t: 1.2, lean: 0, bpitch: -Math.PI / 2, crouch: 0.77, tuck: 0.2, hx: -0.5, hy: 0.3, dx: 0.5, dz: 0.3, e: 1 }], b),
};

const A = (base, frames) => compile(frames, base);
const ATTACKS = {
  hSlash: { name: 'Hieb', dur: 1.3, hs: 0.66, he: 0.8, range: 2.5, arc: 120, dmg: 48, parryable: true, track: 0.45, lunge: [0.6, 0.78, 4.2],
    f: A(IDLE.hollow, [{ t: 0 }, { t: 0.55, hx: -0.35, hy: 1.0, hz: 0.0, dx: -0.2, dy: 0.9, dz: -0.35, twist: -0.5, lean: -0.2, lfree: 1, lx: 0.2, ly: 0.8, lz: 0.1, e: 2 }, { t: 0.72, hx: 0.1, hy: 0.3, hz: 0.55, dx: 0.3, dy: -0.2, dz: 1, twist: 0.5, lean: 0.4, shift: 0.2, e: 1 }, { t: 0.95, e: 2 }, { t: 1.3, ...IDLE.hollow, e: 0 }]) },
  hSwipe: { name: 'Schwung', dur: 1.2, hs: 0.58, he: 0.72, range: 2.7, arc: 160, dmg: 42, parryable: true, track: 0.4, lunge: [0.5, 0.7, 3.2],
    f: A(IDLE.hollow, [{ t: 0 }, { t: 0.46, hx: 0.3, hy: 0.6, hz: 0.2, dx: 0.9, dy: 0, dz: 0.1, twist: 0.7, e: 2 }, { t: 0.64, hx: -0.3, hy: 0.55, hz: 0.55, dx: -0.9, dy: 0, dz: 0.4, twist: -0.8, shift: 0.15, e: 1 }, { t: 0.8, e: 3 }, { t: 1.2, ...IDLE.hollow, e: 0 }]) },
  kSlash: { name: 'Hieb', dur: 1.55, hs: 0.8, he: 0.95, range: 2.9, arc: 120, dmg: 72, parryable: true, track: 0.55, lunge: [0.7, 0.9, 3.6],
    f: A(IDLE.knight, [{ t: 0 }, { t: 0.65, hx: -0.3, hy: 1.0, hz: 0.0, dx: -0.1, dy: 0.95, dz: -0.3, twist: -0.5, lean: -0.25, lfree: 1, lx: 0.3, ly: 0.5, lz: 0.4, e: 2 }, { t: 0.86, hx: 0.0, hy: 0.3, hz: 0.55, dx: 0.15, dy: -0.15, dz: 1, twist: 0.45, lean: 0.4, shift: 0.22, e: 1 }, { t: 1.1, e: 2 }, { t: 1.55, ...IDLE.knight, e: 0 }]) },
  kThrust: { name: 'Stoss', dur: 1.6, hs: 0.86, he: 0.98, range: 3.5, arc: 50, dmg: 78, parryable: true, track: 0.7, lunge: [0.7, 0.96, 7.5],
    f: A(IDLE.knight, [{ t: 0 }, { t: 0.7, hx: -0.25, hy: 0.55, hz: -0.05, dx: 0.05, dy: 0.1, dz: 1, twist: -0.6, lean: -0.1, shift: -0.15, e: 2 }, { t: 0.9, hx: -0.06, hy: 0.55, hz: 0.62, dx: 0, dy: 0.04, dz: 1, twist: 0.3, lean: 0.3, shift: 0.4, e: 1 }, { t: 1.1, e: 3 }, { t: 1.6, ...IDLE.knight, e: 0 }]) },
  bSweep: { name: 'Rundumschlag', dur: 2.1, hs: 1.0, he: 1.2, range: 5.3, arc: 170, dmg: 125, parryable: true, track: 0.7, lunge: [0.9, 1.15, 3],
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.85, hx: 0.3, hy: 0.7, hz: 0.0, dx: 1, dy: 0.1, dz: -0.3, lg: -0.32, twist: 0.95, crouch: 0.12, e: 2 }, { t: 1.1, hx: -0.3, hy: 0.55, hz: 0.5, dx: -1, dy: 0.05, dz: 0.5, twist: -1.0, shift: 0.3, crouch: 0.1, e: 1 }, { t: 1.35, e: 2 }, { t: 2.1, ...IDLE.boss, e: 0 }]) },
  bSlam: { name: 'Zerschmettern', dur: 2.7, hs: 1.4, he: 1.52, range: 5.6, arc: 110, dmg: 175, parryable: false, danger: true, track: 0.9, slam: true,
    f: A(IDLE.boss, [{ t: 0 }, { t: 1.15, hx: 0.0, hy: 0.95, hz: 0.0, dx: 0, dy: 1, dz: -0.3, lean: -0.4, glow: 1, e: 2 }, { t: 1.38, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.6, dz: 1, lean: 0.5, shift: 0.3, crouch: 0.15, e: 1 }, { t: 1.8, e: 3 }, { t: 2.7, ...IDLE.boss, e: 0 }]) },
  bThrust: { name: 'Sturmstoss', dur: 1.9, hs: 0.98, he: 1.1, range: 4.2, arc: 60, dmg: 140, parryable: true, track: 0.7, lunge: [0.85, 1.08, 13],
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.8, hx: -0.2, hy: 0.5, hz: -0.05, dx: 0, dy: 0.05, dz: 1, twist: -0.6, shift: -0.1, e: 2 }, { t: 1.0, hx: -0.05, hy: 0.55, hz: 0.62, dx: 0, dy: 0, dz: 1, shift: 0.4, lean: 0.3, e: 1 }, { t: 1.3, e: 3 }, { t: 1.9, ...IDLE.boss, e: 0 }]) },
  bLeap: { name: 'Sprung', dur: 2.6, hs: 1.5, he: 1.56, range: 5.8, arc: 360, dmg: 165, parryable: false, danger: true, track: 0.85, leap: true,
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.8, crouch: 0.45, hx: 0, hy: 0.4, hz: 0.1, dx: 0, dy: 1, dz: 0, lean: 0.3, glow: 1, e: 2 }, { t: 1.2, crouch: -0.1, hx: 0, hy: 1.0, hz: 0.05, dx: 0, dy: 1, dz: -0.2, lean: -0.3, e: 1 }, { t: 1.5, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.7, dz: 1, lean: 0.5, crouch: 0.2, e: 1 }, { t: 1.9, e: 3 }, { t: 2.6, ...IDLE.boss, e: 0 }]) },

  // ===== Morwen, die Hexe: Fernkampf, Beschwoerung, Teleport =====
  wFire: { name: 'Feuersalve', dur: 1.8, hs: 99, he: 99, track: 1.0, ev: [[0.95, 'fireball']],
    f: A(IDLE.witch, [{ t: 0 }, { t: 0.7, hx: -0.1, hy: 0.95, hz: 0.15, dx: 0, dy: 1, dz: 0.3, lean: -0.25, lfree: 1, lx: 0.2, ly: 0.9, lz: 0.2, glow: 1, e: 2 }, { t: 0.95, hx: -0.1, hy: 0.6, hz: 0.55, dx: 0, dy: 0.25, dz: 1, lean: 0.25, shift: 0.2, e: 1 }, { t: 1.2, e: 3 }, { t: 1.8, ...IDLE.witch, e: 0 }]) },
  wOrb: { name: 'Seelenorb', dur: 2.3, hs: 99, he: 99, track: 1.2, ev: [[1.15, 'orb']],
    f: A(IDLE.witch, [{ t: 0 }, { t: 0.9, hx: -0.1, hy: 1.0, hz: 0.1, dx: 0, dy: 1, dz: 0.2, lean: -0.3, lfree: 1, lx: 0.1, ly: 1.0, lz: 0.2, glow: 1, e: 2 }, { t: 1.15, hx: -0.1, hy: 0.7, hz: 0.5, dx: 0, dy: 0.5, dz: 1, lean: 0.2, e: 1 }, { t: 1.5, e: 3 }, { t: 2.3, ...IDLE.witch, e: 0 }]) },
  wPools: { name: 'Flammenfeld', dur: 2.4, hs: 99, he: 99, track: 0.8, ev: [[0.8, 'pools']],
    f: A(IDLE.witch, [{ t: 0 }, { t: 0.65, hx: -0.1, hy: 0.95, hz: 0.1, dx: 0, dy: 1, dz: 0, lean: -0.3, glow: 1, e: 2 }, { t: 0.85, hx: -0.1, hy: 0.3, hz: 0.55, dx: 0, dy: -0.4, dz: 1, lean: 0.4, crouch: 0.12, e: 1 }, { t: 1.4, e: 3 }, { t: 2.4, ...IDLE.witch, e: 0 }]) },
  wSummon: { name: 'Beschwörung', dur: 3.0, hs: 99, he: 99, track: 1.0, ev: [[1.4, 'summon']],
    f: A(IDLE.witch, [{ t: 0 }, { t: 1.2, hx: -0.05, hy: 1.05, hz: 0.1, dx: 0, dy: 1, dz: 0, lean: -0.4, lfree: 1, lx: 0.3, ly: 1.0, lz: 0.1, glow: 1, e: 2 }, { t: 1.8, e: 3 }, { t: 3.0, ...IDLE.witch, e: 0 }]) },
  wBurst: { name: 'Aschenwelle', dur: 2.1, hs: 99, he: 99, track: 0.4, ev: [[0.15, 'burst']],
    f: A(IDLE.witch, [{ t: 0 }, { t: 0.7, hx: -0.1, hy: 1.0, hz: 0.1, dx: 0, dy: 1, dz: 0, lean: -0.35, glow: 1, e: 2 }, { t: 0.98, hx: -0.1, hy: 0.25, hz: 0.5, dx: 0, dy: -0.5, dz: 1, lean: 0.5, crouch: 0.15, e: 1 }, { t: 1.4, e: 3 }, { t: 2.1, ...IDLE.witch, e: 0 }]) },
  wBlink: { name: 'Schattenschritt', dur: 2.6, hs: 1.5, he: 1.65, range: 3.4, arc: 110, dmg: 95, parryable: true, track: 1.4, ev: [[0.25, 'vanish'], [1.0, 'appearBehind']],
    f: A(IDLE.witch, [{ t: 0 }, { t: 0.9, hx: -0.1, hy: 0.9, hz: 0.1, dx: 0, dy: 1, dz: 0, lean: -0.2, e: 2 }, { t: 1.28, hx: -0.15, hy: 0.85, hz: 0.1, dx: 0.1, dy: 1, dz: -0.2, twist: -0.6, lean: -0.2, e: 3 }, { t: 1.52, hx: -0.05, hy: 0.55, hz: 0.55, dx: 0.1, dy: 0.2, dz: 1, twist: 0.4, lean: 0.4, shift: 0.3, e: 1 }, { t: 1.9, e: 3 }, { t: 2.6, ...IDLE.witch, e: 0 }]) },
  wBlinkAway: { name: 'Fortteleport', dur: 1.7, hs: 99, he: 99, track: 0, ev: [[0.2, 'vanish'], [0.95, 'blinkFar']],
    f: A(IDLE.witch, [{ t: 0 }, { t: 1.7, ...IDLE.witch }]) },

  // ===== Gorm, der Grabriese: Wucht, Ansturm, Schockwellen =====
  gSwat: { name: 'Hieb', dur: 2.5, hs: 1.2, he: 1.42, range: 7.4, arc: 180, dmg: 145, parryable: true, track: 0.9, lunge: [1.1, 1.38, 3.5],
    f: A(IDLE.giant, [{ t: 0 }, { t: 1.0, hx: 0.3, hy: 0.7, hz: 0.0, dx: 1, dy: 0.2, dz: -0.4, twist: 1.0, lean: -0.1, crouch: 0.1, e: 2 }, { t: 1.3, hx: -0.35, hy: 0.55, hz: 0.5, dx: -1, dy: 0.0, dz: 0.5, twist: -1.1, shift: 0.3, crouch: 0.1, e: 1 }, { t: 1.6, e: 2 }, { t: 2.5, ...IDLE.giant, e: 0 }]) },
  gSmash: { name: 'Zermalmen', dur: 3.2, hs: 1.75, he: 1.88, range: 7, arc: 110, dmg: 200, parryable: false, danger: true, track: 1.2, slam: true, slamDist: 5.6, slamR: 6,
    f: A(IDLE.giant, [{ t: 0 }, { t: 1.5, hx: -0.1, hy: 1.05, hz: 0.0, dx: 0, dy: 1, dz: -0.4, lean: -0.5, glow: 1, e: 2 }, { t: 1.72, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.5, dz: 1, lean: 0.6, shift: 0.3, crouch: 0.2, e: 1 }, { t: 2.2, e: 3 }, { t: 3.2, ...IDLE.giant, e: 0 }]) },
  gStomp: { name: 'Erdstoß', dur: 3.0, hs: 99, he: 99, track: 1.0, danger: true, ev: [[1.45, 'stompRing']],
    f: A(IDLE.giant, [{ t: 0 }, { t: 0.9, crouch: 0.5, lean: 0.35, hx: -0.2, hy: 0.3, hz: 0.3, e: 2 }, { t: 1.3, crouch: -0.1, lean: -0.45, hx: -0.1, hy: 1.0, hz: 0.1, dx: 0, dy: 1, dz: -0.2, glow: 1, e: 1 }, { t: 1.45, crouch: 0.4, lean: 0.55, hx: -0.1, hy: 0.3, hz: 0.5, dx: 0, dy: -0.6, dz: 1, e: 1 }, { t: 2.0, e: 3 }, { t: 3.0, ...IDLE.giant, e: 0 }]) },
  gCharge: { name: 'Ansturm', dur: 4.0, hs: 99, he: 99, track: 1.0, charge: true, dmg: 175, danger: true, lunge: [1.1, 3.0, 15],
    f: A(IDLE.giant, [{ t: 0 }, { t: 0.55, lean: -0.3, hx: -0.3, hy: 0.7, hz: -0.1, dx: -0.2, dy: 0.9, dz: -0.6, crouch: 0.2, e: 2 }, { t: 1.05, lean: 0.85, hx: -0.35, hy: 0.25, hz: -0.1, dx: 0, dy: 0.1, dz: -1, crouch: 0.35, glow: 1, e: 1 }, { t: 3.0, lean: 0.85, hx: -0.35, hy: 0.25, hz: -0.1, dx: 0, dy: 0.1, dz: -1, crouch: 0.35, e: 3 }, { t: 4.0, ...IDLE.giant, e: 0 }]) },
  gRock: { name: 'Felswurf', dur: 3.2, hs: 99, he: 99, track: 1.2, ev: [[1.55, 'rock']],
    f: A(IDLE.giant, [{ t: 0 }, { t: 0.9, crouch: 0.5, lean: 0.6, hx: 0, hy: 0.1, hz: 0.4, dx: 0, dy: 0.3, dz: 1, e: 2 }, { t: 1.4, crouch: 0, lean: -0.4, hx: 0, hy: 1.05, hz: 0.2, dx: 0, dy: 1, dz: 0.1, e: 2 }, { t: 1.55, lean: 0.5, hx: -0.1, hy: 0.5, hz: 0.7, dx: 0, dy: 0.2, dz: 1, e: 1 }, { t: 2.2, e: 3 }, { t: 3.2, ...IDLE.giant, e: 0 }]) },

  // ===== Vael, der Henker: Tempo, Verschwinden, Kombos =====
  rDash: { name: 'Schattenstoß', dur: 2.0, hs: 0.62, he: 0.92, range: 3.4, arc: 100, dmg: 100, parryable: true, track: 0.5, lunge: [0.55, 0.84, 24],
    f: A(IDLE.reaper, [{ t: 0 }, { t: 0.5, hx: -0.2, hy: 0.55, hz: -0.05, dx: 0.1, dy: 0.3, dz: 1, twist: -0.7, lean: 0.1, crouch: 0.25, e: 2 }, { t: 0.62, hx: -0.05, hy: 0.55, hz: 0.6, dx: 0, dy: 0.2, dz: 1, twist: 0.4, lean: 0.5, shift: 0.4, crouch: 0.2, e: 1 }, { t: 1.0, e: 3 }, { t: 2.0, ...IDLE.reaper, e: 0 }]) },
  rCombo: { name: 'Sensenwirbel', dur: 2.6, windows: [[0.5, 0.64], [1.02, 1.16], [1.6, 1.74]], parryW: [true, true, false], dmgW: [80, 80, 115], hs: 0.5, he: 1.74, range: 4.4, arc: 150, dmg: 80, track: 1.4, lunge: [0.4, 0.6, 5],
    f: A(IDLE.reaper, [{ t: 0 }, { t: 0.38, hx: -0.3, hy: 0.9, hz: 0.0, dx: -0.4, dy: 0.9, dz: -0.2, twist: -0.7, e: 2 }, { t: 0.55, hx: 0.15, hy: 0.3, hz: 0.55, dx: 0.7, dy: -0.1, dz: 0.7, twist: 0.8, lean: 0.25, shift: 0.2, e: 1 },
      { t: 0.9, hx: 0.3, hy: 0.7, hz: 0.1, dx: 1, dy: 0.1, dz: -0.1, twist: 0.9, e: 2 }, { t: 1.08, hx: -0.3, hy: 0.5, hz: 0.55, dx: -1, dy: -0.1, dz: 0.6, twist: -0.9, shift: 0.2, e: 1 },
      { t: 1.42, hx: -0.1, hy: 1.0, hz: 0.0, dx: 0, dy: 1, dz: -0.4, lean: -0.4, twist: 0, e: 2 }, { t: 1.62, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.4, dz: 1, lean: 0.55, shift: 0.35, crouch: 0.15, e: 1 }, { t: 2.0, e: 3 }, { t: 2.6, ...IDLE.reaper, e: 0 }]) },
  rSpin: { name: 'Todeswirbel', dur: 3.1, windows: [[1.0, 1.12], [1.38, 1.5], [1.76, 1.88]], hs: 1.0, he: 1.88, range: 4.9, arc: 360, dmg: 70, parryable: false, danger: true, track: 0.8,
    f: A(IDLE.reaper, [{ t: 0 }, { t: 0.8, hx: -0.25, hy: 0.55, hz: 0.35, dx: 1, dy: 0.0, dz: 0.2, crouch: 0.3, twist: 0, glow: 1, e: 2 }, { t: 1.0, hx: -0.25, hy: 0.55, hz: 0.35, dx: 1, dy: 0.0, dz: 0.2, crouch: 0.3, twist: 0, e: 3 }, { t: 1.9, hx: -0.25, hy: 0.55, hz: 0.35, dx: 1, dy: 0.0, dz: 0.2, crouch: 0.3, twist: -12.5, e: 3 }, { t: 2.3, twist: -12.5, crouch: 0.2, e: 2 }, { t: 3.1, ...IDLE.reaper, twist: IDLE.reaper.twist - 12.566, e: 0 }]) },
  rVanish: { name: 'Schattentanz', dur: 2.8, hs: 1.55, he: 1.7, range: 3.6, arc: 110, dmg: 115, parryable: true, track: 1.45, ev: [[0.15, 'vanish'], [1.2, 'appearBehind']],
    f: A(IDLE.reaper, [{ t: 0 }, { t: 1.2, hx: -0.2, hy: 0.55, hz: -0.05, dx: 0.1, dy: 0.3, dz: 1, twist: -0.7, crouch: 0.25, e: 2 }, { t: 1.55, hx: -0.05, hy: 0.55, hz: 0.6, dx: 0, dy: 0.2, dz: 1, twist: 0.4, lean: 0.5, shift: 0.4, crouch: 0.2, e: 1 }, { t: 1.9, e: 3 }, { t: 2.8, ...IDLE.reaper, e: 0 }]) },
  rShades: { name: 'Schattenbrut', dur: 2.7, hs: 99, he: 99, track: 1.0, ev: [[1.1, 'shades']],
    f: A(IDLE.reaper, [{ t: 0 }, { t: 1.0, hx: -0.1, hy: 1.0, hz: 0.1, dx: 0, dy: 1, dz: 0.1, lean: -0.3, glow: 1, e: 2 }, { t: 1.6, e: 3 }, { t: 2.7, ...IDLE.reaper, e: 0 }]) },
  // ===== Aldrar, der Aschenkoenig: Endboss, drei Phasen =====
  kSweep: { name: 'Königlicher Hieb', dur: 2.0, hs: 0.95, he: 1.15, range: 6.4, arc: 175, dmg: 135, parryable: true, track: 0.7, lunge: [0.85, 1.1, 3.4],
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.8, hx: 0.3, hy: 0.7, hz: 0.0, dx: 1, dy: 0.1, dz: -0.3, lg: -0.32, twist: 0.95, crouch: 0.12, e: 2 }, { t: 1.05, hx: -0.3, hy: 0.55, hz: 0.5, dx: -1, dy: 0.05, dz: 0.5, twist: -1.0, shift: 0.3, crouch: 0.1, e: 1 }, { t: 1.3, e: 2 }, { t: 2.0, ...IDLE.boss, e: 0 }]) },
  kSlam: { name: 'Zorn der Krone', dur: 2.7, hs: 1.4, he: 1.52, range: 6.4, arc: 110, dmg: 190, parryable: false, danger: true, track: 0.9, slam: true, slamDist: 5.4, slamR: 5.6,
    f: A(IDLE.boss, [{ t: 0 }, { t: 1.15, hx: 0.0, hy: 0.95, hz: 0.0, dx: 0, dy: 1, dz: -0.3, lean: -0.4, glow: 1, e: 2 }, { t: 1.38, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.6, dz: 1, lean: 0.5, shift: 0.3, crouch: 0.15, e: 1 }, { t: 1.8, e: 3 }, { t: 2.7, ...IDLE.boss, e: 0 }]) },
  kLunge: { name: 'Thronstoß', dur: 1.9, hs: 0.95, he: 1.1, range: 4.6, arc: 60, dmg: 150, parryable: true, track: 0.65, lunge: [0.82, 1.06, 15],
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.78, hx: -0.2, hy: 0.5, hz: -0.05, dx: 0, dy: 0.05, dz: 1, twist: -0.6, shift: -0.1, e: 2 }, { t: 0.98, hx: -0.05, hy: 0.55, hz: 0.62, dx: 0, dy: 0, dz: 1, shift: 0.4, lean: 0.3, e: 1 }, { t: 1.3, e: 3 }, { t: 1.9, ...IDLE.boss, e: 0 }]) },
  kCombo: { name: 'Dreifache Klinge', dur: 2.8, windows: [[0.62, 0.74], [1.12, 1.24], [1.85, 1.97]], parryW: [true, true, false], dmgW: [110, 115, 175], hs: 0.62, he: 1.97, range: 5.8, arc: 165, dmg: 110, track: 1.5, lunge: [0.5, 0.7, 4.5],
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.5, hx: -0.3, hy: 0.9, hz: 0.0, dx: -0.4, dy: 0.9, dz: -0.2, twist: -0.7, e: 2 }, { t: 0.68, hx: 0.15, hy: 0.3, hz: 0.55, dx: 0.7, dy: -0.1, dz: 0.7, twist: 0.8, lean: 0.25, shift: 0.2, e: 1 },
      { t: 1.02, hx: 0.3, hy: 0.7, hz: 0.1, dx: 1, dy: 0.1, dz: -0.1, twist: 0.9, e: 2 }, { t: 1.18, hx: -0.3, hy: 0.5, hz: 0.55, dx: -1, dy: -0.1, dz: 0.6, twist: -0.9, shift: 0.2, e: 1 },
      { t: 1.6, hx: -0.1, hy: 1.0, hz: 0.0, dx: 0, dy: 1, dz: -0.4, lean: -0.4, twist: 0, glow: 1, e: 2 }, { t: 1.9, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.4, dz: 1, lean: 0.55, shift: 0.35, crouch: 0.15, e: 1 }, { t: 2.2, e: 3 }, { t: 2.8, ...IDLE.boss, glow: 0, e: 0 }]) },
  kLeap: { name: 'Sturz des Königs', dur: 2.6, hs: 1.5, he: 1.56, range: 7, arc: 360, dmg: 170, parryable: false, danger: true, track: 0.85, leap: true,
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.8, crouch: 0.45, hx: 0, hy: 0.4, hz: 0.1, dx: 0, dy: 1, dz: 0, lean: 0.3, glow: 1, e: 2 }, { t: 1.2, crouch: -0.1, hx: 0, hy: 1.0, hz: 0.05, dx: 0, dy: 1, dz: -0.2, lean: -0.3, e: 1 }, { t: 1.5, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.7, dz: 1, lean: 0.5, crouch: 0.2, e: 1 }, { t: 1.9, e: 3 }, { t: 2.6, ...IDLE.boss, glow: 0, e: 0 }]) },
  kWave: { name: 'Flammenschwingen', dur: 2.2, hs: 99, he: 99, track: 1.0, ev: [[1.0, 'kingWave']],
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.8, hx: 0.3, hy: 0.75, hz: 0.0, dx: 1, dy: 0.3, dz: -0.2, twist: 0.9, glow: 1, e: 2 }, { t: 1.02, hx: -0.3, hy: 0.55, hz: 0.5, dx: -1, dy: 0.0, dz: 0.5, twist: -1.0, shift: 0.3, glow: 1, e: 1 }, { t: 1.4, e: 3 }, { t: 2.2, ...IDLE.boss, glow: 0, e: 0 }]) },
  kPillars: { name: 'Flammensäulen', dur: 2.6, hs: 99, he: 99, track: 0.8, danger: true, ev: [[0.85, 'kingPools']],
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.7, hx: 0, hy: 0.95, hz: 0, dx: 0, dy: 1, dz: -0.2, lean: -0.35, glow: 1, e: 2 }, { t: 0.9, hx: -0.1, hy: 0.25, hz: 0.55, dx: 0, dy: -0.7, dz: 1, lean: 0.55, crouch: 0.15, glow: 1, e: 1 }, { t: 1.5, e: 3 }, { t: 2.6, ...IDLE.boss, glow: 0, e: 0 }]) },
  kMeteors: { name: 'Sternenfall', dur: 3.2, hs: 99, he: 99, track: 0.6, danger: true, ev: [[1.2, 'meteors']],
    f: A(IDLE.boss, [{ t: 0 }, { t: 1.0, hx: 0, hy: 1.05, hz: 0.05, dx: 0, dy: 1, dz: 0, lean: -0.5, glow: 1, e: 2 }, { t: 1.2, e: 3 }, { t: 2.0, e: 3 }, { t: 3.2, ...IDLE.boss, glow: 0, e: 0 }]) },
  kStomp: { name: 'Erdbeben des Königs', dur: 6.65, hs: 99, he: 99, track: 1.4, danger: true, hops: [2.0, 3.15, 4.3, 5.45], ev: [[0.55, 'stompWarn'], [2.0, 'kingStomp'], [3.15, 'kingStomp'], [4.3, 'kingStomp'], [5.45, 'kingStomp']],
    f: A(IDLE.boss, [{ t: 0 },
      { t: 0.5, crouch: 0.45, lean: 0.3, hx: -0.1, hy: 0.4, hz: 0.2, dx: 0, dy: 1, dz: 0, glow: 1, e: 2 },
      { t: 1.2, e: 3 }, { t: 1.58, crouch: -0.1, lean: -0.35, hx: -0.1, hy: 1.0, hz: 0.05, dx: 0, dy: 1, dz: -0.2, e: 2 },
      { t: 2.0, crouch: 0.4, lean: 0.55, hx: -0.1, hy: 0.3, hz: 0.5, dx: 0, dy: -0.7, dz: 1, e: 1 },
      { t: 2.73, crouch: -0.1, lean: -0.35, hx: -0.1, hy: 1.0, hz: 0.05, dx: 0, dy: 1, dz: -0.2, e: 2 },
      { t: 3.15, crouch: 0.4, lean: 0.55, hx: -0.1, hy: 0.3, hz: 0.5, dx: 0, dy: -0.7, dz: 1, e: 1 },
      { t: 3.88, crouch: -0.1, lean: -0.35, hx: -0.1, hy: 1.0, hz: 0.05, dx: 0, dy: 1, dz: -0.2, e: 2 },
      { t: 4.3, crouch: 0.4, lean: 0.55, hx: -0.1, hy: 0.3, hz: 0.5, dx: 0, dy: -0.7, dz: 1, e: 1 },
      { t: 5.03, crouch: -0.1, lean: -0.35, hx: -0.1, hy: 1.0, hz: 0.05, dx: 0, dy: 1, dz: -0.2, e: 2 },
      { t: 5.45, crouch: 0.4, lean: 0.55, hx: -0.1, hy: 0.3, hz: 0.5, dx: 0, dy: -0.7, dz: 1, e: 1 },
      { t: 5.85, e: 3 },
      { t: 6.65, ...IDLE.boss, glow: 0, e: 0 }]) },
  kBow: { name: 'Königlicher Pfeilhagel', dur: 2.9, hs: 99, he: 99, track: 1.9, bow: true, ev: [[1.0, 'kingArrow'], [1.5, 'kingArrow'], [2.0, 'kingArrow']],
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.45, hx: -0.1, hy: 0.58, hz: 0.6, dx: 0, dy: 1, dz: 0.12, lg: 0, twist: 0.35, lean: 0, draw: 0, e: 2 },
      { t: 0.95, draw: 1, e: 0 }, { t: 1.0, draw: 0, e: 1 }, { t: 1.28, draw: 1, e: 0 }, { t: 1.48, draw: 1, e: 3 }, { t: 1.5, draw: 0, e: 1 }, { t: 1.78, draw: 1, e: 0 }, { t: 1.98, draw: 1, e: 3 }, { t: 2.0, draw: 0, e: 1 },
      { t: 2.9, ...IDLE.boss, draw: 0, e: 2 }]) },
  kBowRain: { name: 'Pfeilregen', dur: 2.8, hs: 99, he: 99, track: 0.9, bow: true, danger: true, ev: [[1.15, 'kingRain']],
    f: A(IDLE.boss, [{ t: 0 }, { t: 0.5, hx: -0.1, hy: 0.7, hz: 0.5, dx: 0, dy: 0.6, dz: -0.8, lg: 0, twist: 0.2, lean: -0.15, draw: 0, e: 2 },
      { t: 1.1, draw: 1, e: 0 }, { t: 1.17, draw: 0, e: 1 }, { t: 1.8, e: 3 }, { t: 2.8, ...IDLE.boss, draw: 0, e: 2 }]) },
  kBlink: { name: 'Thronsprung', dur: 3.0, hs: 1.5, he: 1.62, range: 6, arc: 130, dmg: 175, parryable: false, danger: true, track: 1.45, slam: true, slamDist: 4.2, slamR: 5, ev: [[0.2, 'vanish'], [1.1, 'appearBehind']],
    f: A(IDLE.boss, [{ t: 0 }, { t: 1.1, hx: 0, hy: 0.95, hz: 0, dx: 0, dy: 1, dz: -0.3, lean: -0.4, glow: 1, e: 2 }, { t: 1.48, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.6, dz: 1, lean: 0.5, shift: 0.3, crouch: 0.15, e: 1 }, { t: 2.0, e: 3 }, { t: 3.0, ...IDLE.boss, glow: 0, e: 0 }]) },
};


// Vaels Schatten-Beschwörung: Abklingzeit in Sekunden (nach Phasenwechsel und nach jeder Beschwörung)
const SHADE_COOLDOWN = 35;
const TYPES = {
  hollow: {
    hp: 75, radius: 0.45, speed: 2.7, aggro: 13, souls: 60, scale: 1.0, attacks: ['hSlash', 'hSwipe'], idle: IDLE.hollow, strafe: false,
    look: { head: 'hollow', skin: 0x9a9c8c, cloth: 0x3c342a, armor: 0x4a4038, trim: 0x5a4a30, accent: 0x3a2a22, plates: false, pauldrons: false, hunch: 0.28, weapon: 'sword', weaponRusty: true, bulk: 0.95 },
  },
  knight: {
    hp: 210, radius: 0.52, speed: 2.4, aggro: 15, souls: 280, scale: 1.1, attacks: ['kSlash', 'kThrust'], idle: IDLE.knight, blocks: true, strafe: true,
    look: { head: 'knight', skin: 0x888888, cloth: 0x202428, armor: 0x6a707c, trim: 0x8a7030, accent: 0x6a1a1a, plates: true, plume: true, weapon: 'sword', weaponColor: 0xb8bcc6, weaponRusty: false, shield: true, shieldColor: 0x4a505c, bulk: 1.12, eye: 0xff4422 },
  },
  boss: {
    hp: 1700, radius: 1.3, speed: 3.4, aggro: 99, souls: 8000, scale: 1.75, attacks: ['bSweep', 'bSlam', 'bThrust'], idle: IDLE.boss, isBoss: true, strafe: true, glowSword: true, longCharge: true, phaseMsg: 'Der Wächter entflammt',
    look: { head: 'greathelm', ornate: true, skin: 0x888888, cloth: 0x120e0a, armor: 0x17171d, trim: 0xe0b040, accent: 0x8a1010, capeColor: 0x6a1010, cape: true, tabard: false, plates: true, weapon: 'greatsword', bulk: 1.2, eye: 0xff6a10 },
  },
  witch: {
    hp: 1300, radius: 0.5, speed: 3.0, aggro: 99, souls: 6000, scale: 1.1, idle: IDLE.witch, isBoss: true, strafe: true, ranged: { min: 6, max: 13 }, cdRange: [1.0, 2.0], p2speed: 1.3, p2time: 1.25,
    phaseMsg: 'Morwen entfesselt ihre Macht',
    choose: (e, d) => {
      const o = []; // Morwen beschwoert keine Gegner
      if (d < 5.5) o.push('wBurst', 'wBurst', 'wBlinkAway', 'wBlink');
      else { o.push('wFire', 'wFire', 'wOrb', 'wPools', 'wPools'); if (d > 9) o.push('wBlink'); if (e.phase2) o.push('wOrb', 'wPools', 'wFire'); }
      let n = pick(o); if (n === e.lastAtk && Math.random() < 0.7) n = pick(o); e.lastAtk = n; return n;
    },
    look: { head: 'witch', skin: 0xc8b4a8, cloth: 0x2a1838, armor: 0x3a2a48, trim: 0xb89038, accent: 0x7a2a9a, plates: false, pauldrons: false, cape: true, capeColor: 0x3a1a4a, robe: true, robeColor: 0x26142f, weapon: 'staff', bulk: 0.95 },
  },
  giant: {
    hp: 3200, radius: 2.0, speed: 2.3, aggro: 99, souls: 7500, scale: 2.5, idle: IDLE.giant, isBoss: true, strafe: true, reach: 7, p2speed: 1.35, p2time: 1.25,
    phaseMsg: 'Gorm brüllt vor Wut',
    choose: (e, d) => {
      const o = [];
      if (d < 8.5) { o.push('gSwat', 'gSwat', 'gSmash'); if (e.phase2 || Math.random() < 0.5) o.push('gStomp'); }
      else { o.push('gCharge', 'gCharge', 'gRock'); if (e.phase2) o.push('gRock', 'gStomp'); }
      let n = pick(o); if (n === e.lastAtk && Math.random() < 0.7) n = pick(o); e.lastAtk = n; return n;
    },
    look: { head: 'hollow', hunch: 0.2, skin: 0x8a8478, cloth: 0x6a5a48, armor: 0x4a4038, trim: 0x6a5a40, accent: 0x5a2a1a, plates: false, pauldrons: false, weapon: 'club', bulk: 1.45 },
  },
  reaper: {
    hp: 1500, radius: 0.6, speed: 4.2, aggro: 99, souls: 7000, scale: 1.2, idle: IDLE.reaper, isBoss: true, strafe: true, reach: 4.4, p2speed: 1.2, p2time: 1.2,
    phaseMsg: 'Vael verschwimmt in Schatten',
    onPhase2: (e) => { for (let i = 0; i < 2; i++) spawnMinion(e, 'shade'); e.summonCd = SHADE_COOLDOWN; },
    choose: (e, d) => {
      const o = []; const shades = e.G.enemies.filter((m) => m.minion && !m.dead).length;
      if (d > 10) o.push('rDash', 'rDash', 'rVanish'); else if (d > 5.2) o.push('rDash', 'rCombo', 'rVanish'); else o.push('rCombo', 'rCombo', 'rSpin', 'rVanish');
      if (e.phase2) { if (shades < 1 && e.summonCd <= 0) o.push('rShades', 'rShades'); o.push('rSpin'); } // Beschwörung nur mit Abklingzeit
      let n = pick(o); if (n === e.lastAtk && Math.random() < 0.7) n = pick(o); e.lastAtk = n; return n;
    },
    look: { head: 'reaper', skin: 0x222222, cloth: 0x0e0c12, armor: 0x1c1a22, trim: 0xa8a8b8, accent: 0x6a0a0a, capeColor: 0x180a10, cape: true, plates: true, pauldrons: true, weapon: 'scythe', bulk: 0.95 },
  },
  king: {
    hp: 5500, radius: 1.6, speed: 3.7, aggro: 99, souls: 60000, scale: 2.1, idle: IDLE.boss, isBoss: true, strafe: true, reach: 6, p2At: 0.66, p3At: 0.33, p2speed: 1.12, p2time: 1.1,
    phaseMsg: 'Aldrar erhebt sich zum wahren König', phase3Msg: 'Die Krone brennt – Aldrars Zorn kennt kein Maß',
    onPhase3: (e) => { EV.stompRing(e); },
    choose: (e, d) => {
      const o = [];
      if (d > 11) { o.push('kLunge', 'kWave', 'kBow', 'kBow', 'kStomp'); if (e.phase2) o.push('kLeap', 'kPillars', 'kBowRain'); if (e.phase3) o.push('kMeteors', 'kBlink', 'kBowRain'); }
      else { o.push('kSweep', 'kSweep', 'kCombo', 'kSlam', 'kStomp'); if (e.phase2) o.push('kStomp'); if (d > 5) o.push('kLunge', 'kBow'); if (e.phase2) o.push('kWave', 'kPillars', 'kLeap', 'kBowRain'); if (e.phase3) o.push('kCombo', 'kBlink', 'kMeteors', 'kBow'); }
      let n = pick(o); if (n === e.lastAtk && Math.random() < 0.7) n = pick(o); e.lastAtk = n; return n;
    },
    look: { head: 'crown', ornate: true, skin: 0x888888, cloth: 0x1a1222, armor: 0x2a2234, trim: 0xf0c850, accent: 0x6a1a9a, capeColor: 0x5a1a8a, cape: true, plates: true, weapon: 'kingsword', weapons: ['kingsword', 'kingbow'], bulk: 1.38, eye: 0xffd060 },
  },
  shade: {
    hp: 45, radius: 0.45, speed: 4.4, aggro: 99, souls: 0, scale: 1.0, attacks: ['hSwipe'], idle: IDLE.shade, strafe: false,
    look: { head: 'hollow', skin: 0x20202c, cloth: 0x0c0c14, armor: 0x14141c, trim: 0x2a2a3a, accent: 0x14101c, plates: false, pauldrons: false, hunch: 0.3, weapon: 'sword', weaponColor: 0x30303e, weaponRusty: true, bulk: 0.9 },
  },
};
Object.assign(TYPES, (() => {
  const TYPES_BASE_WITCH = TYPES.witch, TYPES_BASE_GIANT = TYPES.giant, TYPES_BASE_REAPER = TYPES.reaper;
  return {
  // ---- Minibosse der offenen Welt (nutzen Angriffe der grossen Bosse, aber ohne Phasen / Arena) ----
  mWitch: { ...TYPES_BASE_WITCH, hp: 900, souls: 2600, scale: 1.15, aggro: 20, mini: true, isBoss: false, cdRange: [1.5, 2.6],
    look: { head: 'witch', skin: 0xb8c8c0, cloth: 0x12302c, armor: 0x1a4038, trim: 0x6ad8b8, accent: 0x2ac8a0, plates: false, pauldrons: false, cape: true, capeColor: 0x0e2824, robe: true, robeColor: 0x0e2824, weapon: 'staff', bulk: 0.95 } },
  mWitch2: { ...TYPES_BASE_WITCH, hp: 1050, souls: 3000, scale: 1.15, aggro: 20, mini: true, isBoss: false, cdRange: [1.3, 2.3], speed: 3.3,
    look: { head: 'witch', skin: 0xd8d4e0, cloth: 0x2a3050, armor: 0x38406a, trim: 0xb8c8ff, accent: 0x6a88ff, plates: false, pauldrons: false, cape: true, capeColor: 0x2a3a70, robe: true, robeColor: 0x242c58, weapon: 'staff', bulk: 0.95 } },
  mGiant: { ...TYPES_BASE_GIANT, hp: 2000, souls: 3800, scale: 2.1, radius: 1.7, aggro: 22, mini: true, isBoss: false, reach: 6,
    look: { head: 'hollow', hunch: 0.2, skin: 0x8a8070, cloth: 0x4a4038, armor: 0x5a4a38, trim: 0xa08040, accent: 0x6a3a1a, plates: false, pauldrons: false, weapon: 'club', bulk: 1.4 } },
  mReaper: { ...TYPES_BASE_REAPER, hp: 1100, souls: 3000, scale: 1.1, aggro: 22, mini: true, isBoss: false, reach: 4.2,
    look: { head: 'reaper', skin: 0x222222, cloth: 0x2a1020, armor: 0x3a1a2a, trim: 0xd8a8c0, accent: 0xa01048, capeColor: 0x401028, cape: true, plates: true, pauldrons: true, weapon: 'scythe', bulk: 0.95 } },
  mKnight: { hp: 1500, radius: 0.8, speed: 3.0, aggro: 20, souls: 3500, scale: 1.55, attacks: ['kSlash', 'kSlash', 'kThrust', 'bSweep', 'bThrust'], idle: IDLE.knight, blocks: true, strafe: true, mini: true, reach: 3.8,
    look: { head: 'knight', skin: 0x888888, cloth: 0x161a26, armor: 0x8a94a8, trim: 0x8ab0ff, accent: 0x2a3a7a, plates: true, pauldrons: true, plume: true, tabard: true, cape: true, capeColor: 0x1a2a5a, weapon: 'sword', weaponColor: 0xb4ccf4, weaponRusty: false, shield: true, shieldColor: 0x5a6a88, bulk: 1.2, eye: 0x6a98ff } },
  mHollow: { hp: 1200, radius: 0.9, speed: 3.1, aggro: 20, souls: 3200, scale: 1.65, attacks: ['hSlash', 'hSwipe', 'bSlam', 'bSweep'], idle: IDLE.hollow, strafe: false, mini: true, reach: 3.6,
    look: { head: 'hollow', skin: 0x7a3a28, cloth: 0x2a1410, armor: 0x3a1c14, trim: 0xff7a30, accent: 0xff5a10, plates: false, pauldrons: false, hunch: 0.25, weapon: 'club', bulk: 1.3, eye: 0xff6a20 } }
  };
})());
// Minibosse: Reihenfolge = Erkundungsreihenfolge; reward: weapon (w) / spell (s)
export const MINIS = [
  { id: 'sellith', type: 'mWitch', region: 'moor', name: 'Sellith, die Moorhexe', hp: 900, souls: 2600, dmgMul: 0.7, speedMul: 1.0, cdMul: 1.0, reward: [{ w: 'staff' }, { s: 'frost' }] },
  { id: 'brogg', type: 'mGiant', region: 'mine', name: 'Brogg, der Minenaufseher', hp: 2000, souls: 3800, dmgMul: 0.7, speedMul: 1.0, cdMul: 1.0, reward: [{ w: 'keule' }] },
  { id: 'kaela', type: 'mReaper', region: 'forest', name: 'Kaela, die Schnitterin', hp: 1100, souls: 3000, dmgMul: 0.8, speedMul: 1.0, cdMul: 1.0, reward: [{ w: 'sichel' }] },
  { id: 'aldwin', type: 'mKnight', region: 'crypt', name: 'Ritter Aldwin der Gefallene', hp: 1500, souls: 3500, dmgMul: 0.95, speedMul: 1.0, cdMul: 1.0, reward: [{ w: 'mondklinge' }] },
  { id: 'ysolde', type: 'mWitch2', region: 'watch', name: 'Ysolde, die Sturmruferin', hp: 1050, souls: 3000, dmgMul: 0.75, speedMul: 1.0, cdMul: 1.0, reward: [{ s: 'lanze' }] },
  { id: 'embra', type: 'mHollow', region: 'burnt', name: 'Embra, der Aschenbrenner', hp: 1200, souls: 3200, dmgMul: 0.7, speedMul: 1.0, cdMul: 1.0, reward: [{ s: 'nova' }] },
];

// ---- Inszenierte Posen der Boss-Intros (absolute Cutscene-Zeit in Sekunden) ----
export const CINE = {
  boss: A(IDLE.boss, [
    { t: 0, crouch: 0.78, lean: 0.5, head: 0.35, hx: -0.05, hy: 0.18, hz: 0.32, dx: 0, dy: -1, dz: 0.15, lg: -0.2 },
    { t: 3.4 }, { t: 4.7, crouch: 0.35, lean: 0.3, hy: 0.5, dx: 0, dy: -0.4, dz: 0.9, head: 0.1, e: 0 },
    { t: 5.8, crouch: 0.05, lean: 0.05, hx: -0.1, hy: 0.35, hz: 0.45, dx: 0.1, dy: 0.2, dz: 1, head: 0, e: 2 },
    { t: 6.8, hx: -0.1, hy: 1.0, hz: 0.05, dx: 0, dy: 1, dz: -0.2, lean: -0.35, glow: 1, e: 2 },
    { t: 7.15, hx: -0.1, hy: 0.28, hz: 0.6, dx: 0, dy: -0.6, dz: 1, lean: 0.5, crouch: 0.15, shift: 0.3, e: 1 },
    { t: 8.4, ...IDLE.boss, glow: 0, e: 2 }]),
  king: A(IDLE.boss, [
    { t: 0, crouch: 0.52, lean: -0.12, head: 0.05, hx: -0.05, hy: 0.22, hz: 0.34, dx: 0, dy: -1, dz: 0.15, lg: -0.2 },
    { t: 4.0 }, { t: 5.2, crouch: 0.2, lean: 0.05, hy: 0.45, dx: 0, dy: -0.35, dz: 0.9, e: 0 },
    { t: 6.2, crouch: 0.05, lean: 0, hx: -0.1, hy: 0.35, hz: 0.45, dx: 0.1, dy: 0.2, dz: 1, e: 2 },
    { t: 7.1, hx: -0.1, hy: 1.05, hz: 0.05, dx: 0, dy: 1, dz: -0.2, lean: -0.4, glow: 1, e: 2 },
    { t: 7.5, hx: -0.1, hy: 0.28, hz: 0.6, dx: 0, dy: -0.6, dz: 1, lean: 0.5, crouch: 0.15, shift: 0.3, e: 1 },
    { t: 8.9, ...IDLE.boss, glow: 0, e: 2 }]),
  witch: A(IDLE.witch, [
    { t: 0, hx: -0.3, hy: 0.9, hz: 0.1, dx: 0, dy: 1, dz: 0.15, lfree: 1, lx: 0.6, ly: 0.55, lz: 0.15, lean: -0.15, head: -0.15, glow: 1 },
    { t: 7.2 }, { t: 8.4, ...IDLE.witch, glow: 0, e: 2 }]),
  giant: A(IDLE.giant, [
    { t: 0, crouch: 0.9, lean: 0.55, head: 0.3, hx: -0.3, hy: 0.05, hz: 0.3, dx: 0.3, dy: 0.2, dz: 1, lfree: 1, lx: 0.3, ly: 0.1, lz: 0.3 },
    { t: 3.7 }, { t: 5.5, crouch: 0.2, lean: 0.25, head: 0.1, e: 0 },
    { t: 6.4, hx: -0.1, hy: 1.05, hz: 0.05, dx: 0, dy: 1, dz: -0.3, lean: -0.5, crouch: -0.05, lx: 0.2, ly: 1.0, lz: 0.1, glow: 1, e: 2 },
    { t: 7.1, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.6, dz: 1, lean: 0.6, crouch: 0.25, shift: 0.3, e: 1 },
    { t: 8.5, ...IDLE.giant, glow: 0, e: 2 }]),
  reaper: A(IDLE.reaper, [
    { t: 0 }, { t: 5.0, e: 3 },
    { t: 5.5, hx: -0.2, hy: 0.7, hz: 0.2, dx: 0.5, dy: 0.9, dz: 0.2, twist: -0.8, lean: -0.1, e: 2 },
    { t: 6.4, hx: -0.25, hy: 0.55, hz: 0.35, dx: 1, dy: 0, dz: 0.2, crouch: 0.25, twist: -12.566, e: 3 },
    { t: 7.2, ...IDLE.reaper, twist: IDLE.reaper.twist - 12.566, e: 0 }]),
};

export class Enemy {
  constructor(G, type, x, z, yaw = 0, opts = {}) {
    this.G = G; this.dmgMul = 1; this.speedMul = 1; this.cdMul = 1; this.summonCd = 0; this.minion = !!opts.minion; this.arena = opts.arena || null; this.fight = opts.fight || null; this.untouchable = false; this.type = type; this.mini = opts.mini || null; const T = TYPES[type]; this.T = T;
    this.isBoss = !!T.isBoss; this.radius = T.radius * (this.isBoss ? 1 : 1); this.maxHp = T.hp; this.hp = T.hp;
    this.home = new THREE.Vector3(x, 0, z); this.homeYaw = yaw;
    this.pos = new THREE.Vector3(x, groundHeight(x, z), z); this.yaw = yaw; this.vel = new THREE.Vector3();
    this.h = makeHumanoid({ ...T.look, scale: T.scale });
    G.scene.add(this.h.root);
    this.state = this.isBoss ? 'dormant' : 'idle'; this.t = 0; this.cd = rand(0.5, 1.5); this.dead = false; this.deathT = 0;
    this.pose = { ...T.idle }; this.prev = { ...T.idle }; this.blendT = 1; this.blendDur = 0.12;
    this.barT = 0; this.strafeDir = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0; this.atk = null; this.timeScale = 1;
    this.phase2 = false; this.phase3 = false; this.idlePh = rand(6.28); this.yOff = 0; this.souls = T.souls; this.leapFrom = new THREE.Vector3(); this.leapTo = new THREE.Vector3();
    this.moving = false; this.speedN = 0; this.name = opts.name || (this.isBoss ? 'Boss' : type === 'knight' ? 'Wachritter' : type === 'shade' ? 'Schatten' : 'Hohler Soldat');
    const st0 = this.h.weapon.userData.steel; if ((this.isBoss || opts.mini) && st0 && st0.emissive) this.stBase = { c: st0.emissive.clone(), i: st0.emissiveIntensity };
    this.wanderT = rand(2, 5); this.wanderYaw = yaw; this.fadeT = 0;
  }
  useBow(v) { if (!!v === !!this._bow || !this.h.weapons.kingbow) return; this._bow = !!v; this.h.setWeapon(v ? 'kingbow' : 'kingsword'); }
  setState(s, blend = 0.1) { if (s !== 'attack') this.useBow(false); this.prev = { ...this.pose }; this.state = s; this.t = 0; if (s === 'parried') this.flags = {}; this.blendT = 0; this.blendDur = blend; }
  dispose() { this.G.scene.remove(this.h.root); this.h.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }

  aggroNow() { if (this.state === 'idle' || this.state === 'return') this.setState('chase', 0.2); }

  // ---------------- Schaden / Reaktionen ----------------
  hurt(dmg, { poise = false, riposte = false, from = null, kind = '' } = {}) {
    if (this.dead) return 'dead';
    if (this.untouchable) return 'dodged';
    const G = this.G, P = G.player;
    const free = this.state === 'chase' || this.state === 'idle' || this.state === 'return' || this.state === 'recover';
    if (this.T.blocks && free && !poise && !riposte && from) {
      const a = Math.abs(angleDiff(this.yaw, Math.atan2(from.x - this.pos.x, from.z - this.pos.z)));
      if (a < 1.1) {
        this.hp -= dmg * 0.12; this.barT = 4;
        const p = this.pos.clone().lerp(from, 0.3); p.y += 1.3; G.fx.sparks(p, 12); Sound.play('hitMetal');
        if (this.hp <= 0) this.die(); else this.aggroNow();
        return 'blocked';
      }
    }
    if (riposte && this.isBoss) dmg *= 1.4;
    this.hp -= dmg; this.barT = 4; this.h.flash(0.18);
    const p = this.pos.clone(); p.y += 1.2 * this.T.scale; const d = new THREE.Vector3(this.pos.x - (from ? from.x : P.pos.x), 0.2, this.pos.z - (from ? from.z : P.pos.z)).normalize();
    G.fx.blood(p, riposte ? 40 : 16, d); if (riposte || poise) G.fx.sparks(p, 12, d);
    Sound.play(riposte ? 'riposte' : 'hit');
    if (this.hp <= 0) { this.die(); return 'kill'; }
    if (this.state === 'idle' || this.state === 'return') this.setState('chase', 0.1);
    if (this.state === 'dormant') return 'hit';
    if (this.state === 'riposted') { this.afterRiposte = true; return 'hit'; }
    if (this.state === 'parried') return 'hit';
    // Reaktion: Boss wankt nie; Ritter nur bei schweren Treffern; Hohle bei jedem Treffer
    if (!this.isBoss && (poise || this.type === 'hollow')) { this.setState('stagger', 0.05); this.staggerDur = poise ? 0.8 : 0.5; this.vel.copy(d).multiplyScalar(poise ? 4 : 2); }
    if (this.isBoss && poise) this.poiseHits = (this.poiseHits || 0) + 1;
    return 'hit';
  }
  getParried(P) {
    this.setState('parried', 0.05); this.atk = null; this.parriedDur = this.isBoss ? 3.0 : 2.6;
    this.vel.set(0, 0, 0); Sound.play('hitMetal');
    // Gegner dem Spieler zuwenden
    this.yaw = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    this.G.ui.toast('Parry! – Konter mit Angriff');
  }
  riposteBy() { this.setState('riposted', 0.05); this.riposteT = 1.5; this.afterRiposte = false; }
  die() {
    this.dead = true; this.deathT = 0; this.setState('dead', 0.05); this.hp = 0;
    const G = this.G;
    if (this.souls > 0) { G.player.souls += this.souls; G.ui.souls(this.souls); Sound.play('souls'); }
    G.fx.souls(this.pos.clone().setY(this.pos.y + 1), this.souls > 0 ? 24 : 8);
    this.h.root.visible = true; this.untouchable = false;
    if (G.player.lock === this) G.player.lock = null;
    if (this.isBoss) G.onBossDefeated(this);
    if (this.mini) G.onMiniDefeated(this);
  }

  // ---------------- Angriff ----------------
  startAttack(name) {
    const a = ATTACKS[name]; this.atk = a; this.atkName = name; this.setState('attack', 0.1); this.useBow(a.bow);
    this.hitDone = false; this.sfx = false; this.flags = {};
    if (a.leap) { this.leapFrom.copy(this.pos); }
  }
  attackUpdate(dt) {
    const G = this.G, P = G.player, a = this.atk, ts = this.timeScale;
    const t = this.t * ts;
    const toP = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    if (t < a.track) this.yaw = turnToward(this.yaw, toP, (this.isBoss ? 2.4 : 2.8) * dt * ts);
    // Ereignisse (Projektile, Teleport, Beschwoerung ...)
    if (a.ev) a.ev.forEach(([et, name], i) => { if (!this.flags['e' + i] && t >= et) { this.flags['e' + i] = true; EV[name](this, a); } });
    const lunging = a.lunge && t >= a.lunge[0] && t <= a.lunge[1];
    if (lunging) { const f = fwd(this.yaw); this.pos.x += f.x * a.lunge[2] * dt * ts; this.pos.z += f.z * a.lunge[2] * dt * ts; }
    if (!this.sfx && t >= a.hs - 0.22 && a.hs < 90) { this.sfx = true; Sound.play(this.isBoss ? 'swingHeavy' : 'swing'); }
    // Ansturm: trifft alles auf dem Weg
    if (a.charge && lunging && !this.flags.chargeHit) {
      const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
      if (d < this.radius + P.radius + 0.6 && P.jumpH < 0.5) { this.flags.chargeHit = true; P.hurt(a.dmg * this.dmgMul, this.pos, { knock: true }); }
      if (Math.random() < 0.6) G.fx.dust(this.pos, 2);
    }
    // Sprung
    if (a.leap) {
      if (t >= 0.8 && t < 1.5) {
        if (!this.flags.jump) {
          this.flags.jump = true; this.leapTo.copy(P.pos); const d = this.leapTo.clone().sub(this.pos); const L = d.length(); if (L > 14) d.multiplyScalar(14 / L); this.leapTo.copy(this.pos).add(d);
          const A = this.arena; if (A) { const ar = Math.hypot(this.leapTo.x - A.x, this.leapTo.z - A.z); if (ar > A.r - 3) { const k = (A.r - 3) / ar; this.leapTo.x = A.x + (this.leapTo.x - A.x) * k; this.leapTo.z = A.z + (this.leapTo.z - A.z) * k; } }
          this.leapFrom.copy(this.pos);
        }
        const u = (t - 0.8) / 0.7; this.pos.x = lerp(this.leapFrom.x, this.leapTo.x, Math.min(u, 1)); this.pos.z = lerp(this.leapFrom.z, this.leapTo.z, Math.min(u, 1));
        this.yOff = Math.sin(clamp(u, 0, 1) * Math.PI) * 5.5;
      } else this.yOff = 0;
    }
    if (a.hops) { this.yOff = 0; for (const th of a.hops) if (t >= th - 0.42 && t <= th) this.yOff = Math.sin(((t - (th - 0.42)) / 0.42) * Math.PI) * 1.3; }
    // Trefferfenster (ein Angriff kann mehrere haben)
    const wins = a.windows || [[a.hs, a.he]];
    for (let i = 0; i < wins.length; i++) {
      const [hs, he] = wins[i], key = 'w' + i;
      if (this.flags[key]) continue;
      const parryable = a.parryW ? a.parryW[i] : a.parryable, dmg = a.dmgW ? a.dmgW[i] : a.dmg;
      // Parade-Erkennung (leicht frueher als der Treffer, damit Parry fair wirkt)
      if (parryable && t >= hs - 0.16 && t <= he) {
        const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
        if (d < a.range + 1.2 && P.tryParry(this, a)) { this.flags[key] = true; P.parried(this); return; }
      }
      if (t >= hs && t <= he) {
        const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        let hit = false;
        if (a.arc >= 360) hit = d < a.range && P.pos.y < this.pos.y + 1.2;
        else hit = d < a.range + P.radius && Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz))) < (a.arc * Math.PI) / 360 + 0.1;
        if (a.slam && !this.flags.slamFx) {
          this.flags.slamFx = true;
          const sd = a.slamDist || 3.8, sr = a.slamR || 4.4;
          const f = fwd(this.yaw), c = this.pos.clone().addScaledVector(f, sd); c.y = groundHeight(c.x, c.z);
          G.fx.ring(c, { color: 0xff7a30, r: sr * 1.8, dur: 0.6 }); G.fx.dust(c, 24); G.fx.add.emit(c, 40, { vel: 8, up: 1, life: 0.7, size: 0.2, color: [1, 0.5, 0.15], gravity: 10 }); G.fx.flash(c.clone().setY(c.y + 1), 0xff7a30, 120, 0.4);
          G.shake(0.7); Sound.play('bossSlam');
          hit = Math.hypot(P.pos.x - c.x, P.pos.z - c.z) < sr; // Aufschlagpunkt statt Kegel
        }
        if (a.leap && !this.flags.land) { this.flags.land = true; this.yOff = 0; const c = this.pos.clone(); c.y = groundHeight(c.x, c.z); G.fx.ring(c, { color: 0xff7a30, r: 11, dur: 0.7 }); G.fx.dust(c, 40); G.fx.add.emit(c, 60, { vel: 9, up: 1.5, life: 0.8, size: 0.22, color: [1, 0.5, 0.15], gravity: 10 }); G.fx.flash(c.clone().setY(c.y + 1), 0xff7a30, 140, 0.5); G.shake(1.0); Sound.play('bossSlam'); }
        if (hit) { this.flags[key] = true; P.hurt(dmg * this.dmgMul, this.pos, { knock: this.isBoss && !a.windows }); }
        else if (a.slam || a.leap) this.flags[key] = true;
      }
    }
    if (this.t * ts >= a.dur) {
      this.yOff = 0; this.setState('recover', 0.15);
      this.recoverT = this.isBoss ? rand(0.25, 0.7) : rand(0.4, 1.0);
      const cr = this.T.cdRange; this.cd = (cr ? rand(cr[0], cr[1]) : this.isBoss ? rand(0.3, 0.9) : rand(0.8, 1.8)) * this.cdMul;
    }
  }

  chooseAttack(dist) {
    const T = this.T;
    if (!this.isBoss) return pick(T.attacks);
    const opts = [];
    if (dist > 8) { opts.push('bThrust', 'bThrust'); if (this.phase2) opts.push('bLeap', 'bLeap'); }
    else { opts.push('bSweep', 'bSweep', 'bSlam'); if (dist > 4.5) opts.push('bThrust'); if (this.phase2) opts.push('bLeap'); }
    let n = pick(opts);
    if (n === this.lastAtk && Math.random() < 0.6) n = pick(opts);
    this.lastAtk = n; return n;
  }

  // ---------------- Update ----------------
  update(dt) {
    const G = this.G, P = G.player, T = this.T, h = this.h;
    this.t += dt; this.barT = Math.max(0, this.barT - dt);
    if (this.state === 'dormant') { this.animate(dt, T.idle); return; }
    if (this.dead) {
      this.deathT += dt;
      this.pos.addScaledVector(this.vel, dt); this.vel.multiplyScalar(Math.exp(-5 * dt));
      const target = sample(REACT.dead(T.idle), Math.min(this.deathT, 1.2), {});
      this.animate(dt, target);
      if (this.deathT > 5) { h.root.position.y -= (this.deathT - 5) * 0.4; if (this.deathT > 8) h.root.visible = false; }
      return;
    }
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz), toP = Math.atan2(dx, dz);
    // Offene Welt: weit entfernte, ruhende Gegner schlafen (spart Rechenzeit)
    if (!this.isBoss && this.state === 'idle') { if (dist > 85) { h.root.visible = false; return; } if (!h.root.visible) h.root.visible = true; }
    this.cd -= dt; this.summonCd = Math.max(0, this.summonCd - dt);
    let moveDir = null, speed = 0, target = null;
    const spdMul = (this.phase2 ? (T.p2speed || 1.25) : 1) * (this.phase3 ? 1.1 : 1) * this.speedMul;
    this.timeScale = (this.phase2 ? (T.p2time || 1.2) : 1) * (this.phase3 ? 1.1 : 1) * this.speedMul;
    switch (this.state) {
      case 'idle': {
        this.wanderT -= dt; if (this.wanderT <= 0) { this.wanderT = rand(3, 7); this.wanderYaw = this.homeYaw + rand(-1, 1); }
        this.yaw = dampAngle(this.yaw, this.wanderYaw, 1.5, dt);
        if (!P.dead && dist < T.aggro && !(G.activeFight && !this.isBoss && !this.minion)) {
          // nur aggro, wenn der Spieler vor ihnen oder nah genug ist
          const ang = Math.abs(angleDiff(this.yaw, toP));
          if (dist < T.aggro * 0.55 || ang < 1.7 || P.sprinting) { this.setState('chase', 0.2); Sound.play('step'); }
        }
        break;
      }
      case 'chase': {
        this.yaw = turnToward(this.yaw, toP, (this.isBoss ? 3.2 : 4) * dt);
        const hd = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
        if ((P.dead || hd > 45) && !this.isBoss) { this.setState('return', 0.2); break; }
        const reach = T.reach ?? (this.isBoss ? 5.2 : this.type === 'knight' ? 2.8 : 2.4);
        const pickAtk = () => (T.choose ? T.choose(this, dist) : this.chooseAttack(dist));
        if (T.ranged) { // Fernkampf-Boss haelt Abstand
          if (this.cd <= 0) { this.startAttack(pickAtk()); break; }
          this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rand(1, 2.2); this.strafeDir = Math.random() < 0.5 ? 1 : -1; }
          if (dist < T.ranged.min) { moveDir = fwd(this.yaw).multiplyScalar(-1); speed = T.speed * 1.15 * spdMul; }
          else if (dist > T.ranged.max) { moveDir = fwd(this.yaw); speed = T.speed * spdMul; }
          else { moveDir = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).multiplyScalar(this.strafeDir); speed = T.speed * 0.55 * spdMul; }
          break;
        }
        if (dist > reach + 0.6) { moveDir = fwd(this.yaw); speed = T.speed * spdMul * (dist > 12 && !this.isBoss ? 1.25 : 1); }
        else if (this.cd <= 0) { this.startAttack(pickAtk()); break; }
        else if (T.strafe) {
          this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rand(0.8, 1.8); this.strafeDir = Math.random() < 0.5 ? 1 : -1; }
          const r = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).multiplyScalar(this.strafeDir);
          moveDir = r.addScaledVector(fwd(this.yaw), dist < reach - 0.4 ? -0.5 : 0.15); speed = T.speed * 0.5 * spdMul; this.strafing = true;
        }
        // Weite Distanz -> Gegner setzt zum Angriff an (Hadrian: Sturmstoss)
        if (T.longCharge && dist > 11 && this.cd <= 0) this.startAttack(Math.random() < 0.5 || !this.phase2 ? 'bThrust' : 'bLeap');
        else if (T.choose && !T.ranged && dist > reach + 0.6 && this.cd <= 0 && dist > 9) this.startAttack(pickAtk());
        break;
      }
      case 'attack': this.attackUpdate(dt); break;
      case 'recover': {
        this.yaw = turnToward(this.yaw, toP, 1.2 * dt);
        if (this.t >= this.recoverT) this.setState('chase', 0.2);
        break;
      }
      case 'stagger': {
        this.pos.addScaledVector(this.vel, dt); this.vel.multiplyScalar(Math.exp(-8 * dt));
        target = sample(REACT.stagger(T.idle), this.t, {});
        if (this.t >= (this.staggerDur || 0.5)) { this.setState('chase', 0.15); this.cd = Math.min(this.cd, rand(0.2, 0.7)); }
        break;
      }
      case 'parried': {
        target = sample(REACT.parried(T.idle, this.parriedDur), this.t, {});
        if (!this.flags?.knelt && this.t >= 0.5) { // Aufprall der Knie
          this.flags = { ...this.flags, knelt: true }; const c = this.pos.clone(); G.fx.dust(c, this.isBoss ? 18 : 8); Sound.play('step');
          if (this.isBoss) { G.shake(0.35); Sound.play('bossSlam'); }
        }
        if (this.t >= this.parriedDur) { this.setState('chase', 0.2); this.cd = 0.2; }
        break;
      }
      case 'riposted': {
        { // getroffen: bleibt kniend, wird vom Stich nach hinten gedrueckt
          const kn = sample(REACT.parried(T.idle, 3), 1.5, {}), jolt = Math.exp(-this.t * 5);
          target = { ...kn, lean: kn.lean - 0.7 * jolt, head: kn.head - 0.5 * jolt };
        }
        this.riposteT -= dt;
        if (this.t >= 1.25 || this.riposteT <= 0) { this.setState('stagger', 0.45); this.staggerDur = 0.8; this.cd = 0.8; }
        break;
      }
      case 'return': {
        const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z, hd = Math.hypot(hx, hz);
        this.yaw = turnToward(this.yaw, Math.atan2(hx, hz), 4 * dt);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.1 * dt);
        if (hd > 0.6) { moveDir = fwd(this.yaw); speed = T.speed; } else this.setState('idle', 0.3);
        if (!P.dead && dist < T.aggro * 0.5) this.setState('chase', 0.2);
        break;
      }
      case 'intro': {
        // Boss-Auftritt
        this.yaw = turnToward(this.yaw, toP, 2 * dt);
        if (!G.cutscene && !this.flags?.roar && this.t > 0.8) { this.flags = { roar: true }; Sound.play('roar'); G.shake(0.6); }
        target = null;
        if (this.t >= 2.8 && !G.cutscene) { this.setState('chase', 0.3); this.cd = 0.8; }
        break;
      }
      case 'phase': {
        this.yaw = turnToward(this.yaw, toP, 2 * dt);
        if (this.t >= 2.2) { this.setState('chase', 0.3); this.cd = 0.5; }
        break;
      }
    }
    // Phasenwechsel
    const canPhase = this.state !== 'dormant' && this.state !== 'riposted' && this.state !== 'parried' && this.state !== 'phase' && this.state !== 'intro';
    if (this.isBoss && this.phase2 && !this.phase3 && T.p3At && this.hp < this.maxHp * T.p3At && canPhase) {
      this.phase3 = true; this.setState('phase', 0.2); this.atk = null; this.yOff = 0; this.untouchable = false; this.h.root.visible = true; Sound.play('roar'); G.shake(1.0);
      G.fx.ring(this.pos.clone(), { color: 0xffd060, r: 14, dur: 1.2 }); G.ui.toast(T.phase3Msg || 'Der Boss rast vor Wut'); if (T.onPhase3) T.onPhase3(this);
    }
    if (this.isBoss && !this.phase2 && this.hp < this.maxHp * (T.p2At ?? 0.5) && canPhase) {
      this.phase2 = true; this.setState('phase', 0.2); this.atk = null; this.yOff = 0; Sound.play('roar'); G.shake(0.8);
      this.untouchable = false; this.h.root.visible = true;
      G.fx.ring(this.pos.clone(), { color: 0xff6a20, r: 12, dur: 1.0 }); G.ui.toast(T.phaseMsg || 'Der Boss wird wütend');
      if (T.glowSword) this.h.weapon.userData.glowMats.forEach((m) => { m.emissiveIntensity = 1.6; });
      if (T.onPhase2) T.onPhase2(this);
    }
    // Bewegung
    this.moving = false;
    if (moveDir && speed > 0) {
      moveDir.normalize();
      this.vel.x = damp(this.vel.x, moveDir.x * speed, 8, dt); this.vel.z = damp(this.vel.z, moveDir.z * speed, 8, dt);
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      this.moving = true;
    }
    // Trennung zu anderen Gegnern
    for (const o of G.enemies) {
      if (o === this || o.dead) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z, od = Math.hypot(ox, oz), rr = this.radius + o.radius;
      if (od < rr && od > 0.001) { this.pos.x += (ox / od) * (rr - od) * 0.5; this.pos.z += (oz / od) * (rr - od) * 0.5; }
    }
    const ix = this.pos.x, iz = this.pos.z;
    G.world.resolve(this.pos, this.radius * 0.9);
    const A = this.arena;
    if (A && this.state !== 'dormant') { // Boss bleibt in der Arena
      const ar = Math.hypot(this.pos.x - A.x, this.pos.z - A.z), lim = A.r - 2.2 - (this.radius > 1.5 ? 1.5 : 0);
      if (ar > lim) { const k = lim / ar; this.pos.x = A.x + (this.pos.x - A.x) * k; this.pos.z = A.z + (this.pos.z - A.z) * k; }
    }
    // Ansturm gegen Wand/Saeule: Gegner ist benommen und verwundbar
    if (this.state === 'attack' && this.atk.charge && this.t * this.timeScale >= this.atk.lunge[0] + 0.15 && this.t * this.timeScale <= this.atk.lunge[1]) {
      if (Math.hypot(this.pos.x - ix, this.pos.z - iz) > 0.03) {
        const c = this.pos.clone().addScaledVector(fwd(this.yaw), this.radius); c.y = this.pos.y;
        G.fx.ring(c, { color: 0xffd8a0, r: 9, dur: 0.6 }); G.fx.dust(c, 30); G.shake(1.0); Sound.play('bossSlam');
        this.atk = null; this.setState('parried', 0.1); this.parriedDur = 3.4; this.vel.set(0, 0, 0); G.ui.toast('Benommen! – Jetzt angreifen');
      }
    }
    this.pos.y = groundHeight(this.pos.x, this.pos.z);
    this.speedN = clamp(Math.hypot(this.vel.x, this.vel.z) / 5, 0, 1);
    if (this.isBoss || this.mini) { // Warnleuchten: rot = nicht parierbar
      const st = this.h.weapon.userData.steel;
      if (st && st.emissive) {
        const warn = this.state === 'attack' && this.atk && this.atk.danger && this.t * this.timeScale < this.atk.hs + 0.05;
        if (warn) { st.emissive.setRGB(1, 0.05, 0.02); st.emissiveIntensity = 2.5 + Math.sin(this.t * 30); }
        else if (T.glowSword) { st.emissive.setRGB(1, 0.35, 0.05); st.emissiveIntensity = this.phase2 ? 1.2 + Math.sin(performance.now() / 150) * 0.3 : 0.35; }
        else if (this.stBase) { st.emissive.copy(this.stBase.c); st.emissiveIntensity = this.stBase.i; }
      }
    }
    if (G.cutscene && G.cutscene.boss === this && CINE[this.type] && G.cutscene.kind === 'intro') target = { ...sample(CINE[this.type], G.cutscene.t, {}) };
    if (!target) {
      if (this.state === 'attack') target = sample(this.atk.f, Math.min(this.t * this.timeScale, this.atk.dur), {});
      else if (this.state === 'intro' || this.state === 'phase') {
        const k = Math.min(1, this.t / 0.8);
        target = { ...T.idle, hy: lerp(T.idle.hy, 1.0, Math.sin(k * Math.PI)), dy: 1, lean: -0.3 * Math.sin(k * Math.PI), glow: 1 };
        if (this.isBoss) target.hx = -0.1;
      }
      else { target = { ...T.idle }; const b = Math.sin(performance.now() / 800 + this.idlePh); target.hy += b * 0.01; target.lean += b * 0.012; if (this.type === 'hollow' && this.state === 'chase') { target.lean = 0.3; target.hx = -0.25; target.hy = 0.3; } }
    }
    this.animate(dt, target);
  }

  animate(dt, target) {
    const h = this.h;
    if (this.blendT < 1 && this.blendDur > 0) { this.blendT = Math.min(1, this.blendT + dt / this.blendDur); blendPose(this.prev, target, this.blendT, this.pose); }
    else Object.assign(this.pose, target);
    this.pose.twist = wrapPi(this.pose.twist);
    h.root.position.set(this.pos.x, this.pos.y + this.yOff, this.pos.z);
    h.root.rotation.y = this.yaw;
    let lx = 0, lz = 1;
    if (this.moving) { const rel = Math.atan2(this.vel.x, this.vel.z) - this.yaw; lz = Math.cos(rel); lx = -Math.sin(rel); }
    h.update(this.pose, { moving: this.moving && !this.dead, speed: this.speedN, lx, lz }, dt);
  }
}

// ----------------------------------------------------------------
export const SPAWNS = [
  // Dorf
  ['hollow', -11, -24, 0.4], ['hollow', 10, -30, -0.6], ['hollow', -4, -40, 0.2], ['hollow', 18, -44, 1.2], ['hollow', -24, -14, 2.2], ['hollow', 24, -12, -2.0],
  ['knight', -10, -54, 0.3],
  // Offene Welt: Wegelagerer entlang der Wege und in den Gebieten
  ['hollow', -62, 12, 0.4], ['hollow', -74, 4, -1], ['hollow', -112, 12, 1.2], ['knight', -122, 6, 0.6], ['hollow', -128, 12, 2], ['hollow', -150, 8, 0.2], ['hollow', -160, -8, 1.4], ['knight', -156, 14, 3],
  ['hollow', 62, 10, -0.4], ['hollow', 76, 4, 1], ['hollow', 112, 10, -1.2], ['knight', 122, 4, -0.6], ['hollow', 128, 12, -2], ['hollow', 152, 2, 0.2], ['hollow', 160, -18, 1.4], ['knight', 158, 10, 3],
  ['hollow', 36, 36, 0.5], ['hollow', 30, 58, -0.7], ['hollow', 20, 80, 2], ['knight', 12, 96, 1], ['hollow', 8, 108, 0.3], ['hollow', -8, 132, 1.3], ['hollow', 14, 140, -1.3], ['knight', -10, 146, 2.4], ['hollow', 18, 160, 0.4],
  ['hollow', -106, -36, 0.8], ['hollow', -118, -60, -0.4], ['knight', -128, -84, 1.6], ['hollow', -140, -96, 2.2], ['hollow', -136, -112, 0.1], ['hollow', -162, -118, 1.1], ['knight', -146, -142, -2.2],
  ['hollow', 106, -36, -0.8], ['hollow', 118, -60, 0.4], ['knight', 128, -84, -1.6], ['hollow', 140, -96, -2.2], ['hollow', 136, -112, 0.1], ['hollow', 162, -118, -1.1], ['knight', 146, -142, 2.2],
  ['hollow', -40, 100, 0.2], ['hollow', -66, 108, 1.4], ['knight', -90, 112, -0.6], ['hollow', -104, 130, 2.4], ['hollow', -124, 108, 0.9], ['hollow', -92, 128, 1.9],

  // Burghof
  ['hollow', -14, -70, 0], ['hollow', 15, -72, 0], ['knight', -18, -92, 0.2], ['knight', 18, -98, -0.3], ['hollow', 0, -98, 0], ['hollow', -9, -106, 0.5], ['hollow', 10, -108, -0.5],
];
export function spawnMinis(G) {
  const out = [];
  for (const M of MINIS) {
    if (G.minis && G.minis[M.id] && G.minis[M.id].dead) continue;
    const Rg = REGIONS.find((r) => r.id === M.region), x = Rg.x + (M.dx || 0), z = Rg.z + (M.dz || 0);
    const e = new Enemy(G, M.type, x, z, Math.atan2(-x, 60 - z) + 0.3, { name: M.name, mini: M, arena: { x: Rg.x, z: Rg.z, r: Rg.r + 4 } });
    e.maxHp = e.hp = M.hp; e.souls = M.souls; e.dmgMul = M.dmgMul; e.speedMul = M.speedMul; e.cdMul = M.cdMul;
    out.push(e);
  }
  return out;
}
export function spawnAll(G) {
  const list = SPAWNS.map(([t, x, z, y]) => new Enemy(G, t, x, z, y));
  return list;
}
export function spawnBoss(G, fight) {
  const A = fight.arena, back = A.spawnBack ?? 5, sx = A.x - A.nx * back, sz = A.z - A.nz * back;
  const e = new Enemy(G, A.boss, sx, sz, Math.atan2(A.nx, A.nz), { arena: A, fight, name: A.bossName });
  // Schwierigkeitsstufe: spaetere Bosse sind zaeher, schneller und schlagen haerter zu
  e.maxHp = e.hp = A.hp; e.souls = A.souls; e.dmgMul = A.dmgMul; e.speedMul = A.speedMul; e.cdMul = A.cdMul;
  return e;
}

// ---------------- Boss-Ereignisse (Projektile, Teleport, Beschwoerung ...) ----------------
const V3 = THREE.Vector3;
function muzzle(e) { e.h.root.updateMatrixWorld(true); const ud = e.h.weapon.userData, out = new V3(); (ud.orb || ud.trailTip).getWorldPosition(out); return out; }
function clampArena(e, x, z, pad = 3) {
  const A = e.arena; if (!A) return [x, z];
  const d = Math.hypot(x - A.x, z - A.z), lim = A.r - pad; if (d > lim) { const k = lim / d; return [A.x + (x - A.x) * k, A.z + (z - A.z) * k]; } return [x, z];
}
function spawnMinion(e, type) {
  const G = e.G, A = e.arena || { x: e.pos.x, z: e.pos.z, r: 20 };
  for (let tries = 0; tries < 8; tries++) {
    const ang = rand(6.28), rr = rand(4, A.r * 0.55);
    const [x, z] = clampArena(e, A.x + Math.cos(ang) * rr, A.z + Math.sin(ang) * rr, 3.5);
    if (Math.hypot(x - G.player.pos.x, z - G.player.pos.z) < 3.5) continue;
    const m = new Enemy(G, type, x, z, rand(6.28), { minion: true, arena: A });
    m.souls = 0; m.home.set(x, 0, z); m.setState('chase', 0.1); m.cd = rand(0.4, 1.0);
    G.enemies.push(m); G.fx.dust(m.pos, 10); G.fx.add.emit(m.pos.clone().setY(m.pos.y + 1), 20, { vel: 3, up: 1.5, life: 0.9, size: 0.2, color: [0.6, 0.3, 1], gravity: -1 });
    return m;
  }
  return null;
}
// Richtung vom Mündungspunkt direkt auf die Brust des Spielers (inkl. Höhenunterschied), optional seitlich gedreht
function aimAt(e, m, off = 0, chest = 1.1) {
  const P = e.G.player, v = new V3(P.pos.x - m.x, P.pos.y + chest - m.y, P.pos.z - m.z);
  if (off) { const c = Math.cos(off), s2 = Math.sin(off), x = v.x * c + v.z * s2, z = -v.x * s2 + v.z * c; v.x = x; v.z = z; }
  return v.normalize();
}
const minionsAlive = (e) => e.G.enemies.filter((o) => o.minion && !o.dead).length;
const EV = {
  fireball(e) {
    const G = e.G, m = muzzle(e), n = e.phase2 ? 5 : 3;
    for (let i = 0; i < n; i++) { G.hazards.shoot({ pos: m.clone(), dir: aimAt(e, m, (i - (n - 1) / 2) * 0.21), speed: 15, dmg: 70 * e.dmgMul, r: 0.6, color: 0xff7a30, kind: 'fire', life: 4, size: 1.5 }); }
    G.fx.flash(m, 0xff8a30, 70, 0.3); Sound.play('ash');
  },
  orb(e) {
    const G = e.G, P = G.player, m = muzzle(e), n = e.phase2 ? 2 : 1;
    for (let i = 0; i < n; i++) { const ang = Math.atan2(P.pos.x - m.x, P.pos.z - m.z) + (i ? 0.7 : 0); G.hazards.shoot({ pos: m.clone(), dir: new V3(Math.sin(ang), 0.05, Math.cos(ang)), speed: 6.5, homing: 1.7, dmg: 90 * e.dmgMul, r: 0.85, color: 0xb070ff, kind: 'orb', life: 9, size: 2.1 }); }
    G.fx.flash(m, 0xb070ff, 70, 0.3); Sound.play('ash');
  },
  pools(e) {
    const G = e.G, P = G.player, n = e.phase2 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      let x = P.pos.x, z = P.pos.z;
      if (i) { const ang = rand(6.28), rr = rand(2.5, 7); x += Math.cos(ang) * rr; z += Math.sin(ang) * rr; }
      [x, z] = clampArena(e, x, z, 2);
      G.hazards.area({ x, z, r: 2.8, delay: 1.0, life: 6, dmg: 38 * e.dmgMul, tick: 0.6, kind: 'pool', color: 0xff5a1a });
    }
    Sound.play('bossSlam');
  },
  summon(e) { const n = Math.min(2, 4 - minionsAlive(e)); for (let i = 0; i < n; i++) spawnMinion(e, 'hollow'); Sound.play('roar'); e.G.shake(0.3); },
  shades(e) { const n = Math.min(2, 2 - minionsAlive(e)); for (let i = 0; i < n; i++) spawnMinion(e, 'shade'); e.summonCd = SHADE_COOLDOWN; Sound.play('roar'); },
  burst(e) { e.G.hazards.area({ x: e.pos.x, z: e.pos.z, r: 5.4, delay: 0.85, dmg: 100 * e.dmgMul, kind: 'blast', color: 0xb070ff, knock: true }); Sound.play('ashCharge'); },
  vanish(e) {
    const c = e.pos.clone(); c.y += 1; e.G.fx.add.emit(c, 40, { vel: 3, up: 1.5, life: 0.9, size: 0.4, color: [0.5, 0.25, 0.8], gravity: -1 });
    e.G.fx.norm.emit(c, 16, { vel: 2, up: 1, life: 1.0, size: 0.6, color: [0.1, 0.05, 0.15, 0.6], gravity: -0.5 });
    e.h.root.visible = false; e.untouchable = true; Sound.play('fog');
  },
  appearBehind(e) {
    const P = e.G.player;
    const [x, z] = clampArena(e, P.pos.x - Math.sin(P.yaw) * 3.4, P.pos.z - Math.cos(P.yaw) * 3.4, 2.5);
    e.pos.x = x; e.pos.z = z; e.yaw = Math.atan2(P.pos.x - x, P.pos.z - z); e.vel.set(0, 0, 0);
    e.h.root.visible = true; e.untouchable = false;
    const c = e.pos.clone(); c.y += 1; e.G.fx.add.emit(c, 40, { vel: 4, up: 1, life: 0.7, size: 0.35, color: [0.7, 0.3, 0.9], gravity: 0 }); e.G.fx.ring(e.pos.clone(), { color: 0xb070ff, r: 4, dur: 0.4 });
    Sound.play('swingHeavy');
  },
  blinkFar(e) {
    const P = e.G.player, A = e.arena; let dx = A.x - P.pos.x, dz = A.z - P.pos.z; const l = Math.hypot(dx, dz);
    if (l < 3) { const a = rand(6.28); dx = Math.cos(a); dz = Math.sin(a); } else { dx /= l; dz /= l; }
    const [x, z] = clampArena(e, A.x + dx * A.r * 0.55, A.z + dz * A.r * 0.55, 3);
    e.pos.x = x; e.pos.z = z; e.yaw = Math.atan2(P.pos.x - x, P.pos.z - z); e.h.root.visible = true; e.untouchable = false;
    const c = e.pos.clone(); c.y += 1; e.G.fx.add.emit(c, 40, { vel: 4, up: 1, life: 0.7, size: 0.35, color: [0.7, 0.3, 0.9], gravity: 0 });
  },
  stompRing(e) {
    const G = e.G, c = e.pos.clone();
    G.hazards.area({ x: c.x, z: c.z, kind: 'ring', speed: 11, thick: 1.8, maxR: 21, dmg: 125 * e.dmgMul, color: 0xffb060 });
    G.fx.dust(c, 30); G.fx.ring(c, { color: 0xffb060, r: 6, dur: 0.5 }); G.shake(0.9); Sound.play('bossSlam');
  },
  kingWave(e) { // Fächer aus Flammenwellen
    const G = e.G, m = muzzle(e), n = e.phase3 ? 7 : e.phase2 ? 5 : 3;
    for (let i = 0; i < n; i++) { G.hazards.shoot({ pos: m.clone().setY(m.y - 0.4), dir: aimAt(e, m.clone().setY(m.y - 0.4), (i - (n - 1) / 2) * 0.22), speed: 14, dmg: 85 * e.dmgMul, r: 0.95, color: 0xffb030, kind: 'fire', life: 4.5, size: 2.2, noStagger: true }); }
    G.fx.flash(m, 0xffb030, 90, 0.3); G.shake(0.3); Sound.play('ash');
  },
  kingPools(e) { // Flammensäulen rund um den Spieler
    const G = e.G, P = G.player, n = e.phase3 ? 7 : 5;
    for (let i = 0; i < n; i++) {
      let x = P.pos.x, z = P.pos.z; if (i) { const a = (i / n) * Math.PI * 2 + rand(0.5), rr = rand(3, 7.5); x += Math.cos(a) * rr; z += Math.sin(a) * rr; }
      [x, z] = clampArena(e, x, z, 2);
      G.hazards.area({ x, z, r: 3.1, delay: 1.0 + (i % 3) * 0.15, life: 5, dmg: 45 * e.dmgMul, tick: 0.55, kind: 'pool', color: 0xffb030, noStagger: true });
    }
    Sound.play('bossSlam');
  },
  kingStomp(e) { // Schockwelle, die nur ein Sprung abwehrt (Rolle hilft nicht)
    const G = e.G, n = (e.flags.stompN = (e.flags.stompN || 0) + 1), max = e.phase3 ? 4 : e.phase2 ? 3 : 2;
    if (n > max) return;
    const c = e.pos.clone(); c.y = groundHeight(c.x, c.z);
    G.hazards.area({ x: c.x, z: c.z, kind: 'ring', speed: e.phase3 ? 13 : 11, thick: 1.9, maxR: 32, dmg: 130 * e.dmgMul, color: 0xffd060, jumpOnly: true });
    G.fx.ring(c, { color: 0xffd060, r: 8, dur: 0.5 }); G.fx.dust(c, 30); G.shake(0.8); Sound.play('bossSlam');
  },
  stompWarn(e) { // Anlauf des Erdbebens: gut sichtbar, auch im Nahkampf
    const G = e.G, c = e.pos.clone(); c.y = groundHeight(c.x, c.z);
    G.fx.ring(c, { color: 0xffd060, r: 5, dur: 0.9 }); G.fx.add.emit(c.clone().setY(c.y + 0.3), 30, { vel: 3, up: 1, life: 0.7, size: 0.2, color: [1, 0.85, 0.4], gravity: -1 });
    G.shake(0.25); Sound.play('ashCharge'); if (!e.flags.warned) { e.flags.warned = true; G.ui.toast('Springen!'); }
  },
  kingArrow(e) { // Pfeile direkt auf den Spieler
    const G = e.G, m = muzzle(e), n = e.phase3 ? 3 : e.phase2 ? 2 : 1;
    for (let i = 0; i < n; i++) G.hazards.shoot({ pos: m.clone(), dir: aimAt(e, m, (i - (n - 1) / 2) * 0.09), speed: 34, dmg: 45 * e.dmgMul, r: 0.5, color: 0xffd060, kind: 'arrow', life: 2.6, size: 0.95 });
    G.fx.flash(m, 0xffd060, 50, 0.2); Sound.play('swing'); Sound.play('hitMetal');
  },
  kingRain(e) { // Pfeilregen: Pfeile fallen gestaffelt rund um den Spieler
    const G = e.G, P = G.player, n = e.phase3 ? 16 : 10;
    for (let i = 0; i < n; i++) {
      let x = P.pos.x + (i ? rand(-7.5, 7.5) : P.vel.x * 0.6), z = P.pos.z + (i ? rand(-7.5, 7.5) : P.vel.z * 0.6); [x, z] = clampArena(e, x, z, 2);
      G.hazards.area({ x, z, r: 2.1, delay: 0.9 + i * 0.12, dmg: 52 * e.dmgMul, kind: 'rock', shape: 'arrow', color: 0xffd060 });
    }
    Sound.play('swingHeavy'); G.shake(0.2);
  },
  meteors(e) { // Sternenfall: Felsen regnen gestaffelt herab
    const G = e.G, P = G.player, n = 7;
    for (let i = 0; i < n; i++) {
      let x = P.pos.x + (i ? rand(-9, 9) : P.vel.x * 0.5), z = P.pos.z + (i ? rand(-9, 9) : P.vel.z * 0.5); [x, z] = clampArena(e, x, z, 2);
      G.hazards.area({ x, z, r: 3.4, delay: 1.1 + i * 0.28, dmg: 140 * e.dmgMul, kind: 'rock', color: 0xffc060 });
    }
    Sound.play('roar'); G.shake(0.5);
  },
  rock(e) {
    const G = e.G, P = G.player, n = e.phase2 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      let x = P.pos.x + P.vel.x * 0.6, z = P.pos.z + P.vel.z * 0.6; if (i) { x += rand(-5, 5); z += rand(-5, 5); }
      [x, z] = clampArena(e, x, z, 2);
      G.hazards.area({ x, z, r: 3.5, delay: 1.3, dmg: 150 * e.dmgMul, kind: 'rock', color: 0xff9a50 });
    }
    Sound.play('roar');
  },
};
