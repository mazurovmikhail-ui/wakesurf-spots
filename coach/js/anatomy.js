// anatomy.js — процедурная анатомическая модель райдера.
// Тело строится лофтом по сечениям (как доска в board3d.js): вдоль каждого сегмента
// задан профиль «мяса» — где дельта, бицепс, квадрицепс, икра. Сечения эллиптические
// со сглаживанием суперэллипса, поэтому силуэт мягкий, а не трубчатый.
//
// Иерархия сегментов пригодна для риггинга: hips → spine → chest → neck → head,
// от груди — руки, от таза — ноги. Origin каждого сегмента в верхнем суставе,
// длина идёт вдоль +Y, поэтому сегмент можно просто «наводить» кватернионом.
import * as THREE from "three";

// рост-ориентир: 1.75 м. Все размеры — доли от него.
export const H = 1.75;

// профиль сегмента: [t вдоль длины 0..1, ширина, глубина] в метрах
const P = {
  upperArm: [[0, 0.062, 0.058], [0.18, 0.058, 0.054], [0.45, 0.05, 0.047], [0.8, 0.044, 0.041], [1, 0.041, 0.038]],
  foreArm: [[0, 0.046, 0.044], [0.25, 0.048, 0.045], [0.6, 0.039, 0.036], [1, 0.028, 0.025]],
  thigh: [[0, 0.098, 0.093], [0.25, 0.092, 0.088], [0.6, 0.079, 0.075], [1, 0.061, 0.058]],
  shin: [[0, 0.063, 0.062], [0.22, 0.068, 0.064], [0.45, 0.058, 0.054], [0.78, 0.042, 0.039], [1, 0.036, 0.033]],
  neck: [[0, 0.055, 0.052], [1, 0.049, 0.046]],
};

// торс: сечения снизу вверх [t, полуширина, полуглубина].
// Верх сужается к шее (трапеции), иначе торс выглядит бочкой с плоской крышкой.
const TORSO = [
  [0, 0.142, 0.098],   // таз
  [0.18, 0.132, 0.093],// низ живота
  [0.4, 0.122, 0.086], // талия
  [0.6, 0.142, 0.098], // нижние рёбра
  [0.8, 0.163, 0.109], // грудь
  [0.9, 0.15, 0.1],    // ключицы
  [1, 0.075, 0.062],   // основание шеи
];

function lerpProfile(prof, t) {
  for (let i = 1; i < prof.length; i++) {
    if (t <= prof[i][0]) {
      const [t0, w0, d0] = prof[i - 1], [t1, w1, d1] = prof[i];
      const k = (t - t0) / (t1 - t0 || 1);
      const s = k * k * (3 - 2 * k);
      return [w0 + (w1 - w0) * s, d0 + (d1 - d0) * s];
    }
  }
  const last = prof[prof.length - 1];
  return [last[1], last[2]];
}

