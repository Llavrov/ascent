import * as THREE from 'three';
import { height, routeX, EXTENT, TOP_Z } from './world.js';
import { createTerrain } from './terrain.js';
import { createSky } from './sky.js';
import { createFlakes, createPuffs, createDebris, createSparks } from './snow.js';
import { createClimber } from './climber.js';
import { createPost } from './post.js';
import { createAudio } from './audio.js';

// Заставка висит, пока не загрузятся все модели и текстуры; полоска показывает, сколько файлов уже пришло.
const loader = document.getElementById('loader'), bar = loader.querySelector('b');
THREE.DefaultLoadingManager.onProgress = (_, done, total) => { bar.style.width = (100 * done) / total + '%'; };
THREE.DefaultLoadingManager.onLoad = () => { loader.classList.add('done'); loader.addEventListener('transitionend', (e) => e.target === loader && loader.remove()); };

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const camera = new THREE.PerspectiveCamera(36, 1, 0.2, 20000);
const scene = new THREE.Scene();
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const u = (value) => ({ value });
const Y = V(0, 1, 0), WIND = V(1, 0.06, 0.22).normalize();

// Общие параметры всех шейдеров сцены.
const G = {
  uSunDir: u(V(-0.9, 0.33, 0.25).normalize()), uSunCol: u(new THREE.Color()), uAmbCol: u(new THREE.Color()),
  uFogCol: u(new THREE.Color()), uFogSun: u(new THREE.Color()), uSkyZen: u(new THREE.Color()),
  uFogDen: u(0), uSeaDen: u(0), uSeaY: u(150), uSeaH: u(70), uTime: u(0), uExtent: u(EXTENT), tBake: u(null), tBakeN: u(null), uNear: u(V()),
  uLampPos: u(V()), uLampDir: u(V(0, 0, -1)), uLampI: u(1), uDust: u(0.8), uSpark: u(0),
  uClimber: u(V()), uPlanted: u(new THREE.Vector4()), uSlide: u(0), tShadow: u(null), uShadowM: u(new THREE.Matrix4()), uAva: u(new THREE.Vector4(0, 0, 0, -1)), uAvaFade: u(0),
  uPix: u(0.001), uDrift: u(0), uSpin: u(0), uWind2: u(new THREE.Vector2(WIND.x, WIND.z).normalize()),
  uWindOff: u(V()), uWindVel: u(V()), uCamVel: u(V()), uShutter: u(1 / 90), uFlakeA: u(1), uTan: u(0.3), uRes: u(new THREE.Vector2(1, 1)),
  uSunView: u(V()), uStorm: u(1), uCover: u(0.5), uCloudOff: u(new THREE.Vector2()),
  tMirror: u(null), uMirrorM: u(new THREE.Matrix4()), uMirror: u(0), // отражение в очках: снимок сцены от лица, чем он снят и включён ли
};
// Отражение в очках. В ракурсах на лицо сцену снимает вторая камера: она стоит у лица и смотрит туда, куда уходит отражённый луч.
// Линза очков в шейдере тела показывает этот снимок. В остальных ракурсах очки слишком малы, и снимок не делается.
const mirror = new THREE.WebGLRenderTarget(512, 256, { type: THREE.HalfFloatType }), mirrorCam = new THREE.PerspectiveCamera(100, 2, 0.15, 6000);
const blank = new THREE.DataTexture(new Uint8Array([120, 130, 140, 255]), 1, 1); blank.needsUpdate = true;
G.tMirror.value = blank;

const post = createPost(renderer);
const climber = createClimber(G);
const audio = createAudio(), puffs = createPuffs(G), debris = createDebris(G, puffs, audio.knock), sparks = createSparks(G);
const terrain = createTerrain(renderer, G);
scene.add(createSky(G), terrain, climber.group, debris.mesh, puffs.mesh, sparks.mesh, createFlakes(G, Math.min(innerWidth, innerHeight) < 600 ? 22000 : 40000));

