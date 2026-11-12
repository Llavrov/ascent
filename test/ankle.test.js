import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ankle } from '../src/climber.js';

const deg = (r) => (r * 180) / Math.PI, V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

test('лодыжка: как бы ни легла голень, сустав не выходит за человеческие пределы', () => {
  const toe = V(0, 0.15, 1), side = V(1, 0, 0), f = new THREE.Vector3(), up = new THREE.Vector3();
  let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < 2000; i++) {
    const shin = V(rnd(), rnd(), rnd()), hinge = V(rnd(), rnd(), rnd());
    hinge.addScaledVector(shin, -hinge.dot(shin)).normalize(); // ось колена всегда поперёк голени
    ankle(toe, side, shin, hinge, f, up);
    assert.ok(Math.abs(f.length() - 1) < 1e-6 && Math.abs(up.length() - 1) < 1e-6 && Math.abs(f.dot(up)) < 1e-6, 'оси ботинка единичные и под прямым углом');
    const dorsi = deg(Math.asin(f.dot(shin))), roll = deg(up.angleTo(shin.clone().addScaledVector(f, -shin.dot(f)).normalize()));
    assert.ok(dorsi < 28.2 && dorsi > -40.2, `наклон голени к носку ${dorsi}`);
    assert.ok(roll < 15.1, `завал вбок ${roll}`);
  }
});

test('лодыжка: под отвесной голенью ботинок стоит плашмя носком в склон', () => {
  const toe = V(0, 0.15, 1), side = V(1, 0, 0), f = new THREE.Vector3(), up = new THREE.Vector3();
  ankle(toe, side, V(0, 1, 0.1), V(1, 0, 0), f, up);
  assert.ok(f.distanceTo(toe) < 1e-6 && up.y > 0.98);
});
