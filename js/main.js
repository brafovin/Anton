import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, angleDiff } from './util.js';
import { buildWorld, groundHeight, GLOW, PLAZA_BONFIRE, regionAt } from './world.js';
import { createHazards } from './hazards.js';
import { createCutscenes } from './cutscene.js';
import { makeSword, makeClub, makeScythe, makeStaff } from './models.js';
import { WEAPON_INFO, CLASSES, blankOwned } from './player.js';
import { createSpells, SPELLS } from './spells.js';
import { makeFX } from './fx.js';
import { createUI } from './ui.js';
import { createPlayer } from './player.js';
import { Enemy, spawnAll, spawnBoss, spawnMinis, MINIS } from './enemies.js';
import { Sound } from './audio.js';
import { createGfx, QUALITY } from './gfx.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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
const hemi = new THREE.HemisphereLight(0x9aa8d0, 0x3a342c, 1.1);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xb4c4f0, 2.4);
moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 140 });
moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04;
scene.add(moon, moon.target);
// schwaches Gegenlicht (Rim) aus der Gegenrichtung des Mondes: hebt Silhouetten von Rüstungen ab
const rim = new THREE.DirectionalLight(0x7088c8, 0.7); rim.position.set(30, 14, -24); scene.add(rim);
const MOON_DIR = new THREE.Vector3(-0.5, 0.8, 0.35).normalize();

// ------------------------------------------------------------------
const G = { scene, camera, renderer, enemies: [], boss: null, fights: [], activeFight: null, stain: null, menuOpen: false, running: false, paused: true, time: 0, hitT: 0, shakeAmt: 0 };
window.G = G; G.moon = moon;
G.world = buildWorld(scene);
G.fights = G.world.arenas.map((A) => ({ id: A.id, arena: A, dead: false, enemy: null }));
G.fx = makeFX(scene);
G.gfx = createGfx(G); G.gfx.buildEnvironment();
{ let q = 'high'; try { q = localStorage.getItem('aschenfeuer-gfx') || 'high'; } catch (e) { /* ignore */ } G.gfx.setQuality(QUALITY[q] ? q : 'high', false); }
G.hazards = createHazards(G);
G.spells = createSpells(G);
G.cutscene = null; G.timeScale = 1; G.minis = {}; G.pickups = []; G.ride = null; G.region = null;
G.input = { keys: new Set(), pressed: new Set(), mouse: [false, false, false], pressedMouse: [false, false, false], shiftDown: 0, dx: 0, dy: 0 };
G.ui = createUI(G);
G.cutscenes = createCutscenes(G);
G.hitstop = (t) => { G.hitT = Math.max(G.hitT, t); };
G.shake = (a) => { G.shakeAmt = Math.max(G.shakeAmt, a); };

// ------------------------------------------------------------------ Gegner
// Feste Boss-Reihenfolge: Hadrian -> Morwen -> Gorm -> Vael. Ein Tor oeffnet sich erst, wenn der Vorgaenger besiegt ist.
G.isUnlocked = (f) => { const i = G.fights.indexOf(f); return f.dead || i === 0 || G.fights[i - 1].dead; };
G.refreshGates = () => {
  for (const f of G.fights) {
    G.world.setGateSealed(f.id, !f.dead); G.world.setGateVisible(f.id, !f.dead);
    G.world.setGateLocked(f.id, !f.dead && !G.isUnlocked(f));
  }
};
function populate() {
  const P = G.player;
  G.enemies.forEach((e) => e.dispose()); G.enemies = spawnAll(G);
  G.hazards.clear(); G.spells.clear();
  G.boss = null; G.activeFight = null;
  for (const f of G.fights) {
    f.enemy = null;
    if (!f.dead) { f.enemy = spawnBoss(G, f); G.enemies.push(f.enemy); }
  }
  G.enemies.push(...spawnMinis(G));
  G.refreshGates();
  if (G.fights[0].dead && !P.owned.greatsword) G.spawnDrop(G.fights[0].arena.x, G.fights[0].arena.z - 2);
  // Beute besiegter Minibosse, die noch nicht eingesammelt wurde
  for (const M of MINIS) {
    if (!(G.minis[M.id] && G.minis[M.id].dead)) continue;
    const Rg = G.world.regions.find((r) => r.id === M.region);
    M.reward.forEach((it, i) => { if (!(it.w ? P.owned[it.w] : P.spells.includes(it.s))) G.spawnPickup(Rg.x + (i - (M.reward.length - 1) / 2) * 2.6, Rg.z + 3, it); });
  }
}
G.player = null;
createPlayer(G);
const P = G.player;

