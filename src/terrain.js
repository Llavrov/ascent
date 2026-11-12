import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { EXTENT, FINE, height, base, sAt, routeX, vnoise, smooth } from './world.js';
import { COMMON } from './glsl.js';

const NEAR = { x: 0, z: 140, half: 330 }; // вокруг маршрута тени и складки считаются подробнее

// Ось сетки: мелкий шаг в полосе маршрута, дальше шаг растёт на 7% за ячейку. Размеры полосы в world.js: по ним же гаснет мелкий рельеф.
function axis(lo, hi, step, far) {
  const core = [];
  for (let v = lo; v <= hi; v += step) core.push(v);
  const up = [], down = [];
  for (let s = step, v = hi; v < far;) { s *= FINE.grow; v += s; up.push(v); }
  for (let s = step, v = lo; v > -far;) { s *= FINE.grow; v -= s; down.push(v); }
  return down.reverse().concat(core, up);
}

// Снежные подушки настоящей геометрией. В подробной полосе у маршрута снег на скальных полках и у подножия скал приподнят сеткой
// до 70 см: у него свой силуэт и своя тень при любом свете, в том числе в пургу, когда солнца нет и нарисованная толщина не читается.
// Скалу определяем так же, как шейдер: склон круче общего уклона горы. Подушка ложится там, где сама точка пологая, а вокруг скала.
// Пишет высоту прямо в pos и возвращает глубину снега в каждой вершине (0 там, где подушки нет). У самой тропы подушек нет:
// высоту под ногами альпиниста считает world.js, и она должна совпадать с сеткой.
export function pillows(pos, xs, zs) {
  const nx = xs.length, snow = new Float32Array(nx * zs.length);
  const i0 = xs.findIndex((x) => x >= -FINE.x), i1 = xs.findLastIndex((x) => x <= FINE.x), j0 = zs.findIndex((z) => z >= FINE.z0), j1 = zs.findLastIndex((z) => z <= FINE.z1);
  const W = i1 - i0 + 1, H = j1 - j0 + 1, yAt = (a, b) => pos[((j0 + b) * nx + i0 + a) * 3 + 1], C = 8, cw = Math.ceil(W / C) + 1, ch = Math.ceil(H / C) + 1;
  const gen = new Float32Array(cw * ch); // общий уклон горы: меняется плавно, считаем в каждой восьмой точке
  for (let b = 0; b < ch; b++) for (let a = 0; a < cw; a++) {
    const x = xs[Math.min(i1, i0 + a * C)], z = zs[Math.min(j1, j0 + b * C)];
    gen[b * cw + a] = 1 - 12 / Math.hypot(base(x + 6, z) - base(x - 6, z), 12, base(x, z + 6) - base(x, z - 6));
  }
  const rock = new Float32Array(W * H);
  for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) {
    const am = Math.max(a - 1, 0), ap = Math.min(a + 1, W - 1), bm = Math.max(b - 1, 0), bp = Math.min(b + 1, H - 1);
    const hx = (yAt(ap, b) - yAt(am, b)) / (xs[i0 + ap] - xs[i0 + am]), hz = (yAt(a, bp) - yAt(a, bm)) / (zs[j0 + bp] - zs[j0 + bm]);
    const fa = a / C, fb = b / C, ca = Math.floor(fa), cb = Math.floor(fb), g = (k, l) => gen[(cb + l) * cw + ca + k];
    const general = (g(0, 0) * (1 - fa + ca) + g(1, 0) * (fa - ca)) * (1 - fb + cb) + (g(0, 1) * (1 - fa + ca) + g(1, 1) * (fa - ca)) * (fb - cb);
    rock[b * W + a] = smooth(0.045, 0.1, (1 - 1 / Math.sqrt(1 + hx * hx + hz * hz) - general) * 0.75);
  }
  const blur = (src, r) => { // размытие квадратом в две проходки
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let b = 0; b < H; b++) for (let a = 0, sum = 0, n = 0; a < W + r; a++) {
      if (a < W) { sum += src[b * W + a]; n++; }
      if (a - 2 * r - 1 >= 0) { sum -= src[b * W + a - 2 * r - 1]; n--; }
      if (a - r >= 0 && a - r < W) tmp[b * W + a - r] = sum / n;
    }
    for (let a = 0; a < W; a++) for (let b = 0, sum = 0, n = 0; b < H + r; b++) {
      if (b < H) { sum += tmp[b * W + a]; n++; }
      if (b - 2 * r - 1 >= 0) { sum -= tmp[(b - 2 * r - 1) * W + a]; n--; }
      if (b - r >= 0 && b - r < H) out[(b - r) * W + a] = sum / n;
    }
    return out;
  };
  const around = blur(rock, 7), depth = new Float32Array(W * H);
  for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) {
    const x = xs[i0 + a], z = zs[j0 + b], k = b * W + a, u = Math.abs(x - routeX(z));
    depth[k] = 0.7 * smooth(0.1, 0.3, around[k] * (1 - rock[k])) * smooth(0.3, 0.55, vnoise(x / 4.3 + 7, z / 4.3)) * (0.6 + 0.5 * vnoise(x / 1.7, z / 1.7 + 3)) // не каждая полка занесена
      * smooth(6, 10, u) * smooth(FINE.x, FINE.x - 6, Math.abs(x)) * smooth(FINE.z0, FINE.z0 + 8, z) * smooth(FINE.z1, FINE.z1 - 8, z);
  }
  const soft = blur(depth, 1);
  for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) { const k = (j0 + b) * nx + i0 + a, d = Math.max(0, soft[b * W + a]); pos[k * 3 + 1] += d; snow[k] = d; } // max: скользящая сумма размытия уходит в минус на последних знаках
  return snow;
}

// Одна формула для обеих карт: дальняя на весь мир и ближняя вокруг маршрута.
const BAKE_FS = /* glsl */ `
uniform sampler2D tH, tHF; uniform vec3 uSun, uReg; // uReg: центр и половина стороны этой карты
uniform vec4 uK; // подъём луча над землёй, первый шаг, малый и большой радиус складок
uniform float uE; varying vec2 vUv;
float HF(vec2 xz){ return texture2D(tHF, xz / (2. * uE) + .5).r; }
float H(vec2 xz){ vec2 q = (xz - uReg.xy) / uReg.z; return max(abs(q.x), abs(q.y)) < 1. ? texture2D(tH, q * .5 + .5).r : HF(xz); }
void main(){
  vec2 xz = uReg.xy + (vUv * 2. - 1.) * uReg.z; float h0 = H(xz);
  float vis = 1., t = uK.y;
  for (int i = 0; i < 120; i++){ vec3 p = vec3(xz.x, h0 + uK.x, xz.y) + uSun * t; vis = min(vis, 9. * (p.y - H(p.xz)) / t); t += uK.y * .5 + t * .05; }
  float occ = 0.;
  for (int k = 0; k < 6; k++){
    float a = float(k) * .5236; vec2 d = vec2(cos(a), sin(a));
    occ += max(0., ((H(xz + d * uK.z) + H(xz - d * uK.z)) * .5 - h0) / uK.z) + max(0., ((H(xz + d * uK.w) + H(xz - d * uK.w)) * .5 - h0) / uK.w);
  }
  gl_FragColor = vec4(smoothstep(0., 1., clamp(vis, 0., 1.)), clamp(1. - occ * .45, .3, 1.), texture2D(tHF, xz / (2. * uE) + .5).g, 1.);
}`;

