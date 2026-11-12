import test from 'node:test';
import assert from 'node:assert/strict';
import { pillows } from '../src/terrain.js';
import { FINE, height, routeX } from '../src/world.js';

test('снежные подушки: есть у скал, нет у тропы, сетка поднята ровно на их глубину', () => {
  const xs = [], zs = [];
  for (let x = -FINE.x; x <= FINE.x; x += FINE.sx) xs.push(x);
  for (let z = 150; z <= 230; z += FINE.sz) zs.push(z);
  const pos = new Float32Array(xs.length * zs.length * 3);
  for (let j = 0, k = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++, k++) { pos[k * 3] = xs[i]; pos[k * 3 + 1] = height(xs[i], zs[j]); pos[k * 3 + 2] = zs[j]; }
  const before = Float32Array.from(pos), snow = pillows(pos, xs, zs);
  let deep = 0;
  for (let j = 0, k = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++, k++) {
    assert.ok(Number.isFinite(snow[k]) && snow[k] >= 0 && snow[k] < 0.8, `глубина в точке ${k}: ${snow[k]}`);
    assert.ok(Math.abs(pos[k * 3 + 1] - before[k * 3 + 1] - snow[k]) < 1e-4, 'сетка поднята на глубину подушки');
    if (Math.abs(xs[i] - routeX(zs[j])) < 5.5) assert.ok(snow[k] < 1e-3, 'у тропы подушек нет: там высоту считает world.js');
    if (snow[k] > 0.3) deep++;
  }
  assert.ok(deep > 200, `подушки глубже 30 см: ${deep} вершин`);
});
