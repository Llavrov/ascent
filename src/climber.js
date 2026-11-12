import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { height, routeX, normalAt, sAt, zAt, ground, START_Z } from './world.js';
import { COMMON } from './glsl.js';
import { helmet, fitted, rack, mitten, axe } from './gear.js';

const MOVE = 0.56, SPEED = 0.15, STRIDE = 0.6; // секунд на перенос конечности, м/с, метров пути на один цикл шагов. На 0.25 м/с он бежал на четвереньках: на высоте в пургу так не ходят
// Порядок переноса за цикл: ледоруб, две ноги, второй ледоруб, снова две ноги. Ледоруб уходит на 0.6 м, нога шагает по 0.3:
// шаг в 0.6 длиннее, чем пускает нога, таз утягивало к дальней ступне, и вторая нога задиралась коленом к груди и вбок.
const SEQ = [0, 1, 3, 2, 1, 3];
const GRIP = 0.075, HOLD = 0.055; // середина хвата от низа рукояти; от запястья до середины кулака
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const _a = V(), _b = V(), _d = V(), _p = V(), _n = V(), _h = V(), _t = V(), _s = V(), _q = V(), _j = V(), _e = V(), _hinge = V();
const _bf = V(), _bu = V(), _toe = V(), _sh = V(), _u0 = V(), _um = V(), _uh = V(), _v0 = V(), _vA = V(), _vm = V(), _vh = V(), _w0 = V(), _w1 = V(), _w2 = V();
const _x = V(), _y = V(), _z = V(), _m = new THREE.Matrix4(), _pq = Q(), _fq = Q(), _one = V().set(1, 1, 1);