const VS = /* glsl */ `
attribute float aS, aSnow;
varying vec3 vW; varying vec3 vN; varying float vS, vSnow;
void main(){ vW = position; vN = normal; vS = aS; vSnow = aSnow; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`;

// Шум, мелкий рельеф, линия маршрута и веса трёх сторон текстуры: общие для пикселей и для вершин подробной сетки.
const FIELD = /* glsl */ `
float routeX(float z){ return 7. * sin(z * .021 + .5) + 3. * sin(z * .057 + 1.3); }

// шум со значением и градиентом
vec4 noised(vec3 x){
  vec3 i = floor(x), f = fract(x);
  vec3 u = f * f * f * (f * (f * 6. - 15.) + 10.), du = 30. * f * f * (f * (f - 2.) + 1.);
  float a = hash13(i), b = hash13(i + vec3(1., 0., 0.)), c = hash13(i + vec3(0., 1., 0.)), d = hash13(i + vec3(1., 1., 0.));
  float e = hash13(i + vec3(0., 0., 1.)), g = hash13(i + vec3(1., 0., 1.)), h = hash13(i + vec3(0., 1., 1.)), k = hash13(i + vec3(1., 1., 1.));
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + h, k6 = a - b - e + g, k7 = -a + b + c - d + e - g - h + k;
  return vec4(a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z,
    du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y));
}
// Мелкий рельеф: rid=1 даёт острые скальные грани, 0 мягкий снег. Каждая октава повёрнута,
// иначе шум ложится квадратами по осям. Мелкие октавы гаснут вдали, чтобы не рябило.
const mat3 M3 = mat3(0., .8, .6, -.8, .36, -.48, -.6, -.48, .64);
vec4 bump(vec3 p, float px, float rid){
  float a = .5, f = 1.; vec4 s = vec4(0.); mat3 m = mat3(1.);
  for (int i = 0; i < 5; i++){
    vec4 n = noised(p);
    float c = 2. * n.x - 1.;
    // Острые грани гаснут раньше мягкого шума: у них наклон одинаково силён на любой октаве и меняет знак на гребне,
    // так что грани размером в несколько пикселей рассыпали кромку снега в точки.
    s += a * smoothstep(mix(1., 6., rid), mix(3., 18., rid), 1. / (f * px)) * vec4(mix(n.x, 1. - abs(c), rid), (mix(n.yzw, -sign(c) * 2. * n.yzw, rid) * m) * f);
    p = M3 * p * 2.02; m = M3 * m; f *= 2.02; a *= .5;
  }
  return s;
}
// Текстуры кладём с трёх сторон, чтобы не тянулись на стене.
vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(6.)); return w / (w.x + w.y + w.z); }
`;

// Подробная сетка 32 на 32 м вокруг альпиниста: клетка 6 см, ездит за ним шагами в целую клетку, поэтому вершины стоят в мире на месте.
// Основание берёт у общей сетки (те же треугольники, из текстуры её вершин) и поднимает снег над камнем по-настоящему:
// у пласта свой силуэт, он закрывает камень за собой и не скользит по нему, когда едет камера. Толщина, нарисованная в пикселях
// (сдвиг вдоль взгляда), на общей сетке вблизи выглядела как рисунок под стеклом.
const CELL = 0.0625, HALF = 16, N1 = Math.round((2 * HALF) / CELL) + 1; // N1: вершин на сторону
// точка общей сетки под (x, z): та же плоскость треугольника, что рисует общая сетка
const BASE = /* glsl */ `
uniform sampler2D tGridA, tGridB; // вершины общей сетки в подробной полосе: высота, подушка, путь; нормаль
uniform vec4 uGrid;  // x и z первой вершины, обратный шаг по x и z
uniform vec3 uPatch; // центр x, z и половина стороны подробной сетки
void baseAt(vec2 xz, out vec3 P, out vec3 N, out float s, out float snow){
  vec2 g = (xz - uGrid.xy) * uGrid.zw; ivec2 c = ivec2(floor(g)); vec2 f = g - vec2(c);
  vec4 a00 = texelFetch(tGridA, c, 0), a10 = texelFetch(tGridA, c + ivec2(1, 0), 0), a01 = texelFetch(tGridA, c + ivec2(0, 1), 0), a11 = texelFetch(tGridA, c + ivec2(1, 1), 0);
  vec3 n00 = texelFetch(tGridB, c, 0).xyz, n10 = texelFetch(tGridB, c + ivec2(1, 0), 0).xyz, n01 = texelFetch(tGridB, c + ivec2(0, 1), 0).xyz, n11 = texelFetch(tGridB, c + ivec2(1, 1), 0).xyz;
  vec4 A; vec3 n;
  if (f.x + f.y <= 1.){ A = a00 + f.x * (a10 - a00) + f.y * (a01 - a00); n = n00 + f.x * (n10 - n00) + f.y * (n01 - n00); }
  else { A = a11 + (1. - f.x) * (a01 - a11) + (1. - f.y) * (a10 - a11); n = n11 + (1. - f.x) * (n01 - n11) + (1. - f.y) * (n10 - n11); }
  P = vec3(xz.x, A.x, xz.y); N = normalize(n); snow = A.y; s = A.z;
}`;