// Тень альпиниста: его силуэт снимается со стороны солнца, склон проецирует его на себя.
const shadowRT = new THREE.WebGLRenderTarget(512, 512), shadowCam = new THREE.OrthographicCamera(-2.6, 2.6, 2.6, -2.6, 0.1, 40);
G.tShadow.value = shadowRT.texture;
function renderShadow() {
  shadowCam.position.copy(climber.hips).addScaledVector(G.uSunDir.value, 20);
  shadowCam.lookAt(climber.hips);
  shadowCam.updateMatrixWorld();
  G.uShadowM.value.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
  climber.glow.visible = false; // свечение фонаря тени не даёт
  renderer.setRenderTarget(shadowRT);
  renderer.setClearAlpha(0);
  renderer.render(climber.group, shadowCam);
  renderer.setClearAlpha(1);
  climber.glow.visible = true;
}

// ---------- погода ----------
// Пурга тёмная, как сумерки, чтобы фонарь и скалы читались; ясная погода яркая и контрастная.
const STORM = { sun: [0.22, 0.235, 0.26], amb: [0.11, 0.125, 0.15], fog: [0.12, 0.135, 0.155], fogSun: [0.25, 0.265, 0.29], zen: [0.1, 0.11, 0.13], tint: [0.93, 0.99, 1.08],
  den: 0.007, sea: 0, wind: 17, flake: 0.6, spin: 0.75, exp: 1.25, desat: 0.85, cover: 0.25, lamp: 2.6, dust: 0.35, rays: 0.6, bloom: 0.9, spark: 0 };
const CLEAR = { sun: [2.4, 1.9, 1.35], amb: [0.14, 0.2, 0.32], fog: [0.42, 0.5, 0.62], fogSun: [1.0, 0.86, 0.68], zen: [0.07, 0.15, 0.34], tint: [1.02, 1, 0.97],
  den: 0.00028, sea: 0.004, wind: 8, flake: 0.012, spin: 0.22, exp: 0.7, desat: 0.35, cover: 0.66, lamp: 0.5, dust: 0.15, rays: 0.45, bloom: 2.0, spark: 1 };
const weather = { mode: 'auto', c: 0 }; // c: 0 пурга, 1 ясно
const W = {}; // текущая смесь
function mixWeather(dt, t) {
  const target = weather.mode === 'auto' ? ((t + 8) % 50 < 24 ? 0 : 1) : weather.mode === 'clear' ? 1 : 0;
  weather.c += (target - weather.c) * (1 - Math.exp(-dt * 0.35));
  const c = weather.c;
  for (const k in STORM) {
    const a = STORM[k], b = CLEAR[k];
    W[k] = Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * c) : k === 'den' ? a ** (1 - c) * b ** c : a + (b - a) * c;
  }
}

// ---------- обвал ----------
const ava = { on: false, t: 0, x: 0, z: 0, w: 0, front: 0, v: 0, next: 22, kind: 1, acc: 0, n: 0 };
function avalanche() {
  ava.kind ^= 1; // по очереди: сверху и под ногами
  Object.assign(ava, { on: true, t: 0, front: 0, acc: 0 });
  if (ava.kind === 0) {
    ava.z = climber.st.z - 38 - Math.random() * 22;
    ava.x = routeX(ava.z) + (Math.random() < 0.5 ? -1 : 1) * (11 + Math.random() * 5);
    ava.w = 18; climber.brace(7); audio.say('brace', 0);
  } else {
    ava.z = climber.st.z + 1.4;
    ava.x = routeX(ava.z) + (Math.random() - 0.5) * 4;
    ava.w = 26; climber.fall(); climber.brace(6);
  }
  G.uAvaFade.value = 1;
  audio.avalanche();
  if (ava.n++ % 2 === 1) { // каждый второй обвал срывает сверху камни или куски льда, они проходят рядом с альпинистом
    const z = climber.st.z - 55 - Math.random() * 25;
    debris.spawn(routeX(z) + (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 10), z, 34, ava.n % 4 === 0);
  }
  if (cam.auto) cut(ava.kind === 0 ? 0 : 1); // срыв смотрим сбоку: видно, как он зарубается и повисает на верёвке
}
function updateAvalanche(dt, t) {
  if (!ava.on) { if (t > ava.next) avalanche(); return; }
  ava.t += dt;
  ava.v = Math.min(8 * ava.t, 38);
  ava.front += ava.v * dt;
  G.uAva.value.set(ava.x, ava.z, ava.w, ava.front);
  // облако рождается у фронта и летит вместе с ним, отставшие клубы оседают хвостом
  if (ava.front < 420) for (ava.acc += dt * 45 * (0.15 + ava.v / 38); ava.acc > 1; ava.acc--) {
    const dx = (Math.random() - 0.5) * (ava.w + ava.front * 0.14);
    puffs.spawn({ x: ava.x + dx, y: 1 + Math.random() * 2, z: ava.z + ava.front - Math.random() * 6, vx: dx * 0.15, vy: 2 + Math.random() * 3.5,
      vz: ava.v * (0.8 + 0.3 * Math.random()), size: 2.5 + Math.random() * 2.5, grow: 3.5 + Math.random() * 3, life: 3.5 + Math.random() * 3, alpha: 0.8, ground: true });
  }
  if (ava.t > 14) G.uAvaFade.value = Math.max(0, 1 - (ava.t - 14) / 30);
  if (ava.t > 44) { ava.on = false; G.uAva.value.w = -1; ava.next = t + 16 + Math.random() * 16; }
}

