// board3d.js — правдоподобная вейксёрф-доска: настоящий аутлайн (широкий нос,
// сужение к хвосту), рокер (задранный нос), переменная толщина, скруглённые рэйлы,
// EVA-пад на деке и серповидные фины. Геометрия строится лофтом по сечениям.
import * as THREE from "three";

export const BOARD_LEN = 1.0;
export const BOARD_TH = 0.052;

// контрольные кривые по длине доски: u = 0 хвост → 1 нос
function lerpCurve(pts, u) {
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const t = (u - x0) / (x1 - x0 || 1);
      return y0 + (y1 - y0) * (t * t * (3 - 2 * t)); // сглаженная интерполяция
    }
  }
  return pts[pts.length - 1][1];
}

// аутлайн: узкий хвост, максимум ширины чуть впереди центра, скруглённый нос
const OUTLINE = [[0, 0.34], [0.12, 0.68], [0.3, 0.9], [0.5, 1.0], [0.72, 0.95], [0.88, 0.76], [1, 0.34]];
// толщина: тонкие концы, объём в центре
const THICK = [[0, 0.5], [0.2, 0.85], [0.5, 1.0], [0.75, 0.86], [1, 0.5]];
// рокер: нос задран заметно, хвост чуть-чуть
const ROCKER = [[0, 0.045], [0.25, 0.004], [0.5, 0], [0.75, 0.03], [0.9, 0.085], [1, 0.16]];

function makeHull(len, halfW, th) {
  const NL = 46, NC = 20; // сечений вдоль и точек в сечении
  const verts = [], idx = [];
  for (let i = 0; i < NL; i++) {
    const u = i / (NL - 1);
    const x = (u - 0.5) * len;
    const w = halfW * lerpCurve(OUTLINE, u);
    const t = th * 0.5 * lerpCurve(THICK, u);
    const yOff = lerpCurve(ROCKER, u) * len;
    for (let j = 0; j < NC; j++) {
      const a = (j / NC) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // суперэллипс: плоские дека и дно, скруглённые рэйлы
      const z = w * Math.sign(ca) * Math.pow(Math.abs(ca), 0.55);
      const y = t * Math.sign(sa) * Math.pow(Math.abs(sa), 0.8) + yOff;
      verts.push(x, y, z);
    }
  }
  for (let i = 0; i < NL - 1; i++) {
    for (let j = 0; j < NC; j++) {
      const a = i * NC + j, b = i * NC + (j + 1) % NC;
      const c = (i + 1) * NC + j, d = (i + 1) * NC + (j + 1) % NC;
      idx.push(a, c, b, b, c, d);
    }
  }
  // торцы (нос и хвост) — веером к центру сечения
  for (const [ring, dir] of [[0, -1], [NL - 1, 1]]) {
    const cIdx = verts.length / 3;
    const u = ring / (NL - 1);
    verts.push((u - 0.5) * len, lerpCurve(ROCKER, u) * len, 0);
    for (let j = 0; j < NC; j++) {
      const a = ring * NC + j, b = ring * NC + (j + 1) % NC;
      if (dir < 0) idx.push(cIdx, a, b); else idx.push(cIdx, b, a);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// EVA-пад: накладка на деке в задней части, повторяет аутлайн
function makePad(len, halfW, th) {
  const NL = 22, NC = 2;
  const verts = [], idx = [];
  const uFrom = 0.1, uTo = 0.62;
  for (let i = 0; i < NL; i++) {
    const u = uFrom + (uTo - uFrom) * (i / (NL - 1));
    const x = (u - 0.5) * len;
    const w = halfW * lerpCurve(OUTLINE, u) * 0.82;
    const y = th * 0.5 * lerpCurve(THICK, u) + lerpCurve(ROCKER, u) * len + 0.004;
    verts.push(x, y, -w, x, y, w);
  }
  for (let i = 0; i < NL - 1; i++) {
    const a = i * NC, b = i * NC + 1, c = (i + 1) * NC, d = (i + 1) * NC + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// фин: серповидный профиль, слегка изогнутый назад
function makeFin(h, base) {
  const s = new THREE.Shape();
  s.moveTo(-base / 2, 0);
  s.bezierCurveTo(-base / 2, h * 0.55, -base * 0.1, h * 0.85, base * 0.42, h);
  s.bezierCurveTo(base * 0.3, h * 0.5, base * 0.5, h * 0.2, base / 2, 0);
  s.lineTo(-base / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.007, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -0.0035);
  return g;
}

export function makeBoard(opts = {}) {
  const len = opts.len ?? BOARD_LEN;
  const halfW = (opts.width ?? 0.33) / 2;
  const th = opts.thickness ?? BOARD_TH;

  const group = new THREE.Group();

  const glossy = new THREE.MeshStandardMaterial({
    color: 0x2b8fd0, roughness: 0.22, metalness: 0.2,
    emissive: 0x08283d, emissiveIntensity: 0.35
  });
  const hull = new THREE.Mesh(makeHull(len, halfW, th), glossy);
  group.add(hull);

  // шершавый EVA-пад
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x18232e, roughness: 0.98, metalness: 0.0, side: THREE.DoubleSide
  });
  group.add(new THREE.Mesh(makePad(len, halfW, th), padMat));

  // тонкая полоса-логотип по центру дна — читается при вращении
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(len * 0.42, 0.004, 0.016),
    new THREE.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x2f7fa5, emissiveIntensity: 0.8 })
  );
  stripe.position.set(len * 0.1, -th * 0.5 + 0.002, 0);
  group.add(stripe);

  // фины: два боковых с развалом + центральный
  const finMat = new THREE.MeshStandardMaterial({ color: 0x0f2a3d, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide });
  const tailU = 0.12;
  const tailY = -th * 0.5 * lerpCurve(THICK, tailU) + lerpCurve(ROCKER, tailU) * len;
  const tailX = (tailU - 0.5) * len;
  for (const dz of [-0.085, 0.085]) {
    const fin = new THREE.Mesh(makeFin(0.075, 0.09), finMat);
    fin.rotation.x = Math.PI / 2;
    fin.rotation.y = Math.PI;
    fin.position.set(tailX + 0.05, tailY, dz);
    fin.rotation.z = dz > 0 ? -0.12 : 0.12;
    group.add(fin);
  }
  const center = new THREE.Mesh(makeFin(0.095, 0.11), finMat);
  center.rotation.x = Math.PI / 2;
  center.rotation.y = Math.PI;
  center.position.set(tailX - 0.02, tailY, 0);
  group.add(center);

  group.userData.deckTop = th * 0.5;
  return group;
}