// Один материал на всё освещаемое: тело со скелетом, снаряжение, камни обвала.
const VS = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vW, vN, vCol, vRest, vRN; varying float vAlong, vPart, vHead, vGloss, vCav; varying vec2 vUv;
uniform vec3 uColor; uniform float uGloss;
#ifdef SOFT
uniform vec3 uCapA[4], uCapB[4]; uniform float uCapR[4]; uniform vec4 uCapOn; // руки и ноги как толстые отрезки: плечо-локоть, таз-колено, толщина; какие из них касаются этой детали
#endif
#ifdef KIT
attribute vec4 aCol; // цвет и блеск каждой детали снаряжения
#endif
#ifdef FACE
uniform vec3 uEye; uniform float uSquint, uGrim; // центр глаза относительно центра черепа; прищур; стиснутые зубы
#endif
#ifdef BUFF
attribute float aCav; // насколько точка лица утоплена в складку: там кожа темнее
#endif
#ifdef BODY
attribute vec3 aSuit; // x: высота точки в исходной позе, по ней идёт стёжка; y: 1 для кистей и ботинок; z: доля головы 0..1
attribute vec3 aPuff; // куда раздувать: нормаль, общая для всех точек в этом месте
#endif
void main(){
  vec3 objectNormal = normal, transformed = position;
  vCol = uColor; vAlong = 0.; vPart = 0.; vHead = 0.; vUv = uv; vRest = position; vRN = normal; vGloss = uGloss; vCav = 1.; // исходная поза: по ней лежит наледь
  #ifdef KIT
    vCol = aCol.rgb; vGloss = aCol.a;
  #endif
  #ifdef QUILT
    vAlong = position.y * 2.; // у капюшона отсеки вдвое мельче
  #endif
  #ifdef BODY
    vAlong = aSuit.x; vPart = max(aSuit.y, aSuit.z); vHead = aSuit.z;
    transformed = mix(transformed, vec3(0., 1.46, 0.), aSuit.z); // простую голову модели прячем в ворот: вместо неё ставится подробная
    vCol = mix(uColor, vec3(.03, .033, .04), vPart);
    // раздуваем худую городскую фигуру до пуховика, кисти до рукавиц; голова уходит под каску почти как есть
    transformed += aPuff * mix(mix(.05, .04, aSuit.y), .006, aSuit.z); // к голове надув плавно сходит на нет: резкий перепад рвал шею в лоскуты
    objectNormal = normalize(aPuff); // свет считаем по общей нормали точек шва: по своим нормалям половинки шва у рукава светились по-разному, шов был виден как ребро
  #endif
  #ifdef BUFF
    vCav = aCav;
  #endif
  #ifdef HOOD
    transformed += normal * .0045; // балаклава: та же голова, но толще на слой ткани
  #endif
  #ifdef FACE
    // Замёрзшее выражение: веки сходятся в прищур (и чуть выходят вперёд, чтобы не резать глаз), брови опущены и сведены.
    vec2 de = position.xy - vec2(sign(position.x) * uEye.x, uEye.y);
    float front = step(uEye.z - .035, position.z), lid = smoothstep(.034, .008, length(de * vec2(.75, 1.))) * front;
    transformed.y -= de.y * lid * .3 * uSquint; transformed.z += lid * .004 * uSquint;
    float brow = smoothstep(.012, .03, de.y) * smoothstep(.06, .035, de.y) * smoothstep(.07, .02, abs(position.x)) * front;
    float bk = min(uSquint, 1.2); // моргание бровей не двигает
    transformed.y -= brow * .007 * bk; transformed.x -= sign(position.x) * brow * .004 * bk;
    // Стиснутые зубы: углы рта уходят назад и вниз, верхняя губа поджата, щёки подпирают нижние веки.
    float corner = smoothstep(.03, .004, length(vec2(abs(position.x) - .026, position.y + .098))) * front;
    transformed.x += sign(position.x) * corner * .0045 * uGrim; transformed.y -= corner * .004 * uGrim; transformed.z -= corner * .003 * uGrim;
    transformed.y += smoothstep(.035, .01, length(vec2(abs(position.x) - .04, position.y + .058))) * front * .004 * uGrim;
    transformed.y += smoothstep(.02, .004, length(vec2(position.x * .6, position.y + .088))) * front * .0015 * uGrim;
  #endif
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #endif
  vec4 w = m * vec4(transformed, 1.);
  #ifdef SOFT
    // Ремень не тонет в рукаве и в бедре. Поднятая рука наезжает на лямку, поднятая нога на пояс:
    // точку ремня, попавшую внутрь руки или ноги, выталкиваем на её поверхность.
    for (int i = 0; i < 4; i++) {
      vec3 ab = uCapB[i] - uCapA[i], c = uCapA[i] + ab * clamp(dot(w.xyz - uCapA[i], ab) / max(dot(ab, ab), 1e-6), 0., 1.), d = w.xyz - c;
      float l = length(d), r = uCapR[i] * uCapOn[i];
      if (l < r) w.xyz = c + d / max(l, 1e-4) * r;
    }
  #endif
  vW = w.xyz; vN = normalize(mat3(m) * objectNormal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FS = /* glsl */ `
${COMMON}
varying vec3 vW, vN, vCol, vRest, vRN; varying float vAlong, vPart, vHead, vGloss, vCav; varying vec2 vUv; uniform float uDust; uniform vec3 uSkyZen;
#if defined(FACE) || defined(EYE)
uniform vec3 uEye, uLampDir; uniform float uLampI;
#endif
// вырез балаклавы: овал от бровей до подбородка, на краю 1
float hole(vec3 p){ vec2 q = abs(p.xy - vec2(0., -.062)) / vec2(.064, .066); return pow(q.x * q.x * q.x + q.y * q.y * q.y, 1. / 3.); }
// Рельеф без карты нормалей: нормаль наклоняется туда, куда убывает высота hgt. Наклон ограничен, иначе на резких перепадах он рассыпается в точки.
vec3 relief(vec3 N, float hgt, float lim){
  vec3 dpx = dFdx(vW), dpy = dFdy(vW), r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 gb = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
  return normalize(abs(det) * N - gb * min(1., lim / max(length(gb) / max(abs(det), 1e-9), 1e-4)));
}
#ifdef USE_MAP
uniform sampler2D map; // родная текстура модели: по ней рисуется лицо
#endif
#ifdef NMAP
uniform sampler2D nmap; // карта рельефа тела от Meshy: стёжка и складки, снятые с подробной сетки
uniform sampler2D tMirror; uniform mat4 uMirrorM; uniform float uMirror; // отражение в очках: снимок сцены от лица (main.js)
// нормаль из карты в мир: оси развёртки берём из производных по экрану, касательные в модели не нужны
vec3 bent(vec3 N, vec3 p, vec2 uv){
  vec3 t = texture2D(nmap, uv).xyz * 2. - 1., q0 = dFdx(p), q1 = dFdy(p), a = cross(q1, N), b = cross(N, q0);
  vec2 s0 = dFdx(uv), s1 = dFdy(uv);
  vec3 T = a * s0.x + b * s1.x, B = a * s0.y + b * s1.y;
  float k = max(dot(T, T), dot(B, B));
  return k > 0. ? normalize((T * t.x + B * t.y) * inversesqrt(k) + N * t.z) : N;
}
#endif
#ifdef BUFF
uniform sampler2D faceMap; // подробная кожа лица (tools/face): тот же кусок развёртки, но вчетверо крупнее и с порами, морщинами, щетиной
#endif
void main(){
  vec3 base = mix(vCol, vec3(.035, .036, .045), smoothstep(.35, .65, vHead)); // шея под тёмным воротом
  float skinGloss = 0., skinH = 0., eyeSpark = 0., boot = 0.;
  #ifdef BODY
    // Пуховик целиком красный, как высотные костюмы. Тёмное только там, где трётся: низ штанин под кошки и манжеты
    // под рукавицы. Молния по центру, молнии нагрудных карманов, жёлтый рант ботинок, зерно ткани.
    float suit = 1. - vPart, ax = abs(vRest.x);
    float pads = max(smoothstep(.2, .185, vRest.y), smoothstep(.875, .86, vRest.y) * step(.17, ax));
    float zip = max(smoothstep(.009, .005, ax) * step(.98, vRest.y), smoothstep(.006, .003, abs(ax - .05)) * step(1.14, vRest.y) * step(vRest.y, 1.27)) * step(.06, vRest.z);
    base = mix(base, vec3(.03, .033, .04), max(pads, zip) * suit);
    // Высотный ботинок с вшитой гамашей: всё ниже 27 см чёрное с чёткой верхней кромкой, по ней жёлтый кант, над подошвой жёлтый рант.
    // Раньше тёмное шло от костей стопы и растекалось по треугольникам голени пятнами, как подтёки краски.
    float ay = fwidth(vRest.y) + 1e-4;
    boot = smoothstep(.27 + ay, .27 - ay, vRest.y);
    base = mix(base, vec3(.032, .034, .042), boot);
    base = mix(base, vec3(.7, .54, .04), boot * max(smoothstep(.258 - ay, .258 + ay, vRest.y), smoothstep(.014 - ay, .014 + ay, vRest.y) * smoothstep(.052 + ay, .052 - ay, vRest.y)));
    base = mix(base, vec3(.015), smoothstep(.014 + ay, .014 - ay, vRest.y)); // подошва
    base *= .93 + .14 * vnoise(vRest.xy * 260. + vRest.z * 190.);
  #endif
  #ifdef USE_MAP
    vec4 tx = texture2D(map, vUv);
    if (tx.a < .4) discard; // ресницы и брови вырезаны прозрачностью
    base = tx.rgb;
    #ifdef FROST
      // брови и ресницы тёмные, на волосках иней
      base = mix(base * .5, vec3(.88, .93, .98), smoothstep(.5, .75, fbm(vRest.xy * 500.)) * mix(.5, .85, uDust));
    #endif
    #ifdef EYE
      // Глаз рисуем сами: родная текстура тёмная, в щели век она сливалась в серое пятно. Белок с красными от ветра углами,
      // серо-голубая радужка с волокнами и тёмным ободком, зрачок, блик неба.
      vec3 ed = normalize(vRest - vec3(sign(vRest.x) * uEye.x, uEye.yz));
      float er = length(ed.xy);
      vec3 iris = mix(vec3(.1, .15, .2), vec3(.34, .46, .55), vnoise(vec2(atan(ed.y, ed.x) * 9., er * 26.))) * (1. - .65 * smoothstep(.27, .39, er));
      base = mix(vec3(.8, .76, .74) - vec3(0., .16, .16) * smoothstep(.45, 1., er), iris, smoothstep(.41, .37, er)) * (.05 + .95 * smoothstep(.11, .15, er));
      base *= mix(.5, 1., smoothstep(uEye.y + .012, uEye.y - .002, vRest.y)); // тень от верхнего века
      eyeSpark = smoothstep(.075, .03, length(ed.xy - vec2(.13, .15)));
    #endif
    #ifdef BUFF
      // Кожа на морозе. Лицо берётся из подробной текстуры: на родной развёртке оно занимает квадрат 430 точек и вблизи было гладким, как воск.
      // Остальная голова (под балаклавой) остаётся на родной текстуре.
      vec2 fuv = (vUv - vec2(.77197, .41211)) / .20996;
      vec3 skin = texture2D(faceMap, fuv).rgb;
      skin = mix(skin, vec3(dot(skin, vec3(.3, .6, .1))), .14) * .95; // на солнце чистая текстура уходила в оранжевый
      float inFace = smoothstep(0., .04, min(min(fuv.x, 1. - fuv.x), min(fuv.y, 1. - fuv.y)));
      float hl = hole(vRest), fine = smoothstep(.0035, .0008, fwidth(vRest.y));
      base = mix(pow(base, vec3(1.3)) * 1.1, skin, inFace) * mix(1., vCav, .75);
      base *= mix(.55, 1., smoothstep(1., .82, hl)); // тень от края балаклавы
      // нос и скулы краснее в пургу: в текстуре румянец уже есть, это добавка от мороза
      float red = max(smoothstep(.04, .012, length(vRest - vec3(0., -.064, .118))), .8 * smoothstep(.034, .01, length(vec3(abs(vRest.x), vRest.yz) - vec3(.046, -.056, .09))));
      base = mix(base, base * vec3(1.3, .7, .68), red * .35);
      float lips = smoothstep(1., .55, length((vRest.xy - vec2(0., -.098)) / vec2(.028, .0115))) * step(.09, vRest.z);
      float beard = smoothstep(-.066, -.084, vRest.y) * (1. - lips) * smoothstep(.02, .06, vRest.z);
      // Иней от дыхания на щетине: мелкие кристаллы у рта и под носом, дальше по щекам его нет. Шум идёт по развёртке лица:
      // по координатам головы на щеках, где поверхность уходит вбок, иней вытягивался в полосы.
      float br = smoothstep(.06, .015, length((vRest.xy - vec2(0., -.1)) * vec2(.8, 1.)));
      float ice = beard * smoothstep(.65 - .2 * br, .85 - .2 * br, fbm(vUv * 300.)) * smoothstep(0., .25, br); // щетина и мелкий иней уже есть в текстуре, это намёрзшие комья
      base = mix(base, vec3(.88, .93, .99), ice * .75);
      skinGloss = .14 + .2 * lips + .5 * ice + .12 * red;
      skinH = ice * .0012 + inFace * fine * dot(texture2D(faceMap, fuv, 1.5).rgb, vec3(.3, .6, .1)) * .0007; // рельеф льда и самой кожи: тёмное в текстуре (морщины, щетина) чуть утоплено; берём сглаженную текстуру, иначе зерно
    #endif
  #endif
  #ifdef HOOD
    float hl = hole(vRest);
    if (hl < 1. && vRest.z > .03) discard; // вырез для лица
    base = vCol * (.7 + .6 * vnoise(vRest.xy * vec2(1500., 500.) + vRest.z * 700.)) * mix(1.5, 1., smoothstep(1., 1.09, hl)); // вязка; кромка выреза обмётана
    // иней от дыхания намерзает на ткани: гуще всего под ртом и по нижнему краю выреза
    float br = smoothstep(.12, .03, length(vRest.xy - vec2(0., -.115))) * step(.03, vRest.z);
    float rime = smoothstep(.62 - .26 * br, .82 - .26 * br, fbm(vUv * 210.));
    base = mix(base, vec3(.86, .91, .97), rime * (.3 + .65 * br));
    skinGloss = .35 * rime;
  #endif
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  #ifdef NMAP
    N = bent(N, vW, vUv);
  #endif
  float seam = smoothstep(.55, 1., -sin(vAlong * 70.)) * (1. - vPart) * (1. - boot) * step(.001, vAlong); // швы пуховика каждые 9 см; гамаша гладкая
  #if defined(BODY) || defined(QUILT)
    // Пуховые отсеки настоящим рельефом: между швами ткань вздута подушкой, по ней мелкие складки. Вдали рельеф гаснет, иначе рябит.
    float qk = (1. - vPart) * (1. - boot) * step(.001, vAlong) * smoothstep(.03, .008, fwidth(vAlong));
    float hgt = qk * (.02 * sqrt(.52 + .5 * sin(vAlong * 70.)) + .003 * vnoise(vRest.xy * vec2(45., 110.) + vRest.z * 60.) + .0012 * vnoise(vRest.yz * 260.));
    N = relief(N, hgt, .9);
  #endif
  #ifdef BUFF
    N = relief(N, skinH, .6);
  #endif
  #ifdef KIT
    // Ткань снаряжения: нити, клетка рипстопа и мятость, чтобы рюкзак и ремни не были гладким чёрным пластиком.
    // Металл и пластик (блеск выше .3) остаются гладкими. Рисунок лежит в исходной позе, в той плоскости, куда смотрит деталь; вдали гаснет.
    float cloth = 1. - smoothstep(.2, .35, vGloss);
    vec3 aw = abs(vRN); vec2 fu = aw.x > max(aw.y, aw.z) ? vRest.zy : aw.y > aw.z ? vRest.xz : vRest.xy;
    float fw = fwidth(fu.x) + fwidth(fu.y), nearW = smoothstep(.0016, .0006, fw), nearR = smoothstep(.003, .001, fw), nearF = smoothstep(.03, .008, fw);
    float weave = .5 + .5 * sin(fu.x * 2600.) * sin(fu.y * 2600.), rip = max(smoothstep(.8, 1., cos(fu.x * 1257.)), smoothstep(.8, 1., cos(fu.y * 1257.))); // клетка 5 мм
    float fold = fbm(mat2(.8, .6, -.6, .8) * fu * 11. + 3.7); // мятость; простой шум по клеткам здесь давал квадратные пятна
    base *= mix(1., (.88 + .24 * weave * nearW) * (1. + .14 * rip * nearR) * (.75 + .5 * fold), cloth * nearF); // клетка только цветом: рельефом она блестела, как кафель
    N = relief(N, cloth * (nearW * .0004 * weave + nearF * .006 * fold), .8);
  #endif
  float sh = baked(vW).r;
  // Наледь: снег набивается в швы и клочьями намерзает на плечах, каске и спине. Рисунок привязан к ткани
  // в исходной позе: если считать его по точке в мире, пятна плывут по костюму при каждом движении.
  float grain = vnoise(vRest.xz * 24. + vRest.y * 15.) * .6 + vnoise(vRest.xy * 70. + vRest.z * 40.) * .4;
  float catchW = max(vRN.y, -vRN.z * .8) + seam * .35, edge = mix(1.05, .55, uDust);
  float dust = smoothstep(edge, edge + .12, catchW * .6 + grain * .55);
  vec3 alb = mix(base * (1. - .35 * seam), vec3(.82, .87, .93) * (.85 + .3 * grain), dust);
  float ndl = max(dot(N, uSunDir), 0.);
  #ifdef BUFF
    ndl = max((dot(N, uSunDir) + .4) / 1.4, 0.); // кожа пропускает свет: тень на лице мягкая, без пластика
  #endif
  vec3 col = alb * (uSunCol * ndl * sh * (1. - .3 * seam) + uAmbCol * (.55 + .45 * N.y));
  col += dust * uSunCol * sh * .5 * pow(max(dot(N, normalize(uSunDir + V)), 0.), 40.); // лёд блестит
  #ifdef BUFF
    float tn = dot(N, uSunDir);
    col += alb * uSunCol * sh * vec3(.5, .1, .06) * smoothstep(-.35, .05, tn) * smoothstep(.45, .05, tn); // на границе света и тени кожа просвечивает красным
  #endif
  col += eyeSpark * (uAmbCol * 2.5 + uSunCol * .25); // блик неба на роговице
  #if defined(FACE) || defined(EYE)
    col += alb * vec3(1., .82, .58) * uLampI * .07 * max(dot(N, uLampDir), 0.); // снег, освещённый фонарём, подсвечивает лицо снизу: в пургу оно иначе проваливалось в черноту
  #endif
  float gloss = vGloss;
  #if defined(BODY) || defined(QUILT)
    gloss = .15 * (1. - vPart); // нейлон чуть лоснится
  #endif
  #if defined(BUFF) || defined(HOOD)
    gloss = skinGloss; // кожа слегка лоснится, губы и лёд блестят
  #endif
  gloss *= 1. - dust;
  col += gloss * uSunCol * sh * pow(max(dot(N, normalize(uSunDir + V)), 0.), mix(16., 140., gloss)) * mix(.5, 4., gloss);
  col = mix(col, mix(uFogCol, uSkyZen + uAmbCol, smoothstep(-.3, .7, reflect(-V, N).y)) * mix(vec3(1.), alb * 2., .5), gloss * gloss * .6); // металл, пластик и стекло отражают небо
  float rim = pow(clamp(1. - dot(N, V), 0., 1.), 3.); // clamp: pow от отрицательного даёт NaN, свечение разносит его на весь кадр
  col += rim * (alb + .08) * (uAmbCol * .6 + uSunCol * sh * 1.2 * max(dot(-V, uSunDir) + .2, 0.)); // контровой свет окрашен тканью, а не белый
  #ifdef NMAP
    // Линза очков зеркальная. Где она на модели: по месту в исходной позе и по голубому цвету в текстуре (оправа и балаклава чёрные).
    float lens = uMirror * smoothstep(.078, .062, abs(vRest.x)) * smoothstep(1.596, 1.606, vRest.y) * smoothstep(1.678, 1.668, vRest.y) * step(.07, vRest.z)
      * smoothstep(.0, .06, base.b - base.r) * smoothstep(.3, .45, dot(base, vec3(.333)));
    if (lens > 0.){
      vec4 c = uMirrorM * vec4(reflect(-V, N), 0.);
      vec3 refl = c.w > 0. ? texture2D(tMirror, clamp(c.xy / c.w * .5 + .5, 0., 1.)).rgb : uSkyZen;
      col = mix(col, refl * vec3(.6, .7, .84) + col * .15, lens * (.6 + .4 * pow(1. - max(dot(N, V), 0.), 3.))); // под скользящим углом отражает сильнее
    }
  #endif
  gl_FragColor = vec4(applyFog(col, vW), 1.);
}`;
export const litMaterial = (G, color, defines = {}, gloss = 0) =>
  new THREE.ShaderMaterial({ uniforms: { ...G, uColor: { value: new THREE.Color().setRGB(...color) }, uGloss: { value: gloss } }, vertexShader: VS, fragmentShader: FS, defines });

// сустав между корнем a и целью t для двух костей l1, l2; pole задаёт, куда смотрит сгиб. Ось сгиба остаётся в _hinge.
function ik(a, t, l1, l2, pole, out) {
  _d.subVectors(t, a);
  const d = Math.min(_d.length(), l1 + l2 - 1e-3);
  _d.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _hinge.crossVectors(_p, _d);
  return out.copy(a).addScaledVector(_d, x).addScaledVector(_p, h);
}
// поворот из осей: Y вдоль dir, X вдоль side (выравнивается перпендикулярно dir)
function basisQ(side, dir, out) {
  _y.copy(dir).normalize();
  _x.copy(side).addScaledVector(_y, -side.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}
const ease = (u) => u * u * (3 - 2 * u);
// направление на доле f дуги от a к b (оба единичные)
function arcTo(a, b, f, out) {
  const th = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))), sn = Math.sin(th);
  return sn < 1e-4 ? out.copy(a) : out.copy(a).multiplyScalar(Math.sin((1 - f) * th) / sn).addScaledVector(b, Math.sin(f * th) / sn);
}
// Ботинок на лодыжке. Он хочет встать плашмя носком в toe (side: его левый бок), но сустав пускает не всё:
// голень (shin: от лодыжки к колену) клонится к носку не больше 28 градусов и от него не больше 40, вбок не больше 15,
// а носок смотрит туда, куда гнётся колено (hinge: ось колена), с люфтом 25. Что сверх этого, доворачивает сам ботинок:
// пятка поднимается или уходит набок. Пишет в f, куда смотрит носок, и в up, куда смотрит голенище. Все векторы единичные.
const YAW = Math.sin(0.44), DORSI = Math.sin(0.49), PLANT = -Math.sin(0.7), ROLL = 0.26;
export function ankle(toe, side, shin, hinge, f, up) {
  const c = toe.dot(hinge);
  f.copy(toe);
  if (Math.abs(c) > YAW) {
    f.addScaledVector(hinge, -c);
    if (f.lengthSq() < 1e-6) f.crossVectors(hinge, shin); // носок ровно по оси колена: берём любое направление в плоскости ноги
    f.normalize().multiplyScalar(Math.sqrt(1 - YAW * YAW)).addScaledVector(hinge, Math.sign(c) * YAW);
  }
  const d = f.dot(shin), dl = Math.min(DORSI, Math.max(PLANT, d));
  if (dl !== d) f.addScaledVector(shin, -d).normalize().multiplyScalar(Math.sqrt(1 - dl * dl)).addScaledVector(shin, dl);
  up.crossVectors(f, side).normalize(); // подошва плашмя
  _sh.copy(shin).addScaledVector(f, -shin.dot(f)).normalize(); // голенище точно по голени
  const a = up.angleTo(_sh), sa = Math.sin(a);
  if (a > ROLL) { if (sa < 1e-4) up.copy(_sh); else up.multiplyScalar(Math.sin(ROLL) / sa).addScaledVector(_sh, Math.sin(a - ROLL) / sa).normalize(); }
}
// Веса костей для снаряжения, лежащего на теле: смесь весов трёх ближайших точек раздутого пуховика.
function skinLike(geo, verts, skeleton, allow) { // allow(кость точки тела, высота точки ремня): можно ли брать у неё веса
  const P = geo.attributes.position, n = P.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), slot = new Map(skeleton.bones.map((b, k) => [b.name, k]));
  const CELL = 0.08, grid = new Map(), key = (x, y, z) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL) + ',' + Math.floor(z / CELL);
  for (const q of verts) { const k = key(q.p.x, q.p.y, q.p.z); (grid.get(k) ?? grid.set(k, []).get(k)).push(q); }
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), best = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const q of grid.get(key(x + a * CELL, y + b * CELL, z + c * CELL)) ?? []) {
      if (!allow(q.b, y)) continue;
      const d = (q.p.x - x) ** 2 + (q.p.y - y) ** 2 + (q.p.z - z) ** 2;
      if (best.length < 3 || d < best[2][0]) { best.push([d, q]); best.sort((u, v) => u[0] - v[0]); best.length = Math.min(best.length, 3); }
    }
    if (!best.length) best.push(verts.reduce((u, q) => { const d = allow(q.b, y) ? (q.p.x - x) ** 2 + (q.p.y - y) ** 2 + (q.p.z - z) ** 2 : Infinity; return d < u[0] ? [d, q] : u; }, [Infinity, verts[0]]));
    const acc = new Map();
    for (const [d, q] of best) {
      const g = q.o.geometry.attributes, w = 1 / (d + 1e-5);
      for (let c = 0; c < 4; c++) { const k = slot.get(q.o.skeleton.bones[g.skinIndex.getComponent(q.i, c)].name); acc.set(k, (acc.get(k) ?? 0) + w * g.skinWeight.getComponent(q.i, c)); }
    }
    const top = [...acc].sort((u, v) => v[1] - u[1]).slice(0, 4), sum = top.reduce((t, e) => t + e[1], 0) || 1;
    top.forEach(([k, w], c) => { si[i * 4 + c] = k; sw[i * 4 + c] = w / sum; });
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  return geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
}
// Тени в складках лица. Сглаживаем копию головы и смотрим, насколько каждая точка оказалась под сглаженной поверхностью:
// глазницы, крылья носа и щель между губ уходят вглубь и темнеют, переносица и губы выступают и светлеют.
function cavity(pos, nor, idx) {
  const n = pos.length / 3, id = new Int32Array(n), first = new Map(), p = Float32Array.from(pos), acc = new Float32Array(n * 3), cnt = new Float32Array(n), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const k = Math.round(pos[i * 3] * 2e4) + ',' + Math.round(pos[i * 3 + 1] * 2e4) + ',' + Math.round(pos[i * 3 + 2] * 2e4); id[i] = first.get(k) ?? first.set(k, i).get(k); }
  for (let it = 0; it < 40; it++) {
    acc.fill(0); cnt.fill(0);
    for (let t = 0; t < idx.length; t += 3) for (let c = 0; c < 3; c++) {
      const a = id[idx[t + c]], b = id[idx[t + ((c + 1) % 3)]];
      for (let k = 0; k < 3; k++) { acc[a * 3 + k] += p[b * 3 + k]; acc[b * 3 + k] += p[a * 3 + k]; }
      cnt[a]++; cnt[b]++;
    }
    for (let i = 0; i < n; i++) if (cnt[i]) for (let k = 0; k < 3; k++) p[i * 3 + k] = 0.5 * p[i * 3 + k] + (0.5 * acc[i * 3 + k]) / cnt[i];
  }
  for (let i = 0; i < n; i++) {
    const r = id[i] * 3, d = (p[r] - pos[i * 3]) * nor[i * 3] + (p[r + 1] - pos[i * 3 + 1]) * nor[i * 3 + 1] + (p[r + 2] - pos[i * 3 + 2]) * nor[i * 3 + 2];
    out[i] = Math.min(1.12, Math.max(0.5, 1 - d * 60)); // d в метрах: складка в 5 мм темнее на треть, выступ чуть светлее
  }
  return out;
}
// У одежды модели рукав пришит к плечу не до конца: при поднятой руке там открывалась щель, и сквозь плечо было видно небо.
// Каждую мелкую дыру затягиваем веером треугольников по её краю; ворот, манжеты и подол остаются открытыми.
function patch(g) {
  const P = g.attributes.position, I = g.index, id = new Int32Array(P.count), first = new Map(), half = new Map(), out = new Map(), extra = [];
  for (let i = 0; i < P.count; i++) { const k = Math.round(P.getX(i) * 2e4) + ',' + Math.round(P.getY(i) * 2e4) + ',' + Math.round(P.getZ(i) * 2e4); id[i] = first.get(k) ?? first.set(k, i).get(k); }
  for (let t = 0; t < I.count; t += 3) for (let c = 0; c < 3; c++) { const p = I.getX(t + c), q = I.getX(t + ((c + 1) % 3)); half.set(id[p] + '_' + id[q], [p, q]); }
  // край: встречного ребра нет. Заплатка идёт по краю в обратную сторону; в одной точке могут сходиться два края, поэтому рёбра лежат списком.
  for (const [p, q] of half.values()) if (!half.has(id[q] + '_' + id[p])) (out.get(id[q]) ?? out.set(id[q], []).get(id[q])).push([id[p], q]);
  for (const [start, list] of out) while (list.length) {
    const loop = [];
    let v = start;
    do { const e = out.get(v)?.pop(); if (!e) break; loop.push(e[1]); v = e[0]; } while (v !== start && loop.length < 64);
    // Заплатка кладётся в обе стороны. Щели вдоль шва рукава узкие и кривые, половина треугольников веера ложилась изнанкой наружу и не рисовалась:
    // стоило поднять руку, щель расходилась, и сквозь неё тёмным клином было видно тело.
    if (v === start && loop.length <= 16) for (let i = 1; i < loop.length - 1; i++) extra.push(loop[0], loop[i], loop[i + 1], loop[0], loop[i + 1], loop[i]);
  }
  g.setIndex([...I.array, ...extra]);
}

