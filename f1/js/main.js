import * as THREE from 'three';
import { TEAMS, DRIVERS, TRACKS, POINTS, teamById, driverById } from './data.js';
import { buildTrackData, buildTrackScene, THEMES } from './track.js';
import { CarModel, COMPOUNDS } from './car.js';
import { Race, DIFFICULTY, TYRES, fmtTime } from './race.js';
import { HUD } from './hud.js';
import { PHYS, gearInfo } from './phys.js';
import * as audio from './audio.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TIME_SCALE = Math.max(1, Math.min(40, +(params.get('ts') || 1))); // nur zum Testen
const screenEl = $('screen');
const fadeEl = $('fade');

// ---------- Speicher (fehlertolerant) ----------
const store = {
  get(k, def) { try { const v = localStorage.getItem('f1-26-' + k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('f1-26-' + k, JSON.stringify(v)); } catch { /* ohne Speicher weiterspielen */ } },
  del(k) { try { localStorage.removeItem('f1-26-' + k); } catch { /* egal */ } },
};
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const settings = Object.assign({ cams: ['chase', 'chase'], mute: false, brakeAssist: coarse, line: false, laps: 3, difficulty: coarse ? 'easy' : 'medium', start: 'quali', quality: coarse ? 'mid' : 'high', compound: 'M', track: 'jpn' }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
audio.setMuted(settings.mute);

// ---------- Renderer ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
function applyQuality() {
  const pr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(settings.quality === 'high' ? Math.min(pr, 2) : settings.quality === 'mid' ? Math.min(pr, 1.25) : 1);
  renderer.shadowMap.enabled = settings.quality !== 'low';
}
applyQuality();

// Umgebungslicht für Lack-Reflexionen
const pmrem = new THREE.PMREMGenerator(renderer);
function makeEnv(top = '#4a78b8', hor = '#dfe8ef', ground = '#3b4235') {
  const s = new THREE.Scene();
  const g = new THREE.SphereGeometry(50, 32, 16);
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { a: { value: new THREE.Color(top) }, b: { value: new THREE.Color(hor) }, c: { value: new THREE.Color(ground) } },
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 a; uniform vec3 b; uniform vec3 c; varying vec3 p; void main(){ vec3 col = p.y > 0. ? mix(b, a, pow(p.y, .6)) : mix(b, c, pow(-p.y, .4)); gl_FragColor = vec4(col, 1.); }' });
  s.add(new THREE.Mesh(g, m));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(30, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
  panel.position.set(0, 30, -20); panel.lookAt(0, 0, 0); s.add(panel);
  const tex = pmrem.fromScene(s, 0.03).texture;
  g.dispose(); m.dispose();
  return tex;
}

// ---------- Showroom (Menü-Hintergrund) ----------
const show = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(32, 1, 0.1, 200), car: null, key: '', angle: 0.6, shift: 0 };
{
  const s = show.scene;
  s.background = new THREE.Color('#07090c');
  s.environment = makeEnv('#1b2230', '#5a6574', '#0b0d10');
  s.fog = new THREE.Fog('#07090c', 14, 34);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: '#101317', roughness: 0.35, metalness: 0.5 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.28, 96), new THREE.MeshBasicMaterial({ color: '#b25cff' }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; s.add(ring);
  s.add(new THREE.HemisphereLight('#9fb0c8', '#0b0d10', 0.6));
  const key = new THREE.SpotLight('#ffffff', 260, 30, 0.5, 0.6, 1.4); key.position.set(4, 9, 5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); s.add(key);
  const rim = new THREE.SpotLight('#b25cff', 160, 30, 0.6, 0.7, 1.4); rim.position.set(-6, 5, -6); s.add(rim);
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.8); fill.position.set(-3, 4, 6); s.add(fill);
  show.cam.position.set(7.2, 2.4, 7.2);
}
function showroomCar(teamId, driverId) {
  const k = teamId + driverId;
  if (show.key === k) return;
  show.key = k;
  if (show.car) { show.scene.remove(show.car.group); show.car.dispose(); }
  const team = teamById(teamId), drv = driverById(driverId);
  const tm = DRIVERS.filter(d => d.team === teamId).indexOf(drv);
  show.car = new CarModel(team, drv, { compound: settings.compound, teammateIndex: tm });
  show.car.group.position.y = 0;
  show.scene.add(show.car.group);
}

// ---------- Spielszene ----------
const scene = new THREE.Scene();
let env = null;
const cameras = [new THREE.PerspectiveCamera(62, 1, 0.1, 6000), new THREE.PerspectiveCamera(62, 1, 0.1, 6000)];
const hud = new HUD();
let G = null; // laufendes Rennen

let W = 1, H = 1;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H, false);
  show.shift = W > 900 && screenEl.classList.contains('side') ? 0.2 : 0;
  if (G) hud.layout(viewports().map(v => v.css));
}
window.addEventListener('resize', resize);

function viewports() {
  const n = G ? G.players.length : 1;
  if (n === 1) return [{ x: 0, y: 0, w: W, h: H, css: { x: 0, y: 0, w: W, h: H } }];
  if (W / H > 1.25) return [
    { x: 0, y: 0, w: W / 2, h: H, css: { x: 0, y: 0, w: W / 2, h: H } },
    { x: W / 2, y: 0, w: W / 2, h: H, css: { x: W / 2, y: 0, w: W / 2, h: H } }];
  return [
    { x: 0, y: H / 2, w: W, h: H / 2, css: { x: 0, y: 0, w: W, h: H / 2 } },
    { x: 0, y: 0, w: W, h: H / 2, css: { x: 0, y: H / 2, w: W, h: H / 2 } }];
}

