import * as THREE from 'three';
import { clamp, rand } from './util.js';
import { Sound } from './audio.js';
import { groundHeight, GLOW } from './world.js';

// ---------------------------------------------------------------------------
//  Zauber des Magiers (mit dem Stab ausgewaehlt wie in Elden Ring: Mausrad / 1-5, Q wirkt)
// ---------------------------------------------------------------------------
export const SPELLS = {
  pfeil:   { id: 'pfeil',   name: 'Seelenpfeil',     fp: 9,  cast: 0.42, color: 0x7fb8ff, kind: 'proj', desc: 'Schneller Pfeil, folgt dem Ziel' },
  kugel:   { id: 'kugel',   name: 'Flammenkugel',    fp: 16, cast: 0.70, color: 0xff7a30, kind: 'ball', desc: 'Explodiert, bricht Deckung' },
  blitz:   { id: 'blitz',   name: 'Blitzschlag',     fp: 22, cast: 0.90, color: 0xcfe0ff, kind: 'bolt', desc: 'Schlägt am Ziel ein' },
  heilung: { id: 'heilung', name: 'Heilendes Licht', fp: 28, cast: 1.10, color: 0xffe08a, kind: 'heal', self: true, desc: 'Stellt HP wieder her' },
  schild:  { id: 'schild',  name: 'Aschenschild',    fp: 20, cast: 0.80, color: 0x9ad0ff, kind: 'ward', self: true, desc: 'Halbiert Schaden für 10 s' },
  // Zauber aus der offenen Welt (Beute der Minibosse)
  frost:   { id: 'frost',   name: 'Frostsplitter',   fp: 18, cast: 0.60, color: 0x9ae0ff, kind: 'fan',  desc: 'Fächer aus Eissplittern' },
  lanze:   { id: 'lanze',   name: 'Blitzlanze',      fp: 26, cast: 0.80, color: 0xb8c8ff, kind: 'lance', desc: 'Durchbohrt alles in einer Linie' },
  nova:    { id: 'nova',    name: 'Glutnova',        fp: 30, cast: 0.90, color: 0xff6a20, kind: 'nova', self: true, desc: 'Flammenring um dich herum' },
};

const discGeo = new THREE.CircleGeometry(1, 32); discGeo.rotateX(-Math.PI / 2);

