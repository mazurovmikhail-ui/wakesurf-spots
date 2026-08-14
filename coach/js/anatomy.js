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

// торс: сечения снизу вверх [t, полуширина, полуглубина]
const TORSO = [
  [0, 0.155, 0.105],   // таз
  [0.2, 0.142, 0.098], // низ живота
  [0.42, 0.133, 0.093],// талия
  [0.62, 0.152, 0.104],// нижние рёбра
  [0.84, 0.178, 0.115],// грудь
  [1, 0.168, 0.106],   // ключицы
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

// стопа: клин со сводом и пяткой
function footGroup(mat, len) {
  const grp = new THREE.Group();
  const sole = new THREE.Mesh(loft([[0, 0.042, 0.03], [0.35, 0.045, 0.026], [0.75, 0.041, 0.02], [1, 0.03, 0.014]], len, { rings: 12, radial: 14 }), mat);
  sole.rotation.x = Math.PI / 2 - 0.06;   // положить горизонтально, носок чуть вверх
  grp.add(sole);
  const heel = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 12), mat);
  heel.scale.set(1, 0.85, 0.9);
  heel.position.set(0, -0.012, -0.012);
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

  // длины сегментов (метры)
  const L = {
    torso: 0.50, neck: 0.075, head: 0.115,
    upperArm: 0.30, foreArm: 0.255, hand: 0.185,
    thigh: 0.445, shin: 0.415, foot: 0.245,
  };
  const shoulderHalf = 0.185, hipHalf = 0.092;

  const root = new THREE.Group();          // origin = таз
  const parts = {};

  // торс
  const torso = new THREE.Mesh(torsoGeometry(L.torso, bulge), suit);
  root.add(torso); parts.torso = torso;

  // плечевой пояс: дельты
  const chestAnchor = new THREE.Group();
  chestAnchor.position.y = L.torso;
  root.add(chestAnchor); parts.chestAnchor = chestAnchor;

  // шея и голова
  const neck = new THREE.Mesh(loft(P.neck, L.neck, { rings: 8, radial: 14, bulge }), skin);
  neck.position.y = L.neck;                 // origin сверху, растёт вниз → поднимаем
  chestAnchor.add(neck); parts.neck = neck;
  const head = new THREE.Mesh(headGeometry(L.head), skin);
  head.position.y = L.neck + L.head * 0.92;
  chestAnchor.add(head); parts.head = head;

  // руки
  for (const side of [-1, 1]) {
    const key = side < 0 ? "L" : "R";
    const shoulder = new THREE.Group();
    shoulder.position.set(side * shoulderHalf, -0.02, 0);
    chestAnchor.add(shoulder);
    parts["shoulder" + key] = shoulder;

    const delta = new THREE.Mesh(new THREE.SphereGeometry(0.062 * bulge, 18, 14), suit);
    delta.scale.set(1, 1.05, 0.95);
    shoulder.add(delta);

    const upper = new THREE.Mesh(loft(P.upperArm, L.upperArm, { bulge }), suit);
    shoulder.add(upper);
    parts["upperArm" + key] = upper;

    const fore = new THREE.Mesh(loft(P.foreArm, L.foreArm, { bulge }), suit);
    fore.position.y = -L.upperArm;
    shoulder.add(fore);
    parts["foreArm" + key] = fore;

    const hand = handGroup(skin, L.hand);
    hand.position.y = -L.upperArm - L.foreArm;
    shoulder.add(hand);
    parts["hand" + key] = hand;
  }

  // ноги
  for (const side of [-1, 1]) {
    const key = side < 0 ? "L" : "R";
    const hip = new THREE.Group();
    hip.position.set(side * hipHalf, 0.01, 0);
    root.add(hip);
    parts["hip" + key] = hip;

    const thigh = new THREE.Mesh(loft(P.thigh, L.thigh, { bulge }), suit);
    hip.add(thigh);
    parts["thigh" + key] = thigh;

    const shin = new THREE.Mesh(loft(P.shin, L.shin, { bulge }), suit);
    shin.position.y = -L.thigh;
    hip.add(shin);
    parts["shin" + key] = shin;

    const foot = footGroup(skin, L.foot);
    foot.position.y = -L.thigh - L.shin;
    hip.add(foot);
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

  // высота фигуры от стопы до макушки
  const height = L.thigh + L.shin + L.torso + L.neck + L.head * 1.9;
  root.position.y = L.thigh + L.shin; // поставить стопы в 0

  return { root, parts, lengths: L, height, setSegmentColors, setBulge, materials: { suit, skin } };
}

// ── позы для стенда ──
export const POSES = {
  "T-поза": p => {
    p.shoulderL.rotation.set(0, 0, Math.PI / 2);
    p.shoulderR.rotation.set(0, 0, -Math.PI / 2);
    p.hipL.rotation.set(0, 0, 0); p.hipR.rotation.set(0, 0, 0);
    p.foreArmL.rotation.set(0, 0, 0); p.foreArmR.rotation.set(0, 0, 0);
    p.shinL.rotation.set(0, 0, 0); p.shinR.rotation.set(0, 0, 0);
  },
  "Стойка": p => {
    p.shoulderL.rotation.set(0.15, 0, 0.22);
    p.shoulderR.rotation.set(0.15, 0, -0.22);
    p.foreArmL.rotation.set(-0.35, 0, 0); p.foreArmR.rotation.set(-0.35, 0, 0);
    p.hipL.rotation.set(-0.12, 0, 0.05); p.hipR.rotation.set(-0.12, 0, -0.05);
    p.shinL.rotation.set(0.2, 0, 0); p.shinR.rotation.set(0.2, 0, 0);
  },
  "Сёрф-стойка": p => {
    p.shoulderL.rotation.set(0.5, 0.2, 0.5);
    p.shoulderR.rotation.set(0.2, -0.3, -0.7);
    p.foreArmL.rotation.set(-0.7, 0, 0); p.foreArmR.rotation.set(-0.5, 0, 0);
    p.hipL.rotation.set(-0.55, 0.35, 0.18); p.hipR.rotation.set(-0.5, -0.3, -0.2);
    p.shinL.rotation.set(0.85, 0, 0); p.shinR.rotation.set(0.8, 0, 0);
  },
  "Присед": p => {
    p.shoulderL.rotation.set(0.9, 0, 0.35);
    p.shoulderR.rotation.set(0.9, 0, -0.35);
    p.foreArmL.rotation.set(-0.6, 0, 0); p.foreArmR.rotation.set(-0.6, 0, 0);
    p.hipL.rotation.set(-1.15, 0, 0.12); p.hipR.rotation.set(-1.15, 0, -0.12);
    p.shinL.rotation.set(1.7, 0, 0); p.shinR.rotation.set(1.7, 0, 0);
  },
};