// ---------- Eingabe ----------
const keys = new Set();
const touchKeys = new Set();
window.addEventListener('keydown', e => {
  if (G && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (!G) return;
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  if (e.code === 'KeyM') { settings.mute = !settings.mute; audio.setMuted(settings.mute); saveSettings(); }
  if (e.code === 'KeyC') cycleCam(0);
  if (['Period', 'NumpadDecimal', 'Slash'].includes(e.code)) cycleCam(1);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); touchKeys.add(k); b.classList.add('act'); audio.initAudio(); };
  const off = e => { e.preventDefault(); touchKeys.delete(k); b.classList.remove('act'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
});
$('pause-btn').addEventListener('click', () => togglePause());
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

const padPrev = [{}, {}];
function readInputs() {
  const k = c => keys.has(c);
  const mp = G.players.length > 1;
  const inp = [
    { up: k('KeyW') || (!mp && k('ArrowUp')) || touchKeys.has('up'), down: k('KeyS') || (!mp && k('ArrowDown')) || touchKeys.has('down'),
      left: k('KeyA') || (!mp && k('ArrowLeft')) || touchKeys.has('left'), right: k('KeyD') || (!mp && k('ArrowRight')) || touchKeys.has('right'),
      boost: k('Space') || k('ShiftLeft') || (!mp && k('ShiftRight')) || touchKeys.has('boost') },
    { up: k('ArrowUp'), down: k('ArrowDown'), left: k('ArrowLeft'), right: k('ArrowRight'), boost: k('Enter') || k('ShiftRight') || k('Numpad0') || k('ControlRight') },
  ];
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  pads.slice(0, 2).forEach((p, i) => {
    const target = inp[i]; if (!target) return;
    const ax = Math.abs(p.axes[0]) > 0.12 ? p.axes[0] : 0;
    const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
    if (ax || rt > 0.05 || lt > 0.05 || p.buttons[0]?.pressed) {
      Object.assign(target, { steer: ax, analog: true, throttle: Math.max(rt, p.buttons[0]?.pressed ? 1 : 0), brakeV: Math.max(lt, p.buttons[1]?.pressed ? 1 : 0), boost: !!(p.buttons[2]?.pressed || p.buttons[5]?.pressed) || target.boost });
    }
    const now = { cam: p.buttons[3]?.pressed, pause: p.buttons[9]?.pressed };
    if (now.cam && !padPrev[i].cam) cycleCam(i);
    if (now.pause && !padPrev[i].pause) togglePause();
    padPrev[i] = now;
  });
  if (params.has('autopilot') && G) G.players.forEach(c => { c.autopilot = true; });
  return inp;
}

// ---------- Kamera ----------
const CAM_MODES = ['chase', 'far', 'tcam', 'cockpit'];
const CAM_NAMES = { chase: 'Verfolger', far: 'Weit', tcam: 'T-Cam', cockpit: 'Cockpit' };
function cycleCam(i) {
  if (!G || !G.rigs[i]) return;
  const r = G.rigs[i];
  r.mode = CAM_MODES[(CAM_MODES.indexOf(r.mode) + 1) % CAM_MODES.length];
  settings.cams[i] = r.mode; saveSettings();
  hud.message(i, 'KAMERA: ' + CAM_NAMES[r.mode]);
}
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const lerpAngle = (a, b, t) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
class CamRig {
  constructor(cam, mode) { this.cam = cam; this.mode = mode; this.yaw = null; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.shake = 0; this.orbit = 0; }
  update(car, dt, race) {
    const g = car.model.group;
    g.updateMatrixWorld();
    if (this.yaw === null) { this.yaw = car.psi; this.pos.set(car.x - Math.sin(car.psi) * 7, car.y + 2.2, car.z - Math.cos(car.psi) * 7); }
    const tv = car.finished && race.t - (race.endT || 0) > 2.5;
    let mode = tv ? 'tv' : this.mode;
    if (race.phase === 'grid' && race.lightT < 2.2 && race.mode !== 'trial') mode = 'intro';
    const cam = this.cam;
    let fov = 60 + Math.min(14, Math.abs(car.v) * 0.12);
    const surf = car.surface;
    this.shake = Math.max(this.shake * Math.exp(-dt * 8), car.hit * 0.02, surf === 'kerb' ? 0.04 : surf === 'grass' || surf === 'gravel' ? 0.09 : 0);
    car.model.helmet.visible = true;
    if (mode === 'chase' || mode === 'far' || mode === 'intro') {
      const far = mode === 'far';
      const back = mode === 'intro' ? 4 + race.lightT * 2 : far ? 11 : 6.6, up = mode === 'intro' ? 1.2 + race.lightT : far ? 3.9 : 2.05;
      const dirV = car.v < -1 ? car.psi + Math.PI : car.psi;
      this.yaw = lerpAngle(this.yaw, dirV, 1 - Math.exp(-dt * (far ? 5 : 7)));
      const want = tmpV.set(car.x - Math.sin(this.yaw) * back, car.y + up, car.z - Math.cos(this.yaw) * back);
      this.pos.lerp(want, 1 - Math.exp(-dt * 18));
      this.pos.y += (want.y - this.pos.y) * Math.min(1, dt * 10);
      cam.position.copy(this.pos);
      this.look.set(car.x + Math.sin(this.yaw) * 5, car.y + (far ? 1.0 : 0.95), car.z + Math.cos(this.yaw) * 5);
      cam.lookAt(this.look);
    } else if (mode === 'tcam' || mode === 'cockpit') {
      const ck = mode === 'cockpit';
      cam.position.copy(tmpV.set(0, ck ? 0.94 : 1.2, ck ? -0.1 : -0.5).applyMatrix4(g.matrixWorld));
      cam.lookAt(tmpV2.set(0, ck ? 0.78 : 0.95, 30).applyMatrix4(g.matrixWorld));
      if (ck) { car.model.helmet.visible = false; fov = 70 + Math.min(10, Math.abs(car.v) * 0.08); }
      else fov = 64 + Math.min(10, Math.abs(car.v) * 0.08);
    } else if (mode === 'tv') {
      this.orbit += dt * 0.25;
      cam.position.set(car.x + Math.sin(this.orbit) * 13, car.y + 4.5, car.z + Math.cos(this.orbit) * 13);
      cam.lookAt(car.x, car.y + 0.8, car.z);
      fov = 50;
    }
    if (this.shake > 0.001) { cam.position.x += (Math.random() - 0.5) * this.shake; cam.position.y += (Math.random() - 0.5) * this.shake; }
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); }
  }
}

