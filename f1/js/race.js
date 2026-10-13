import { PHYS, grip, brakeDecel, accelAt } from './phys.js';
import { locate, pointAt, heightAt, gridSlot } from './track.js';

export const DIFFICULTY = {
  easy:   { label: 'Leicht', pace: 0.9 },
  medium: { label: 'Mittel', pace: 0.95 },
  hard:   { label: 'Profi',  pace: 0.985 },
};
export const TYRES = {
  S: { label: 'Soft',   grip: 1.025, wear: 0.016 },
  M: { label: 'Medium', grip: 1.0,   wear: 0.009 },
  H: { label: 'Hard',   grip: 0.98,  wear: 0.005 },
};

const SURF = {
  road:   { grip: 1,    drag: 0 },
  kerb:   { grip: 0.95, drag: 0.6 },
  runoff: { grip: 0.88, drag: 0.8 },
  grass:  { grip: 0.55, drag: 2.5, dragV: 0.1 },
  gravel: { grip: 0.42, drag: 7,   dragV: 0.3 },
};

const wrapS = (ds, L) => (ds > L / 2 ? ds - L : ds < -L / 2 ? ds + L : ds);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };

export class Car {
  constructor(o) {
    Object.assign(this, {
      x: 0, y: 0, z: 0, psi: 0, v: 0, steer: 0, throttle: 0, brake: 0, boostOn: false,
      idx: 0, s: 0, d: 0, prevS: 0, lap: 0, dist: 0, finished: false, finishTime: 0,
      lapStart: 0, lastLap: null, bestLap: null, secStart: 0, sector: 0, sectors: [null, null, null], bestSectors: [Infinity, Infinity, Infinity], lastSectorCol: ['', '', ''],
      battery: 1, overtake: false, harvest: false, gapAhead: 99,
      avoid: 0, avoidTarget: 0, surface: 'road', hit: 0, slide: 0, pitch: 0, roll: 0,
      wear: 0, warnings: 0, warnCool: 0, penalty: 0, lapValid: true, autopilot: false,
    }, o);
  }
}

export class Race {
  constructor(T, { entries, laps = 3, difficulty = 'medium', mode = 'race', assists = [] }) {
    this.T = T; this.laps = laps; this.mode = mode;
    this.pace = DIFFICULTY[difficulty].pace;
    this.t = 0; this.clock = 0;
    this.phase = mode === 'trial' ? 'race' : 'grid';
    this.lights = 0; this.lightT = 0; this.holdT = 0.6 + Math.random() * 1.8;
    this.leaderTimes = [];
    this.fastest = { time: Infinity, car: null };
    this.bestSector = [Infinity, Infinity, Infinity];
    this.events = [];
    this.endT = 0;
    this.cars = entries.map((e, k) => {
      const c = new Car({
        driver: e.driver, team: e.team, isPlayer: !!e.isPlayer, playerIndex: e.playerIndex ?? -1,
        perf: e.team.perf, skill: e.driver.skill, compound: e.compound || 'M', assist: assists[e.playerIndex] || {},
        grid: k,
      });
      // KI-Tempo: Team + Fahrer + Schwierigkeit, etwas Zufall pro Rennen
      c.pace = this.pace * (0.955 + 0.045 * ((c.skill - 0.88) / 0.11)) * (0.985 + Math.random() * 0.015);
      c.aggr = 0.6 + Math.random() * 0.8;
      if (mode === 'trial') this.place(c, T.L - 260, 0);
      else { const g = gridSlot(T, k); this.place(c, g.s, g.d); }
      return c;
    });
    this.standings();
  }

  place(c, s, d) {
    const p = pointAt(this.T, s, d);
    c.x = p.x; c.z = p.z; c.y = p.y; c.psi = Math.atan2(p.tx, p.tz);
    const loc = locate(this.T, c.x, c.z, -1);
    c.idx = loc.i; c.s = loc.s; c.d = loc.d; c.prevS = c.s;
    c.dist = c.s - this.T.L;
  }

