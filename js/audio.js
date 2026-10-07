// Komplett synthetisierter Sound (WebAudio) – keine Audiodateien noetig.
let ac = null, master = null, noiseBuf = null, muted = false;
let windGain = null, droneGain = null, bossGain = null;

function noiseBuffer() {
  if (noiseBuf) return noiseBuf;
  const len = ac.sampleRate * 2;
  noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
function noise(dur, { type = 'lowpass', f0 = 800, f1 = 800, q = 1, vol = 0.3, attack = 0.005, delay = 0 } = {}) {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const src = ac.createBufferSource(); src.buffer = noiseBuffer(); src.loop = true;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl).connect(g).connect(master);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone(freq, dur, { type = 'sine', vol = 0.2, f1, attack = 0.005, delay = 0 } = {}) {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

const SFX = {
  swing: () => noise(0.22, { type: 'bandpass', f0: 500, f1: 2600, q: 0.8, vol: 0.22, attack: 0.04 }),
  swingHeavy: () => { noise(0.4, { type: 'bandpass', f0: 250, f1: 1800, q: 0.7, vol: 0.32, attack: 0.1 }); tone(90, 0.3, { type: 'sawtooth', vol: 0.05, f1: 50 }); },
  hit: () => { noise(0.18, { type: 'lowpass', f0: 3000, f1: 200, vol: 0.5 }); tone(120, 0.18, { type: 'triangle', vol: 0.35, f1: 40 }); },
  hitMetal: () => { noise(0.12, { type: 'highpass', f0: 3000, f1: 6000, vol: 0.3 }); tone(900, 0.2, { type: 'square', vol: 0.06, f1: 600 }); tone(1350, 0.25, { type: 'square', vol: 0.04, f1: 900 }); },
  hurt: () => { noise(0.3, { type: 'lowpass', f0: 1500, f1: 100, vol: 0.55 }); tone(80, 0.3, { type: 'sawtooth', vol: 0.25, f1: 35 }); },
  parry: () => {
    noise(0.1, { type: 'highpass', f0: 4000, f1: 8000, vol: 0.5 });
    [1180, 1770, 2370, 3150].forEach((f, i) => tone(f, 0.9 - i * 0.12, { type: 'sine', vol: 0.18 / (i + 1) ** 0.5, f1: f * 0.98 }));
    tone(220, 0.25, { type: 'triangle', vol: 0.3, f1: 90 });
  },
  parryFail: () => { noise(0.25, { type: 'bandpass', f0: 800, f1: 300, vol: 0.2 }); },
  riposte: () => { noise(0.35, { type: 'lowpass', f0: 4000, f1: 150, vol: 0.7 }); tone(70, 0.5, { type: 'triangle', vol: 0.5, f1: 30 }); tone(1500, 0.3, { type: 'sine', vol: 0.1, f1: 400 }); },
  roll: () => noise(0.4, { type: 'bandpass', f0: 300, f1: 900, q: 0.5, vol: 0.18, attack: 0.08 }),
  step: () => noise(0.07, { type: 'lowpass', f0: 500 + Math.random() * 300, f1: 120, vol: 0.12 }),
  gulp: () => { for (let i = 0; i < 3; i++) tone(260 + i * 40, 0.12, { type: 'sine', vol: 0.18, f1: 140, delay: i * 0.17 }); },
  estusHeal: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.7, { type: 'sine', vol: 0.09, delay: i * 0.07 })); },
  ash: () => { noise(0.9, { type: 'bandpass', f0: 3500, f1: 400, q: 1.5, vol: 0.4, attack: 0.02 }); tone(300, 0.7, { type: 'sawtooth', vol: 0.08, f1: 1500 }); tone(1800, 1.2, { type: 'sine', vol: 0.07, f1: 1790, delay: 0.05 }); },
  ashCharge: () => { tone(200, 0.5, { type: 'sine', vol: 0.12, f1: 800 }); noise(0.5, { type: 'highpass', f0: 1000, f1: 4000, vol: 0.12, attack: 0.3 }); },
  bonfire: () => {
    [110, 165, 220, 330, 440].forEach((f, i) => tone(f, 3.2, { type: 'sine', vol: 0.11, attack: 0.9, delay: i * 0.05 }));
    noise(2.6, { type: 'lowpass', f0: 600, f1: 2500, vol: 0.18, attack: 1.0 });
  },
  rest: () => { [196, 294, 392, 587].forEach((f, i) => tone(f, 2.5, { type: 'sine', vol: 0.08, attack: 0.5, delay: i * 0.12 })); },
  died: () => { tone(110, 3, { type: 'sawtooth', vol: 0.18, f1: 28, attack: 0.3 }); tone(55, 3.5, { type: 'sine', vol: 0.3, f1: 20, attack: 0.2 }); noise(3, { type: 'lowpass', f0: 800, f1: 60, vol: 0.3, attack: 0.5 }); },
  victory: () => { [220, 277, 330, 440, 554].forEach((f, i) => tone(f, 4, { type: 'sine', vol: 0.12, attack: 0.6, delay: i * 0.18 })); },
  souls: () => { [880, 1175, 1568].forEach((f, i) => tone(f, 0.5, { type: 'sine', vol: 0.08, delay: i * 0.06 })); },
  fog: () => noise(1.4, { type: 'lowpass', f0: 300, f1: 1800, vol: 0.3, attack: 0.5 }),
  bossSlam: () => { tone(60, 0.8, { type: 'triangle', vol: 0.7, f1: 25 }); noise(0.8, { type: 'lowpass', f0: 2000, f1: 80, vol: 0.6 }); },
  roar: () => { tone(90, 1.4, { type: 'sawtooth', vol: 0.22, f1: 45, attack: 0.2 }); noise(1.4, { type: 'bandpass', f0: 300, f1: 120, q: 2, vol: 0.3, attack: 0.2 }); },
  ui: () => tone(660, 0.12, { type: 'triangle', vol: 0.08, f1: 880 }),
  error: () => tone(160, 0.15, { type: 'square', vol: 0.06, f1: 120 }),
};

