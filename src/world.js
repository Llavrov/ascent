// Математика мира без three: высота горы и линия маршрута. Проверяется в node (test/world.test.js).

export const EXTENT = 2400; // половина стороны мира, м
export const START_Z = 250; // откуда альпинист начинает
export const TOP_Z = 14; // где подъём зацикливается

const K = 45; // мягкость слияния вершин
// cx, cz, высота, спад, фаза гребней. Первая вершина наша, остальные фон.
const PEAKS = [
  [0, 0, 1300, 470, -Math.PI / 4],
  [-1250, -650, 900, 520, 0.6],
  [1350, -500, 820, 480, 2.1],
  [900, 1300, 640, 420, 1.2],
  [-1300, 1100, 700, 450, 4.0],
  [150, -1700, 960, 560, 3.0],
];

function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

// Сетка горы подробная только в полосе маршрута, дальше её шаг растёт. Рельеф мельче пары ячеек сетка передать не может:
// каждая ячейка тогда торчит отдельной плоской гранью. Поэтому у самого мелкого шума (бугры и надувы в метр-два) есть предел:
// lam это длина волны первой октавы в метрах, cell шаг сетки в этом месте; октава гаснет, когда на её волну меньше пяти ячеек.
// Крупные гребни так не гасим: издали гора без них становится гладким белым конусом.
export const FINE = { x: 44, z0: -25, z1: 300, sx: 0.4, sz: 0.45, grow: 1.07 };
const cellAt = (x, z) => Math.max(FINE.sx + ((FINE.grow - 1) / FINE.grow) * Math.max(0, Math.abs(x) - FINE.x), FINE.sz + ((FINE.grow - 1) / FINE.grow) * Math.max(0, z - FINE.z1, FINE.z0 - z));
const keep = (lam, cell) => (lam > 0 ? smooth(lam / 2, lam / 5, cell) : 1);

function fbm(x, z, oct, lam = 0, cell = 0) {
  let a = 0.5, s = 0;
  for (let i = 0; i < oct; i++) { s += a * (0.5 + (vnoise(x, z) - 0.5) * keep(lam, cell)); x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; a *= 0.5; lam /= 2.03; }
  return s;
}

// soft скругляет гребень на столько метров в каждую сторону, одинаково на всех октавах. С острым гребнем склон складывался
// из плоских кусков с резким изломом между ними (на мелких октавах излом доходил до 70 градусов): на снегу это выглядело как крупные треугольники.
function ridged(x, z, oct, soft = 0, lam = 0, cell = 0) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    const r = lam > 0 ? Math.min(0.8, (soft * 4) / lam) : soft, c = 2 * vnoise(x, z) - 1, v = 1 - Math.sqrt(c * c + r * r); // 4/lam: шум проходит от -1 до 1 за полволны
    s += a * (0.33 + (v * v - 0.33) * keep(lam, cell)); n += a; x = x * 2.07 + 31.7; z = z * 2.07 + 11.3; a *= 0.5; lam /= 2.07; // 0.33: среднее гребневого шума
  }
  return s / n;
}

export function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// Маршрут идёт по кулуару передней стены: x как функция z. Та же формула в шейдере склона.
export const routeX = (z) => 7 * Math.sin(z * 0.021 + 0.5) + 3 * Math.sin(z * 0.057 + 1.3);

// Маршрут идёт через разные участки по 15–30 метров: снег, натёчный лёд, скальные ступени.
// Доли льда и скалы на высоте z, 0..1. Те же формулы в шейдере склона.
export const rockK = (z) => smooth(0.25, 0.5, Math.sin(z * 0.11 + 4) * Math.sin(z * 0.043 + 1));
export const iceK = (z) => smooth(0.2, 0.45, Math.sin(z * 0.19 + 1) * Math.sin(z * 0.071 + 2)) * (1 - rockK(z));
export const ground = (z) => (rockK(z) > 0.5 ? 2 : iceK(z) > 0.5 ? 1 : 0); // 0 снег, 1 лёд, 2 скала

// Гора без мелкого рельефа: по ней шейдер понимает, где склон круче общего уклона, там скала.
export function base(x, z) {
  let e = 0;
  for (const p of PEAKS) {
    const dx = x - p[0], dz = z - p[1];
    const d = Math.sqrt(dx * dx + dz * dz + 144);
    const crest = 1 - Math.abs(Math.sin(1.5 * Math.atan2(dz, dx) + p[4])); // три острых гребня
    e += Math.exp((p[2] * Math.exp((-d * (1 - 0.45 * crest)) / p[3])) / K);
  }
  return Math.log(e) * K;
}