// ---------- камера ----------
const F = { pos: V(), n: V(0, 0.6, 0.8), fwd: V(0, 0.8, -0.6), right: V(1, 0, 0) }; // сглаженная опора на альпиниста
const at = (out, f, n, r) => out.copy(F.pos).addScaledVector(F.fwd, f).addScaledVector(F.n, n).addScaledVector(F.right, r);
const SHOTS = [
  { name: 'Следом', fov: 36, dur: 11, f: (k, p, t) => { at(p, -5.5 + k, 2.2, 4.5); at(t, 2.5, 0.8, -0.5); } },
  { name: 'Сбоку', fov: 30, dur: 12, f: (k, p, t) => { at(p, -0.5, 1.6, 12 - k * 1.5); at(t, 0.6, 0.5, 0); } },
  { name: 'Сверху', fov: 46, dur: 10, f: (k, p, t) => { const w = Math.min(1, camera.aspect * 0.85); at(p, 7 - k, 5, -2.5 * w); at(t, -14, -1, w); } }, // w: в вертикали кадр уже, при том же сдвиге вбок альпинист уезжал за левый край
  { name: 'Издали', fov: 40, dur: 13, far: true, f: (k, p, t) => { p.copy(F.pos).add(_v.set(210 - 30 * k, -40, 520)); t.copy(F.pos).add(_v.set(0, 150, 0)); } },
  { name: 'Дрон', fov: 13, dur: 12, far: true, f: (k, p, t) => { const d = camera.aspect < 1 ? 0.6 : 1; p.copy(F.pos).add(_v.set(150 - 20 * k, 60, 260).multiplyScalar(d)); t.copy(F.pos).add(_v.set(0, 18 * d, 0)); } }, // d: в вертикали ближе, иначе он точка в тридцать пикселей
  // Наезд от общего плана к лицу. Он лезет лицом к склону, поэтому под конец камера идёт у самого снега со стороны склона (low: её нижний предел над снегом).
  // Очки крупно: он поднимает голову к вершине, камера у самого снега выше по склону смотрит на него сверху. В линзе склон над ним, за спиной долина.
  { name: 'Очки', fov: 15, dur: 9, low: 0.12, f: (k, p, t) => { t.copy(climber.skull).addScaledVector(climber.look, 0.08); p.copy(climber.skull).addScaledVector(F.fwd, 1.5 - 0.4 * k).addScaledVector(F.n, -0.16).addScaledVector(F.right, 0.28); } },
  { name: 'В лицо', fov: 34, dur: 9, low: 0.3, f: (k, p, t) => { const e = k * k * (3 - 2 * k); at(p, 6.5 - e * 4.8, 0.9 - e * 0.62, 1.6 - e * 0.5); at(t, 0.2, 0.8, 0).lerp(climber.skull, e); } },
];
const cam = { zoom: 1, shot: 0, t: 0, auto: true, yaw: 0, pitch: 0, drag: false, cutNow: true, pos: V(), tgt: V(), prev: V(), shake: 0 };
const _v = V(), _o = V(), _ax = V();
function cut(i) {
  if (i === undefined) do i = ((i ?? cam.shot) + 1) % SHOTS.length; while (SHOTS[i].far && weather.c < 0.55);
  Object.assign(cam, { shot: i, t: 0, yaw: 0, pitch: 0, cutNow: true });
}
const hand = (x) => Math.sin(x) + 0.5 * Math.sin(x * 2.3 + 1.7);
function updateCamera(dt, t) {
  const e = cam.cutNow ? 1 : 1 - Math.exp(-dt * 2.5);
  F.pos.lerp(climber.hips, e); F.n.lerp(climber.n, e).normalize(); F.fwd.lerp(climber.fwd, e).normalize(); F.right.lerp(climber.right, e).normalize();
  if (!cam.drag) cam.t += dt;
  if (cam.auto && (cam.t > SHOTS[cam.shot].dur || (SHOTS[cam.shot].far && weather.c < 0.4))) cut();
  const S = SHOTS[cam.shot];
  S.f(Math.min(cam.t / S.dur, 1), cam.pos, cam.tgt);
  // перетаскивание крутит камеру вокруг альпиниста
  _o.subVectors(cam.pos, cam.tgt).applyAxisAngle(Y, cam.yaw);
  _o.applyAxisAngle(_ax.crossVectors(_o, Y).normalize(), cam.pitch);
  cam.pos.addVectors(cam.tgt, _o.multiplyScalar(cam.zoom));
  cam.pos.y = Math.max(cam.pos.y, height(cam.pos.x, cam.pos.z) + (S.low ?? 0.8));
  camera.position.copy(cam.pos);
  camera.fov = S.fov * (camera.aspect < 1 ? 1.3 : 1);
  camera.updateProjectionMatrix();
  camera.lookAt(cam.tgt);
  const k = 0.0035 + cam.shake; // рука оператора
  camera.rotateX(k * hand(t * 0.9)); camera.rotateY(k * hand(t * 0.7 + 3)); camera.rotateZ(k * 0.4 * hand(t * 0.5 + 7));
  camera.updateMatrixWorld();
  if (cam.cutNow) G.uCamVel.value.set(0, 0, 0);
  else G.uCamVel.value.lerp(_v.subVectors(cam.pos, cam.prev).divideScalar(dt), 0.3);
  cam.prev.copy(cam.pos);
  cam.cutNow = false;
}

