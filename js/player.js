import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, angleDiff, turnToward, rand } from './util.js';
import { makeHumanoid, compile, sample, blendPose, DEF } from './models.js';
import { Trail } from './fx.js';
import { Sound } from './audio.js';
import { groundHeight } from './world.js';

export const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
export const READY = { ...DEF, hx: -0.1, hy: 0.34, hz: 0.42, dx: 0.12, dy: 0.45, dz: 0.88, lg: -0.2, twist: 0.12, lean: 0.05, crouch: 0.04 };
const C = (frames) => compile(frames, READY);
const R0 = { t: 0 };

// ---------------- Animationen (Torso-Raum, siehe models.js) ----------------
const FR = {
  l1: C([R0,
    { t: 0.2, hx: -0.34, hy: 0.95, hz: 0.0, dx: -0.35, dy: 0.85, dz: -0.35, twist: -0.65, lean: -0.12, e: 2 },
    { t: 0.34, hx: 0.16, hy: 0.28, hz: 0.55, dx: 0.6, dy: -0.05, dz: 0.8, twist: 0.7, lean: 0.22, shift: 0.15, crouch: 0.1, e: 1 },
    { t: 0.46, hx: 0.3, hy: 0.22, hz: 0.45, dx: 0.85, dy: -0.25, dz: 0.5, twist: 0.85, lean: 0.2, shift: 0.18, e: 2 },
    { t: 0.8, ...READY, e: 0 }]),
  l2: C([R0,
    { t: 0.14, hx: 0.22, hy: 0.58, hz: 0.25, dx: 0.95, dy: 0.0, dz: 0.1, twist: 0.95, lean: 0.0, e: 2 },
    { t: 0.3, hx: -0.28, hy: 0.52, hz: 0.55, dx: -0.9, dy: 0.0, dz: 0.45, twist: -0.85, lean: 0.12, shift: 0.15, crouch: 0.08, e: 1 },
    { t: 0.42, hx: -0.34, hy: 0.5, hz: 0.5, dx: -1, dy: -0.1, dz: 0.1, twist: -1.0, shift: 0.18, e: 2 },
    { t: 0.76, ...READY, e: 0 }]),
  l3: C([R0,
    { t: 0.2, hx: -0.22, hy: 0.55, hz: -0.08, dx: 0.05, dy: 0.1, dz: 1, twist: -0.55, lean: -0.1, shift: -0.12, crouch: 0.16, e: 2 },
    { t: 0.34, hx: -0.06, hy: 0.55, hz: 0.62, dx: 0, dy: 0.04, dz: 1, twist: 0.3, lean: 0.3, shift: 0.38, crouch: 0.18, e: 1 },
    { t: 0.5, hx: -0.06, hy: 0.55, hz: 0.62, dx: 0, dy: 0.04, dz: 1, twist: 0.3, lean: 0.3, shift: 0.38, crouch: 0.18, e: 3 },
    { t: 0.98, ...READY, e: 0 }]),
  heavy: C([R0,
    { t: 0.5, hx: -0.04, hy: 1.0, hz: -0.02, dx: 0, dy: 0.95, dz: -0.4, lean: -0.4, twist: 0.0, crouch: 0.0, e: 2 },
    { t: 0.62, hx: -0.04, hy: 1.04, hz: -0.04, dx: 0, dy: 0.95, dz: -0.45, lean: -0.45, e: 3 },
    { t: 0.72, hx: -0.06, hy: 0.34, hz: 0.6, dx: 0, dy: -0.35, dz: 1, lean: 0.5, shift: 0.28, crouch: 0.14, e: 1 },
    { t: 0.9, hx: -0.06, hy: 0.3, hz: 0.58, dx: 0, dy: -0.45, dz: 1, lean: 0.45, shift: 0.28, crouch: 0.14, e: 3 },
    { t: 1.3, ...READY, e: 0 }]),
  ash: C([R0,
    { t: 0.38, hx: 0.2, hy: 0.1, hz: 0.15, dx: 0, dy: 0.25, dz: -0.97, lg: 0.34, twist: 0.45, lean: 0.15, crouch: 0.3, glow: 1, e: 2 },
    { t: 0.58, hx: 0.2, hy: 0.1, hz: 0.15, dx: 0, dy: 0.25, dz: -0.97, lg: 0.34, twist: 0.45, lean: 0.15, crouch: 0.3, glow: 1, e: 3 },
    { t: 0.68, hx: -0.34, hy: 0.5, hz: 0.55, dx: -0.9, dy: 0.1, dz: 0.45, lg: -0.2, twist: -0.9, lean: 0.2, shift: 0.55, crouch: 0.2, glow: 1, e: 1 },
    { t: 0.9, hx: -0.4, hy: 0.45, hz: 0.5, dx: -1, dy: -0.15, dz: 0.2, lg: -0.2, twist: -1.0, lean: 0.2, shift: 0.55, crouch: 0.2, glow: 0.7, e: 2 },
    { t: 1.55, ...READY, glow: 0, e: 0 }]),
  parry: C([R0,
    { t: 0.07, hx: 0.04, hy: 0.62, hz: 0.55, dx: 0.6, dy: 0.8, dz: 0.5, twist: 0.35, lean: 0.0, e: 1 },
    { t: 0.32, hx: 0.04, hy: 0.62, hz: 0.55, dx: 0.6, dy: 0.8, dz: 0.5, twist: 0.35, e: 3 },
    { t: 0.62, ...READY, e: 0 }]),
  parryOk: C([R0,
    { t: 0.0, hx: 0.04, hy: 0.62, hz: 0.55, dx: 0.6, dy: 0.8, dz: 0.5, twist: 0.35 },
    { t: 0.12, hx: 0.06, hy: 0.7, hz: 0.5, dx: 0.7, dy: 0.7, dz: 0.3, twist: 0.5, lean: -0.1, e: 2 },
    { t: 0.5, ...READY, e: 0 }]),
  riposte: C([R0,
    { t: 0.3, hx: -0.22, hy: 0.5, hz: -0.05, dx: 0.0, dy: 0.2, dz: 1, twist: -0.7, lean: -0.1, crouch: 0.2, shift: -0.1, e: 2 },
    { t: 0.46, hx: -0.06, hy: 0.5, hz: 0.62, dx: 0, dy: -0.1, dz: 1, twist: 0.45, lean: 0.4, shift: 0.4, crouch: 0.22, e: 1 },
    { t: 1.15, hx: -0.06, hy: 0.5, hz: 0.62, dx: 0, dy: -0.1, dz: 1, twist: 0.45, lean: 0.4, shift: 0.4, crouch: 0.22, e: 3 },
    { t: 1.75, ...READY, e: 0 }]),
  roll: C([R0,
    { t: 0.08, hx: -0.15, hy: 0.15, hz: 0.1, dx: 0, dy: 0.2, dz: -1, lean: 0.9, crouch: 0.2, tuck: 1, bpitch: 0.5, e: 2 },
    { t: 0.5, hx: -0.15, hy: 0.15, hz: 0.1, dx: 0, dy: 0.2, dz: -1, lean: 0.9, crouch: 0.2, tuck: 1, bpitch: Math.PI * 2 - 0.4, e: 3 },
    { t: 0.66, ...READY, e: 0 }]),
  drink: C([R0,
    { t: 0.3, hx: -0.28, hy: 0.14, hz: 0.28, dx: 0, dy: -0.2, dz: 1, lg: -0.2, lfree: 1, lx: 0.12, ly: 0.5, lz: 0.32, flask: 1, twist: 0.0, crouch: 0.08, e: 2 },
    { t: 0.75, hx: -0.28, hy: 0.14, hz: 0.28, dx: 0, dy: -0.2, dz: 1, lfree: 1, lx: 0.03, ly: 0.7, lz: 0.2, flask: 1, head: -0.45, lean: -0.1, crouch: 0.08, e: 0 },
    { t: 1.25, hx: -0.28, hy: 0.14, hz: 0.28, dx: 0, dy: -0.2, dz: 1, lfree: 1, lx: 0.03, ly: 0.7, lz: 0.2, flask: 1, head: -0.45, lean: -0.1, crouch: 0.08, e: 3 },
    { t: 1.7, ...READY, lfree: 0, flask: 0, e: 0 }]),
  hit: C([R0,
    { t: 0.1, lean: -0.45, shift: -0.22, hx: -0.2, hy: 0.3, hz: 0.3, twist: -0.3, head: 0.3, e: 2 },
    { t: 0.5, ...READY, e: 0 }]),
  kindle: C([R0,
    { t: 0.5, hx: -0.12, hy: 0.15, hz: 0.45, dx: 0, dy: -0.5, dz: 1, lg: -0.2, crouch: 0.5, lean: 0.55, e: 2 },
    { t: 1.1, hx: -0.12, hy: 0.15, hz: 0.5, dx: 0, dy: -0.95, dz: 0.3, lg: -0.2, crouch: 0.55, lean: 0.6, e: 3 },
    { t: 2.0, ...READY, e: 0 }]),
  rest: C([R0,
    { t: 0.6, hx: -0.12, hy: 0.15, hz: 0.5, dx: 0, dy: -0.95, dz: 0.3, lg: -0.2, crouch: 0.55, lean: 0.35, head: 0.1, e: 2 }]),
  dead: C([R0,
    { t: 0.35, lean: -0.3, hx: -0.3, hy: 0.4, hz: 0.2, bpitch: -0.5, crouch: 0.3, e: 2 },
    { t: 1.1, lean: 0, hx: -0.45, hy: 0.3, hz: 0.1, dx: 0.5, dy: 0.1, dz: 0.5, bpitch: -Math.PI / 2, crouch: 0.77, tuck: 0.2, e: 1 }]),
};

