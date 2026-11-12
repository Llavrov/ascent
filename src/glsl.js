// Общий кусок шейдеров: шум, туман, запечённые тени. Подключается во все материалы сцены.
export const COMMON = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uAmbCol, uFogCol, uFogSun;
uniform float uFogDen, uSeaDen, uSeaY, uSeaH, uTime, uExtent;
uniform sampler2D tBake, tBakeN; uniform vec3 uNear; // ближняя карта теней: центр x, z и половина стороны

float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float hash13(vec3 q){ q = fract(q * .1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), u.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }

// туман светлеет в сторону солнца
vec3 fogTint(vec3 rd){ float s = max(dot(rd, uSunDir), 0.); return mix(uFogCol, uFogSun, .5 * pow(s, 8.) + .5 * pow(s, 64.)); }
// прозрачность до точки: ровная мгла плюс море облаков ниже uSeaY
float fogT(vec3 p){
  vec3 v = p - cameraPosition; float d = length(v);
  float e0 = exp(-(cameraPosition.y - uSeaY) / uSeaH), e1 = exp(-(p.y - uSeaY) / uSeaH);
  float k = abs(v.y) > .01 ? (e0 - e1) * uSeaH / v.y : e0;
  return exp(-min(d * (uFogDen + uSeaDen * k), 40.));
}
vec3 applyFog(vec3 c, vec3 p){ return mix(fogTint(normalize(p - cameraPosition)), c, fogT(p)); }
// r: видно ли солнце, g: затенение в складках, b: общий уклон горы (1 - normal.y). У маршрута карта подробнее.
vec3 baked(vec3 p){
  vec3 f = texture2D(tBake, p.xz / (2. * uExtent) + .5).rgb;
  vec2 q = (p.xz - uNear.xy) / uNear.z;
  float w = smoothstep(1., .85, max(abs(q.x), abs(q.y)));
  return w > 0. ? mix(f, texture2D(tBakeN, q * .5 + .5).rgb, w) : f;
}
`;