// ---------- кадр ----------
let last = performance.now(), time = 0, fade = 1, drift = 0, plume = 0, strikes = 0, breath = 0;
let held = false; // идёт съёмка ролика (tools/shoot.js): кадры заказывает она, свой цикл стоит
function frame(now, mine) {
  if (held && !mine) return;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now; time += dt;
  mixWeather(dt, time);
  const c = weather.c, gust = Math.min(1.3, Math.max(0, 0.5 + 0.5 * Math.sin(time * 0.37) * Math.sin(time * 0.11 + 1) + 0.25 * Math.sin(time * 1.3)));
  const speed = W.wind * (0.65 + 0.5 * gust);
  G.uTime.value = time;
  G.uSunCol.value.setRGB(...W.sun); G.uAmbCol.value.setRGB(...W.amb); G.uFogCol.value.setRGB(...W.fog); G.uFogSun.value.setRGB(...W.fogSun); G.uSkyZen.value.setRGB(...W.zen);
  G.uFogDen.value = W.den * (1 + (gust - 0.5) * 0.7 * (1 - c)); G.uSeaDen.value = W.sea;
  G.uStorm.value = 1 - c; G.uCover.value = W.cover; G.uCloudOff.value.set(time * 0.012, time * 0.004);
  G.uFlakeA.value = W.flake; G.uSpin.value = W.spin * (0.6 + 0.5 * gust); G.uLampI.value = W.lamp; G.uDust.value = W.dust; G.uSpark.value = W.spark; post.bloom.threshold = W.bloom;
  G.uWindVel.value.copy(WIND).multiplyScalar(speed).y -= 1.1;
  G.uWindOff.value.addScaledVector(G.uWindVel.value, dt);
  G.uDrift.value = drift += speed * dt * 0.4;

  const task0 = climber.st.task, fall0 = climber.st.fall, rest0 = climber.st.rest;
  climber.update(dt, camera);
  // реплики: срыв, рывок верёвки, после срыва, сомнения или усталость на передышке (записываются на странице record.html)
  if (fall0 === 0 && climber.st.fall > 0) { audio.say('fall', 0); audio.fall(); }
  if (fall0 > 0 && fall0 < 1.15 && climber.st.fall >= 1.15) { audio.jerk(); audio.say('jerk', 0); } // верёвка поймала
  if (fall0 > 0 && climber.st.fall === 0) audio.say('after', 0);
  if (rest0 <= 0 && climber.st.rest > 0) audio.say(Math.random() < 0.5 ? 'lost' : 'hard');
  if (rest0 > 0 && climber.st.rest <= 0) audio.say('go', 3); // после длинной передышки собирается и идёт
  if (task0 === 0 && climber.st.task > 0) { strikes = 0; if (cam.auto) cut(1); } // начал ставить страховку: смотрим сбоку
  if (task0 > 0 && task0 < 6.3 && climber.st.task >= 6.3) { audio.clip(); audio.say('good'); } // встегнул верёвку
  const effort = climber.st.fall > 0 || climber.st.brace > 0 ? 2 : climber.st.rest > 0 || climber.st.task > 0 ? 0.3 : 1; // после срыва и под лавиной дышит часто
  const puff = Math.floor(breath) !== Math.floor(breath += dt * (0.4 + 0.25 * effort));
  terrain.userData.follow(climber.hips.x, climber.hips.z); // подробный рельеф ездит за альпинистом
  _v.copy(climber.hips).applyMatrix4(camera.matrixWorldInverse); // альпинист в осях камеры: x вправо, -z вглубь кадра
  audio.frame(dt, 1 - c, gust, effort, breath, _v.length(), (1.2 * _v.x) / Math.max(Math.abs(_v.z), 1));
  if (puff) for (let i = 0; i < 2; i++) { // выдох: облачко пара изо рта
    puffs.spawn({ x: climber.mouth.x, y: climber.mouth.y, z: climber.mouth.z, vx: climber.look.x * 0.5 + WIND.x * 1.2, vy: 0.15 + climber.look.y * 0.4, vz: climber.look.z * 0.5 + WIND.z * 1.2,
      size: 0.04 + 0.03 * i, grow: 0.4, life: 0.9 + 0.4 * i, alpha: 0.3 });
  }
  if (climber.st.strike) { // удар молотком по крюку: искра металла и снежная пыль
    audio.hammer(strikes++); audio.say('effort', 2.5, 0.7);
    puffs.spawn({ x: climber.pk.x, y: climber.pk.y + 0.1, z: climber.pk.z, vx: 0, vy: 0.5, vz: 0.3, size: 0.14, grow: 0.7, life: 0.7, alpha: 0.4 });
    sparks.spawn(_v.copy(climber.pk).addScaledVector(climber.n, 0.1), 4, [7, 4, 1.2], 0.006, 3, 0.2, climber.n);
  }
  if (climber.st.fall > 0 && climber.st.fall < 1.3) puffs.spawn({ x: climber.hips.x + (Math.random() - 0.5) * 0.5, y: 0.15, z: climber.hips.z - 0.7, vx: 0, vy: 1.2, vz: 2.5, size: 0.2, grow: 1.4, life: 0.8, alpha: 0.5, ground: true }); // клювы пашут снег
  if (climber.st.slump) { // след обрушается: по фронту идёт снежная пыль и катятся комья
    const p = climber.st.slump;
    puffs.spawn({ x: p.x, y: 0.1, z: p.z, vx: 0, vy: 0.5, vz: 1, size: 0.14, grow: 0.9, life: 0.5 + Math.random() * 0.4, alpha: 0.4, ground: true });
    if (Math.random() < 0.15) debris.chunk(p, 2.2); // при обрушении комья крупнее, чем из-под ноги
  }
  for (const h of climber.st.hits) { // ледоруб или кошка вошли в склон: в снегу облачко, во льду брызги осколков, о камень искры и пыль
    audio.hit(h.kind, h.hand); if (h.hand && Math.random() < 0.3) audio.say('effort', 2.5, 0.7); // кряхтит не на каждом ударе
    if (h.kind === 0) for (let i = 0; i < 2; i++) debris.chunk(h.p);
    if (h.kind === 1) sparks.spawn(h.p, h.hand ? 10 : 5, [1.5, 2.2, 3], 0.012, 2.5, 0.55, climber.n);
    else if (h.kind === 2) sparks.spawn(h.p, h.hand ? 9 : 3, [7, 3, 0.7], 0.007, 5, 0.3, climber.n);
    if (h.kind !== 1) puffs.spawn({ x: h.p.x, y: h.p.y + 0.05, z: h.p.z, vx: 0, vy: 0.5, vz: 0.4, size: 0.12, grow: 0.7, life: 0.5 + Math.random() * 0.4, alpha: h.kind === 2 ? 0.25 : 0.45 });
  }
  updateAvalanche(dt, time);
  debris.update(dt);
  sparks.update(dt);
  cam.shake = (ava.on && ava.t < 9 ? 0.012 * Math.exp(-Math.abs(ava.z + ava.front - cam.pos.z) / 80) : 0) + (climber.st.strike ? 0.004 : 0) + (climber.st.fall > 1.15 && climber.st.fall < 1.5 ? 0.03 : 0); // рывок верёвки встряхивает кадр
  updateCamera(dt, time);

  // снежные флаги с двух гребней и порывы мимо камеры
  for (plume += dt * 40 * (0.5 + gust); plume > 1; plume--) { // снежный флаг: тянется с вершины и верхних гребней по ветру сплошной лентой, а не шариками
    const r = Math.random() ** 2 * 110, x = (Math.random() < 0.5 ? -0.866 : 0.866) * r, z = 0.5 * r;
    puffs.spawn({ x, y: height(x, z, false) + 1, z, vx: WIND.x * speed * 0.85, vy: 0.5 + Math.random() * 1.5, vz: WIND.z * speed * 0.85,
      size: 2 + Math.random() * 2, grow: 4 + Math.random() * 3, life: 3.5 + Math.random() * 2.5, alpha: 0.12 + 0.1 * gust });
  }
  if (Math.random() < dt * 5 * (1 - c)) {
    puffs.spawn({ x: cam.pos.x - WIND.x * 55 + (Math.random() - 0.5) * 70, y: cam.pos.y + (Math.random() - 0.5) * 28, z: cam.pos.z - WIND.z * 55 + (Math.random() - 0.5) * 70,
      vx: WIND.x * speed * 0.7, vy: 0, vz: WIND.z * speed * 0.7, size: 10 + Math.random() * 14, grow: 2, life: 5.5, alpha: 0.16 * (1 - c) });
  }
  const white = puffs.update(dt, cam.pos);

  // дошёл до вершины: уходим в белое и начинаем подъём заново
  const top = climber.st.z < TOP_Z;
  fade += ((top ? 1 : 0) - fade) * (1 - Math.exp(-dt * 2));
  if (top && fade > 0.97) { climber.restart(); cam.cutNow = true; }

  G.uTan.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  G.uPix.value = (2 * G.uTan.value) / G.uRes.value.y;
  renderShadow();
  G.uSunView.value.copy(G.uSunDir.value).transformDirection(camera.matrixWorldInverse);
  const P = post.U;
  _v.copy(camera.position).addScaledVector(G.uSunDir.value, 1000).project(camera);
  P.uSunUV.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
  const facing = THREE.MathUtils.smoothstep(camera.getWorldDirection(_v).dot(G.uSunDir.value), -0.1, 0.35);
  P.uRayCol.value.setRGB(...W.sun).multiplyScalar(W.rays * facing / Math.max(W.sun[0], 0.5));
  P.uWhiteCol.value.setRGB(...W.fog).multiplyScalar(1.15);
  P.uWhite.value = Math.max(white, fade);
  P.uExposure.value = W.exp; P.uDesat.value = W.desat; P.uTint.value.setRGB(...W.tint); P.uTime.value = time;
  const shot = SHOTS[cam.shot].name, face = shot === 'Очки' || shot === 'В лицо';
  climber.st.gazeUp = shot === 'Очки';
  G.uMirror.value = 0; G.tMirror.value = blank; // пока снимаем отражение, линза его не читает: текстуру нельзя читать и писать разом
  if (shot === 'Очки') climber.glow.visible = false; // на линзе отражение склона, ореол фонаря его засвечивал (renderShadow в следующем кадре включит ореол обратно)
  if (face) {
    _v.subVectors(camera.position, climber.skull).normalize(); // от линзы к зрителю
    _o.copy(climber.look).multiplyScalar(2 * climber.look.dot(_v)).sub(_v); // отражённый луч
    mirrorCam.position.copy(climber.skull).addScaledVector(climber.look, 0.2);
    mirrorCam.lookAt(_v.copy(mirrorCam.position).add(_o)); mirrorCam.updateMatrixWorld();
    G.uMirrorM.value.multiplyMatrices(mirrorCam.projectionMatrix, mirrorCam.matrixWorldInverse);
    renderer.setRenderTarget(mirror); renderer.render(scene, mirrorCam); renderer.setRenderTarget(null);
    G.uMirror.value = 1; G.tMirror.value = mirror.texture;
  }
  post.render(scene, camera);
  if (!held) requestAnimationFrame(frame);
}

