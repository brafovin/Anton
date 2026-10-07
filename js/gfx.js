import * as THREE from 'three';
import { EffectComposer } from '../lib/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../lib/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../lib/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../lib/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../lib/jsm/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
//  Grafik: Bloom, Color-Grading (Tonung, Vignette, Filmkorn, leichte Chromatik),
//  Umgebungsreflexion fuer Metall, Qualitaetsstufen (Hoch / Mittel / Niedrig)
// ---------------------------------------------------------------------------
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.5 }, uGrain: { value: 0.03 }, uCA: { value: 0.0016 }, uSat: { value: 1.12 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uCA, uSat; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c, c);
      vec2 off = c * d * uCA * 7.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col *= mix(vec3(0.94, 0.98, 1.06), vec3(1.05, 1.01, 0.95), smoothstep(0.1, 0.8, l));   // kuehle Schatten, warme Lichter
      col *= 1.0 - uVig * smoothstep(0.12, 0.62, d * 2.2);
      float g = hash(vUv * vec2(1920.0, 1080.0) + uTime * 37.0) - 0.5;
      col += g * uGrain * (1.0 - clamp(l, 0.0, 1.0) * 0.5);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export const QUALITY = {
  high:   { label: 'Hoch',    pixelRatio: 2,   samples: 4, bloom: 0.45, post: true,  shadow: 2048, dust: 700 },
  medium: { label: 'Mittel',  pixelRatio: 1.5, samples: 0, bloom: 0.38,  post: true,  shadow: 2048, dust: 350 },
  low:    { label: 'Niedrig', pixelRatio: 1,   samples: 0, bloom: 0,    post: false, shadow: 1024, dust: 120 },
};

export function createGfx(G) {
  const { renderer, scene, camera } = G;
  const gfx = { quality: 'high' };
  let composer = null, bloom = null, grade = null;

  // Umgebungsreflexion aus einem kleinen Himmelsmodell (Metall spiegelt Himmel + Mond)
  gfx.buildEnvironment = () => {
    try {
      const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
      es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP); float y = d.y;
          vec3 top = vec3(0.05,0.08,0.17), hor = vec3(0.34,0.40,0.56), bot = vec3(0.09,0.08,0.07);
          vec3 c = y > 0.0 ? mix(hor, top, smoothstep(0.0, 0.8, y)) : mix(hor, bot, smoothstep(0.0, 0.35, -y));
          float m = pow(max(dot(d, normalize(vec3(-0.5,0.8,0.35))), 0.0), 90.0); c += vec3(1.0,1.05,1.3) * m * 7.0; gl_FragColor = vec4(c, 1.0); }`,
      })));
      const rt = pm.fromScene(es, 0.02); scene.environment = rt.texture; pm.dispose();
    } catch (e) { console.warn('Umgebungsreflexion nicht verfuegbar', e); }
  };

  function buildComposer(q) {
    if (composer) { try { composer.dispose(); } catch (e) { /* ignore */ } composer = null; }
    if (!q.post) return;
    try {
      composer = new EffectComposer(renderer);
      composer.renderTarget1.samples = q.samples; composer.renderTarget2.samples = q.samples;
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), q.bloom, 0.55, 1.05);
      composer.addPass(bloom);
      composer.addPass(new OutputPass()); // Tonemapping + sRGB zuerst, Grading danach im Anzeigeraum (Korn/Vignette wirken sonst im Dunkeln viel zu stark)
      grade = new ShaderPass(GradeShader); composer.addPass(grade);
      composer.setSize(innerWidth, innerHeight);
    } catch (e) { console.warn('Nachbearbeitung nicht verfuegbar, Niedrig-Modus', e); composer = null; }
  }

  gfx.setQuality = (name, persist = true) => {
    const q = QUALITY[name] || QUALITY.high; gfx.quality = QUALITY[name] ? name : 'high';
    renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    buildComposer(q);
    if (G.moon) { G.moon.shadow.mapSize.set(q.shadow, q.shadow); if (G.moon.shadow.map) { G.moon.shadow.map.dispose(); G.moon.shadow.map = null; } }
    if (G.fx && G.fx.ambient) G.fx.ambient.setCount(q.dust);
    if (persist) { try { localStorage.setItem('aschenfeuer-gfx', gfx.quality); } catch (e) { /* ignore */ } }
    return gfx.quality;
  };
  gfx.cycle = () => { const order = ['high', 'medium', 'low']; return gfx.setQuality(order[(order.indexOf(gfx.quality) + 1) % order.length]); };
  gfx.label = () => QUALITY[gfx.quality].label;
  gfx.resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    if (composer) composer.setSize(innerWidth, innerHeight);
  };
  gfx.render = (dt = 0.016) => {
    if (composer) { grade.uniforms.uTime.value += dt; composer.render(dt); }
    else renderer.render(scene, camera);
  };
  return gfx;
}
