import * as THREE from 'three';
import { rand, clamp } from './util.js';

const PV = `
attribute float size; attribute vec4 col; varying vec4 vC;
void main(){ vC = col; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*(260./-mv.z); gl_Position = projectionMatrix*mv; }`;
const PF = `
varying vec4 vC; void main(){ float d = length(gl_PointCoord-.5); float a = smoothstep(.5,.05,d)*vC.a; if(a<.01) discard; gl_FragColor = vec4(vC.rgb, a); }`;

class Particles {
  constructor(scene, n, additive) {
    this.n = n; this.i = 0;
    this.p = new Float32Array(n * 3); this.c = new Float32Array(n * 4); this.s = new Float32Array(n);
    this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.c0 = new Float32Array(n * 4); this.s0 = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('col', new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: PV, fragmentShader: PF, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.mesh.frustumCulled = false; scene.add(this.mesh);
    for (let k = 0; k < n; k++) this.p[k * 3 + 1] = -999;
  }
  emit(pos, count, { vel = 3, up = 1, life = 0.6, size = 0.15, color = [1, 0.7, 0.3], gravity = 8, drag = 1.5, spread = 0.1, dir = null } = {}) {
    for (let k = 0; k < count; k++) {
      const i = this.i; this.i = (this.i + 1) % this.n;
      this.p[i * 3] = pos.x + rand(-spread, spread); this.p[i * 3 + 1] = pos.y + rand(-spread, spread); this.p[i * 3 + 2] = pos.z + rand(-spread, spread);
      let vx = rand(-1, 1), vy = rand(-0.3, 1) * up, vz = rand(-1, 1);
      const l = Math.hypot(vx, vy, vz) || 1; const sp = vel * rand(0.3, 1);
      vx = (vx / l) * sp; vy = (vy / l) * sp; vz = (vz / l) * sp;
      if (dir) { vx += dir.x * vel * 0.6; vy += dir.y * vel * 0.6; vz += dir.z * vel * 0.6; }
      this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
      this.life[i] = this.max[i] = life * rand(0.6, 1.2); this.grav[i] = gravity; this.drag[i] = drag;
      this.c0[i * 4] = color[0]; this.c0[i * 4 + 1] = color[1]; this.c0[i * 4 + 2] = color[2]; this.c0[i * 4 + 3] = color[3] ?? 1;
      this.s0[i] = size * rand(0.6, 1.3);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.s[i] !== 0) { this.s[i] = 0; this.c[i * 4 + 3] = 0; } continue; }
      this.life[i] -= dt;
      const k = clamp(this.life[i] / this.max[i], 0, 1), dr = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= dr; this.v[i * 3 + 2] *= dr; this.v[i * 3 + 1] = this.v[i * 3 + 1] * dr - this.grav[i] * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.c[i * 4] = this.c0[i * 4]; this.c[i * 4 + 1] = this.c0[i * 4 + 1]; this.c[i * 4 + 2] = this.c0[i * 4 + 2]; this.c[i * 4 + 3] = this.c0[i * 4 + 3] * k;
      this.s[i] = this.s0[i] * (0.4 + 0.6 * k);
    }
    const a = this.mesh.geometry.attributes; a.position.needsUpdate = a.col.needsUpdate = a.size.needsUpdate = true;
  }
}

