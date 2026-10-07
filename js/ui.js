import * as THREE from 'three';
import { clamp, lerp } from './util.js';
import { WEAPON_INFO } from './player.js';

const $ = (id) => document.getElementById(id);

export function createUI(G) {
  const ui = {};
  const el = {
    hp: $('hp-fill'), hpGhost: $('hp-ghost'), hpBar: $('hp-bar'), fp: $('fp-fill'), fpBar: $('fp-bar'), st: $('st-fill'), stBar: $('st-bar'),
    estus: $('estus-count'), mana: $('mana-count'), manaSlot: $('slot-mana'), estusSlot: $('slot-estus'), ashSlot: $('slot-ash'), souls: $('souls'), prompt: $('prompt'), banner: $('banner'), bannerText: $('banner-text'),
    boss: $('boss'), bossName: $('boss-name'), bossFill: $('boss-fill'), bossGhost: $('boss-ghost'), lock: $('lockon'), bars: $('enemybars'), rest: $('rest'), restList: $('rest-list'),
    restTitle: $('rest-title'), fade: $('fade'), hurt: $('hurt'), toast: $('toast'), floats: $('floats'),
  };
  let ghostHp = 1, ghostBoss = 1, soulsShown = 0, bossFrac = null, promptText = null, toastT = 0, bannerT = 0;
  const barPool = [];
  const v = new THREE.Vector3();

  ui.setPrompt = (t) => {
    if (t === promptText) return;
    promptText = t; el.prompt.textContent = t || ''; el.prompt.classList.toggle('show', !!t);
  };
  ui.banner = (text, kind = 'gold', dur = 4.2) => {
    el.bannerText.textContent = text; el.banner.className = 'show ' + kind;
    el.banner.style.animationDuration = dur + 's';
    el.banner.style.animation = 'none'; void el.banner.offsetWidth; el.banner.style.animation = '';
    el.banner.style.animationDuration = dur + 's';
    clearTimeout(ui._bt); ui._bt = setTimeout(() => { el.banner.className = ''; }, dur * 1000);
  };
  ui.toast = (t) => {
    if (!t) return;
    el.toast.textContent = t; el.toast.classList.add('show'); toastT = 2.2;
  };
  ui.hurt = () => { el.hurt.style.opacity = 1; };
  ui.flashMana = () => { el.manaSlot.classList.add('flash'); setTimeout(() => el.manaSlot.classList.remove('flash'), 400); };
  ui.flashParry = () => { const e = $('slot-parry'); e.classList.add('flash'); setTimeout(() => e.classList.remove('flash'), 300); };
  ui.flashFP = () => { el.fpBar.classList.add('flash'); setTimeout(() => el.fpBar.classList.remove('flash'), 400); };
  ui.flashEstus = () => { el.estusSlot.classList.add('flash'); setTimeout(() => el.estusSlot.classList.remove('flash'), 400); };
  ui.souls = (n) => {
    const d = document.createElement('div'); d.className = 'float'; d.textContent = '+' + n; el.floats.appendChild(d);
    setTimeout(() => d.remove(), 1800);
  };
  ui.fade = (a, ms = 800) => { el.fade.style.transition = `opacity ${ms}ms`; el.fade.style.opacity = a; };
  ui.setBoss = (name, show) => { el.boss.classList.toggle('show', !!show); if (name) el.bossName.textContent = name; if (show) { ghostBoss = 1; } };
  ui.restMap = []; ui.menuMode = 'rest'; ui.restCtx = null;
  ui.showRest = (lit, current) => {
    G.menuOpen = true; ui.menuMode = 'rest'; ui.restCtx = { lit, current };
    ui.restMap = lit.filter((b) => b !== current);
    el.restTitle.textContent = current.name;
    let html = `<div class="opt"><b>E</b> Aufstehen</div><div class="opt"><b>U</b> Aufleveln <span class="dim">(Level ${G.player.level()})</span></div>`;
    if (ui.restMap.length) html += '<div class="sep">Teleportieren</div>' + ui.restMap.map((b, i) => `<div class="opt"><b>${i + 1}</b> ${b.name}</div>`).join('');
    el.restList.innerHTML = html;
    el.rest.classList.add('show');
  };
  ui.showLevel = () => {
    const P = G.player; ui.menuMode = 'level';
    const cost = P.levelCost(), can = P.souls >= cost;
    const rows = [['vit', 'Vitalität', `${P.maxHp} HP`, '+14 HP'], ['mnd', 'Geist', `${P.maxFp} FP`, '+5 FP'], ['end', 'Ausdauer', `${P.maxSt} Ausdauer`, '+3 Ausdauer'], ['str', 'Stärke', `${Math.round(P.dmgMul * 100)}% Schaden`, '+3,5% Schaden']];
    el.restTitle.textContent = 'Aufleveln';
    el.restList.innerHTML = `<div class="lvl"><span>Level <b>${P.level()}</b></span><span>Seelen <b>${P.souls.toLocaleString('de-DE')}</b></span><span class="${can ? '' : 'poor'}">Kosten <b>${cost.toLocaleString('de-DE')}</b></span></div>` +
      rows.map(([k, n, now, gain], i) => `<div class="opt ${can ? '' : 'poor'}"><b>${i + 1}</b> ${n} <span class="val">${P.stats[k]}</span><span class="dim">${now} &nbsp;(${gain})</span></div>`).join('') +
      '<div class="sep"></div><div class="opt"><b>E</b> Zurück</div>';
    el.rest.classList.add('show');
  };
  ui.hideRest = () => { G.menuOpen = false; el.rest.classList.remove('show'); };
  ui.setWeapon = (name) => {
    const info = WEAPON_INFO[name];
    $('weapon-lbl').textContent = info.short; $('ash-lbl').textContent = info.ash;
    $('weapon-ico').className = 'ico ' + (name === 'greatsword' ? 'gsword' : 'katana');
    $('ash-ico').className = 'ico ash' + (name === 'greatsword' ? ' fire' : '');
  };

  // ---- Cutscene-UI ----
  ui.cineHint = () => {};
  ui.subtitle = (who, text) => {
    const box = $('cine-sub');
    if (!text) { box.classList.remove('show'); return; }
    $('cine-who').textContent = who || ''; $('cine-who').style.display = who ? 'block' : 'none'; $('cine-text').textContent = text; box.classList.add('show');
  };
  ui.titleCard = (title, sub) => {
    const t = $('cine-title'); $('cine-title-main').textContent = title; $('cine-title-sub').textContent = sub || '';
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  };
  ui.hideTitle = () => { $('cine-title').classList.remove('show'); };

  ui.update = (dt) => {
    const P = G.player;
    const w = (n) => Math.round(n) + 'px';
    el.hpBar.style.width = w(P.maxHp * 0.95); el.fpBar.style.width = w(P.maxFp * 3.0); el.stBar.style.width = w(P.maxSt * 2.4);
    const hf = P.hp / P.maxHp;
    el.hp.style.width = (hf * 100) + '%';
    ghostHp = hf < ghostHp ? lerp(ghostHp, hf, 1 - Math.exp(-1.6 * dt)) : hf;
    el.hpGhost.style.width = (ghostHp * 100) + '%';
    el.fp.style.width = (P.fp / P.maxFp * 100) + '%';
    el.st.style.width = (P.st / P.maxSt * 100) + '%';
    el.stBar.classList.toggle('exhausted', P.exhausted);
    el.estus.textContent = P.estus;
    el.estusSlot.classList.toggle('empty', P.estus <= 0);
    $('parry-cd').style.height = Math.min(100, (P.parryCd / 1.5) * 100) + '%'; $('slot-parry').classList.toggle('cooling', P.parryCd > 0);
    el.mana.textContent = P.mana; el.manaSlot.classList.toggle('empty', P.mana <= 0);
    el.ashSlot.classList.toggle('empty', P.fp < P.ashCost());
    soulsShown = lerp(soulsShown, P.souls, 1 - Math.exp(-6 * dt)); if (Math.abs(soulsShown - P.souls) < 1) soulsShown = P.souls;
    el.souls.textContent = Math.round(soulsShown).toLocaleString('de-DE');
    // Schaden-Vignette
    const o = parseFloat(el.hurt.style.opacity || 0); el.hurt.style.opacity = Math.max(0, o - dt * 2.2);
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.classList.remove('show'); }
    // Boss
    const b = G.boss;
    if (G.activeFight && b && !b.dead) {
      const f = clamp(b.hp / b.maxHp, 0, 1); el.bossFill.style.width = f * 100 + '%';
      ghostBoss = f < ghostBoss ? lerp(ghostBoss, f, 1 - Math.exp(-1.6 * dt)) : f; el.bossGhost.style.width = ghostBoss * 100 + '%';
    }
    // Gegner-Balken + Lock-On
    let used = 0;
    const cam = G.camera, W = innerWidth, H = innerHeight;
    for (const e of G.enemies) {
      if (e.dead || e.isBoss || (e.barT <= 0 && P.lock !== e)) continue;
      v.set(e.pos.x, e.pos.y + 2.3 * e.T.scale, e.pos.z).project(cam);
      if (v.z > 1 || v.z < -1) continue;
      let bar = barPool[used]; if (!bar) { bar = document.createElement('div'); bar.className = 'ebar'; bar.innerHTML = '<i></i>'; el.bars.appendChild(bar); barPool[used] = bar; }
      bar.style.display = 'block'; bar.style.left = ((v.x * 0.5 + 0.5) * W) + 'px'; bar.style.top = ((-v.y * 0.5 + 0.5) * H) + 'px';
      bar.firstChild.style.width = clamp(e.hp / e.maxHp, 0, 1) * 100 + '%'; used++;
    }
    for (let i = used; i < barPool.length; i++) barPool[i].style.display = 'none';
    const L = P.lock;
    if (L && !L.dead) {
      v.set(L.pos.x, L.pos.y + 1.25 * L.T.scale, L.pos.z).project(cam);
      if (v.z < 1) { el.lock.style.display = 'block'; el.lock.style.left = ((v.x * 0.5 + 0.5) * W) + 'px'; el.lock.style.top = ((-v.y * 0.5 + 0.5) * H) + 'px'; }
      else el.lock.style.display = 'none';
    } else el.lock.style.display = 'none';
  };
  return ui;
}