const ATK = {
  l1: { f: FR.l1, dur: 0.8, hs: 0.25, he: 0.38, st: 13, dmg: 32, range: 2.6, arc: 150, cancel: 0.5, roll: 0.5, next: 'l2', lunge: [0.1, 0.34, 2.6], sfx: 'swing', trail: [0.14, 0.5] },
  l2: { f: FR.l2, dur: 0.76, hs: 0.22, he: 0.36, st: 13, dmg: 34, range: 2.6, arc: 170, cancel: 0.46, roll: 0.46, next: 'l3', lunge: [0.08, 0.3, 2.6], sfx: 'swing', trail: [0.1, 0.48] },
  l3: { f: FR.l3, dur: 1.0, hs: 0.3, he: 0.44, st: 17, dmg: 50, range: 3.2, arc: 70, cancel: 0.72, roll: 0.62, next: null, lunge: [0.16, 0.36, 6.0], sfx: 'swing', trail: [0.2, 0.5] },
  heavy: { f: FR.heavy, dur: 1.3, hs: 0.66, he: 0.8, st: 28, dmg: 78, range: 3.0, arc: 130, cancel: 1.05, roll: 1.0, next: null, lunge: [0.5, 0.72, 3.4], sfx: 'swingHeavy', sfxAt: 0.5, poise: true, trail: [0.54, 0.9] },
  ash: { f: FR.ash, dur: 1.55, hs: 0.64, he: 0.72, st: 10, fp: 25, dmg: 110, range: 9.5, arc: 28, cancel: 1.25, roll: 1.2, next: null, lunge: [0.56, 0.74, 15], sfx: 'ash', sfxAt: 0.58, poise: true, line: true, fx: 'wave', trail: [0.58, 0.95] },
  riposte: { f: FR.riposte, dur: 1.75, hs: 0.5, he: 0.52, st: 0, dmg: 105, range: 3, arc: 90, cancel: 1.4, roll: 1.35, next: null, sfx: 'swing', sfxAt: 0.35, trail: [0.38, 0.7] },
};


