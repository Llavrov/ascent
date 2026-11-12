// Реплики альпиниста: как записанный дубль режется, чистится и попадает в сцену.
// Сырые дубли лежат в voice-raw, готовые mp3 и их список index.json в public/voice.
// Поменял обработку: `node tools/voice.mjs` пересоберёт все реплики из сырых дублей заново (удалённые по одной тоже вернутся).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'voice-raw'), OUT = path.join(ROOT, 'public/voice');
// сервер, запущенный из приложения, не знает пути к brew
const bin = (name) => ['/opt/homebrew/bin', '/usr/local/bin'].map((d) => path.join(d, name)).find(existsSync) ?? name;
// Из одного дубля выходит одна или несколько реплик: первая носит его номер N, остальные 100N+1, 100N+2...
const num = (f) => parseInt(f.split('-')[1]), takeOf = (f) => (num(f) >= 100 ? Math.floor(num(f) / 100) : num(f));

// Где в записи звук. Возвращает группы кусков [{ s, e }] в секундах: каждая группа станет отдельной репликой.
// Громкость меряем окнами по 20 мс от самого громкого окна; порог стоит над шумом комнаты, поэтому шёпот и крик режутся одинаково.
const SR = 16000, WIN = 320;
export async function cut(raw, each = false) { // each: каждый звук отдельной репликой (кряхтение), иначе фразу держим целой
  const { stdout } = await run(bin('ffmpeg'), ['-v', 'error', '-i', raw, '-af', 'highpass=f=80', '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { encoding: 'buffer', maxBuffer: 1 << 28 });
  const a = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + (stdout.byteLength & ~3))), n = Math.floor(a.length / WIN), total = a.length / SR;
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < WIN; k++) s += a[i * WIN + k] ** 2; db[i] = 10 * Math.log10(s / WIN + 1e-12); }
  const top = db.reduce((m, x) => Math.max(m, x), -200), floor = [...db].sort((x, y) => x - y)[Math.floor(n * 0.1)], thr = Math.max(floor + 10, top - 32);
  if (!(top > -50)) return [];
  const merge = (list, gap) => list.reduce((out, r) => { const last = out.at(-1); if (last && r.s - last.e < gap) { last.e = r.e; last.pk = Math.max(last.pk, r.pk); } else out.push({ ...r }); return out; }, []);
  let runs = [];
  for (let i = 0; i < n; i++) if (db[i] > thr) runs.push({ s: i * 0.02, e: i * 0.02 + 0.02, pk: db[i] });
  // Сначала убираем короткое у самого края записи: это щелчок пробела. Потом склеиваем слова (пауза короче 0.35 с слово не рвёт)
  // и выкидываем короткое и тихое посреди записи: вдох или чмок.
  runs = merge(runs, 0.12).filter((r) => !(r.e - r.s < 0.3 && (r.s < 0.3 || r.e > total - 0.5)));
  const keep = merge(runs, 0.35).filter((r) => r.e - r.s >= 0.1 && !(r.e - r.s < 0.25 && r.pk < top - 15));
  // Слово начинается и гаснет тише порога: от найденного куска идём в обе стороны, пока звук заметно выше шума комнаты.
  const low = Math.min(thr, floor + 4), at = (t) => db[Math.min(n - 1, Math.max(0, Math.round(t / 0.02)))];
  keep.forEach((r, i) => {
    const from = i ? (keep[i - 1].e + r.s) / 2 : 0, to = i + 1 < keep.length ? (r.e + keep[i + 1].s) / 2 : total, s0 = r.s, e0 = r.e;
    while (r.s - 0.02 >= from && s0 - r.s < 0.3 && at(r.s - 0.02) > low) r.s -= 0.02;
    while (r.e + 0.02 <= to && r.e - e0 < 0.4 && at(r.e) > low) r.e += 0.02;
  });
  const groups = [], alone = (gap) => each || gap > 1.2; // пауза длиннее 1.2 с: это уже следующая попытка, а не продолжение фразы
  keep.forEach((r, i) => {
    const gapL = i ? r.s - keep[i - 1].e : Infinity, gapR = i + 1 < keep.length ? keep[i + 1].s - r.e : Infinity;
    // Внутри фразы паузу ужимаем до 0.45 с: от неё остаётся хвост первого куска и начало второго. По краям реплики запас поменьше.
    const piece = { s: Math.max(0, r.s - (alone(gapL) ? 0.06 : Math.min(gapL * 0.4, 0.18))), e: Math.min(total, r.e + (alone(gapR) ? 0.14 : Math.min(gapR * 0.6, 0.27))) };
    if (alone(gapL)) groups.push([piece]); else groups.at(-1).push(piece);
  });
  return groups;
}