// Страховка по секундам: куда идёт правая рука. grip рукоять ледоруба, belt обвязка, place вставляет крюк,
// up и hit замах и удар молотком ледоруба по крюку, clip встёгивает верёвку.
const KEYS = [[0, 'grip'], [0.6, 'belt'], [1.4, 'place'], [2.0, 'grip'], [2.5, 'up'], [2.63, 'hit'], [3.0, 'up'], [3.13, 'hit'], [3.5, 'up'], [3.63, 'hit'],
  [4.0, 'up'], [4.13, 'hit'], [4.9, 'grip'], [5.5, 'belt'], [6.3, 'clip'], [7.0, 'grip']];
const HITS = KEYS.filter((k) => k[1] === 'hit').map((k) => k[0]), CLIP_T = 6.3, TASK_T = 7.0;

// Тело от Meshy (public/models/climber2.glb): сетка в A-позе на скелете Mixamo. Сажаем её на скелет прежней модели: те же 15 костей,
// те же суставы в той же исходной позе (руки и ноги вниз). Кинематика, походка и снаряжение считают от костей и подмены не замечают:
// первая попытка оставить суставы как у Meshy (плечи на 3 см уже) сразу дала локоть, оттопыренный вбок на передышке.
// Кости Mixamo, которых у нас нет (ключицы, шея, носки), отдают точки ближайшему предку из наших.
// Как получен файл: ref/meshy/climber-meshy.glb с meshy.ai, облегчён скриптом tools/slim-glb.py.
const OURS = { hips: ['Hips', null, [0, 0.93, 0]], torso: ['Spine', 'hips', [0, 0.99, 0]], head: ['Head', 'torso', [0, 1.45, 0]] }; // кость Mixamo, наш родитель, сустав прежней модели
for (const [s, side] of [[1, 'Left'], [-1, 'Right']]) Object.assign(OURS, {
  ['upperArm' + s]: [side + 'Arm', 'torso', [0.205 * s, 1.35, 0]], ['forearm' + s]: [side + 'ForeArm', 'upperArm' + s, [0.205 * s, 1.05, 0]], ['hand' + s]: [side + 'Hand', 'forearm' + s, [0.205 * s, 0.785, 0]],
  ['thigh' + s]: [side + 'UpLeg', 'hips', [0.1 * s, 0.93, 0]], ['shin' + s]: [side + 'Leg', 'thigh' + s, [0.1 * s, 0.495, 0]], ['shoe' + s]: [side + 'Foot', 'shin' + s, [0.1 * s, 0.065, 0]],
});
const PACK_H = 0.6, PACK_Y = 0.95; // высота рюкзака от Meshy и где его низ: верх остаётся под капюшоном
function adopt(scene) {
  scene.updateMatrixWorld(true);
  let src; scene.traverse((o) => { if (o.isSkinnedMesh) src = o; });
  const names = Object.keys(OURS), at = (n) => names.indexOf(n), id = (b) => b.name.replace(/^mixamorig:?/, ''), sb = src.skeleton.bones;
  const own = new Map(names.map((n, k) => [OURS[n][0], k]));
  // Рукавица у Meshy висит на своей кости от предплечья, а не на кисти: отдаём её кисти, иначе она остаётся торчать из рукава,
  // когда кисть спрятана (рукоять держит наш кулак).
  const slot = sb.map((b) => {
    for (let o = b; o; o = o.parent) {
      if (/^Bone_/.test(o.name) && /ForeArm$/.test(id(o.parent))) return own.get(id(o.parent).replace('ForeArm', 'Hand'));
      if (own.has(id(o))) return own.get(id(o));
    }
    return 0;
  });
  const J = names.map((n) => sb.find((b) => id(b) === OURS[n][0]).getWorldPosition(V())), Pn = names.map((n) => V().fromArray(OURS[n][2])); // суставы Meshy в A-позе и наши
  // Куда едут точки каждой кости. Рука и нога: сустав встаёт на наш, кость тянется до нашей длины (K вдоль U). Нога сразу поворачивается вниз (R):
  // там всего несколько градусов. Рука пока остаётся в A-позе: её опускает загрузчик тем же способом, каким плечо гнётся на ходу,
  // иначе точки плеча при опускании и при подъёме ехали по разным весам и куртка на плече ломалась.
  // Корпус и голова просто поднимаются, чтобы таз лёг на корни наших ног. Jn: куда приходит сустав Meshy.
  const DOWN = V().set(0, -1, 0), lift = V().set(0, Pn[at('thigh1')].y - (J[at('thigh1')].y + J[at('thigh-1')].y) / 2, 0);
  const Jn = [], R = [], U = [], K = [];
  names.forEach((n, k) => {
    const kind = n.replace(/-?1$/, ''), pk = at(OURS[n][1]), child = names.findIndex((m) => OURS[m][1] === n);
    R[k] = Q(); U[k] = V(); K[k] = 1; Jn[k] = /hips|torso|head/.test(kind) ? J[k].clone().add(lift) : Pn[k];
    if (/upperArm|forearm|thigh|shin/.test(kind)) { U[k].subVectors(J[child], J[k]); K[k] = Pn[child].distanceTo(Pn[k]) / U[k].length(); U[k].normalize(); }
    if (/thigh|shin/.test(kind)) R[k].setFromUnitVectors(U[k], DOWN);
    if (/forearm|hand/.test(kind)) Jn[k] = Jn[pk].clone().addScaledVector(U[pk], Pn[k].distanceTo(Pn[pk])); // локоть и кисть вдоль руки в A-позе
  });
  const g = src.geometry, P = g.attributes.position, N0 = g.attributes.normal, n = P.count, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), p = V(), q = V(), e = V(), sp = V(), sn = V();
  for (let i = 0; i < n; i++) {
    src.applyBoneTransform(i, p.fromBufferAttribute(P, i)).applyMatrix4(src.matrixWorld); // точка в мире, в позе файла
    src.applyBoneTransform(i, q.fromBufferAttribute(P, i).addScaledVector(e.fromBufferAttribute(N0, i), 1e-3)).applyMatrix4(src.matrixWorld).sub(p).normalize();
    const acc = new Map();
    for (let c = 0; c < 4; c++) { const w = SW.getComponent(i, c), k = slot[SI.getComponent(i, c)]; if (w > 0) acc.set(k, (acc.get(k) ?? 0) + w); }
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((t, x) => t + x[1], 0);
    sp.set(0, 0, 0); sn.set(0, 0, 0);
    top.forEach(([k, w], c) => {
      w /= sum; si[i * 4 + c] = k; sw[i * 4 + c] = w;
      e.subVectors(p, J[k]); e.addScaledVector(U[k], (K[k] - 1) * U[k].dot(e)).applyQuaternion(R[k]).add(Jn[k]); sp.addScaledVector(e, w);
      e.copy(q).addScaledVector(U[k], (1 / K[k] - 1) * U[k].dot(q)).applyQuaternion(R[k]); sn.addScaledVector(e, w); // нормаль при растяжении сжимается наоборот
    });
    sp.toArray(pos, i * 3); sn.normalize().toArray(nor, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', g.attributes.uv);
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); geo.setIndex(g.index);
  const holder = new THREE.Group(), bones = names.map((nm) => Object.assign(new THREE.Bone(), { name: nm }));
  names.forEach((nm, k) => { const pk = at(OURS[nm][1]); (pk < 0 ? holder : bones[pk]).add(bones[k]); const p0 = (i) => (/forearm|hand/.test(names[i]) ? Jn[i] : Pn[i]); bones[k].position.copy(p0(k)); if (pk >= 0) bones[k].position.sub(p0(pk)); });
  const mesh = new THREE.SkinnedMesh(geo, src.material); mesh.name = 'meshy';
  holder.add(mesh); holder.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  holder.userData.rest = Object.fromEntries(names.map((nm, k) => [nm, Pn[k]])); // куда кости встанут, когда руки опустятся
  return holder;
}

