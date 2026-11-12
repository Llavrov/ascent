import test from 'node:test';
import assert from 'node:assert/strict';
import { hull, helmet, rack, mitten, axe, fitted } from '../src/gear.js';

test('оболочка: углы квадрата против часовой стрелки, внутренние точки отброшены', () => {
  assert.deepEqual(hull([[0, 0], [1, 1], [0.5, 0.5], [1, 0], [0, 1], [0.2, 0.7]]), [[0, 0], [1, 0], [1, 1], [0, 1]]);
});

const sane = (g, name) => {
  const P = g.attributes.position.array, N = g.attributes.normal.array;
  assert.ok(P.length > 0 && P.length === N.length && g.attributes.aCol.count === P.length / 3, name);
  for (let i = 0; i < P.length; i++) assert.ok(Number.isFinite(P[i]) && Number.isFinite(N[i]), `${name}: число в вершине ${i}`);
};

test('каска, железо и рукавица собираются без битых вершин; в каске есть прорези', () => {
  const h = helmet();
  sane(h, 'каска'); sane(rack(), 'железо'); sane(mitten(), 'рукавица'); sane(mitten(-1), 'левая рукавица'); sane(axe(), 'ледоруб');
  const c = h.attributes.aCol.array;
  let liner = 0;
  for (let i = 0; i < c.length; i += 4) if (c[i] < 0.05) liner++;
  assert.ok(liner > 500, 'тёмное дно прорезей и изнанка');
  assert.equal(h.userData.lamp.length, 3);
});

test('ремни по фигуре: пояс лежит снаружи тела', () => {
  // грубая фигура: цилиндры корпуса, бёдер и ботинок в исходной позе
  const verts = [], put = (b, x0, z0, r, y0, y1) => { for (let y = y0; y <= y1; y += 0.02) for (let a = 0; a < 24; a++) verts.push({ x: x0 + r * Math.cos(a * 0.2618), y, z: z0 + r * 0.7 * Math.sin(a * 0.2618), b }); };
  put('hips', 0, 0, 0.17, 0.9, 0.98); put('torso', 0, 0, 0.17, 0.98, 1.44);
  for (const s of [1, -1]) { put('thigh' + s, 0.1 * s, 0, 0.07, 0.5, 0.9); put('shin' + s, 0.1 * s, 0, 0.05, 0.1, 0.5); put('shoe' + s, 0.1 * s, 0.05, 0.05, 0, 0.08); }
  const f = fitted(verts);
  for (const [k, g] of [['torso', f.torso], ['рюкзак', f.pack], ['hips', f.hips], ['thigh', f.thighs['1']], ['shoe', f.shoes['-1']], ['hood', f.hood]]) sane(g, k);
  const P = f.hips.attributes.position.array;
  let near = 9;
  for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 1] - 0.965) < 0.02) near = Math.min(near, Math.hypot(P[i] / 0.17, P[i + 2] / 0.119));
  assert.ok(near > 1.2, `пояс снаружи пуховика, а не в теле: ${near.toFixed(2)}`);
  assert.ok(f.rackAt[0] > 0.2);
});