export function createSpells(G) {
  const { scene, fx } = G;
  const S = { shots: [], bolts: [], beams: [] };
  const fwd = (y) => new THREE.Vector3(Math.sin(y), 0, Math.cos(y));
  const mul = () => 1 + (G.player.stats.mnd - 10) * 0.045;
  const alive = (e) => !e.dead && !e.untouchable && e.state !== 'dormant';

  function muzzle() {
    const P = G.player; P.h.root.updateMatrixWorld(true);
    const ud = P.h.weapon.userData, out = new THREE.Vector3(); (ud.orb || ud.trailTip).getWorldPosition(out); return out;
  }
  function target() {
    const P = G.player;
    if (P.lock && !P.lock.dead) return P.lock;
    let best = null, bd = 1e9;
    for (const e of G.enemies) {
      if (!alive(e)) continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d > 20) continue;
      const a = Math.abs(((Math.atan2(dx, dz) - P.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (a > 0.7) continue; // Winkel zur Blickrichtung (unbeachtet als Abstand)
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function shoot(spell, o) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW.fire, color: spell.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.scale.setScalar(o.size); scene.add(sp);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW.fire, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); core.scale.setScalar(o.size * 0.45); sp.add(core);
    S.shots.push({ sp, spell, pos: o.pos.clone(), vel: o.dir.clone().normalize().multiplyScalar(o.speed), speed: o.speed, life: o.life, r: o.r, dmg: o.dmg, homing: o.homing || 0, target: o.target || null, dead: false });
  }
  function explode(pos, r, dmg, color) {
    const p = pos.clone(); p.y = Math.max(p.y, groundHeight(p.x, p.z) + 0.2);
    fx.ring(p, { color, r: r * 1.8, dur: 0.5 }); fx.dust(p, 16); fx.add.emit(p, 40, { vel: 7, up: 1.4, life: 0.7, size: 0.2, color: [1, 0.55, 0.2], gravity: 8 });
    fx.flash(p.clone().setY(p.y + 1), color, 110, 0.35); G.shake(0.35); Sound.play('bossSlam');
    for (const e of G.enemies) { if (!alive(e)) continue; if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < r + e.radius) hit(e, dmg, true, p); }
  }
  function hit(e, dmg, poise, from) {
    e.hurt(dmg * mul(), { poise, from: { x: from.x, y: from.y, z: from.z }, kind: 'spell' });
    G.hitstop(0.05);
  }

  // ---- Wirken ----
  S.fire = (spell) => {
    const P = G.player, m = muzzle(), t = target();
    const aimYaw = t ? Math.atan2(t.pos.x - P.pos.x, t.pos.z - P.pos.z) : P.yaw;
    if (spell.kind === 'proj') {
      const dir = new THREE.Vector3(Math.sin(aimYaw), t ? ((t.pos.y + 1.1) - m.y) / Math.max(4, Math.hypot(t.pos.x - m.x, t.pos.z - m.z)) : 0, Math.cos(aimYaw));
      shoot(spell, { pos: m, dir, speed: 28, life: 1.3, r: 0.6, dmg: 55, size: 1.1, homing: t ? 5 : 0, target: t }); Sound.play('swing'); fx.flash(m, spell.color, 40, 0.2);
    } else if (spell.kind === 'ball') {
      const dir = new THREE.Vector3(Math.sin(aimYaw), t ? ((t.pos.y + 1.0) - m.y) / Math.max(5, Math.hypot(t.pos.x - m.x, t.pos.z - m.z)) : -0.02, Math.cos(aimYaw));
      shoot(spell, { pos: m, dir, speed: 15, life: 1.8, r: 0.9, dmg: 80, size: 2.0, homing: t ? 1.2 : 0, target: t }); Sound.play('ash'); fx.flash(m, spell.color, 70, 0.3);
    } else if (spell.kind === 'bolt') {
      let x, z;
      if (t) { x = t.pos.x + (t.vel ? t.vel.x * 0.25 : 0); z = t.pos.z + (t.vel ? t.vel.z * 0.25 : 0); }
      else { const f = fwd(P.yaw); x = P.pos.x + f.x * 8; z = P.pos.z + f.z * 8; }
      const y = groundHeight(x, z) + 0.1, g = new THREE.Group(); g.position.set(x, y, z);
      const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: spell.color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); disc.scale.setScalar(2.4); g.add(disc);
      scene.add(g); S.bolts.push({ g, disc, x, z, y, t: 0, struck: false, spell, beam: null });
      Sound.play('ashCharge');
    } else if (spell.kind === 'fan') {
      for (let i = -2; i <= 2; i++) {
        const a = aimYaw + i * 0.13, dir = new THREE.Vector3(Math.sin(a), t ? ((t.pos.y + 1.1) - m.y) / Math.max(5, Math.hypot(t.pos.x - m.x, t.pos.z - m.z)) : 0, Math.cos(a));
        shoot(spell, { pos: m, dir, speed: 27, life: 0.95, r: 0.55, dmg: 30, size: 0.9 });
      }
      Sound.play('swing'); fx.flash(m, spell.color, 50, 0.2);
    } else if (spell.kind === 'lance') {
      const f = fwd(aimYaw), len = 17, o = P.pos.clone(); o.y += 1.2;
      const geo = new THREE.CylinderGeometry(0.22, 0.22, len, 8, 1, true); geo.translate(0, len / 2, 0);
      const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: spell.color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      beam.position.copy(o); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.x, 0, f.z)); scene.add(beam); S.beams.push({ beam, t: 0 });
      fx.flash(o, spell.color, 140, 0.3); G.shake(0.3); Sound.play('ash'); Sound.play('parry');
      for (const e of G.enemies) {
        if (!alive(e)) continue;
        const dx = e.pos.x - o.x, dz = e.pos.z - o.z, along = dx * f.x + dz * f.z, lat = Math.abs(dx * f.z - dz * f.x);
        if (along > 0 && along < len && lat < 1.3 + e.radius) { hit(e, 105, true, P.pos); fx.sparks(new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z), 14); }
      }
    } else if (spell.kind === 'nova') {
      const c = P.pos.clone(); c.y = groundHeight(c.x, c.z);
      fx.ring(c, { color: spell.color, r: 7, dur: 0.6 }); fx.ring(c, { color: 0xffd080, r: 4.5, dur: 0.45 }); fx.dust(c, 18); fx.add.emit(c.clone().setY(c.y + 0.5), 60, { vel: 8, up: 1.2, life: 0.8, size: 0.22, color: [1, 0.5, 0.15], gravity: 4 });
      fx.flash(c.clone().setY(c.y + 1), spell.color, 150, 0.4); G.shake(0.5); Sound.play('bossSlam'); Sound.play('ash');
      for (const e of G.enemies) { if (!alive(e)) continue; if (Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < 6.6 + e.radius) hit(e, 95, true, c); }
    } else if (spell.kind === 'heal') {
      const heal = Math.round(110 * (1 + (P.stats.mnd - 10) * 0.03));
      P.hp = Math.min(P.maxHp, P.hp + heal); Sound.play('estusHeal');
      const p = P.pos.clone(); p.y += 1; for (let i = 0; i < 8; i++) fx.heal(p); fx.add.emit(p, 30, { vel: 2.5, up: 1.5, life: 1.2, size: 0.15, color: [1, 0.9, 0.5], gravity: -1.5, spread: 0.4 }); fx.flash(p, 0xffe08a, 40, 0.7);
      fx.ring(P.pos.clone(), { color: 0xffe08a, r: 3.5, dur: 0.8 });
    } else if (spell.kind === 'ward') {
      P.ward = 10; Sound.play('parry'); fx.ring(P.pos.clone(), { color: 0x9ad0ff, r: 4, dur: 0.7 }); fx.flash(P.pos.clone().setY(P.pos.y + 1), 0x9ad0ff, 60, 0.5); G.ui.toast('Aschenschild – halber Schaden');
    }
  };

  S.update = (dt) => {
    const P = G.player;
    for (const s of S.shots) {
      if (s.dead) continue;
      s.life -= dt;
      if (s.homing > 0 && s.target && !s.target.dead) {
        const t = s.target, d = new THREE.Vector3(t.pos.x - s.pos.x, t.pos.y + 1.1 * t.T.scale - s.pos.y, t.pos.z - s.pos.z).normalize();
        const cur = s.vel.clone().normalize(); cur.lerp(d, clamp(s.homing * dt, 0, 1)).normalize(); s.vel.copy(cur).multiplyScalar(s.speed);
      }
      s.pos.addScaledVector(s.vel, dt); s.sp.position.copy(s.pos);
      s.sp.scale.setScalar(s.spell.kind === 'ball' ? 2.0 + Math.sin(performance.now() / 50) * 0.2 : 1.1);
      fx.add.emit(s.pos, 1, { vel: 0.5, life: 0.3, size: s.spell.kind === 'ball' ? 0.3 : 0.15, color: s.spell.kind === 'ball' ? [1, 0.5, 0.15] : [0.5, 0.75, 1], gravity: 0, spread: 0.08 });
      let done = s.life <= 0 || s.pos.y < groundHeight(s.pos.x, s.pos.z) + 0.15;
      if (!done) for (const e of G.enemies) {
        if (!alive(e)) continue;
        const dx = e.pos.x - s.pos.x, dz = e.pos.z - s.pos.z, dy = (e.pos.y + e.yOff + 1.0 * e.T.scale) - s.pos.y;
        if (Math.hypot(dx, dz) < e.radius + s.r && Math.abs(dy) < 1.4 * e.T.scale + s.r) {
          if (s.spell.kind === 'ball') { explode(s.pos, 3.4, s.dmg, s.spell.color); } else { hit(e, s.dmg, false, P.pos); fx.sparks(s.pos, 12); fx.flash(s.pos, s.spell.color, 50, 0.2); Sound.play('hitMetal'); }
          done = true; break;
        }
      }
      if (done) {
        if (s.spell.kind === 'ball' && s.life <= 0) explode(s.pos, 3.4, s.dmg * 0.8, s.spell.color);
        s.dead = true; scene.remove(s.sp); s.sp.material.dispose();
      }
    }
    S.shots = S.shots.filter((s) => !s.dead);
    for (const b of S.bolts) {
      b.t += dt;
      if (!b.struck) { b.disc.material.opacity = 0.2 + (b.t / 0.55) * 0.45; b.disc.scale.setScalar(2.4 * (1 + 0.06 * Math.sin(b.t * 30))); }
      if (!b.struck && b.t >= 0.55) {
        b.struck = true;
        const geo = new THREE.CylinderGeometry(0.35, 0.8, 40, 10, 1, true); geo.translate(0, 20, 0);
        b.beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
        b.g.add(b.beam);
        const p = new THREE.Vector3(b.x, b.y, b.z);
        fx.flash(p.clone().setY(b.y + 2), 0xcfe0ff, 220, 0.4); fx.ring(p, { color: 0xcfe0ff, r: 6, dur: 0.5 }); fx.add.emit(p, 40, { vel: 7, up: 1.5, life: 0.6, size: 0.18, color: [0.7, 0.85, 1], gravity: 6 }); G.shake(0.5); Sound.play('bossSlam'); Sound.play('parry');
        for (const e of G.enemies) { if (!alive(e)) continue; if (Math.hypot(e.pos.x - b.x, e.pos.z - b.z) < 2.6 + e.radius) hit(e, 115, true, p); }
      }
      if (b.struck) { b.beam.material.opacity = Math.max(0, 1 - (b.t - 0.55) / 0.3); if (b.t > 0.9) b.done = true; }
    }
    for (const b of S.bolts) if (b.done) { scene.remove(b.g); b.disc.material.dispose(); if (b.beam) { b.beam.geometry.dispose(); b.beam.material.dispose(); } }
    S.bolts = S.bolts.filter((b) => !b.done);
    for (const b of S.beams) { b.t += dt; b.beam.material.opacity = Math.max(0, 1 - b.t / 0.28); b.beam.scale.set(1 + b.t * 3, 1, 1 + b.t * 3); if (b.t > 0.28) b.done = true; }
    for (const b of S.beams) if (b.done) { scene.remove(b.beam); b.beam.geometry.dispose(); b.beam.material.dispose(); }
    S.beams = S.beams.filter((b) => !b.done);
    // Aschenschild: Funken um den Spieler
    if (P.ward > 0 && Math.random() < 0.4) { const a = rand(6.28), p = P.pos.clone(); p.x += Math.cos(a) * 0.9; p.z += Math.sin(a) * 0.9; p.y += rand(0.2, 1.8); fx.add.emit(p, 1, { vel: 0.3, up: 1, life: 0.7, size: 0.14, color: [0.55, 0.8, 1], gravity: -0.5, spread: 0.02 }); }
  };
  S.clear = () => { S.shots.forEach((s) => { scene.remove(s.sp); }); S.shots = []; S.bolts.forEach((b) => scene.remove(b.g)); S.bolts = []; S.beams.forEach((b) => scene.remove(b.beam)); S.beams = []; };
  return S;
}
