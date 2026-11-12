import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

// Лучи: яркое небо размазывается от солнца, горы и альпинист их перекрывают.
const RAYS_FS = /* glsl */ `
uniform sampler2D tScene, tDepth; uniform vec2 uSunUV; varying vec2 vUv;
void main(){
  vec2 d = (uSunUV - vUv) / 40. * .92, uv = vUv; float acc = 0., w = 1.;
  for (int i = 0; i < 40; i++){
    uv += d;
    acc += w * step(.99999, texture2D(tDepth, uv).x) * clamp(dot(texture2D(tScene, uv).rgb, vec3(.333)) - 1.3, 0., 1.);
    w *= .965;
  }
  gl_FragColor = vec4(vec3(acc / 40.), 1.);
}`;

const MIX_FS = /* glsl */ `
uniform sampler2D tScene, tRays; uniform vec3 uRayCol; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tScene, vUv).rgb + texture2D(tRays, vUv).r * uRayCol;
  if (any(isnan(c))) c = vec3(0.); // один NaN после размытия свечения гасит весь кадр
  gl_FragColor = vec4(c, 1.);
}`;

const OUT_FS = /* glsl */ `
uniform sampler2D tMix; uniform vec3 uWhiteCol, uTint;
uniform float uWhite, uExposure, uDesat, uTime; uniform vec2 uRes; varying vec2 vUv;
float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){
  // Разлёта цветов к краям здесь нет намеренно: на мелком рисунке снега и камня он давал розовые и зелёные точки.
  vec3 c = mix(texture2D(tMix, vUv).rgb, uWhiteCol, uWhite) * uExposure;
  c = clamp(c * (2.51 * c + .03) / (c * (2.43 * c + .59) + .14), 0., 1.); // ACES
  // почти чёрно-белая картинка, но насыщенное (красный пуховик, тёплый фонарь) цвет сохраняет
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  c = mix(c, vec3(dot(c, vec3(.2126, .7152, .0722))) * uTint, uDesat * (1. - .85 * smoothstep(.25, .7, (mx - mn) / (mx + .001))));
  c = pow(c, vec3(1. / 2.2));
  c = mix(c, c * c * (3. - 2. * c), .3);
  vec2 q = (vUv - .5) * vec2(min(uRes.x / uRes.y, 1.6), 1.);
  c *= 1. - .42 * pow(length(q) * 1.25, 2.6);
  c += (hash12(vUv * uRes + fract(uTime) * 91.7) - .5) * .05;
  gl_FragColor = vec4(c, 1.);
}`;

export function createPost(renderer) {
  const half = { type: THREE.HalfFloatType, depthBuffer: false };
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
  const rays = new THREE.WebGLRenderTarget(1, 1, half), mix = new THREE.WebGLRenderTarget(1, 1, half);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.6, 1.1);
  const U = {
    tScene: { value: rt.texture }, tDepth: { value: rt.depthTexture }, tRays: { value: rays.texture }, tMix: { value: mix.texture },
    uSunUV: { value: new THREE.Vector2() }, uRayCol: { value: new THREE.Color() }, uWhiteCol: { value: new THREE.Color() },
    uTint: { value: new THREE.Color() }, uWhite: { value: 0 }, uExposure: { value: 1 }, uDesat: { value: 0.7 },
    uTime: { value: 0 }, uRes: { value: new THREE.Vector2() },
  };
  const pass = (fs) => new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: fs }));
  const raysQ = pass(RAYS_FS), mixQ = pass(MIX_FS), outQ = pass(OUT_FS);
  return {
    U, bloom,
    resize(w, h) {
      rt.setSize(w, h); mix.setSize(w, h); rays.setSize(w >> 2, h >> 2); bloom.setSize(w >> 1, h >> 1); U.uRes.value.set(w, h);
    },
    render(scene, camera) {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(rays);
      raysQ.render(renderer);
      renderer.setRenderTarget(mix);
      mixQ.render(renderer);
      bloom.render(renderer, null, mix, 0, false); // дописывает свечение прямо в mix
      renderer.setRenderTarget(null);
      outQ.render(renderer);
    },
  };
}