function resize() {
  const dpr = Math.min(devicePixelRatio, 1.25); // шейдер склона тяжёлый, лишние пиксели дороги
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
  post.resize(w, h);
  G.uRes.value.set(w, h);
  camera.aspect = innerWidth / innerHeight;
}
addEventListener('resize', resize);
resize();

// ---------- управление ----------
canvas.addEventListener('pointerdown', (e) => { cam.drag = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!cam.drag) return;
  cam.yaw -= e.movementX * 0.005;
  cam.pitch = Math.min(0.7, Math.max(-0.7, cam.pitch + e.movementY * 0.004));
});
// колесо или щипок двумя пальцами приближают и отдаляют камеру
canvas.addEventListener('wheel', (e) => { cam.zoom = Math.min(1.8, Math.max(0.22, cam.zoom * Math.exp(e.deltaY * 0.0012))); e.preventDefault(); }, { passive: false });
const touches = new Map();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => { touches.set(e.pointerId, e); pinch = 0; });
canvas.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, e);
  if (touches.size !== 2) return;
  const [a, b] = [...touches.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  if (pinch) cam.zoom = Math.min(1.8, Math.max(0.22, (cam.zoom * pinch) / d));
  pinch = d;
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, (e) => touches.delete(e.pointerId));
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { cam.drag = false; });

