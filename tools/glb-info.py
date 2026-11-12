# Что лежит в glb: кости, сетки, текстуры. Запуск: python3 -I tools/glb-info.py файл.glb
import json, struct, sys
b = open(sys.argv[1], 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); nodes = j['nodes']
print('bytes', len(b), 'ext', j.get('extensionsUsed'), 'anims', [(a.get('name'), len(a['channels'])) for a in j.get('animations', [])])
par = {c: i for i, nd in enumerate(nodes) for c in nd.get('children', [])}
for s in j.get('skins', []):
    print('skin joints', len(s['joints']))
    for i in s['joints']:
        nd = nodes[i]; print('  ', nd.get('name'), '<-', nodes[par[i]].get('name') if i in par else None, 't', [round(x, 3) for x in nd.get('translation', [0, 0, 0])], 'r', [round(x, 3) for x in nd.get('rotation', [0, 0, 0, 1])], 's', [round(x, 3) for x in nd.get('scale', [1, 1, 1])])
for i, nd in enumerate(nodes):
    if 'mesh' in nd or i not in par: print('node', nd.get('name'), 'mesh' in nd, 'skin' in nd, 't', nd.get('translation'), 'r', nd.get('rotation'), 's', nd.get('scale'), 'parent', nodes[par[i]].get('name') if i in par else None)
acc = j['accessors']
for m in j['meshes']:
    for p in m['primitives']:
        a = p['attributes']; print('mesh', m.get('name'), 'attrs', list(a), 'verts', acc[a['POSITION']]['count'], 'tris', acc[p['indices']]['count'] // 3, 'min', [round(x, 3) for x in acc[a['POSITION']]['min']], 'max', [round(x, 3) for x in acc[a['POSITION']]['max']], 'mat', p.get('material'))
for m in j.get('materials', []): print('mat', json.dumps(m)[:400])
for im in j.get('images', []): bv = j['bufferViews'][im['bufferView']] if 'bufferView' in im else {}; print('image', im.get('name'), im.get('mimeType'), bv.get('byteLength'))
