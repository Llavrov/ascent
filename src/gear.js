import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Снаряжение альпиниста настоящей геометрией: каска с вентиляцией, рюкзак, обвязка с железом, кошки, рукавицы.
// Размеры в метрах. У каждой вершины свой цвет [r, g, b, блеск]: 0 ткань и резина, 0.5 пластик, 1 металл.
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2, Z = V(0, 0, 1);
const C = {
  shell: [0.8, 0.8, 0.78, 0.45], wall: [0.45, 0.45, 0.44, 0.2], liner: [0.045, 0.047, 0.055, 0], web: [0.03, 0.032, 0.038, 0], strap: [0.07, 0.072, 0.08, 0],
  pack: [0.06, 0.063, 0.074, 0.16], lid: [0.085, 0.09, 0.104, 0.16], panel: [0.11, 0.115, 0.13, 0.14], alu: [0.2, 0.23, 0.28, 0.55], mesh: [0.09, 0.095, 0.105, 0.04], trim: [0.2, 0.205, 0.22, 0.12], cord: [0.32, 0.32, 0.34, 0], steel: [0.5, 0.52, 0.55, 1], dark: [0.03, 0.032, 0.038, 0.12],
  orange: [0.75, 0.24, 0.03, 0.8], shaft: [0.6, 0.15, 0.015, 0.4], mitt: [0.045, 0.047, 0.055, 0.18], back: [0.44, 0.03, 0.014, 0.08], yellow: [0.75, 0.58, 0.04, 0.35], blue: [0.05, 0.2, 0.55, 0.6], lens: [0.42, 0.13, 0.012, 0.55], pad: [0.1, 0.105, 0.12, 0], sling: [0.6, 0.48, 0.08, 0],
};

function paint(g, col) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count, a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set(col, i * 4);
  return g.setAttribute('aCol', new THREE.BufferAttribute(a, 4));
}
const place = (g, p, n) => g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, n)).translate(p.x, p.y, p.z); // ось Z детали вдоль n
const box = (w, h, d, col) => paint(new THREE.BoxGeometry(w, h, d), col);

// Сборщик произвольных граней. out: точка, от которой грань должна смотреть наружу (порядок вершин подбирается сам).
function builder() {
  const P = [], N = [], K = [], e1 = V(), e2 = V(), fn = V();
  const put = (p, n, c) => { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); K.push(c[0], c[1], c[2], c[3]); };
  const b = {
    tri(a, p, q, col, out, ns) {
      fn.crossVectors(e1.subVectors(p, a), e2.subVectors(q, a)).normalize();
      if (out && fn.dot(e1.copy(a).add(p).add(q).divideScalar(3).sub(out)) < 0) { fn.negate(); [p, q] = [q, p]; if (ns) ns = [ns[0], ns[2], ns[1]]; }
      put(a, ns ? ns[0] : fn, col); put(p, ns ? ns[1] : fn, col); put(q, ns ? ns[2] : fn, col);
    },
    quad(a, p, q, r, col, out, ns) { b.tri(a, p, q, col, out, ns && [ns[0], ns[1], ns[2]]); b.tri(a, q, r, col, out, ns && [ns[0], ns[2], ns[3]]); },
    geo() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      return g.setAttribute('aCol', new THREE.Float32BufferAttribute(K, 4));
    },
  };
  return b;
}
const rect = (w, t) => [[-w / 2, -t / 2], [w / 2, -t / 2], [w / 2, t / 2], [-w / 2, t / 2]];
const round = (r, n = 6, rv = r) => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * TAU), rv * Math.sin((i / n) * TAU)]);
const spline = (pts, n, closed = false) => new THREE.CatmullRomCurve3(pts, closed, 'centripetal').getSpacedPoints(n).slice(0, closed ? n : n + 1);
// Лента или шнур вдоль пути. nrm(p, i): куда у ленты наружу; prof: сечение, точки [поперёк, наружу]; k(доля пути): толщина
function sweep(b, pts, nrm, prof, col, { closed = false, smooth = false, k = () => 1 } = {}) {
  const n = pts.length, m = prof.length, T = V(), Nn = V(), Bn = V();
  const rings = pts.map((p, i) => {
    T.subVectors(pts[closed ? (i + 1) % n : Math.min(i + 1, n - 1)], pts[closed ? (i + n - 1) % n : Math.max(i - 1, 0)]).normalize();
    Nn.copy(nrm(p, i)); Nn.addScaledVector(T, -Nn.dot(T)).normalize();
    Bn.crossVectors(T, Nn);
    const s = k(i / (n - 1));
    return prof.map(([u, v]) => p.clone().addScaledVector(Bn, u * s).addScaledVector(Nn, v * s));
  });
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const i1 = (i + 1) % n, r0 = rings[i], r1 = rings[i1], c0 = pts[i], c1 = pts[i1], mid = c0.clone().add(c1).multiplyScalar(0.5);
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m, q = [r0[j], r0[j1], r1[j1], r1[j]];
      b.quad(...q, col, mid, smooth ? q.map((p, e) => p.clone().sub(e < 2 ? c0 : c1).normalize()) : undefined);
    }
  }
  if (!closed) for (const [r, c, o] of [[rings[0], pts[0], pts[1]], [rings[n - 1], pts[n - 1], pts[n - 2]]]) for (let j = 0; j < m; j++) b.tri(c, r[j], r[(j + 1) % m], col, o); // торцы
}

