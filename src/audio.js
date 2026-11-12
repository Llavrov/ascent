// Весь звук синтезируется в браузере, файлов нет (кроме реплик). Включается кнопкой: без нажатия браузер звук не даёт.
// Ветер собран из четырёх слоёв: гул, два потока по сторонам, вой в сильных порывах, снежная крупа по капюшону.
// Удары по снегу, льду и скале, молоток и железо на обвязке уходят ещё и в отзвук от стены; в пургу он глуше.
export function createAudio() {
  let ctx = null, out, src, air, side, wet, hitBus, ringBus, voiceBus, rev, white, pink, wind, breath, on = false, lastKnock = 0;
  const voice = {}, said = {}; // реплики: готовые дубли по ситуациям; когда и какой дубль звучал последним
  const WORDS = /^(hard|lost|go|good|brace|after)$/;
  let talk = null, talkEnd = 0; // что звучит сейчас и до какого времени: две реплики разом не говорим
  const rnd = (a, b) => a + Math.random() * (b - a);
  // d: время до полной тишины; на слух звук примерно втрое короче
  const env = (g, t, peak, a, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  // всплеск шума через фильтр: хруст, щелчок, осыпь, гул
  function burst(type, freq, q, peak, a, d, when = 0, to = hitBus) {
    const t = ctx.currentTime + when, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = white; s.loop = true; s.playbackRate.value = rnd(0.7, 1.3); f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f).connect(g).connect(to); env(g, t, peak, a, d); s.start(t, Math.random()); s.stop(t + a + d + 0.05);
  }
  // звон: затухающий тон
  function ring(freq, peak, d, when = 0, to = ringBus) {
    const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; o.connect(g).connect(to); env(g, t, peak, 0.003, d); o.start(t); o.stop(t + d + 0.05);
  }
  // глухой толчок: низкий тон, который сползает вниз
  function thump(f0, f1, peak, d, when = 0, to = hitBus) {
    const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d * 0.5);
    o.connect(g).connect(to); env(g, t, peak, 0.004, d); o.start(t); o.stop(t + d + 0.05);
  }
  // хруст: россыпь коротких зёрен шума, каждое своей высоты, к концу тише
  function crunch(n, f0, f1, peak, span) {
    for (let i = 0; i < n; i++) burst('bandpass', rnd(f0, f1), 1.2, peak * (1 - (0.7 * i) / n) * rnd(0.6, 1), 0.002, rnd(0.03, 0.07), (span * i) / n + rnd(0, span / n));
  }
  // железо на обвязке: карабины и ледобуры звякают друг о друга
  function jingle(n, peak, when = 0) {
    for (let i = 0; i < n; i++) { const f = rnd(2600, 6200), w = when + rnd(0, 0.18); ring(f, peak * rnd(0.5, 1), rnd(0.08, 0.16), w); ring(f * 1.47, peak * 0.4, 0.07, w); }
  }
  // непрерывный шум через фильтр: слои ветра и дыхание; pan: -1 слева, 1 справа
  function loop(buffer, type, freq, q, pan = 0, to = out) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    s.buffer = buffer; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0; p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(to); s.start(0, Math.random() * buffer.duration);
    return { f, g };
  }
  function build() {
    ctx = new AudioContext();
    // На выходе мягкий ограничитель: до 0.6 звук проходит как есть, выше плавно прижимается и не хрипит.
    // Встроенный компрессор браузера для этого не годится: он глушил короткие удары вчетверо.
    const sr = ctx.sampleRate, pre = ctx.createGain(), lim = ctx.createWaveShaper(), curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) { const x = (i / 1024 - 1) * 1.5, a = Math.abs(x); curve[i] = Math.sign(x) * (a < 0.6 ? a : 0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4)); }
    lim.curve = curve; lim.oversample = '2x'; pre.gain.value = 1 / 1.5;
    out = ctx.createGain(); out.gain.value = 0.8; out.connect(pre).connect(lim).connect(ctx.destination);
    white = ctx.createBuffer(1, sr * 2, sr);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    // розовый шум для ветра: в нём больше низа, чем в белом, он звучит как воздух, а не как помехи
    pink = ctx.createBuffer(2, sr * 4, sr);
    for (let c = 0; c < 2; c++) {
      const d = pink.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) { const x = Math.random() * 2 - 1; b0 = 0.99765 * b0 + x * 0.099046; b1 = 0.963 * b1 + x * 0.2965164; b2 = 0.57 * b2 + x * 1.0526913; d[i] = (b0 + b1 + b2 + x * 0.1848) * 0.16; }
    }
    // Отзвук от стены: шум, гаснущий за секунду, с двумя ранними отражениями; чем позже, тем глуше.
    const ir = ctx.createBuffer(2, sr * 1.5, sr), conv = ctx.createConvolver();
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let y = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, e = 0.45 * Math.exp(-t / 0.3) + 0.9 * Math.exp(-(((t - 0.1 - 0.02 * c) / 0.012) ** 2)) + 0.5 * Math.exp(-(((t - 0.22 + 0.03 * c) / 0.02) ** 2));
        y += ((Math.random() * 2 - 1) * e - y) * (0.6 - 0.5 * Math.min(1, t / 0.8)); d[i] = y;
      }
    }
    conv.buffer = ir; rev = ctx.createGain(); rev.gain.value = 0.4; conv.connect(rev).connect(out);
    // Всё, что издаёт альпинист (удары, железо, голос, дыхание), идёт через одну шину: она тише и глуше с расстоянием до камеры
    // и уходит влево или вправо по тому, где он в кадре. Ветер в неё не входит: он дует у самой камеры.
    src = ctx.createGain(); air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 16000; side = ctx.createStereoPanner(); wet = ctx.createGain();
    src.connect(air).connect(side).connect(out); wet.connect(conv);
    const bus = (gain, send) => { const b = ctx.createGain(), s = ctx.createGain(); b.gain.value = gain; s.gain.value = send; b.connect(src); b.connect(s).connect(wet); return b; };
    hitBus = bus(1.3, 0.25); ringBus = bus(1.15, 0.6); // звонкое отдаётся от стены сильнее глухого
    // Голос идёт через балаклаву: верх срезан. Дубли записаны на странице record.html, их список лежит в public/voice/index.json.
    voiceBus = ctx.createBiquadFilter(); voiceBus.type = 'lowpass'; voiceBus.frequency.value = 3600; voiceBus.connect(bus(0.9, 0.4)); // тише ударов и с большим отзвуком: голос сидит в сцене, а не поверх неё
    fetch('/voice/index.json').then((r) => (r.ok ? r.json() : {})).then((m) => {
      for (const [kind, files] of Object.entries(m)) voice[kind] = files.map((f) => fetch('/voice/' + f).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null));
    }).catch(() => {});
    wind = { rumble: loop(pink, 'lowpass', 140, 0.7), flow: [loop(pink, 'bandpass', 500, 0.6, -0.6), loop(pink, 'bandpass', 620, 0.6, 0.6)], howl: loop(white, 'bandpass', 800, 14, 0.2), hiss: loop(white, 'highpass', 5200, 0.7) };
    breath = [loop(white, 'bandpass', 700, 1.2, 0, src), loop(white, 'bandpass', 1300, 1.6, 0, src)];
  }
  return {
    toggle() {
      if (!ctx) build();
      on = !on;
      if (on) ctx.resume(); else ctx.suspend();
      return on;
    },
    // каждый кадр: storm 0..1 насколько пурга, gust порыв ветра, effort 0.3 стоит, 1 лезет, 2 после срыва,
    // phase: счётчик дыханий из сцены, на целом числе изо рта идёт пар; dist: метров от камеры до альпиниста; pan: где он в кадре, -1 слева, 1 справа
    frame(dt, storm, gust, effort, phase, dist = 6, pan = 0) {
      if (!on) return;
      // Громкость выставлена по основному ракурсу (7.5 м). Ближе громче, у самого лица вдвое; дальше тише (в 12 м на треть,
      // в 300 м почти ничего) и глуше: воздух съедает верх. Отзвук от стены гаснет медленнее прямого звука, издали удары слышны больше эхом.
      const near = Math.min(2, (7.5 / Math.max(dist, 1)) ** 0.7), now = ctx.currentTime;
      src.gain.setTargetAtTime(near, now, 0.08); wet.gain.setTargetAtTime(Math.sqrt(near), now, 0.08);
      voiceBus.frequency.setTargetAtTime(3600 - 1400 * storm, now, 0.3); // в пургу слова тонут в ветре и баффе
      air.frequency.setTargetAtTime(16000 / (1 + dist / 25), now, 0.08); side.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, pan)), now, 0.08);
      const t = ctx.currentTime, flap = 0.75 + 0.25 * Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1); // порыв треплет капюшон
      wind.rumble.g.gain.setTargetAtTime((0.1 + 0.45 * storm * (0.4 + gust)) * flap, t, 0.15); wind.rumble.f.frequency.setTargetAtTime(110 + 160 * gust * storm, t, 0.4);
      wind.flow.forEach((w, k) => { // потоки слева и справа гуляют каждый сам по себе: ветер ходит вокруг головы
        const m = 0.5 + 0.5 * Math.sin(t * (0.23 + 0.11 * k) + k * 2.1);
        w.g.gain.setTargetAtTime((0.05 + 0.28 * storm * gust) * (0.5 + m), t, 0.3); w.f.frequency.setTargetAtTime(320 + 700 * gust * (0.6 + 0.4 * m), t, 0.5);
      });
      wind.howl.g.gain.setTargetAtTime(0.002 + 0.25 * storm * Math.max(0, gust - 0.7) ** 2, t, 0.4); wind.howl.f.frequency.setTargetAtTime(520 + 700 * gust, t, 0.6);
      wind.hiss.g.gain.setTargetAtTime((0.003 + 0.05 * storm * gust) * rnd(0.4, 1.6), t, 0.02); // крупа стучит по капюшону неровно
      rev.gain.setTargetAtTime(0.45 - 0.25 * storm, t, 0.5);
      // Дыхание через балаклаву: вдох выше и тише, короткая пауза, выдох ниже и громче. Выдох начинается вместе с облачком пара.
      const ph = (((phase + 0.5) % 1) + 1) % 1, inh = ph < 0.42 ? Math.sin((Math.PI * ph) / 0.42) : 0, exh = ph >= 0.5 ? Math.sin(Math.PI * (ph - 0.5) * 2) ** 0.7 : 0;
      const loud = (0.5 + 0.5 * effort) * (0.45 * inh ** 1.5 + exh);
      breath[0].g.gain.setTargetAtTime(0.4 * loud, t, 0.03); breath[0].f.frequency.setTargetAtTime(inh > 0 ? 1700 : 650, t, 0.04);
      breath[1].g.gain.setTargetAtTime(0.25 * loud, t, 0.03); breath[1].f.frequency.setTargetAtTime(inh > 0 ? 3100 : 1250, t, 0.04);
    },
    // ледоруб или кошка вошли в склон: 0 снег, 1 лёд, 2 скала; hand: ледоруб, иначе кошка
    hit(kind, hand) {
      if (!on) return;
      if (kind === 0) { // снег: глухой толчок, хруст зёрен; у ледоруба ещё морозный скрип, у кошки щелчок зубьев
        if (hand) { thump(95, 52, 0.3, 0.16); crunch(7, 900, 3200, 0.1, 0.11); burst('bandpass', rnd(4200, 5600), 7, 0.035, 0.01, 0.1, 0.02); }
        else { thump(120, 70, 0.16, 0.1); crunch(5, 1800, 4500, 0.08, 0.07); ring(rnd(5200, 7000), 0.012, 0.05, 0, hitBus); }
      } else if (kind === 1) { // лёд: сухой треск, короткий стеклянный звон, осколки сыплются вниз
        burst('highpass', 3200, 0.7, 0.2, 0.001, 0.04, 0, ringBus); ring(rnd(2400, 3300), 0.06, 0.12); ring(rnd(4100, 5200), 0.03, 0.08);
        for (let i = 0, n = hand ? 5 : 3; i < n; i++) ring(rnd(4500, 9000), 0.022 * (1 - i / n) + 0.006, rnd(0.05, 0.1), rnd(0.05, 0.1) + i * rnd(0.05, 0.09));
      } else { // скала: лязг стали о камень, короткий скрежет, стук
        const f = rnd(1700, 2100);
        for (const [k, peak, d] of [[1, 0.09, 0.2], [1.67, 0.06, 0.14], [2.71, 0.04, 0.09]]) ring(f * k, peak, d);
        burst('bandpass', rnd(2400, 3800), 1.5, 0.12, 0.002, hand ? 0.12 : 0.06, 0, ringBus); thump(210, 150, 0.12, 0.07);
      }
      if (Math.random() < (hand ? 0.7 : 0.4)) jingle(hand ? 3 : 2, 0.014, 0.03); // от рывка звякает железо на поясе
    },
    // Молоток по крюку: сухой щелчок стали, короткий лязг самого крюка, толчок в снег.
    // Лязг собран из тонов железной полосы (они не кратны друг другу, поэтому это стук, а не колокольчик) и гаснет быстро: крюк зажат снегом.
    // Чем глубже вошёл крюк (i: номер удара), тем выше и короче.
    hammer(i) {
      if (!on) return;
      const f = 620 + 75 * i + rnd(0, 30), d = 1 - 0.12 * i;
      burst('bandpass', 3600, 0.9, 0.24, 0.001, 0.022, 0, ringBus);
      for (const [k, peak, dec] of [[1, 0.15, 0.22], [2.76, 0.13, 0.15], [5.4, 0.09, 0.09], [8.93, 0.05, 0.05]]) ring(f * k * rnd(0.99, 1.01), peak, dec * d);
      burst('lowpass', 170, 1, 0.4, 0.003, 0.09);
    },
    // карабин: муфта открылась, верёвка вошла, защёлка хлопнула со звоном
    clip() {
      if (!on) return;
      burst('highpass', 4000, 1, 0.12, 0.001, 0.02, 0, ringBus); burst('highpass', 5200, 1, 0.16, 0.001, 0.018, 0.1, ringBus);
      ring(3250, 0.035, 0.1, 0.1); ring(5380, 0.02, 0.07, 0.1); jingle(2, 0.012, 0.15);
    },
    // лавина: ухнул пласт, потом нарастает рёв и шипение
    avalanche() {
      if (!on) return;
      thump(60, 32, 0.5, 1.2, 0, ringBus);
      burst('lowpass', 110, 0.7, 0.9, 1.5, 9, 0, ringBus); burst('bandpass', 500, 0.5, 0.25, 2.5, 7, 0, ringBus); burst('highpass', 3000, 0.5, 0.05, 3, 6, 0, ringBus);
    },
    // срыв: тело скользит по снегу, железо гремит
    fall() { if (on) { burst('bandpass', 1500, 0.6, 0.3, 0.25, 1.4); burst('lowpass', 260, 0.8, 0.5, 0.2, 1.2); jingle(6, 0.02); jingle(4, 0.016, 0.5); } },
    // верёвка поймала: глухой рывок, скрип обвязки, железо
    jerk() { if (on) { thump(85, 45, 0.45, 0.3); burst('bandpass', 620, 9, 0.08, 0.02, 0.25, 0.03); jingle(6, 0.025, 0.02); } },
    // Реплика альпиниста: случайный дубль ситуации, не тот же, что в прошлый раз. Нет дублей, молчит.
    // gap: сколько секунд должно пройти после прошлой реплики; кряхтение на ударах считается отдельно от слов.
    say(kind, gap = 7, vol = 1) {
      if (WORDS.test(kind)) return; // Лёва 12.11.2026: реплики со словами пока убраны, остаются кряхтение, рывок и крик при срыве. Записи лежат на месте
      const list = voice[kind], key = kind === 'effort' ? kind : 'line', now = performance.now();
      if (!on || !list?.length || now - (said[key] ?? -1e9) < gap * 1000) return;
      said[key] = now;
      let k = Math.floor(Math.random() * list.length);
      if (list.length > 1 && k === said[kind]) k = (k + 1) % list.length;
      said[kind] = k;
      list[k].then((buf) => {
        if (!buf || !on) return;
        // Голос один: пока звучит реплика, новая молчит. Срочное (срыв, рывок верёвки, обвал: gap 0) обрывает текущую и звучит само.
        if (ctx.currentTime < talkEnd) { if (gap > 0) return; talk.stop(); }
        const s = ctx.createBufferSource(), g = ctx.createGain(), rate = rnd(0.97, 1.03);
        s.buffer = buf; s.playbackRate.value = rate; g.gain.value = vol; s.connect(g).connect(voiceBus); s.start(); // чуть разная высота: одна и та же реплика не звучит записью
        talk = s; talkEnd = ctx.currentTime + buf.duration / rate;
      });
    },
    knock() { // камень ударился о склон; не чаще двадцати раз в секунду
      if (!on || ctx.currentTime - lastKnock < 0.05) return;
      lastKnock = ctx.currentTime;
      burst('lowpass', 420, 2, 0.2, 0.002, 0.07, 0, ringBus); ring(rnd(160, 280), 0.08, 0.06);
    },
  };
}
