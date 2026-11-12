import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { mkdir } from 'node:fs/promises';
import { add, remove, index } from './tools/voice.mjs';

// Запись реплик работает только в dev: страница record.html шлёт сюда дубль, сервер чистит его и кладёт в public/voice.
const voice = () => ({
  name: 'voice',
  configureServer(server) {
    // Съёмка ролика (только dev): tools/shoot.js шлёт сюда кадры и звук, сервер кладёт их в shots/reel. В сборку и в репозиторий shots/ не попадает.
    server.middlewares.use('/api/shot', async (req, res) => {
      const name = new URL(req.url, 'http://x').searchParams.get('name') ?? '';
      if (req.method !== 'POST' || !/^[a-z0-9-]{1,40}\.(jpg|wav)$/.test(name)) { res.statusCode = 400; return res.end(); }
      await mkdir(new URL('./shots/reel/', import.meta.url), { recursive: true });
      await pipeline(req, createWriteStream(new URL('./shots/reel/' + name, import.meta.url)));
      res.end('ok');
    });
    server.middlewares.use('/api/voice', async (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
      try {
        if (req.method === 'POST') {
          const kind = q.get('kind') ?? '', chunks = [];
          if (!/^[a-z]{2,12}$/.test(kind)) return send(400, { error: 'kind' });
          let size = 0;
          for await (const c of req) { if ((size += c.length) > 8e6) return send(413, { error: 'big' }); chunks.push(c); }
          const files = await add(kind, Buffer.concat(chunks), /mp4|aac/.test(req.headers['content-type'] ?? '') ? 'm4a' : 'webm');
          return files.length ? send(200, { file: files[0], takes: await index() }) : send(422, { error: 'silence' });
        }
        if (req.method === 'DELETE') {
          const file = q.get('file') ?? '';
          if (!/^[a-z]{2,12}-\d+\.mp3$/.test(file)) return send(400, { error: 'file' });
          await remove(file);
        }
        send(200, { takes: await index() });
      } catch (e) { send(500, { error: String(e?.message ?? e) }); }
    });
  },
});

// public/voice из слежения не убирать: сервер узнаёт о новых файлах только от него, иначе вместо дубля отдаёт index.html
export default { plugins: [voice()] };