// ------------------------------------------------------------------ Speicherstand
const LEGACY_KEY = 'aschenfeuer-save-v1';
const SLOT_COUNT = 5, SLOT_PREFIX = 'aschenfeuer-slot-', LAST_SLOT_KEY = 'aschenfeuer-lastslot';
const slotKey = (i) => SLOT_PREFIX + i;
G.slot = 1; // aktiver Spielstand-Slot (1..SLOT_COUNT)
G.SLOT_COUNT = SLOT_COUNT;
G.readSlot = (i) => { try { return JSON.parse(localStorage.getItem(slotKey(i)) || 'null'); } catch (e) { return null; } };
G.deleteSlot = (i) => { try { localStorage.removeItem(slotKey(i)); } catch (e) { /* ignore */ } };
// Alter Einzel-Spielstand wandert in den ersten freien Slot
try {
  const old = localStorage.getItem(LEGACY_KEY);
  if (old) {
    let target = 0;
    for (let i = 1; i <= SLOT_COUNT; i++) if (!G.readSlot(i)) { target = i; break; }
    if (target) { localStorage.setItem(slotKey(target), old); localStorage.setItem(LAST_SLOT_KEY, String(target)); }
    localStorage.removeItem(LEGACY_KEY);
  }
} catch (e) { /* ignore */ }
G.lastSlot = () => {
  let n = 1; try { n = parseInt(localStorage.getItem(LAST_SLOT_KEY), 10) || 1; } catch (e) { /* ignore */ }
  n = clamp(n, 1, SLOT_COUNT);
  if (!G.readSlot(n)) for (let i = 1; i <= SLOT_COUNT; i++) if (G.readSlot(i)) return i; // Fallback: erster vorhandener Slot
  return n;
};
G.save = () => {
  try {
    localStorage.setItem(slotKey(G.slot), JSON.stringify({
      ts: Date.now(), finished: !!G.ended, cls: P.cls, spellIdx: P.spellIdx, spellIdx2: P.spellIdx2, stats: P.stats, souls: P.souls, owned: P.owned, spells: P.spells, minis: Object.keys(G.minis).filter((k) => G.minis[k].dead), weapon: P.weapon, maxEstus: P.maxEstus, maxMana: P.maxMana,
      dead: G.fights.filter((f) => f.dead).map((f) => f.id), seen: G.fights.filter((f) => f.introSeen || f.dead).map((f) => f.id), lit: G.world.bonfires.filter((b) => b.lit).map((b) => b.id), last: P.lastBonfire ? P.lastBonfire.id : null,
    }));
    localStorage.setItem(LAST_SLOT_KEY, String(G.slot));
  } catch (e) { /* Speichern nicht moeglich */ }
};
function ensureArenaBonfire(f) {
  const A = f.arena;
  let nb = G.world.bonfires.find((b) => b.id === A.bonfire.id);
  if (!nb) nb = G.world.makeBonfire(A.bonfire.id, A.bonfire.name, A.x - A.nx * 2, A.z - A.nz * 2 + (A.id === 'hadrian' ? 10 : 0));
  return nb;
}
G.allFourDead = () => G.fights.slice(0, 4).every((f) => f.dead);
function ensurePlazaBonfire() {
  let b = G.world.bonfires.find((x) => x.id === PLAZA_BONFIRE.id);
  if (!b) b = G.world.makeBonfire(PLAZA_BONFIRE.id, PLAZA_BONFIRE.name, PLAZA_BONFIRE.x, PLAZA_BONFIRE.z);
  return b;
}
G.hasSave = (() => { for (let i = 1; i <= SLOT_COUNT; i++) if (G.readSlot(i)) return true; return false; })();
const startPos = G.world.bonfires[0].pos;
function placePlayer() {
  if (P.lastBonfire) P.warpTo(P.lastBonfire);
  else { P.pos.set(startPos.x, 0, startPos.z + 3.2); P.spawn.copy(P.pos); P.yaw = Math.PI; }
  P.pos.y = groundHeight(P.pos.x, P.pos.z); P.camYaw = P.yaw; if (G.snapCamera) G.snapCamera();
}
// Spielstand laden (nur aus dem frischen Hauptmenue heraus)
G.loadGame = (slot = G.lastSlot()) => {
  const saved = G.readSlot(slot);
  if (!saved) return false;
  G.slot = slot;
  P.applyClass(saved.cls || 'ninja');
  Object.assign(P.stats, saved.stats || {}); P.souls = saved.souls || 0;
  P.owned = { ...blankOwned(), ...(saved.owned || {}) };
  if (Array.isArray(saved.spells)) P.spells = saved.spells.filter((id) => SPELLS[id]);
  G.minis = {}; for (const id of saved.minis || []) G.minis[id] = { dead: true };
  if (saved.maxEstus !== undefined) { P.maxEstus = saved.maxEstus; P.maxMana = saved.maxMana ?? P.maxMana; }
  P.estus = P.maxEstus; P.mana = P.maxMana;
  const dead = new Set(saved.dead || (saved.bossDead ? ['hadrian'] : []));
  for (const f of G.fights) { if (dead.has(f.id)) { f.dead = true; ensureArenaBonfire(f); } if ((saved.seen || []).includes(f.id) || dead.has(f.id)) f.introSeen = true; }
  G.ended = !!saved.finished;
  if (G.allFourDead()) ensurePlazaBonfire();
  for (const b of G.world.bonfires) if ((saved.lit || []).includes(b.id)) { b.lit = true; b.blend = 1; }
  if (saved.last !== null && saved.last !== undefined) P.lastBonfire = G.world.bonfires.find((b) => b.id === saved.last) || null;
  if (P.owned[saved.weapon]) P.setWeapon(saved.weapon);
  P.spellIdx = clamp(saved.spellIdx || 0, 0, Math.max(0, P.spells.length - 1)); P.spellIdx2 = clamp(saved.spellIdx2 ?? 1, 0, Math.max(0, P.spells.length - 1)); G.ui.setSpells(P);
  P.applyStats(false); populate(); placePlayer();
  return true;
};
G.newGame = (clsId, slot = G.slot) => {
  G.slot = slot; G.deleteSlot(slot);
  P.applyClass(clsId); P.souls = 0; P.hp = P.maxHp; P.fp = P.maxFp; placePlayer(); G.save();
};

