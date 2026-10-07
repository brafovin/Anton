import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, angleDiff } from './util.js';
import { buildWorld, groundHeight, ARENA, FOG_GATE } from './world.js';
import { makeFX } from './fx.js';
import { createUI } from './ui.js';
import { createPlayer } from './player.js';
import { Enemy, spawnAll, spawnBoss } from './enemies.js';
import { Sound } from './audio.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const FOG = 0x1d2433;
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, 0.0085);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 700);

// Licht: kaltes Mondlicht + warme Leuchtfeuer
scene.add(new THREE.HemisphereLight(0x9aa8d0, 0x3a342c, 1.7));
const moon = new THREE.DirectionalLight(0xb4c4f0, 2.4);
moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 140 });
moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04;
scene.add(moon, moon.target);
const MOON_DIR = new THREE.Vector3(-0.5, 0.8, 0.35).normalize();

// ------------------------------------------------------------------
const G = { scene, camera, renderer, enemies: [], boss: null, bossEngaged: false, bossDead: false, stain: null, menuOpen: false, running: false, paused: true, time: 0, hitT: 0, shakeAmt: 0 };
window.G = G;
G.world = buildWorld(scene);
G.world.setGateSealed(true);
G.fx = makeFX(scene);
G.input = { keys: new Set(), pressed: new Set(), mouse: [false, false, false], pressedMouse: [false, false, false], shiftDown: 0, dx: 0, dy: 0 };
G.ui = createUI(G);
G.hitstop = (t) => { G.hitT = Math.max(G.hitT, t); };
G.shake = (a) => { G.shakeAmt = Math.max(G.shakeAmt, a); };

// ------------------------------------------------------------------ Gegner
function populate() {
  G.enemies.forEach((e) => e.dispose()); G.enemies = spawnAll(G);
  G.boss = null;
  if (!G.bossDead) { G.boss = spawnBoss(G); G.enemies.push(G.boss); }
  G.bossEngaged = false;
  G.world.setGateSealed(!G.bossDead); G.world.setGateVisible(!G.bossDead);
}
G.player = null;
createPlayer(G);
populate();
const P = G.player;
const startPos = G.world.bonfires[0].pos;
P.pos.set(startPos.x, 0, startPos.z + 3.2); P.spawn.copy(P.pos);
P.pos.y = groundHeight(P.pos.x, P.pos.z);

// ------------------------------------------------------------------ Spielereignisse
G.lightBonfire = (b) => {
  if (b.lit) return;
  b.lit = true; Sound.play('bonfire'); G.ui.banner('LEUCHTFEUER ENTFACHT', 'gold', 4.6);
  G.fx.flash(b.pos.clone().setY(b.pos.y + 1.4), 0xffaa44, 160, 0.9);
  G.fx.add.emit(b.pos.clone().setY(b.pos.y + 0.6), 50, { vel: 4, up: 2, life: 1.4, size: 0.18, color: [1, 0.7, 0.3], gravity: -1 });
  P.lastBonfire = b; P.spawn.copy(b.pos).add(new THREE.Vector3(Math.sin(P.yaw) * -1.8, 0, Math.cos(P.yaw) * -1.8)); P.spawnYaw = P.yaw;
};
G.restAt = (b) => { populate(); };
G.startBoss = () => {
  if (!G.boss) return;
  G.bossEngaged = true; G.world.setGateSealed(true);
  G.boss.setState('intro', 0.3); G.ui.setBoss(G.boss.name, true); Sound.bossMusic(true);
};
G.onBossDefeated = (b) => {
  G.bossDead = true; G.bossEngaged = false;
  G.ui.banner('FEIND GEFALLEN', 'gold', 5.5); Sound.play('victory'); Sound.bossMusic(false); G.ui.setBoss(null, false);
  G.world.setGateSealed(false); G.world.setGateVisible(false);
  G.fx.ring(b.pos.clone(), { color: 0xffe0a0, r: 16, dur: 1.5 }); G.fx.souls(b.pos.clone().setY(2), 120);
  const nb = G.world.makeBonfire(3, 'Arena des Wächters', ARENA.x, ARENA.z + 8); nb.lit = true;
};
G.dropStain = (pos, souls) => {
  if (G.stain) { scene.remove(G.stain.mesh); }
  const g = new THREE.Group(); g.position.set(pos.x, groundHeight(pos.x, pos.z), pos.z);
  const l = new THREE.PointLight(0xffa040, 18, 9, 2); l.position.y = 0.8; g.add(l);
  const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.4, 3.2, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  pil.position.y = 1.6; g.add(pil);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd890 })); dot.position.y = 0.5; g.add(dot);
  scene.add(g); G.stain = { pos: g.position.clone(), souls, mesh: g, dot, pil };
};
G.pickStain = () => {
  const s = G.stain; P.souls += s.souls; G.ui.souls(s.souls); Sound.play('souls'); G.fx.souls(s.pos.clone().setY(1), 30);
  scene.remove(s.mesh); G.stain = null; G.ui.toast('Seelen zurückgeholt');
};
G.onPlayerDeath = () => {
  G.deathTimer = 4.6;
  if (G.bossEngaged) { G.bossEngaged = false; G.ui.setBoss(null, false); }
};