// fine=false пропускает мелкий рельеф: для карты теней и облаков пыли он не нужен.
export function height(x, z, fine = true) {
  let y = base(x, z);
  const cell = cellAt(x, z);
  // вокруг маршрута рельеф спокойнее: снежный кулуар между скальными рёбрами
  const calm = 1 - 0.8 * smooth(-60, 0, z) * smooth(48, 8, Math.abs(x - routeX(z)));
  // Изломы скругляем только в снежном кулуаре у маршрута: там склон пологий и весь в снегу, плоские грани на нём видны.
  // По бокам горы рёбра остаются острыми: на их крутых боках держится скала, со скруглением гора издали белела целиком.
  y += (ridged(x / 140, z / 140, 5, 2 * (1 - calm), 140) - 0.4) * 55 * calm;
  // желоба вдоль линии падения, как на ледовых стенах
  // Желоба не идут по линейке: их уводит в стороны, они то выше, то сходят на нет. Гребень острый, как у настоящих снежных желобов,
  // со скруглением в ладонь: совсем острый даёт излом в одну линию, а сильно скруглённый превращает желоба в гладкие трубы.
  const d0 = Math.sqrt(x * x + z * z), th = Math.atan2(z, x), tw = th + 0.1 * (fbm(x / 45, z / 45, 2) - 0.47);
  const fc = 2 * vnoise(Math.cos(tw) * 15 + d0 * 0.004, Math.sin(tw) * 15) - 1, fl = 1 - Math.sqrt(fc * fc + 0.003);
  y += fl * fl * 7 * (0.55 + 0.9 * vnoise(x / 70 + 3.1, z / 70)) * smooth(30, 120, d0) * smooth(800, 450, d0) * (0.35 + 0.65 * calm);
  // ниже стены гора обрывается скальным поясом, под ним видны ледник и соседние хребты
  y -= 170 * smooth(0, 60, d0 - 335 - 45 * (2 * vnoise(Math.cos(th) * 3, Math.sin(th) * 3) - 1));
  // скальные рёбра и уступы по бокам от тропы: у стены появляются силуэт, полки и ступени
  const rib = fine ? smooth(5, 16, Math.abs(x - routeX(z))) * smooth(40, 26, Math.abs(x)) /* только там, где сетка мелкая: на грубой уступы шли ломаными клиньями */ * smooth(-70, -30, z) * smooth(420, 360, z) : 0;
  if (rib > 0) {
    const q = ((ridged(x / 23, z / 23, 4, 0.9, 23, cell) - 0.35) * 9 + (ridged(x / 7, z / 7, 3, 0.6, 7, cell) - 0.4) * 2.2) / 1.6, f = Math.floor(q);
    y += rib * (f + smooth(0.7, 1, q - f)) * 1.6;
  }
  // скальная ступень поперёк кулуара: уступы по полметра и общий выступ
  const rs = fine ? rockK(z) * smooth(11, 5, Math.abs(x - routeX(z))) : 0;
  if (rs > 0) { const q = ((ridged(x / 5, z / 5, 3) - 0.3) * 1.6) / 0.5, f = Math.floor(q); y += rs * ((f + smooth(0.6, 1, q - f)) * 0.5 + 0.5); }
  if (fine) y += (fbm(x / 18, z / 18, 3) - 0.44) * 6 * (0.3 + 0.7 * calm) + (fbm(x / 2.4, z / 2.4, 2, 2.4, cell) - 0.37) * 0.45
    + (fbm(x / 6, z / 2.2, 3, 2.2, Math.max(cell / 2.7, FINE.sz)) - 0.44) * 0.9 // надувы, вытянутые по ветру: поперёк они втрое шире
    - 0.45 * smooth(0.78, 0.97, 1 - Math.abs(2 * vnoise(Math.cos(tw) * 60 + d0 * 0.002, Math.sin(tw) * 60) - 1)) * smooth(40, 120, d0) * smooth(420, 330, d0) * smooth(0.6, 0.46, cell); // желобки от сходящего снега, только на подробной сетке
  return y;
}

// Нормаль склона, пишет в out {x,y,z}.
export function normalAt(x, z, eps, out) {
  const hx = height(x + eps, z) - height(x - eps, z), hz = height(x, z + eps) - height(x, z - eps);
  const l = Math.hypot(hx, 2 * eps, hz);
  out.x = -hx / l; out.y = (2 * eps) / l; out.z = -hz / l;
  return out;
}

// Длина маршрута по склону от подножия стены вверх, в метрах. По ней идут шаги альпиниста и его следы.
const Z_FOOT = 420, DZ = 0.25, S_TAB = new Float32Array(Math.round((Z_FOOT + 40) / DZ) + 1);
for (let i = 1, px = routeX(Z_FOOT), py = height(px, Z_FOOT); i < S_TAB.length; i++) {
  const z = Z_FOOT - i * DZ, x = routeX(z), y = height(x, z);
  S_TAB[i] = S_TAB[i - 1] + Math.hypot(x - px, y - py, DZ);
  px = x; py = y;
}
export function sAt(z) {
  const f = Math.min(S_TAB.length - 1.001, Math.max(0, (Z_FOOT - z) / DZ)), i = Math.floor(f);
  return S_TAB[i] + (S_TAB[i + 1] - S_TAB[i]) * (f - i);
}
export function zAt(s) {
  let lo = 0, hi = S_TAB.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S_TAB[mid] <= s) lo = mid; else hi = mid; }
  return Z_FOOT - (lo + Math.min(1, Math.max(0, (s - S_TAB[lo]) / (S_TAB[hi] - S_TAB[lo])))) * DZ;
}