// ------------------------------------------------------------------ Boss-Waffe (Beute)
// Beute: Waffen und Zauber liegen als leuchtende Gegenstaende am Boden (Boss- und Miniboss-Belohnungen)
const pickupMesh = (item) => {
  const g = new THREE.Group(), col = item.s ? SPELLS[item.s].color : item.w === 'mondklinge' ? 0x6a98ff : item.w === 'staff' ? 0xa070ff : item.w === 'sichel' ? 0xc090ff : 0xff9a40;
  const l = new THREE.PointLight(col, 40, 14, 2); l.position.y = 1.2; g.add(l);
  let obj;
  if (item.s) obj = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.6, roughness: 0.3 }));
  else {
    obj = item.w === 'staff' ? makeStaff() : item.w === 'keule' ? makeClub() : item.w === 'sichel' ? makeScythe()
      : item.w === 'mondklinge' ? makeSword({ len: 1.2, width: 0.11, color: 0xb4ccf4, rusty: false, glow: 0.9, glowColor: 0x4a78ff })
        : makeSword({ len: 1.45, width: 0.15, color: 0x3a3438, rusty: false, glow: 0.9 });
    obj.scale.setScalar(item.w === 'keule' ? 0.4 : item.w === 'staff' || item.w === 'sichel' ? 0.5 : 0.55); obj.rotation.z = Math.PI;
  }
  obj.position.y = 1.4; g.add(obj);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW.fire, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); halo.scale.set(3.2, 3.2, 1); halo.position.y = 1.2; g.add(halo);
  const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.5, 4, 10, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); pil.position.y = 2; g.add(pil);
  return { g, obj };
};
G.spawnPickup = (x, z, item) => {
  const key = item.w || item.s;
  if (G.pickups.some((p) => p.key === key)) return;
  const { g, obj } = pickupMesh(item); g.position.set(x, groundHeight(x, z), z); scene.add(g);
  G.pickups.push({ key, item, pos: g.position.clone(), mesh: g, obj, label: item.s ? SPELLS[item.s].name + ' (Zauber)' : WEAPON_INFO[item.w].name });
};
G.spawnDrop = (x, z) => G.spawnPickup(x, z, { w: 'greatsword' });
G.pickup = (pk) => {
  const it = pk.item; scene.remove(pk.mesh); G.pickups = G.pickups.filter((p) => p !== pk);
  if (it.w) {
    P.owned[it.w] = true; if (it.w === 'staff' && !P.spells.length) P.spells.push('pfeil');
    P.setWeapon(it.w); G.ui.banner('WAFFE ERHALTEN', 'gold', 4.5); G.ui.toast(WEAPON_INFO[it.w].name + ' – mit C Waffe wechseln');
  } else {
    if (!P.spells.includes(it.s)) P.spells.push(it.s);
    G.ui.setSpells(P); G.ui.banner('ZAUBER ERHALTEN', 'gold', 4.5);
    G.ui.toast(SPELLS[it.s].name + (P.owned.staff ? ' – mit dem Zauberstab wirken' : ' – benötigt einen Zauberstab (Beute im Nebelmoor)'));
  }
  Sound.play('victory'); G.fx.souls(P.pos.clone().setY(P.pos.y + 1), 40);
  G.save();
};
G.onMiniDefeated = (e) => {
  const M = e.mini; G.minis[M.id] = { dead: true };
  G.ui.banner('FEIND GEFALLEN', 'gold', 4.2); Sound.play('victory');
  G.fx.ring(e.pos.clone(), { color: 0xffe0a0, r: 10, dur: 1.2 }); G.fx.souls(e.pos.clone().setY(2), 60);
  M.reward.forEach((it, i) => G.spawnPickup(e.pos.x + (i - (M.reward.length - 1) / 2) * 2.6, e.pos.z, it));
  G.save();
};
populate();
placePlayer();

