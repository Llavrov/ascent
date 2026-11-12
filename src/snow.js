import * as THREE from 'three';
import { height } from './world.js';
import { COMMON } from './glsl.js';
import { litMaterial } from './climber.js';

const quad = (corners) => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(corners), 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
};

// Снежинки лежат слоями по дальности, от 5 метров до полукилометра. У каждого слоя свой ящик в осях камеры,
// вытянутый вдоль взгляда и подогнанный под угол обзора: снег виден на всю глубину кадра при любом объективе.
// Каждая вытянута в штрих по своему движению относительно камеры.
const FLAKE_VS = /* glsl */ `
${COMMON}
attribute vec4 aSeed;
uniform vec3 uWindOff, uWindVel, uCamVel, uLampPos, uLampDir;
uniform float uShutter, uFlakeA, uLampI, uTan;
uniform vec2 uRes;
varying vec2 vC; varying vec4 vCol;
void main(){
  vC = position.xy;
  float layer = floor(aSeed.w * 5.), D = 5. * pow(3.2, layer); // дальняя граница слоя: 5, 16, 51, 164, 524 м
  float sp = .7 + .6 * fract(aSeed.w * 17.31);
  // вихри: снежинка идёт по петле, а не по прямой
  vec3 ph = uTime * (1.1 + 1.4 * fract(aSeed.w * 5.3)) * vec3(1., .8, .7) + aSeed.zxy * 40.;
  float A = 1.1 + .5 * layer;
  vec3 pw = aSeed.xyz * 900. + uWindOff * sp + A * sin(ph);
  vec3 vel = uWindVel * sp + A * (1.1 + 1.4 * fract(aSeed.w * 5.3)) * vec3(1., .8, .7) * cos(ph) - uCamVel;
  vec3 pv = mat3(viewMatrix) * (pw - cameraPosition);
  vec2 box = 2.3 * D * uTan * vec2(uRes.x / uRes.y, 1.);
  pv.xy = mod(pv.xy + .5 * box, box) - .5 * box;
  pv.z = -mod(pv.z, D);
  vec3 p = cameraPosition + pv * mat3(viewMatrix); // обратно в мир, для света
  vec4 c0 = projectionMatrix * vec4(pv, 1.);
  vec4 c1 = projectionMatrix * vec4(pv - mat3(viewMatrix) * vel * uShutter, 1.);
  if (c0.w < .15){ gl_Position = vec4(2., 2., 2., 1.); vCol = vec4(0.); return; }
  vec2 h = uRes * .5;
  vec2 s0 = c0.xy / c0.w * h, s1 = c1.w > .15 ? c1.xy / c1.w * h : s0;
  vec2 d = s1 - s0; float len = length(d); vec2 dir = len > .01 ? d / len : vec2(1., 0.);
  if (len > 46.){ len = 46.; s1 = s0 + dir * len; } // у самой камеры штрих не длиннее 46 пикселей, иначе кадр заливает белыми полосами
  float rp = .0035 * pow(1.9, layer) * (.6 + .8 * fract(aSeed.w * 7.7)) * projectionMatrix[1][1] * h.y / c0.w; // радиус в пикселях
  float r = max(rp, .8);
  vec2 q = mix(s0, s1, position.y) + dir * (position.y * 2. - 1.) * r + vec2(-dir.y, dir.x) * position.x * r;
  gl_Position = vec4(q / h * c0.w, c0.z, c0.w);
  float a = uFlakeA * min(1., rp / .8) * min(1., 4. / (rp * rp)) * (.3 + .7 * 2. * r / (len + 2. * r)); // крупные у самого объектива расплываются
  a *= smoothstep(.3, 1.5, c0.w) * smoothstep(1., .85, c0.w / D) * exp(-c0.w * uFogDen);
  float gA = vnoise((p.xz - uWindOff.xz) * .016), gB = vnoise((p.xz - uWindOff.xz) * .07 + p.y * .05);
  a *= .2 + 2.4 * gA * gA + 1.6 * gA * gB; // плотные заряды снега чередуются с просветами
  vec3 rd = normalize(p - cameraPosition);
  vec3 col = vec3(.9, .93, .97) * (uAmbCol * 1.15 + uSunCol * (.2 + 1.6 * pow(max(dot(rd, uSunDir), 0.), 6.)) * baked(p).r);
  vec3 lv = p - uLampPos; float ld = length(lv);
  col += vec3(1., .86, .66) * uLampI * smoothstep(.8, .97, dot(lv / ld, uLampDir)) / (1. + ld * ld * .09) * 2.5;
  vCol = vec4(col, a);
}`;
const FLAKE_FS = /* glsl */ `
varying vec2 vC; varying vec4 vCol;
void main(){ gl_FragColor = vec4(vCol.rgb, vCol.a * smoothstep(1., .1, abs(vC.x)) * smoothstep(0., .12, vC.y) * smoothstep(1., .88, vC.y)); }`;