  msg(car, text, kind = '') { this.events.push({ player: car ? car.playerIndex : -1, text, kind }); }

  update(dt, inputs) {
    const T = this.T;
    this.clock += dt;
    if (this.phase === 'grid') {
      this.lightT += dt;
      const n = Math.min(5, Math.floor((this.lightT - 1.2) / 0.9) + 1);
      if (n > this.lights && n > 0) { this.lights = n; this.onLight?.(n); }
      if (this.lights >= 5 && this.lightT > 1.2 + 4 * 0.9 + this.holdT) {
        this.phase = 'race'; this.lights = 0; this.onLight?.(0);
        this.msg(null, 'LIGHTS OUT!', 'go');
      }
      for (const c of this.cars) { c.v = 0; c.throttle = 0; }
      this.standings();
      return;
    }
    if (this.phase === 'race' || this.phase === 'cooldown') this.t += dt;

    for (const c of this.cars) {
      if (c.isPlayer && !c.autopilot) this.playerControl(c, inputs[c.playerIndex] || {}, dt);
      else this.aiControl(c, dt);
    }
    const sub = Math.ceil(dt / (1 / 120));
    const h = dt / sub;
    for (let k = 0; k < sub; k++) {
      for (const c of this.cars) this.stepCar(c, h);
      this.collide();
    }
    for (const c of this.cars) this.progress(c, dt);
    this.standings();
    // Rennende: alle im Ziel, oder alle Spieler im Ziel und 25 s vergangen
    if (this.mode === 'race' && this.phase !== 'done') {
      const players = this.cars.filter(c => c.isPlayer);
      if (this.cars.every(c => c.finished) || (players.length && players.every(c => c.finished) && this.endT && this.t - this.endT > 25)) this.phase = 'done';
    }
  }