// Поле снега и камня для подробной сетки, по точке на вершину. Считается в текстуру заново, когда сетка переехала.
// Сначала сырьё: r сколько снега хочет лечь (запас глубины в метрах, с минусом на голой скале), g высота камня над основанием в метрах,
// b доля скалы, a доля настоящей геометрии (0 у края сетки и на самой тропе: там высоту под ногами считает world.js, и она должна совпадать).
// Потом LEVEL_FS наливает снег до ровного уровня. Формулы снега и скалы те же, что в пиксельном шейдере горы ниже: менять вместе.
const FIELD_FS = /* glsl */ `
${COMMON}
${FIELD}
${BASE}
uniform sampler2D tRock;
float rockHv(vec3 p, vec3 w){ float k = 1. / 9.; return clamp(dot(textureLod(tRock, p.zy * k, 3.).rgb * w.x + textureLod(tRock, p.xz * k, 3.).rgb * w.y + textureLod(tRock, p.xy * k, 3.).rgb * w.z, vec3(1.6)), 0., 1.); }
void main(){
  vec3 p, N; float s, snow;
  baseAt(uPatch.xy + floor(gl_FragCoord.xy) * ${CELL} - uPatch.z, p, N, s, snow);
  vec2 q = abs(p.xz - uPatch.xy);
  float u = p.x - routeX(p.z), up = u - (.2 * sin(s * .83) + .1 * sin(s * 2.1 + 1.));
  // К краю сетки подъём сходит на нет за 5 м, чтобы переход к нарисованной толщине не читался полосой. Последние 15 см ровно ноль:
  // там подробная сетка лежит точно на общей, и общая под ней ещё рисуется.
  float geo = smoothstep(uPatch.z - .15, uPatch.z - 5., max(q.x, q.y)) * smoothstep(.65, 1.5, abs(up)); // крючья стоят в 55 см от тропы
  const float px = ${(CELL * 0.5).toFixed(4)}; // рельеф мельче клетки сетка не передаст
  float slope = 1. - N.y, m = fbm(mat2(.8, .6, -.6, .8) * p.xz * .013);
  vec3 bk = baked(p);
  vec4 bs = bump(p * vec3(.5, 1.3, 1.6), px * 1.6, 0.);
  float nz = vnoise(p.xz * .23 + p.y * .31);
  float steep = (slope - bk.b) * .75 + (m - .5) * .2 + (bs.x - .5) * .22 + (nz - .5) * .1;
  float rock = max(smoothstep(.045, .1, steep), smoothstep(.70, .76, slope + (nz - .5) * .15));
  float band = smoothstep(10., 3., abs(u) * (.7 + .6 * vnoise(p.xz * .09)) + (fbm(p.xz * .05) - .5) * 9.);
  float zz = p.z + (vnoise(p.xz * .07) - .5) * 12.;
  float rockP = smoothstep(.25, .5, sin(zz * .11 + 4.) * sin(zz * .043 + 1.)) * band;
  rock = max(rock * smoothstep(5., 13., abs(u) + (m - .5) * 6.), rockP);
  float want = .35, hR = 0.;
  if (rock > 0.){
    vec4 br = bump(p * .21, px * .21, 1.);
    vec3 gr = br.yzw * (.21 * 1.6), Nm = normalize(N - (gr - dot(gr, N) * N)), w = triW(N);
    float ledge = smoothstep(.42, .7, Nm.y + (bs.x - .5) * .3);
    float lvl = mix(-.35, 1.15, 1. - rock * (1. - .9 * ledge)) + (bs.x - .5) * .12;
    want = (lvl - .32) * .5;
    // Камень стоит блоками: крупные гребни, поверх гребни с метр, и всё это нарезано уступами (полка, стенка, полка),
    // как слоистая скала. Трещины со снимка добавляют мелочь, чтобы рельеф совпадал с рисунком.
    float h = .6 * br.x + .3 * bump(p * .8, px * .8, 1.).x, st = h * 5.;
    h = mix(h, (floor(st) + smoothstep(.65, 1., fract(st))) / 5., .8);
    // Рельеф есть только там, где камень выходит наружу или почти выходит. Под глубоким снегом он гаснет: иначе уступы проступали
    // сквозь снег широкими ступенями по всему склону, а верёвка ныряла под приподнятый снег.
    hR = rock * (.85 * (h - .32) + .12 * (rockHv(p, w) - .5)) * smoothstep(.22, -.05, want);
  }
  want = mix(want, .35, smoothstep(.03, .12, snow)); // подушка, поднятая общей сеткой, белая целиком
  gl_FragColor = vec4(want, hR, rock, geo);
}`;
// Снег наливается в скалу до ровного уровня, как его наметает ветер: уровень это средняя высота камня вокруг (полметра в обе стороны)
// плюс запас. Где камень ниже уровня, лежит снег с гладким верхом, где выше, камень торчит наружу. Кромка снега выходит
// линией пересечения гладкого уровня с неровным камнем: рваная, с языками в ложбинах, и всегда совпадает с геометрией.
// Раньше размывалась сама кромка, и лоскуты получались круглыми блинами, лежащими поверх плоского камня.
// На выходе r: глубина снега в метрах (с минусом: насколько камень выше уровня), g: подъём вершины над основанием, b: высота камня, a как в сырье.
const LEVEL_FS = /* glsl */ `
uniform sampler2D tIn, tRaw; uniform vec2 uDir; uniform float uLast;
void main(){
  ivec2 t = ivec2(gl_FragCoord.xy); vec3 acc = vec3(0.); float ws = 0.;
  for (int i = -18; i <= 18; i++){ float w = exp(-float(i * i) / 72.); acc += w * texelFetch(tIn, clamp(t + ivec2(uDir) * i, ivec2(0), ivec2(${N1 - 1})), 0).rgb; ws += w; }
  acc /= ws; vec4 raw = texelFetch(tRaw, t, 0);
  if (uLast < .5){ gl_FragColor = vec4(acc, raw.a); return; }
  float sd = acc.g - raw.g + acc.r;
  // Верх снега над основанием. Среди голого камня снег стоит на своём уровне в ложбинах. Где снега много, его верх и есть основание склона:
  // запас глубины не поднимает поверхность, иначе весь заснеженный склон вставал плато, а тропа шла по нему канавой.
  float top = acc.g + acc.r * smoothstep(.22, -.05, acc.r);
  gl_FragColor = vec4(sd, raw.a * (sd > 0. ? max(raw.g, top) : raw.g), raw.g, raw.a);
}`;
const VS_DETAIL = /* glsl */ `
${BASE}
uniform sampler2D tField;
varying vec3 vW, vN, vNd; varying float vS, vSnow;
// на сколько метров вершина поднята над основанием: верх снега, а где его нет, камень
float liftAt(ivec2 t){ return texelFetch(tField, clamp(t, ivec2(0), ivec2(${N1 - 1})), 0).g; }
void main(){
  vec2 xz = uPatch.xy + position.xz; ivec2 t = ivec2(floor((position.xz + uPatch.z) / ${CELL} + .5));
  vec3 P, N, Px, Nx, Pz, Nz; float s, sn, s1, sn1;
  baseAt(xz, P, N, s, sn);
  vec3 Q = P + N * liftAt(t);
  // Насколько подъём повернул поверхность: нормаль по двум соседним точкам до подъёма и после. Где подъёма нет, разница ровно ноль,
  // и свет совпадает с общей сеткой: иначе контур подробной сетки был виден на снегу тонкой линией.
  baseAt(xz + vec2(${CELL}, 0.), Px, Nx, s1, sn1); vec3 Qx = Px + Nx * liftAt(t + ivec2(1, 0));
  baseAt(xz + vec2(0., ${CELL}), Pz, Nz, s1, sn1); vec3 Qz = Pz + Nz * liftAt(t + ivec2(0, 1));
  vNd = normalize(cross(Qz - Q, Qx - Q)) - normalize(cross(Pz - P, Px - P));
  vW = P; vN = N; vS = s; vSnow = sn; // пиксельный шейдер считает снег и камень от основания, как на общей сетке
  gl_Position = projectionMatrix * viewMatrix * vec4(Q, 1.);
}`;