export function createFlakes(G, count) {
  const g = quad([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = count;
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: G, vertexShader: FLAKE_VS, fragmentShader: FLAKE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide })); // штрих строится в экране, обход вершин любой
  m.frustumCulled = false;
  m.renderOrder = 3;
  return m;
}

// Клубы: снежные флаги с гребня, порывы мимо камеры и облако обвала. Все считаются на процессоре.
const PUFF_VS = /* glsl */ `
${COMMON}
attribute vec4 aP; attribute vec2 aQ;
varying vec2 vUv, vQ; varying vec3 vWc; varying float vSh, vSize;
void main(){
  vUv = position.xy; vWc = aP.xyz; vQ = aQ; vSh = baked(aP.xyz).r; vSize = aP.w;
  vec4 mv = viewMatrix * vec4(aP.xyz, 1.); mv.xy += position.xy * aP.w;
  gl_Position = projectionMatrix * mv;
}`;
const PUFF_FS = /* glsl */ `
${COMMON}
uniform vec3 uSunView;
varying vec2 vUv, vQ; varying vec3 vWc; varying float vSh, vSize;
void main(){
  float r = length(vUv); if (r > 1.) discard;
  float a = smoothstep(1., .15, r + (fbm(vUv * 1.8 + vQ.y * 37. + uTime * .04) - .5) * .9) * smoothstep(1., .7, r);
  vec3 nv = normalize(vec3(vUv, sqrt(max(1. - r * r, 0.))));
  vec3 rd = normalize(vWc - cameraPosition);
  float lit = .05 + .42 * pow(clamp(dot(nv, uSunView) * .5 + .5, 0., 1.), 1.5) + .5 * pow(max(dot(rd, uSunDir), 0.), 4.);
  vec3 col = vec3(.9, .93, .97) * (.75 + .5 * fract(vQ.y * 7.3)) * (uAmbCol * (.8 + .4 * nv.y) + uSunCol * vSh * lit); // клубы разной яркости, иначе облако сливается в белое пятно
  a *= vQ.x * smoothstep(.25, 1.1, length(vWc - cameraPosition) / vSize); // у самой камеры клуб тает
  gl_FragColor = vec4(applyFog(col, vWc), a);
}`;

