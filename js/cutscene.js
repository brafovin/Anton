import * as THREE from 'three';
import { clamp, lerp, smoothstep, rand } from './util.js';
import { Sound } from './audio.js';
import { groundHeight } from './world.js';

// ---------------------------------------------------------------------------
//  Cutscenes in der Spiel-Engine: Kamerafahrten, Untertitel, Titelkarte,
//  boss-spezifische Inszenierung. Intro (nach dem Nebeltor) und Outro (Tod des Bosses).
//  Ueberspringen: Leertaste / Enter / E / Esc
// ---------------------------------------------------------------------------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const fwd = (y) => V(Math.sin(y), 0, Math.cos(y));
const rgt = (y) => V(-Math.cos(y), 0, Math.sin(y));
const ease = (t) => t * t * (3 - 2 * t);

// ----- Kamera-Bausteine: liefern {pos, look} fuer u in 0..1 -----
// Schulterblick ueber den Spieler zum Boss (Anschieben)
const dolly = ({ d0 = 4, d1 = 0.6, side = 1.1, h = 1.6, lookH = 1.2, lookAt = 'boss' } = {}) => (c, u, out) => {
  const e = ease(u), d = lerp(d0, d1, e);
  out.pos.copy(c.PP).addScaledVector(fwd(c.py), -d).addScaledVector(rgt(c.py), side); out.pos.y = c.PP.y + h;
  const tgt = lookAt === 'boss' ? c.B : c.A ? V(c.A.x, c.B.y, c.A.z) : c.B;
  out.look.set(tgt.x, tgt.y + (c.boss.yOff || 0) + c.S * lookH, tgt.z);
};
// Kreisfahrt um den Boss
const orbit = ({ a0, a1, R, h0, h1, lookH = 0.9, lookH1 }) => (c, u, out) => {
  const e = ease(u), a = c.by + lerp(a0, a1, e), r = R * c.S ** 0.0;
  out.pos.set(c.B.x + Math.sin(a) * r, c.B.y + lerp(h0, h1, e) * 1, c.B.z + Math.cos(a) * r);
  out.look.set(c.B.x, c.B.y + (c.boss.yOff || 0) + c.S * lerp(lookH, lookH1 ?? lookH, e), c.B.z);
};
// Grossaufnahme des Gesichts
const close = ({ d0, d1, side = 0.3, h = 1.7, lookH = 1.62, fov = 40 }) => {
  const f = (c, u, out) => {
    const e = ease(u), d = lerp(d0, d1, e) * 1, a = c.by + side;
    out.pos.set(c.B.x + Math.sin(a) * d, c.B.y + c.S * h + (c.boss.yOff || 0), c.B.z + Math.cos(a) * d);
    out.look.set(c.B.x, c.B.y + (c.boss.yOff || 0) + c.S * lookH, c.B.z);
  };
  f.fov = fov; return f;
};
// Rueckfahrt zur Spielkamera (hinter dem Spieler Richtung Boss)
const gameCam = (c, out) => {
  const yaw = Math.atan2(c.B.x - c.PP.x, c.B.z - c.PP.z), pitch = 0.28, dist = c.A ? c.A.camDist : 6.6;
  const look = V(c.PP.x, c.PP.y + 1.55, c.PP.z).addScaledVector(rgt(yaw), 0.55); look.y += 0.1;
  out.pos.set(look.x - Math.sin(yaw) * Math.cos(pitch) * dist, look.y + Math.sin(pitch) * dist, look.z - Math.cos(yaw) * Math.cos(pitch) * dist);
  out.look.copy(look); out.yaw = yaw; out.pitch = pitch;
};
const ret = (prev) => (c, u, out) => {
  const e = ease(u), g = { pos: V(), look: V() }; gameCam(c, g);
  out.pos.lerpVectors(prev.pos, g.pos, e); out.look.lerpVectors(prev.look, g.look, e);
};