// Выпуклая оболочка точек [u, v] против часовой стрелки.
export function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), half = (list) => {
    const h = [];
    for (const q of list) { while (h.length > 1 && cr(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); }
    return h.slice(0, -1);
  };
  return half(p).concat(half(p.reverse()));
}
// самый длинный подряд идущий кусок замкнутого контура, где keep истинно
function arc(r, keep) {
  const n = r.length, s = r.findIndex((p) => !keep(p));
  if (s < 0) return r;
  let best = [], run = [];
  for (let i = 1; i <= n; i++) { const p = r[(s + i) % n]; if (keep(p)) { run.push(p); if (run.length > best.length) best = run; } else run = []; }
  return best;
}

// Каска в координатах головы: начало в центре черепа, лицо в +Z. Скорлупа с настоящими прорезями вентиляции,
// под ней тёмный пенопласт, налобный фонарь на резинке, очки, поднятые на каску, ремешки под подбородок.
export function helmet() {
  const b = builder(), A = 0.103, B = 0.122, Cz = 0.136, Y0 = -0.002, Z0 = -0.004, NP = 72, NT = 16, D = 0.014, R = 0.02, O = V(0, Y0, Z0);
  const edgeY = (ph) => 0.005 + 0.033 * Math.cos(ph); // край: спереди над бровями, сзади ниже, на затылок
  const at = (i, j, d = 0) => {
    const ph = (i / NP) * TAU, th = Math.acos((edgeY(ph) - Y0) / B) * (j / NT), s = Math.sin(th);
    return V((A - d) * s * Math.sin(ph), Y0 + (B - d) * Math.cos(th), (Cz - d) * s * Math.cos(ph) + Z0);
  };
  const nor = (p) => V(p.x / (A * A), (p.y - Y0) / (B * B), (p.z - Z0) / (Cz * Cz)).normalize();
  const SLOTS = [[25, 7, 13], [335, 7, 13], [65, 9, 13], [295, 9, 13], [155, 7, 14], [205, 7, 14], [115, 9, 14], [245, 9, 14]]; // прорези шириной в три клетки: азимут в градусах, ряды от и до
  const hole = (i, j) => SLOTS.some(([deg, j0, j1]) => { const c = Math.round(deg / 5), k = ((i % NP) + NP) % NP; return Math.abs(k - c) < 2 && j >= j0 && j < j1; });
  const inward = (q) => O.clone().add(q[0].clone().add(q[2]).multiplyScalar(0.5).sub(O).multiplyScalar(2)); // точка снаружи: грань повернётся к голове
  for (let i = 0; i < NP; i++) {
    for (let j = 0; j < NT; j++) {
      const q = [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)];
      if (!hole(i, j)) { b.quad(...q, C.shell, O, q.map(nor)); continue; }
      const f = [at(i, j, D), at(i, j + 1, D), at(i + 1, j + 1, D), at(i + 1, j, D)], mid = q[0].clone().add(q[2]).multiplyScalar(0.5);
      b.quad(...f, C.liner, O, f.map(nor)); // дно прорези
      [[0, 1, i - 1, j], [1, 2, i, j + 1], [2, 3, i + 1, j], [3, 0, i, j - 1]].forEach(([a, c, ni, nj]) => { // стенки там, где сосед не прорезь
        if (hole(ni, nj)) return;
        const wm = q[a].clone().add(q[c]).multiplyScalar(0.5);
        b.quad(q[a], q[c], f[c], f[a], C.wall, wm.clone().multiplyScalar(2).sub(mid));
      });
    }
    b.quad(at(i, NT), at(i + 1, NT), at(i + 1, NT, R), at(i, NT, R), C.shell, V(0, 0.4, Z0)); // торец скорлупы смотрит вниз
    for (let j = NT - 5; j < NT; j++) { const q = [at(i, j, R), at(i, j + 1, R), at(i + 1, j + 1, R), at(i + 1, j, R)]; b.quad(...q, C.liner, inward(q)); } // изнанка у края
  }
  const onShell = (ph, y, lift) => { const s = Math.sin(Math.acos(Math.min(1, (y - Y0) / B))), p = V(A * s * Math.sin(ph), y, Cz * s * Math.cos(ph) + Z0); return p.addScaledVector(nor(p), lift); };
  const loop = (yf, n = 48) => Array.from({ length: n }, (_, i) => onShell((i / n) * TAU, yf((i / n) * TAU), 0.0025));
  sweep(b, loop((ph) => edgeY(ph) + 0.014), nor, rect(0.02, 0.003), C.web, { closed: true }); // резинка фонаря
  sweep(b, loop((ph) => 0.052 + 0.03 * Math.cos(ph)), nor, rect(0.028, 0.003), C.strap, { closed: true }); // ремень очков
  // ремешки: от виска и от затылка сходятся под ухом и уходят под подбородок
  const out = (p) => V(p.x, Math.min(0, p.y + 0.1) * 3, p.z * 0.3);
  for (const s of [1, -1]) {
    const J = V(s * 0.093, -0.072, 0.012);
    for (const deg of [66, 124]) sweep(b, spline([onShell((s * deg * Math.PI) / 180, edgeY((deg * Math.PI) / 180) + 0.004, -0.004), J], 8), out, rect(0.014, 0.0025), C.web);
    sweep(b, spline([J, V(s * 0.07, -0.115, 0.04), V(s * 0.04, -0.152, 0.058), V(0, -0.16, 0.062)], 12), out, rect(0.014, 0.0025), C.web);
  }
  const lp = onShell(0, edgeY(0) + 0.014, 0.011), ln = nor(lp), gp = onShell(0, 0.084, 0.014), gn = nor(gp);
  const bend = (g) => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) P.setZ(i, P.getZ(i) - 4 * P.getX(i) ** 2); return g; }; // очки изогнуты по каске
  const g = mergeGeometries([
    b.geo(),
    place(paint(new RoundedBoxGeometry(0.046, 0.032, 0.022, 2, 0.006), C.dark), lp, ln), // корпус фонаря
    place(paint(new THREE.CylinderGeometry(0.0135, 0.0135, 0.008, 14).rotateX(Math.PI / 2), C.yellow), lp.clone().addScaledVector(ln, 0.011), ln),
    place(paint(bend(new THREE.SphereGeometry(0.05, 18, 10).scale(1.5, 0.6, 0.42)), C.dark), gp, gn), // оправа очков
    place(paint(bend(new THREE.SphereGeometry(0.05, 18, 10).scale(1.36, 0.46, 0.42).translate(0, 0, 0.006)), C.lens), gp, gn),
    box(0.02, 0.016, 0.01, C.dark).translate(-0.07, -0.115, 0.04), // пряжка под подбородком
    ...[40, 140, 220, 320].map((deg) => { const ph = (deg * Math.PI) / 180, p = onShell(ph, edgeY(ph) + 0.014, 0.005); return place(box(0.012, 0.026, 0.006, C.shell), p, nor(p)); }), // клипсы резинки
  ]);
  g.userData.lamp = lp.clone().addScaledVector(ln, 0.017).toArray(); // где светит линза
  return g;
}