export function createPuffs(G, max = 900) {
  const g = quad([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const aQ = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
  aP.setUsage(THREE.DynamicDrawUsage); aQ.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aP', aP); g.setAttribute('aQ', aQ);
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: G, vertexShader: PUFF_VS, fragmentShader: PUFF_FS, transparent: true, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const list = [];
  return {
    mesh,
    // p: x y z vx vy vz size grow life alpha, ground=true держит клуб над склоном на высоте y
    spawn(p) { if (list.length < max) { p.age = 0; p.seed = Math.random(); list.push(p); } },
    // возвращает, насколько камера внутри облака обвала (0..1)
    update(dt, cam) {
      let white = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        if (p.age > p.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.size += p.grow * dt;
        if (p.ground) { const k = Math.exp(-dt * 0.5); p.vx *= k; p.vz *= k; p.vy *= k; }
      }
      for (let i = 0; i < list.length; i++) {
        const p = list[i], u = p.age / p.life;
        const y = p.ground ? height(p.x, p.z, false) + p.y : p.y;
        const a = p.alpha * Math.min(1, u * 8) * (1 - u) ** 1.4;
        aP.setXYZW(i, p.x, y, p.z, p.size); aQ.setXY(i, a, p.seed);
        if (p.ground) white = Math.max(white, a * (1 - Math.hypot(p.x - cam.x, y - cam.y, p.z - cam.z) / (p.size * 0.7)));
      }
      g.instanceCount = list.length;
      aP.needsUpdate = aQ.needsUpdate = true;
      return Math.min(0.8, white * 1.2); // не до полной белизны: пустой экран скучен
    },
  };
}

// Камни и куски льда, которые обвал сносит со скального пояса: летят вниз по склону, отскакивая.
export function createDebris(G, puffs, onBounce, max = 110) {
  const geo = new THREE.IcosahedronGeometry(1, 2), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { // мнём шар в камень; сдвиг зависит только от точки, швы не расходятся
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.72 + 0.4 * Math.sin(x * 5.1 + y * 3.3) * Math.sin(y * 4.7 + z * 2.9) + 0.18 * Math.sin(z * 9.3 + x * 7.7);
    p.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  geo.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(geo, litMaterial(G, [0.13, 0.12, 0.11]), max);
  // Комья снега рисуются отдельно: округлые и со снежным светом. На мятой каменной сетке и с каменным светом они выходили тёмными колючими звёздочками.
  const ball = new THREE.SphereGeometry(1, 10, 8), b = ball.attributes.position;
  for (let i = 0; i < b.count; i++) { const x = b.getX(i), y = b.getY(i), z = b.getZ(i), k = 0.88 + 0.14 * Math.sin(x * 3.1 + y * 2.3) * Math.sin(y * 2.7 + z * 3.3); b.setXYZ(i, x * k, y * k, z * k); }
  ball.computeVertexNormals();
  const lumps = new THREE.InstancedMesh(ball, litMaterial(G, [0.86, 0.9, 0.96], { SNOW: '' }), max);
  const mesh = new THREE.Group().add(rocks, lumps);
  rocks.frustumCulled = lumps.frustumCulled = false; rocks.count = lumps.count = 0;
  const list = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
  return {
    mesh,
    // ice: куски льда вместо камней
    spawn(x, z, n, ice) {
      // сыплются не разом, а россыпью секунды полторы: больше мелочи, изредка крупный обломок
      for (let i = 0; i < n && list.length < max; i++) list.push({
        x: x + (Math.random() - 0.5) * 16, z: z + Math.random() * 8, lift: 0.3, vl: 1 + Math.random() * 4, vx: (Math.random() - 0.5) * 4, vz: 3 + Math.random() * 6,
        size: 0.05 + Math.random() ** 3 * 0.3, age: -Math.random() * 1.6, ang: 0, spin: 6 + Math.random() * 14, sq: [0.7 + Math.random() * 0.6, 0.5 + Math.random() * 0.5, 0.7 + Math.random() * 0.6], axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        col: ice ? [0.5, 0.66, 0.78] : [0.16 + Math.random() * 0.08, 0.14 + Math.random() * 0.06, 0.12 + Math.random() * 0.04],
      });
    },
    // комок снега, выбитый ногой или ледорубом: катится вниз и рассыпается за пару секунд
    chunk(p, k = 1) { // k: во сколько раз крупнее обычного
      if (list.length < max) list.push({ x: p.x + (Math.random() - 0.5) * 0.15, z: p.z + 0.08, lift: 0.04, vl: 0.4 + Math.random(), vx: Math.random() - 0.5, vz: 0.4 + Math.random() * 1.5, snow: true,
        size: (0.015 + Math.random() * 0.03) * k, age: 0, life: 1.5 + Math.random() * 1.5, ang: 0, spin: 12, axis: new THREE.Vector3(1, 0, 0), sq: [1, 0.8, 1] });
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i];
        r.age += dt;
        if (r.age < 0) continue; // ещё не сорвался
        if (r.age > (r.life ?? 14) || r.z > 520) { list[i] = list[list.length - 1]; list.pop(); continue; }
        r.vz = Math.min(r.vz + 9 * dt, 34); r.vl -= 14 * dt;
        r.x += r.vx * dt; r.z += r.vz * dt; r.lift += r.vl * dt; r.ang += r.spin * dt;
        if (r.lift < 0) { // удар о склон: отскок, облачко снега, часть скорости теряется
          if (r.size > 0.06) onBounce();
          r.lift = 0; r.vl = (1.5 + Math.random() * 4) * Math.min(1, r.vz / 12); r.vz *= 0.82; r.vx += (Math.random() - 0.5) * 3;
          if (r.size > 0.06) puffs.spawn({ x: r.x, y: 0.4, z: r.z, vx: 0, vy: 1.5, vz: r.vz * 0.4, size: 0.5 + r.size * 1.5, grow: 2.5, life: 1.2 + Math.random(), alpha: 0.5, ground: true });
        }
      }
      rocks.count = lumps.count = 0;
      for (const r of list) {
        const to = r.snow ? lumps : rocks, i = to.count++, fade = r.snow ? Math.min(1, (r.life - r.age) / 0.4) : 1; // ком под конец рассыпается, а не исчезает разом
        to.setMatrixAt(i, m.compose(v.set(r.x, height(r.x, r.z, false) + r.lift + r.size * 0.5, r.z), q.setFromAxisAngle(r.axis, r.ang), sc.fromArray(r.sq).multiplyScalar(r.age < 0 ? 0 : r.size * fade)));
        if (!r.snow) rocks.setColorAt(i, c.setRGB(...r.col));
      }
      rocks.instanceMatrix.needsUpdate = lumps.instanceMatrix.needsUpdate = true;
      if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    },
  };
}

// Искры и осколки от ударов: льдинки, когда клюв или кошка входят в лёд, искры, когда бьют по камню.
export function createSparks(G, max = 140) {
  const pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3), col = new THREE.BufferAttribute(new Float32Array(max * 4), 4);
  const g = new THREE.BufferGeometry().setAttribute('position', pos).setAttribute('aCol', col);
  const mesh = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: G,
    vertexShader: 'attribute vec4 aCol; varying vec3 vC; uniform vec2 uRes; void main(){ vC = aCol.rgb; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); gl_PointSize = max(aCol.a * projectionMatrix[1][1] * uRes.y * .5 / gl_Position.w, 1.5); }',
    fragmentShader: 'varying vec3 vC; void main(){ gl_FragColor = vec4(vC * smoothstep(1., .2, length(gl_PointCoord - .5) * 2.), 1.); }',
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  const list = [];
  return {
    mesh,
    // n частиц из точки p в сторону dir: цвет, размер в метрах, скорость, время жизни
    spawn(p, n, rgb, size, speed, life, dir) {
      for (let i = 0; i < n && list.length < max; i++) list.push({
        x: p.x, y: p.y, z: p.z, vx: dir.x * speed * 0.6 + (Math.random() - 0.5) * speed, vy: dir.y * speed * 0.6 + (Math.random() - 0.3) * speed, vz: dir.z * speed * 0.6 + (Math.random() - 0.5) * speed,
        rgb, size: size * (0.6 + 0.8 * Math.random()), life: life * (0.6 + 0.8 * Math.random()), age: 0,
      });
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        s.age += dt;
        if (s.age > s.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
        s.vy -= 9.8 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      }
      list.forEach((s, i) => { const f = 1 - s.age / s.life; pos.setXYZ(i, s.x, s.y, s.z); col.setXYZW(i, s.rgb[0] * f, s.rgb[1] * f, s.rgb[2] * f, s.size); });
      g.setDrawRange(0, list.length);
      pos.needsUpdate = col.needsUpdate = true;
    },
  };
}