// ----- Szenen-Effekte -----
const embers = (G, p, n = 60, big = false) => G.fx.add.emit(p, n, { vel: big ? 9 : 5, up: 1.5, life: 1.2, size: 0.2, color: [1, 0.55, 0.15], gravity: -1 });
const shockwave = (G, c) => {
  const p = c.B.clone(); p.y = groundHeight(p.x, p.z);
  G.fx.ring(p, { color: 0xffb060, r: 12, dur: 0.8 }); G.fx.dust(p, 40); G.fx.flash(p.clone().setY(p.y + 1), 0xff8a30, 140, 0.5); G.shake(0.9); Sound.play('bossSlam');
};
const smoke = (G, p, color = [0.5, 0.25, 0.8]) => {
  G.fx.add.emit(p, 50, { vel: 3.5, up: 1.4, life: 0.9, size: 0.4, color, gravity: -1 });
  G.fx.norm.emit(p, 18, { vel: 2, up: 1, life: 1.1, size: 0.7, color: [0.1, 0.05, 0.15, 0.6], gravity: -0.5 });
};

// ===========================================================================
//  Skripte
// ===========================================================================
const SCRIPTS = {
  hadrian: () => {
    const s = [{ dur: 3.4, cam: dolly({ d0: 4.5, d1: 0.8, lookH: 0.55 }) }, { dur: 4.2, cam: orbit({ a0: 1.25, a1: 0.2, R: 11, h0: 1.4, h1: 3.4, lookH: 0.5, lookH1: 0.8 }) },
      { dur: 3.0, cam: close({ d0: 5.4, d1: 3.9, side: 0.35, h: 1.55, lookH: 1.0, fov: 42 }) }, { dur: 1.2 }];
    return {
      shots: s,
      subs: [[0.4, 3.2, '', 'Hinter dem Nebel kniet der, der die Flamme einst entzündete …'], [4.5, 7.6, 'Sir Hadrian', '„Die Flamme erlischt, Ungetoppter. Und mit ihr dein Weg.“']],
      title: { t: 7.8, text: 'SIR HADRIAN', sub: 'Wächter der Asche' },
      events: [[0.2, (c, G) => Sound.bossMusic(true)], [5.5, (c, G) => { embers(G, c.B.clone().setY(c.B.y + 0.5), 70); Sound.play('ash'); G.shake(0.3); }], [7.1, (c, G) => shockwave(G, c)]],
      outro: { lines: [[1.2, 5.0, 'Sir Hadrian', '„Die Asche … vergisst nicht …“']], R: 11, h: 2.6, lookH: 0.45 },
    };
  },
  morwen: () => {
    const s = [{ dur: 3.0, cam: dolly({ d0: 4, d1: 1.0, lookH: 1.0, lookAt: 'arena', h: 1.5 }) }, { dur: 4.6, cam: orbit({ a0: -1.1, a1: 0.9, R: 9.5, h0: 1.0, h1: 4.2, lookH: 1.5, lookH1: 1.9 }) },
      { dur: 3.0, cam: close({ d0: 3.4, d1: 2.5, side: -0.25, h: 1.65, lookH: 1.62, fov: 40 }) }, { dur: 1.2 }];
    return {
      shots: s,
      start: (c) => { c.boss.h.root.visible = false; },
      subs: [[0.4, 2.8, '', 'Violette Funken tanzen zwischen den Steinen …'], [4.1, 7.2, 'Morwen', '„Noch ein Durstiger, der meine Asche stehlen will … dann brenn mit ihr.“']],
      title: { t: 7.8, text: 'MORWEN', sub: 'Hexe der Asche' },
      events: [[0.2, (c, G) => Sound.bossMusic(true)],
        [3.0, (c, G) => { const p = c.B.clone(); p.y += 1.2; c.boss.h.root.visible = true; smoke(G, p); G.fx.ring(c.B.clone(), { color: 0xb070ff, r: 7, dur: 0.8 }); G.fx.flash(p, 0xb070ff, 120, 0.6); Sound.play('ashCharge'); }],
        [5.3, (c, G) => { Sound.play('ash'); G.fx.flash(c.B.clone().setY(c.B.y + 3), 0xb070ff, 90, 0.5); }]],
      update: (c, G, t, dt) => {
        c.boss.yOff = t < 3 ? 0 : 1.1 * smoothstep(3, 4.6, t) * (1 - smoothstep(7.2, 8.3, t));
        if (t > 3 && t < 7.6) { const a = t * 3, p = c.B.clone(); p.y += c.boss.yOff + 1.2; p.x += Math.cos(a) * 1.4; p.z += Math.sin(a) * 1.4; G.fx.add.emit(p, 2, { vel: 0.5, life: 0.9, size: 0.22, color: [0.65, 0.35, 1], gravity: -0.5 }); }
      },
      end: (c) => { c.boss.yOff = 0; c.boss.h.root.visible = true; },
      outro: { lines: [[1.2, 5.0, 'Morwen', '„Das Feuer … hat mich … verraten …“']], R: 8, h: 2.6, lookH: 0.5 },
    };
  },
  gorm: () => {
    const s = [{ dur: 3.4, cam: dolly({ d0: 3, d1: 0.5, h: 0.9, lookH: 0.45 }) }, { dur: 4.4, cam: orbit({ a0: 1.4, a1: 0.15, R: 17, h0: 1.0, h1: 2.6, lookH: 0.4, lookH1: 0.85 }) },
      { dur: 3.0, cam: close({ d0: 9.5, d1: 7.0, side: 0.3, h: 1.45, lookH: 1.0, fov: 46 }) }, { dur: 1.2 }];
    return {
      shots: s,
      subs: [[0.4, 3.3, '', 'Der Boden bebt. Zwischen Knochen und Geröll regt sich ein Berg aus Fleisch …'], [4.6, 7.6, 'Gorm', '„GORM … HUNGRIG!“']],
      title: { t: 7.9, text: 'GORM', sub: 'der Grabriese' },
      events: [[0.2, (c, G) => Sound.bossMusic(true)], [0.6, (c, G) => { G.shake(0.35); Sound.play('bossSlam'); }], [1.8, (c, G) => { G.shake(0.45); G.fx.dust(c.B.clone(), 20); Sound.play('bossSlam'); }], [2.9, (c, G) => { G.shake(0.55); G.fx.dust(c.B.clone(), 26); Sound.play('bossSlam'); }],
        [3.7, (c, G) => { Sound.play('roar'); G.shake(0.5); }], [5.6, (c, G) => { G.fx.dust(c.B.clone(), 30); G.shake(0.6); }], [7.1, (c, G) => shockwave(G, c)]],
      outro: { lines: [[1.2, 5.0, 'Gorm', '„Gorm … nicht … hungrig … mehr …“']], R: 17, h: 3.4, lookH: 0.4 },
    };
  },
  king: () => {
    const s = [{ dur: 3.8, cam: dolly({ d0: 5, d1: 1.4, h: 1.7, lookH: 0.85 }) }, { dur: 4.6, cam: orbit({ a0: 0.9, a1: -0.5, R: 19, h0: 2.4, h1: 6.0, lookH: 0.8, lookH1: 1.15 }) },
      { dur: 3.2, cam: close({ d0: 10.5, d1: 7.6, side: 0.25, h: 1.5, lookH: 1.62, fov: 44 }) }, { dur: 1.2 }];
    return {
      shots: s,
      subs: [[0.4, 3.7, '', 'Am Ende aller Wege sitzt der, der die Flamme einst unterwarf …'], [4.6, 8.5, 'Aldrar', '„Vier Wächter ließ ich fallen, um zu sehen, wer es bis hierher schafft. Knie nieder, Ungetoppter – oder brenne.“']],
      title: { t: 8.7, text: 'ALDRAR', sub: 'Der Aschenkönig' },
      events: [[0.2, (c, G) => Sound.bossMusic(true)], [5.3, (c, G) => { embers(G, c.B.clone().setY(c.B.y + 0.6), 90, true); Sound.play('ash'); G.shake(0.4); }], [7.5, (c, G) => { shockwave(G, c); G.fx.ring(c.B.clone(), { color: 0xffd060, r: 20, dur: 1.2 }); }]],
      outro: { lines: [[1.2, 5.4, 'Aldrar', '„Die Krone … ist nur … Asche …“']], R: 17, h: 3.6, lookH: 0.5 },
    };
  },
  vael: () => {
    const first = (c, u, out) => { // Nahaufnahme des Spielers, Kamera schiebt sich heran
      const e = ease(u), d = lerp(3.2, 1.9, e);
      out.pos.copy(c.PP).addScaledVector(fwd(c.py), d).addScaledVector(rgt(c.py), -0.5); out.pos.y = c.PP.y + 1.55;
      out.look.set(c.PP.x, c.PP.y + 1.55, c.PP.z);
    };
    const s = [{ dur: 3.4, cam: first, fov: 44 }, { dur: 4.0, cam: orbit({ a0: 0.1, a1: 1.6, R: 6.5, h0: 1.3, h1: 1.8, lookH: 0.85 }) },
      { dur: 2.8, cam: close({ d0: 3.3, d1: 2.3, side: 0.3, h: 1.55, lookH: 1.52, fov: 38 }) }, { dur: 1.2 }];
    return {
      shots: s,
      start: (c) => { c.boss.h.root.visible = false; },
      subs: [[0.6, 3.2, 'Vael', '„Hörst du das? Das Schaben einer Klinge …“'], [4.3, 7.3, 'Vael', '„Dein Kopf wird mein Zehnter in dieser Nacht.“']],
      title: { t: 7.5, text: 'VAEL', sub: 'der Henker' },
      events: [[0.2, (c, G) => Sound.bossMusic(true)],
        [3.35, (c, G) => { // Vael tritt aus der Dunkelheit vor den Spieler
          const b = c.boss, P = c.P; b.pos.x = c.PP.x + Math.sin(c.py) * 5.5; b.pos.z = c.PP.z + Math.cos(c.py) * 5.5; b.pos.y = groundHeight(b.pos.x, b.pos.z);
          b.yaw = Math.atan2(c.PP.x - b.pos.x, c.PP.z - b.pos.z); c.B.copy(b.pos); c.by = b.yaw;
          b.h.root.visible = true; smoke(G, b.pos.clone().setY(b.pos.y + 1), [0.8, 0.1, 0.1]); G.fx.ring(b.pos.clone(), { color: 0xc02020, r: 5, dur: 0.6 }); Sound.play('fog'); Sound.play('swingHeavy');
        }], [5.4, (c, G) => { Sound.play('swingHeavy'); G.fx.flash(c.B.clone().setY(c.B.y + 1.5), 0xff3030, 80, 0.4); }]],
      end: (c) => { c.boss.h.root.visible = true; c.boss.cd = 1.5; },
      outro: { lines: [[1.2, 5.0, 'Vael', '„Das Beil … fällt … auch … auf mich …“']], R: 7.5, h: 2.0, lookH: 0.35 },
    };
  },
};