// ------------------------------------------------------------------ Kamera
const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3(), _v = new THREE.Vector3(), _tmp = { x: 0, z: 0 };
let camInit = false;
G.updateCamera = (dt) => {
  const I = G.input, sens = 0.0024;
  P.camYaw -= I.dx * sens; P.camPitch += I.dy * sens; I.dx = I.dy = 0;
  const ak = (I.keys.has('ArrowLeft') ? 1 : 0) - (I.keys.has('ArrowRight') ? 1 : 0), ak2 = (I.keys.has('ArrowDown') ? 1 : 0) - (I.keys.has('ArrowUp') ? 1 : 0);
  P.camYaw += ak * 2.2 * dt; P.camPitch += ak2 * 1.4 * dt;
  if (P.lock && P.lock.dead) P.lock = null;
  if (P.lock && !P.dead) {
    const L = P.lock, dx = L.pos.x - P.pos.x, dz = L.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    if (d > 32) P.lock = null;
    else {
      P.camYaw = dampAngle(P.camYaw, Math.atan2(dx, dz), 6, dt);
      const wantPitch = clamp(0.3 - (L.pos.y + 1 * L.T.scale - (P.pos.y + 1.3)) * 0.05 + (d < 5 ? 0.15 : 0), 0.15, 0.6);
      P.camPitch = damp(P.camPitch, wantPitch, 4, dt);
    }
  }
  P.camPitch = clamp(P.camPitch, -0.25, 1.25);
  const bossFight = G.bossEngaged && G.boss && !G.boss.dead;
  const wantDist = bossFight ? 6.6 : P.lock ? 5.3 : 4.5;
  P.camDist = damp(P.camDist, wantDist, 2.5, dt);
  const sy = P.state === 'roll' ? 1.15 : P.state === 'dead' ? 0.5 : P.state === 'rest' || P.state === 'kindle' ? 1.0 : 1.55;
  _v.set(P.pos.x, P.pos.y + sy, P.pos.z);
  if (!camInit) { camTarget.copy(_v); camInit = true; }
  camTarget.x = damp(camTarget.x, _v.x, 22, dt); camTarget.z = damp(camTarget.z, _v.z, 22, dt); camTarget.y = damp(camTarget.y, _v.y, 8, dt);
  const f = new THREE.Vector3(Math.sin(P.camYaw), 0, Math.cos(P.camYaw)), r = new THREE.Vector3(-Math.cos(P.camYaw), 0, Math.sin(P.camYaw));
  const look = camTarget.clone().addScaledVector(r, 0.55); look.y += 0.1;
  const cp = Math.cos(P.camPitch), sp = Math.sin(P.camPitch);
  let dist = P.camDist;
  // Kamera-Kollision
  for (let s = 1; s <= 10; s++) {
    const k = (s / 10) * dist;
    _tmp.x = look.x - f.x * cp * k; _tmp.z = look.z - f.z * cp * k;
    const ox = _tmp.x, oz = _tmp.z; G.world.resolve(_tmp, 0.35);
    if (Math.abs(_tmp.x - ox) + Math.abs(_tmp.z - oz) > 0.02) { dist = Math.max(1.2, ((s - 1) / 10) * dist); break; }
  }
  camPos.set(look.x - f.x * cp * dist, look.y + sp * dist, look.z - f.z * cp * dist);
  camPos.y = Math.max(camPos.y, groundHeight(camPos.x, camPos.z) + 0.45);
  G.shakeAmt = Math.max(0, G.shakeAmt - dt * 2.2);
  const sh = G.shakeAmt * G.shakeAmt;
  camera.position.copy(camPos).add(_v.set((Math.random() - 0.5) * sh * 0.5, (Math.random() - 0.5) * sh * 0.5, (Math.random() - 0.5) * sh * 0.5));
  camera.lookAt(look);
};