// Собирает реплику из кусков записи и прячет в ней комнату и чтение по бумажке. Голос ниже (другой человек, крупнее и уставший),
// фразы чуть медленнее и с дрожью от холода, поверх шум дыхания по громкости голоса, хрипотца от перегруза, полоса «через бафф на лице».
// pitch: во сколько раз ниже; speed: темп; shake: дрожь; breath: доля шума дыхания; drive: перегруз в дБ; lo, hi: полоса в герцах.
const LOOK = {
  grunt: { pitch: 0.9, speed: 1, shake: false, breath: 1.2, drive: 6, lo: 150, hi: 3000 }, // кряхтение и рывок
  line: { pitch: 0.88, speed: 0.93, shake: true, breath: 1, drive: 6, lo: 200, hi: 3000 }, // слова
  shout: { pitch: 0.92, speed: 1, shake: false, breath: 0.7, drive: 10, lo: 250, hi: 3200 }, // крик
};
const lookOf = (kind) => LOOK[kind === 'effort' || kind === 'jerk' ? 'grunt' : kind === 'fall' || kind === 'brace' ? 'shout' : 'line'];
const NOISE = ['-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=1:sample_rate=48000:duration=40'], FMT = 'aformat=sample_fmts=fltp:channel_layouts=mono';
async function render(raw, group, out, kind) {
  const k = lookOf(kind);
  const parts = group.map((p, i) => `[0:a]atrim=start=${p.s.toFixed(3)}:end=${p.e.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, p.e - p.s - 0.03).toFixed(3)}:d=0.03[p${i}]`).join(';');
  const voice = `${parts};${group.map((_, i) => `[p${i}]`).join('')}concat=n=${group.length}:v=0:a=1,aresample=48000,highpass=f=90,afftdn=nr=12:nf=-45,`
    + `asetrate=48000*${k.pitch},aresample=48000,atempo=${(k.speed / k.pitch).toFixed(4)},${k.shake ? 'vibrato=f=5.5:d=0.05,tremolo=f=6.3:d=0.12,' : ''}acompressor=threshold=-22dB:ratio=4:attack=4:release=70`;
  const { stderr } = await run(bin('ffmpeg'), ['-hide_banner', '-nostats', '-i', raw, '-filter_complex', `${voice},astats`, '-f', 'null', '-']);
  const peak = parseFloat([...stderr.matchAll(/Peak level dB: (-?[\d.]+)/g)].pop()?.[1]); // последняя строка: общий итог
  if (!(peak > -60)) return false;
  // Пик ставим на -1 дБ, чтобы перегруз у всех дублей был одинаковый. Шум дыхания: белый шум, умноженный на огибающую голоса.
  const graph = `${voice},volume=${(-1 - peak).toFixed(1)}dB,${FMT},asplit[a][b];[b]aeval=abs(val(0)),lowpass=f=28,${FMT}[env];[1:a]highpass=f=1500,lowpass=f=5200,${FMT}[nz];[nz][env]amultiply[br];`
    + `[a][br]amix=inputs=2:weights=1 ${k.breath}:normalize=0:duration=first,volume=${k.drive}dB,asoftclip=type=tanh:oversample=2,highpass=f=${k.lo},lowpass=f=${k.hi},equalizer=f=1100:t=q:w=1.2:g=3,alimiter=limit=0.7:level=0:attack=3:release=40`;
  await run(bin('ffmpeg'), ['-hide_banner', '-y', '-i', raw, ...NOISE, '-filter_complex', graph, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '3', out]);
  return true;
}

// Дубль kind-N целиком: режет и пишет реплики в dir. Возвращает их имена; пусто, если в записи тишина.
export async function clean(raw, dir, kind, n) {
  const files = [];
  for (const [i, group] of (await cut(raw, kind === 'effort' || kind === 'jerk')).entries()) {
    const f = `${kind}-${i ? n * 100 + i : n}.mp3`;
    if (await render(raw, group, path.join(dir, f), kind)) files.push(f);
  }
  return files;
}

// Список готовых реплик по ситуациям: { fall: ['fall-1.mp3', ...] }. Его читает и страница записи, и сцена.
export async function index() {
  const takes = {}, order = (f) => takeOf(f) * 100 + (num(f) >= 100 ? num(f) % 100 : 0);
  for (const f of (await fs.readdir(OUT)).filter((f) => /^[a-z]+-\d+\.mp3$/.test(f)).sort((a, b) => order(a) - order(b))) (takes[f.split('-')[0]] ??= []).push(f);
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(takes));
  return takes;
}

// Новый дубль со страницы записи. Возвращает имена получившихся реплик; пусто, если в записи тишина.
export async function add(kind, bytes, ext) {
  await fs.mkdir(RAW, { recursive: true });
  const n = 1 + Math.max(0, ...[...(await fs.readdir(RAW)), ...(await fs.readdir(OUT))].filter((f) => f.startsWith(kind + '-')).map(takeOf).filter(Number.isFinite));
  const raw = path.join(RAW, `${kind}-${n}.${ext}`);
  await fs.writeFile(raw, bytes);
  const files = await clean(raw, OUT, kind, n);
  if (!files.length) await fs.rm(raw);
  return files;
}

// Удаляет одну реплику; сырой дубль уходит вместе с последней репликой из него.
export async function remove(file) {
  await fs.rm(path.join(OUT, file), { force: true });
  const kind = file.split('-')[0], n = takeOf(file);
  if ((await fs.readdir(OUT)).some((f) => f.startsWith(kind + '-') && f.endsWith('.mp3') && takeOf(f) === n)) return;
  for (const f of existsSync(RAW) ? await fs.readdir(RAW) : []) if (f.startsWith(`${kind}-${n}.`)) await fs.rm(path.join(RAW, f));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const f of await fs.readdir(OUT)) if (/^[a-z]+-\d+\.mp3$/.test(f)) await fs.rm(path.join(OUT, f));
  for (const f of (await fs.readdir(RAW)).sort()) console.log(f, '->', (await clean(path.join(RAW, f), OUT, f.split('-')[0], num(f))).join(' ') || 'тишина');
  await index();
}
