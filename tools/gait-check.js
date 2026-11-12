// Проверка походки: вставить в консоль открытой сцены и вызвать `await gaitCheck(600)`.
// Гоняет альпиниста N секунд с одним и тем же зерном случайности и меряет суставы ног по костям.
// Человеческие пределы, за которые выходить нельзя: бедро вбок до 45 градусов (больше 1% кадров уже видно),
// бедро к груди до 110, колено под снегом и рука дальше 3 см от ледоруба почти никогда. Лодыжка: голень к носку до 30,
// от носка до 40, вбок до 15 (ankleBad: доля кадров за этими пределами с запасом).
// Итог от 12.11.2026 за 1200 секунд: abd_gt45 0.3, flex_gt105 0, handOff 0.2, footOff 0.2, stretched_gt8 2.6. На коротком прогоне цифры гуляют вдвое.
window.gaitCheck = async (secs = 600) => {
  const a = window.ascent, c = a.climber, L = c.limbs, { height } = await import('/src/world.js');
  const B = {}; a.scene.traverse((o) => { if (o.isBone) B[o.name] = o; });
  const V3 = c.hips.constructor, p = (n) => B[n].getWorldPosition(new V3()), deg = (r) => (r * 180) / Math.PI;
  const S = { abd: [], flex: [], kneeGap: [], hand: [], foot: [], str: [], dorsi: [], roll: [], heel: [] };
  let seed = 777; const rnd = Math.random; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  c.restart();
  for (let f = 0; f < 60 * secs; f++) {
    c.update(1 / 60, a.camera);
    if (c.st.z < 16) c.restart();
    if (f % 2 || c.st.fall > 0 || c.st.brace > 0 || c.st.slip > 0) continue;
    a.scene.updateMatrixWorld(true);
    const up = p('torso').sub(p('hips')).normalize(), lat = p('thigh1').sub(p('thigh-1'));
    if (lat.dot(c.right) < 0) lat.negate();
    lat.addScaledVector(up, -lat.dot(up)).normalize();
    const front = new V3().crossVectors(up, lat); if (front.dot(c.n) > 0) front.negate();
    for (const sx of ['1', '-1']) {
      const h = p('thigh' + sx), k = p('shin' + sx), T = k.clone().sub(h).normalize(), out = h.clone().sub(p('hips')).dot(lat) > 0 ? 1 : -1;
      S.abd.push(deg(Math.asin(Math.max(-1, Math.min(1, T.dot(lat) * out)))));
      S.flex.push(deg(Math.atan2(T.dot(front), -T.dot(up))));
      S.kneeGap.push((k.y - height(k.x, k.z)) * c.n.y);
      S.str.push(B['thigh' + sx].scale.y);
      // Лодыжка: ботинок это сама кость стопы, в покое носок смотрит в +Z модели, подошва вниз. Голень: от лодыжки к колену.
      const boot = B['shoe' + sx], bf = new V3(0, 0, 1).transformDirection(boot.matrixWorld), bu = new V3(0, 1, 0).transformDirection(boot.matrixWorld);
      const u = k.clone().sub(p('shoe' + sx)).normalize(), side = u.clone().addScaledVector(bf, -u.dot(bf)).normalize();
      S.dorsi.push(deg(Math.asin(Math.max(-1, Math.min(1, u.dot(bf)))))); // голень наклонена к носку (плюс) или от него (минус)
      S.heel.push(deg(Math.asin(Math.max(-1, Math.min(1, -bf.y))))); // носок смотрит вниз: пятка поднята
      S.roll.push(deg(Math.acos(Math.max(-1, Math.min(1, side.dot(bu)))))); // голень завалена вбок относительно ботинка
      const l = L.find((q) => !q.hand && q.s === out); // ступня у своего следа: кость щиколотки в 17 см за носком
      if (l && l.u >= 1) S.foot.push(p('shoe' + sx).distanceTo(l.cur));
    }
    for (const i of [0, 2]) {
      const l = L[i]; if (l.u < 1 || (i === 0 && c.st.task > 0) || l.sh > 0.01) continue;
      S.hand.push(new V3(0, 0.075, 0).applyQuaternion(l.tool.quaternion).add(l.tool.position).distanceTo(l.fist.position));
    }
  }
  Math.random = rnd;
  const q = (arr, f) => +arr.slice().sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(f * arr.length))].toFixed(1);
  const pct = (arr, fn) => +((100 * arr.filter(fn).length) / arr.length).toFixed(1);
  return {
    abd_p99_max: [q(S.abd, 0.99), q(S.abd, 1)], abd_gt45: pct(S.abd, (x) => x > 45),
    flex_p99_max: [q(S.flex, 0.99), q(S.flex, 1)], flex_gt105: pct(S.flex, (x) => x > 105),
    dorsi_p1_p99_max: [q(S.dorsi, 0.01), q(S.dorsi, 0.99), q(S.dorsi, 1)], roll_p50_p99_max: [q(S.roll, 0.5), q(S.roll, 0.99), q(S.roll, 1)], heelUp_p50_p99_max: [q(S.heel, 0.5), q(S.heel, 0.99), q(S.heel, 1)], ankleBad: pct(S.roll, (x, i) => x > 20 || S.dorsi[i] > 32 || S.dorsi[i] < -45),
    kneeUnder: pct(S.kneeGap, (x) => x < 0.02), handOff: pct(S.hand, (d) => d > 0.03),
    footOff: pct(S.foot, (d) => d > 0.22), stretched_gt8: pct(S.str, (x) => x > 1.08),
  };
};