// Рюкзак в координатах исходной позы тела; zBack: где кончается спина в пуховике.
function pack(zBack) {
  const z0 = zBack - 0.01, yc = 1.235, taper = (g) => { // книзу уже, сзади слегка раздут
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { const t = P.getY(i) / 0.44 + 0.5, z = P.getZ(i); P.setX(i, P.getX(i) * (0.86 + 0.14 * t)); if (z < 0) P.setZ(i, z * (0.9 + 0.25 * Math.sin(Math.PI * t))); }
    return g;
  };
  const side = (y) => 0.127 + 0.043 * (y - 1.235), zs = z0 - 0.188; // полуширина рюкзака на высоте y; zs: поверх кармана
  const scoop = (g) => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) P.setZ(i, P.getZ(i) + 2.4 * P.getX(i) ** 2); return g; }; // ковш лопаты выгнут
  const cyl = (r, h, col, n = 10) => paint(new THREE.CylinderGeometry(r, r, h, n), col);
  // Клапан со всем, что на нём: кант по нижней кромке, молния с язычком, нашивка. Собран в своих осях и повёрнут целиком.
  const lb = builder(), rim = spline([[1, 1], [0, 1.03], [-1, 1], [-1.03, 0], [-1, -1], [0, -1.03], [1, -1], [1.03, 0]].map(([x, z]) => V(x * 0.118, -0.05, z * 0.083)), 40, true);
  sweep(lb, rim, (p) => V(p.x, 0, p.z), round(0.0045, 5), C.trim, { closed: true, smooth: true });
  const lid = [
    paint(new RoundedBoxGeometry(0.26, 0.11, 0.19, 3, 0.045), C.lid), lb.geo(),
    box(0.19, 0.006, 0.004, C.trim).translate(0, 0.012, -0.096), box(0.01, 0.02, 0.005, C.steel).translate(0.085, 0.006, -0.098), box(0.006, 0.03, 0.004, C.orange).translate(0.085, -0.016, -0.099), // молния и язычок
    box(0.042, 0.02, 0.003, C.orange).translate(-0.07, -0.018, -0.096), // нашивка
  ].map((g) => g.rotateX(-0.12).translate(0, yc + 0.235, z0 - 0.085));
  // Рюкзак прижат к спине и наклонён к плечам: спина у шеи уходит вперёд, прямой короб от неё отставал.
  return [
    paint(taper(new RoundedBoxGeometry(0.27, 0.44, 0.15, 4, 0.045)), C.pack).translate(0, yc, z0 - 0.075),
    ...lid,
    paint(new RoundedBoxGeometry(0.19, 0.26, 0.04, 2, 0.015), C.panel).translate(0, 1.2, z0 - 0.162), // карман
    // лавинная лопата под стяжками на кармане: ковш, ребро жёсткости, гнездо под черенок
    paint(scoop(new THREE.BoxGeometry(0.16, 0.19, 0.004, 8, 1, 1)), C.alu).translate(0, 1.2, zs),
    ...[-0.05, 0, 0.05].map((x) => box(0.012, 0.15, 0.006, C.alu).translate(x, 1.2, zs - 0.003 + 2.4 * x * x)), cyl(0.014, 0.05, C.alu, 8).translate(0, 1.318, zs - 0.004), // рёбра жёсткости и гнездо под черенок
    ...[1.145, 1.265].flatMap((y) => [box(0.2, 0.02, 0.003, C.web).translate(0, y, zs - 0.012), box(0.03, 0.026, 0.008, C.dark).translate(0.055, y, zs - 0.015), box(0.014, 0.05, 0.003, C.web).rotateZ(0.5).translate(0.085, y - 0.022, zs - 0.012)]), // стяжки с пряжками и свободными хвостами
    ...[1, -1].flatMap((s) => [
      ...[1.13, 1.33].flatMap((y) => [box(0.004, 0.018, 0.07, C.web).translate(s * side(y), y, z0 - 0.075), box(0.008, 0.024, 0.03, C.dark).translate(s * (side(y) + 0.002), y, z0 - 0.085)]), // боковые стяжки
      box(0.018, 0.13, 0.004, C.web).rotateX(-0.25).translate(s * 0.065, yc + 0.15, z0 - 0.178), box(0.024, 0.02, 0.008, C.dark).translate(s * 0.065, yc + 0.1, z0 - 0.186), // ремни клапана с пряжками
      paint(new RoundedBoxGeometry(0.05, 0.15, 0.1, 2, 0.02), C.mesh).translate(s * (side(1.11) + 0.006), 1.11, z0 - 0.08), // боковой карман из сетки
      paint(new THREE.TorusGeometry(0.02, 0.0035, 5, 10, Math.PI).rotateZ(Math.PI), C.web).translate(s * 0.075, yc - 0.21, z0 - 0.15), // петля под ледоруб
    ]),
    // в одном боковом кармане бутылка, в другом черенок лопаты с рукоятью, оба под боковой стяжкой
    cyl(0.032, 0.2, C.blue, 12).translate(side(1.16) + 0.016, 1.17, z0 - 0.08), cyl(0.02, 0.028, C.dark, 10).translate(side(1.16) + 0.016, 1.284, z0 - 0.08),
    cyl(0.011, 0.36, C.yellow, 8).translate(-side(1.2) - 0.014, 1.24, z0 - 0.08), box(0.024, 0.022, 0.075, C.dark).translate(-side(1.2) - 0.014, 1.43, z0 - 0.08),
    ...[1.13, 1.33].map((y) => box(0.034, 0.016, 0.034, C.web).translate(-side(y) - 0.012, y, z0 - 0.08)),
    paint(new THREE.TorusGeometry(0.02, 0.004, 5, 10, Math.PI), C.web).translate(0, yc + 0.285, z0 - 0.03), // петля для переноски
  ].map((g) => g.translate(0, -1.02, -z0).rotateX(0.11).translate(0, 1.02, z0 + 0.02));
}