// лофт вдоль +Y: origin в t=0 (верхний сустав), длина len
function loft(prof, len, opts = {}) {
  const NL = opts.rings ?? 24, NC = opts.radial ?? 18;
  const bulge = opts.bulge ?? 1;      // «мышечность»
  const squash = opts.squash ?? 0.62; // мягкость углов сечения
  const verts = [], idx = [];
  for (let i = 0; i < NL; i++) {
    const t = i / (NL - 1);
    const [w0, d0] = lerpProfile(prof, t);
    const w = w0 * bulge, d = d0 * bulge;
    const y = -t * len;
    for (let j = 0; j < NC; j++) {
      const a = (j / NC) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = w * Math.sign(ca) * Math.pow(Math.abs(ca), squash);
      const z = d * Math.sign(sa) * Math.pow(Math.abs(sa), squash);
      verts.push(x, y, z);
    }
  }
  for (let i = 0; i < NL - 1; i++) for (let j = 0; j < NC; j++) {
    const a = i * NC + j, b = i * NC + (j + 1) % NC, c = (i + 1) * NC + j, d = (i + 1) * NC + (j + 1) % NC;
    idx.push(a, c, b, b, c, d);
  }
  // шапочки: полусферы на концах, чтобы суставы были круглыми
  for (const [ring, dir] of [[0, 1], [NL - 1, -1]]) {
    const t = ring / (NL - 1);
    const [w, d] = lerpProfile(prof, t);
    const cy = -t * len + dir * Math.min(w, d) * 0.85;
    const c = verts.length / 3;
    verts.push(0, cy, 0);
    for (let j = 0; j < NC; j++) {
      const a = ring * NC + j, b = ring * NC + (j + 1) % NC;
      if (dir > 0) idx.push(c, a, b); else idx.push(c, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// торс как единый лофт снизу вверх (origin в тазу, растёт вверх)
function torsoGeometry(len, bulge) {
  const NL = 30, NC = 22;
  const verts = [], idx = [];
  for (let i = 0; i < NL; i++) {
    const t = i / (NL - 1);
    const [w0, d0] = lerpProfile(TORSO, t);
    const w = w0 * bulge, d = d0 * bulge;
    const y = t * len;
    for (let j = 0; j < NC; j++) {
      const a = (j / NC) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // спина чуть площе груди — сдвигаем профиль по глубине
      const back = sa < 0 ? 0.92 : 1;
      verts.push(
        w * Math.sign(ca) * Math.pow(Math.abs(ca), 0.66),
        y,
        d * back * Math.sign(sa) * Math.pow(Math.abs(sa), 0.7)
      );
    }
  }
  for (let i = 0; i < NL - 1; i++) for (let j = 0; j < NC; j++) {
    const a = i * NC + j, b = i * NC + (j + 1) % NC, c = (i + 1) * NC + j, d = (i + 1) * NC + (j + 1) % NC;
    idx.push(a, c, b, b, c, d);
  }
  for (const [ring, dir] of [[0, -1], [NL - 1, 1]]) {
    const t = ring / (NL - 1);
    const [w, d] = lerpProfile(TORSO, t);
    const c = verts.length / 3;
    verts.push(0, t * len + dir * Math.min(w, d) * 0.7, 0);
    for (let j = 0; j < NC; j++) {
      const a = ring * NC + j, b = ring * NC + (j + 1) % NC;
      if (dir > 0) idx.push(c, a, b); else idx.push(c, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// голова: яйцевидный череп + челюсть
function headGeometry(size) {
  const g = new THREE.SphereGeometry(size, 28, 22);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const up = v.y / size;                       // -1 низ .. 1 верх
    const front = v.z / size;
    let sx = 0.86, sy = 1.14, sz = 0.98;
    if (up < 0) { sx *= 1 + up * 0.22; sz *= 1 + up * 0.12; } // сужение к подбородку
    if (up > 0.35) sz *= 1 - (up - 0.35) * 0.18;              // затылок круглее лба
    v.set(v.x * sx, v.y * sy, v.z * sz);
    if (front > 0.55 && up > -0.15 && up < 0.25) v.z += size * 0.05; // лицевая масса
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// кисть: ладонь + большой палец + масса пальцев
function handGroup(mat, len) {
  const grp = new THREE.Group();
  const palm = new THREE.Mesh(loft([[0, 0.036, 0.016], [0.5, 0.038, 0.017], [1, 0.034, 0.015]], len * 0.55, { rings: 8, radial: 14 }), mat);
  grp.add(palm);
  const fingers = new THREE.Mesh(loft([[0, 0.033, 0.015], [0.7, 0.028, 0.013], [1, 0.02, 0.009]], len * 0.45, { rings: 8, radial: 12 }), mat);
  fingers.position.y = -len * 0.55;
  grp.add(fingers);
  const thumb = new THREE.Mesh(loft([[0, 0.014, 0.013], [1, 0.011, 0.01]], len * 0.34, { rings: 6, radial: 10 }), mat);
  thumb.position.set(-0.03, -len * 0.16, 0.006);
  thumb.rotation.z = 0.85;
  grp.add(thumb);
  return grp;
}

// стопа: вытянутый клин со сводом, пятка сзади, носок ниже — без «мячей»
function footGroup(mat, len) {
  const grp = new THREE.Group();
  const sole = new THREE.Mesh(
    loft([[0, 0.039, 0.032], [0.3, 0.044, 0.028], [0.7, 0.042, 0.021], [1, 0.031, 0.014]], len, { rings: 14, radial: 16, squash: 0.72 }),
    mat
  );
  // положить горизонтально: длина идёт вперёд (+Z), носок чуть приподнят
  sole.rotation.x = Math.PI / 2 - 0.08;
  sole.position.z = 0.03;
  grp.add(sole);
  const heel = new THREE.Mesh(loft([[0, 0.035, 0.03], [1, 0.028, 0.026]], 0.055, { rings: 6, radial: 12 }), mat);
  heel.position.set(0, -0.012, -0.035);
  heel.rotation.x = -0.25;
  grp.add(heel);
  return grp;
}

/**
 * Создаёт анатомическую модель.
 * opts: { bulge, suit, skin, showSegments }
 */
export function createAnatomy(opts = {}) {
  const bulge = opts.bulge ?? 1;

  const suit = new THREE.MeshStandardMaterial({ color: 0x232f3d, roughness: 0.52, metalness: 0.1, emissive: 0x0a1119, emissiveIntensity: 0.45 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd7b596, roughness: 0.72, metalness: 0.02, emissive: 0x2a1d13, emissiveIntensity: 0.22 });

  // длины сегментов (метры), рост ≈ 1.75
  const L = {
    torso: 0.50, neck: 0.085, head: 0.098,
    upperArm: 0.30, foreArm: 0.255, hand: 0.185,
    thigh: 0.445, shin: 0.415, foot: 0.245,
  };
  const shoulderHalf = 0.196, hipHalf = 0.088; // плечи ≈ 24% роста (мужской канон)

  const root = new THREE.Group();          // origin = таз
  const parts = {};

  // торс
  const torso = new THREE.Mesh(torsoGeometry(L.torso, bulge), suit);
  root.add(torso); parts.torso = torso;

  // Мышечный рельеф корпуса: грудные, широчайшие, ягодицы. Отдельные объёмы
  // поверх торса — силуэт перестаёт быть гладкой бочкой.
  const relief = new THREE.Group();
  root.add(relief); parts.relief = relief;
  for (const side of [-1, 1]) {
    const pec = new THREE.Mesh(new THREE.SphereGeometry(0.072 * bulge, 18, 14), suit);
    pec.scale.set(1.05, 0.62, 0.5);
    pec.position.set(side * 0.062, L.torso * 0.79, 0.075);
    relief.add(pec);

    const lat = new THREE.Mesh(new THREE.SphereGeometry(0.078 * bulge, 16, 12), suit);
    lat.scale.set(0.55, 1.05, 0.62);
    lat.position.set(side * 0.135, L.torso * 0.66, -0.012);
    relief.add(lat);

    const glute = new THREE.Mesh(new THREE.SphereGeometry(0.078 * bulge, 16, 14), suit);
    glute.scale.set(0.95, 0.85, 0.7);
    glute.position.set(side * 0.062, 0.028, -0.062);
    relief.add(glute);
  }
  // пресс/косые — лёгкий объём спереди
  const abs = new THREE.Mesh(new THREE.SphereGeometry(0.085 * bulge, 18, 14), suit);
  abs.scale.set(0.95, 1.25, 0.42);
  abs.position.set(0, L.torso * 0.42, 0.055);
  relief.add(abs);

  // грудь: точка крепления рук, шеи и головы
  const chestAnchor = new THREE.Group();
  chestAnchor.position.y = L.torso * 0.9;   // на уровне ключиц, не над макушкой торса
  root.add(chestAnchor); parts.chestAnchor = chestAnchor;

  // трапеции — плавный переход плечи → шея
  const traps = new THREE.Mesh(loft([[0, 0.135, 0.09], [1, 0.07, 0.06]], 0.07, { rings: 8, radial: 16 }), suit);
  traps.position.y = 0.07;
  chestAnchor.add(traps);

  // шея (растёт вверх от груди) и голова на ней
  const neckGrp = new THREE.Group();
  neckGrp.position.y = 0.055;
  chestAnchor.add(neckGrp); parts.neck = neckGrp;
  const neckMesh = new THREE.Mesh(loft(P.neck, L.neck, { rings: 8, radial: 14, bulge }), skin);
  neckMesh.position.y = L.neck;             // origin лофта сверху → поднимаем на длину
  neckGrp.add(neckMesh);
  const headGrp = new THREE.Group();
  headGrp.position.y = L.neck + L.head * 0.82;
  neckGrp.add(headGrp); parts.head = headGrp;
  headGrp.add(new THREE.Mesh(headGeometry(L.head), skin));

  // руки: shoulder → (плечо) → elbow → (предплечье) → wrist → кисть
  for (const side of [-1, 1]) {
    const key = side < 0 ? "L" : "R";

    const shoulder = new THREE.Group();
    shoulder.position.set(side * shoulderHalf, 0.03, 0);
    chestAnchor.add(shoulder);
    parts["shoulder" + key] = shoulder;

    // дельта: каплевидная, спускается на плечо, а не шар в суставе
    const delta = new THREE.Mesh(new THREE.SphereGeometry(0.062 * bulge, 20, 16), suit);
    delta.scale.set(1.0, 1.25, 0.92);
    delta.position.y = -0.022;
    shoulder.add(delta);

    const upper = new THREE.Mesh(loft(P.upperArm, L.upperArm, { bulge }), suit);
    shoulder.add(upper);
    parts["upperArm" + key] = upper;

    const elbow = new THREE.Group();
    elbow.position.y = -L.upperArm;
    shoulder.add(elbow);
    parts["elbow" + key] = elbow;

    const fore = new THREE.Mesh(loft(P.foreArm, L.foreArm, { bulge }), suit);
    elbow.add(fore);
    parts["foreArm" + key] = fore;

    const wrist = new THREE.Group();
    wrist.position.y = -L.foreArm;
    elbow.add(wrist);
    parts["wrist" + key] = wrist;

    const hand = handGroup(skin, L.hand);
    wrist.add(hand);
    parts["hand" + key] = hand;
  }

  // ноги: hip → (бедро) → knee → (голень) → ankle → стопа
  for (const side of [-1, 1]) {
    const key = side < 0 ? "L" : "R";

    const hip = new THREE.Group();
    hip.position.set(side * hipHalf, 0.02, 0);
    root.add(hip);
    parts["hip" + key] = hip;

    const thigh = new THREE.Mesh(loft(P.thigh, L.thigh, { bulge }), suit);
    hip.add(thigh);
    parts["thigh" + key] = thigh;

    const knee = new THREE.Group();
    knee.position.y = -L.thigh;
    hip.add(knee);
    parts["knee" + key] = knee;

    const shin = new THREE.Mesh(loft(P.shin, L.shin, { bulge }), suit);
    knee.add(shin);
    parts["shin" + key] = shin;

    const ankle = new THREE.Group();
    ankle.position.y = -L.shin;
    knee.add(ankle);
    parts["ankle" + key] = ankle;

    const foot = footGroup(skin, L.foot);
    ankle.add(foot);
    parts["foot" + key] = foot;
  }

  // раскрасить сегменты для отладки
  function setSegmentColors(on) {
    const palette = [0x38bdf8, 0x34d399, 0xfbbf24, 0xf472b6, 0xa78bfa, 0xf87171];
    let i = 0;
    root.traverse(o => {
      if (!o.isMesh) return;
      if (on) {
        o.userData.mat = o.userData.mat || o.material;
        o.material = new THREE.MeshStandardMaterial({ color: palette[i++ % palette.length], roughness: 0.6 });
      } else if (o.userData.mat) {
        o.material = o.userData.mat;
      }
    });
  }

  function setBulge(b) {
    // мышечный рельеф масштабируется целиком
    relief.children.forEach(m => {
      if (!m.userData.baseScale) m.userData.baseScale = m.scale.clone();
      m.scale.copy(m.userData.baseScale).multiplyScalar(0.55 + 0.45 * b);
    });
    // перестроить геометрию мышц под новую «мышечность»
    parts.torso.geometry.dispose();
    parts.torso.geometry = torsoGeometry(L.torso, b);
    for (const side of ["L", "R"]) {
      const rebuild = (name, prof, len) => {
        const m = parts[name + side];
        m.geometry.dispose();
        m.geometry = loft(prof, len, { bulge: b });
      };
      rebuild("upperArm", P.upperArm, L.upperArm);
      rebuild("foreArm", P.foreArm, L.foreArm);
      rebuild("thigh", P.thigh, L.thigh);
      rebuild("shin", P.shin, L.shin);
    }
  }

  // высота фигуры от стопы до макушки; голова в геометрии = 2.28 радиуса
  const headHeight = L.head * 2.28;
  const height = L.thigh + L.shin + L.torso * 0.9 + 0.055 + L.neck + headHeight * 0.55;
  root.position.y = L.thigh + L.shin; // поставить стопы в 0

  return { root, parts, lengths: L, height, headHeight, setSegmentColors, setBulge, materials: { suit, skin } };
}

// ── позы для стенда ──
// Вращаем суставы (shoulder/elbow/hip/knee/ankle), меши висят на них.
function resetPose(p) {
  for (const n of ["shoulderL", "shoulderR", "elbowL", "elbowR", "wristL", "wristR",
                   "hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "head", "neck"]) {
    if (p[n]) p[n].rotation.set(0, 0, 0);
  }
}
export const POSES = {
  "T-поза": p => {
    resetPose(p);
    p.shoulderL.rotation.z = Math.PI / 2;
    p.shoulderR.rotation.z = -Math.PI / 2;
  },
  "Стойка": p => {
    resetPose(p);
    // руки опущены вдоль тела, чуть отведены и слегка согнуты
    p.shoulderL.rotation.set(0.08, 0, 0.12);
    p.shoulderR.rotation.set(0.08, 0, -0.12);
    p.elbowL.rotation.set(-0.22, 0, 0);
    p.elbowR.rotation.set(-0.22, 0, 0);
    p.hipL.rotation.set(-0.05, 0, 0.03);
    p.hipR.rotation.set(-0.05, 0, -0.03);
    p.kneeL.rotation.set(0.1, 0, 0);
    p.kneeR.rotation.set(0.1, 0, 0);
  },
  "Сёрф-стойка": p => {
    resetPose(p);
    // боковая стойка: колени согнуты, корпус собран, руки перед собой
    p.shoulderL.rotation.set(0.75, 0.25, 0.42);
    p.shoulderR.rotation.set(0.55, -0.35, -0.5);
    p.elbowL.rotation.set(-0.95, 0, 0);
    p.elbowR.rotation.set(-0.8, 0, 0);
    p.hipL.rotation.set(-0.5, 0.3, 0.14);
    p.hipR.rotation.set(-0.42, -0.28, -0.16);
    p.kneeL.rotation.set(0.8, 0, 0);
    p.kneeR.rotation.set(0.72, 0, 0);
    p.ankleL.rotation.set(-0.3, 0, 0);
    p.ankleR.rotation.set(-0.28, 0, 0);
    p.head.rotation.y = 0.5;
  },
  "Присед": p => {
    resetPose(p);
    p.shoulderL.rotation.set(1.05, 0, 0.3);
    p.shoulderR.rotation.set(1.05, 0, -0.3);
    p.elbowL.rotation.set(-0.7, 0, 0);
    p.elbowR.rotation.set(-0.7, 0, 0);
    p.hipL.rotation.set(-1.1, 0, 0.1);
    p.hipR.rotation.set(-1.1, 0, -0.1);
    p.kneeL.rotation.set(1.75, 0, 0);
    p.kneeR.rotation.set(1.75, 0, 0);
    p.ankleL.rotation.set(-0.65, 0, 0);
    p.ankleR.rotation.set(-0.65, 0, 0);
  },
};