export const Sound = {
  init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ac.destination);
    // Wind
    const wsrc = ac.createBufferSource(); wsrc.buffer = noiseBuffer(); wsrc.loop = true;
    const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 0.6;
    windGain = ac.createGain(); windGain.gain.value = 0.05;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.11;
    const lfoG = ac.createGain(); lfoG.gain.value = 0.03;
    lfo.connect(lfoG).connect(windGain.gain);
    const lfoF = ac.createGain(); lfoF.gain.value = 180; lfo.connect(lfoF).connect(wf.frequency);
    wsrc.connect(wf).connect(windGain).connect(master); wsrc.start(); lfo.start();
    // dunkler Drone
    droneGain = ac.createGain(); droneGain.gain.value = 0.035; droneGain.connect(master);
    [55, 82.4, 110.2].forEach((f) => { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(droneGain); o.start(); });
    // Bosstheme: tiefer, pulsierender Chor-Drone
    bossGain = ac.createGain(); bossGain.gain.value = 0; bossGain.connect(master);
    [73.4, 110, 146.8, 155.6, 220].forEach((f, i) => {
      const o = ac.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'triangle'; o.frequency.value = f;
      const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 500;
      const g = ac.createGain(); g.gain.value = 0.08;
      o.connect(fl).connect(g).connect(bossGain); o.start();
    });
    const pl = ac.createOscillator(); pl.frequency.value = 1.2; const pg = ac.createGain(); pg.gain.value = 0.03;
    pl.connect(pg).connect(bossGain.gain); pl.start();
  },
  play(name) { if (ac && SFX[name]) { try { SFX[name](); } catch (e) { /* ignore */ } } },
  bossMusic(on) {
    if (!ac) return;
    bossGain.gain.cancelScheduledValues(ac.currentTime);
    bossGain.gain.linearRampToValueAtTime(on ? 0.35 : 0, ac.currentTime + (on ? 2 : 4));
  },
  toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.8; return muted; },
  get muted() { return muted; },
};