// ---------- Ideallinie anzeigen ----------
function racingLineMesh(T) {
  const pos = [], col = [], idx = [];
  const cG = new THREE.Color('#2bd96b'), cY = new THREE.Color('#ffd23f'), cR = new THREE.Color('#ff3030');
  const w = 0.45;
  for (let i = 0; i <= T.N; i++) {
    const j = i % T.N, d = T.line[j];
    const y = T.h(j, d) + 0.06;
    for (const o of [-w, w]) pos.push(T.X[j] + T.NX[j] * (d + o), y, T.Z[j] + T.NZ[j] * (d + o));
    const nxt = T.speed[(j + 6) % T.N];
    const c = nxt < T.speed[j] - 0.4 ? cR : T.speed[j] < PHYS.VMAX * 0.85 ? cY : cG;
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  for (let i = 0; i < T.N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
}

// ---------- Rennen starten ----------
function gridOrder(humans, start) {
  const ai = DRIVERS.filter(d => !humans.includes(d.id));
  const score = d => teamById(d.team).perf * d.skill * (1 + (Math.random() - 0.5) * 0.012);
  const sortQ = list => list.map(d => ({ d, s: score(d) })).sort((a, b) => b.s - a.s).map(x => x.d);
  const hum = humans.map(driverById);
  if (start === 'pole') return [...hum, ...sortQ(ai)];
  if (start === 'back') return [...sortQ(ai), ...hum];
  if (start === 'random') { const all = [...DRIVERS]; for (let i = all.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [all[i], all[j]] = [all[j], all[i]]; } return all; }
  return sortQ(DRIVERS);
}

function nextFrame() { return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }

async function startRace(cfg) {
  audio.initAudio();
  fadeEl.classList.add('on');
  await new Promise(r => setTimeout(r, 300));
  const def = TRACKS.find(t => t.id === cfg.track) || TRACKS[0];
  setScreen(`<div class="loading"><div class="gp">${def.gp} · ${def.city}</div><h1 class="tn">${def.name}</h1><div class="ti">${def.info} · ${def.len.toFixed(3).replace('.', ',')} km · ${cfg.mode === 'trial' ? 'Zeitfahren' : cfg.laps + (cfg.laps === 1 ? ' Runde' : ' Runden')}</div><div class="bar"><i></i></div></div>`, 'solid');
  fadeEl.classList.remove('on');
  await nextFrame();
  disposeRace();
  const T = buildTrackData(def);
  const ts = buildTrackScene(T, scene);
  const th = THEMES[def.theme] || THEMES.day;
  env = makeEnv(th.top, th.hor, def.scenery === 'desert' ? '#a88a5c' : '#3e4a33');
  scene.environment = env;
  renderer.toneMappingExposure = th.exp;
  if (settings.quality !== 'high') ts.sun.shadow.mapSize.set(1024, 1024);
  const humans = cfg.players.map(p => p.driver);
  const order = cfg.mode === 'trial' ? humans.map(driverById) : gridOrder(humans, cfg.start);
  const entries = order.map(d => {
    const pi = humans.indexOf(d.id);
    const comp = pi >= 0 ? cfg.players[pi].compound : (Math.random() < 0.55 ? 'M' : Math.random() < 0.6 ? 'S' : 'H');
    return { driver: d, team: teamById(d.team), isPlayer: pi >= 0, playerIndex: pi, compound: comp };
  });
  const race = new Race(T, { entries, laps: cfg.laps, difficulty: cfg.difficulty, mode: cfg.mode === 'trial' ? 'trial' : 'race', assists: cfg.players.map(() => ({ brake: settings.brakeAssist })) });
  for (const c of race.cars) {
    const tm = DRIVERS.filter(d => d.team === c.team.id).indexOf(c.driver);
    c.model = new CarModel(c.team, c.driver, { compound: c.compound, teammateIndex: tm });
    scene.add(c.model.group);
  }
  const players = cfg.players.map((p, i) => race.cars.find(c => c.playerIndex === i));
  G = { cfg, def, T, ts, race, players, rigs: players.map((c, i) => new CamRig(cameras[i], settings.cams[i] || 'chase')), paused: false, doneT: 0, line: null, record: store.get('best', {})[def.id] };
  if (settings.line) { G.line = racingLineMesh(T); scene.add(G.line); }
  race.onLight = n => { ts.setLamps(n); hud.setLights(n); if (n > 0) audio.blip(520, 0.25, 'square', 0.12); };
  race.onFinish = c => { if (c.isPlayer) audio.blip(880, 0.4, 'triangle', 0.2); };
  if (race.mode === 'trial') { ts.setLamps(0); }
  hud.setup(race, T, players);
  hud.setLights(0);
  if (race.mode !== 'trial') { hud.lightsEl.hidden = false; }
  hud.layout(viewports().map(v => v.css));
  $('touch').hidden = !(isTouch && players.length === 1);
  audio.engineCount(players.length + 1);
  setScreen('');
  window.__f1 = G;
}

function disposeRace() {
  if (!G) return;
  G.race.cars.forEach(c => { scene.remove(c.model.group); c.model.dispose(); });
  if (G.line) { scene.remove(G.line); G.line.geometry.dispose(); }
  G.ts.dispose();
  if (env) { env.dispose(); env = null; }
  G = null;
  hud.hide();
  audio.stopAll();
}

function togglePause(force) {
  if (!G || G.race.phase === 'done') return;
  G.paused = force !== undefined ? force : !G.paused;
  if (G.paused) {
    audio.stopAll();
    setScreen(`<div class="wrap"><div class="title-block"><p class="eyebrow">${G.def.gp}</p><h1 class="h1">Pause</h1></div>
      <div class="menu">
        <button class="mbtn primary" data-a="resume">Weiterfahren</button>
        <button class="mbtn" data-a="restart">Neu starten</button>
        <button class="mbtn" data-a="cam">Kamera wechseln <small>${CAM_NAMES[G.rigs[0].mode]}</small></button>
        <button class="mbtn" data-a="mute">Ton <small>${settings.mute ? 'aus' : 'an'}</small></button>
        <button class="mbtn" data-a="quit">${G.cfg.mode === 'season' ? 'Rennen aufgeben' : 'Hauptmenü'}</button>
      </div></div>`, 'dim', {
      resume: () => togglePause(false),
      restart: () => startRace(G.cfg),
      cam: () => { cycleCam(0); togglePause(true); },
      mute: () => { settings.mute = !settings.mute; audio.setMuted(settings.mute); saveSettings(); togglePause(true); },
      quit: () => { const season = G.cfg.mode === 'season'; disposeRace(); season ? seasonHub() : titleScreen(); },
    });
  } else setScreen('');
}

// ---------- Hauptschleife ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G) {
    const { race, players } = G;
    if (!G.paused) {
      const inp = readInputs();
      for (let k = 0; k < TIME_SCALE; k++) race.update(dt, inp);
      for (const ev of race.events) hud.message(ev.player, ev.text, ev.kind);
      race.events.length = 0;
      for (const c of race.cars) {
        const m = c.model;
        m.group.position.set(c.x, c.y, c.z);
        m.group.rotation.set(c.pitch, c.psi, c.roll);
        m.update(dt, c.v, c.steer, c.harvest && c.v > 20);
      }
      // Ton
      const vps = viewports();
      players.forEach((c, i) => {
        const gi = gearInfo(c.v, PHYS.VMAX * c.perf);
        audio.updateEngine(i, { rpm: race.phase === 'grid' ? 0.35 + Math.random() * 0.05 : gi.rpm, throttle: race.phase === 'grid' ? 0.3 : c.throttle, slide: Math.min(1, c.slide * 2 + (c.surface === 'gravel' ? 0.4 : 0)), pan: players.length > 1 && vps[0].h === H ? (i ? 0.6 : -0.6) : 0, gain: players.length > 1 ? 0.75 : 1 });
        if (c.hit > 5 && !c._hitSound) { audio.thud(c.hit / 8); c._hitSound = true; }
        if (c.hit < 1) c._hitSound = false;
        // neue Bestzeit im Zeitfahren
        if (race.mode === 'trial' && c.bestLap && (!G.record || c.bestLap < G.record - 0.0005)) {
          if (G.record) hud.message(i, 'NEUER STRECKENREKORD', 'purple');
          G.record = c.bestLap; const b = store.get('best', {}); b[G.def.id] = c.bestLap; store.set('best', b);
        }
      });
      // nächstes fremdes Auto
      const me = players[0];
      let near = null, nd = 1e9;
      for (const c of race.cars) if (!c.isPlayer) { const d = Math.hypot(c.x - me.x, c.z - me.z); if (d < nd) { nd = d; near = c; } }
      if (near) audio.updateEngine(players.length, { rpm: gearInfo(near.v, PHYS.VMAX).rpm, throttle: near.throttle, gain: Math.max(0, 1 - nd / 70) * 0.7, on: race.phase !== 'grid' });
      hud.update(dt);
      G.ts.update(race.clock);
      if (race.phase === 'done') {
        G.doneT += dt;
        if (G.doneT > 1.5 && !G.shown) { G.shown = true; showResults(); }
      }
    }
    // Rendern (je Spieler ein Bildausschnitt)
    const vps = viewports();
    renderer.setScissorTest(vps.length > 1);
    vps.forEach((vp, i) => {
      const car = players[i];
      const cam = cameras[i];
      cam.aspect = vp.w / vp.h;
      G.rigs[i].update(car, G.paused ? 0 : dt, race);
      cam.updateProjectionMatrix();
      // Schattenkamera folgt dem Auto
      const sun = G.ts.sun;
      sun.target.position.set(car.x, car.y, car.z);
      sun.position.copy(G.ts.sunDir).multiplyScalar(220).add(sun.target.position);
      renderer.setViewport(vp.x, vp.y, vp.w, vp.h);
      renderer.setScissor(vp.x, vp.y, vp.w, vp.h);
      renderer.render(scene, cam);
    });
    players.forEach(c => { c.model.helmet.visible = true; });
  } else {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    show.angle += dt * 0.25;
    const r = 8.2;
    show.cam.position.set(Math.sin(show.angle) * r, 2.1, Math.cos(show.angle) * r);
    show.cam.lookAt(0, 0.45, 0);
    show.cam.aspect = W / H;
    if (show.shift) show.cam.setViewOffset(W, H, -W * show.shift, 0, W, H); else show.cam.clearViewOffset();
    show.cam.updateProjectionMatrix();
    if (show.car) show.car.update(dt, 0, Math.sin(show.angle * 0.7) * 0.6, false);
    renderer.toneMappingExposure = 1.0;
    renderer.render(show.scene, show.cam);
  }
}

