import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, angleDiff, turnToward, rand, pick } from './util.js';
import { makeHumanoid, compile, sample, blendPose, DEF } from './models.js';
import { Sound } from './audio.js';
import { groundHeight, ARENA } from './world.js';

const fwd = (y) => new THREE.Vector3(Math.sin(y), 0, Math.cos(y));

// ------------------------- Basis-Posen -------------------------
const IDLE = {
  hollow: { ...DEF, hx: -0.3, hy: 0.2, hz: 0.3, dx: 0.05, dy: 0.1, dz: 1, lfree: 1, lx: 0.3, ly: 0.1, lz: 0.12, lean: 0.05, twist: 0, crouch: 0.03 },
  knight: { ...DEF, hx: -0.2, hy: 0.38, hz: 0.38, dx: 0.1, dy: 0.7, dz: 0.8, lfree: 1, lx: 0.22, ly: 0.42, lz: 0.42, lean: 0.03, twist: 0.2, crouch: 0.04 },
  boss: { ...DEF, hx: -0.1, hy: 0.3, hz: 0.42, dx: 0.1, dy: 0.15, dz: 1, lg: -0.32, lean: 0.05, twist: 0.1, crouch: 0.06 },
};
const REACT = { // Torso-Reaktionen
  stagger: (b) => compile([{ t: 0 }, { t: 0.12, lean: -0.5, shift: -0.2, hx: b.hx - 0.1, hy: b.hy + 0.2, head: 0.4, e: 2 }, { t: 0.55, ...b, e: 0 }], b),
  parried: (b) => compile([{ t: 0 }, { t: 0.18, lean: -0.5, shift: -0.25, hx: -0.3, hy: 0.85, hz: 0.1, dx: -0.4, dy: 0.8, dz: -0.4, twist: -0.6, head: 0.5, lfree: 0, e: 2 }, { t: 3, lean: -0.55, twist: -0.65, e: 3 }], b),
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
};

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
    hp: 1700, radius: 1.3, speed: 3.4, aggro: 99, souls: 8000, scale: 1.75, attacks: ['bSweep', 'bSlam', 'bThrust'], idle: IDLE.boss, isBoss: true, strafe: true,
    look: { head: 'greathelm', skin: 0x888888, cloth: 0x181410, armor: 0x2c2a30, trim: 0xb8962e, accent: 0x7a1a1a, capeColor: 0x4a1414, cape: true, tabard: false, plates: true, weapon: 'greatsword', bulk: 1.2, eye: 0xff6a10 },
  },
};

export class Enemy {
  constructor(G, type, x, z, yaw = 0) {
    this.G = G; this.type = type; const T = TYPES[type]; this.T = T;
    this.isBoss = !!T.isBoss; this.radius = T.radius * (this.isBoss ? 1 : 1); this.maxHp = T.hp; this.hp = T.hp;
    this.home = new THREE.Vector3(x, 0, z); this.homeYaw = yaw;
    this.pos = new THREE.Vector3(x, groundHeight(x, z), z); this.yaw = yaw; this.vel = new THREE.Vector3();
    this.h = makeHumanoid({ ...T.look, scale: T.scale });
    G.scene.add(this.h.root);
    this.state = this.isBoss ? 'dormant' : 'idle'; this.t = 0; this.cd = rand(0.5, 1.5); this.dead = false; this.deathT = 0;
    this.pose = { ...T.idle }; this.prev = { ...T.idle }; this.blendT = 1; this.blendDur = 0.12;
    this.barT = 0; this.strafeDir = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0; this.atk = null; this.timeScale = 1;
    this.phase2 = false; this.idlePh = rand(6.28); this.yOff = 0; this.souls = T.souls; this.leapFrom = new THREE.Vector3(); this.leapTo = new THREE.Vector3();
    this.moving = false; this.speedN = 0; this.name = this.isBoss ? 'Sir Hadrian, Wächter der Asche' : type === 'knight' ? 'Wachritter' : 'Hohler Soldat';
    this.wanderT = rand(2, 5); this.wanderYaw = yaw; this.fadeT = 0;
  }
  setState(s, blend = 0.1) { this.prev = { ...this.pose }; this.state = s; this.t = 0; this.blendT = 0; this.blendDur = blend; }
  dispose() { this.G.scene.remove(this.h.root); this.h.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }

  aggroNow() { if (this.state === 'idle' || this.state === 'return') this.setState('chase', 0.2); }

  // ---------------- Schaden / Reaktionen ----------------
  hurt(dmg, { poise = false, riposte = false, from = null, kind = '' } = {}) {
    if (this.dead) return 'dead';
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
    if (riposte && this.isBoss) dmg *= 1.8;
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
    G.player.souls += this.souls; G.ui.souls(this.souls); G.fx.souls(this.pos.clone().setY(this.pos.y + 1), 24); Sound.play('souls');
    if (G.player.lock === this) G.player.lock = null;
    if (this.isBoss) G.onBossDefeated(this);
  }