  playerControl(c, inp, dt) {
    const target = clamp(inp.steer ?? ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)), -1, 1);
    const analog = inp.analog;
    if (analog) c.steer += (target - c.steer) * Math.min(1, dt * 14);
    else {
      const vf = clamp(Math.abs(c.v) / 80, 0, 1);
      const rate = target === 0 ? 5.5 : (Math.sign(target) !== Math.sign(c.steer) && c.steer !== 0 ? 7 : 3.4 - 1.4 * vf);
      const diff = target - c.steer;
      c.steer += clamp(diff, -rate * dt, rate * dt);
    }
    c.throttle = clamp(inp.throttle ?? (inp.up ? 1 : 0), 0, 1);
    c.brake = clamp(inp.brakeV ?? (inp.down ? 1 : 0), 0, 1);
    c.boostOn = !!inp.boost && c.battery > 0.02 && c.v > 12;
    // Bremshilfe: bremst vor Kurven automatisch auf ein sicheres Tempo
    if (c.assist.brake && c.v > 15) {
      const look = (c.idx + Math.round(c.v * 0.3 / this.T.ds)) % this.T.N;
      const safe = this.T.speed[look] * 0.97;
      if (c.v > safe + 1.5) { c.brake = Math.max(c.brake, clamp((c.v - safe) / 10, 0.25, 1)); c.throttle = Math.min(c.throttle, 0.1); }
    }
  }

  aiControl(c, dt) {
    const T = this.T, N = T.N, i = c.idx, L = T.L;
    const v = Math.max(c.v, 6);
    const look = (i + Math.round((v * 0.22) / T.ds)) % N;
    let vt = T.speed[look] * (c.autopilot ? 0.93 : c.pace);
    if (this.phase === 'done' || (c.finished && !c.isPlayer)) vt = Math.min(vt, 45);
    if (c.finished) vt = Math.min(vt, 50);
    // Andere Autos: Überholen, Verteidigen, nicht auffahren
    let block = null, blockDs = Infinity, blockJ = i;
    const lim = T.hw - 1.4;
    let side = 0;
    for (const o of this.cars) {
      if (o === c) continue;
      const ds = wrapS(o.s - c.s, L);
      if (ds > 0 && ds < 50) {
        const jj = (i + Math.round(ds / T.ds)) % N;
        const myD = T.line[jj] + c.avoid;
        if (Math.abs(o.d - myD) < 2.5 && ds < blockDs && (o.v < c.v + 2 || ds < 12)) { block = o; blockDs = ds; blockJ = jj; }
      }
      if (Math.abs(ds) < 7 && Math.abs(o.d - c.d) < 3.2) side += Math.sign(c.d - o.d || (c.grid - o.grid)) * (3.2 - Math.abs(o.d - c.d));
    }
    if (block) {
      const lineHere = T.line[blockJ];
      const left = block.d - 2.9, right = block.d + 2.9;
      const canL = left > -lim, canR = right < lim;
      let goal = null;
      if (canL && canR) goal = Math.abs(left - c.d) < Math.abs(right - c.d) ? left : right;
      else if (canL) goal = left; else if (canR) goal = right;
      if (goal !== null && (c.v > block.v - 1 || blockDs < 20)) c.avoidTarget = clamp(goal - lineHere, -2 * lim, 2 * lim);
      const lateral = Math.abs(block.d - c.d);
      if (blockDs < 14 && lateral < 2.3) vt = Math.min(vt, block.v - 1 + (blockDs - 9) * 0.4);
    } else {
      c.avoidTarget *= Math.max(0, 1 - dt * 0.7);
    }
    if (side) c.avoidTarget += clamp(side, -2, 2) * dt * 2.5;
    c.avoid += clamp(c.avoidTarget - c.avoid, -3.2 * dt, 3.2 * dt);
    // Lenken: Pure Pursuit auf die Ideallinie (+ Ausweichversatz)
    const Ld = 9 + v * 0.36;
    const j = (i + Math.round(Ld / T.ds)) % N;
    const dT = clamp(T.line[j] + c.avoid, -lim, lim);
    const tx = T.X[j] + T.NX[j] * dT, tz = T.Z[j] + T.NZ[j] * dT;
    const dx = tx - c.x, dz = tz - c.z;
    const fx = Math.sin(c.psi), fz = Math.cos(c.psi);
    const lx = dx * -fz + dz * fx, ly = dx * fx + dz * fz;
    const dist = Math.hypot(dx, dz) || 1;
    const kWanted = 2 * Math.sin(Math.atan2(lx, ly)) / dist;
    const gr = grip(v, T.bankG[i]);
    const kmax = Math.min(PHYS.KMAX, gr * 1.15 / (v * v));
    const st = clamp(kWanted / kmax, -1, 1);
    c.steer += (st - c.steer) * Math.min(1, dt * 10);
    // Gas und Bremse
    const dv = vt - c.v;
    if (dv > 1) { c.throttle = 1; c.brake = 0; }
    else if (dv < -1.2) { c.throttle = 0; c.brake = clamp(-dv / 7, 0.15, 1); }
    else { c.throttle = clamp(0.55 + dv * 0.3, 0, 1); c.brake = 0; }
    // Boost auf Geraden
    const straight = T.speed[look] > PHYS.VMAX * 0.9;
    c.boostOn = straight && c.v > 40 && c.battery > 0.2 && (c.overtake || c.battery > 0.55 || (block && blockDs < 40));
  }

  surfaceOf(c) {
    const T = this.T, i = c.idx, ad = Math.abs(c.d);
    if (ad <= T.hw + 0.3) return 'road';
    const city = T.def.scenery === 'city' || T.def.runoff < 6;
    if (ad <= T.hw + 1.5 && T.kerb[i]) return 'kerb';
    if (T.gravel[c.d > 0 ? 1 : 0][i] && ad <= T.hw + 12.5) return 'gravel';
    return city ? 'runoff' : 'grass';
  }

  stepCar(c, dt) {
    const T = this.T, i = c.idx;
    c.surface = this.surfaceOf(c);
    const sf = SURF[c.surface];
    const tyre = TYRES[c.compound] || TYRES.M;
    const gripF = sf.grip * tyre.grip * (1 - 0.08 * c.wear);
    const vmax = PHYS.VMAX * c.perf * (c.boostOn ? (c.overtake ? 1.045 : 1.03) : 1);
    const a0 = PHYS.A0 * (c.boostOn ? 1.15 : 1) * (0.9 + 0.1 * c.perf);
    const v = c.v;
    let a;
    if (v >= 0) {
      a = c.throttle * accelAt(v, vmax, a0) - (1 - c.throttle) * (0.3 + 0.0011 * v * v);
      if (v > vmax) a -= (v - vmax) * 0.6;
      a -= c.brake * brakeDecel(v) * Math.min(1, gripF + 0.1);
      if (c.brake > 0.1 && c.throttle < 0.1 && v < 0.6) a = -c.brake * 5; // Rückwärts
    } else {
      a = c.brake > 0.1 && c.throttle < 0.1 ? -c.brake * 5 : 8;
      if (v < -7) a = Math.max(a, 0);
    }
    a -= (sf.drag + (sf.dragV || 0) * Math.abs(v)) * Math.sign(v);
    const dir = Math.sin(c.psi) * T.TX[i] + Math.cos(c.psi) * T.TZ[i];
    a -= PHYS.G * T.slope[i] * dir;
    let nv = v + a * dt;
    if (v > 0 && nv < 0 && !(c.brake > 0.1 && c.throttle < 0.1)) nv = 0;
    if (v < 0 && nv > 0 && c.throttle < 0.1) nv = 0;
    c.v = nv;
    // Querdynamik: Lenken bis zur Haftgrenze, darüber Untersteuern
    const vv = Math.max(Math.abs(c.v), 1);
    let gr = grip(vv, T.bankG[i]) * gripF * (1 - 0.25 * c.brake * clamp(vv / 60, 0, 1));
    const kmax = Math.min(PHYS.KMAX, gr * 1.15 / (vv * vv));
    let k = c.steer * kmax;
    const aReq = vv * vv * Math.abs(k);
    c.slide = 0;
    if (aReq > gr) {
      k = Math.sign(k) * gr / (vv * vv);
      c.v -= Math.sign(c.v) * (aReq - gr) * 0.35 * dt;
      c.slide = (aReq - gr) / gr;
    }
    c.psi -= c.v * k * dt;
    c.latA = c.v * c.v * k;
    c.x += Math.sin(c.psi) * c.v * dt;
    c.z += Math.cos(c.psi) * c.v * dt;
    // Position auf der Strecke
    const loc = locate(T, c.x, c.z, c.idx);
    c.idx = loc.i; c.s = loc.s; c.d = loc.d;
    // Mauern
    const wR = T.wall[1][c.idx] - 1.0, wL = T.wall[0][c.idx] - 1.0;
    if (c.d > wR || c.d < -wL) {
      const over = c.d > wR ? c.d - wR : c.d + wL;
      const j = c.idx;
      c.x -= T.NX[j] * over; c.z -= T.NZ[j] * over; c.d -= over;
      const fx = Math.sin(c.psi), fz = Math.cos(c.psi);
      const into = (fx * T.NX[j] + fz * T.NZ[j]) * Math.sign(over) * Math.sign(c.v || 1);
      if (into > 0) {
        const loss = Math.max(0.2, 1 - into * 1.3);
        c.hit = Math.max(c.hit, Math.abs(c.v) * (1 - loss));
        c.v *= loss;
        const tdir = Math.sign(fx * T.TX[j] + fz * T.TZ[j]) || 1;
        c.psi = lerpAngle(c.psi, Math.atan2(T.TX[j] * tdir, T.TZ[j] * tdir), 0.55);
      }
    }
    // Batterie: Boost leert, Bremsen und Rollen laden
    if (c.boostOn) c.battery = Math.max(0, c.battery - dt / (c.overtake ? 11 : 8));
    c.harvest = c.brake > 0.2 || (c.throttle < 0.3 && c.v > 30);
    if (c.harvest) c.battery = Math.min(1, c.battery + dt * (0.03 + 0.11 * c.brake));
    c.wear = Math.min(1, c.wear + dt * Math.abs(c.v) / T.L * tyre.wear * (1 + c.slide * 3));
    // Höhe und Neigung (Steigungen, Steilkurven, Brücke)
    c.y = heightAt(T, c.idx, c.s, c.d);
    c.pitch = -Math.atan(T.slope[c.idx] * dir);
    c.roll = T.bankT[c.idx] ? -Math.atan(T.bankT[c.idx]) * T.bankOut[c.idx] * Math.sign(dir || 1) : 0;
  }

  collide() {
    const cars = this.cars, L = this.T.L, T = this.T;
    const CL = PHYS.CAR_LEN, CW = PHYS.CAR_WID;
    for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
      const A = cars[a], B = cars[b];
      const ds = wrapS(B.s - A.s, L);
      if (Math.abs(ds) >= CL) continue;
      const dd = B.d - A.d;
      if (Math.abs(dd) >= CW || Math.abs(A.y - B.y) > 2.5) continue;
      const px = CL - Math.abs(ds), py = CW - Math.abs(dd);
      if (py < px * 0.55) {
        const sg = Math.sign(dd) || 1, m = py / 2 + 0.01;
        A.x -= T.NX[A.idx] * m * sg; A.z -= T.NZ[A.idx] * m * sg; A.d -= m * sg;
        B.x += T.NX[B.idx] * m * sg; B.z += T.NZ[B.idx] * m * sg; B.d += m * sg;
        A.v *= 0.997; B.v *= 0.997;
        A.hit = Math.max(A.hit, 2); B.hit = Math.max(B.hit, 2);
      } else {
        const front = ds > 0 ? B : A, rear = ds > 0 ? A : B, m = px / 2 + 0.01;
        front.x += T.TX[front.idx] * m; front.z += T.TZ[front.idx] * m; front.s += m;
        rear.x -= T.TX[rear.idx] * m; rear.z -= T.TZ[rear.idx] * m; rear.s -= m;
        if (rear.v > front.v) {
          const dv = rear.v - front.v;
          rear.v -= dv * 0.65; front.v += dv * 0.3;
          rear.hit = Math.max(rear.hit, dv); front.hit = Math.max(front.hit, dv);
        }
      }
    }
  }

  progress(c, dt) {
    const T = this.T, L = T.L;
    const ps = c.prevS, s = c.s;
    // Track Limits (nur Spieler): komplett neben der weißen Linie
    c.warnCool = Math.max(0, c.warnCool - dt);
    if (c.isPlayer && this.phase !== 'grid' && !c.finished && Math.abs(c.d) > T.hw + 1.3 && c.warnCool === 0 && c.surface !== 'road') {
      c.warnCool = 4;
      c.lapValid = false;
      if (this.mode === 'race') {
        c.warnings++;
        if (c.warnings >= 4) { c.penalty += 5; this.msg(c, '5 SEKUNDEN STRAFE · TRACK LIMITS', 'pen'); c.warnings = 0; }
        else this.msg(c, `TRACK LIMITS · VERWARNUNG ${c.warnings}/3`, 'warn');
      } else this.msg(c, 'RUNDE UNGÜLTIG · TRACK LIMITS', 'warn');
    }
    if (ps > L * 0.8 && s < L * 0.2) {
      const frac = (L - ps) / Math.max(0.001, (L - ps) + s);
      const tc = this.t - dt * (1 - frac);
      this.crossLine(c, tc);
    } else if (ps < L * 0.2 && s > L * 0.8) {
      c.lap--;
    }
    // Sektoren
    const sec = Math.min(2, Math.floor(s / (L / 3)));
    if (c.lap >= 1 && sec === c.sector + 1) {
      this.sectorDone(c, c.sector, this.t);
      c.sector = sec;
    }
    c.prevS = s;
    if (!c.finished) c.dist = (c.lap - 1) * L + s;
    c.hit = Math.max(0, c.hit - dt * 30);
  }

  sectorDone(c, k, t) {
    const st = t - c.secStart;
    c.secStart = t;
    if (c.lap < 1) return;
    c.sectors[k] = st;
    let col = 'yellow';
    if (st < c.bestSectors[k]) { c.bestSectors[k] = st; col = 'green'; }
    if (st < this.bestSector[k]) { this.bestSector[k] = st; col = 'purple'; }
    c.lastSectorCol[k] = col;
    if (k === 0) { c.lastSectorCol[1] = ''; c.lastSectorCol[2] = ''; }
  }

  crossLine(c, tc) {
    c.lap++;
    if (c.lap >= 2) {
      this.sectorDone(c, 2, tc);
      const lt = tc - c.lapStart;
      c.lastLap = lt;
      const valid = c.lapValid || this.mode === 'race';
      if (valid && (!c.bestLap || lt < c.bestLap)) c.bestLap = lt;
      if (valid && lt < this.fastest.time) {
        const had = this.fastest.car;
        this.fastest = { time: lt, car: c };
        if (had && c.isPlayer) this.msg(c, 'SCHNELLSTE RUNDE', 'purple');
      }
    }
    c.lapStart = tc; c.secStart = tc; c.sector = 0; c.lapValid = true;
    if (this.mode === 'race') {
      if (c.lap === this.laps && !c.finished && c.isPlayer && this.laps > 1) this.msg(c, 'LETZTE RUNDE', 'last');
      const leaderDone = this.cars.some(o => o.finished);
      if (c.lap > this.laps || (leaderDone && c.lap >= 2)) {
        if (!c.finished) {
          c.finished = true; c.finishTime = tc + c.penalty; c.dist = (c.lap - 1) * this.T.L;
          if (c.isPlayer) { c.autopilot = true; this.endT = this.endT || this.t; this.msg(c, 'ZIELFLAGGE', 'flag'); }
          this.onFinish?.(c);
        }
      }
    }
  }

  standings() {
    const L = this.T.L;
    const order = [...this.cars].sort((a, b) => (b.dist - a.dist) || (a.finishTime - b.finishTime));
    order.forEach((c, k) => { c.pos = k + 1; });
    this.order = order;
    // Zeitabstand zum Führenden über Wegmarken alle 10 m
    const lead = order[0];
    const li = Math.floor(Math.max(0, lead.dist) / 10);
    for (let k = this.leaderTimes.length; k <= li; k++) this.leaderTimes[k] = this.t;
    for (let k = 0; k < order.length; k++) {
      const c = order[k];
      if (k === 0) { c.gap = 0; c.interval = 0; c.gapAhead = 99; continue; }
      const ahead = order[k - 1];
      if (c.finished && lead.finished) c.gap = c.finishTime - lead.finishTime;
      else { const t0 = this.leaderTimes[Math.floor(Math.max(0, c.dist) / 10)]; c.gap = t0 === undefined ? 0 : Math.max(0, this.t - t0); }
      c.lapsDown = Math.floor((lead.dist - c.dist) / L);
      c.gapAhead = (ahead.dist - c.dist) / Math.max(c.v, 15);
      c.overtake = this.phase === 'race' && c.lap >= 2 && c.gapAhead < 1.0;
    }
  }

  // Für das Ergebnis: alle Autos klassifizieren
  results() {
    const lead = this.order[0];
    return this.order.map(c => {
      let gapTxt;
      if (c === lead) gapTxt = fmtTime(c.finished ? c.finishTime : this.t);
      else if (c.lapsDown >= 1) gapTxt = `+${c.lapsDown} ${c.lapsDown === 1 ? 'Runde' : 'Runden'}`;
      else gapTxt = '+' + (c.gap || 0).toFixed(3);
      return { car: c, gapTxt };
    });
  }
}

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}