// ---------- Menüs ----------
let actions = {};
function setScreen(html, cls = 'dim', acts = {}) {
  screenEl.className = 'screen ' + cls;
  screenEl.innerHTML = html;
  actions = acts;
  screenEl.scrollTop = 0;
  resize();
}
screenEl.addEventListener('click', e => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  audio.initAudio();
  const fn = actions[b.dataset.a];
  if (fn) fn(b.dataset.v, b);
});

const LEGAL = 'Inoffizielles Fan-Spiel, nicht verbunden mit der Formel 1, der FIA oder den Teams. Streckenverläufe: bacinger/f1-circuits (MIT-Lizenz).';

function titleScreen() {
  const season = store.get('season', null);
  const d = driverById(settings.lastDriver || 'nor');
  showroomCar(d.team, d.id);
  setScreen(`<div class="wrap">
    <div class="title-block">
      <h1 class="logo">F1 <span class="yr">26</span><span class="stripes"><i></i><i></i><i></i></span></h1>
      <p class="sub">Saison 2026 · 11 Teams · 22 Fahrer · 8 Strecken</p>
    </div>
    <div class="menu">
      <button class="mbtn primary" data-a="quick">Schnelles Rennen <small>1 Spieler</small></button>
      <button class="mbtn" data-a="mp">Multiplayer <small>2 Spieler · Splitscreen</small></button>
      <button class="mbtn" data-a="season">Weltmeisterschaft <small>${season ? `Runde ${Math.min(season.round + 1, TRACKS.length)}/${TRACKS.length}` : '8 Rennen'}</small></button>
      <button class="mbtn" data-a="trial">Zeitfahren <small>Rekorde jagen</small></button>
      <button class="mbtn" data-a="keys">Steuerung &amp; Grafik</button>
    </div>
    <p class="foot">${LEGAL}</p>
  </div>`, 'dim side', {
    quick: () => pickDriver({ mode: 'quick', players: [] }, 0),
    mp: () => pickDriver({ mode: 'quick', players: [] }, 0, 2),
    season: () => (season ? seasonHub() : pickDriver({ mode: 'season', players: [] }, 0)),
    trial: () => pickDriver({ mode: 'trial', players: [] }, 0),
    keys: controlsScreen,
  });
}