// Всё, что надето по фигуре. verts: точки тела в исходной позе {x, y, z, b: главная кость}. Ремень под натяжением
// ложится по выпуклой оболочке среза тела, поэтому не тонет в пуховике и не висит в воздухе.
export function fitted(verts, PUFF = 0.05, HY = 0.965, up = 0) { // PUFF: на столько шейдер раздувает тело; HY: высота пояса; up: на сколько выше обычного сидят лямки и рюкзак
  // плотный замкнутый контур среза, отодвинутый наружу; точки {u, v, nu, nv}
  const ring = (sel, fu, fv, lift, n = 96) => {
    const c = spline(hull(verts.filter(sel).map((q) => [fu(q), fv(q)])).map(([u, v]) => V(u, v, 0)), n, true);
    return c.map((p, i) => {
      const a = c[(i + n - 1) % n], q = c[(i + 1) % n], l = Math.hypot(q.x - a.x, q.y - a.y) || 1, nu = (q.y - a.y) / l, nv = -(q.x - a.x) / l;
      return { u: p.x + nu * (PUFF + lift), v: p.y + nv * (PUFF + lift), nu, nv };
    });
  };
  const flat = (r, y, b, prof, col, closed) => sweep(b, r.map((p) => V(p.u, y, p.v)), (_, i) => V(r[i].nu, 0, r[i].nv), prof, col, { closed }); // лента в горизонтальном срезе
  const trunk = (q) => q.b === 'torso' || q.b === 'hips', top = (r, f) => r.reduce((a, p) => (f(p) > f(a) ? p : a));

  // --- таз: пояс обвязки, пряжка, страховочная петля, петли под железо ---
  const hb = builder(), waist = ring((q) => trunk(q) && Math.abs(q.y - HY) < 0.03, (q) => q.x, (q) => q.z, 0.004);
  flat(waist, HY, hb, rect(0.05, 0.008), C.web, true);
  const front = top(waist, (p) => p.v - 9 * Math.abs(p.u)), buckle = top(waist, (p) => p.v - 9 * Math.abs(p.u + 0.06)), zc = front.v + 0.014;
  sweep(hb, Array.from({ length: 16 }, (_, i) => V(0, HY - 0.04 + 0.04 * Math.cos((i / 16) * TAU), zc + 0.013 * Math.sin((i / 16) * TAU))), (p) => V(0, p.y - HY + 0.04, (p.z - zc) * 3), rect(0.016, 0.005), C.strap, { closed: true });
  let rackAt = null;
  for (const s of [1, -1]) {
    const r = arc(waist, (p) => s * p.u > 0.1 && Math.abs(p.v - 0.02) < 0.09), n = r.length - 1;
    const pts = r.map((p, i) => V(p.u + p.nu * 0.012, HY - 0.028 - 0.022 * Math.sin((Math.PI * i) / n), p.v + p.nv * 0.012));
    sweep(hb, pts, (_, i) => V(r[i].nu, 0, r[i].nv), round(0.004, 5), C.cord, { smooth: true });
    if (s > 0) rackAt = [pts[n >> 1].x, pts[n >> 1].y - 0.93, pts[n >> 1].z]; // относительно кости таза
  }
  const hips = mergeGeometries([hb.geo(), box(0.05, 0.04, 0.008, C.steel).translate(buckle.u, HY, buckle.v + 0.003)]);

  // --- бёдра и ботинки ---
  const thighs = {}, shoes = {};
  for (const sx of ['1', '-1']) {
    const tb = builder(), tr = ring((q) => q.b === 'thigh' + sx && Math.abs(q.y - 0.8) < 0.025, (q) => q.x, (q) => q.z, 0.003), s = Math.sign(tr.reduce((a, p) => a + p.u, 0));
    flat(tr, 0.8, tb, rect(0.042, 0.007), C.web, true);
    const tk = top(tr, (p) => s * p.u + p.v);
    thighs[sx] = mergeGeometries([tb.geo(), place(box(0.034, 0.03, 0.006, C.steel), V(tk.u, 0.8, tk.v), V(tk.nu, 0, tk.nv))]);

    const S = verts.filter((q) => q.b === 'shoe' + sx), lo = V(9, 9, 9), hi = V(-9, -9, -9), sb = builder();
    for (const q of S) { lo.min(q); hi.max(q); }
    const xc = (lo.x + hi.x) / 2, hw = (hi.x - lo.x) / 2 + 0.026, ys = lo.y - 0.046, zf = hi.z + 0.038, zb = lo.z - 0.038;
    flat(ring((q) => (q.b === 'shoe' + sx || q.b === 'shin' + sx) && Math.abs(q.y - 0.115) < 0.03, (q) => q.x, (q) => q.z, 0.003), 0.115, sb, rect(0.016, 0.003), C.web, true); // ремешок кошки вокруг щиколотки
    const tooth = (x, z, lean) => paint(new THREE.ConeGeometry(0.008, 0.034, 4).rotateX(Math.PI).rotateZ(lean), C.steel).translate(x, ys - 0.018, z);
    shoes[sx] = mergeGeometries([
      sb.geo(),
      box(hw * 2, 0.006, 0.125, C.steel).translate(xc, ys, zf - 0.075), box(hw * 1.7, 0.006, 0.085, C.steel).translate(xc, ys, zb + 0.055), // пластины под носком и пяткой
      box(0.022, 0.005, zf - zb - 0.2, C.steel).translate(xc, ys, (zf + zb) / 2 - 0.01),
      ...[zf - 0.025, zf - 0.08, zf - 0.13, zb + 0.02, zb + 0.09].flatMap((z) => [1, -1].map((e) => tooth(xc + e * hw * 0.9, z, e * 0.22))), // зубья вниз
      ...[1, -1].map((e) => paint(new THREE.ConeGeometry(0.009, 0.055, 4).rotateX(Math.PI / 2 + 0.38), C.steel).translate(xc + e * 0.022, ys - 0.006, zf + 0.012)), // передние зубья
      paint(new THREE.TorusGeometry(hw * 0.78, 0.004, 5, 12, Math.PI).rotateX(-0.7), C.steel).translate(xc, ys + 0.012, zf - 0.02), // дужка на носке
      box(0.03, 0.06, 0.012, C.yellow).translate(xc, ys + 0.05, zb - 0.002), // рычаг на пятке
    ]);
  }

  // --- корпус: лямки рюкзака через плечи, нижние стяжки, грудная перемычка, сам рюкзак ---
  const kb = builder(), low = ring((q) => trunk(q) && Math.abs(q.y - 1.09 - up) < 0.03, (q) => q.x, (q) => q.z, 0.004);
  for (const s of [1, -1]) {
    const xs = s * 0.095, sh = arc(ring((q) => trunk(q) && Math.abs(q.x - xs) < 0.025, (q) => q.z, (q) => q.y, 0.004), (p) => p.v > (p.u > 0 ? 1.1 : 1.28) + up);
    const pts = sh.map((p) => V(xs, p.v, p.u)), ns = sh.map((p) => V(0, p.nv, p.nu));
    sweep(kb, pts, (_, i) => ns[i], [[-0.024, -0.003], [0.024, -0.003], [0.028, 0.004], [0.021, 0.013], [-0.021, 0.013], [-0.028, 0.004]], C.pad); // мягкая лямка: подушка толщиной полтора сантиметра со скошенными краями
    sweep(kb, pts.map((p, i) => p.clone().addScaledVector(ns[i], 0.0135)), (_, i) => ns[i], rect(0.018, 0.003), C.web);
    flat(arc(low, (p) => s * p.u > 0.09), 1.09 + up, kb, rect(0.02, 0.003), C.web, false); // стяжка от лямки вокруг бока к низу рюкзака
  }
  const chest = arc(ring((q) => trunk(q) && Math.abs(q.y - 1.3 - up) < 0.02, (q) => q.x, (q) => q.z, 0.016), (p) => p.v > 0 && Math.abs(p.u) < 0.1), cm = chest[chest.length >> 1];
  flat(chest, 1.3 + up, kb, rect(0.016, 0.003), C.web, false);
  const zBack = Math.min(...low.filter((p) => Math.abs(p.u) < 0.08).map((p) => p.v));
  const zUp = Math.min(...verts.filter((q) => trunk(q) && Math.abs(q.x) < 0.08 && Math.abs(q.y - 1.38 - up) < 0.03).map((q) => q.z)) - PUFF; // спина на высоте лопаток: по ней рюкзак от Meshy получает наклон
  const torso = mergeGeometries([kb.geo(), box(0.03, 0.022, 0.008, C.dark).translate(cm.u, 1.3 + up, cm.v + 0.003)]);

  // --- капюшон: толстый пуховый валик вокруг шеи, сзади выше и толще ---
  const ob = builder(), ctr = V(0, 1.46, -0.012), n = 40;
  const neck = Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; return V(Math.sin(a) * 0.1, 1.45 + 0.0125 * (1 - Math.cos(a)), Math.cos(a) * 0.095 - 0.012); });
  sweep(ob, neck, (p) => V(p.x - ctr.x, 0, p.z - ctr.z), round(1.3, 10, 1), C.pack, { closed: true, smooth: true, k: (t) => 0.03 + 0.014 * (1 - Math.cos(t * (1 - 1 / n) * TAU)) });

  // torso, hips и thighs тканевые: они гнутся вместе с пуховиком; рюкзак, кошки и капюшон жёсткие и сидят каждый на своей кости
  return { torso, hips, thighs, pack: mergeGeometries(pack(zBack)).translate(0, up, 0), shoes, hood: ob.geo(), rackAt, zBack, zUp };
}