const FS = /* glsl */ `
${COMMON}
varying vec3 vW; varying vec3 vN; varying float vS, vSnow; // vSnow: глубина снежной подушки, поднятой сеткой
uniform vec3 uPatch; // подробная сетка вокруг альпиниста: центр x, z и половина стороны
#ifdef DETAIL
varying vec3 vNd; // на сколько подъём повернул нормаль
uniform sampler2D tField; // поле подробной сетки: глубина снега, подъём над основанием, высота камня
vec4 fieldG(vec2 xz){ return texture2D(tField, ((xz - uPatch.xy + uPatch.z) / ${CELL} + .5) / ${N1}.); }
float liftG(vec2 xz){ return fieldG(xz).g; }
#endif
uniform vec3 uLampPos, uLampDir, uClimber;
uniform vec4 uAva;     // x, z кромки отрыва, ширина, сколько прошёл фронт
uniform vec4 uPlanted; // где на пути стоит последний след каждой конечности: пр. рука, лев. нога, лев. рука, пр. нога
uniform float uLampI, uAvaFade, uPix, uDrift, uSpin, uSpark;
uniform vec2 uWind2;
uniform sampler2D tShadow; uniform mat4 uShadowM; // силуэт альпиниста, снятый со стороны солнца
uniform sampler2D tRock, tSnow; // снимок скалы и карта рельефа снега

${FIELD}
// Глубина следа в точке q (x: метры поперёк маршрута, y: метры пути). Ступени выбиты носком: у верхнего края глубже,
// край ломаный, между ступенями взрытая борозда. Каждая ступень чуть сдвинута, повёрнута и своего размера;
// те же сдвиги считает climber.js, чтобы нога попадала в свою ямку.
float printDepth(vec2 q){
  q.x -= .2 * sin(q.y * .83) + .1 * sin(q.y * 2.1 + 1.); // тропа петляет
  float top = max(uPlanted.y, uPlanted.w);
  float d = .03 * smoothstep(.42, .12, abs(q.x)) * smoothstep(top + .2, top - .3, q.y) * (.6 + .8 * vnoise(q * vec2(9., 3.)));
  for (int i = 0; i < 2; i++){
    float sd = i == 0 ? -1. : 1., foot = i == 0 ? uPlanted.y : uPlanted.w, axe = i == 0 ? uPlanted.z : uPlanted.x;
    for (int j = 0; j < 2; j++){ // ступени через .3 м стоят теснее своей длины: смотрим обе соседние, иначе край ступени обрезается
    float k = min(floor((q.y - foot) / .3) + float(j), 0.), K = floor(foot / .3 + .5) + k;
    vec2 c = vec2(sd * .16 + .09 * sin(K * 2.399 + sd), foot + k * .3 + .05 * sin(K * 1.713 + 2. * sd));
    float a = .55 * sin(K * 4.4 + sd);
    vec2 l = mat2(cos(a), sin(a), -sin(a), cos(a)) * (q - c) / (vec2(.08, .105) * (1. + .2 * sin(K * 3.1))); // ямка чуть шире ботинка: в 22–28 см шириной они читались воронками
    // Ступени разные: одна держит форму, другая осыпалась. Осыпавшаяся шире, мельче, с рваным краем,
    // и из-под неё вниз по склону уходит язык вывалившегося снега.
    float cr = .5 + .5 * sin(K * 5.7 + sd * 2.);
    float e = pow(pow(abs(l.x), 3.) + pow(abs(l.y), 3.), .3333) + (vnoise(q * 16.) - .5) * mix(.1, .28, cr);
    // Ямка чашей: от края плавно вглубь, без плоского дна и отвесных стенок (с ними след выглядел вырезанным формочкой).
    float bowl = max(1. - e * e, 0.), step_ = bowl * sqrt(bowl) * mix(.13, .075, cr) * (.75 + .35 * l.y);
    float tongue = smoothstep(1.1, .3, abs(l.x) * (1. + max(-l.y - 1., 0.) * .8) + (vnoise(q * 23.) - .5) * .5) * smoothstep(-3.4, -1.3, l.y) * smoothstep(-.6, -1.1, l.y) * .022 * cr;
    d = max(d, max(step_, tongue));
    }
    float ka = min(floor((q.y - axe) / .6 + .5), 0.);
    d = max(d, .08 * smoothstep(1., .5, length((q - vec2(sd * .24, axe + ka * .6)) / .04)));
  }
  return d;
}
// Скалу читаем и в точках, сдвинутых вдоль луча взгляда (у снега есть толщина). Там видеокарта сама не подберёт резкость текстуры,
// поэтому задаём её явно: gWx, gWy говорят, как точка склона меняется от пикселя к пикселю.
vec3 gWx, gWy;
vec3 rockT(vec3 p, vec3 w, float tile){ float k = 1. / tile; return textureGrad(tRock, p.zy * k, gWx.zy * k, gWy.zy * k).rgb * w.x + textureGrad(tRock, p.xz * k, gWx.xz * k, gWy.xz * k).rgb * w.y + textureGrad(tRock, p.xy * k, gWx.xy * k, gWy.xy * k).rgb * w.z; }
// Та же скала, но размытая: по ней снег делит место с камнем, иначе они смешиваются попиксельной рябью.
// gF: ширина размытия в метрах, одна на все стороны. Не меньше восьми пикселей, не меньше 8 см у камеры и не меньше следа пикселя
// под скользящим углом. Раньше размытие шло вдоль взгляда сильнее, чем поперёк, и из скалы в снег вылезали тонкие полосы.
float gF;
float rockH(vec3 p, vec3 w, float tile){ float k = 1. / tile; vec2 dx = vec2(gF * k, 0.), dy = dx.yx; return clamp(dot(textureGrad(tRock, p.zy * k, dx, dy).rgb * w.x + textureGrad(tRock, p.xz * k, dx, dy).rgb * w.y + textureGrad(tRock, p.xy * k, dx, dy).rgb * w.z, vec3(1.6)), 0., 1.); }
// Гладкая версия из четырёх соседних точек. Размытая текстура состоит из клеток крупнее пикселя, и у одной выборки наклон в каждой клетке свой:
// рельеф снега по ней шёл гранёными блоками, как в игре с кубиками.
float rockS(vec3 p, vec3 w, float tile, vec3 n){ vec3 t1 = normalize(gWx - n * dot(gWx, n)) * .7 * gF, t2 = cross(n, t1); return .25 * (rockH(p + t1 + t2, w, tile) + rockH(p + t1 - t2, w, tile) + rockH(p - t1 - t2, w, tile) + rockH(p - t1 + t2, w, tile)); }
float snowT(vec3 p, vec3 w, float tile){ float k = 1. / tile; return texture2D(tSnow, p.zy * k, 1.5).r * w.x + texture2D(tSnow, p.xz * k, 1.5).r * w.y + texture2D(tSnow, p.xy * k, 1.5).r * w.z; } // размыта: снег гладкий
float snowT0(vec3 p, vec3 w, float tile){ float k = 1. / tile; return texture2D(tSnow, p.zy * k).r * w.x + texture2D(tSnow, p.xz * k).r * w.y + texture2D(tSnow, p.xy * k).r * w.z; } // резкая: для наледи
// нормаль по карте высот h (в долях от k метров) через производные экрана: лишних выборок не нужно
vec3 bumpN(vec3 n, vec3 p, float h, float k){
  vec3 dx = dFdx(p), dy = dFdy(p), r1 = cross(dy, n), r2 = cross(n, dx); float det = dot(dx, r1);
  // Наклон не круче 20 градусов: скачок высоты между соседними пикселями давал почти лежачую нормаль, и свет на ней шёл точками.
  vec3 g = k * sign(det) * (dFdx(h) * r1 + dFdy(h) * r2); float sl = length(g) / max(abs(det), 1e-9);
  return normalize(abs(det) * n - g * min(1., .35 / max(sl, 1e-4)));
}

void main(){
  float geo = 0.; // доля подробной сетки: 1 внутри неё, к её краю сходит на нет, на общей сетке 0
  #ifdef DETAIL
    geo = smoothstep(uPatch.z - .15, uPatch.z - 5., max(abs(vW.x - uPatch.x), abs(vW.z - uPatch.y)));
  #else
    if (max(abs(vW.x - uPatch.x), abs(vW.z - uPatch.y)) < uPatch.z - .1) discard; // здесь рисует подробная сетка
  #endif
  gWx = dFdx(vW); gWy = dFdy(vW);
  vec3 N = normalize(vN);
  vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam / dist;
  float px = dist * uPix; gF = max(max(8. * px, .08), max(length(gWx), length(gWy)));
  float slope = 1. - N.y;
  float m = fbm(mat2(.8, .6, -.6, .8) * vW.xz * .013); // повёрнут, чтобы пятна не ложились по клеткам сетки
  vec3 bk = baked(vW); float sh = bk.r, ao = bk.g;
  vec3 Hx = normalize(cross(vec3(0., 1., 0.), N)), T = cross(N, Hx); // поперёк склона и вверх по нему

  // Под скользящим углом пиксель накрывает на склоне длинную полосу. Мелкий рельеф гасим по этой длине, а не по ширине:
  // иначе его полосы сжимаются до пикселя и кромка снега на скале рассыпается в шахматные точки.
  float pxg = px / max(dot(N, V), .2);
  vec4 bs = bump(vW * vec3(.5, 1.3, 1.6), pxg * 1.6, 0.); // снег: заструги вытянуты по ветру
  // Скала там, где склон круче общего уклона горы. Мелкий рельеф рвёт границу на всех масштабах, как на настоящих стенах.
  float nz = vnoise(vW.xz * .23 + vW.y * .31);
  float steep = (slope - bk.b) * .75 + (m - .5) * .2 + (bs.x - .5) * .22 + (nz - .5) * .1; // больше мягкого шума: от одного острого скалы шли сеткой ячеек
  float rock = max(smoothstep(.045, .1, steep), smoothstep(.70, .76, slope + (nz - .5) * .15));
  // маршрут идёт через участки натёчного льда и скальные ступени (те же формулы в world.js)
  float u = vW.x - routeX(vW.z), band = smoothstep(10., 3., abs(u) * (.7 + .6 * vnoise(vW.xz * .09)) + (fbm(vW.xz * .05) - .5) * 9.); // края рваные, иначе участок выглядит прямоугольной заплатой
  float zz = vW.z + (vnoise(vW.xz * .07) - .5) * 12.;
  float rockP = smoothstep(.25, .5, sin(zz * .11 + 4.) * sin(zz * .043 + 1.)) * band;
  float iceP = smoothstep(.2, .45, sin(zz * .19 + 1.) * sin(zz * .071 + 2.)) * band * (1. - rockP);
  rock = max(rock * smoothstep(5., 13., abs(u) + (m - .5) * 6.), rockP); // кулуар у маршрута: чистый снег, кроме редких ступеней

  // обвал: линия отрыва, содранное ложе, обломки у фронта
  float scour = 0., crown = 0., debris = 0., blocks = 0.;
  if (uAva.w > 0.){
    float dx = vW.x - uAva.x;
    float dz = vW.z - uAva.y - dx * dx * .012 - (vnoise(vec2(vW.x * .4, 3.1)) - .5) * 2.5;
    float hw = uAva.z * .5 + max(dz, 0.) * .07;
    float inside = smoothstep(hw, hw - 3., abs(dx) + (vnoise(vec2(vW.z * .15, 9.)) - .5) * 6.);
    float back = smoothstep(uAva.w + 1., uAva.w - 6., dz);
    scour = inside * smoothstep(0., .6, dz) * back * uAvaFade;
    crown = inside * smoothstep(-.1, .25, dz) * smoothstep(1.8, .5, dz) * step(1., uAva.w) * uAvaFade;
    debris = inside * back * smoothstep(uAva.w - 28., uAva.w - 3., dz) * smoothstep(0., 1., dz);
    blocks = vnoise(vec2(dx * .7, (dz - uAva.w) * .7));
  }

  // Следы: луч взгляда идёт внутрь ямки, пока не упрётся в её дно, поэтому у ступеней есть настоящая глубина,
  // дальняя стенка закрывает ближнюю, а солнце кладёт внутрь тень.
  float pdep = 0., psh = 1.; vec2 pg = vec2(0.);
  if (abs(u) < .8 && px < .08 && vS < max(uPlanted.y, uPlanted.w) + .5){
    vec3 vt = vec3(dot(V, Hx), dot(V, T), max(dot(V, N), .12));
    // Шаги луча начинаются со случайного сдвига, а точка удара уточняется между двумя последними шагами:
    // без этого дно ямки распадается на слои и выглядит штриховкой.
    vec2 q = vec2(u, vS); float stp = .14 / vt.z / 24., t = stp * .5, d0 = 0., d1 = 0.; // без случайного сдвига: он давал зерно по краю и дну следа
    for (int i = 0; i < 24; i++){ d1 = printDepth(q - vt.xy * t) - t * vt.z; if (d1 <= 0.) break; d0 = d1; t += stp; }
    if (d1 <= 0. && d0 > 0.) t -= stp * -d1 / (d0 - d1);
    q -= vt.xy * t; pdep = printDepth(q);
    vec2 e = vec2(.012, 0.);
    pg = vec2(printDepth(q + e.xy) - printDepth(q - e.xy), printDepth(q + e.yx) - printDepth(q - e.yx)) / .024;
    vec3 lt = vec3(dot(uSunDir, Hx), dot(uSunDir, T), dot(uSunDir, N));
    for (int i = 1; i <= 6; i++){ float tt = float(i) * .035; psh = min(psh, 1. - smoothstep(0., .03, pdep - lt.z * tt - printDepth(q + lt.xy * tt))); }
    float keep = (1. - scour) * smoothstep(.08, .04, px) * (1. - .85 * max(iceP, rockP)); // на льду и камне остаются только царапины
    pdep *= keep; pg *= keep; psh = mix(1., psh, keep);
  }
  // издали следы сливаются в тропу
  float track = smoothstep(.4, .15, abs(u)) * step(vS, max(uPlanted.y, uPlanted.w)) * smoothstep(.04, .1, px) * smoothstep(.5, .2, px) * (1. - scour);

  // Скальная часть считается только там, где есть скала: в чистом снегу это девять выборок текстуры и шум впустую.
  // Снимок двумя плитками разного размера прячет повтор; его яркость служит высотой: трещины тёмные и глубокие.
  vec3 tw = triW(N), ra = vec3(.3), rb = vec3(.3), Nm = N, Nr = N, pR = vW, wallN = N; float hR = .5, hB = .5, wall = 0., slab = 1., pit = 0.;
  if (rock > 0.){
    vec3 gr = bump(vW * .21, pxg * .21, 1.).yzw * (.21 * 1.6);
    Nm = normalize(N - (gr - dot(gr, N) * N)); hB = rockS(vW, tw, 9., N);
  }
  float hS = snowT(vW, tw, 3.2);
  vec3 gs = bs.yzw * vec3(.5, 1.3, 1.6) * (.1 + .14 * scour);
  vec3 Ns = normalize(N - (gs - dot(gs, N) * N) + Hx * pg.x + T * pg.y);
  // Снег двух видов: в ложбинах и за перегибами намело мягкий и гладкий, на открытых ветру местах он сдут до жёсткой наледи.
  float crust = smoothstep(.5, .72, fbm(mat2(.8, .6, -.6, .8) * vW.xz * .03 + 5.) * .7 + (ao - .65) * .8 + dot(N.xz, -uWind2) * .35);
  if (crust > 0.) Ns = bumpN(Ns, vW, snowT0(vW, tw, 2.2), .16 * crust * smoothstep(.12, .03, px)); // издали гаснет: иначе виден повтор плитки
  // Снег лежит на полках и заполняет трещины снизу вверх: чем его больше, тем меньше скалы торчит наружу.
  float ledge = smoothstep(.42, .7, Nm.y + (bs.x - .5) * .3); // по крупной форме: по нормали с зерном текстуры снег рябил попиксельно
  float lvl = mix(-.35, 1.15, 1. - rock * (1. - .9 * ledge)) + (bs.x - .5) * .12, snowM = max(smoothstep(hB - .09, hB + .09, lvl), smoothstep(.03, .12, vSnow)); // подушка белая целиком, вместе с крутыми боками
  #ifdef DETAIL
    // В подробной сетке снег там, где его глубина по полю больше нуля: белое лежит ровно на налитом снегу, а камень торчит из него.
    // Мелкий рисунок скалы двигает кромку ещё на пару сантиметров глубины: в тёмных трещинах снег держится дольше, на светлых буграх сходит раньше.
    // Кромка чёткая (иначе снег тает в камень, как краска из баллончика). К краю сетки она перетекает в прежнюю кромку по рисунку скалы:
    // смешиваем не два готовых пятна (выходил полупрозрачный снег), а расстояния до кромки.
    float sT = fieldG(vW.xz).r - .08 * (hB - .5) + (bs.x - .5) * .03, wF = max(.008, fwidth(sT) * 1.2);
    float snowG = max(smoothstep(-1., 1., mix((lvl - hB) / .09, sT / wF, geo)), smoothstep(.03, .12, vSnow));
    snowM = snowG;
  #endif
  if (rock > 0.){
    // край лоскута скруглён и ловит свет и тень, а сам он повторяет форму камня под собой
    // Лоскут выпуклый, как подушка: от кромки он поднимается к середине. Так у него есть свет и тень даже в пасмурную погоду.
    Ns = bumpN(normalize(mix(Ns, Nm, .6 * rock * (1. - geo))), vW, smoothstep(0., .4, lvl - hB), .3 * rock * smoothstep(.3, .06, px) * (1. - geo)); // где лоскут поднят сеткой, рисовать его выпуклость не нужно
    // У снега на скале настоящая толщина. Поверхность склона это верх снега, камень лежит ниже на thick метров.
    // Луч взгляда опускается сквозь эту толщину: упёрся в снег по дороге, значит видим стенку пласта, она закрывает камень позади себя;
    // дошёл до дна, значит видим камень, сдвинутый вглубь, и проверяем, не лежит ли на нём тень от пласта со стороны солнца.
    float thick = .55 * rock * smoothstep(.22, .08, px), par = thick * (1. - geo); // вдали пласт тоньше пикселя; par: сколько толщины ещё рисуется сдвигом, а не сеткой
    if (thick > .01 && snowM < .98){
      vec3 Vt = V - N * dot(V, N), vp = Vt / max(dot(V, N), .4) * par; // .4: под скользящим углом луч уходил вбок на метры, и скала у камеры шла зерном
      // Шаги со сдвигом, иначе стенка идёт слоями. Сдвиг упорядоченный, а не случайный: случайный давал рябь, как на плохой плёнке.
      float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))), d0 = 0., m0 = snowM, dh = -1.;
      if (par > .01) for (int i = 0; i < 5; i++){
        float d1 = (float(i) + .25 + .5 * jit) * .2, m1 = smoothstep(-.09, .09, lvl - rockH(vW - vp * d1, tw, 9.)); // сдвиг на полшага: на целом шаге кромка пласта шла заметной штриховкой
        if (1. - m1 <= d1){ float a = 1. - m0 - d0, b = d1 - 1. + m1; dh = mix(d0, d1, a / max(a + b, 1e-4)); break; }
        d0 = d1; m0 = m1; pit += m1 * .16;
      }
      if (dh >= 0.){ wall = dh; snowM = 1.; pit = 0.; wallN = normalize(N * .4 + normalize(Vt + N * 1e-4)); } // стенка смотрит на зрителя
      else {
        pR = vW - vp; hB = rockH(pR, tw, 9.); snowM = max(smoothstep(hB - .09, hB + .09, lvl), smoothstep(.03, .12, vSnow));
        #ifdef DETAIL
          snowM = mix(snowM, snowG, geo);
        #endif
        vec3 lp = (uSunDir - N * dot(uSunDir, N)) / max(dot(uSunDir, N), .25) * thick;
        for (int i = 0; i < 3; i++){ float q = (float(i) + .5) / 3., mq = smoothstep(-.09, .09, lvl - rockH(pR + lp * q, tw, 9.)); slab = min(slab, 1. - smoothstep(0., .2, mq - q)); pit += mq * .13; }
        // Камень в щели между пластами темнее: сколько снега стоит вокруг точки, столько неба он от неё закрывает.
        // Эта тень не зависит от солнца, поэтому толщина снега видна и в пургу.
        vec3 sd = normalize(cross(N, Vt) + N * 1e-4) * thick * 1.3;
        pit += (smoothstep(-.09, .09, lvl - rockH(pR + sd, tw, 9.)) + smoothstep(-.09, .09, lvl - rockH(pR - sd, tw, 9.))) * .2;
      }
    }
    ra = rockT(pR, tw, 7.); rb = rockT(pR, tw, 1.7);
    hR = clamp((dot(ra, vec3(.2)) + dot(rb, vec3(.133))) * 2.6, 0., 1.);
    Nr = bumpN(normalize(mix(Nm, N, geo)), vW, mix(hB, hR, .35 * smoothstep(.03, .008, px)), .09); // мелкое зерно снимка в свет идёт только у самой камеры: дальше оно рябит квадратами; в подробной сетке крупную форму камня даёт сама геометрия
    Ns = normalize(mix(Ns, wallN, min(1., wall * 1.5)));
    slab = mix(slab, 1., geo); pit *= 1. - geo; // нарисованные тень пласта и темнота щели: в подробной сетке их заменяют настоящие, ниже
  }
  float rv = 1. - snowM;
  vec3 Nd = normalize(mix(Ns, Nr, rv));
  #ifdef DETAIL
    Nd = normalize(Nd + vNd); // свет по поднятой поверхности: у лоскута настоящие бока
  #endif

  // снег: свежий белый, на крутом серо-голубой фирн, по стене желобки от сходящего снега, внизу ледник с трещинами
  vec3 snowA = vec3(.86, .89, .93) * (.93 + .1 * bs.x);
  snowA = mix(snowA, vec3(.62, .72, .8), smoothstep(.01, .05, steep) * .18);
  snowA = mix(snowA, vec3(.36, .5, .6), iceP * .8);
  snowA = mix(snowA, vec3(.55, .66, .75), crust * .5);
  float d0 = length(vW.xz); vec2 ray = vW.xz / max(d0, 1.);
  snowA *= 1. - .1 * smoothstep(.55, .85, vnoise(vec2(ray.x * 38. + d0 * .01, ray.y * 38.))) * smoothstep(60., 140., d0) * smoothstep(520., 380., d0);
  float crev = smoothstep(.8, .95, 1. - abs(2. * fbm(vW.xz * .006 + m * 2.) - 1.)) * smoothstep(.22, .1, slope) * smoothstep(420., 300., vW.y);
  snowA = mix(snowA, vec3(.2, .35, .45), crev * .8);
  // скала: цвет со снимка, слои чуть меняют тон
  vec3 rockA = ra * rb * 5.5 * (.8 + .4 * vnoise(vec2(dot(vW, vec3(.22, .95, .2)) * .16 + m * 5., 3.7)));

  vec3 alb = mix(snowA, rockA, rv);
  alb *= mix(vec3(1.), vec3(.86, .92, 1.), smoothstep(0., .08, pdep)) * (1. - .16 * track) * (1. - .2 * smoothstep(.15, .5, snowM) * smoothstep(.85, .5, snowM)); // последнее: тень у кромки снега на камне
  // Стенка пласта синее и темнее к подножию, у верхней кромки светлая полоска; камень в щели и в тени пласта темнее.
  alb = mix(alb, alb * vec3(.5, .58, .72), smoothstep(0., .7, wall)) * (1. + .1 * step(.001, wall) * smoothstep(.25, 0., wall)) * mix(.8, 1., slab) * (1. - .6 * smoothstep(0., .8, pit));
  alb = mix(alb, alb * (.66 + .22 * vnoise(vec2(vW.x * 2.5, vW.z * .2))), scour * (1. - rock));
  alb *= 1. - .62 * crown;
  alb = mix(alb, vec3(.9) * (.55 + .7 * blocks), debris * .8);

  // тень альпиниста: его силуэт со стороны солнца ложится на всё, что за ним
  vec4 sc = uShadowM * vec4(vW, 1.);
  if (abs(sc.x) < 1. && abs(sc.y) < 1.){
    vec2 su = sc.xy * .5 + .5; float e = 1.2 / 512., sm = 0.;
    for (int i = 0; i < 4; i++) sm += texture2D(tShadow, su + e * vec2(i < 2 ? -1. : 1., mod(float(i), 2.) < .5 ? -1. : 1.)).a;
    sh *= 1. - .25 * sm * mix(.35, .95, uSpark) * smoothstep(-.3, .2, dot(uClimber - vW, uSunDir));
  }
  sh *= mix(1., psh, mix(.4, 1., uSpark)) * mix(1., slab, mix(.5, 1., uSpark));
  #ifdef DETAIL
    // Тени по полю высот подробной сетки: луч идёт к солнцу над пластами, и пласт затеняет камень и соседний снег.
    // В ложбинах между пластами темнее при любом свете: соседи закрывают небо.
    float h0 = liftG(vW.xz), lz = max(dot(uSunDir, N), .05), shG = 1., occ = 0.; vec3 Ls = uSunDir - N * dot(uSunDir, N); float ll = max(length(Ls), 1e-3);
    for (int i = 1; i <= 5; i++){ float t = .04 * float(i * i) + .04 * float(i); shG = min(shG, 1. - smoothstep(0., .07, liftG(vW.xz + Ls.xz / ll * t) - h0 - t * lz / ll)); }
    for (int i = 0; i < 4; i++) occ += liftG(vW.xz + (i < 2 ? Hx.xz : T.xz) * (mod(float(i), 2.) < .5 ? .2 : -.2));
    sh *= mix(1., shG, geo * mix(.5, 1., uSpark));
    ao *= 1. - .45 * geo * smoothstep(0., .22, occ * .25 - h0);
  #endif

  // заструги затеняют сами себя: если в сторону солнца рельеф выше, точка в тени
  vec3 Lt = normalize(uSunDir - N * dot(uSunDir, N));
  if (rv < .98) sh *= 1. - .38 * smoothstep(.12, .03, px) * smoothstep(0., .16, snowT(vW + Lt * .35, tw, 3.2) - hS - .01) * (1. - rv) * mix(.4, 1., uSpark);
  float ndl = dot(Nd, uSunDir);
  float dif = mix(max((ndl + .1) / 1.1, 0.), max(ndl, 0.), rv);
  float micro = mix(.85 + .3 * hS, .35 + 1.3 * hR, rv) * (1. - .32 * smoothstep(0., .1, pdep)); // в трещинах, ямках и следах темнее
  // В пургу солнца нет, свет идёт с неба. Чтобы рельеф не сливался в ровное серое, небо светит сильнее сверху и со стороны солнца,
  // а складки и ложбины темнее: uSpark 0 в пургу, 1 в ясную погоду.
  float sky = .5 + .5 * dot(Nd, normalize(vec3(uSunDir.x * .6, 1., uSunDir.z * .6)));
  float amb = mix(pow(sky, 1.7) * 1.3 * mix(1., ao, .6), .5 + .5 * Nd.y, uSpark);
  vec3 light = uSunCol * dif * sh + uAmbCol * amb * ao * micro + uSunCol * .07 * (1. - sh) * ao; // последнее: свет, отражённый соседним снегом
  // налобный фонарь
  vec3 Lv = uLampPos - vW; float ld = length(Lv); Lv /= ld;
  float cone = smoothstep(.62, .97, dot(-Lv, uLampDir));
  light += vec3(1., .86, .66) * uLampI * (cone + .04) / (1. + ld * ld * .09) * max((dot(Nd, Lv) + .35) / 1.35, 0.);
  vec3 col = alb * light;

  vec3 Hh = normalize(uSunDir + V); float ndh = max(dot(Nd, Hh), 0.);
  col += uSunCol * sh * (rv * .2 * pow(ndh, 40.) + (1. - rv) * (.07 + .9 * iceP + .35 * crust) * pow(ndh, mix(24., 90., max(iceP, crust * .6))));
  // искры на снегу вблизи
  vec3 cell = floor(vW * 55.);
  vec3 rn = normalize(Nd + (vec3(hash13(cell), hash13(cell + 7.3), hash13(cell + 13.9)) - .5) * 1.4);
  col += uSunCol * sh * (1. - rv) * pow(max(dot(rn, Hh), 0.), 900.) * 9. * smoothstep(.02, .004, px) * uSpark;

  // позёмка: полосы снега, которые ветер гонит по склону
  vec2 wp = vec2(dot(vW.xz, uWind2), dot(vW.xz, vec2(-uWind2.y, uWind2.x)));
  float sd = smoothstep(.42, .78, fbm(vec2(wp.x * .05 - uDrift * .05, wp.y * .3 + vW.y * .12)));
  col = mix(col, vec3(.86, .9, .95) * (uAmbCol + uSunCol * sh * .6), sd * uSpin * (1. - .5 * rock));

  gl_FragColor = vec4(applyFog(col, vW), 1.);
}`;

