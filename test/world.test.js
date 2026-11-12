import test from 'node:test';
import assert from 'node:assert/strict';
import { height, routeX, normalAt, sAt, zAt, START_Z, TOP_Z, EXTENT } from '../src/world.js';

test('высота конечна по всему миру', () => {
  for (let x = -EXTENT; x <= EXTENT; x += 160) for (let z = -EXTENT; z <= EXTENT; z += 160) {
    assert.ok(Number.isFinite(height(x, z)), `height(${x}, ${z})`);
  }
});

test('маршрут всё время идёт вверх по крутому, но проходимому склону', () => {
  let prev = height(routeX(START_Z), START_Z);
  for (let z = START_Z - 10; z >= TOP_Z; z -= 10) {
    const y = height(routeX(z), z);
    const deg = (Math.atan((y - prev) / 10) * 180) / Math.PI;
    assert.ok(deg > 25 && deg < 75, `уклон ${deg.toFixed(0)}° на z=${z}`);
    prev = y;
  }
});

test('нормаль единичная и смотрит от склона вверх', () => {
  const n = normalAt(routeX(120), 120, 1.2, {});
  assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9);
  assert.ok(n.y > 0.2 && n.z > 0.2);
});

test('длина пути и обратный пересчёт сходятся, путь растёт вверх по склону', () => {
  for (let z = START_Z; z >= TOP_Z; z -= 7.3) assert.ok(Math.abs(zAt(sAt(z)) - z) < 1e-3, `z=${z}`);
  assert.ok(sAt(TOP_Z) - sAt(START_Z) > START_Z - TOP_Z);
});
