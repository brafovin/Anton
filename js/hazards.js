import * as THREE from 'three';
import { clamp, rand } from './util.js';
import { Sound } from './audio.js';
import { groundHeight, GLOW } from './world.js';

// Projektile (Feuerbaelle, verfolgende Orbs), Bodenflaechen (Flammenpfuetzen, Explosionen)
// und Schockwellen, die die Bosse erzeugen.
const discGeo = new THREE.CircleGeometry(1, 36); discGeo.rotateX(-Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.9, 1, 40); ringGeo.rotateX(-Math.PI / 2);
const _v = new THREE.Vector3();

export function createHazards(G) {
  const { scene, fx } = G;
  const H = { projectiles: [], areas: [] };

  // ---------------- Projektile ----------------
  H.shoot = ({ pos, dir, speed = 14, dmg = 70, life = 5, r = 0.6, homing = 0, color = 0xff7a30, kind = 'fire', size = 1.4 }) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW.fire, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.scale.set(size, size, 1); sp.position.copy(pos); scene.add(sp);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW.fire, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    core.scale.set(size * 0.45, size * 0.45, 1); sp.add(core);
    const p = { sprite: sp, pos: pos.clone(), vel: dir.clone().normalize().multiplyScalar(speed), speed, dmg, life, r, homing, color, kind, dead: false };
    H.projectiles.push(p); return p;
  };
  H.killProjectile = (p, hit = false) => {
    if (p.dead) return; p.dead = true; scene.remove(p.sprite); p.sprite.material.dispose();
    fx.add.emit(p.pos, hit ? 26 : 14, { vel: 5, life: 0.5, size: 0.16, color: p.kind === 'orb' ? [0.7, 0.4, 1] : [1, 0.6, 0.2], gravity: 4 });
  };

  // ---------------- Bodenflaechen ----------------
  // kind: 'pool' (Dauerschaden), 'blast' (einmalige Explosion), 'ring' (wandernde Schockwelle), 'rock' (fallender Felsen)
  H.area = ({ x, z, r = 3, delay = 1, life = 5, dmg = 40, tick = 0.6, kind = 'pool', color = 0xff3a1a, speed = 10, thick = 1.6, maxR = 16, knock = false, shape = 'rock' }) => {
    const y = groundHeight(x, z) + 0.12;
    const group = new THREE.Group(); group.position.set(x, y, z);
    const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const edge = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    if (kind !== 'ring') { disc.scale.setScalar(r); edge.scale.setScalar(r); group.add(disc, edge); } else { edge.scale.setScalar(0.5); group.add(edge); }
    let rock = null;
    if (kind === 'rock') {
      if (shape === 'arrow') { // fallender Pfeil
        rock = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6, 6), new THREE.MeshStandardMaterial({ color: 0xe8dca8, emissive: 0xffb030, emissiveIntensity: 1.2 })); shaft.position.y = 3;
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffa010, emissiveIntensity: 2 })); head.rotation.x = Math.PI; head.position.y = -0.2;
        rock.add(shaft, head);
      } else {
        rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), new THREE.MeshStandardMaterial({ color: 0x6a5e52, roughness: 1 }));
        rock.castShadow = true;
      }
      rock.position.y = 22; group.add(rock);
    }
    scene.add(group);
    const a = { x, z, r, delay, life, dmg, tick, kind, color, speed, thick, maxR, knock, t: 0, tickT: 0, group, disc, edge, rock, done: false, hit: false, active: false };
    H.areas.push(a); return a;
  };

  const hurtPlayer = (a, dmg, knock) => G.player.hurt(dmg, { x: a.x, y: 0, z: a.z }, { knock });

  H.update = (dt) => {
    const P = G.player;
    // Projektile
    for (const p of H.projectiles) {
      if (p.dead) continue;
      p.life -= dt;
      if (p.homing > 0 && !P.dead) {
        _v.set(P.pos.x - p.pos.x, P.pos.y + 1.1 - p.pos.y, P.pos.z - p.pos.z).normalize();
        const cur = p.vel.clone().normalize(), k = clamp(p.homing * dt, 0, 1);
        cur.lerp(_v, k).normalize(); p.vel.copy(cur).multiplyScalar(p.speed);
      }
      p.pos.addScaledVector(p.vel, dt); p.sprite.position.copy(p.pos);
      p.sprite.scale.setScalar((1.2 + Math.sin(performance.now() / 60) * 0.15) * (p.kind === 'orb' ? 1.5 : 1.3));
      fx.add.emit(p.pos, 1, { vel: 0.6, life: 0.35, size: 0.18, color: p.kind === 'orb' ? [0.6, 0.35, 1] : [1, 0.5, 0.15], gravity: 0, spread: 0.1 });
      if (p.life <= 0 || p.pos.y < groundHeight(p.pos.x, p.pos.z) + 0.1) { H.killProjectile(p); continue; }
      if (!P.dead) {
        const dx = P.pos.x - p.pos.x, dz = P.pos.z - p.pos.z, dy = P.pos.y + 1.0 - p.pos.y;
        if (Math.hypot(dx, dz) < p.r + P.radius && Math.abs(dy) < 1.1 + p.r && !P.iframes) {
          P.hurt(p.dmg, { x: p.pos.x - p.vel.x, y: 0, z: p.pos.z - p.vel.z }, {}); fx.flash(p.pos, p.color, 60, 0.25); Sound.play('hit'); H.killProjectile(p, true);
        }
      }
    }
    H.projectiles = H.projectiles.filter((p) => !p.dead);
    // Flaechen
    for (const a of H.areas) {
      a.t += dt;
      const pd = Math.hypot(P.pos.x - a.x, P.pos.z - a.z);
      if (a.kind === 'pool') {
        if (a.t < a.delay) { a.disc.material.opacity = 0.12 + Math.sin(a.t * 14) * 0.06; a.edge.material.opacity = 0.5; }
        else {
          a.active = true; const fade = clamp((a.life - (a.t - a.delay)) / 1, 0, 1);
          a.disc.material.opacity = 0.35 * fade; a.edge.material.opacity = 0.9 * fade;
          for (let i = 0; i < 2; i++) { const ang = rand(6.28), rr = Math.sqrt(Math.random()) * a.r; _v.set(a.x + Math.cos(ang) * rr, a.group.position.y, a.z + Math.sin(ang) * rr); fx.add.emit(_v, 1, { vel: 0.6, up: 1, life: 0.9, size: 0.45, color: [1, 0.4, 0.1], gravity: -2.5, drag: 0.5, spread: 0.05 }); }
          a.tickT -= dt;
          if (pd < a.r && P.jumpH < 0.5 && !P.dead && a.tickT <= 0) { a.tickT = a.tick; hurtPlayer(a, a.dmg, false); }
          if (a.t > a.delay + a.life) a.done = true;
        }
      } else if (a.kind === 'blast' || a.kind === 'rock') {
        const k = clamp(a.t / a.delay, 0, 1);
        a.disc.material.opacity = 0.1 + k * 0.35; a.edge.scale.setScalar(a.r * (1 - 0.15 * Math.sin(a.t * 20)));
        if (a.rock) a.rock.position.y = 22 * (1 - k * k) + 1.2;
        if (a.t >= a.delay && !a.hit) {
          a.hit = true; a.done = true;
          _v.set(a.x, a.group.position.y, a.z);
          fx.ring(_v, { color: a.color, r: a.r * 1.6, dur: 0.5 }); fx.dust(_v, 22);
          fx.add.emit(_v, 50, { vel: 8, up: 1.4, life: 0.8, size: 0.2, color: [1, 0.55, 0.2], gravity: 9 });
          fx.flash(_v.clone().setY(_v.y + 1), 0xff7a30, 120, 0.4); G.shake(a.kind === 'rock' ? 0.7 : 0.5); Sound.play('bossSlam');
          if (pd < a.r + P.radius && !P.dead) hurtPlayer(a, a.dmg, a.knock || a.kind === 'rock');
        }
      } else if (a.kind === 'ring') {
        const R = a.speed * a.t; a.edge.scale.setScalar(Math.max(0.5, R));
        a.edge.material.opacity = 0.9 * (1 - R / a.maxR);
        if (!a.hit && Math.abs(pd - R) < a.thick && P.jumpH < 0.35 && !P.dead && !P.iframes) { a.hit = true; hurtPlayer(a, a.dmg, true); }
        if (R >= a.maxR) a.done = true;
      }
    }
    for (const a of H.areas) if (a.done) { scene.remove(a.group); a.disc.material.dispose(); a.edge.material.dispose(); if (a.rock) a.rock.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    H.areas = H.areas.filter((a) => !a.done);
  };

  H.clear = () => {
    H.projectiles.forEach((p) => H.killProjectile(p)); H.projectiles = [];
    H.areas.forEach((a) => { scene.remove(a.group); }); H.areas = [];
  };
  return H;
}