  // ---------------- Angriff ----------------
  startAttack(name) {
    const a = ATTACKS[name]; this.atk = a; this.atkName = name; this.setState('attack', 0.1);
    this.hitDone = false; this.sfx = false; this.flags = {};
    if (a.leap) { this.leapFrom.copy(this.pos); }
  }
  attackUpdate(dt) {
    const G = this.G, P = G.player, a = this.atk, ts = this.timeScale;
    const t = this.t * ts;
    const toP = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    if (t < a.track) this.yaw = turnToward(this.yaw, toP, (this.isBoss ? 2.4 : 2.8) * dt * ts);
    if (a.lunge && t >= a.lunge[0] && t <= a.lunge[1]) { const f = fwd(this.yaw); this.pos.x += f.x * a.lunge[2] * dt * ts; this.pos.z += f.z * a.lunge[2] * dt * ts; }
    if (!this.sfx && t >= a.hs - 0.22) { this.sfx = true; Sound.play(this.isBoss ? 'swingHeavy' : 'swing'); }
    // Sprung
    if (a.leap) {
      if (t >= 0.8 && t < 1.5) {
        if (!this.flags.jump) { this.flags.jump = true; this.leapTo.copy(P.pos); const d = this.leapTo.clone().sub(this.pos); const L = d.length(); if (L > 14) d.multiplyScalar(14 / L); this.leapTo.copy(this.pos).add(d); const ar = Math.hypot(this.leapTo.x - ARENA.x, this.leapTo.z - ARENA.z); if (ar > ARENA.r - 3) { const k = (ARENA.r - 3) / ar; this.leapTo.x = ARENA.x + (this.leapTo.x - ARENA.x) * k; this.leapTo.z = ARENA.z + (this.leapTo.z - ARENA.z) * k; } this.leapFrom.copy(this.pos); }
        const u = (t - 0.8) / 0.7; this.pos.x = lerp(this.leapFrom.x, this.leapTo.x, Math.min(u, 1)); this.pos.z = lerp(this.leapFrom.z, this.leapTo.z, Math.min(u, 1));
        this.yOff = Math.sin(clamp(u, 0, 1) * Math.PI) * 5.5;
      } else this.yOff = 0;
    }
    // Parade-Erkennung (leicht frueher als der Treffer, damit Parry fair wirkt)
    if (a.parryable && !this.hitDone && t >= a.hs - 0.16 && t <= a.he) {
      const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
      if (d < a.range + 1.2 && P.tryParry(this, a)) { this.hitDone = true; P.parried(this); return; }
    }
    if (!this.hitDone && t >= a.hs && t <= a.he) {
      const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      let hit = false;
      if (a.arc >= 360) hit = d < a.range && P.pos.y < this.pos.y + 1.2;
      else hit = d < a.range + P.radius && Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz))) < (a.arc * Math.PI) / 360 + 0.1;
      if (a.slam && !this.flags.slamFx) {
        this.flags.slamFx = true;
        const f = fwd(this.yaw), c = this.pos.clone().addScaledVector(f, 3.8); c.y = groundHeight(c.x, c.z);
        G.fx.ring(c, { color: 0xff7a30, r: 8, dur: 0.6 }); G.fx.dust(c, 24); G.fx.add.emit(c, 40, { vel: 8, up: 1, life: 0.7, size: 0.2, color: [1, 0.5, 0.15], gravity: 10 }); G.fx.flash(c.clone().setY(c.y + 1), 0xff7a30, 120, 0.4);
        G.shake(0.7); Sound.play('bossSlam');
        // Aufschlagpunkt statt Kegel
        const dd = Math.hypot(P.pos.x - c.x, P.pos.z - c.z); hit = dd < 4.4;
      }
      if (a.leap && !this.flags.land) { this.flags.land = true; this.yOff = 0; const c = this.pos.clone(); c.y = groundHeight(c.x, c.z); G.fx.ring(c, { color: 0xff7a30, r: 11, dur: 0.7 }); G.fx.dust(c, 40); G.fx.add.emit(c, 60, { vel: 9, up: 1.5, life: 0.8, size: 0.22, color: [1, 0.5, 0.15], gravity: 10 }); G.fx.flash(c.clone().setY(c.y + 1), 0xff7a30, 140, 0.5); G.shake(1.0); Sound.play('bossSlam'); }
      if (hit) { this.hitDone = true; P.hurt(a.dmg, this.pos, { knock: this.isBoss }); }
      else if (a.slam || a.leap) this.hitDone = true;
    }
    if (a.leap && t < a.hs && t >= 1.5) { /* Landung abwarten */ }
    if (this.t * ts >= a.dur) { this.yOff = 0; this.setState('recover', 0.15); this.recoverT = this.isBoss ? rand(0.25, 0.7) : rand(0.4, 1.0); this.cd = this.isBoss ? rand(0.3, 0.9) : rand(0.8, 1.8); }
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
    this.cd -= dt;
    let moveDir = null, speed = 0, target = null;
    const spdMul = this.phase2 ? 1.25 : 1;
    this.timeScale = this.phase2 ? 1.2 : 1;
    switch (this.state) {
      case 'idle': {
        this.wanderT -= dt; if (this.wanderT <= 0) { this.wanderT = rand(3, 7); this.wanderYaw = this.homeYaw + rand(-1, 1); }
        this.yaw = dampAngle(this.yaw, this.wanderYaw, 1.5, dt);
        if (!P.dead && dist < T.aggro && !(G.bossEngaged && !this.isBoss)) {
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
        const reach = this.isBoss ? 5.2 : this.type === 'knight' ? 2.8 : 2.4;
        if (dist > reach + 0.6) { moveDir = fwd(this.yaw); speed = T.speed * spdMul * (dist > 12 && !this.isBoss ? 1.25 : 1); }
        else if (this.cd <= 0) { this.startAttack(this.chooseAttack(dist)); break; }
        else if (T.strafe) {
          this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rand(0.8, 1.8); this.strafeDir = Math.random() < 0.5 ? 1 : -1; }
          const r = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).multiplyScalar(this.strafeDir);
          moveDir = r.addScaledVector(fwd(this.yaw), dist < reach - 0.4 ? -0.5 : 0.15); speed = T.speed * 0.5 * spdMul; this.strafing = true;
        }
        // Boss: weite Distanz -> Sturmstoss
        if (this.isBoss && dist > 11 && this.cd <= 0) this.startAttack(Math.random() < 0.5 || !this.phase2 ? 'bThrust' : 'bLeap');
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
        target = sample(REACT.parried(T.idle), this.t, {});
        if (this.t >= this.parriedDur) { this.setState('chase', 0.2); this.cd = 0.2; }
        break;
      }
      case 'riposted': {
        target = sample(REACT.stagger(T.idle), Math.min(this.t, 0.12) + 0.0, {});
        this.riposteT -= dt;
        if (this.t >= 1.25 || this.riposteT <= 0) { this.setState('stagger', 0.1); this.staggerDur = 0.8; this.cd = 0.8; }
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
        if (!this.flags?.roar && this.t > 0.8) { this.flags = { roar: true }; Sound.play('roar'); G.shake(0.6); }
        target = null;
        if (this.t >= 2.8) { this.setState('chase', 0.3); this.cd = 0.8; }
        break;
      }
      case 'phase': {
        this.yaw = turnToward(this.yaw, toP, 2 * dt);
        if (this.t >= 2.2) { this.setState('chase', 0.3); this.cd = 0.5; }
        break;
      }
    }
    // Phasenwechsel
    if (this.isBoss && !this.phase2 && this.hp < this.maxHp * 0.5 && this.state !== 'dormant' && this.state !== 'riposted' && this.state !== 'parried') {
      this.phase2 = true; this.setState('phase', 0.2); this.atk = null; this.yOff = 0; Sound.play('roar'); G.shake(0.8);
      G.fx.ring(this.pos.clone(), { color: 0xff6a20, r: 12, dur: 1.0 }); G.ui.toast('Der Wächter entflammt');
      this.h.weapon.userData.glowMats.forEach((m) => { m.emissiveIntensity = 1.6; });
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
    G.world.resolve(this.pos, this.radius * 0.9);
    if (this.isBoss && this.state !== 'dormant') { // Boss bleibt in der Arena
      const ar = Math.hypot(this.pos.x - ARENA.x, this.pos.z - ARENA.z);
      if (ar > ARENA.r - 2.2) { const k = (ARENA.r - 2.2) / ar; this.pos.x = ARENA.x + (this.pos.x - ARENA.x) * k; this.pos.z = ARENA.z + (this.pos.z - ARENA.z) * k; }
    }
    this.pos.y = groundHeight(this.pos.x, this.pos.z);
    this.speedN = clamp(Math.hypot(this.vel.x, this.vel.z) / 5, 0, 1);
    if (this.isBoss) { // Warnleuchten: rot = nicht parierbar
      const st = this.h.weapon.userData.steel;
      const warn = this.state === 'attack' && this.atk.danger && this.t * this.timeScale < this.atk.hs + 0.05;
      if (warn) { st.emissive.setRGB(1, 0.05, 0.02); st.emissiveIntensity = 2.5 + Math.sin(this.t * 30); }
      else { st.emissive.setRGB(1, 0.35, 0.05); st.emissiveIntensity = this.phase2 ? 1.2 + Math.sin(performance.now() / 150) * 0.3 : 0.35; }
    }
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
  // Burghof
  ['hollow', -14, -70, 0], ['hollow', 15, -72, 0], ['knight', -18, -92, 0.2], ['knight', 18, -98, -0.3], ['hollow', 0, -98, 0], ['hollow', -9, -106, 0.5], ['hollow', 10, -108, -0.5],
];
export function spawnAll(G) {
  const list = SPAWNS.map(([t, x, z, y]) => new Enemy(G, t, x, z, y));
  return list;
}
export function spawnBoss(G) { return new Enemy(G, 'boss', ARENA.x, ARENA.z - 6, 0); }
