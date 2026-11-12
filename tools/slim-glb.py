# Облегчает модель от Meshy для сайта: убирает анимации и карту блеска, картинки PNG пережимает в JPEG.
# Сетка, кости и веса остаются байт в байт. Запуск: python3 -I tools/slim-glb.py ref/meshy/climber-meshy.glb public/models/climber2.glb
import json, struct, subprocess, sys, tempfile, os

src, out = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
n = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + n])
bin_ = b[20 + n + 8:]
views = j['bufferViews']
chunk = lambda v: bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]

def jpeg(png, q):  # sips есть в любой macOS
    with tempfile.TemporaryDirectory() as d:
        a, c = os.path.join(d, 'a.png'), os.path.join(d, 'a.jpg')
        open(a, 'wb').write(png)
        subprocess.run(['/usr/bin/sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', str(q), a, '--out', c], check=True, capture_output=True)
        return open(c, 'rb').read()

mat = j['materials'][0]
pbr = mat['pbrMetallicRoughness']
pbr.pop('metallicRoughnessTexture', None)
keep_tex = [pbr['baseColorTexture']['index'], mat['normalTexture']['index']]  # цвет и рельеф
images = [jpeg(chunk(views[j['images'][j['textures'][t]['source']]['bufferView']]), q) for t, q in zip(keep_tex, (88, 92))]
pbr['baseColorTexture']['index'], mat['normalTexture']['index'] = 0, 1

used = []  # номера нужных аксессоров в порядке первого упоминания
def acc(i):
    if i not in used: used.append(i)
    return used.index(i)
for m in j['meshes']:
    for p in m['primitives']:
        p['attributes'] = {k: acc(v) for k, v in p['attributes'].items()}
        p['indices'] = acc(p['indices'])
for s in j.get('skins', []): s['inverseBindMatrices'] = acc(s['inverseBindMatrices'])

blob, new_views, seen = bytearray(), [], {}
def put(data, extra=None):
    while len(blob) % 4: blob.append(0)
    new_views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), **(extra or {})})
    blob.extend(data)
    return len(new_views) - 1
accessors = []
for i in used:
    a = dict(j['accessors'][i]); v = views[a['bufferView']]
    if a['bufferView'] not in seen: seen[a['bufferView']] = put(chunk(v), {k: v[k] for k in ('byteStride', 'target') if k in v})
    a['bufferView'] = seen[a['bufferView']]; accessors.append(a)
j['accessors'] = accessors
j['images'] = [{'bufferView': put(d), 'mimeType': 'image/jpeg'} for d in images]
j['textures'] = [{'source': 0, 'sampler': 0}, {'source': 1, 'sampler': 0}]
j['samplers'] = j.get('samplers', [{}])[:1]
j.pop('animations', None)
while len(blob) % 4: blob.append(0)
j['bufferViews'] = new_views
j['buffers'] = [{'byteLength': len(blob)}]
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
open(out, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(blob)) + b'BIN\0' + bytes(blob))
print(out, os.path.getsize(out), 'bytes; images', [len(d) for d in images])