// ------------------------------------------------------------------ Eingabe
const I = G.input;
const prevent = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
addEventListener('keydown', (e) => {
  if (prevent.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  I.keys.add(e.code); I.pressed.add(e.code);
  if (e.code.startsWith('Shift')) I.shiftDown = performance.now();
  if (e.code === 'KeyM') Sound.toggleMute();
  if (e.code === 'Escape' && G.running && !G.paused) pause();
  if (G.menuOpen && G.running) {
    if (['KeyE', 'Enter', 'Space', 'Escape'].includes(e.code)) { P.getUp(); I.pressed.delete(e.code); P.buf = null; }
    const m = /^Digit(\d)$/.exec(e.code);
    if (m) { const b = G.ui.restMap[+m[1] - 1]; if (b) warp(b); }
  }
});
addEventListener('keyup', (e) => {
  I.keys.delete(e.code);
  if (e.code.startsWith('Shift')) { if (I.shiftDown && performance.now() - I.shiftDown < 250) I.pressed.add('ShiftRollTap'); I.shiftDown = 0; }
});
addEventListener('blur', () => { I.shiftDown = 0; I.keys.clear(); I.mouse.fill(false); });
addEventListener('mousedown', (e) => {
  if (!G.running || G.paused) return;
  if (document.pointerLockElement !== canvas && canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch (_) { /* ignore */ } }
  I.mouse[e.button] = true; I.pressedMouse[e.button] = true; if (e.button === 1) e.preventDefault();
});
addEventListener('mouseup', (e) => { I.mouse[e.button] = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { I.dx += e.movementX; I.dy += e.movementY; } });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && wasLocked && G.running && !G.paused) pause();
  wasLocked = locked;
});
function pause() { G.paused = true; document.getElementById('pause').classList.add('show'); if (document.pointerLockElement) document.exitPointerLock(); }
function resume() { document.getElementById('pause').classList.remove('show'); G.paused = false; try { canvas.requestPointerLock && canvas.requestPointerLock(); } catch (_) { /* ignore */ } }
document.getElementById('resume').addEventListener('click', resume);
function start() {
  Sound.init();
  document.getElementById('overlay').classList.remove('show');
  G.running = true; G.paused = false;
  try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
  G.ui.fade(0, 1200);
  setTimeout(() => G.ui.toast('Entfache das Leuchtfeuer'), 800);
}
document.getElementById('start').addEventListener('click', start);
if (new URLSearchParams(location.search).has('autostart')) start();

function warp(b) {
  G.ui.hideRest(); G.ui.fade(1, 500);
  setTimeout(() => { P.warpTo(b); P.setState('free'); populate(); G.ui.fade(0, 900); Sound.play('rest'); camInit = false; }, 600);
}

// ------------------------------------------------------------------ Hauptschleife
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.paused || !G.running) { renderer.render(scene, camera); return; }
  if (G.hitT > 0) { G.hitT -= dt; dt *= 0.06; }
  G.time += dt;
  P.update(dt);
  for (const e of G.enemies) e.update(dt);
  G.world.updateBonfires(G.time, dt, camera.position);
  G.world.updateGate(G.time);
  G.fx.update(dt);
  G.ui.update(dt);
  if (G.stain) { G.stain.dot.position.y = 0.5 + Math.sin(G.time * 2.5) * 0.15; G.stain.pil.rotation.y += dt; }
  // Todes-/Respawn-Ablauf
  if (G.deathTimer > 0) {
    G.deathTimer -= dt;
    if (G.deathTimer < 1.4 && !G.fadedOut) { G.fadedOut = true; G.ui.fade(1, 1200); }
    if (G.deathTimer <= 0) {
      G.fadedOut = false; G.deathTimer = 0;
      P.respawn(); populate(); camInit = false; G.ui.fade(0, 1500);
    }
  }
  // Mond folgt dem Spieler
  moon.position.set(P.pos.x + MOON_DIR.x * 60, P.pos.y + MOON_DIR.y * 60, P.pos.z + MOON_DIR.z * 60); moon.target.position.copy(P.pos);
  G.world.sky.position.copy(camera.position);
  I.pressed.clear(); I.pressedMouse.fill(false);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