// ------------------------------------------------------------------ Spielereignisse
G.lightBonfire = (b) => {
  if (b.lit) return;
  b.lit = true; Sound.play('bonfire'); G.ui.banner('LEUCHTFEUER ENTFACHT', 'gold', 4.6);
  G.fx.flash(b.pos.clone().setY(b.pos.y + 1.4), 0xffaa44, 160, 0.9);
  G.fx.add.emit(b.pos.clone().setY(b.pos.y + 0.6), 50, { vel: 4, up: 2, life: 1.4, size: 0.18, color: [1, 0.7, 0.3], gravity: -1 });
  P.lastBonfire = b; P.spawn.copy(b.pos).add(new THREE.Vector3(Math.sin(P.yaw) * -1.8, 0, Math.cos(P.yaw) * -1.8)); P.spawnYaw = P.yaw;
  G.save();
};
G.restAt = (b) => { populate(); G.save(); };
G.startBoss = (f) => {
  if (!f || !f.enemy) return;
  G.activeFight = f; G.boss = f.enemy; G.world.setGateSealed(f.id, true);
  f.enemy.setState('intro', 0.3);
  if (f.introSeen) { // Wiederholung (z. B. nach dem Tod): keine Cutscene, nur kurzes Brüllen
    f.enemy.cd = 0.8; G.ui.setBoss(f.arena.bossName, true); Sound.bossMusic(true); G.ui.banner(f.arena.bossName.split(',')[0].toUpperCase(), 'gold', 3);
    return;
  }
  f.introSeen = true; G.save(); // Cutscene nur beim ersten Mal
  G.cutscenes.playIntro(f, () => { f.enemy.setState('chase', 0.3); f.enemy.cd = Math.max(f.enemy.cd, 0.8); G.ui.setBoss(f.arena.bossName, true); });
};
// Folgen eines besiegten Bosses: nach dem vierten Boss Teleport zum Thron, nach dem König das Ende
G.afterBoss = (f) => {
  if (f.id === 'king') G.showEnding();
  else if (f.id === 'vael' && G.allFourDead()) {
    ensurePlazaBonfire(); G.ui.banner('DER FAHRSTUHL ERWACHT', 'gold', 5.5); Sound.play('victory');
    setTimeout(() => G.ui.toast('Im Burghof wartet ein Fahrstuhl zum Thronsaal des Königs'), 3200);
  }
};
// Fahrstuhl: unten im Burghof (nach den vier Waechtern nutzbar), oben im Vorhof des Thronsaals (Rueckfahrt jederzeit)
G.liftOpen = (l) => l.id === 'high' || G.allFourDead();
G.useLift = (l) => {
  if (G.ride || !G.liftOpen(l)) return;
  const up = l.id === 'low', dest = G.world.lifts[up ? 'high' : 'low'];
  P.setState('cutscene'); P.lock = null; P.vel.set(0, 0, 0); P.pos.x = l.x; P.pos.z = l.z;
  G.ride = { l, dest, up, t: 0, dur: up ? 9 : 3.4, faded: false };
  Sound.play('fog'); G.ui.toast(up ? 'Der Fahrstuhl setzt sich in Bewegung …' : 'Der Fahrstuhl senkt sich …');
};
function updateRide(dt) {
  const r = G.ride, l = r.l; r.t += dt;
  const k = clamp(r.t / r.dur, 0, 1), e = k * k * (3 - 2 * k), W = G.world;
  const rise = r.up ? (W.liftTopY - l.y0) * e : -3.2 * e;
  l.cab.position.y = -0.18 + rise;
  P.liftY = l.y0 + 0.02 + rise - groundHeight(l.x, l.z); P.pos.x = l.x; P.pos.z = l.z;
  G.shake(r.up ? 0.07 : 0.05);
  if (!r.faded && k > (r.up ? 0.84 : 0.55)) { r.faded = true; G.ui.fade(1, r.up ? 1400 : 900, r.up ? '#fff' : '#000'); }
  if (k < 1) return;
  l.cab.position.y = -0.18; P.liftY = 0; G.ride = null;
  const d = r.dest; P.pos.set(d.x, groundHeight(d.x, d.z), d.z); P.vel.set(0, 0, 0);
  P.setState('free'); P.yaw = r.up ? Math.PI : 0; P.camYaw = P.yaw; if (G.snapCamera) G.snapCamera();
  if (r.up) {
    const b = ensurePlazaBonfire(); b.lit = true; b.blend = 1;
    P.hp = P.maxHp; P.fp = P.maxFp; P.st = P.maxSt; P.estus = P.maxEstus; P.mana = P.maxMana; P.lastBonfire = b; P.spawn.copy(b.pos).add(new THREE.Vector3(0, 0, 2)); P.spawnYaw = Math.PI;
    G.ui.banner('THRONSAAL-VORHOF', 'gold', 4.2); populate(); G.save();
    setTimeout(() => G.ui.toast('Tritt durch das Nebeltor, wenn du bereit bist'), 3200);
  } else G.ui.toast('Zurück im Burghof');
  G.ui.fade(0, 1800, r.up ? '#fff' : '#000');
}
G.updateRide = updateRide;
G.teleportToKing = () => { const l = G.world.lifts.low; G.useLift(l); };
G.showEnding = () => {
  G.ended = true; G.save();
  const C = CLASSES[P.cls];
  document.getElementById('ending-stats').textContent = `${C.name} · Level ${P.level()} · ${Math.round(P.souls).toLocaleString('de-DE')} Seelen`;
  document.getElementById('ending').classList.add('show'); G.paused = true; if (document.pointerLockElement) document.exitPointerLock();
  Sound.play('victory');
};
G.onBossDefeated = (b) => {
  const f = b.fight; if (!f) return;
  f.dead = true; G.activeFight = null; G.refreshGates();
  G.ui.banner('FEIND GEFALLEN', 'gold', 5.5); Sound.play('victory'); Sound.bossMusic(false); G.ui.setBoss(null, false);
  G.hazards.clear();
  G.enemies.filter((o) => o.minion && !o.dead).forEach((o) => o.die());
  G.fx.ring(b.pos.clone(), { color: 0xffe0a0, r: 16, dur: 1.5 }); G.fx.souls(b.pos.clone().setY(2), 120);
  ensureArenaBonfire(f).lit = true;
  if (!P.dead) G.cutscenes.playOutro(f, b, () => G.afterBoss(f)); else G.pendingAfter = f;
  const rw = f.arena.reward, msgs = [];
  if (rw === 'greatsword') G.spawnDrop(f.arena.x, f.arena.z - 2);
  const total = () => P.maxEstus + P.maxMana;
  if ((rw === 'estus' || rw === 'both') && total() < 14) { P.maxEstus++; P.estus = Math.min(P.maxEstus, P.estus + 1); msgs.push('Estus-Flasche +1 (HP: ' + P.maxEstus + ')'); }
  if ((rw === 'mana' || rw === 'both') && total() < 14) { P.maxMana++; P.mana = Math.min(P.maxMana, P.mana + 1); msgs.push('Aschen-Flasche +1 (FP: ' + P.maxMana + ')'); }
  const nxt = G.fights[G.fights.indexOf(f) + 1];
  if (nxt && !nxt.dead) setTimeout(() => G.ui.toast('Das Nebeltor von ' + nxt.arena.bossName.split(',')[0] + ' öffnet sich'), msgs.length ? 6200 : 2500);
  if (msgs.length) setTimeout(() => G.ui.toast(msgs.join(' · ')), 2500);
  G.save();
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
  if (G.activeFight) { G.activeFight = null; G.ui.setBoss(null, false); }
  G.hazards.clear();
};