export class Trail {
  constructor(scene, color = 0xbfe0ff, n = 14) {
    this.n = n; this.pts = []; this.active = false;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.col = new Float32Array(n * 2 * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    this.mesh.frustumCulled = false; this.mesh.visible = false; scene.add(this.mesh);
    this.rgb = new THREE.Color(color);
  }
  setColor(c) { this.rgb.set(c); }
  push(base, tip) { this.pts.unshift({ b: base.clone(), t: tip.clone(), age: 0 }); if (this.pts.length > this.n) this.pts.pop(); }
  clear() { this.pts.length = 0; }
  update(dt, life = 0.22) {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[this.pts.length - 1].age > life) this.pts.pop();
    const n = this.pts.length;
    this.mesh.visible = n > 1;
    if (n < 2) return;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[Math.min(i, n - 1)], a = i < n ? clamp(1 - p.age / life, 0, 1) : 0;
      this.pos.set([p.b.x, p.b.y, p.b.z, p.t.x, p.t.y, p.t.z], i * 6);
      this.col.set([this.rgb.r, this.rgb.g, this.rgb.b, a * 0.2, this.rgb.r, this.rgb.g, this.rgb.b, a * 0.85], i * 8);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

export function makeFX(scene) {
  const fx = {};
  fx.add = new Particles(scene, 900, true);
  fx.norm = new Particles(scene, 500, false);
  const flashLight = new THREE.PointLight(0xffffff, 0, 14, 2); scene.add(flashLight);
  let flashT = 0, flashMax = 1, flashI = 0;
  fx.flash = (pos, color = 0xffeebb, intensity = 80, dur = 0.25) => { flashLight.position.copy(pos); flashLight.color.set(color); flashI = intensity; flashT = flashMax = dur; };
  // Schockwellen / Ringe
  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.85, 1, 40); ringGeo.rotateX(-Math.PI / 2);
  fx.ring = (pos, { color = 0xffddaa, r = 6, dur = 0.5, opacity = 0.8 } = {}) => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    m.position.copy(pos); m.position.y += 0.1; m.scale.setScalar(0.3); scene.add(m); rings.push({ m, t: 0, dur, r, opacity });
  };
  // Slash-Welle (Ash of War)
  const crescent = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, 'rgba(160,210,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(160,210,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 100); g.quadraticCurveTo(128, -40, 256, 100); g.quadraticCurveTo(128, 28, 0, 100); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const waves = [];
  fx.wave = (pos, yaw, { speed = 28, life = 0.35, size = 6 } = {}) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.5), new THREE.MeshBasicMaterial({ map: crescent, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    m.position.copy(pos); m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2 + 0.25, yaw, 0); m.rotation.x = -0.15;
    // senkrechter Halbmond, der nach vorne fliegt
    m.rotation.set(0, yaw, 0.12);
    scene.add(m); waves.push({ m, t: 0, life, speed, yaw });
  };
  // Schwebende Staubkoerner / Glutfunken rund um die Kamera (Wrap im Vertex-Shader, keine CPU-Kosten)
  const AMB_MAX = 700, AMB_BOX = new THREE.Vector3(46, 18, 46);
  const ambGeo = new THREE.BufferGeometry();
  { const pos = new Float32Array(AMB_MAX * 3), seed = new Float32Array(AMB_MAX * 2);
    for (let i = 0; i < AMB_MAX; i++) { pos[i * 3] = Math.random() * AMB_BOX.x; pos[i * 3 + 1] = Math.random() * AMB_BOX.y; pos[i * 3 + 2] = Math.random() * AMB_BOX.z; seed[i * 2] = Math.random(); seed[i * 2 + 1] = Math.random(); }
    ambGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); ambGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 2)); }
  const ambMat = new THREE.ShaderMaterial({
    uniforms: { uCenter: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: AMB_BOX } },
    vertexShader: `uniform vec3 uCenter, uBox; uniform float uTime; attribute vec2 seed; varying float vA; varying float vW;
      void main(){
        vec3 drift = vec3(sin(uTime*.13+seed.x*40.)*.5, .18+seed.y*.25, cos(uTime*.11+seed.y*40.)*.5);
        vec3 p = position + drift*uTime;
        vec3 rel = mod(p - uCenter + uBox*.5, uBox) - uBox*.5;
        rel.x += sin(uTime*.7+seed.x*30.)*.25; rel.z += cos(uTime*.6+seed.y*30.)*.25;
        vec4 mv = viewMatrix*vec4(uCenter+rel,1.);
        float edge = 1. - smoothstep(.55, 1., length(rel/(uBox*.5)));
        vA = edge*(.35+.65*sin(uTime*(.8+seed.x*1.6)+seed.y*30.)*.5+.325); vW = seed.x;
        gl_PointSize = (.05+seed.y*.07)*(300./-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vA; varying float vW; void main(){ float d = length(gl_PointCoord-.5); float a = smoothstep(.5,.0,d)*vA*.8; if(a<.01) discard;
      gl_FragColor = vec4(mix(vec3(.75,.8,1.), vec3(1.,.7,.35), step(.88,vW)), a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const ambient = new THREE.Points(ambGeo, ambMat); ambient.frustumCulled = false; ambGeo.setDrawRange(0, 0); scene.add(ambient);
  fx.ambient = { setCount: (n) => ambGeo.setDrawRange(0, Math.min(AMB_MAX, n)), update: (t, center) => { ambMat.uniforms.uTime.value = t; ambMat.uniforms.uCenter.value.copy(center); } };
  fx.update = (dt) => {
    fx.add.update(dt); fx.norm.update(dt);
    if (flashT > 0) { flashT -= dt; flashLight.intensity = flashI * clamp(flashT / flashMax, 0, 1); } else flashLight.intensity = 0;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += dt; const k = r.t / r.dur;
      r.m.scale.setScalar(0.3 + (r.r - 0.3) * (1 - (1 - k) ** 3)); r.m.material.opacity = r.opacity * (1 - k);
      if (k >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i]; w.t += dt; const k = w.t / w.life;
      w.m.position.x += Math.sin(w.yaw) * w.speed * dt; w.m.position.z += Math.cos(w.yaw) * w.speed * dt;
      w.m.material.opacity = 1 - k; w.m.scale.setScalar(1 + k * 0.6);
      if (k >= 1) { scene.remove(w.m); w.m.material.dispose(); waves.splice(i, 1); }
    }
  };
  // Vorlagen
  const V = new THREE.Vector3();
  fx.sparks = (pos, n = 10, dir) => fx.add.emit(pos, n, { vel: 5, life: 0.4, size: 0.1, color: [1, 0.8, 0.4], gravity: 9, dir });
  fx.blood = (pos, n = 14, dir) => fx.norm.emit(pos, n, { vel: 4, life: 0.7, size: 0.13, color: [0.45, 0.02, 0.02, 0.9], gravity: 12, drag: 1, dir });
  fx.parry = (pos) => {
    fx.add.emit(pos, 40, { vel: 9, up: 1, life: 0.55, size: 0.16, color: [1, 0.92, 0.6], gravity: 2, drag: 2.5 });
    fx.add.emit(pos, 6, { vel: 0.5, life: 0.22, size: 1.6, color: [1, 0.95, 0.8], gravity: 0, drag: 5 });
    fx.flash(pos, 0xfff0c0, 120, 0.3);
    fx.ring(pos, { color: 0xffeebb, r: 3.5, dur: 0.35 });
  };
  fx.dust = (pos, n = 14) => fx.norm.emit(pos, n, { vel: 2.5, up: 0.4, life: 0.8, size: 0.5, color: [0.45, 0.42, 0.38, 0.35], gravity: -0.3, drag: 2 });
  fx.souls = (pos, n = 20) => fx.add.emit(pos, n, { vel: 2.5, up: 2, life: 1.4, size: 0.14, color: [1, 0.7, 0.35], gravity: -1.5, drag: 1 });
  fx.heal = (pos) => fx.add.emit(pos, 3, { vel: 0.8, up: 1, life: 1.2, size: 0.12, color: [1, 0.8, 0.4], gravity: -2, drag: 0.5, spread: 0.45 });
  return fx;
}