// ---------------- Großschwert (Waffe des Bosses) ----------------
export const READY_GS = { ...DEF, hx: -0.1, hy: 0.3, hz: 0.42, dx: 0.1, dy: 0.2, dz: 1, lg: -0.22, twist: 0.1, lean: 0.06, crouch: 0.07 };
const CG = (frames) => compile(frames, READY_GS);
const FRG = {
  g1: CG([R0,
    { t: 0.3, hx: 0.3, hy: 0.65, hz: 0.05, dx: 1, dy: 0.1, dz: -0.3, twist: 0.95, crouch: 0.12, e: 2 },
    { t: 0.5, hx: -0.3, hy: 0.55, hz: 0.5, dx: -1, dy: 0.05, dz: 0.5, twist: -1.0, shift: 0.3, crouch: 0.1, e: 1 },
    { t: 0.66, hx: -0.34, hy: 0.52, hz: 0.45, dx: -1, dy: -0.1, dz: 0.2, twist: -1.1, shift: 0.3, e: 2 },
    { t: 1.1, ...READY_GS, e: 0 }]),
  g2: CG([R0,
    { t: 0.3, hx: -0.35, hy: 0.6, hz: 0.0, dx: -1, dy: 0.15, dz: -0.3, twist: -0.95, crouch: 0.12, e: 2 },
    { t: 0.5, hx: 0.3, hy: 0.5, hz: 0.5, dx: 1, dy: -0.1, dz: 0.5, twist: 1.0, shift: 0.3, crouch: 0.1, e: 1 },
    { t: 0.66, hx: 0.34, hy: 0.48, hz: 0.45, dx: 1, dy: -0.15, dz: 0.2, twist: 1.1, shift: 0.3, e: 2 },
    { t: 1.1, ...READY_GS, e: 0 }]),
  g3: CG([R0,
    { t: 0.55, hx: -0.05, hy: 1.0, hz: -0.02, dx: 0, dy: 1, dz: -0.4, lean: -0.4, glow: 0, e: 2 },
    { t: 0.68, hx: -0.1, hy: 0.3, hz: 0.6, dx: 0, dy: -0.6, dz: 1, lean: 0.5, shift: 0.3, crouch: 0.15, e: 1 },
    { t: 0.95, hx: -0.1, hy: 0.28, hz: 0.58, dx: 0, dy: -0.7, dz: 1, lean: 0.45, shift: 0.3, crouch: 0.15, e: 3 },
    { t: 1.5, ...READY_GS, e: 0 }]),
  heavy: CG([R0,
    { t: 0.7, crouch: 0.45, hx: 0, hy: 0.4, hz: 0.1, dx: 0, dy: 1, dz: 0, lean: 0.3, e: 2 },
    { t: 0.98, crouch: -0.05, hx: 0, hy: 1.0, hz: 0.05, dx: 0, dy: 1, dz: -0.2, lean: -0.4, e: 1 },
    { t: 1.14, hx: -0.1, hy: 0.28, hz: 0.6, dx: 0, dy: -0.8, dz: 1, lean: 0.55, crouch: 0.2, shift: 0.4, e: 1 },
    { t: 1.4, hx: -0.1, hy: 0.26, hz: 0.58, dx: 0, dy: -0.85, dz: 1, lean: 0.5, crouch: 0.2, shift: 0.4, e: 3 },
    { t: 1.95, ...READY_GS, e: 0 }]),
  ash: CG([R0,
    { t: 0.7, hx: -0.05, hy: 1.02, hz: -0.04, dx: 0, dy: 1, dz: -0.25, lean: -0.5, glow: 1, e: 2 },
    { t: 0.8, hx: -0.05, hy: 1.04, hz: -0.04, dx: 0, dy: 1, dz: -0.25, lean: -0.55, glow: 1, e: 3 },
    { t: 0.95, hx: -0.1, hy: 0.2, hz: 0.6, dx: 0, dy: -0.8, dz: 1, lean: 0.55, crouch: 0.25, shift: 0.35, glow: 1, e: 1 },
    { t: 1.3, hx: -0.1, hy: 0.2, hz: 0.58, dx: 0, dy: -0.85, dz: 1, lean: 0.5, crouch: 0.25, shift: 0.35, glow: 0.4, e: 3 },
    { t: 1.85, ...READY_GS, glow: 0, e: 0 }]),
  riposte: CG([R0,
    { t: 0.35, hx: -0.22, hy: 0.5, hz: -0.05, dx: 0, dy: 0.1, dz: 1, twist: -0.7, lean: -0.1, crouch: 0.22, shift: -0.1, e: 2 },
    { t: 0.52, hx: -0.06, hy: 0.5, hz: 0.62, dx: 0, dy: -0.05, dz: 1, twist: 0.45, lean: 0.4, shift: 0.4, crouch: 0.24, e: 1 },
    { t: 1.25, hx: -0.06, hy: 0.5, hz: 0.62, dx: 0, dy: -0.05, dz: 1, twist: 0.45, lean: 0.4, shift: 0.4, crouch: 0.24, e: 3 },
    { t: 1.9, ...READY_GS, e: 0 }]),
};
const ATKG = {
  l1: { f: FRG.g1, dur: 1.1, hs: 0.42, he: 0.58, st: 20, dmg: 58, range: 3.5, arc: 175, cancel: 0.7, roll: 0.7, next: 'l2', lunge: [0.25, 0.5, 2.6], sfx: 'swingHeavy', trail: [0.28, 0.66] },
  l2: { f: FRG.g2, dur: 1.1, hs: 0.42, he: 0.58, st: 20, dmg: 62, range: 3.5, arc: 175, cancel: 0.7, roll: 0.7, next: 'l3', lunge: [0.25, 0.5, 2.6], sfx: 'swingHeavy', trail: [0.28, 0.66] },
  l3: { f: FRG.g3, dur: 1.5, hs: 0.64, he: 0.8, st: 28, dmg: 95, range: 3.6, arc: 120, cancel: 1.05, roll: 1.0, next: null, lunge: [0.5, 0.7, 3.4], sfx: 'swingHeavy', sfxAt: 0.5, poise: true, trail: [0.5, 0.95] },
  heavy: { f: FRG.heavy, dur: 1.95, hs: 1.1, he: 1.24, st: 40, dmg: 140, range: 3.9, arc: 150, cancel: 1.55, roll: 1.5, next: null, lunge: [0.9, 1.14, 5.5], sfx: 'swingHeavy', sfxAt: 0.9, poise: true, fx: 'slam', trail: [0.95, 1.4] },
  ash: { f: FRG.ash, dur: 1.85, hs: 0.93, he: 1.0, st: 10, fp: 30, dmg: 150, range: 6.2, arc: 360, cancel: 1.5, roll: 1.4, next: null, sfx: 'roar', sfxAt: 0.55, poise: true, fx: 'flame', trail: [0.8, 1.3] },
  riposte: { f: FRG.riposte, dur: 1.9, hs: 0.55, he: 0.57, st: 0, dmg: 150, range: 3.2, arc: 90, cancel: 1.5, roll: 1.4, next: null, sfx: 'swingHeavy', sfxAt: 0.4, trail: [0.4, 0.8] },
};
const TABLES = { katana: ATK, greatsword: ATKG };
export const WEAPON_INFO = {
  katana: { name: 'Katana', short: 'Katana', ash: 'Unsheathe', fp: 25 },
  greatsword: { name: 'Hadrians Ascheklinge', short: 'Ascheklinge', ash: 'Aschenschlag', fp: 30 },
};