// ------------------------------------------------------------------ Kamera
const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3(), _v = new THREE.Vector3(), _tmp = { x: 0, z: 0 };
let camInit = false;
G.snapCamera = () => { camInit = false; };
G.updateCamera = (dt) => {
  if (G.cutscene) return;
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
  const bossFight = G.activeFight && G.boss && !G.boss.dead;
  const wantDist = bossFight ? G.activeFight.arena.camDist : P.lock ? 5.3 : 4.5;
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
  if (G.cutscene && ['Space', 'Enter', 'KeyE', 'Escape'].includes(e.code)) { G.cutscenes.skip(); return; }
  I.keys.add(e.code); I.pressed.add(e.code);
  if (e.code.startsWith('Shift')) I.shiftDown = performance.now();
  if (e.code === 'KeyM') Sound.toggleMute();
  if (e.code === 'Escape' && G.running && !G.paused) pause();
  if (G.menuOpen && G.running) {
    const mode = G.ui.menuMode, back = () => G.ui.showRest(G.ui.restCtx.lit, G.ui.restCtx.current);
    if (mode === 'level') {
      const m = /^Digit([1-4])$/.exec(e.code);
      if (m) { if (P.levelUp(['vit', 'mnd', 'end', 'str'][+m[1] - 1])) G.save(); G.ui.showLevel(); }
      else if (['KeyE', 'KeyU', 'Enter', 'Escape', 'Space'].includes(e.code)) back();
    } else if (mode === 'flask') {
      if (e.code === 'Digit1' || e.code === 'ArrowRight') { if (P.allocFlask(+1)) G.save(); G.ui.showFlask(); }
      else if (e.code === 'Digit2' || e.code === 'ArrowLeft') { if (P.allocFlask(-1)) G.save(); G.ui.showFlask(); }
      else if (['KeyE', 'KeyF', 'Enter', 'Escape', 'Space'].includes(e.code)) back();
    } else {
      if (e.code === 'KeyU') { G.ui.showLevel(); }
      else if (e.code === 'KeyF') { G.ui.showFlask(); }
      else if (['KeyE', 'Enter', 'Space', 'Escape'].includes(e.code)) { P.getUp(); I.pressed.delete(e.code); P.buf = null; }
      const m = /^Digit(\d)$/.exec(e.code);
      if (m) { const b = G.ui.restMap[+m[1] - 1]; if (b) warp(b); }
    }
    I.pressed.delete(e.code); P.buf = null;
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
addEventListener('resize', () => { G.gfx.resize(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && wasLocked && G.running && !G.paused) pause();
  wasLocked = locked;
});
const $ = (id) => document.getElementById(id);
function pause() { G.paused = true; $('pause-msg').textContent = `Spielstand-Slot ${G.slot}`; $('pause').classList.add('show'); if (document.pointerLockElement) document.exitPointerLock(); }
function resume() { $('pause').classList.remove('show'); G.paused = false; try { canvas.requestPointerLock && canvas.requestPointerLock(); } catch (_) { /* ignore */ } }
$('resume').addEventListener('click', resume);
$('btn-save').addEventListener('click', () => { G.save(); $('pause-msg').textContent = `Gespeichert in Slot ${G.slot}.`; Sound.play('ui'); });
$('btn-menu').addEventListener('click', () => { G.save(); location.href = location.pathname; });

document.querySelectorAll('.gfxbtn').forEach((b) => { b.textContent = 'Grafik: ' + G.gfx.label(); b.addEventListener('click', () => { G.gfx.cycle(); Sound.play('ui'); document.querySelectorAll('.gfxbtn').forEach((x) => { x.textContent = 'Grafik: ' + G.gfx.label(); }); }); });
// ---- Hauptmenue: Neues Spiel / Spiel laden / Klassenwahl ----
const CLASS_ORDER = ['ninja', 'magier', 'ritter'];
let chosenClass = 'ninja';
const statBar = (v) => `<i><b style="width:${Math.min(100, (v / 20) * 100)}%"></b></i>`;
document.querySelectorAll('.card').forEach((card) => {
  const C = CLASSES[card.dataset.cls];
  const st = C.stats, lvl = st.vit + st.mnd + st.end + st.str - 40 + 1;
  card.innerHTML = `<h3>${C.name}</h3><div class="tag">${C.tagline} · Level ${lvl}</div><p>${C.desc}</p>
    <div class="cstats"><span>Vitalität</span>${statBar(st.vit)}<span>${st.vit}</span><span>Geist</span>${statBar(st.mnd)}<span>${st.mnd}</span><span>Ausdauer</span>${statBar(st.end)}<span>${st.end}</span><span>Stärke</span>${statBar(st.str)}<span>${st.str}</span></div>
    <ul>${C.kit.map((k) => `<li>${k}</li>`).join('')}</ul>`;
  card.addEventListener('click', () => selectClass(card.dataset.cls));
});
function selectClass(id) {
  chosenClass = id; Sound.play('ui');
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.cls === id));
  P.applyClass(id); P.pos.set(startPos.x, groundHeight(startPos.x, startPos.z + 3.2), startPos.z + 3.2); P.yaw = Math.PI; // 3D-Vorschau
}
function showScreen(name) {
  G.menu = name; document.body.classList.toggle('inmenu', !!name);
  $('overlay').classList.toggle('show', name === 'title'); $('classes').classList.toggle('show', name === 'classes'); $('slots').classList.toggle('show', name === 'slots');
}
const slotLevel = (sv) => Object.values(sv.stats || { a: 10, b: 10, c: 10, d: 10 }).reduce((x, y) => x + y, 0) - 40 + 1;
const slotSummary = (sv) => `${(CLASSES[sv.cls] || CLASSES.ninja).name} · Level ${slotLevel(sv)} · Bosse ${(sv.dead || (sv.bossDead ? ['x'] : [])).length}/5${sv.finished ? ' · Durchgespielt ✓' : ''}`;
const slotDate = (sv) => { if (!sv.ts) return ''; const d = new Date(sv.ts); return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
function refreshTitle() {
  const n = Array.from({ length: SLOT_COUNT }, (_, i) => G.readSlot(i + 1)).filter(Boolean).length;
  G.hasSave = n > 0;
  $('btn-load').disabled = !n;
  $('save-info').textContent = n ? `${n} Spielstand${n > 1 ? 'stände' : ''} vorhanden.` : 'Kein Spielstand vorhanden.';
  const last = G.readSlot(G.lastSlot());
  P.applyClass(last ? (last.cls || 'ninja') : 'ninja');
}
// ---- Spielstand-Slots: mode 'load' (laden/loeschen) oder 'new' (Slot fuer neues Spiel waehlen) ----
let slotMode = 'load', pendingDelete = 0;
function renderSlots() {
  $('slots-title').textContent = slotMode === 'new' ? 'Neues Spiel – Slot wählen' : 'Spielstand laden';
  $('slots-sub').textContent = slotMode === 'new' ? 'Ein belegter Slot wird überschrieben.' : '';
  const list = $('slot-list'); list.innerHTML = '';
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const sv = G.readSlot(i);
    const row = document.createElement('div'); row.className = 'svslot' + (sv ? '' : ' empty');
    const main = document.createElement('button'); main.className = 'svslot-main';
    main.disabled = slotMode === 'load' && !sv;
    main.innerHTML = `<span class="svslot-n">${i}</span><span class="svslot-txt"><b>${sv ? slotSummary(sv) : 'Leer'}</b><small>${sv ? slotDate(sv) : (slotMode === 'new' ? 'Neuen Spielstand anlegen' : '')}</small></span>`;
    main.addEventListener('click', () => {
      Sound.play('ui');
      if (slotMode === 'load') { if (G.loadGame(i)) start(); }
      else {
        G.slot = i;
        $('cl-warn').textContent = sv ? `Achtung: Slot ${i} wird überschrieben.` : `Neuer Spielstand in Slot ${i}.`;
        showScreen('classes'); selectClass(chosenClass);
      }
    });
    row.appendChild(main);
    if (sv) {
      const del = document.createElement('button'); del.className = 'svslot-del ghost';
      del.textContent = pendingDelete === i ? 'Sicher?' : 'Löschen';
      del.addEventListener('click', () => {
        Sound.play('ui');
        if (pendingDelete === i) { G.deleteSlot(i); pendingDelete = 0; refreshTitle(); if (!G.hasSave && slotMode === 'load') { showScreen('title'); return; } }
        else pendingDelete = i;
        renderSlots();
      });
      row.appendChild(del);
    }
    list.appendChild(row);
  }
}
function openSlots(mode) { slotMode = mode; pendingDelete = 0; renderSlots(); showScreen('slots'); }
refreshTitle(); showScreen('title');
$('btn-controls').addEventListener('click', () => $('controls').classList.toggle('hidden'));
$('btn-new').addEventListener('click', () => openSlots('new'));
$('btn-load').addEventListener('click', () => openSlots('load'));
$('btn-slots-back').addEventListener('click', () => { showScreen('title'); refreshTitle(); });
$('btn-back').addEventListener('click', () => { openSlots('new'); P.applyClass('ninja'); });
$('btn-begin').addEventListener('click', () => { G.newGame(chosenClass, G.slot); start(); });