const MODES = [['auto', 'Авто'], ['storm', 'Пурга'], ['clear', 'Солнце']];
const $ = (id) => document.getElementById(id);
$('weather').onclick = () => {
  const i = (MODES.findIndex((m) => m[0] === weather.mode) + 1) % MODES.length;
  weather.mode = MODES[i][0]; $('weather').lastElementChild.textContent = MODES[i][1];
};
$('camera').onclick = () => {
  const i = cam.auto ? 0 : cam.shot + 1; // Авто, затем все ракурсы по кругу
  cam.auto = i >= SHOTS.length;
  cut(cam.auto ? undefined : i);
  $('camera').lastElementChild.textContent = cam.auto ? 'Авто' : SHOTS[i].name;
};
$('avalanche').onclick = avalanche;
$('sound').onclick = () => { $('sound').lastElementChild.textContent = audio.toggle() ? 'Вкл' : 'Выкл'; };

window.ascent = { G, climber, cam, weather, ava, cut, avalanche, post, renderer, scene, camera, SHOTS, F, puffs, debris, sparks, audio, shoot: (dt) => { held = true; frame(last + dt * 1000, true); } }; // для отладки из консоли; shoot: один кадр съёмки ролика
requestAnimationFrame((t) => { last = t; frame(t); });
// Съёмка ролика из командной строки (sh tools/shoot.sh): страница с ?shoot сама снимает себя. Только на dev-сервере, в сборку не попадает.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('shoot')) import(/* @vite-ignore */ `${location.origin}/tools/shoot.js`).then((m) => m.auto());