function pickDriver(cfg, pi, total = cfg.players.length || 1) {
  cfg.total = cfg.total || total;
  let sel = cfg.players[pi]?.driver || (pi === 0 ? settings.lastDriver : null) || null;
  const taken = cfg.players.filter((p, i) => i !== pi).map(p => p.driver);
  if (taken.includes(sel)) sel = null;
  const render = () => {
    setScreen(`<div class="wrap">
      <div class="head"><div><p class="eyebrow">${cfg.total > 1 ? `Spieler ${pi + 1} von ${cfg.total}` : cfg.mode === 'season' ? 'Weltmeisterschaft' : cfg.mode === 'trial' ? 'Zeitfahren' : 'Schnelles Rennen'}</p><h1 class="h1">Fahrer wählen</h1></div><button class="back" data-a="back">Zurück</button></div>
      <div class="teams">${TEAMS.map(t => `<div class="team" style="--tc:${t.ui}"><div class="team-h"><b>${t.name}</b><span>${t.engine}</span></div>
        ${DRIVERS.filter(d => d.team === t.id).map(d => `<button class="drv${sel === d.id ? ' sel' : ''}${taken.includes(d.id) ? ' taken' : ''}" data-a="pick" data-v="${d.id}"><span class="num">${d.num}</span><span class="nm">${d.first}<b>${d.last}</b></span><span class="nat">${d.nat}</span></button>`).join('')}
      </div>`).join('')}</div>
      <div class="bar-actions"><span class="pick-info">${sel ? `<b>${driverById(sel).first} ${driverById(sel).last}</b> · ${teamById(driverById(sel).team).name}` : 'Tippe auf einen Fahrer.'}</span><button class="go" data-a="next" ${sel ? '' : 'disabled'}>Weiter</button></div>
    </div>`, 'dim side', {
      back: () => (pi > 0 ? pickDriver(cfg, pi - 1) : titleScreen()),
      pick: id => { sel = id; const d = driverById(id); showroomCar(d.team, d.id); render(); },
      next: () => {
        cfg.players[pi] = { driver: sel, compound: cfg.players[pi]?.compound || settings.compound };
        if (pi === 0) { settings.lastDriver = sel; saveSettings(); }
        if (pi + 1 < cfg.total) pickDriver(cfg, pi + 1);
        else setupScreen(cfg);
      },
    });
    screenEl.querySelectorAll('.drv').forEach(b => b.addEventListener('pointerenter', () => { const d = driverById(b.dataset.v); showroomCar(d.team, d.id); }));
  };
  if (sel) { const d = driverById(sel); showroomCar(d.team, d.id); }
  render();
}

