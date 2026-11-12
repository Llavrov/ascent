import * as THREE from 'three';
import { COMMON } from './glsl.js';

const FS = /* glsl */ `
${COMMON}
varying vec3 vDir;
uniform vec3 uSkyZen; uniform float uStorm, uCover; uniform vec2 uCloudOff;
void main(){
  vec3 rd = normalize(vDir);
  float s = max(dot(rd, uSunDir), 0.), up = max(rd.y, 0.);
  vec3 col = mix(uFogCol * 1.05, uSkyZen, pow(up, .55));
  // облака: крупная форма изломана мелкой, плотная середина темнее, край к солнцу светится
  vec2 cp = rd.xz / (up + .15) * 1.1 + uCloudOff;
  vec2 wq = vec2(fbm(cp * 1.7 + 3.), fbm(cp * 1.7 + 11.));
  float dn = fbm(cp + (wq - .5) * .9) * .55 + fbm(cp * 2.9 + wq * 1.3) * .3 + fbm(cp * 7.3) * .15;
  float cl = smoothstep(uCover, uCover + .26, dn) * smoothstep(0., .1, up), thick = smoothstep(uCover + .05, uCover + .42, dn);
  col = mix(col, mix(uSunCol * .42 + uAmbCol * 1.2, uAmbCol * 1.5 + uSunCol * .06, thick * .75) + uSunCol * .5 * pow(s, 6.) * (1. - thick), cl * .92);
  col += uSunCol * (1. - cl * .92) * (pow(s, 3000.) * 9. + pow(s, 200.) * .6 + pow(s, 12.) * .2);
  col = mix(col, fogTint(rd), max(uStorm, smoothstep(.02, -.06, rd.y))); // в пургу и ниже горизонта небо тонет в мгле
  gl_FragColor = vec4(col, 1.);
}`;

export function createSky(G) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: G,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * viewMatrix * vec4(position * 9000. + cameraPosition, 1.); }',
    fragmentShader: FS, side: THREE.BackSide, depthTest: false, depthWrite: false,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