function start() {
  Sound.init();
  showScreen(null); G.menu = null;
  G.running = true; G.paused = false;
  try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
  G.ui.fade(0, 1200);
  setTimeout(() => G.ui.toast(P.lastBonfire ? 'Willkommen zurück' : 'Entfache das Leuchtfeuer'), 800);
}
{
  const q = new URLSearchParams(location.search);
  if (q.has('autostart')) { const sl = parseInt(q.get('slot'), 10) || G.lastSlot(); if (!G.loadGame(sl)) G.newGame(q.get('class') || 'ninja', sl); start(); }
}

$('btn-continue').addEventListener('click', () => { $('ending').classList.remove('show'); G.paused = false; try { canvas.requestPointerLock && canvas.requestPointerLock(); } catch (_) { /* ignore */ } });
$('btn-end-menu').addEventListener('click', () => { G.save(); location.href = location.pathname; });
// Mausrad: Zauber wechseln (Magier)
addEventListener('wheel', (e) => { if (G.running && !G.paused && !G.menuOpen && !G.cutscene) P.cycleSpell(e.deltaY > 0 ? 1 : -1); }, { passive: true });

function warp(b) {
  G.ui.hideRest(); G.ui.fade(1, 500);
  setTimeout(() => { P.warpTo(b); P.setState('free'); populate(); G.ui.fade(0, 900); Sound.play('rest'); camInit = false; }, 600);
}