export function createTerrain(renderer, G) {
  const xs = axis(-FINE.x, FINE.x, FINE.sx, EXTENT), zs = axis(FINE.z0, FINE.z1, FINE.sz, EXTENT);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), path = new Float32Array(nx * nz);
  for (let j = 0, k = 0; j < nz; j++) for (let i = 0, s = sAt(zs[j]); i < nx; i++, k++) {
    pos[k * 3] = xs[i]; pos[k * 3 + 1] = height(xs[i], zs[j]); pos[k * 3 + 2] = zs[j]; path[k] = s;
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  for (let j = 0, k = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + nx;
    idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('aSnow', new THREE.BufferAttribute(pillows(pos, xs, zs), 1));
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aS', new THREE.BufferAttribute(path, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  // Тени от гор запекаем один раз на видеокарте: солнце в сцене не двигается.
  // Высоты нужны точные: где нельзя сглаживать 32-битную текстуру, берём 16-битную, тени там грубее.
  const f32 = renderer.extensions.has('OES_texture_float_linear');
  const heights = (n, cx, cz, half, fine, slope) => {
    const d = f32 ? new Float32Array(n * n * 2) : new Uint16Array(n * n * 2), put = f32 ? (v) => v : THREE.DataUtils.toHalfFloat;
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k += 2) {
      const x = cx + (((i + 0.5) / n) * 2 - 1) * half, z = cz + (((j + 0.5) / n) * 2 - 1) * half;
      d[k] = put(height(x, z, fine));
      if (slope) d[k + 1] = put(1 - 12 / Math.hypot(base(x + 6, z) - base(x - 6, z), 12, base(x, z + 6) - base(x, z - 6)));
    }
    const t = new THREE.DataTexture(d, n, n, THREE.RGFormat, f32 ? THREE.FloatType : THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const far = heights(768, 0, 0, EXTENT, false, true), near = heights(768, NEAR.x, NEAR.z, NEAR.half, true, false);
  const U = { tH: { value: far }, tHF: { value: far }, uSun: G.uSunDir, uE: { value: EXTENT }, uReg: { value: new THREE.Vector3(0, 0, EXTENT) }, uK: { value: new THREE.Vector4(1.5, 5, 16, 55) } };
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: U, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: BAKE_FS,
  }));
  const bake = () => {
    const rt = new THREE.WebGLRenderTarget(1024, 1024, { depthBuffer: false });
    renderer.setRenderTarget(rt);
    quad.render(renderer);
    return rt.texture;
  };
  G.tBake.value = bake();
  U.tH.value = near; U.uReg.value.set(NEAR.x, NEAR.z, NEAR.half); U.uK.value.set(0.35, 1.2, 4, 14);
  G.tBakeN.value = bake();
  G.uNear.value.set(NEAR.x, NEAR.z, NEAR.half);
  renderer.setRenderTarget(null);
  quad.material.dispose();
  far.dispose(); near.dispose();

  let dirty = true; // поле подробной сетки надо пересчитать
  // Текстуры от GPT. Скала с зеркальным повтором: стыки не видны, даже если картинка не бесшовная. Пока грузятся, ровный серый.
  const tex = (url, srgb) => {
    const grey = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255]), 1, 1), slot = { value: grey };
    grey.needsUpdate = true;
    new THREE.TextureLoader().load(url, (t) => {
      t.wrapS = t.wrapT = srgb ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping; t.anisotropy = 8; // снег без зеркала: отражённые заструги складывались ёлочкой
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      slot.value = t; dirty = true; // поле подробной сетки считалось по серой заглушке
    });
    return slot;
  };
  G.tRock = tex('/tex/rock.jpg', true); G.tSnow = tex('/tex/snow.jpg', false);

  // Вершины общей сетки в подробной полосе уходят в текстуры: по ним подробная сетка строит то же основание.
  const i0 = xs.findIndex((x) => x >= -FINE.x - 1e-6), i1 = xs.findLastIndex((x) => x <= FINE.x + 1e-6), j0 = zs.findIndex((z) => z >= FINE.z0 - 1e-6), j1 = zs.findLastIndex((z) => z <= FINE.z1 + 1e-6);
  const gw = i1 - i0 + 1, gh = j1 - j0 + 1, ga = new Float32Array(gw * gh * 4), gb = new Float32Array(gw * gh * 4), nrm = geo.attributes.normal.array, snow = geo.attributes.aSnow.array;
  for (let j = 0, k = 0; j < gh; j++) for (let i = 0; i < gw; i++, k += 4) {
    const v = (j0 + j) * nx + i0 + i;
    ga[k] = pos[v * 3 + 1]; ga[k + 1] = snow[v]; ga[k + 2] = path[v];
    gb[k] = nrm[v * 3]; gb[k + 1] = nrm[v * 3 + 1]; gb[k + 2] = nrm[v * 3 + 2];
  }
  const grid = (d) => { const t = new THREE.DataTexture(d, gw, gh, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; }; // без сглаживания: читаем точками
  G.tGridA = { value: grid(ga) }; G.tGridB = { value: grid(gb) };
  G.uGrid = { value: new THREE.Vector4(xs[i0], zs[j0], 1 / FINE.sx, 1 / FINE.sz) };
  G.uPatch = { value: new THREE.Vector3(0, 0, 0) }; // половина 0: подробной сетки нет, общая рисуется целиком

  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: G, vertexShader: VS, fragmentShader: FS }));
  mesh.frustumCulled = false;
  const n = Math.round((2 * HALF) / CELL), dp = new Float32Array((n + 1) * (n + 1) * 3), di = new Uint32Array(n * n * 6);
  for (let j = 0, k = 0; j <= n; j++) for (let i = 0; i <= n; i++, k += 3) { dp[k] = i * CELL - HALF; dp[k + 2] = j * CELL - HALF; }
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + n + 1; di[k++] = a; di[k++] = b; di[k++] = a + 1; di[k++] = a + 1; di[k++] = b; di[k++] = b + 1; }
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  dgeo.setIndex(new THREE.BufferAttribute(di, 1));
  // На стыке с общей сеткой обе поверхности лежат в одной плоскости и красятся одинаково, так что какая из них победит, не видно.
  // Притягивать подробную сетку к камере нельзя: она закрывала верёвку, лежащую на снегу.
  const detail = new THREE.Mesh(dgeo, new THREE.ShaderMaterial({ uniforms: G, vertexShader: VS_DETAIL, fragmentShader: FS, defines: { DETAIL: '' } }));
  detail.frustumCulled = false;
  const group = new THREE.Group().add(mesh, detail);
  // Поле считается в текстуру, потом в две проходки наливается снег; подробная сетка и её пиксели читают готовое.
  const target = () => new THREE.WebGLRenderTarget(N1, N1, { type: THREE.HalfFloatType, depthBuffer: false });
  const raw = target(), tmp = target(), field = target(), BU = { tIn: { value: null }, tRaw: { value: raw.texture }, uDir: { value: new THREE.Vector2() }, uLast: { value: 0 } };
  const flat = 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }';
  const fieldQ = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: G, vertexShader: flat, fragmentShader: FIELD_FS }));
  const blurQ = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: BU, vertexShader: flat, fragmentShader: LEVEL_FS }));
  G.tField = { value: field.texture };
  let at = '';
  // Каждый кадр: подробная сетка встаёт вокруг точки (x, z), сдвигаясь на целые клетки. За пределами подробной полосы её нет.
  group.userData.follow = (x, z) => {
    const cx = Math.round(x / CELL) * CELL, cz = Math.round(z / CELL) * CELL;
    const inside = cx - HALF > xs[i0] + 1 && cx + HALF < xs[i1] - 1 && cz - HALF > zs[j0] + 1 && cz + HALF < zs[j1] - 1;
    detail.visible = inside; G.uPatch.value.set(cx, cz, inside ? HALF : 0);
    if (!inside || (!dirty && at === cx + ',' + cz)) return;
    dirty = false; at = cx + ',' + cz;
    const pass = (quad, to) => { renderer.setRenderTarget(to); quad.render(renderer); };
    pass(fieldQ, raw);
    BU.tIn.value = raw.texture; BU.uDir.value.set(1, 0); BU.uLast.value = 0; pass(blurQ, tmp);
    BU.tIn.value = tmp.texture; BU.uDir.value.set(0, 1); BU.uLast.value = 1; pass(blurQ, field);
    renderer.setRenderTarget(null);
  };
  return group;
}