// Проверка рук: `armCheck(600)`. Считает по костям рывки (плечо, предплечье и промежуточные кости плеча повернулись за кадр больше,
// чем может человек), локоть внутри корпуса, руку, сложенную целиком, и кулак не на ледорубе. Всё в процентах кадров.
// Итог от 12.11.2026 за 600 секунд: armJump 0.03, helperJump 0.11, elbowInBody 0, elbowFolded 0, handOff 0.27.
// До правок: armJump 0.21, helperJump 0.26 (рывки до 90 и 180 градусов), elbowInBody 0.38.
window.armCheck = (secs = 600) => {
  const a = window.ascent, c = a.climber, L = c.limbs, V3 = c.hips.constructor, B = {};
  a.scene.traverse((o) => { if (o.isBone) B[o.name] = o; });
  const wp = (n) => B[n].getWorldPosition(new V3()), deg = (r) => (r * 180) / Math.PI;
  const dirOf = (bone, el) => bone.localToWorld(el.clone()).sub(bone.getWorldPosition(new V3())).normalize(), sideOf = (bone) => new V3(1, 0, 0).transformDirection(bone.matrixWorld);
  let seed = 777; const rnd = Math.random; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const prev = {}, ev = { helperJump: 0, armJump: 0, elbowInBody: 0, elbowFolded: 0, handOff: 0, frames: 0 };
  c.restart();
  for (let f = 0; f < 60 * secs; f++) {
    c.update(1 / 60, a.camera);
    if (c.st.z < 16) { c.restart(); for (const k in prev) delete prev[k]; }
    a.scene.updateMatrixWorld(true); ev.frames++;
    if (c.st.fall > 0 || c.st.brace > 0) { for (const k in prev) delete prev[k]; continue; } // в срыве руки болтаются нарочно
    for (const sx of ['1', '-1']) {
      const sh = wp('upperArm' + sx), el = wp('forearm' + sx), ha = wp('hand' + sx), at = B['forearm' + sx].position, ua = el.clone().sub(sh).normalize(), fa = ha.clone().sub(el).normalize();
      const dirs = { arm: ua, fore: fa, h1: dirOf(B[`shoulder${sx}_1`], at), h2: dirOf(B[`shoulder${sx}_2`], at), s1: sideOf(B[`shoulder${sx}_1`]), s2: sideOf(B[`shoulder${sx}_2`]) };
      for (const k in dirs) {
        const p = prev[sx + k];
        if (p) { const ang = deg(p.angleTo(dirs[k])); if (k === 'arm' || k === 'fore') { if (ang > 20) ev.armJump++; } else if (ang > 12) ev.helperJump++; }
        prev[sx + k] = dirs[k].clone();
      }
      const hips = wp('hips'), ax = wp('head').sub(hips), t = Math.max(0, Math.min(1, el.clone().sub(hips).dot(ax) / ax.lengthSq()));
      if (el.distanceTo(hips.addScaledVector(ax, t)) < 0.14) ev.elbowInBody++;
      if (deg(Math.acos(Math.max(-1, Math.min(1, ua.dot(fa))))) > 150) ev.elbowFolded++;
    }
    for (const i of [0, 2]) {
      const l = L[i]; if (l.u < 1 || (i === 0 && c.st.task > 0) || l.sh > 0.01) continue;
      if (new V3(0, 0.075, 0).applyQuaternion(l.tool.quaternion).add(l.tool.position).distanceTo(l.fist.position) > 0.03) ev.handOff++;
    }
  }
  Math.random = rnd;
  const pct = (n, per) => +((100 * n) / ev.frames / per).toFixed(2);
  return { armJump: pct(ev.armJump, 2), helperJump: pct(ev.helperJump, 8), elbowInBody: pct(ev.elbowInBody, 2), elbowFolded: pct(ev.elbowFolded, 2), handOff: pct(ev.handOff, 2) };
};