export function createClimber(G) {
  const group = new THREE.Group();
  const RED = [0.5, 0.03, 0.012];
  const many = (geo, c, gloss) => { const m = new THREE.InstancedMesh(geo, litMaterial(G, c, {}, gloss), 96); m.frustumCulled = false; m.count = 0; group.add(m); return m; };
  // Снаряжение (gear.js): каска ездит за головой, рукавицы за кистями, железо висит на обвязке; остальное цепляется к костям ниже.
  const kitMat = litMaterial(G, [1, 1, 1], { KIT: '' });
  const caps = { uCapA: { value: [V(), V(), V(), V()] }, uCapB: { value: [V(), V(), V(), V()] }, uCapR: { value: [0, 0, 0, 0] } }; // 0, 1 руки; 2, 3 ноги
  const kit = (geo) => { const m = new THREE.Mesh(geo, kitMat); m.frustumCulled = false; group.add(m); return m; };
  const helm = helmet(), LAMP = V().fromArray(helm.userData.lamp), axeGeo = axe();
  const racks = [1, -1].map((s) => { const m = kit(rack()); m.visible = false; return { s, m, p: V(), q: V() }; });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 6).scale(1, 1, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(8, 6.5, 4) }));
  const glowI = { value: 1 };
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { uI: glowI },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'varying vec2 vUv; uniform float uI; void main(){ float a = pow(max(1. - length(vUv - .5) * 2., 0.), 3.); gl_FragColor = vec4(vec3(1., .85, .6) * uI * a, 1.); }',
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  glow.renderOrder = 4;
  // Страховка: крючья с петлями и верёвка через них до самого подножия стены.
  const pickets = many(new THREE.BoxGeometry(0.018, 0.3, 0.03).translate(0, 0.15, 0), [0.5, 0.52, 0.55], 0.9);
  const slings = many(new THREE.TorusGeometry(0.04, 0.008, 6, 16), [0.7, 0.22, 0.02], 0);
  // Верёвка: трубка толщиной 16 мм вокруг цепочки точек. Линия в один пиксель вблизи выглядела ниткой, а издали рвалась.
  // Первые HEAD точек живые (от обвязки до последнего крюка), остальные лежат на склоне и пересчитываются, когда встал новый крюк.
  const ROPE = 4096, HEAD = 24, SIDES = 5, RAD = 0.008, ropePts = new Float32Array(ROPE * 3);
  const ropeP = new THREE.BufferAttribute(new Float32Array(ROPE * SIDES * 3), 3), ropeN3 = new THREE.BufferAttribute(new Float32Array(ROPE * SIDES * 3), 3);
  const ropeC = new Float32Array(ROPE * SIDES * 4), ropeI = new Uint32Array((ROPE - 1) * SIDES * 6);
  for (let i = 0; i < ROPE; i++) for (let j = 0; j < SIDES; j++) ropeC.set(i % 4 === 3 ? [0.1, 0.11, 0.14, 0.1] : [0.78, 0.2, 0.02, 0.12], (i * SIDES + j) * 4); // оплётка: оранжевая с тёмной ниткой
  for (let i = 0, k = 0; i < ROPE - 1; i++) for (let j = 0; j < SIDES; j++) { const a = i * SIDES + j, b = i * SIDES + ((j + 1) % SIDES); ropeI.set([a, b, a + SIDES, b, b + SIDES, a + SIDES], k); k += 6; } // обход граней наружу
  const rope = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', ropeP).setAttribute('normal', ropeN3).setAttribute('aCol', new THREE.BufferAttribute(ropeC, 4)).setIndex(new THREE.BufferAttribute(ropeI, 1)), kitMat);
  rope.frustumCulled = false;
  const rT = V(), rN = V(), rB = V();
  // ставит кольца трубки вокруг точек с i0 по i1; всего точек n
  function tube(i0, i1, n) {
    for (let i = i0; i < i1; i++) {
      const a = Math.max(i - 1, 0) * 3, b = Math.min(i + 1, n - 1) * 3, c = i * 3;
      rT.set(ropePts[b] - ropePts[a], ropePts[b + 1] - ropePts[a + 1], ropePts[b + 2] - ropePts[a + 2]).normalize();
      rN.crossVectors(rT, Y); if (rN.lengthSq() < 1e-4) rN.set(1, 0, 0); // верёвка висит отвесно: любая сторона годится
      rN.normalize(); rB.crossVectors(rT, rN);
      for (let j = 0; j < SIDES; j++) {
        const an = (j / SIDES) * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an), nx = rN.x * cs + rB.x * sn, ny = rN.y * cs + rB.y * sn, nz = rN.z * cs + rB.z * sn;
        ropeN3.setXYZ(i * SIDES + j, nx, ny, nz); ropeP.setXYZ(i * SIDES + j, ropePts[c] + nx * RAD, ropePts[c + 1] + ny * RAD, ropePts[c + 2] + nz * RAD);
      }
    }
    ropeP.needsUpdate = ropeN3.needsUpdate = true;
  }
  group.add(lamp, glow, rope);

  // порядок шагов: правая рука, левая нога, левая рука, правая нога
  const LIMBS = [1, -1, -1, 1].map((s, i) => (i % 2 === 0
    ? { hand: true, s, along: 0.9, lat: 0.24, lift: 0.22, tool: kit(axeGeo), sh: 0, fist: kit(mitten(s)), fd: V() }
    : { hand: false, s, along: -0.56, lat: 0.16, lift: 0.12 })); // ступня встаёт на 0.4 м ниже таза и уходит до 0.75
  LIMBS.forEach((L, i) => { L.from = V(); L.to = V(); L.cur = V(); L.j0 = V(); L.j1 = V(); L.j2 = V(); L.j3 = V(); L.t0 = -9; L.dur = MOVE; L.k = 1; L.u = 1; L.tp = V(); L.td = V(); L.tq = Q(); L.tset = false; L.st = L.hand ? STRIDE : STRIDE / 2; L.phase = (SEQ.indexOf(i) * STRIDE) / 6 + L.along + L.st * 0.55; });

  // Голова вырезана из подробной версии того же человека (tools/extract-head.mjs) и ездит за шеей как жёсткая деталь.
  const NEW = !new URLSearchParams(location.search).has('old'); // адрес с ?old показывает прежнее тело, для сравнения
  const face = new THREE.Group(), squint = { value: 0.45 }, grim = { value: 0.35 };
  group.add(face);
  face.add(kit(helm));
  face.visible = !NEW; // у нового тела голова своя: очки и балаклава, прежнюю даже не грузим
  if (!NEW) fetch('/head/head.json').then((r) => r.json()).then(({ parts, center }) => {
    const arr = (b64, T) => new T(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
    const ep = arr(parts.eyes.pos, Float32Array), eye = V();
    let en = 0;
    for (let k = 0; k < ep.length; k += 3) if (ep[k] > 0) { eye.x += ep[k]; eye.y += ep[k + 1]; eye.z += ep[k + 2]; en++; }
    eye.divideScalar(en).sub(V().fromArray(center)); // центр одного глаза относительно центра черепа, второй зеркально
    const wear = (m) => { Object.assign(m.uniforms, { uEye: { value: eye }, uSquint: squint, uGrim: grim }); return m; };
    for (const [name, file, defs] of [['skin', 'skin.jpg', { BUFF: '', FACE: '' }], ['eyes', 'eyes.jpg', { EYE: '' }], ['brows', 'brows.png', { FROST: '', FACE: '' }], ['lashes', 'lashes.png', { FROST: '', FACE: '' }]]) {
      const g = new THREE.BufferGeometry(), p = parts[name], map = new THREE.TextureLoader().load('/head/' + file);
      g.setAttribute('position', new THREE.BufferAttribute(arr(p.pos, Float32Array), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(arr(p.nor, Float32Array), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(arr(p.uv, Float32Array), 2));
      g.setIndex(new THREE.BufferAttribute(arr(p.idx, Uint32Array), 1));
      g.translate(-center[0], -center[1], -center[2]); // начало координат в центре черепа
      map.flipY = false; map.colorSpace = THREE.SRGBColorSpace;
      const m = wear(litMaterial(G, [0.5, 0.4, 0.35], { USE_MAP: '', ...defs }, name === 'eyes' ? 0.55 : 0));
      m.uniforms.map = { value: map };
      face.add(new THREE.Mesh(g, m));
      if (name === 'skin') { // по той же голове: подробная кожа лица, тени в складках и балаклава поверх
        // face.jpg: квадрат 430 точек с угла (1581, 844) родной текстуры 2048, увеличенный до 1024 и перерисованный GPT.
        // Исходник и результат лежат в tools/face, там лицо повёрнуто на 90 градусов по часовой, чтобы стоять прямо.
        const fm = new THREE.TextureLoader().load('/head/face.jpg');
        fm.flipY = false; fm.colorSpace = THREE.SRGBColorSpace; fm.anisotropy = 8;
        m.uniforms.faceMap = { value: fm };
        g.setAttribute('aCav', new THREE.BufferAttribute(cavity(g.attributes.position.array, g.attributes.normal.array, g.index.array), 1));
        face.add(new THREE.Mesh(g, wear(litMaterial(G, [0.045, 0.047, 0.056], { HOOD: '', FACE: '' }))));
      }
    }
  });

  // ---------- тело: модель со скелетом, кости ставит наша кинематика ----------
  let rig = null;
  // Как далеко таз от склона и насколько корпус отклонён от него. Прежнее толстое тело держалось в 52 см и отклонялось назад:
  // новому стройному так держаться незачем, а руки при этом тянулись к ледорубам вниз и к склону и растягивали рукава на 10–18%.
  const OFF = NEW ? 0.44 : 0.52, TILT = NEW ? 0.04 : 0.2;
  // Точка, которой ботинок встаёт на склон: на сколько она впереди лодыжки и ниже её. У прежней модели это был самый носок.
  // У ботинка Meshy носок короче (14 см от лодыжки), и с прежними числами он не доставал до снега: подошва висела в 10 см над склоном.
  // Теперь опора на подошве в 3 см впереди лодыжки: передняя треть ботинка и зубья кошки уходят в снег, как при выбивании ступени.
  const TOE = NEW ? 0.03 : 0.17, SOLE = NEW ? 0.085 : 0.07;
  new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/')).load(NEW ? '/models/climber2.glb' : '/models/climber.glb', (file) => {
    const root = NEW ? adopt(file.scene) : file.scene;
    root.updateMatrixWorld(true);
    const B = {}, rest = {}, verts = [];
    root.traverse((o) => { if (o.isBone) { B[o.name] = o; rest[o.name] = o.getWorldPosition(V()); } });
    const body = litMaterial(G, RED, { BODY: '' }), skins = [];
    root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      if (/short01|eyebrow|eyelash|low-poly/.test(o.name + o.material.name)) o.visible = false; // у модели своя простая голова: волосы, брови и глаза не нужны
      else skins.push(o);
    });
    // Раздуваем по общей нормали всех точек, стоящих в одном месте: по своим нормалям половинки шва расходились щелью, и сквозь плечо было видно небо.
    const weld = new Map(), spot = (o, i) => {
      _a.fromBufferAttribute(o.geometry.attributes.position, i).applyMatrix4(o.matrixWorld);
      const k = Math.round(_a.x * 2e4) + ',' + Math.round(_a.y * 2e4) + ',' + Math.round(_a.z * 2e4);
      return weld.get(k) || weld.set(k, V()).get(k);
    };
    for (const o of skins) if (/suit/.test(o.name)) patch(o.geometry);
    for (const o of skins) for (let i = 0; i < o.geometry.attributes.position.count; i++) spot(o, i).add(_b.fromBufferAttribute(o.geometry.attributes.normal, i).transformDirection(o.matrixWorld));
    // Сколько можно раздувать в каждой точке. Под мышкой, между бёдрами и в складках поверхности смотрят друг на друга в паре сантиметров:
    // раздутые на 5 см каждая, они проходят друг сквозь друга и выворачиваются рваными клиньями. Там надув не больше 0.42 зазора.
    const pts = [], cell = new Map(), CELL = 0.06, ck = (x, y, z) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL) + ',' + Math.floor(z / CELL);
    for (const o of NEW ? [] : skins) for (let i = 0; i < o.geometry.attributes.position.count; i++) {
      const w = spot(o, i), q = { p: _a.clone(), n: (w.lengthSq() > 0.1 ? w.clone() : _b.fromBufferAttribute(o.geometry.attributes.normal, i).transformDirection(o.matrixWorld).clone()).normalize(), lim: 0.05 };
      pts.push(q); const k = ck(q.p.x, q.p.y, q.p.z); (cell.get(k) ?? cell.set(k, []).get(k)).push(q);
    }
    const around = (q, r, fn) => { for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) for (const u of cell.get(ck(q.p.x + a * CELL, q.p.y + b * CELL, q.p.z + c * CELL)) ?? []) fn(u); };
    for (const q of pts) around(q, 2, (u) => { // встречная поверхность: лежит по нормали впереди и смотрит навстречу
      const d = _d.subVectors(u.p, q.p), along = d.dot(q.n), len = d.length();
      if (along > 0.004 && along > 0.6 * len && u.n.dot(q.n) < -0.3) q.lim = Math.min(q.lim, Math.max(0.004, 0.42 * len));
    });
    for (let pass = 0; pass < 2; pass++) { // сглаживаем, чтобы надув не менялся ступенькой
      for (const q of pts) { let sum = 0, cnt = 0; around(q, 1, (u) => { if (u.p.distanceToSquared(q.p) < 0.0012 && u.n.dot(q.n) > 0.3) { sum += u.lim; cnt++; } }); q.soft = Math.min(q.lim, sum / cnt); }
      for (const q of pts) q.lim = q.soft;
    }
    let at = 0;
    for (const o of skins) {
      const g = o.geometry, n = g.attributes.position.count, suit = new Float32Array(n * 3), puff = new Float32Array(n * 3), si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const under = /anatomical/.test(o.name) ? 0.75 : 1; // тело под курткой раздуто меньше неё, иначе в складках оно протыкает ткань
      const back = o.matrixWorld.clone().invert();
      for (let i = 0; i < n; i++) {
        const w = spot(o, i); // после этого в _a положение точки в исходной позе
        if (w.lengthSq() > 0.1) _b.copy(w).transformDirection(back); else _b.fromBufferAttribute(g.attributes.normal, i); // лист ткани с двух сторон: нормали гасят друг друга
        const lim = NEW ? 0 : pts[at++].lim * under; // новое тело уже пухлое, раздувать его не нужно
        _b.multiplyScalar(lim / 0.05).toArray(puff, i * 3); // длина вектора: доля от полного надува
        let k = 0;
        for (let c = 1; c < 4; c++) if (sw.getComponent(i, c) > sw.getComponent(i, k)) k = c;
        let head = 0; // сколько веса точки приходится на кость головы
        for (let c = 0; c < 4; c++) if (o.skeleton.bones[si.getComponent(i, c)].name === 'head') head += sw.getComponent(i, c);
        suit[i * 3] = _a.y;
        const bone = o.skeleton.bones[si.getComponent(i, k)].name;
        suit[i * 3 + 1] = /hand|shoe/.test(bone) ? 1 : 0;
        suit[i * 3 + 2] = head;
        if (head < 0.3) verts.push({ x: _a.x, y: _a.y, z: _a.z, b: bone, o, i, p: _a.clone().addScaledVector(_d.copy(w).normalize(), lim) }); // по этим точкам подгоняются ремни; p: где точка после раздувания
      }
      g.setAttribute('aSuit', new THREE.BufferAttribute(suit, 3));
      g.setAttribute('aPuff', new THREE.BufferAttribute(puff, 3));
      if (NEW) { const m = litMaterial(G, [1, 1, 1], { USE_MAP: '', NMAP: '' }, 0.15); m.uniforms.map = { value: o.material.map }; m.uniforms.nmap = { value: o.material.normalMap }; o.material = m; }
      else o.material = body; // родная текстура лица на этой модели вблизи выглядела сломанной, голова остаётся под балаклавой
      o.frustumCulled = false; // кости уезжают далеко от исходной позы, рамка модели уже неверна
    }
    // Плечо. В исходной позе руки опущены, а лезет он с руками над головой: плечевая кость повёрнута на 150 градусов и больше.
    // Точки между корпусом и рукой при таком повороте стягиваются к суставу, и пуховик складывается сам в себя рваными клиньями.
    // Поэтому между корпусом и рукой стоят две промежуточные кости, повёрнутые на треть и на две трети пути: поворот расходится по плечу плавно.
    const old = skins[0].skeleton, bones = [...old.bones], inv = [...old.boneInverses], mids = {};
    for (const sx of ['1', '-1']) mids[sx] = [1, 2].map((k) => {
      const arm = B['upperArm' + sx], h = new THREE.Bone();
      h.name = `shoulder${sx}_${k}`; h.position.copy(arm.position); h.quaternion.copy(arm.quaternion); h.scale.copy(arm.scale); arm.parent.add(h);
      inv.push(old.boneInverses[old.bones.indexOf(arm)].clone());
      return bones.push(h) - 1; // номер кости в скелете
    });
    const sk = new THREE.Skeleton(bones, inv), iT = bones.indexOf(B.torso);
    root.traverse((o) => { if (o.isSkinnedMesh) o.bind(sk, o.bindMatrix); });
    // Доля руки в каждой точке: 0 корпус, 1 рука. В модели она прыгает между соседними точками (на куртке до 0.9 на одном ребре),
    // и весь поворот плеча приходился на одну полоску треугольников: жёсткий шов у рукава. Размазываем переход по сетке на 8 см в обе стороны.
    const armX = Math.sign(rest.upperArm1.x), iArm = { 1: bones.indexOf(B.upperArm1), '-1': bones.indexOf(B['upperArm-1']) };
    for (const o of skins) {
      const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, P = g.attributes.position, n = si.count, idx = g.index;
      const accs = [], sides = [], free = new Uint8Array(n), node = new Int32Array(n), keys = new Map(), world = [];
      let val = [], fix = [];
      for (let i = 0; i < n; i++) {
        const acc = new Map();
        for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c), b = si.getComponent(i, c); if (w > 0) acc.set(b, (acc.get(b) ?? 0) + w); }
        const q = V().fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld), sx = Math.sign(q.x) === armX ? '1' : '-1', wa = acc.get(iArm[sx]) ?? 0, wt = acc.get(iT) ?? 0;
        let far = 0; // точки предплечья и кисти: для соседей это «целиком рука»
        for (const [b, w] of acc) if (/forearm|hand/.test(bones[b].name)) far += w;
        accs.push(acc); sides.push(sx); world.push(q); free[i] = wa + wt > 0.01 ? 1 : 0;
        const k = Math.round(q.x * 2e4) + ',' + Math.round(q.y * 2e4) + ',' + Math.round(q.z * 2e4); // точки шва стоят в одном месте: это один узел
        if (!keys.has(k)) { keys.set(k, val.length); val.push(0); fix.push(1); }
        node[i] = keys.get(k); val[node[i]] = free[i] ? wa / (wa + wt) : far > 0.5 ? 1 : 0; if (free[i]) fix[node[i]] = 0;
      }
      const near = val.map(() => new Set()), lens = [];
      for (let t = 0; t < (idx ? idx.count : n); t += 3) for (let e = 0; e < 3; e++) {
        const a = idx ? idx.getX(t + e) : t + e, b = idx ? idx.getX(t + ((e + 1) % 3)) : t + ((e + 1) % 3);
        if (node[a] !== node[b]) { near[node[a]].add(node[b]); near[node[b]].add(node[a]); lens.push(world[a].distanceTo(world[b])); }
      }
      lens.sort((x, y) => x - y);
      for (let it = Math.min(60, Math.max(2, Math.round((0.08 / (lens[lens.length >> 1] || 0.04)) ** 2))); it > 0; it--) { // мелкой сетке нужно больше проходов на те же сантиметры
        const next = val.slice();
        for (let v = 0; v < val.length; v++) { if (fix[v] || !near[v].size) continue; let sum = 0; for (const u of near[v]) sum += val[u]; next[v] = 0.5 * val[v] + (0.5 * sum) / near[v].size; }
        val = next;
      }
      for (let i = 0; i < n; i++) {
        if (!free[i]) continue;
        const acc = accs[i], sx = sides[i], iA = iArm[sx], all = (acc.get(iA) ?? 0) + (acc.get(iT) ?? 0), a = val[node[i]];
        acc.delete(iT); acc.delete(iA);
        // доля руки делится между четырьмя костями подряд: корпус, треть, две трети, рука
        [iT, ...mids[sx], iA].forEach((b, k) => { const w = Math.max(0, 1 - Math.abs(3 * a - k)) * all; if (w > 1e-4) acc.set(b, (acc.get(b) ?? 0) + w); });
        const top = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((t, e) => t + e[1], 0);
        for (let c = 0; c < 4; c++) { si.setComponent(i, c, top[c]?.[0] ?? 0); sw.setComponent(i, c, (top[c]?.[1] ?? 0) / sum); }
      }
      si.needsUpdate = sw.needsUpdate = true;
    }
    if (NEW) {
      // Руки нового тела из A-позы вниз, в нашу исходную позу. Плечо, обе промежуточные кости и предплечье поворачиваются так же,
      // как на ходу, и сетка запоминается в этом виде: подъём руки потом идёт по тем же весам обратно, без излома.
      const down = V().set(0, -1, 0), one = Q(), fin = root.userData.rest;
      for (const sx of ['1', '-1']) {
        const up = B['upperArm' + sx], fo = B['forearm' + sx], q = Q().setFromUnitVectors(_a.copy(fo.position).normalize(), down);
        up.quaternion.copy(q); mids[sx].forEach((k, t) => bones[k].quaternion.slerpQuaternions(one, q, (t + 1) / 3));
        fo.quaternion.copy(q).invert().multiply(Q().setFromUnitVectors(_a.copy(B['hand' + sx].position).normalize(), down));
      }
      root.updateMatrixWorld(true);
      for (const o of skins) {
        const P = o.geometry.attributes.position, N = o.geometry.attributes.normal;
        for (let i = 0; i < P.count; i++) {
          _b.fromBufferAttribute(N, i); _d.fromBufferAttribute(P, i).addScaledVector(_b, 1e-3); _a.fromBufferAttribute(P, i);
          o.applyBoneTransform(i, _a); o.applyBoneTransform(i, _d).sub(_a).normalize();
          P.setXYZ(i, _a.x, _a.y, _a.z); N.setXYZ(i, _d.x, _d.y, _d.z);
        }
        P.needsUpdate = N.needsUpdate = true;
      }
      for (const b of bones) {
        b.quaternion.identity();
        const at = fin[b.name] ?? fin['upperArm' + b.name.slice(8, -2)], par = fin[b.parent.name];
        b.position.copy(at); if (par) b.position.sub(par);
      }
      root.updateMatrixWorld(true); sk.calculateInverses();
      for (const n in B) rest[n] = B[n].getWorldPosition(V());
      for (const q of verts) { _a.fromBufferAttribute(q.o.geometry.attributes.position, q.i).applyMatrix4(q.o.matrixWorld); q.x = _a.x; q.y = _a.y; q.z = _a.z; q.p.copy(_a); }
    }
    // правая сторона модели в -X: она смотрит в +Z
    const sfx = (s) => ((rest.thigh1.x < 0) === (s > 0) ? '1' : '-1');
    const drv = (name, dir0, side0) => ({ bone: B[name], pre: basisQ(side0, dir0, Q()).invert().multiply(B[name].getWorldQuaternion(Q())), q: Q() });
    const DOWN = V().set(0, -1, 0), legSide = V().crossVectors(Z, DOWN), armSide = V().crossVectors(Z, DOWN).negate();
    rig = {
      rootQ: B.hips.parent.getWorldQuaternion(Q()), hipsParent: B.hips.parent,
      hips: drv('hips', Y, X), torso: drv('torso', Y, X), head: drv('head', Y, X),
      torsoOff: rest.torso.clone().sub(rest.hips), headOff: rest.head.clone().sub(rest.torso),
      limbs: LIMBS.map((L) => {
        const s = sfx(L.s), n = L.hand ? ['upperArm', 'forearm', 'hand'] : ['thigh', 'shin', 'shoe'], [a, b, c] = n.map((k) => rest[k + s]);
        const ab = b.clone().sub(a), far = [];
        for (const q of verts) { // точки вокруг средней части кости: у сустава к ней относятся ещё плечо и ягодица, они толще
          if (q.b !== n[0] + s) continue;
          const t = _d.set(q.x, q.y, q.z).sub(a).dot(ab) / ab.lengthSq();
          if (t > 0.25 && t < 0.9) far.push(_p.set(q.x, q.y, q.z).sub(_b.copy(a).addScaledVector(ab, t)).length());
        }
        far.sort((u, v) => u - v);
        return {
          rad: (far[Math.floor(far.length * 0.8)] ?? 0.07) + 0.056, // толщина в пуховике: расстояние от кости до ткани плюс запас (у прежнего тела это был надув)
          off: a.clone().sub(L.hand ? rest.torso : rest.hips), l1: a.distanceTo(b), l2: b.distanceTo(c),
          up: drv(n[0] + s, DOWN, L.hand ? armSide : legSide), low: drv(n[1] + s, DOWN, L.hand ? armSide : legSide),
          end: L.hand ? null : drv(n[2] + s, Z, X),
          mid: L.hand ? mids[s].map((k) => ({ bone: bones[k], pre: basisQ(armSide, DOWN, Q()).invert().multiply(bones[k].getWorldQuaternion(Q())), q: Q() })) : null, // промежуточные кости плеча
        };
      }),
    };
    B.hand1.scale.setScalar(0.01); B['hand-1'].scale.setScalar(0.01); // раскрытую ладонь модели прячем: рукоять держит кулак-рукавица
    // Ремни, рюкзак, обвязка и кошки собраны по фигуре в исходной позе и цепляются к костям: дальше ездят вместе с телом.
    const fit = fitted(verts, NEW ? 0 : 0.05, NEW ? 1.055 : 0.965, NEW ? 0.04 : 0), wear = (geo, bone, mat = kitMat) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; root.add(m); B[bone].attach(m); };
    if (!NEW) wear(fit.pack, 'torso');
    else new GLTFLoader().load('/models/pack.glb', (file) => { // рюкзак от Meshy: ref/meshy/pack-meshy.glb, облегчён tools/slim-glb.py
      let src; file.scene.updateMatrixWorld(true); file.scene.traverse((o) => { if (o.isMesh) src = o; });
      const g = src.geometry.clone().applyMatrix4(src.matrixWorld).rotateY(Math.PI); // карманом с лопатой назад, спинкой к спине
      g.computeBoundingBox();
      const bb = g.boundingBox, k = PACK_H / (bb.max.y - bb.min.y), lean = Math.atan2(fit.zUp - fit.zBack, 0.29); // спинка рюкзака ложится по спине от поясницы до лопаток
      g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -bb.max.z).scale(k, k, k).rotateX(lean).translate(0, PACK_Y, fit.zBack + 0.05); // на 5 см в спину: у рюкзака сзади выступает бухта верёвки, сама спинка глубже
      const mat = litMaterial(G, [1, 1, 1], { USE_MAP: '', NMAP: '' }, 0.1);
      mat.uniforms.map = { value: src.material.map }; mat.uniforms.nmap = { value: src.material.normalMap };
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false;
      m.position.copy(rest.torso).negate(); B.torso.add(m); // к этому времени кости уже в движении: сажаем в осях кости, как она стояла в исходной позе
    });
    if (!NEW) { wear(fit.hood, 'torso', litMaterial(G, RED, { QUILT: '' })); for (const sx of ['1', '-1']) wear(fit.shoes[sx], 'shoe' + sx); } // у нового тела капюшон, обвязка, ботинки и кошки свои
    // Ремни и обвязка тканевые: каждая их точка берёт веса костей у ближайших точек пуховика и гнётся вместе с ним.
    // Жёстко привязанные к одной кости, они тонули в куртке на плече, стоило поднять руку.
    // Веса берём только у той части тела, на которой ремень лежит: в исходной позе руки висят вдоль бёдер, и пояс иначе цеплялся за кисти.
    // Исключение: на самом плече куртка ходит за рукой, и лямка там тоже должна ходить за ней, иначе плечо куртки накрывает её.
    const host = skins[0], unbind = host.matrixWorld.clone().invert();
    // on: кто может наехать на деталь. Лямки накрывает поднятый рукав, пояс поднятое бедро, ножной обхват соседняя нога.
    const slot = (sx) => (sfx(LIMBS[1].s) === sx ? 2 : 3);
    const trunk = /^(torso|hips)$/;
    for (const [geo, allow, on] of [[fit.torso, (b, y) => trunk.test(b) || (y > 1.36 && b.startsWith('upperArm')), [1, 1, 0, 0]], [fit.hips, (b) => trunk.test(b), [0, 0, 1, 1]],
      ...['1', '-1'].map((sx) => [fit.thighs[sx], (b) => b === 'thigh' + sx || b === 'hips', slot(sx) === 2 ? [0, 0, 0, 1] : [0, 0, 1, 0]])].slice(0, NEW ? 1 : 4)) {
      const mat = litMaterial(G, [1, 1, 1], { KIT: '', SOFT: '' });
      Object.assign(mat.uniforms, caps, { uCapOn: { value: new THREE.Vector4(...on) } });
      const soft = new THREE.SkinnedMesh(skinLike(geo, verts, host.skeleton, allow).applyMatrix4(unbind), mat);
      soft.frustumCulled = false; host.parent.add(soft); soft.position.copy(host.position); soft.quaternion.copy(host.quaternion); soft.scale.copy(host.scale);
      soft.bind(host.skeleton, host.bindMatrix);
    }
    rig.rackAt = fit.rackAt;
    group.add(root);
  });
  // Запас длины: если до опоры не хватает нескольких сантиметров, рука или нога вытягивается, не больше чем на 18%.
  // Под пуховиком этого не видно, а кисть остаётся на рукояти и стопа на ступени.
  const stretch = (R, from, to) => { const k = Math.min(1.18, Math.max(1, from.distanceTo(to) / ((R.l1 + R.l2) * 0.985))); R.up.bone.scale.setScalar(k); return k; };
  // выталкивает точку p из бедра L (ось от таза до колена) на расстояние r от оси
  const clearOf = (p, L, r, side) => {
    _d.subVectors(L.j1, L.j0);
    _b.copy(L.j0).addScaledVector(_d, Math.min(1, Math.max(0, _p.subVectors(p, L.j0).dot(_d) / (_d.lengthSq() || 1))));
    const gap = _p.subVectors(p, _b).length();
    if (gap < r) p.copy(_b).addScaledVector(gap > 1e-4 ? _p : left, gap > 1e-4 ? r / gap : r * side);
  };
  const drive = (d, side, dir, parentQ) => {
    basisQ(side, dir, d.q).multiply(d.pre);
    d.bone.quaternion.copy(_pq.copy(parentQ).invert()).multiply(d.q);
  };

  // s: пройденный путь в метрах, task: секунды с начала страховки (0 нет), strike: в этом кадре ударил по колу
  const st = { s: sAt(START_Z), z: START_Z, tg: 0, brace: 0, braceK: 0, slip: 0, beat: -1, task: 0, taskK: 0, strike: false,
    rest: 0, restAt: 9, gap: 12, hits: [], fall: 0, fall0: 0, fallD: 0 }; // fall: секунды с начала срыва // rest: секунды передышки, gap: метров до следующей страховки, hits: удары ледорубов и кошек за кадр
  const base = V(), n = V().set(0, 0.62, 0.78), fwd = V(), right = V(), left = V(), hips = V(), torso = V(), back = V(), look = V();
  const torsoPos = V(), headPos = V(), skull = V(), headUp = V(), lampPos = V(), toe = V(), twist = V();
  const hipsQ = Q(), torsoQ = Q(), headQ = Q(), aq = Q(), gaze = V(), gazeTo = V(), lookTo = V();
  let gazeAt = 0, blinkAt = 0, blink = 0;
  const fwd0 = V(), right0 = V(), anchors = [], pk = V(), aDir = V(), hand = V(), axeDir = V(), axeSide = V(), picketTop = V(), mouth = V(), flail = V();

  // точка склона на пути s, lat метров вправо от маршрута
  const wander = (s) => 0.2 * Math.sin(s * 0.83) + 0.1 * Math.sin(s * 2.1 + 1); // тропа петляет, а не идёт по линейке
  function surf(s, lat, out) { const z = zAt(s), x = routeX(z) + lat; return out.set(x, height(x, z), z); }
  // куда встанет конечность: ноги чуть мимо решётки, каждая ступень по-своему (те же сдвиги в шейдере следов)
  function step(L, out) {
    const K = Math.floor(L.sTo / L.st + 0.5), j = L.hand ? 0 : 1, s = L.sTo + j * 0.05 * Math.sin(K * 1.713 + 2 * L.s);
    return surf(s, L.lat * L.s + j * 0.09 * Math.sin(K * 2.399 + L.s) + wander(s), out);
  }
  // Следы лежат на решётке: ледорубы через STRIDE, ступени через половину. Стоящие конечности ставим в её узлы.
  function plant() {
    for (const L of LIMBS) {
      L.sTo = Math.floor((st.s + L.along - L.phase) / L.st) * L.st + L.phase;
      step(L, L.cur); L.from.copy(L.cur); L.to.copy(L.cur); L.t0 = -9; L.planted = L.sTo; L.tset = false;
    }
  }
  // кол торчит из склона с наклоном вверх, петля лежит ниже него; depth: насколько вбит
  function setPicket(i, p, depth) {
    normalAt(p.x, p.z, 1, _n);
    _b.crossVectors(_a.crossVectors(Y, _n).normalize(), _n).negate(); // вверх по склону
    aDir.copy(_n).multiplyScalar(0.9).addScaledVector(_b, 0.42).normalize();
    pickets.setMatrixAt(i, _m.compose(_a.copy(p).addScaledVector(aDir, -depth), aq.setFromUnitVectors(Y, aDir), _one));
    slings.setMatrixAt(i, _m.compose(_a.copy(p).addScaledVector(_b, -0.07).addScaledVector(_n, 0.015), aq.setFromUnitVectors(Z, _n), _one));
    pickets.instanceMatrix.needsUpdate = slings.instanceMatrix.needsUpdate = true;
  }
  let ropeN = HEAD, ropeTo = null;
  const RP = Array.from({ length: HEAD }, () => ({ p: V(), q: V() })); // точки живой части верёвки: где сейчас и где были кадр назад
  function addAnchor(s) {
    const p = surf(s, 0.55, V());
    setPicket(anchors.length, p, 0.24);
    anchors.push({ s, p });
    pickets.count = slings.count = anchors.length;
    // Верёвка ниже последней точки неподвижна: лежит на снегу от кола к колу и уходит к подножию. Точки через 30 см и на 3 см над склоном:
    // через 1.2 м отрезок между точками нырял под снег, и верёвка пропадала кусками. Лежит она не по линейке, а слабыми петлями.
    let k = HEAD;
    const put = (x, z, w) => { if (k < ROPE) { const dx = 0.05 * w * Math.sin(k * 0.37) + 0.03 * w * Math.sin(k * 0.11 + 2); ropePts.set([x + dx, height(x + dx, z) + 0.03, z], k * 3); k++; } };
    for (let i = anchors.length - 1; i > 0; i--) {
      const a = anchors[i].p, b = anchors[i - 1].p, m = Math.ceil(a.distanceTo(b) / 0.3);
      for (let j = 0; j < m; j++) put(a.x + ((b.x - a.x) * j) / m, a.z + ((b.z - a.z) * j) / m, Math.sin((Math.PI * j) / m)); // у самих крючьев петель нет: там она встёгнута
    }
    for (let q = anchors[0].s; q > 0; q -= 0.6) { const z = zAt(q); put(routeX(z) + 0.55, z, 1); }
    ropeN = k;
    tube(HEAD - 1, ropeN, ropeN);
    rope.geometry.setDrawRange(0, (ropeN - 1) * SIDES * 6);
  }
  function restart() {
    Object.assign(st, { s: sAt(START_Z), brace: 0, slip: 0, task: 0, rest: 0 });
    anchors.length = 0;
    const below = []; // уже пройденные точки страховки; ближайшая в 8.5 м ниже, так что новую он ставит секунд через десять
    for (let s = st.s - 8.5; s > sAt(332); s -= 12) below.unshift(s);
    below.forEach(addAnchor);
    plant();
  }
  restart();

  function update(dt, camera) {
    st.strike = false; st.hits.length = 0;
    const g = ground(st.z); // что под ним: 0 снег, 1 лёд, 2 скала. От этого зависит манера
    if (st.slip > 0) { const d = Math.min(st.slip, dt * 3.5); st.slip -= d; st.s -= d; plant(); } // снег ушёл из-под ног
    st.tg += dt;
    const settled = LIMBS.every((L) => st.tg - L.t0 > L.dur);
    // Срыв: опора ушла, он летит вниз по склону с разгоном, пока верёвка не дёрнет, потом приходит в себя и вбивается заново.
    if (st.fall > 0) {
      st.fall += dt;
      const p = Math.min(1, st.fall / 1.15);
      st.s = st.fall0 - st.fallD * p * p - (st.fall > 1.15 ? 0.4 * Math.exp(-(st.fall - 1.15) * 3) * Math.sin((st.fall - 1.15) * 9) : 0); // верёвка пружинит: сначала протягивает ниже, потом подбрасывает
      plant();
      if (st.fall > 3) { st.fall = 0; st.brace = Math.max(st.brace, 1.5); }
    } else if (st.brace > 0) st.brace -= dt; // вжался в склон и ждёт
    else if (st.task > 0) {
      for (const h of HITS) if (st.task < h && st.task + dt >= h) st.strike = true;
      if (st.task < CLIP_T && st.task + dt >= CLIP_T) addAnchor(st.s + 0.75);
      st.task = st.task + dt > TASK_T ? 0 : st.task + dt;
    } else if (settled && st.s + 0.75 - anchors[anchors.length - 1].s >= st.gap) { st.task = 1e-4; st.gap = 10 + Math.random() * 6; }
    else if (st.rest > 0) st.rest -= dt; // передышка: висит на ледорубах, дышит, оглядывается
    else if (settled && st.tg > st.restAt) { st.rest = 1.5 + Math.random() * 3.5; st.restAt = st.tg + 9 + Math.random() * 16; }
    else {
      st.s += SPEED * dt * [1, 0.6, 0.45][g] * (0.75 + 0.5 * (0.5 + 0.5 * Math.sin(st.tg * 0.31) * Math.sin(st.tg * 0.113 + 1))); // темп плавает; по льду и скале медленнее
      const b = Math.floor(st.s / (STRIDE / 6));
      if (b !== st.beat) {
        st.beat = b;
        const L = LIMBS[SEQ[((b % 6) + 6) % 6]];
        L.from.copy(L.cur); L.sTo = Math.floor((st.s + L.along + L.st * 0.55 - L.phase) / L.st + 0.5) * L.st + L.phase;
        step(L, L.to); L.t0 = st.tg;
        // снег: обычный шаг. Лёд: широкий замах и почти всегда перебивает, пока клюв не сядет. Скала: медленно и аккуратно цепляет зацепку.
        L.dur = MOVE * (L.hand ? 1 : 0.75) * (0.8 + 0.6 * Math.random()) * [1, 1.1, 1.6][g]; // короткий шаг ногой быстрее замаха L.k = (0.7 + 0.8 * Math.random()) * [1, 1.3, 0.45][g];
        L.again = Math.random() < (L.hand ? [0.35, 0.75, 0.15] : [0.2, 0.5, 0.1])[g];
      }
    }
    st.z = zAt(st.s);
    st.braceK += ((st.brace > 0 ? 1 : 0) - st.braceK) * (1 - Math.exp(-dt * 5));
    st.taskK += ((st.task > 0 ? 1 : 0) - st.taskK) * (1 - Math.exp(-dt * 4));
    const bk = st.braceK, tk = st.taskK;
    // fk: насколько тело болтается в срыве; jerk: рывок верёвки
    const fk = st.fall > 0 ? Math.min(1, st.fall / 0.25) * (1 - Math.min(1, Math.max(0, (st.fall - 1.9) / 1.0))) : 0;
    const jerk = st.fall > 1.15 ? 0.25 * Math.exp(-(st.fall - 1.15) * 4) * Math.cos((st.fall - 1.15) * 14) : 0;
    // Срыв по порядку. Его сбивает с ног и разворачивает боком к склону, он катится через бок и скользит вниз.
    // Верёвка дёргает: разворачивает головой вверх, качает маятником под крюком. Потом он лежит на склоне и зарубается заново.
    const tf = st.fall, tc = tf - 1.15, dir = st.fallDir ?? 1; // секунды с начала срыва и с рывка верёвки; в какую сторону его развернуло
    const spin = tf <= 0 ? 0 : dir * 1.5 * (tc < 0 ? ease(Math.min(1, tf / 0.9)) : Math.exp(-tc * 3.5) * Math.cos(tc * 6));
    const roll = tf > 0 && tc < 0 ? dir * Math.PI * 2 * ease(Math.min(1, Math.max(0, (tf - 0.15) / 0.75))) : 0; // один оборот через бок
    const sway = tc > 0 ? 0.55 * (1 - Math.exp(-tc * 1.3) * Math.cos(tc * 3.2)) * (1 - Math.min(1, Math.max(0, (tf - 2.3) / 0.7))) : 0; // крюк стоит правее тропы: туда его и уводит
    const tum = tf <= 0 ? 0 : tc < 0 ? Math.min(1, tf / 0.2) : Math.exp(-tc * 5); // 1 пока кувыркается, 0 когда уже лежит

    // Цикл как у ледолазов: пока бьёт ледорубами, стоит высоко на прямых ногах; подшагивает, повиснув на прямых руках; потом встаёт.
    const bob = st.fall > 0 ? 0 : 0.03 * Math.sin(Math.PI * 4 * (st.s / STRIDE) + 0.52); // выше всего на замахе ледорубом, дважды за цикл
    surf(st.s + bob, 0.035 * Math.sin((st.s / STRIDE) * Math.PI) + wander(st.s) + sway, base);
    normalAt(base.x, base.z, 1.5, _n);
    n.lerp(_n, 1 - Math.exp(-dt * 4)).normalize();
    fwd.subVectors(surf(st.s + 0.4, 0, _a), surf(st.s - 0.4, 0, _b));
    right.crossVectors(fwd, n).normalize();
    fwd.crossVectors(n, right).normalize();
    left.copy(right).negate();
    if (tf > 0) { // тело развёрнуто на склоне; камере наружу отдаём прежние оси (возвращаются в конце кадра)
      fwd0.copy(fwd); right0.copy(right);
      fwd.multiplyScalar(Math.cos(spin)).addScaledVector(right0, Math.sin(spin)); right.multiplyScalar(Math.cos(spin)).addScaledVector(fwd0, -Math.sin(spin)); left.copy(right).negate();
    }
    for (const L of LIMBS) {
      const u = Math.min(1, Math.max(0, (st.tg - L.t0) / L.dur));
      L.cur.lerpVectors(L.from, L.to, ease(u)).addScaledVector(n, L.lift * L.k * Math.sin(Math.PI * u));
      if (!L.hand) L.cur.addScaledVector(toe, -0.1 * Math.sin(Math.PI * u)); // нога отводится и бьёт носком в склон
      if (u >= 1 && L.u < 1) st.hits.push({ p: L.cur.clone(), kind: ground(zAt(L.sTo)), hand: L.hand }); // в этом кадре вбил
      if (u >= 1) {
        L.planted = L.sTo;
        if (L.again) { L.again = false; L.from.copy(L.to); L.t0 = st.tg; L.dur = 0.3; L.k = 1.2; }
      }
      L.u = u;
    }
    let reach = 0, push = 0, lean = 0, swing = 0; // тянется рукой, толкается ногой, переносит вес на опорную ногу; swing: какая рука бьёт
    for (const L of LIMBS) { const w = Math.sin(Math.PI * L.u); if (L.hand) { reach = Math.max(reach, w); swing += L.s * w; } else { push = Math.max(push, w); lean -= L.s * w; } }
    G.uPlanted.value.set(LIMBS[0].planted, LIMBS[1].planted, LIMBS[2].planted, LIMBS[3].planted);
    // Лицо живёт: в пургу щурится сильнее, моргает, стискивает зубы на замахе, на ударе молотком и в срыве.
    if (st.tg > blinkAt) { blink = 0.16; blinkAt = st.tg + 1.5 + Math.random() * 4; }
    blink = Math.max(0, blink - dt);
    const strain = Math.min(1, Math.max(reach, st.strike ? 1 : 0, fk, 0.8 * bk));
    grim.value += (0.3 + 0.7 * strain - grim.value) * (1 - Math.exp(-dt * (0.3 + 0.7 * strain > grim.value ? 14 : 3)));
    squint.value = Math.min(3.2, 0.4 + 0.5 * Math.min(1, G.uFlakeA.value / 0.6) + 0.3 * grim.value + 2.6 * Math.sin((Math.PI * blink) / 0.16));

    // корпус наклонён к склону, грудью к нему; в обвал прижимается ближе, у кола доворачивается к нему
    st.out = (st.out ?? 0) + ([0, -0.07, 0.07][g] - (st.out ?? 0)) * (1 - Math.exp(-dt * 1.5)); // на льду жмётся к стене, на скале отходит от неё
    hips.copy(base).addScaledVector(n, OFF + st.out - 0.14 * bk + 0.012 * Math.sin(st.tg * 2.4) + (0.2 * tum - 0.06) * fk + jerk).addScaledVector(fwd, 0.03 * Math.sin((st.s / STRIDE) * Math.PI * 4) + 0.05 * push).addScaledVector(right, 0.05 * lean).addScaledVector(n, -0.04 * reach + 0.07 * push); // дышит; таз от склона, когда ставит ноги, и к склону, когда бьёт
    torso.copy(fwd).multiplyScalar(0.95).addScaledVector(n, TILT - 0.14 * bk - 0.15 * fk * (1 - tum)).addScaledVector(right, 0.1 * fk * Math.sin(st.tg * 5)).normalize(); // в срыве лежит на животе головой вверх по склону
    back.crossVectors(right, torso).normalize();
    if (roll) { _a.copy(right); right.multiplyScalar(Math.cos(roll)).addScaledVector(back, Math.sin(roll)); back.multiplyScalar(Math.cos(roll)).addScaledVector(_a, -Math.sin(roll)); left.copy(right).negate(); } // катится через бок
    surf(st.s + 0.75, 0.55, pk); // сюда встанет следующий кол
    if (st.tg > gazeAt) { gazeTo.set((Math.random() - 0.5) * 1.2, Math.random() < 0.3 ? 0.5 : 0, 0); gazeAt = st.tg + 1.5 + Math.random() * 3.5; }
    gaze.lerp(gazeTo, 1 - Math.exp(-dt * 2.5));
    // Смотрит туда, куда вбивает ледоруб, а когда переставляет ногу, вниз на эту ногу: так учат лазать по льду.
    // Между движениями глядит на склон перед собой. Вверх поднимает глаза только изредка на передышке.
    let aim = null;
    for (const L of LIMBS) if (L.u < 1) aim = L.to;
    if (st.gazeUp) lookTo.copy(fwd).multiplyScalar(0.85).addScaledVector(n, -0.5).normalize(); // кадр на очки: поднимает голову к вершине
    else if (aim) lookTo.subVectors(aim, headPos).normalize();
    else if (tk > 0.5) lookTo.subVectors(pk, headPos).normalize();
    else lookTo.copy(fwd).multiplyScalar(0.45 + (st.rest > 0 ? gaze.y : 0)).addScaledVector(n, -0.85).addScaledVector(right, gaze.x * 0.4).normalize();
    look.lerp(lookTo, 1 - Math.exp(-dt * 3.5)); // голову поворачивает плавно, без рывков
    // шея гнётся как у человека: вверх не больше 37 градусов, вниз 48, в стороны 45
    const f = Math.max(0.2, -look.dot(back)), up = Math.min((st.gazeUp ? 1.3 : 0.75) * f, Math.max(-1.1 * f, look.dot(torso))), side = Math.min(f, Math.max(-f, look.dot(right)));
    look.copy(back).multiplyScalar(-f).addScaledVector(torso, up).addScaledVector(right, side).normalize();
    twist.copy(left).addScaledVector(back, 0.22 * swing - 0.3 * tk); // плечо идёт вперёд за рукой, которая бьёт
    basisQ(left, torso, hipsQ); basisQ(twist, torso, torsoQ);
    if (rig) {
      torsoPos.copy(rig.torsoOff).applyQuaternion(hipsQ).add(hips);
      headPos.copy(rig.headOff).applyQuaternion(torsoQ).add(torsoPos);
    } else { torsoPos.copy(hips).addScaledVector(torso, 0.06); headPos.copy(torsoPos).addScaledVector(torso, 0.46); }
    headUp.crossVectors(look, left).normalize(); // оси модели: Z x X = Y
    basisQ(left, headUp, headQ);
    skull.copy(headPos).addScaledVector(headUp, 0.17).addScaledVector(look, 0.03); // центр черепа над костью шеи
    face.position.copy(skull); face.quaternion.copy(headQ);

    // --- страховка: положение крюка и правой руки по секундам ---
    const t = st.task, depth = 0.08 + 0.04 * HITS.filter((h) => t >= h).length;
    const held = t > 2.0 && t < 4.9; // ледоруб в руке, а не в склоне
    if (t > 0) {
      const R0 = LIMBS[0];
      aDir.copy(n).multiplyScalar(0.9).addScaledVector(fwd, 0.42).normalize();
      picketTop.copy(pk).addScaledVector(aDir, 0.3 - depth);
      _z.copy(right).multiplyScalar(0.9).addScaledVector(fwd, 0.3);
      _z.addScaledVector(aDir, -_z.dot(aDir)).normalize(); // древко при ударе: от тела к крюку, поперёк его оси
      // куда идёт кисть в каждой точке расписания и как при этом лежит ледоруб (dir: древко, side: ось для basisQ)
      const key = (name, out, dir, side) => {
        dir.copy(R0.td); side.copy(left);
        if (name === 'belt') out.copy(hips).addScaledVector(right, 0.24).addScaledVector(torso, 0.02);
        else if (name === 'place') out.copy(pk).addScaledVector(aDir, 0.12);
        else if (name === 'clip') out.copy(pk).addScaledVector(fwd, -0.08).addScaledVector(n, 0.05);
        else if (name === 'hit' || name === 'up') {
          const a = name === 'up' ? 1.1 : 0; // замах: поворот в кисти, молоток уходит от крюка
          dir.copy(_z).multiplyScalar(Math.cos(a)).addScaledVector(aDir, Math.sin(a));
          side.crossVectors(_z, aDir);
          out.copy(picketTop).addScaledVector(_z, -0.43).addScaledVector(aDir, 0.058 + (a ? 0.05 : 0));
        } else out.copy(R0.tp).addScaledVector(R0.td, GRIP);
      };
      let i = KEYS.findIndex((k) => k[0] > t);
      if (i < 1) i = KEYS.length - 1;
      const w = (t - KEYS[i - 1][0]) / (KEYS[i][0] - KEYS[i - 1][0]), u = KEYS[i][1] === 'hit' ? w * w : ease(w); // удар разгоняется
      key(KEYS[i - 1][1], _a, _x, _p); key(KEYS[i][1], _b, _y, _q);
      hand.lerpVectors(_a, _b, u); axeDir.lerpVectors(_x, _y, u).normalize(); axeSide.lerpVectors(_p, _q, u).normalize();
      pickets.count = slings.count = anchors.length;
      if (t > 0.6 && t < CLIP_T) { // крюк сначала в руке, потом в склоне и уходит глубже с каждым ударом
        const inHand = 1 - ease(Math.min(1, Math.max(0, (t - 1.0) / 0.4)));
        pickets.setMatrixAt(anchors.length, _m.compose(_a.copy(pk).addScaledVector(aDir, -depth).lerp(_b.copy(hand).addScaledVector(aDir, -0.2), inHand), aq.setFromUnitVectors(Y, aDir), _one));
        pickets.instanceMatrix.needsUpdate = true;
        pickets.count = anchors.length + 1;
      }
    }

    // плоская стопа смотрит носком в склон
    toe.set(-n.x, 0.15, -n.z).normalize();
    if (rig) {
      // Если до какой-то опоры всё же не хватает длины руки или ноги, тело чуть подтягивается к ней. Слишком поджатую ногу, наоборот, отпускает.
      _h.set(0, 0, 0);
      for (let it = 0; it < 4; it++) LIMBS.forEach((L, i) => {
        const R = rig.limbs[i];
        if (fk > 0.05) return; // в срыве руки и ноги болтаются сами
        if (L.hand) {
          if (L.u < 1 || L.sh > 0.01 || (i === 0 && t > 0)) return; // рука в замахе, отдыхает или занята крюком: она сама идёт за телом
          if (L.tset) _t.copy(L.tp).addScaledVector(L.td, GRIP); else _t.copy(L.cur).addScaledVector(n, 0.12).addScaledVector(fwd, GRIP - 0.43);
          _t.addScaledVector(L.fd, -HOLD);
          _s.copy(R.off).applyQuaternion(torsoQ).add(torsoPos).add(_h);
        } else {
          _t.copy(L.cur).addScaledVector(toe, -TOE).addScaledVector(Y, SOLE);
          _s.copy(R.off).applyQuaternion(hipsQ).add(hips).add(_h);
        }
        const len = _d.subVectors(_t, _s).length(), far = (R.l1 + R.l2) * 0.96, near = (R.l1 + R.l2) * 0.5;
        if (len > far) _h.addScaledVector(_d, 1 - far / len); else if (!L.hand && len < near) _h.addScaledVector(_d, 1 - near / len);
      });
      if (fk <= 0.05) {
        const df = _h.dot(fwd); if (df < -0.1) _h.addScaledVector(fwd, -0.1 - df); // вниз к дальней ступне не больше 10 см: иначе вторая нога сминалась коленом к груди
        for (const L of LIMBS) if (!L.hand && L.room < 0.16) _h.addScaledVector(n, 0.16 - L.room); // колену тесно у склона: таз отходит от стены, а не колено уезжает вбок
      }
      st.pull = (st.pull ?? V()).lerp(_h.clampLength(0, 0.3), 1 - Math.exp(-dt * 6)); // немного и плавно: большой сдвиг уводил таз от ног
      hips.add(st.pull); torsoPos.add(st.pull); headPos.add(st.pull); skull.add(st.pull); face.position.copy(skull);
      rig.hips.bone.position.copy(rig.hipsParent.worldToLocal(_a.copy(hips)));
      drive(rig.hips, left, torso, rig.rootQ);
      drive(rig.torso, twist, torso, rig.hips.q);
      drive(rig.head, left, headUp, rig.torso.q);
    }
    LIMBS.forEach((L, i) => {
      const R = rig?.limbs[i];
      if (L.hand) {
        const swing = L.u < 1, busy = i === 0 && t > 0, sink = [0.06, 0.035, 0.02][ground(zAt(L.sTo))]; // в снег клюв уходит глубже, чем в лёд и скалу
        if (swing) L.tset = false;
        else if (!L.tset) { // вбил: ледоруб замирает в склоне и больше не ходит за телом, иначе он дрожит
          L.tset = true; L.td.copy(fwd); L.tp.copy(L.cur).addScaledVector(n, 0.17 - sink).addScaledVector(fwd, -0.43); basisQ(left, fwd, L.tq);
        }
        const loose = fk > 0.05; // в срыве руки и ноги болтаются, ледорубы вырваны из склона
        if (loose) L.tset = false;
        // _t: где должна быть середина кулака. Он сжат вокруг рукояти, а не висит под ней.
        if (busy) _t.copy(hand);
        else if (swing) _t.copy(L.cur).addScaledVector(n, 0.17 - sink).addScaledVector(fwd, GRIP - 0.43).addScaledVector(right, 0.2 * L.s * Math.sin(Math.PI * L.u)); // замах идёт дугой наружу: по прямой кулак проходил сквозь плечо
        else _t.copy(L.tp).addScaledVector(L.td, GRIP);
        if (R) {
          _s.copy(R.off).applyQuaternion(torsoQ).add(torsoPos);
          // пока катится, руки раскинуты; когда лёг, зарубается: клювы у плеч, вдавлены в снег
          if (loose) _t.lerp(flail.copy(_s).addScaledVector(fwd, 0.12).addScaledVector(n, -0.32).addScaledVector(right, 0.04 * L.s).lerp(_b.copy(_s).addScaledVector(torso, 0.1 + 0.08 * Math.sin(st.tg * 11 + i)).addScaledVector(right, 0.4 * L.s).addScaledVector(back, -0.08), tum), fk);
          // на передышке левая рука отпускает ледоруб, свисает и встряхивается
          L.sh += ((i === 2 && st.rest > 0.4 ? 1 : 0) - L.sh) * (1 - Math.exp(-dt * 3.5)); // опускает руку не рывком
          if (L.sh > 0.01) _t.lerp(_b.copy(_s).addScaledVector(fwd, -0.53).addScaledVector(n, 0.06).addScaledVector(right, 0.04 * L.s + 0.03 * Math.sin(st.tg * 14)), L.sh); // почти прямая, вдоль тела: согнутая и отведённая на 12 см читалась оттопыренным локтем
          if (loose) _t.y = Math.max(_t.y, height(_t.x, _t.z) + 0.1); // в срыве рука не уходит под снег
          _t.addScaledVector(L.fd, -HOLD); // запястье позади кулака: по тому, как предплечье лежало кадр назад
          // На замахе и когда рука свободна, кисть не подходит к плечу ближе половины длины руки: обходит его спереди и чуть снаружи.
          // Иначе кулак проходил в десяти сантиметрах от плеча, рука складывалась целиком, и локоть перекидывало рывком.
          if (swing || loose || L.sh > 0.01) {
            const lo = (R.l1 + R.l2) * 0.55, d = _b.subVectors(_t, _s).length();
            if (d < lo) _t.copy(_s).add(_b.addScaledVector(n, d - lo).addScaledVector(right, 0.5 * L.s * (lo - d)).setLength(lo)); // перед плечом, между ним и склоном
          }
          // Локоть смотрит наружу и от склона, чуть вниз. Раньше «вниз» было главным: у руки, висящей на передышке, это почти вдоль самой руки,
          // сторона локтя становилась случайной, и предплечье за один кадр перекидывалось на 90 градусов.
          // Когда кисть выше плеча (тянется к ледорубу или подтягивается на нём), локоть уходит вниз и наружу, почти в плоскости склона:
          // торчащий от склона локоть на подтягивании выглядел заломленной рукой.
          const upw = Math.min(1, Math.max(0, (_b.subVectors(_t, _s).normalize().dot(fwd) + 0.2) / 0.7)), uw = upw * upw * (3 - 2 * upw);
          _q.copy(right).multiplyScalar(0.5 * L.s).addScaledVector(n, 0.6 - 0.45 * uw).addScaledVector(fwd, -0.25 - 0.55 * uw);
          const k = stretch(R, _s, _t);
          ik(_s, _t, R.l1 * k, R.l2 * k, _q, _j);
          // Локоть не проходит сквозь корпус: если он ближе 20 см к оси тела, сгиб доворачивается наружу.
          _b.subVectors(_j, hips); const ax = _b.dot(torso), near = _b.addScaledVector(torso, -ax).length();
          if (near < 0.2 && ax > -0.1 && ax < 0.75) { _q.addScaledVector(right, L.s * Math.min(1.5, (0.2 - near) * 12)); ik(_s, _t, R.l1 * k, R.l2 * k, _q, _j); }
          _e.subVectors(_t, _j).setLength(R.l2 * k).add(_j);
          drive(R.up, _hinge, _a.subVectors(_j, _s), rig.torso.q);
          // Плечо идёт за рукой плавно: промежуточные кости стоят на трети и двух третях подъёма руки от положения «опущена».
          // Считаем в осях корпуса: насколько рука поднята (th) и в какую сторону (ph: 0 вперёд к склону). Когда рука смотрит почти
          // точно вверх, сторона подъёма теряет смысл и скачет, поэтому там она плавно сводится к «вперёд», как руку поднимает человек.
          _vA.copy(_a).normalize(); _u0.copy(torso).negate().normalize();
          _v0.copy(twist).negate(); _v0.addScaledVector(_u0, -_v0.dot(_u0)).normalize(); _um.crossVectors(_v0, _u0); // бок и перед корпуса
          const th = Math.acos(Math.max(-1, Math.min(1, _u0.dot(_vA)))), hx = _vA.dot(_um), hy = _vA.dot(_v0);
          const ph = (hx * hx + hy * hy > 1e-8 ? Math.atan2(hy, hx) : 0) * (1 - THREE.MathUtils.smoothstep(th, 2.3, 3));
          _uh.copy(_um).multiplyScalar(Math.cos(ph)).addScaledVector(_v0, Math.sin(ph)); _vm.crossVectors(_u0, _uh); // куда поднята и вокруг какой оси
          // Скрутка плеча: на сколько ось локтя повёрнута относительно бока, перенесённого подъёмом без скрутки. Делится между костями поровну.
          // По замеру она держится от -90 до 0 градусов, поэтому разрыв отсчёта отодвинут на 135.
          // Бок переносим вокруг той же устойчивой оси, что и кости: ось по самой руке у поднятой вверх руки скачет.
          _vh.copy(_v0).multiplyScalar(Math.cos(th)).addScaledVector(_w1.crossVectors(_vm, _v0), Math.sin(th)).addScaledVector(_vm, _vm.dot(_v0) * (1 - Math.cos(th)));
          _vh.addScaledVector(_vA, -_vA.dot(_vh)).normalize();
          _w1.copy(_hinge).addScaledVector(_vA, -_vA.dot(_hinge)).normalize();
          let tw = Math.atan2(_vA.dot(_w0.crossVectors(_vh, _w1)), _vh.dot(_w1)) * L.s;
          if (tw > 2.36) tw -= Math.PI * 2; // разрыв отсчёта стоит напротив обычной скрутки
          L.tw = tw; // для проверки из консоли
          R.mid.forEach((h, k) => {
            const t = (k + 1) / 3, a = th * t, ps = tw * L.s * t;
            _w0.copy(_u0).multiplyScalar(Math.cos(a)).addScaledVector(_uh, Math.sin(a)); // куда смотрит кость
            _w1.copy(_v0).multiplyScalar(Math.cos(a)).addScaledVector(_w2.crossVectors(_vm, _v0), Math.sin(a)).addScaledVector(_vm, _vm.dot(_v0) * (1 - Math.cos(a))); // её бок без скрутки
            _w2.crossVectors(_w0, _w1); _w1.multiplyScalar(Math.cos(ps)).addScaledVector(_w2, Math.sin(ps)); // и со своей долей скрутки
            drive(h, _w1, _w0, rig.torso.q);
          });
          L.j0.copy(_s); L.j1.copy(_j); // плечо и локоть: рукав выталкивает из себя лямку рюкзака
          drive(R.low, _hinge, _a.subVectors(_e, _j), R.up.q);
          L.fd.copy(_a).normalize();
          _e.addScaledVector(L.fd, HOLD); // свободный кулак сразу за запястьем, костяшками вдоль предплечья
          _h.copy(_hinge); basisQ(_a.crossVectors(_h, L.fd), _h, _fq);
        } else { _e.copy(_t); _fq.copy(L.tq); }
        if (busy && held) { // в руке: бьёт молотком по крюку
          L.tool.position.copy(hand).addScaledVector(axeDir, -GRIP);
          basisQ(axeSide, axeDir, L.tool.quaternion);
        } else if (swing || loose) { // в замахе древко отклоняется от склона и с ударом возвращается
          _a.copy(fwd).addScaledVector(n, 0.9 * Math.sin(Math.PI * L.u) * L.k).normalize();
          L.tool.position.copy(_e).addScaledVector(_a, -GRIP);
          basisQ(left, _a, L.tool.quaternion);
        } else { L.tool.position.copy(L.tp); L.tool.quaternion.copy(L.tq); }
        // Пока рука у ледоруба, рукавица сидит точно на рукояти и повёрнута вместе с ней; отпустил, идёт за предплечьем.
        _a.set(0, GRIP, 0).applyQuaternion(L.tool.quaternion).add(L.tool.position);
        const hold = 1 - THREE.MathUtils.smoothstep(_a.distanceTo(_e), 0.03, 0.12);
        L.fist.position.copy(_e).lerp(_a, hold); L.fist.quaternion.copy(_fq).slerp(L.tool.quaternion, hold);
      } else if (R) {
        _t.copy(L.cur).addScaledVector(toe, -TOE).addScaledVector(Y, SOLE); // щиколотка позади носка, вбитого в склон
        _s.copy(R.off).applyQuaternion(hipsQ).add(hips);
        if (fk > 0.05) _t.lerp(flail.copy(_s).addScaledVector(torso, -0.7).addScaledVector(right, 0.25 * L.s).addScaledVector(n, 0.12 + 0.1 * Math.sin(st.tg * 8 + i)).lerp(_b.copy(_s).addScaledVector(torso, -0.72).addScaledVector(right, 0.3 * L.s).addScaledVector(back, -0.14 * Math.sin(st.tg * 9 + i)), tum), fk); // катится: ноги врозь и болтаются; лёг: лежат на склоне
        if (fk > 0.05) _t.y = Math.max(_t.y, height(_t.x, _t.z) + 0.12); // и нога тоже
        // Колено гнётся к склону и чуть наружу, как у человека лицом к стене: голень ложится вдоль склона.
        _q.copy(n).multiplyScalar(-1).addScaledVector(right, 0.2 * L.s).addScaledVector(fwd, 0.25);
        let k = stretch(R, _s, _t);
        ik(_s, _t, R.l1 * k, R.l2 * k, _q, _j);
        const room = L.room = (_j.y - height(_j.x, _j.z)) * n.y; // запоминаем: в следующем кадре от тесноты отойдёт таз
        if (room < 0.14) { _q.addScaledVector(right, L.s * Math.min(0.35, (0.14 - room) * 6)); ik(_s, _t, R.l1 * k, R.l2 * k, _q, _j); } // колену тесно: чуть наружу, не дальше, чем пускает лодыжка
        // Лодыжка: ботинок доворачивается за голенью, а носок остаётся в своей ступени. Поворот сдвигает лодыжку, поэтому ногу решаем второй раз.
        _toe.copy(_t).addScaledVector(toe, TOE).addScaledVector(Y, -SOLE);
        for (let pass = 0; pass < 2; pass++) {
          ankle(toe, left, _a.subVectors(_j, _t).normalize(), _b.copy(_hinge).normalize(), _bf, _bu);
          if (pass) break;
          _t.copy(_toe).addScaledVector(_bf, -TOE).addScaledVector(_bu, SOLE);
          k = stretch(R, _s, _t);
          ik(_s, _t, R.l1 * k, R.l2 * k, _q, _j);
        }
        L.j0.copy(_s); L.j1.copy(_j); // бедро от таза до колена: об него стукается железо на поясе
        _e.subVectors(_t, _j).setLength(R.l2 * k).add(_j);
        L.j2.copy(_e); L.j3.copy(_e).addScaledVector(_bf, 0.1).addScaledVector(_bu, -0.06); // лодыжка и носок: их обходит верёвка
        drive(R.up, _hinge, _a.subVectors(_j, _s), rig.hips.q);
        drive(R.low, _hinge, _a.subVectors(_e, _j), R.up.q);
        drive(R.end, _a.crossVectors(_bu, _bf), _bf, R.low.q);
      }
    });

    if (rig) [0, 2, 1, 3].forEach((i, k) => { caps.uCapA.value[k].copy(LIMBS[i].j0); caps.uCapB.value[k].copy(LIMBS[i].j1); caps.uCapR.value[k] = rig.limbs[i].rad; });
    mouth.copy(skull).addScaledVector(look, 0.11).addScaledVector(headUp, -0.06);
    lampPos.copy(LAMP).applyQuaternion(headQ).add(skull);
    lamp.position.copy(lampPos); lamp.quaternion.copy(headQ);
    // Железо на обвязке: маятник на петле. Качается от движения и рывков, не проходит сквозь бедро и склон.
    if (rig) for (const R of racks) {
      _a.set(rig.rackAt[0] * R.s, rig.rackAt[1], rig.rackAt[2]).applyQuaternion(hipsQ).add(hips);
      // Железо не проходит сквозь ногу. Когда бедро поднимается к поясу, петля с карабинами ложится поверх него,
      // а связка висит снаружи: её конец и середина не подходят к оси бедра ближе, чем толщина ноги в пуховике.
      const leg = LIMBS[1].j0.distanceToSquared(_a) < LIMBS[3].j0.distanceToSquared(_a) ? LIMBS[1] : LIMBS[3];
      const thick = rig.limbs[leg === LIMBS[1] ? 1 : 3].rad;
      clearOf(_a, leg, thick, R.s);
      if (!R.m.visible || R.p.distanceTo(_a) > 1) { R.p.copy(_a).y -= 0.18; R.q.copy(R.p); R.m.visible = true; }
      _b.subVectors(R.p, R.q).multiplyScalar(0.97); R.q.copy(R.p); R.p.add(_b).y -= 9.8 * dt * dt;
      R.p.addScaledVector(left, R.s * Math.max(0, rig.rackAt[0] - 0.01 - R.s * _b.subVectors(R.p, hips).dot(left)));
      R.p.y = Math.max(R.p.y, height(R.p.x, R.p.z) + 0.05);
      for (let it = 0; it < 2; it++) {
        R.p.sub(_a).setLength(0.18).add(_a);
        clearOf(R.p, leg, thick + 0.015, R.s);
        _e.copy(_h.lerpVectors(_a, R.p, 0.5)); clearOf(_h, leg, thick, R.s); R.p.addScaledVector(_h.sub(_e), 2);
      }
      R.m.position.copy(_a); basisQ(back, _d.subVectors(_a, R.p), R.m.quaternion);
    }

    // Верёвка от узла на обвязке до последнего крюка: цепочка точек с весом, лежит на склоне, с запасом на провис.
    // Ветер треплет её порывами, каждое звено по-своему. В срыве она провисает и хлещет, потом натягивается.
    _a.copy(hips).addScaledVector(back, -0.17).addScaledVector(torso, -0.03); // узел спереди, верёвка уходит вниз между ног
    // Первые восемь звеньев короткие, по 12 см: у ног верёвке нужно много точек, чтобы обойти бедро, голень и ботинок.
    // С равными звеньями по полметра и больше она шла от обвязки по прямой сквозь ногу.
    const last = anchors[anchors.length - 1].p, total = _a.distanceTo(last) * (st.fall > 1.1 ? 1 : 1.1), NEAR = 8, near = Math.min(0.12, total / (HEAD - 1)); // длина с запасом на провис
    const far = (total - NEAR * near) / (HEAD - 1 - NEAR), linkAt = (i) => (i < NEAR ? near : far);
    if (ropeTo !== last || RP[0].p.distanceTo(_a) > 3) { ropeTo = last; RP.forEach((r, i) => { r.p.lerpVectors(_a, last, i / (HEAD - 1)); r.q.copy(r.p); }); }
    for (let i = 1; i < HEAD - 1; i++) {
      const r = RP[i], lying = r.p.y - height(r.p.x, r.p.z) < 0.05, gust = 0.5 + 0.9 * (0.5 + 0.5 * Math.sin(st.tg * 2.3 + i * 0.9) * Math.sin(st.tg * 0.7 + i * 0.31));
      _b.subVectors(r.p, r.q).multiplyScalar(lying ? 0.9 : 0.985); r.q.copy(r.p); // на снегу её держит трение
      r.p.add(_b).addScaledVector(G.uWindVel.value, dt * dt * (lying ? 0.25 : 1.1) * gust); r.p.y -= 9.8 * dt * dt;
    }
    for (let it = 0; it < 5; it++) {
      RP[0].p.copy(_a); RP[HEAD - 1].p.copy(last);
      for (let i = 0; i < HEAD - 1; i++) {
        const a = RP[i].p, b = RP[i + 1].p, d = _b.subVectors(b, a).length() || 1e-6, k = ((d - linkAt(i)) / d) * 0.5;
        if (i > 0) a.addScaledVector(_b, k); if (i < HEAD - 2) b.addScaledVector(_b, -k);
      }
      // верёвка не проходит сквозь ноги: точки у тела выталкиваются из бедра, голени и ботинка
      if (rig && st.fall <= 0) for (let i = 1; i <= NEAR + 2; i++) for (const L of LIMBS) if (!L.hand) {
        for (const [p0, p1, r] of [[L.j0, L.j1, 0.13], [L.j1, L.j2, 0.1], [L.j2, L.j3, 0.09]]) {
          const p = RP[i].p; _d.subVectors(p1, p0);
          _b.copy(p0).addScaledVector(_d, Math.min(1, Math.max(0, _p.subVectors(p, p0).dot(_d) / (_d.lengthSq() || 1))));
          const gap = _p.subVectors(p, _b).length();
          if (gap < r) p.copy(_b).addScaledVector(gap > 1e-4 ? _p : right, gap > 1e-4 ? r / gap : r);
        }
      }
    }
    for (let i = 0; i < HEAD; i++) { const r = RP[i].p; if (i > 0) r.y = Math.max(r.y, height(r.x, r.z) + 0.03); ropePts.set([r.x, r.y, r.z], i * 3); }
    tube(0, HEAD, ropeN);

    G.uLampPos.value.copy(lampPos);
    G.uLampDir.value.copy(look); // фонарь на каске светит туда, куда он смотрит
    const dist = _a.subVectors(camera.position, lampPos).length();
    glow.position.copy(lampPos).addScaledVector(_a, 0.15 / dist); // ореол чуть ближе к камере, чем фонарь, и с проверкой глубины: каску он не режет, а за телом и рукой его не видно
    glow.quaternion.copy(camera.quaternion);
    glow.scale.setScalar(Math.min(0.2, 0.05 + dist * 0.04) + dist * 0.0028); // вблизи ореол меньше, иначе он закрывает лицо
    const toCam = G.uLampDir.value.dot(_a) / dist; // со спины ореол слабый: фонарь светит вперёд
    glowI.value = G.uLampI.value * (0.15 * THREE.MathUtils.smoothstep(toCam, -0.1, 0.3) + 0.7 * Math.max(0, toCam) ** 3);
    G.uClimber.value.copy(hips);
    if (tf > 0) { fwd.copy(fwd0); right.copy(right0); left.copy(right).negate(); }
  }

  return {
    group, glow, st, hips, n, fwd, right, pk, mouth, look, skull, update, restart,
    limbs: LIMBS, // для проверки из консоли: где стоят руки и ноги
    brace(sec) { st.brace = Math.max(st.brace, sec); },
    // срыв: пролетает вдвое больше, чем был над крюком, и повисает на верёвке ниже него
    fall() { if (st.fall === 0) Object.assign(st, { fall: 1e-4, fallDir: Math.random() < 0.5 ? -1 : 1, fall0: st.s, fallD: Math.min(9, Math.max(3, 2 * (st.s - anchors[anchors.length - 1].s) + 0.5)), task: 0, rest: 0 }); },
  };
}