// ------------------------------------------------------------------ Menue-Kamera (3D-Vorschau der Klasse)
function menuUpdate(dt) {
  if (!G.menu) return;
  G.time += dt; P.preview(dt); G.world.updateBonfires(G.time, dt, camera.position); G.world.updateGate(G.time); G.fx.update(dt);
  const classes = G.menu === 'classes', a = P.yaw + (classes ? 0.5 + Math.sin(G.time * 0.4) * 0.35 : Math.PI + Math.sin(G.time * 0.25) * 0.5), R = classes ? 6.2 : 6.5;
  camera.position.set(P.pos.x + Math.sin(a) * R, P.pos.y + (classes ? 1.1 : 1.7), P.pos.z + Math.cos(a) * R);
  camera.lookAt(P.pos.x, P.pos.y + (classes ? -0.9 : 1.5), P.pos.z - (classes ? 0 : 2));
  moon.position.set(P.pos.x + MOON_DIR.x * 60, P.pos.y + MOON_DIR.y * 60, P.pos.z + MOON_DIR.z * 60); moon.target.position.copy(P.pos);
  G.world.sky.position.copy(camera.position);
}

// ------------------------------------------------------------------ Hauptschleife
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.paused || !G.running) { menuUpdate(dt); G.fx.ambient.update(now / 1000, camera.position); G.gfx.render(dt); return; }
  const realDt = dt;
  if (G.hitT > 0) { G.hitT -= dt; dt *= 0.06; }
  if (G.cutscene) dt *= G.cutscene.slow;
  G.time += dt;
  P.update(dt);
  for (const e of G.enemies) e.update(dt);
  G.world.updateBonfires(G.time, dt, camera.position);
  G.world.updateGate(G.time);
  G.hazards.update(dt);
  G.spells.update(dt);
  G.fx.update(dt);
  G.cutscenes.update(realDt);
  G.ui.update(dt);
  for (const pk of G.pickups) { pk.obj.rotation.y += dt * 1.2; pk.obj.position.y = 1.4 + Math.sin(G.time * 2) * 0.12; }
  if (G.ride) updateRide(dt);
  G.world.updateLifts(G.time, G.allFourDead());
  { const rg = regionAt(P.pos.x, P.pos.z); const id = rg ? rg.id : null; if (id !== G.region) { G.region = id; if (rg && !G.cutscene && !P.dead) G.ui.banner(rg.name.toUpperCase(), 'gold', 3.4); } }
  if (G.stain) { G.stain.dot.position.y = 0.5 + Math.sin(G.time * 2.5) * 0.15; G.stain.pil.rotation.y += dt; }
  // Todes-/Respawn-Ablauf
  if (G.deathTimer > 0) {
    G.deathTimer -= dt;
    if (G.deathTimer < 1.4 && !G.fadedOut) { G.fadedOut = true; G.ui.fade(1, 1200); }
    if (G.deathTimer <= 0) {
      G.fadedOut = false; G.deathTimer = 0;
      P.respawn(); populate(); camInit = false; G.ui.fade(0, 1500);
      if (G.pendingAfter) { const f = G.pendingAfter; G.pendingAfter = null; setTimeout(() => G.afterBoss(f), 1500); }
    }
  }
  // Mond folgt dem Spieler
  moon.position.set(P.pos.x + MOON_DIR.x * 60, P.pos.y + MOON_DIR.y * 60, P.pos.z + MOON_DIR.z * 60); moon.target.position.copy(P.pos);
  G.world.sky.position.copy(camera.position);
  I.pressed.clear(); I.pressedMouse.fill(false);
  G.fx.ambient.update(now / 1000, camera.position);
  G.gfx.render(realDt);
}
requestAnimationFrame(frame);