// ===========================================================================
export function createCutscenes(G) {
  const C = {}, cam = G.camera, out = { pos: V(), look: V() };
  let lastShotEnd = { pos: V(), look: V() }, prevFrame = { pos: V(), look: V() };

  function begin(def, boss, kind, onEnd) {
    const P = G.player;
    const c = { boss, P, B: boss.pos.clone(), by: boss.yaw, S: boss.T.scale, py: P.yaw, PP: P.pos.clone(), A: boss.arena, kind };
    const total = def.shots.reduce((a, s) => a + s.dur, 0);
    G.cutscene = { def, c, t: 0, total, boss, onEnd, done: new Set(), kind, subKey: '', titleShown: false, slow: 1 };
    document.body.classList.add('cine'); G.ui.cineHint(true);
    P.lock = null; P.setState('cutscene', { blend: 0.2 }); P.buf = null;
    G.ui.fade(1, 1); setTimeout(() => G.ui.fade(0, 700), 40);
    if (def.start) def.start(c, G);
  }
  C.playIntro = (fight, onEnd) => {
    const boss = fight.enemy, def = SCRIPTS[fight.id]();
    begin(def, boss, 'intro', onEnd);
  };
  C.playOutro = (fight, boss, onEnd) => {
    const base = SCRIPTS[fight.id](), o = base.outro;
    const def = {
      shots: [{ dur: 6.5, cam: orbit({ a0: 0.5, a1: 2.1, R: o.R, h0: o.h, h1: o.h + 0.8, lookH: o.lookH }) }],
      subs: o.lines, events: [[0.0, (c, G) => { G.cutscene.slow = 0.3; }], [3.2, (c, G) => { G.cutscene.slow = 1; }]], outro: true,
    };
    begin(def, boss, 'outro', onEnd);
  };
  C.skip = () => { if (G.cutscene) C.end(true); };

  C.end = (skipped = false) => {
    const cs = G.cutscene; if (!cs) return;
    const { def, c } = cs;
    if (skipped) { // verbleibende Ereignisse sofort ausfuehren, damit der Zustand stimmt
      (def.events || []).forEach(([et, fn], i) => { if (!cs.done.has(i)) { cs.done.add(i); fn(c, G); } });
      G.ui.fade(1, 1); setTimeout(() => G.ui.fade(0, 500), 40);
    }
    if (def.end) def.end(c, G);
    G.cutscene = null; cam.fov = 62; cam.updateProjectionMatrix();
    document.body.classList.remove('cine'); G.ui.cineHint(false); G.ui.subtitle(null); G.ui.hideTitle();
    const P = G.player;
    if (!P.dead) {
      P.setState('free', { blend: 0.3 });
      if (cs.kind === 'intro') { const tmp = { pos: V(), look: V() }; gameCam(c, tmp); P.camYaw = tmp.yaw; P.camPitch = tmp.pitch; P.camDist = c.A ? c.A.camDist : 6.6; }
    }
    G.snapCamera();
    if (cs.onEnd) cs.onEnd(skipped);
  };

  C.update = (dt) => {
    const cs = G.cutscene; if (!cs) return;
    cs.t += dt; const t = cs.t, { def, c } = cs;
    // Kamera: aktueller Schuss
    let acc = 0, idx = 0;
    for (; idx < def.shots.length - 1; idx++) { if (t < acc + def.shots[idx].dur) break; acc += def.shots[idx].dur; }
    if (cs.idx !== undefined && cs.idx !== idx) { lastShotEnd.pos.copy(prevFrame.pos); lastShotEnd.look.copy(prevFrame.look); }
    cs.idx = idx;
    const shot = def.shots[idx], u = clamp((t - acc) / shot.dur, 0, 1);
    if (shot.cam) { shot.cam(c, u, out); }
    else { // Abschlussschuss: zurueck zur Spielkamera
      ret(lastShotEnd)(c, u, out);
    }
    prevFrame.pos.copy(out.pos); prevFrame.look.copy(out.look);
    const wantFov = shot.fov || (shot.cam && shot.cam.fov) || (idx === def.shots.length - 1 && def.shots.length > 1 ? 62 : 62);
    cam.fov = lerp(cam.fov, wantFov, 1 - Math.exp(-4 * dt)); cam.updateProjectionMatrix();
    out.pos.y = Math.max(out.pos.y, groundHeight(out.pos.x, out.pos.z) + 0.4);
    G.shakeAmt = Math.max(0, G.shakeAmt - dt * 2.2); const sh = G.shakeAmt * G.shakeAmt;
    cam.position.copy(out.pos).add(V((Math.random() - 0.5) * sh * 0.5, (Math.random() - 0.5) * sh * 0.5, (Math.random() - 0.5) * sh * 0.5));
    cam.lookAt(out.look);
    // Ereignisse
    (def.events || []).forEach(([et, fn], i) => { if (!cs.done.has(i) && t >= et) { cs.done.add(i); fn(c, G); } });
    if (def.update) def.update(c, G, t, dt);
    // Untertitel + Titelkarte
    let sub = null; for (const [a, b, who, text] of (def.subs || [])) if (t >= a && t <= b) sub = [who, text];
    const key = sub ? sub[1] : ''; if (key !== cs.subKey) { cs.subKey = key; G.ui.subtitle(sub ? sub[0] : null, sub ? sub[1] : null); }
    if (def.title && !cs.titleShown && t >= def.title.t) { cs.titleShown = true; G.ui.titleCard(def.title.text, def.title.sub); Sound.play('roar'); G.shake(0.4); }
    if (t >= cs.total) C.end(false);
  };
  return C;
}