function trackThumb(cv, def) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  const pts = def.pts; let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minZ = Math.min(minZ, pts[i + 1]); maxZ = Math.max(maxZ, pts[i + 1]); }
  const sc = Math.min((w - 20) / (maxX - minX), (h - 20) / (maxZ - minZ));
  const ox = (w - (maxX - minX) * sc) / 2, oz = (h - (maxZ - minZ) * sc) / 2;
  g.clearRect(0, 0, w, h);
  g.beginPath();
  for (let i = 0; i < pts.length; i += 2) { const x = ox + (pts[i] - minX) * sc, y = oz + (pts[i + 1] - minZ) * sc; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath(); g.lineJoin = 'round';
  g.strokeStyle = '#000'; g.lineWidth = 7; g.stroke();
  g.strokeStyle = '#e8ecf0'; g.lineWidth = 3.5; g.stroke();
  g.fillStyle = '#b25cff'; g.beginPath(); g.arc(ox + (pts[0] - minX) * sc, oz + (pts[1] - minZ) * sc, 5, 0, 7); g.fill();
}

function setupScreen(cfg) {
  const season = cfg.mode === 'season';
  const trial = cfg.mode === 'trial';
  cfg.track = cfg.track || settings.track;
  cfg.laps = cfg.laps || settings.laps;
  cfg.difficulty = cfg.difficulty || settings.difficulty;
  cfg.start = cfg.start || settings.start;
  const best = store.get('best', {});
  const seg = (key, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button data-a="opt" data-v="${key}:${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const render = () => {
    setScreen(`<div class="wrap">
      <div class="head"><div><p class="eyebrow">${season ? 'Weltmeisterschaft · Einstellungen' : trial ? 'Zeitfahren' : cfg.total > 1 ? 'Multiplayer · 2 Spieler' : 'Schnelles Rennen'}</p><h1 class="h1">${season ? 'Deine Saison' : 'Rennen einstellen'}</h1></div><button class="back" data-a="back">Zurück</button></div>
      ${season ? `<div class="cal">${TRACKS.map((t, i) => `<div class="rd"><small>Runde ${i + 1}</small><b>${t.name}</b><span class="ti">${t.gp.replace('Großer Preis ', 'GP ')}</span></div>`).join('')}</div>` :
      `<div class="tracks">${TRACKS.map(t => `<button class="card${cfg.track === t.id ? ' sel' : ''}" data-a="track" data-v="${t.id}"><canvas width="352" height="160" data-t="${t.id}"></canvas><span class="gp">${t.gp.replace('Großer Preis ', 'GP ')}</span><span class="tn">${t.name}</span><span class="ti">${t.info}</span><span class="tl">${t.len.toFixed(3).replace('.', ',')} km${trial && best[t.id] ? ` · Rekord ${fmtTime(best[t.id])}` : ''}</span></button>`).join('')}</div>`}
      <div class="opts">
        ${trial ? '' : `<div class="opt"><span>Runden</span>${seg('laps', [[1, '1'], [3, '3'], [5, '5'], [10, '10'], [20, '20']], cfg.laps)}</div>
        <div class="opt"><span>KI-Gegner</span>${seg('difficulty', Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]), cfg.difficulty)}</div>`}
        ${trial || season ? '' : `<div class="opt"><span>Startplatz</span>${seg('start', [['quali', 'Qualifying'], ['pole', 'Pole'], ['back', 'Letzter'], ['random', 'Zufall']], cfg.start)}</div>`}
        ${cfg.players.map((p, i) => `<div class="opt"><span>Reifen${cfg.total > 1 ? ' · ' + driverById(p.driver).code : ''}</span><div class="seg">${Object.entries(TYRES).map(([k, v]) => `<button data-a="tyre" data-v="${i}:${k}" class="${p.compound === k ? 'on' : ''}"><span class="tyre-dot" style="color:${COMPOUNDS[k]}"></span>${v.label}</button>`).join('')}</div></div>`).join('')}
        <div class="opt"><span>Fahrhilfen</span><div class="seg"><button data-a="assist" data-v="brakeAssist" class="${settings.brakeAssist ? 'on' : ''}">Bremshilfe</button><button data-a="assist" data-v="line" class="${settings.line ? 'on' : ''}">Ideallinie</button></div></div>
      </div>
      <div class="bar-actions"><span class="pick-info">${cfg.players.map(p => `<b>${driverById(p.driver).last}</b>`).join(' &amp; ')}${season ? '' : ` · ${TRACKS.find(t => t.id === cfg.track).name}`}</span><button class="go" data-a="go">${season ? 'Saison starten' : 'Los geht’s'}</button></div>
    </div>`, 'dim', {
      back: () => pickDriver(cfg, cfg.total - 1),
      track: id => { cfg.track = id; settings.track = id; saveSettings(); render(); },
      opt: v => { const [k, val] = v.split(':'); cfg[k] = k === 'laps' ? +val : val; settings[k] = cfg[k]; saveSettings(); render(); },
      tyre: v => { const [i, k] = v.split(':'); cfg.players[+i].compound = k; if (+i === 0) { settings.compound = k; saveSettings(); } render(); },
      assist: k => { settings[k] = !settings[k]; saveSettings(); render(); },
      go: () => {
        if (season) {
          store.set('season', { driver: cfg.players[0].driver, compound: cfg.players[0].compound, laps: cfg.laps, difficulty: cfg.difficulty, round: 0, results: [], points: {}, teamPoints: {} });
          seasonHub();
        } else startRace({ mode: trial ? 'trial' : 'quick', players: cfg.players, total: cfg.total, track: cfg.track, laps: trial ? 999 : cfg.laps, difficulty: cfg.difficulty, start: cfg.start });
      },
    });
    screenEl.querySelectorAll('canvas[data-t]').forEach(cv => trackThumb(cv, TRACKS.find(t => t.id === cv.dataset.t)));
  };
  render();
}

