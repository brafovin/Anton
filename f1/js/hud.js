import { fmtTime, TYRES } from './race.js';
import { gearInfo, PHYS } from './phys.js';
import { COMPOUNDS } from './car.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud'); this.tower = $('tower'); this.list = $('tw-list'); this.lapEl = $('tw-lap');
    this.trackEl = $('tw-track'); this.map = $('minimap'); this.mg = this.map.getContext('2d');
    this.lightsEl = $('lights'); this.panels = [$('pl0'), $('pl1')];
    this.towerT = 0; this.slowT = 0;
  }

  setup(race, T, players) {
    this.race = race; this.T = T; this.players = players;
    this.root.hidden = false;
    this.trackEl.textContent = T.def.name.toUpperCase().slice(0, 14);
    // Zeitenturm
    this.list.innerHTML = '';
    this.rows = race.cars.map(() => {
      const li = document.createElement('li');
      li.innerHTML = '<b></b><i></i><span></span><em></em><u></u>';
      this.list.appendChild(li);
      return li;
    });
    this.tower.classList.toggle('compact', players.length > 1 || window.innerHeight < 640);
    this.tower.hidden = race.mode === 'trial';
    // Spieleranzeigen
    this.panels.forEach((p, k) => {
      const car = players[k];
      p.hidden = !car;
      if (!car) return;
      p.innerHTML = `<div class="msg"></div>
        <div class="info">
          <div class="pos"><b>P1</b><small>/${race.cars.length}</small><span class="lap"></span></div>
          <div class="who" style="--tc:${car.team.ui}">${car.driver.code} · ${car.team.name}${players.length > 1 ? ` · Spieler ${k + 1}` : ''}</div>
          <div class="row now"><span>Runde</span><b class="cur">0:00.000</b></div>
          <div class="row"><span>Letzte</span><b class="last">–</b></div>
          <div class="row"><span>Beste</span><b class="best">–</b></div>
          <div class="row"><span class="gl">Vorne</span><b class="gap">–</b></div>
          <div class="secs"><i></i><i></i><i></i></div>
        </div>
        <div class="dash">
          <div class="leds">${'<i></i>'.repeat(15)}</div>
          <div class="spd"><div class="gear">N</div><div class="kmh"><span>0</span><small>KM/H</small></div></div>
          <div class="batt"><i></i><span>BATTERIE</span></div>
          <div class="tyre"><span><span class="tyre-dot" style="color:${COMPOUNDS[car.compound]}"></span>${TYRES[car.compound].label}</span><span class="wear">0 %</span></div>
        </div>`;
      const q = s => p.querySelector(s);
      p.els = { msg: q('.msg'), pos: q('.pos b'), lap: q('.lap'), cur: q('.cur'), last: q('.last'), best: q('.best'), gap: q('.gap'), gl: q('.gl'),
        secs: [...p.querySelectorAll('.secs i')], leds: [...p.querySelectorAll('.leds i')], gear: q('.gear'), kmh: q('.kmh span'), batt: q('.batt'), battI: q('.batt i'), battS: q('.batt span'), wear: q('.wear') };
      if (race.mode === 'trial') { q('.pos').style.display = 'none'; q('.gl').parentElement.style.display = 'none'; }
      p.msgT = 0;
    });
    this.buildMap();
  }

  layout(rects) {
    this.panels.forEach((p, k) => {
      const r = rects[k];
      if (!r) return;
      Object.assign(p.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    });
  }

  buildMap() {
    const T = this.T, b = T.bbox, W = this.map.width, pad = 16;
    const sc = (W - pad * 2) / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const ox = pad + ((W - pad * 2) - (b.maxX - b.minX) * sc) / 2, oz = pad + ((W - pad * 2) - (b.maxZ - b.minZ) * sc) / 2;
    this.mp = (x, z) => [ox + (x - b.minX) * sc, oz + (z - b.minZ) * sc];
    const path = new Path2D();
    for (let i = 0; i <= T.N; i += 3) { const j = i % T.N; const [x, y] = this.mp(T.X[j], T.Z[j]); i ? path.lineTo(x, y) : path.moveTo(x, y); }
    path.closePath();
    this.mapPath = path;
  }

  drawMap() {
    const g = this.mg, W = this.map.width;
    g.clearRect(0, 0, W, W);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = 9; g.stroke(this.mapPath);
    g.strokeStyle = '#d9dee4'; g.lineWidth = 4; g.stroke(this.mapPath);
    const [sx, sy] = this.mp(this.T.X[0], this.T.Z[0]);
    g.fillStyle = '#fff'; g.fillRect(sx - 4, sy - 4, 8, 8); g.fillStyle = '#111'; g.fillRect(sx - 4, sy - 4, 4, 4); g.fillRect(sx, sy, 4, 4);
    const cars = [...this.race.cars].sort((a, b) => a.isPlayer - b.isPlayer);
    for (const c of cars) {
      const [x, y] = this.mp(c.x, c.z);
      g.beginPath(); g.arc(x, y, c.isPlayer ? 6 : 4, 0, Math.PI * 2);
      g.fillStyle = c.team.ui; g.fill();
      g.lineWidth = c.isPlayer ? 2.5 : 1; g.strokeStyle = c.isPlayer ? '#fff' : 'rgba(0,0,0,0.7)'; g.stroke();
    }
  }

  setLights(n) {
    this.lightsEl.hidden = n === 0 && this.race.phase !== 'grid';
    [...this.lightsEl.children].forEach((l, i) => l.classList.toggle('on', i < n));
  }

  message(player, text, kind = '') {
    this.panels.forEach((p, k) => {
      if (p.hidden || !p.els || (player >= 0 && player !== k)) return;
      p.els.msg.textContent = text;
      p.els.msg.className = 'msg show ' + kind;
      p.msgT = kind === 'flag' ? 5 : 2.4;
    });
  }

  update(dt) {
    const race = this.race;
    this.towerT -= dt; this.slowT -= dt;
    const slow = this.slowT <= 0; if (slow) this.slowT = 0.1;
    if (this.towerT <= 0 && race.order) {
      this.towerT = 0.25;
      const lead = race.order[0];
      this.lapEl.textContent = race.mode === 'trial' ? 'ZEITFAHREN' : `RUNDE ${Math.max(1, Math.min(race.laps, lead.lap))}/${race.laps}`;
      const show = new Set();
      race.order.forEach((c, k) => { if (k < 5) show.add(c); if (c.isPlayer) { show.add(c); if (race.order[k - 1]) show.add(race.order[k - 1]); if (race.order[k + 1]) show.add(race.order[k + 1]); } });
      race.order.forEach((c, k) => {
        const li = this.rows[k];
        let gap;
        if (k === 0) gap = race.phase === 'grid' ? '' : (c.finished ? 'Ziel' : 'Führung');
        else if (c.lapsDown >= 1) gap = `+${c.lapsDown} RD`;
        else gap = race.phase === 'grid' ? '' : '+' + (c.gap || 0).toFixed(1);
        if (c.finished && k > 0) gap = (c.lapsDown >= 1 ? gap : '+' + (c.gap || 0).toFixed(1));
        li.children[0].textContent = k + 1;
        li.style.setProperty('--tc', c.team.ui);
        li.children[2].textContent = c.driver.code;
        li.children[3].textContent = gap;
        li.style.setProperty('--cc', COMPOUNDS[c.compound]);
        li.className = (c.isPlayer ? 'me' : '') + (show.has(c) ? ' show' : '');
      });
    }
    this.drawMap();
    this.players.forEach((car, k) => {
      const p = this.panels[k]; if (!p.els) return;
      const e = p.els;
      if (p.msgT > 0) { p.msgT -= dt; if (p.msgT <= 0) e.msg.classList.remove('show'); }
      const vmax = PHYS.VMAX * car.perf;
      const gi = gearInfo(car.v, vmax);
      e.kmh.textContent = Math.round(Math.abs(car.v) * 3.6);
      e.gear.textContent = race.phase === 'grid' ? 'N' : gi.gear;
      const lit = car.v > 0.5 ? Math.round(gi.rpm * 15) : 0;
      e.leds.forEach((l, i) => { l.className = i < lit ? (i < 5 ? 'g' : i < 10 ? 'r' : 'b') : ''; });
      e.battI.style.width = (car.battery * 100).toFixed(1) + '%';
      e.batt.className = 'batt' + (car.boostOn ? (car.overtake ? ' ot' : ' on') : '');
      e.battS.textContent = car.boostOn ? (car.overtake ? 'OVERTAKE' : 'BOOST') : (car.overtake ? 'OVERTAKE BEREIT' : 'BATTERIE');
      if (!slow) return;
      e.pos.textContent = 'P' + (car.pos || 1);
      e.lap.textContent = race.mode === 'trial' ? `RUNDE ${Math.max(1, car.lap)}` : `RUNDE ${Math.max(1, Math.min(race.laps, car.lap))}/${race.laps}`;
      const cur = car.lap >= 1 && race.phase !== 'grid' && !car.finished ? race.t - car.lapStart : 0;
      e.cur.textContent = fmtTime(cur);
      e.cur.className = race.mode === 'trial' && !car.lapValid ? 'cur inv' : 'cur';
      e.last.textContent = fmtTime(car.lastLap);
      e.best.textContent = fmtTime(car.bestLap);
      e.best.className = 'best' + (car.bestLap && race.fastest.car === car ? ' purple' : '');
      const ahead = race.order && race.order[car.pos - 2];
      if (car.finished) { e.gl.textContent = 'Ziel'; e.gap.textContent = 'P' + car.pos; }
      else if (ahead) { e.gl.textContent = 'Vorne'; e.gap.textContent = ahead.dist - car.dist > race.T.L * 0.9 ? `${ahead.driver.code} +1 RD` : `${ahead.driver.code} +${Math.max(0, car.gapAhead).toFixed(1)}`; }
      else { e.gl.textContent = 'Vorne'; e.gap.textContent = 'Führung'; }
      e.secs.forEach((s, i) => { s.className = car.lastSectorCol[i] || ''; });
      e.wear.textContent = `Verschleiß ${Math.round(car.wear * 100)} %`;
    });
  }

  hide() { this.root.hidden = true; this.lightsEl.hidden = true; }
}