// Железо на петле обвязки: начало координат в точке подвеса, всё висит вниз по -Y, разложено вдоль X.
export function rack() {
  const biner = (col) => paint(new THREE.TorusGeometry(0.026, 0.0035, 5, 14).scale(0.62, 1, 1), col);
  const screw = (len, knob) => [ // ледобур: трубка с зубьями, ухо и цветная рукоятка
    paint(new THREE.CylinderGeometry(0.0075, 0.0075, len, 8), C.steel).translate(0, -len / 2, 0),
    paint(new THREE.ConeGeometry(0.0075, 0.014, 8).rotateX(Math.PI), C.steel).translate(0, -len - 0.007, 0),
    box(0.034, 0.036, 0.004, C.steel).translate(0.012, 0.004, 0), paint(new THREE.CylinderGeometry(0.011, 0.011, 0.016, 8), knob).translate(0, 0.012, 0),
  ];
  return mergeGeometries([
    ...[[-0.03, 0.13, C.yellow], [0, 0.17, C.orange], [0.03, 0.15, C.blue]].flatMap(([x, len, knob], i) => [
      biner(i === 1 ? C.orange : C.steel).rotateY(0.5 + i * 0.5).translate(x, -0.026, 0),
      ...screw(len, knob).map((g) => g.rotateZ((i - 1) * 0.13).translate(x, -0.062, 0)),
    ]),
    biner(C.orange).rotateY(1.2).translate(0.062, -0.026, 0), box(0.012, 0.085, 0.003, C.sling).translate(0.062, -0.09, 0), biner(C.steel).rotateY(0.3).translate(0.062, -0.152, 0), // оттяжка
  ]);
}

