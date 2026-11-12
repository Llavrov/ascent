// Съёмка ролика для соцсетей. Кадры и звук считаются не вживую, а по шагам: ролик выходит ровным на любой машине и в скрытой вкладке.
// Запуск: sh tools/shoot.sh (Chrome без окна; в скрытой вкладке обычного браузера система душит съёмку до кадра в несколько секунд).
// Кадры и звук ложатся в shots/reel, склейка в mp4: sh tools/reel.sh.

// Раскадровка: секунда ролика и что в неё сделать. Последняя строка задаёт длину ролика.
const PLAN = [
  [0, (a) => a.cut(0)], // «Следом», пурга
  [4.5, (a) => { a.cut(1); a.weather.mode = 'clear'; }], // «Сбоку», начинает проясняться
  [8.5, (a) => a.cut(2)], // «Сверху»
  [12.5, (a) => a.cut(5)], // «Очки»
  [16.2, (a) => a.avalanche()], // сверху сходит лавина: гул слышен ещё на очках
  [16.5, (a) => a.cut(4)], // «Дрон»: лавина проходит рядом с ним, кадр уходит в белое
  [21.6, () => {}], // облако лавины закрыло кадр: конец, с белого ролик зацикливается обратно в пургу
];

export function shoot({ w = 1080, h = 1920, fps = 30, plan = PLAN, seed = 7, warm = 8, frames = true } = {}) {
  const a = window.ascent, canvas = a.renderer.domElement, N = Math.round(plan.at(-1)[0] * fps);
  const S = (window.__shoot = { i: 0, N, done: false, error: null });
  let r = seed; // один и тот же дубль при каждом запуске
  Math.random = () => { r = (r + 0x6d2b79f5) | 0; let t = Math.imul(r ^ (r >>> 15), 1 | r); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let vt = performance.now();
  performance.now = () => vt; // часы сцены идут по кадрам ролика: по ним звук считает паузы между кряхтением
  a.renderer.setPixelRatio(1); a.renderer.setSize(w, h, false); a.post.resize(w, h); a.G.uRes.value.set(w, h); a.camera.aspect = w / h;
  Object.assign(a.cam, { auto: false }); a.weather.mode = 'storm'; a.weather.c = 0; a.ava.next = 1e9; // лавина только по раскадровке
  const tick = () => { vt += 1000 / fps; a.shoot(1 / fps); };
  for (let i = 0; i < warm * fps; i++) tick(); // разгон: альпинист уже в пути, снег разлетелся
  const off = new OfflineAudioContext(2, Math.ceil((N / fps) * 48000), 48000);
  window.AudioContext = function () { return off; }; // звук сцены строится на этом контексте и считается вместе с кадрами
  a.audio.toggle();
  const put = (name, body) => fetch('/api/shot?name=' + name, { method: 'POST', body }).then((x) => { if (!x.ok) throw new Error(name + ' ' + x.status); });
  let next = 0;
  const frame = async (i) => {
    while (next < plan.length && plan[next][0] * fps <= i) plan[next++][1](a);
    tick();
    if (frames) await put(`f-${String(i).padStart(5, '0')}.jpg`, await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.95))); // снимок берём сразу после кадра, пока буфер холста цел
    S.i = i + 1;
  };
  // Звук останавливается на границе каждого кадра, сцена делает шаг и ставит свои звуки на это время, потом звук идёт дальше.
  for (let i = 0; i < N; i++) off.suspend(i / fps).then(() => frame(i)).then(() => off.resume()).catch((e) => { S.error = String(e); });
  off.startRendering().then((buf) => put('audio.wav', wav(buf))).then(() => { S.done = true; }, (e) => { S.error = String(e); });
  return S;
}

export function auto() { const go = () => (document.querySelector('#loader:not(.done)') ? setTimeout(go, 200) : shoot()); go(); } // ждёт, пока сцена загрузится

function wav(buf) { // 16 бит, стерео
  const n = buf.length, ch = buf.numberOfChannels, v = new DataView(new ArrayBuffer(44 + n * ch * 2)), str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const d = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, d[c][i])) * 32767, true);
  return new Blob([v], { type: 'audio/wav' });
}