function standingsTables(s) {
  const drv = DRIVERS.map(d => ({ d, p: s.points[d.id] || 0 })).sort((a, b) => b.p - a.p);
  const tms = TEAMS.map(t => ({ t, p: s.teamPoints[t.id] || 0 })).sort((a, b) => b.p - a.p);
  return `<div class="cols">
    <div class="tbl-wrap"><table><thead><tr><th>Pos</th><th>Fahrer</th><th>Team</th><th style="text-align:right">Punkte</th></tr></thead><tbody>
      ${drv.map((x, i) => `<tr class="${x.d.id === s.driver ? 'me' : ''}"><td class="p">${i + 1}</td><td><span class="tc" style="--tc:${teamById(x.d.team).ui}"></span>${x.d.first} <b>${x.d.last.toUpperCase()}</b></td><td>${teamById(x.d.team).name}</td><td class="pts">${x.p}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="tbl-wrap"><table><thead><tr><th>Pos</th><th>Team</th><th style="text-align:right">Punkte</th></tr></thead><tbody>
      ${tms.map((x, i) => `<tr class="${x.t.id === driverById(s.driver).team ? 'me' : ''}"><td class="p">${i + 1}</td><td><span class="tc" style="--tc:${x.t.ui}"></span><b>${x.t.name}</b></td><td class="pts">${x.p}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

function seasonHub() {
  const s = store.get('season', null);
  if (!s) return titleScreen();
  const d = driverById(s.driver);
  showroomCar(d.team, d.id);
  const done = s.round >= TRACKS.length;
  const leader = DRIVERS.map(x => ({ x, p: s.points[x.id] || 0 })).sort((a, b) => b.p - a.p)[0];
  setScreen(`<div class="wrap">
    <div class="head"><div><p class="eyebrow">Weltmeisterschaft 2026 · ${d.first} ${d.last} · ${DIFFICULTY[s.difficulty].label} · ${s.laps} Runden</p>
      ${done ? `<h1 class="champ">${leader.x.id === s.driver ? 'Du bist Weltmeister!' : `Weltmeister: ${leader.x.last}`}</h1>` : `<h1 class="h1">Runde ${s.round + 1} von ${TRACKS.length} · ${TRACKS[s.round].name}</h1>`}</div>
      <button class="back" data-a="menu">Hauptmenü</button></div>
    <div class="cal">${TRACKS.map((t, i) => { const r = s.results[i]; return `<div class="rd${i === s.round ? ' next' : ''}${r ? ' done' : ''}"><small>Runde ${i + 1}${r ? ' · Sieg ' + driverById(r.order[0]).code : ''}</small><b>${t.name}</b><span class="ti">${r ? `Du: P${r.order.indexOf(s.driver) + 1}` : t.gp.replace('Großer Preis ', 'GP ')}</span></div>`; }).join('')}</div>
    ${standingsTables(s)}
    <div class="bar-actions"><button class="back" data-a="reset">Saison löschen</button>${done ? '' : `<button class="go" data-a="race">Zum Rennen: ${TRACKS[s.round].name}</button>`}</div>
  </div>`, 'solid', {
    menu: titleScreen,
    reset: (v, btn) => { if (btn.dataset.sure) { store.del('season'); titleScreen(); } else { btn.dataset.sure = '1'; btn.textContent = 'Wirklich löschen?'; } },
    race: () => startRace({ mode: 'season', players: [{ driver: s.driver, compound: s.compound }], track: TRACKS[s.round].id, laps: s.laps, difficulty: s.difficulty, start: 'quali' }),
  });
}

function showResults() {
  const { race, cfg, def } = G;
  const res = race.results();
  const season = cfg.mode === 'season';
  if (season) {
    const s = store.get('season', null);
    if (s && TRACKS[s.round] && TRACKS[s.round].id === def.id) {
      res.forEach((r, i) => { const pts = POINTS[i] || 0; s.points[r.car.driver.id] = (s.points[r.car.driver.id] || 0) + pts; s.teamPoints[r.car.team.id] = (s.teamPoints[r.car.team.id] || 0) + pts; });
      s.results[s.round] = { track: def.id, order: res.map(r => r.car.driver.id), fastest: race.fastest.car ? race.fastest.car.driver.id : null };
      s.round++;
      store.set('season', s);
    }
  }
  const me = G.players;
  const winner = res[0].car;
  audio.stopAll();
  setScreen(`<div class="wrap">
    <div class="head"><div><p class="eyebrow">Ergebnis · ${def.gp}</p><h1 class="h1">${me.length === 1 ? `Du wirst P${me[0].pos}` : me.map(c => `${c.driver.code} P${c.pos}`).join(' · ')}${winner.isPlayer ? ' – Sieg!' : ''}</h1></div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Pos</th><th>Fahrer</th><th>Team</th><th>Zeit / Abstand</th><th>Beste Runde</th><th style="text-align:right">Punkte</th></tr></thead><tbody>
      ${res.map((r, i) => `<tr class="${r.car.isPlayer ? 'me' : ''}"><td class="p">${i + 1}</td><td><span class="tc" style="--tc:${r.car.team.ui}"></span>${r.car.driver.first} <b>${r.car.driver.last.toUpperCase()}</b>${r.car.penalty ? ` <small>(+${r.car.penalty} s Strafe)</small>` : ''}</td><td>${r.car.team.name}</td><td>${r.gapTxt}</td><td class="${race.fastest.car === r.car ? 'fl' : ''}">${fmtTime(r.car.bestLap)}</td><td class="pts">${POINTS[i] || ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="bar-actions">${season ? '<button class="go" data-a="hub">Zur WM-Tabelle</button>' : '<button class="back" data-a="menu">Hauptmenü</button><button class="back" data-a="setup">Andere Strecke</button><button class="go" data-a="again">Nochmal</button>'}</div>
  </div>`, 'solid', {
    hub: () => { disposeRace(); seasonHub(); },
    menu: () => { disposeRace(); titleScreen(); },
    setup: () => { const c = G.cfg; disposeRace(); setupScreen({ mode: 'quick', players: c.players, total: c.players.length, track: c.track, laps: c.laps, difficulty: c.difficulty, start: c.start }); },
    again: () => startRace(G.cfg),
  });
}

function controlsScreen() {
  const q = settings.quality;
  setScreen(`<div class="wrap">
    <div class="head"><div><p class="eyebrow">Hilfe</p><h1 class="h1">Steuerung &amp; Grafik</h1></div><button class="back" data-a="back">Zurück</button></div>
    <div class="keys">
      <div class="opt"><span>Spieler 1 (oder allein)</span>
        <div>Gas / Bremse <span><kbd>W</kbd> <kbd>S</kbd> oder <kbd>↑</kbd> <kbd>↓</kbd></span></div>
        <div>Lenken <span><kbd>A</kbd> <kbd>D</kbd> oder <kbd>←</kbd> <kbd>→</kbd></span></div>
        <div>Boost (Batterie) <span><kbd>Leertaste</kbd> / <kbd>Shift</kbd></span></div>
        <div>Kamera <span><kbd>C</kbd></span></div>
        <div>Pause / Ton <span><kbd>Esc</kbd> <kbd>M</kbd></span></div></div>
      <div class="opt"><span>Spieler 2 (Splitscreen)</span>
        <div>Gas / Bremse <span><kbd>↑</kbd> <kbd>↓</kbd></span></div>
        <div>Lenken <span><kbd>←</kbd> <kbd>→</kbd></span></div>
        <div>Boost <span><kbd>Enter</kbd> / <kbd>Shift rechts</kbd></span></div>
        <div>Kamera <span><kbd>.</kbd></span></div>
        <div>Gamepad <span>RT Gas · LT Bremse · Stick · X Boost · Y Kamera</span></div></div>
      <div class="opt"><span>Regeln wie 2026</span>
        <div style="display:block">Bist du weniger als 1 Sekunde hinter einem Auto, wird der <b>Overtake-Modus</b> aktiv: Boost bringt dann mehr Tempo und kostet weniger Batterie. Bremsen lädt die Batterie. Viermal neben der Strecke (<b>Track Limits</b>) gibt 5 Sekunden Strafe. Punkte: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1.</div></div>
      <div class="opt"><span>Grafik</span>
        <div class="seg"><button data-a="q" data-v="high" class="${q === 'high' ? 'on' : ''}">Hoch</button><button data-a="q" data-v="mid" class="${q === 'mid' ? 'on' : ''}">Mittel</button><button data-a="q" data-v="low" class="${q === 'low' ? 'on' : ''}">Niedrig</button></div>
        <div style="display:block;color:var(--muted)">Ruckelt es, stelle auf Mittel oder Niedrig.</div></div>
    </div>
  </div>`, 'dim side', { back: titleScreen, q: v => { settings.quality = v; saveSettings(); applyQuality(); controlsScreen(); } });
}

// ---------- Start ----------
resize();
requestAnimationFrame(frame);
if (params.has('autostart')) {
  const drv = params.get('driver') || 'nor';
  const players = [{ driver: drv, compound: 'M' }];
  if (params.has('mp')) players.push({ driver: params.get('driver2') || 'ver', compound: 'S' });
  if (params.has('line')) settings.line = true;
  if (params.get('cam')) settings.cams = [params.get('cam'), params.get('cam')];
  startRace({ mode: params.has('trial') ? 'trial' : 'quick', players, total: players.length, track: params.get('track') || 'ita', laps: +(params.get('laps') || 3), difficulty: params.get('diff') || 'medium', start: params.get('start') || 'quali' });
} else titleScreen();
