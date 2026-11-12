import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clean } from '../tools/voice.mjs';

const ff = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(existsSync) ?? 'ffmpeg';
const dir = mkdtempSync(path.join(os.tmpdir(), 'voice-'));
const probe = (f, re) => parseFloat(re.exec(spawnSync(ff, ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-']).stderr.toString())[1]); // ffmpeg пишет сводку в stderr
const sec = (f) => probe(path.join(dir, f), /Duration: 00:00:0?([\d.]+)/);
// запись: шум комнаты на всю длину, щелчок пробела в начале и тихие звуки по 0.4 с в заданные моменты (мс)
const take = (name, len, at) => {
  const raw = path.join(dir, name + '.wav'), ins = at.flatMap(() => ['-f', 'lavfi', '-i', 'sine=f=220:d=0.4']);
  const mix = at.map((ms, i) => `[${i + 2}]volume=0.1,adelay=${ms}[s${i}]`).join(';') + `;[1]volume=0.3,adelay=40[c];[0][c]${at.map((_, i) => `[s${i}]`).join('')}amix=inputs=${at.length + 2}:normalize=0`;
  execFileSync(ff, ['-y', '-f', 'lavfi', '-i', `anoisesrc=d=${len}:c=pink:a=0.004`, '-f', 'lavfi', '-i', 'sine=f=3000:d=0.03', ...ins, '-filter_complex', mix, raw], { stdio: 'ignore' });
  return raw;
};

test('дубль: тишина и щелчок пробела срезаны, громкость поднята', async () => {
  const files = await clean(take('one', 1.6, [500]), dir, 'hard', 1);
  assert.deepEqual(files, ['hard-1.mp3']);
  assert.ok(sec('hard-1.mp3') > 0.38 && sec('hard-1.mp3') < 0.8, `длина ${sec('hard-1.mp3')}`);
  const peak = probe(path.join(dir, 'hard-1.mp3'), /max_volume: (-?[\d.]+) dB/);
  assert.ok(peak > -6 && peak <= 0, `пик ${peak}`);
});

test('дубль: фраза с паузой остаётся одной репликой, пауза ужата', async () => {
  const files = await clean(take('phrase', 2.6, [400, 1700]), dir, 'lost', 2);
  assert.deepEqual(files, ['lost-2.mp3']);
  assert.ok(sec('lost-2.mp3') > 1.1 && sec('lost-2.mp3') < 1.75, `длина ${sec('lost-2.mp3')}`); // два звука по 0.4 и пауза до 0.45 вместо 0.9, фразы на 7% медленнее
});

test('дубль: кряхтение режется на отдельные реплики, как и две попытки подряд', async () => {
  assert.deepEqual(await clean(take('grunts', 2.6, [400, 1700]), dir, 'effort', 3), ['effort-3.mp3', 'effort-301.mp3']);
  assert.deepEqual(await clean(take('twice', 4, [400, 2600]), dir, 'go', 4), ['go-4.mp3', 'go-401.mp3']);
});

test('дубль: пустая запись не сохраняется', async () => {
  const raw = path.join(dir, 'silent.wav');
  execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', raw], { stdio: 'ignore' });
  assert.deepEqual(await clean(raw, dir, 'fall', 5), []);
  assert.equal(existsSync(path.join(dir, 'fall-5.mp3')), false);
});
