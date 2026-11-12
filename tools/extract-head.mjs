// Разовая вырезка головы из подробной модели (pilatus-ride/blender/sources/humans/sam.glb) в public/head/.
// Запуск: node tools/extract-head.mjs <путь к sam.glb>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const glb = fs.readFileSync(process.argv[2]), jl = glb.readUInt32LE(12), J = JSON.parse(glb.slice(20, 20 + jl).toString('utf8')), bin = glb.subarray(20 + jl + 8);
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, READ = { 5126: ['readFloatLE', 4], 5123: ['readUInt16LE', 2], 5121: ['readUInt8', 1], 5125: ['readUInt32LE', 4] };
function acc(i) { // аксессор в плоский массив чисел
  const a = J.accessors[i], v = J.bufferViews[a.bufferView], n = SIZE[a.type], [fn, bytes] = READ[a.componentType], stride = v.byteStride || n * bytes;
  const out = new Array(a.count * n), base = (v.byteOffset || 0) + (a.byteOffset || 0), norm = a.normalized ? (bytes === 1 ? 255 : 65535) : 1;
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = bin[fn](base + k * stride + c * bytes) / norm;
  return out;
}
const names = J.skins[0].joints.map((i) => J.nodes[i].name), HEAD = [names.indexOf('head'), names.indexOf('neck_01')];
const b64 = (arr, T) => Buffer.from(new T(arr).buffer).toString('base64');
function part(meshName, onlyHead) {
  const p = J.meshes.find((m) => m.name.startsWith(meshName)).primitives[0], P = acc(p.attributes.POSITION), N = acc(p.attributes.NORMAL), U = acc(p.attributes.TEXCOORD_0), I = acc(p.indices);
  let keep = () => true;
  if (onlyHead) { // от тела оставляем только то, что держится на костях головы и шеи
    const Jn = acc(p.attributes.JOINTS_0), W = acc(p.attributes.WEIGHTS_0);
    keep = (v) => { let w = 0; for (let c = 0; c < 4; c++) if (HEAD.includes(Jn[v * 4 + c])) w += W[v * 4 + c]; return w > 0.5; };
  }
  const map = new Map(), pos = [], nor = [], uv = [], idx = [];
  for (let t = 0; t < I.length; t += 3) {
    if (!(keep(I[t]) && keep(I[t + 1]) && keep(I[t + 2]))) continue;
    for (let c = 0; c < 3; c++) {
      const v = I[t + c];
      if (!map.has(v)) { map.set(v, pos.length / 3); pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); uv.push(U[v * 2], U[v * 2 + 1]); }
      idx.push(map.get(v));
    }
  }
  const img = J.images[J.textures[J.materials[p.material].pbrMetallicRoughness.baseColorTexture.index].source], bv = J.bufferViews[img.bufferView];
  return { pos, nor, uv, idx, png: bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) };
}
const parts = { skin: part('base', true), eyes: part('low-poly'), brows: part('eyebrow'), lashes: part('eyelashes') };
const out = { parts: {} };
for (const [name, g] of Object.entries(parts)) {
  out.parts[name] = { pos: b64(g.pos, Float32Array), nor: b64(g.nor, Float32Array), uv: b64(g.uv, Float32Array), idx: b64(g.idx, Uint32Array) };
  fs.writeFileSync(`public/head/${name}.png`, g.png);
  console.log(name, 'вершин', g.pos.length / 3, 'треугольников', g.idx.length / 3, 'текстура', (g.png.length / 1024) | 0, 'КБ');
}
// центр черепа: середина головы по ширине и глубине, высота чуть выше глаз
const s = parts.skin.pos, e = parts.eyes.pos, mm = (a, o, f) => { let v = f === Math.min ? 1e9 : -1e9; for (let k = o; k < a.length; k += 3) v = f(v, a[k]); return v; };
const top = s.filter((_, k) => k % 3 === 1).map((y, k) => (y > mm(e, 1, Math.min) ? k : -1)).filter((k) => k >= 0);
const zs = top.map((k) => s[k * 3 + 2]);
out.center = [0, (mm(e, 1, Math.min) + mm(e, 1, Math.max)) / 2 + 0.02, (Math.min(...zs) + Math.max(...zs)) / 2];
out.eyesY = (mm(e, 1, Math.min) + mm(e, 1, Math.max)) / 2;
fs.writeFileSync('public/head/head.json', JSON.stringify(out));
// кожа и глаза в jpeg поменьше; брови и ресницы остаются png: им нужна прозрачность
execFileSync('sips', ['-Z', '2048', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', 'public/head/skin.png', '--out', 'public/head/skin.jpg']);
execFileSync('sips', ['-Z', '256', '-s', 'format', 'jpeg', 'public/head/eyes.png', '--out', 'public/head/eyes.jpg']);
fs.rmSync('public/head/skin.png'); fs.rmSync('public/head/eyes.png');
console.log('центр черепа', out.center.map((v) => +v.toFixed(3)), 'глаза y', +out.eyesY.toFixed(3), 'голова y', +mm(s, 1, Math.min).toFixed(3), +mm(s, 1, Math.max).toFixed(3), 'z', +mm(s, 2, Math.min).toFixed(3), +mm(s, 2, Math.max).toFixed(3));