export function createPlayer(G) {
  const { scene, world, fx } = G;
  const h = makeHumanoid({ head: 'hood', cloth: 0x2e2a28, armor: 0x4a4e58, trim: 0x8a7030, accent: 0x7a1a1a, capeColor: 0x3a2626, weapon: 'katana', weapons: ['katana', 'greatsword'], cape: true, tabard: true, plates: true, skin: 0xcaa888, stanceFlip: false });
  scene.add(h.root);
  const trail = new Trail(scene, 0xcfe6ff, 16);

  const P = {
    h, pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), yaw: Math.PI, // schaut nach -Z? (yaw=PI => forward = (0,0,-1))
    weapon: 'katana', owned: { katana: true, greatsword: false }, stats: { vit: 10, mnd: 10, end: 10, str: 10 }, dmgMul: 1,
    maxHp: 300, hp: 300, maxFp: 60, fp: 60, maxSt: 100, st: 100, estus: 5, maxEstus: 5, mana: 3, maxMana: 3, drinkKind: 'estus', souls: 0,
    state: 'free', t: 0, act: null, actName: '', hitSet: new Set(), buf: null, stRegenDelay: 0, exhausted: false,
    parryActive: false, iframes: false, sprinting: false, moving: false, speedN: 0,
    lock: null, camYaw: 0, camPitch: 0.28, camDist: 4.6, camShake: 0,
    spawn: new THREE.Vector3(0, 0, 0), spawnYaw: Math.PI, lastBonfire: null, interact: null,
    prev: { ...READY }, blendT: 0, blendDur: 0.1, pose: { ...READY }, flags: {}, comboT: 0, drankHeal: false, kindleTarget: null,
    hurtTime: 0, parryCd: 0, jumpH: 0, vy: 0, jumpSpeed: 3.4, dead: false, stain: null, radius: 0.42, rollDir: new THREE.Vector3(), walkLock: false, deathT: 0, lastPhase: 0,
  };
  G.player = P;
  P.camYaw = P.yaw;

  const fwd = (y) => new THREE.Vector3(Math.sin(y), 0, Math.cos(y));
  P.setState = (s, opts = {}) => {
    P.prev = { ...P.pose };
    P.state = s; P.t = 0; P.blendT = 0; P.blendDur = opts.blend ?? 0.1; P.flags = {};
  };
  P.useSt = (n) => { P.st = Math.max(0, P.st - n); P.stRegenDelay = 0.75; if (P.st <= 0) P.exhausted = true; };

  // ---------- Eingabe ----------
  const I = G.input;
  P.queue = (name) => { P.buf = { name, ttl: 0.45 }; };
  function readInput(dt) {
    if (P.buf) { P.buf.ttl -= dt; if (P.buf.ttl <= 0) P.buf = null; }
    if (I.pressedMouse[0]) P.queue('light');
    if (I.pressedMouse[2]) P.queue('heavy');
    if (I.pressed.has('ShiftRollTap')) P.queue('roll');
    if (I.pressed.has('Space')) P.queue('jump');
    if (I.pressed.has('KeyF')) P.queue('parry');
    if (I.pressed.has('KeyQ')) P.queue('ash');
    if (I.pressed.has('KeyR')) P.queue('estus');
    if (I.pressed.has('KeyT')) P.queue('mana');
    if (I.pressed.has('KeyE')) P.queue('interact');
    if (I.pressed.has('KeyC')) P.queue('swap');
    if (I.pressed.has('Tab') || I.pressedMouse[1]) toggleLock();
  }

  function moveInput() {
    let ix = 0, iy = 0;
    if (I.keys.has('KeyW')) iy += 1; if (I.keys.has('KeyS')) iy -= 1;
    if (I.keys.has('KeyD')) ix += 1; if (I.keys.has('KeyA')) ix -= 1;
    const l = Math.hypot(ix, iy); if (l > 0) { ix /= l; iy /= l; }
    const f = fwd(P.camYaw), r = new THREE.Vector3(-Math.cos(P.camYaw), 0, Math.sin(P.camYaw));
    const d = new THREE.Vector3().addScaledVector(f, iy).addScaledVector(r, ix);
    return { ix, iy, len: l, dir: d };
  }

  // ---------- Lock-on ----------
  function toggleLock() {
    if (P.lock) { P.lock = null; return; }
    let best = null, bs = 1e9;
    const cf = fwd(P.camYaw);
    for (const e of G.enemies) {
      if (e.dead || e.state === 'dormant' || e.untouchable) continue;
      const d = e.pos.distanceTo(P.pos); if (d > 26) continue;
      const a = Math.abs(angleDiff(P.camYaw, Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z)));
      if (a > 1.6) continue;
      const s = d + a * 12; if (s < bs) { bs = s; best = e; }
    }
    if (best) { P.lock = best; Sound.play('ui'); } else P.camYaw = P.yaw; // Kamera hinter den Spieler
  }

  // ---------- Aktionen ----------
  function canAct() {
    switch (P.state) {
      case 'free': return true;
      case 'attack': return P.t >= P.act.cancel;
      case 'roll': return P.t >= 0.5;
      case 'parry': return P.t >= 0.5;
      case 'parryOk': return P.t >= 0.28;
      case 'hit': return P.t >= 0.34;
      default: return false;
    }
  }
  function canRollCancel() {
    return (P.state === 'attack' && P.t >= P.act.roll) || (P.state === 'parry' && P.t >= 0.38) || (P.state === 'parryOk' && P.t >= 0.2) || (P.state === 'hit' && P.t >= 0.26);
  }
  function faceInput() {
    const m = moveInput();
    if (m.len > 0.1) return Math.atan2(m.dir.x, m.dir.z);
    if (P.lock && !P.lock.dead) return Math.atan2(P.lock.pos.x - P.pos.x, P.lock.pos.z - P.pos.z);
    return P.yaw;
  }
  function assistTarget(range = 3.6, cone = 1.0) {
    let best = null, bd = 1e9;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      if (Math.abs(angleDiff(P.yaw, Math.atan2(dx, dz))) > cone) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function startAttack(name) {
    const a = TABLES[P.weapon][name];
    if (a.fp && P.fp < a.fp) { Sound.play('error'); G.ui.flashFP(); return false; }
    if (P.st <= 0 && a.st > 0) return false;
    P.useSt(a.st); if (a.fp) P.fp -= a.fp;
    const m = moveInput();
    let want = faceInput();
    if (!P.lock && m.len < 0.1) { const t = assistTarget(); if (t) want = Math.atan2(t.pos.x - P.pos.x, t.pos.z - P.pos.z); }
    P.yaw = want;
    P.act = a; P.actName = name; P.hitSet = new Set();
    const chained = P.state === 'attack';
    P.setState('attack', { blend: chained ? 0.06 : 0.04 });
    P.sfxDone = false; P.trailed = false;
    if (a.glow) {}
    if (name === 'ash') Sound.play('ashCharge');
    return true;
  }
  function startRoll() {
    if (P.st <= 0) { return false; }
    P.useSt(20);
    const m = moveInput();
    P.yaw = m.len > 0.1 ? Math.atan2(m.dir.x, m.dir.z) : P.yaw; // ohne Eingabe: nach vorne rollen
    P.rollDir.copy(fwd(P.yaw));
    P.setState('roll', { blend: 0.05 });
    Sound.play('roll');
    return true;
  }
  const PARRY_CD = 1.5; // Sekunden zwischen zwei Parry-Versuchen
  function startParry() {
    if (P.parryCd > 0) { Sound.play('error'); G.ui.flashParry(); return false; }
    if (P.st < 12) { return false; }
    P.useSt(12);
    P.parryCd = PARRY_CD;
    P.yaw = faceInput();
    P.setState('parry', { blend: 0.03 });
    return true;
  }
  function startEstus() {
    if (P.estus <= 0) { Sound.play('error'); G.ui.flashEstus(); return false; }
    if (P.hp >= P.maxHp) return false;
    P.setState('drink', { blend: 0.12 }); P.drankHeal = false; P.flags.gulp = false; P.drinkKind = 'estus'; setFlaskColor(false);
    return true;
  }
  function setFlaskColor(blue) {
    const liq = h.flask.userData.liquid.material, lt = h.flask.userData.light;
    liq.color.set(blue ? 0x4a82ff : 0xff9a2a); liq.emissive.set(blue ? 0x2a5cff : 0xff7a10); lt.color.set(blue ? 0x5a90ff : 0xff9a3a);
  }
  function startMana() {
    if (P.mana <= 0) { Sound.play('error'); G.ui.flashMana(); return false; }
    if (P.fp >= P.maxFp) return false;
    P.setState('drink', { blend: 0.12 }); P.drankHeal = false; P.flags.gulp = false; P.drinkKind = 'mana'; setFlaskColor(true);
    return true;
  }
  function findRiposteTarget() {
    for (const e of G.enemies) {
      if (e.dead || e.state !== 'parried') continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d < 3.4 + e.radius && Math.abs(angleDiff(P.yaw, Math.atan2(dx, dz))) < 1.2) return e;
    }
    return null;
  }
  function startInteract() {
    const it = P.interact;
    if (!it) return false;
    if (it.type === 'bonfire') {
      const b = it.ref; P.kindleTarget = b;
      const dx = b.pos.x - P.pos.x, dz = b.pos.z - P.pos.z;
      P.yaw = Math.atan2(dx, dz);
      const d = Math.hypot(dx, dz);
      P.moveTo = new THREE.Vector3(b.pos.x - (dx / d) * 1.5, 0, b.pos.z - (dz / d) * 1.5);
      P.setState(b.lit ? 'rest' : 'kindle', { blend: 0.2 });
      if (b.lit) restBegin(b);
      return true;
    }
    if (it.type === 'item') { G.pickupWeapon(); return true; }
    if (it.type === 'locked') { Sound.play('error'); G.ui.toast(it.text); return false; }
    if (it.type === 'fog') {
      const g = it.fight.arena.gate;
      P.fogFight = it.fight; P.setState('fogwalk', { blend: 0.2 });
      P.yaw = Math.atan2(-g.nx, -g.nz); P.lock = null;
      G.world.setGateSealed(it.fight.id, false);
      Sound.play('fog');
      return true;
    }
    return false;
  }
  function tryAction(name) {
    switch (name) {
      case 'light': {
        const r = P.state === 'free' || canAct() ? findRiposteTarget() : null;
        if (r) return startRiposte(r);
        if (P.state === 'attack' && P.act.next) return startAttack(P.act.next);
        return startAttack('l1');
      }
      case 'heavy': { const r = findRiposteTarget(); if (r) return startRiposte(r); return startAttack('heavy'); }
      case 'ash': return startAttack('ash');
      case 'roll': return startRoll();
      case 'parry': return startParry();
      case 'estus': return startEstus();
      case 'mana': return startMana();
      case 'interact': return startInteract();
      case 'jump': return startJump();
      case 'swap': return P.cycleWeapon();
    }
    return false;
  }
  function startJump() {
    if (P.state !== 'free' || P.st <= 0) return false;
    P.useSt(10);
    P.jumpSpeed = Math.max(3.4, Math.hypot(P.vel.x, P.vel.z));
    P.vy = 6.4; P.jumpH = 0.001;
    P.setState('jump', { blend: 0.06 });
    Sound.play('roll');
    return true;
  }
  function startRiposte(e) {
    P.yaw = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    const d = e.pos.distanceTo(P.pos);
    const stand = 1.1 + e.radius;
    P.pos.x = e.pos.x - Math.sin(P.yaw) * stand; P.pos.z = e.pos.z - Math.cos(P.yaw) * stand;
    P.act = TABLES[P.weapon].riposte; P.actName = 'riposte'; P.hitSet = new Set(); P.target = e;
    P.setState('attack', { blend: 0.05 }); P.sfxDone = false;
    e.riposteBy(P);
    return true;
  }

  // ---------- Treffer an Gegnern ----------
  function inCone(e, range, arcDeg, yaw = P.yaw) {
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d > range + e.radius) return false;
    const a = Math.abs(angleDiff(yaw, Math.atan2(dx, dz)));
    return a <= (arcDeg * Math.PI) / 360 + Math.atan2(e.radius, Math.max(d, 0.3));
  }
  function applyHits(a) {
    for (const e of G.enemies) {
      if (e.dead || P.hitSet.has(e)) continue;
      let ok;
      if (a.line) {
        const f = fwd(P.yaw), dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
        const along = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
        ok = along > -0.5 && along < a.range && side < 2.4 + e.radius;
      } else ok = inCone(e, a.range, a.arc);
      if (!ok) continue;
      P.hitSet.add(e);
      let dmg = a.dmg * P.dmgMul;
      const behind = Math.abs(angleDiff(e.yaw, Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z))) > 2.3;
      if (behind && (P.actName === 'l1' || P.actName === 'l2' || P.actName === 'l3') && !e.isBoss) { dmg *= 1.5; G.ui.toast('Backstab'); }
      const info = e.hurt(dmg, { poise: !!a.poise, riposte: P.actName === 'riposte', from: P.pos, kind: P.actName });
      if (info === 'dodged') continue;
      if (info !== 'blocked') { P.fp = Math.min(P.maxFp, P.fp + (a.fp ? 0 : 5)); }
      G.hitstop(info === 'blocked' ? 0.04 : (P.actName === 'riposte' || P.actName === 'heavy' || P.actName === 'ash') ? 0.12 : 0.07);
      G.shake(P.actName === 'heavy' || P.actName === 'riposte' ? 0.28 : 0.12);
    }
  }

  function destroyProjectiles(a) {
    for (const pr of G.hazards.projectiles) {
      if (pr.dead || pr.kind !== 'orb' || P.hitSet.has(pr)) continue;
      const dx = pr.pos.x - P.pos.x, dz = pr.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d > a.range + 0.8 || (!a.line && a.arc < 360 && Math.abs(angleDiff(P.yaw, Math.atan2(dx, dz))) > (a.arc * Math.PI) / 360 + 0.5)) continue;
      P.hitSet.add(pr); G.hazards.killProjectile(pr, true); fx.parry(pr.pos); Sound.play('parry'); P.fp = Math.min(P.maxFp, P.fp + 8); G.ui.toast('Orb zerschlagen');
    }
  }

  // ---------- Verletzung ----------
  // gibt 'dodged' | 'parried' | 'hit' zurueck
  P.tryParry = (e, atk) => {
    if (!P.parryActive || !atk.parryable) return false;
    const a = Math.abs(angleDiff(P.yaw, Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z)));
    return a < 1.3;
  };
  P.parried = (e) => {
    P.setState('parryOk', { blend: 0.02 });
    const mid = e.pos.clone().lerp(P.pos, 0.5); mid.y += 1.3;
    fx.parry(mid); Sound.play('parry'); G.shake(0.35); G.hitstop(0.16);
    P.st = Math.min(P.maxSt, P.st + 25); P.exhausted = false;
    P.parryCd = Math.min(P.parryCd, 0.4); // Belohnung: nach gelungenem Parry fast sofort wieder bereit
    e.getParried(P);
  };
  P.hurt = (dmg, from, opts = {}) => {
    if (P.dead) return 'dead';
    if (P.iframes) return 'dodged';
    P.hp -= dmg; P.hurtTime = 0.3;
    G.ui.hurt(); G.shake(0.5); G.hitstop(0.08);
    const p = P.pos.clone(); p.y += 1.2;
    fx.blood(p, 18, new THREE.Vector3(P.pos.x - from.x, 0.2, P.pos.z - from.z).normalize());
    Sound.play('hurt');
    if (P.hp <= 0) { P.hp = 0; die(); return 'hit'; }
    const heavy = dmg > 90 || opts.knock;
    const push = new THREE.Vector3(P.pos.x - from.x, 0, P.pos.z - from.z).normalize().multiplyScalar(heavy ? 7 : 3.5);
    P.vel.copy(push);
    P.setState('hit', { blend: 0.03 }); P.hitDur = heavy ? 0.7 : 0.45;
    trail.clear();
    return 'hit';
  };
  function die() {
    P.dead = true; P.setState('dead', { blend: 0.1 }); P.lock = null; P.deathT = 0;
    Sound.play('died'); G.ui.banner('YOU DIED', 'died'); Sound.bossMusic(false);
    // Seelen fallen lassen
    if (P.souls > 0) { G.dropStain(P.pos, P.souls); P.souls = 0; }
    G.onPlayerDeath();
  }


  // ---------- Attribute / Aufleveln ----------
  P.level = () => P.stats.vit + P.stats.mnd + P.stats.end + P.stats.str - 40 + 1;
  P.levelCost = () => Math.round(120 * 1.17 ** (P.level() - 1));
  P.ashCost = () => WEAPON_INFO[P.weapon].fp;
  P.applyStats = (keepRatio = true) => {
    const r = P.hp / P.maxHp;
    P.maxHp = 300 + (P.stats.vit - 10) * 14; P.maxFp = 60 + (P.stats.mnd - 10) * 5; P.maxSt = 100 + (P.stats.end - 10) * 3;
    P.dmgMul = 1 + (P.stats.str - 10) * 0.035;
    P.hp = keepRatio ? Math.min(P.maxHp, Math.max(1, Math.round(P.maxHp * r))) : P.maxHp;
    P.fp = Math.min(P.fp, P.maxFp); P.st = Math.min(P.st, P.maxSt);
  };
  P.levelUp = (key) => {
    if (!(key in P.stats)) return false;
    const cost = P.levelCost();
    if (P.souls < cost) { Sound.play('error'); return false; }
    P.souls -= cost; P.stats[key]++;
    const hpBefore = P.hp; P.applyStats(true);
    if (key === 'vit') P.hp = Math.min(P.maxHp, hpBefore + 14);
    if (key === 'mnd') P.fp = Math.min(P.maxFp, P.fp + 5);
    Sound.play('souls'); Sound.play('ui');
    return true;
  };
  // ---------- Waffen ----------
  P.setWeapon = (name) => {
    if (!P.owned[name]) return false;
    P.weapon = name; h.setWeapon(name); G.ui.setWeapon(name); trail.clear();
    return true;
  };
  P.cycleWeapon = () => {
    if (P.state !== 'free' && P.state !== 'hit') return false;
    const names = Object.keys(P.owned).filter((n) => P.owned[n]);
    if (names.length < 2) { G.ui.toast('Keine zweite Waffe'); return false; }
    P.setWeapon(names[(names.indexOf(P.weapon) + 1) % names.length]);
    Sound.play('ui'); G.ui.toast(WEAPON_INFO[P.weapon].name);
    G.save && G.save();
    return true;
  };

  // ---------- Leuchtfeuer: Rasten ----------
  function restBegin(b) {
    P.hp = P.maxHp; P.fp = P.maxFp; P.estus = P.maxEstus; P.mana = P.maxMana; P.st = P.maxSt;
    P.spawn.copy(b.pos).add(new THREE.Vector3(Math.sin(P.yaw) * -1.8, 0, Math.cos(P.yaw) * -1.8)); P.spawnYaw = P.yaw; P.lastBonfire = b;
    Sound.play('rest');
    G.restAt(b);
    G.ui.showRest(world.bonfires.filter((x) => x.lit), b);
  }
  P.getUp = () => { G.ui.hideRest(); P.setState('free', { blend: 0.3 }); };
  P.respawn = () => {
    const sp = P.lastBonfire ? P.spawn : new THREE.Vector3(0, 0, 4);
    P.pos.set(sp.x, 0, sp.z); P.yaw = P.lastBonfire ? P.spawnYaw : Math.PI; P.camYaw = P.yaw;
    P.hp = P.maxHp; P.fp = P.maxFp; P.estus = P.maxEstus; P.mana = P.maxMana; P.st = P.maxSt; P.dead = false; P.lock = null;
    P.vel.set(0, 0, 0); P.setState('free', { blend: 0.3 }); P.h.root.visible = true; trail.clear();
  };
  P.warpTo = (b) => {
    P.pos.set(b.pos.x, 0, b.pos.z + 2.6); P.yaw = Math.PI; P.camYaw = P.yaw; P.lastBonfire = b; P.spawn.set(b.pos.x, 0, b.pos.z + 2.6); P.spawnYaw = Math.PI;
    P.state = 'free'; P.vel.set(0, 0, 0);
  };

  // ---------- Update ----------
  const _tmpA = new THREE.Vector3(), _tmpB = new THREE.Vector3();
  P.update = (dt) => {
    readInput(dt);
    if (G.cutscene) P.buf = null;
    const world = G.world;
    P.t += dt;
    P.parryCd = Math.max(0, P.parryCd - dt);
    P.hurtTime = Math.max(0, P.hurtTime - dt);
    P.iframes = false; P.parryActive = false;
    const m = moveInput();
    P.moving = false; P.speedN = 0;
    let moveSpeed = 0, moveDirV = null, turn = true;

    // Stamina-Regeneration
    const sprintWant = I.shiftDown > 0 && performance.now() - I.shiftDown > 250 && m.len > 0.1 && P.state === 'free' && P.st > 0 && !P.exhausted;
    P.sprinting = sprintWant;
    if (P.sprinting) { P.useSt(11 * dt); P.stRegenDelay = 0.4; }
    P.stRegenDelay -= dt;
    if (P.stRegenDelay <= 0 && P.state !== 'dead') {
      const rate = (P.state === 'free' && m.len < 0.1 ? 46 : 34) * (P.exhausted ? 0.6 : 1);
      P.st = Math.min(P.maxSt, P.st + rate * dt);
      if (P.exhausted && P.st > 22) P.exhausted = false;
    }

    // Buffer abarbeiten
    if (P.buf && !P.dead) {
      const b = P.buf.name;
      if (b === 'roll') { if (P.state === 'free' || canRollCancel() || canAct()) { if (startRoll()) P.buf = null; } }
      else if (canAct()) { if (tryAction(b) || b === 'estus' || b === 'interact' || b === 'parry') P.buf = null; }
    }

    // Interaktions-Prompt
    P.interact = null;
    if (P.state === 'free' && !P.dead) {
      for (const b of world.bonfires) {
        if (b.pos.distanceTo(P.pos) < 2.9) { P.interact = { type: 'bonfire', ref: b, text: b.lit ? 'E  Am Leuchtfeuer rasten' : 'E  Leuchtfeuer entfachen' }; break; }
      }
      if (!P.interact && G.drop && P.pos.distanceTo(G.drop.pos) < 2.8) P.interact = { type: 'item', text: 'E  ' + WEAPON_INFO.greatsword.name + ' aufnehmen' };
      if (!P.interact && !G.activeFight) {
        for (const f of G.fights) {
          if (f.dead || !f.enemy) continue;
          const g = f.arena.gate, rx = P.pos.x - g.x, rz = P.pos.z - g.z, along = rx * g.nx + rz * g.nz, lat = Math.abs(rx * g.nz - rz * g.nx);
          if (along > 0 && along < 3.4 && lat < g.w / 2) {
            if (G.isUnlocked(f)) P.interact = { type: 'fog', fight: f, text: 'E  Nebeltor durchschreiten' };
            else { const pv = G.fights[G.fights.indexOf(f) - 1]; P.interact = { type: 'locked', text: 'Versiegelt – besiege zuerst ' + pv.arena.bossName.split(',')[0] }; }
            break;
          }
        }
      }
    }
    G.ui.setPrompt(P.interact && !G.menuOpen && !G.cutscene ? P.interact.text : null);

    // ---------- Zustaende ----------
    switch (P.state) {
      case 'free': {
        let speed = P.sprinting ? 6.4 : P.lock ? 3.1 : 3.6;
        if (m.len > 0.1) {
          moveDirV = m.dir; moveSpeed = speed * (P.exhausted && !P.sprinting ? 0.8 : 1);
          if (P.lock && !P.lock.dead && !P.sprinting) {
            P.yaw = dampAngle(P.yaw, Math.atan2(P.lock.pos.x - P.pos.x, P.lock.pos.z - P.pos.z), 14, dt);
          } else P.yaw = dampAngle(P.yaw, Math.atan2(m.dir.x, m.dir.z), 14, dt);
        } else if (P.lock && !P.lock.dead) P.yaw = dampAngle(P.yaw, Math.atan2(P.lock.pos.x - P.pos.x, P.lock.pos.z - P.pos.z), 14, dt);
        break;
      }
      case 'roll': {
        const k = clamp(P.t / 0.62, 0, 1);
        P.iframes = P.t > 0.05 && P.t < 0.42;
        moveDirV = P.rollDir; moveSpeed = lerp(8.6, 3.0, k * k);
        turn = false;
        if (P.t >= 0.66) P.setState('free', { blend: 0.05 });
        break;
      }
      case 'attack': {
        const a = P.act, t = P.t;
        if (a.lunge && t >= a.lunge[0] && t <= a.lunge[1]) { moveDirV = fwd(P.yaw); moveSpeed = a.lunge[2]; }
        // Drehen vor dem Schlag
        if (t < a.hs - 0.06 && P.actName !== 'riposte') {
          let want = null;
          if (P.lock && !P.lock.dead) want = Math.atan2(P.lock.pos.x - P.pos.x, P.lock.pos.z - P.pos.z);
          else if (m.len > 0.1 && t < 0.15) want = Math.atan2(m.dir.x, m.dir.z);
          if (want !== null) P.yaw = turnToward(P.yaw, want, 5 * dt);
        }
        if (!P.sfxDone && t >= (a.sfxAt ?? a.hs - 0.1)) { P.sfxDone = true; Sound.play(a.sfx); }
        if (t >= a.hs && t <= a.he + 0.01) {
          if (a.fx === 'wave' && !P.flags.wave) { P.flags.wave = true; const p = P.pos.clone(); p.y += 1.1; fx.wave(p, P.yaw, { size: 7 }); fx.flash(p, 0xaad4ff, 90, 0.3); G.shake(0.3); }
          if ((a.fx === 'slam' || a.fx === 'flame') && !P.flags.slam) {
            P.flags.slam = true;
            const big = a.fx === 'flame', c = P.pos.clone().addScaledVector(fwd(P.yaw), big ? 0 : 2.6); c.y = groundHeight(c.x, c.z);
            fx.ring(c, { color: 0xff7a30, r: big ? 8 : 5, dur: 0.6 }); fx.dust(c, big ? 30 : 18);
            fx.add.emit(c, big ? 80 : 40, { vel: big ? 9 : 7, up: 1.4, life: 0.8, size: 0.2, color: [1, 0.5, 0.15], gravity: 10 });
            fx.flash(c.clone().setY(c.y + 1), 0xff7a30, big ? 150 : 100, 0.4); G.shake(big ? 0.7 : 0.5); Sound.play('bossSlam');
          }
          applyHits(a); destroyProjectiles(a);
        }
        if (P.actName === 'riposte' && P.target && !P.flags.rp && t >= a.hs) { P.flags.rp = true; }
        if (t >= a.dur) P.setState('free', { blend: 0.08 });
        break;
      }
      case 'parry': {
        P.parryActive = P.t > 0.03 && P.t < 0.3;
        turn = false;
        if (P.t >= 0.62) { P.setState('free', { blend: 0.06 }); }
        break;
      }
      case 'parryOk': {
        P.iframes = P.t < 0.35; turn = false;
        if (P.t >= 0.5) P.setState('free', { blend: 0.06 });
        break;
      }
      case 'drink': {
        if (m.len > 0.1) { moveDirV = m.dir; moveSpeed = 1.3; P.yaw = dampAngle(P.yaw, Math.atan2(m.dir.x, m.dir.z), 5, dt); }
        if (!P.flags.gulp && P.t > 0.6) { P.flags.gulp = true; Sound.play('gulp'); }
        if (!P.drankHeal && P.t > 1.0) {
          P.drankHeal = true; Sound.play('estusHeal');
          const p = P.pos.clone(); p.y += 1;
          if (P.drinkKind === 'mana') {
            P.mana--; P.fp = Math.min(P.maxFp, P.fp + 40 + (P.stats.mnd - 10) * 2);
            fx.add.emit(p, 30, { vel: 2.5, up: 1.5, life: 1.2, size: 0.14, color: [0.4, 0.6, 1], gravity: -1.5, drag: 1, spread: 0.4 }); fx.flash(p, 0x5a90ff, 30, 0.6);
          } else {
            P.estus--; P.hp = Math.min(P.maxHp, P.hp + 150);
            for (let i = 0; i < 6; i++) fx.heal(p); fx.flash(p, 0xffaa44, 25, 0.6);
          }
        }
        if (P.drankHeal && Math.random() < 0.5) { const p = P.pos.clone(); p.y += 0.2; if (P.drinkKind === 'mana') fx.add.emit(p, 1, { vel: 0.8, up: 1, life: 1.1, size: 0.12, color: [0.4, 0.6, 1], gravity: -2, drag: 0.5, spread: 0.45 }); else fx.heal(p); }
        if (P.t >= 1.7) P.setState('free', { blend: 0.1 });
        break;
      }
      case 'hit': {
        moveDirV = null; P.vel.multiplyScalar(Math.exp(-7 * dt)); turn = false;
        P.pos.addScaledVector(P.vel, dt);
        if (P.t >= (P.hitDur || 0.45)) P.setState('free', { blend: 0.1 });
        break;
      }
      case 'kindle': {
        turn = false;
        if (P.moveTo) { _tmpA.set(P.moveTo.x - P.pos.x, 0, P.moveTo.z - P.pos.z); if (_tmpA.length() > 0.08) { _tmpA.normalize(); moveDirV = _tmpA; moveSpeed = 2.6; } }
        if (!P.flags.lit && P.t > 1.1) { P.flags.lit = true; G.lightBonfire(P.kindleTarget); }
        if (P.t >= 2.0) P.setState('free', { blend: 0.2 });
        break;
      }
      case 'rest': {
        turn = false;
        if (P.moveTo) { _tmpA.set(P.moveTo.x - P.pos.x, 0, P.moveTo.z - P.pos.z); if (_tmpA.length() > 0.08) { _tmpA.normalize(); moveDirV = _tmpA; moveSpeed = 2.6; } }
        break;
      }
      case 'fogwalk': {
        const g = P.fogFight.arena.gate;
        moveDirV = new THREE.Vector3(-g.nx, 0, -g.nz); moveSpeed = 2.4; turn = false; P.iframes = true;
        const along = (P.pos.x - g.x) * g.nx + (P.pos.z - g.z) * g.nz;
        if (along < -3.2) { P.setState('free', { blend: 0.2 }); G.startBoss(P.fogFight); }
        break;
      }
      case 'jump': {
        P.vy -= 19 * dt; P.jumpH += P.vy * dt;
        if (m.len > 0.1) { moveDirV = m.dir; moveSpeed = P.jumpSpeed; P.yaw = dampAngle(P.yaw, Math.atan2(m.dir.x, m.dir.z), 6, dt); }
        if (P.jumpH <= 0 && P.vy < 0) { P.jumpH = 0; P.setState('free', { blend: 0.08 }); Sound.play('step'); G.fx.dust(P.pos, 4); }
        break;
      }
      case 'cutscene': { moveDirV = null; P.iframes = true; turn = false; break; }
      case 'dead': {
        P.deathT += dt;
        break;
      }
    }

    // Bewegung
    if (moveDirV && moveSpeed > 0) {
      const target = _tmpB.copy(moveDirV).normalize().multiplyScalar(moveSpeed);
      const k = P.state === 'roll' || P.state === 'attack' ? 30 : P.state === 'jump' ? 4 : 12;
      P.vel.x = damp(P.vel.x, target.x, k, dt); P.vel.z = damp(P.vel.z, target.z, k, dt);
    } else if (P.state !== 'hit') {
      P.vel.x = damp(P.vel.x, 0, 16, dt); P.vel.z = damp(P.vel.z, 0, 16, dt);
    }
    if (P.state !== 'hit') P.pos.addScaledVector(P.vel, dt);
    world.resolve(P.pos, P.radius);
    // Boss-Gegner schieben
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, d = Math.hypot(dx, dz), rr = P.radius + e.radius;
      if (d < rr && d > 0.001) { const push = (rr - d) * (P.state === 'roll' ? 0.2 : 0.65); P.pos.x += (dx / d) * push; P.pos.z += (dz / d) * push; }
    }
    if (P.state !== 'jump') P.jumpH = 0;
    P.pos.y = groundHeight(P.pos.x, P.pos.z) + P.jumpH;
    const sp = Math.hypot(P.vel.x, P.vel.z);
    P.moving = sp > 0.4 && (P.state === 'free' || P.state === 'drink' || P.state === 'kindle' || P.state === 'rest');
    P.speedN = clamp(sp / 6.4, 0, 1);

    // Seelen einsammeln
    if (G.stain && P.pos.distanceTo(G.stain.pos) < 1.8 && !P.dead) G.pickStain();
    // Schritt-Geraeusche
    if (P.moving) { const ph = Math.floor((P.h.phase) / Math.PI); if (ph !== P.lastPhase) { P.lastPhase = ph; if (P.speedN > 0.2) Sound.play('step'); } }

    // ---------- Pose ----------
    let target;
    switch (P.state) {
      case 'attack': target = sample(P.act.f, P.t, {}); break;
      case 'roll': target = sample(FR.roll, P.t, {}); break;
      case 'parry': target = sample(FR.parry, P.t, {}); break;
      case 'parryOk': target = sample(FR.parryOk, P.t, {}); break;
      case 'drink': target = sample(FR.drink, P.t, {}); break;
      case 'hit': target = sample(FR.hit, P.t, {}); break;
      case 'kindle': target = sample(FR.kindle, P.t, {}); break;
      case 'rest': target = sample(FR.rest, P.t, {}); break;
      case 'dead': target = sample(FR.dead, P.deathT, {}); break;
      case 'jump': target = { ...(P.weapon === 'greatsword' ? READY_GS : READY), tuck: 0.7, lean: 0.15, hx: -0.2, hy: 0.5, hz: 0.3, dx: 0, dy: 0.3, dz: 1 }; break;
      default: {
        target = { ...(P.weapon === 'greatsword' ? READY_GS : READY) };
        const b = Math.sin(performance.now() / 700);
        target.hy += b * 0.008; target.lean += b * 0.01;
        if (P.sprinting) { target.lean = 0.28; target.hx = -0.25; target.hy = 0.2; target.hz = 0.3; target.dx = 0; target.dy = 0.1; target.dz = -1; target.twist = 0; }
        else if (P.moving) { target.lean = 0.12; }
      }
    }
    // Sanfter Uebergang beim Zustandswechsel
    if (P.blendT < 1 && P.blendDur > 0) { P.blendT = Math.min(1, P.blendT + dt / P.blendDur); blendPose(P.prev, target, P.blendT, P.pose); }
    else Object.assign(P.pose, target);
    P.pose.bpitch = wrapPi(P.pose.bpitch); P.pose.twist = wrapPi(P.pose.twist);
    // Gangrichtung relativ zum Koerper
    let lx = 0, lz = 1;
    if (P.moving && sp > 0.1) { const rel = Math.atan2(P.vel.x, P.vel.z) - P.yaw; lz = Math.cos(rel); lx = -Math.sin(rel); }
    h.root.position.copy(P.pos);
    h.root.rotation.y = P.yaw;
    h.update(P.pose, { moving: P.moving && P.state !== 'roll', speed: P.speedN, lx, lz, stance: 1 }, dt);

    // Trail
    const a = P.act;
    if (P.state === 'attack' && a.trail && P.t >= a.trail[0] && P.t <= a.trail[1]) {
      h.root.updateMatrixWorld(true);
      const ud = h.weapon.userData; ud.trailBase.getWorldPosition(_tmpA); ud.trailTip.getWorldPosition(_tmpB);
      trail.setColor(P.weapon === 'greatsword' ? 0xff9a45 : P.actName === 'ash' ? 0x88ccff : 0xcfe6ff);
      trail.push(_tmpA, _tmpB);
    }
    trail.update(dt, P.weapon === 'greatsword' ? 0.3 : P.actName === 'ash' ? 0.35 : 0.2);
    G.updateCamera(dt);
  };
  return P;
}