// Рукавица: ось Y вдоль предплечья к пальцам.
// Зеркало по X. Порядок вершин в треугольниках тоже переворачиваем, иначе деталь выворачивается наизнанку.
function mirror(g) {
  g.scale(-1, 1, 1);
  for (const a of Object.values(g.attributes)) for (let i = 0, n = a.itemSize, t = a.array; i < a.count; i += 3) for (let c = 0; c < n; c++) { const p = (i + 1) * n + c, q = (i + 2) * n + c, v = t[p]; t[p] = t[q]; t[q] = v; }
  return g;
}
// Высотная рукавица, сжатая вокруг рукояти. Начало координат в середине хвата, Y вдоль древка, +Z к клюву,
// +X внутрь, туда где большой палец (side: 1 правая рука, -1 левая). Ладонь и палец чёрные, кожаные; тыльная сторона красная,
// с валиком над костяшками и ремешком на запястье: так это рука в рукавице, а не чёрный шар.
export function mitten(side = 1) {
  const cap = (r, len, col) => paint(new THREE.CapsuleGeometry(r, len, 3, 10), col);
  const g = mergeGeometries([
    paint(new RoundedBoxGeometry(0.084, 0.118, 0.096, 3, 0.034), C.mitt).translate(-0.008, 0, 0.002), // ладонь и пальцы вокруг рукояти
    paint(new RoundedBoxGeometry(0.03, 0.098, 0.08, 3, 0.014), C.back).translate(-0.043, 0.004, -0.002), // утеплённая тыльная сторона
    cap(0.011, 0.085, C.back).translate(-0.03, 0.002, 0.048), // валик над костяшками
    cap(0.0185, 0.05, C.mitt).rotateX(1.15).rotateZ(-0.25).translate(0.036, 0.024, 0.004), // большой палец обхватывает рукоять изнутри
    box(0.086, 0.014, 0.098, C.strap).translate(-0.008, -0.05, 0.002), // ремешок на запястье
    box(0.02, 0.018, 0.012, C.yellow).translate(-0.04, -0.05, 0.05), // пряжка
  ]);
  return side > 0 ? g : mirror(g);
}
// Ледоруб для крутого льда. Начало координат в низу рукояти, древко идёт вверх по Y и выгнуто от склона,
// клюв смотрит в +Z, его остриё в точке (0, 0.43, 0.17), сзади молоток.
export function axe() {
  const b = builder(), fwd = () => Z;
  sweep(b, spline([V(0, 0.15, 0), V(0, 0.27, -0.02), V(0, 0.39, -0.022), V(0, 0.47, 0), V(0, 0.515, 0.02)], 14), fwd, round(0.0095, 8, 0.014), C.shaft, { smooth: true });
  sweep(b, [V(0, -0.004, 0), V(0, 0.05, 0), V(0, 0.1, 0), V(0, 0.155, 0)], fwd, round(0.0155, 10, 0.019), C.dark, { smooth: true, k: (u) => 1 - 0.12 * Math.sin(u * Math.PI) }); // резиновая рукоять с талией
  const pick = new THREE.Shape([[-0.03, 0.535], [0.035, 0.538], [0.09, 0.518], [0.145, 0.462], [0.17, 0.43], [0.16, 0.437], [0.151, 0.438], [0.147, 0.449], [0.135, 0.452], [0.131, 0.463],
    [0.118, 0.466], [0.114, 0.476], [0.099, 0.479], [0.095, 0.488], [0.06, 0.494], [-0.03, 0.494]].map((p) => new THREE.Vector2(...p)));
  return mergeGeometries([
    b.geo(),
    paint(new THREE.ExtrudeGeometry(pick, { depth: 0.005, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.0025, 0, 0), C.steel), // клюв с зубьями
    box(0.022, 0.03, 0.03, C.steel).translate(0, 0.514, -0.043), // молоток
    box(0.02, 0.012, 0.042, C.dark).translate(0, 0.002, 0.02), // упор под мизинец
    box(0.018, 0.01, 0.03, C.dark).translate(0, 0.156, 0.02), // упор под указательный
    paint(new THREE.ConeGeometry(0.008, 0.03, 6).rotateX(Math.PI), C.steel).translate(0, -0.018, 0), // штычок
  ]);
}
