// Synthetischer Sound: V6-Turbo-Motor je Spieler, vorbeifahrende Autos, Reifenquietschen, Einschläge, Startampel.
let ctx = null, master = null, muted = false;
const engines = [];
let noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.7; }
export const isMuted = () => muted;

function makeEngine(vol = 1) {
  const out = ctx.createGain(); out.gain.value = 0;
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 2.5;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
  shaper.curve = curve;
  const oscs = [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2, 0.18], ['triangle', 3, 0.12]].map(([type, mul, g]) => {
    const o = ctx.createOscillator(); o.type = type; const gg = ctx.createGain(); gg.gain.value = g;
    o.connect(gg); gg.connect(shaper); o.start(); return { o, mul };
  });
  shaper.connect(filt); filt.connect(out);
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (pan) { out.connect(pan); pan.connect(master); } else out.connect(master);
  // Turbo-Pfeifen und Reifen
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1400; nf.Q.value = 4;
  const ng = ctx.createGain(); ng.gain.value = 0;
  noise.connect(nf); nf.connect(ng); ng.connect(pan || master); noise.start();
  return { out, filt, oscs, pan, ng, nf, vol };
}

export function engineCount(n) {
  if (!ctx) return;
  while (engines.length < n) engines.push(makeEngine());
  engines.forEach((e, i) => { if (i >= n) e.out.gain.value = 0; });
}

// rpm 0..1, throttle 0..1, slide 0..1
export function updateEngine(i, { rpm, throttle, slide = 0, pan = 0, gain = 1, on = true }) {
  if (!ctx || !engines[i]) return;
  const e = engines[i], t = ctx.currentTime;
  const f = 70 + rpm * 520;
  e.oscs.forEach(({ o, mul }) => o.frequency.setTargetAtTime(f * mul, t, 0.03));
  e.filt.frequency.setTargetAtTime(500 + rpm * 2600 + throttle * 1500, t, 0.05);
  e.out.gain.setTargetAtTime(on ? (0.05 + throttle * 0.07 + rpm * 0.03) * gain : 0, t, 0.06);
  e.ng.gain.setTargetAtTime(on ? Math.min(0.16, slide * 0.25) * gain : 0, t, 0.05);
  if (e.pan) e.pan.pan.setTargetAtTime(pan, t, 0.05);
}

export function blip(freq = 880, dur = 0.18, type = 'sine', vol = 0.25) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur + 0.05);
}

export function thud(strength = 1) {
  if (!ctx) return;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
  const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(0.9, 0.25 * strength), ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
  s.connect(f); f.connect(g); g.connect(master); s.start(); s.stop(ctx.currentTime + 0.4);
}

export function stopAll() { engines.forEach(e => { e.out.gain.value = 0; e.ng.gain.value = 0; }); }
