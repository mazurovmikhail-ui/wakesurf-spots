// rider3d.js — интерактивный 3D-вьюер «виртуального райдера» v2.
// Объёмная фигура из 3D-точек MediaPipe + РЕАЛЬНАЯ доска (форма сёрфа с финами),
// образ волны (стенка + вода) и визуализация ПЕРЕНОСА ВЕСА (диск давления + луч).
// Требует import map в HTML: "three" и "three/addons/".
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makeBoard, BOARD_TH as DECK_TH } from "./board3d.js";

const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const ACCENT = 0x38bdf8, JOINTC = 0x22d3ee;

function toVec(p) { return new THREE.Vector3(p.x, -p.y, -p.z); }
function mid(a, b) { return a.clone().add(b).multiplyScalar(0.5); }

// ---- образ волны: изогнутая стенка + вода ----
function makeWaveAndWater(feetY) {
  const grp = new THREE.Group();
  // вода (флэт)
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: 0x0e3a5a, transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.3 })
  );
  water.rotation.x = -Math.PI / 2; water.position.y = feetY - 0.02; grp.add(water);
  // стенка волны — изогнутая поверхность позади/сбоку
  const seg = 48;
  const g = new THREE.PlaneGeometry(4.2, 1.7, seg, 16);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), y = pos.getY(i); // y: 0 низ .. верх
    const ty = Math.max(0, Math.min(1, (y + 0.85) / 1.7)); // 0..1 снизу вверх (кламп от NaN в pow)
    // профиль волны: поднимается и слегка загибается сверху (лип)
    const curl = Math.pow(ty, 1.6);
    pos.setZ(i, -curl * 0.9 - Math.sin(u * 0.7) * 0.04);
  }
  g.computeVertexNormals();
  const wave = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color: 0x1c6ea3, transparent: true, opacity: 0.45, roughness: 0.25, metalness: 0.2, side: THREE.DoubleSide
  }));
  wave.position.set(0, feetY + 0.7, -0.75); grp.add(wave);
  // гребень (лип) — светлая линия
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x3a7ea0, emissiveIntensity: 0.7 }));
  lip.rotation.z = Math.PI / 2; lip.position.set(0, feetY + 1.5, -1.6); grp.add(lip);
  return grp;
}

export function create(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 16 / 10, 0.1, 100);
  cam.position.set(1.6, 0.5, 2.9);
  function resize() {
    const w = canvas.clientWidth || 640, h = canvas.clientHeight || 400;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  const controls = new OrbitControls(cam, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.target.set(0, 0.1, 0);

  scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x0b1120, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 1.5); dir.position.set(2, 4, 3); scene.add(dir);

  const FEETY = -0.85;
  scene.add(makeWaveAndWater(FEETY));

  // Материалы: тело в гидрокостюме (тёмный неопрен с мягким бликом), открытая кожа
  // (голова, кисти) — матовая. Разные материалы читаются как «человек», а не манекен.
  const suit = new THREE.MeshStandardMaterial({ color: 0x27313f, roughness: 0.55, metalness: 0.12, emissive: 0x0d1520, emissiveIntensity: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8bda4, roughness: 0.75, metalness: 0.03, emissive: 0x2b1f16, emissiveIntensity: 0.3 });
  const figure = new THREE.Group(); scene.add(figure);

  // Конечности сужаются к дальнему концу (бедро → колено, плечо → локоть),
  // а сечение овальное (сплющено по Z) — как у человека, а не труба.
  const LIMBS = [
    [11, 13, 0.058, 0.045], [13, 15, 0.045, 0.036],   // плечо, предплечье
    [12, 14, 0.058, 0.045], [14, 16, 0.045, 0.036],
    [23, 25, 0.092, 0.068], [25, 27, 0.068, 0.045],   // бедро, голень
    [24, 26, 0.092, 0.068], [26, 28, 0.068, 0.045],
  ];
  const limbMesh = LIMBS.map(([, , rTop, rBot]) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rBot, rTop, 1, 16), suit);
    m.userData.flat = 0.82;
    figure.add(m); return m;
  });
  const JOINTR = { 11: 0.072, 12: 0.072, 13: 0.048, 14: 0.048, 15: 0.042, 16: 0.042, 23: 0.088, 24: 0.088, 25: 0.07, 26: 0.07, 27: 0.05, 28: 0.05 };
  const capMesh = {};
  for (const j of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(JOINTR[j], 16, 12), suit);
    m.scale.z = 0.85;
    figure.add(m); capMesh[j] = m;
  }

  // Корпус: грудная клетка шире таза, талия уже обеих — силуэт вместо цилиндра
  const torsoMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.125, 1, 20), suit);
  torsoMesh.userData.flat = 0.68; figure.add(torsoMesh);
  const chestMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), suit);
  chestMesh.scale.set(1, 0.85, 0.66); figure.add(chestMesh);
  const pelvisMesh = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 16), suit);
  pelvisMesh.scale.set(1, 0.9, 0.72); figure.add(pelvisMesh);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.052, 1, 12), skin);
  neckMesh.userData.flat = 0.9; figure.add(neckMesh);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.108, 24, 20), skin);
  head.scale.set(0.92, 1.12, 1); figure.add(head);
  const handMesh = {
    15: new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 12), skin),
    16: new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 12), skin)
  };
  handMesh[15].scale.set(1, 0.75, 0.55); handMesh[16].scale.set(1, 0.75, 0.55);
  figure.add(handMesh[15], handMesh[16]);
  const FOOT_H = 0.05, BOARD_TH = DECK_TH; // высота стопы и толщина деки — для стыковки
  const footMesh = { 27: new THREE.Mesh(new THREE.BoxGeometry(0.085, FOOT_H, 0.2), suit), 28: new THREE.Mesh(new THREE.BoxGeometry(0.085, FOOT_H, 0.2), suit) };
  figure.add(footMesh[27], footMesh[28]);

  const board = makeBoard(); figure.add(board);

  // ---- перенос веса: диск давления + луч ----
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 24), new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x0f5a3a, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 }));
  figure.add(disc);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 10), new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x0f5a3a, emissiveIntensity: 0.7, transparent: true, opacity: 0.7 })); figure.add(beam);

  const UP = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), q = new THREE.Quaternion();
  function placeCyl(mesh, a, b) {
    tmp.copy(b).sub(a); const len = tmp.length() || 1e-4;
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.copy(q.setFromUnitVectors(UP, tmp.clone().normalize()));
    const flat = mesh.userData.flat ?? 1; // овальное сечение вместо круглой трубы
    mesh.scale.set(1, len, flat);
  }
  const cGreen = new THREE.Color(0x34d399), cWarn = new THREE.Color(0xfbbf24);

  let frames = [], idx = 0, playing = true, fps = 12, lastT = 0, hasWorld = false, _raw = [];
  let gScale = 3, depthFactor = 0.35; // единый масштаб на клип + слабая глубина (почти 2D)
  let shifts = []; // покадровый вертикальный сдвиг: гасит дрейф камеры, сохраняя динамику

  function smooth(arr, win) {
    const N = arr.length, out = arr.map((f) => f.map((p) => ({ ...p }))); const k = win >> 1;
    for (let i = 0; i < N; i++) for (let j = 0; j < 33; j++) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let w = Math.max(0, i - k); w <= Math.min(N - 1, i + k); w++) { sx += arr[w][j].x; sy += arr[w][j].y; sz += arr[w][j].z; n++; }
      out[i][j] = { x: sx / n, y: sy / n, z: sz / n, visibility: arr[i][j].visibility };
    }
    return out;
  }
  // Используем НАДЁЖНЫЕ 2D-точки (landmarks: x,y в [0..1], z — относит. глубина,
  // visibility) вместо шумного worldLandmarks: на дальней/боковой съёмке 3D-мир
  // разваливается, а 2D+глубина стабильны.
  const VIS = 0.4, DEPTH = 1.1;
  function setFrames(rawFrames, smoothWin = 5) {
    _raw = rawFrames;
    const poses = rawFrames.filter((f) => f.landmarks).map((f) => f.landmarks);
    hasWorld = poses.length > 3;
    frames = hasWorld ? (smoothWin > 1 ? smooth(poses, smoothWin) : poses) : [];
    // единый масштаб на весь клип (медиана высоты видимого bbox) — фигура не «плавает» в размере
    const hs = [];
    for (const f of frames) {
      let mn = 1e9, mx = -1e9, n = 0;
      for (let i = 0; i < 33; i++) if ((f[i].visibility ?? 1) >= VIS) { mn = Math.min(mn, f[i].y); mx = Math.max(mx, f[i].y); n++; }
      if (n >= 6) hs.push(mx - mn);
    }
    hs.sort((a, b) => a - b);
    gScale = 1.7 / Math.max(hs.length ? hs[hs.length >> 1] : 0.5, 1e-3);
    // Вертикальная привязка к воде. Прижимать стопы к воде покадрово нельзя —
    // тогда исчезают приседания и прыжки; держать один сдвиг на клип тоже нельзя —
    // фигуру уносит вместе с движением камеры. Поэтому вычитаем только медленный
    // дрейф: сглаживаем уровень стоп широким окном (~2 сек) и привязываем к нему.
    const fy = frames.map(f => footYOf(f));
    for (let i = 0; i < fy.length; i++) if (fy[i] == null) fy[i] = fy[i - 1] ?? 0;
    const win = Math.max(5, Math.min(41, Math.floor(frames.length / 6) | 1));
    const k = win >> 1;
    shifts = fy.map((_, i) => {
      let s = 0, n = 0;
      for (let w = Math.max(0, i - k); w <= Math.min(fy.length - 1, i + k); w++) { s += fy[w]; n++; }
      return FEETY + 0.02 - s / n;
    });
    idx = 0; if (frames.length) draw(frames[0]);
  }
  function setDepth(d) { depthFactor = d; if (frames.length) draw(frames[idx]); }

  // уровень стоп в кадре (в тех же координатах, что и draw)
  function footYOf(lm) {
    let cx, cy;
    if (vis(lm, 23) && vis(lm, 24)) { cx = (lm[23].x + lm[24].x) / 2; cy = (lm[23].y + lm[24].y) / 2; }
    else {
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < 33; i++) if (vis(lm, i)) { sx += lm[i].x; sy += lm[i].y; n++; }
      if (!n) return null;
      cx = sx / n; cy = sy / n;
    }
    const ys = [27, 28, 31, 32].filter(i => vis(lm, i)).map(i => -(lm[i].y - cy) * gScale);
    return ys.length ? Math.min(...ys) : null;
  }

  const vis = (lm, i) => (lm[i] && (lm[i].visibility ?? 1)) >= VIS;

  function draw(lm) {
    let nv = 0; for (let i = 0; i < 33; i++) if (vis(lm, i)) nv++;
    if (nv < 6) return; // мусорный кадр — держим предыдущий
    // центр — по тазу (стабильно), иначе среднее видимых; масштаб — единый на клип
    let cx, cy;
    if (vis(lm, 23) && vis(lm, 24)) { cx = (lm[23].x + lm[24].x) / 2; cy = (lm[23].y + lm[24].y) / 2; }
    else { let sx = 0, sy = 0, n = 0; for (let i = 0; i < 33; i++) if (vis(lm, i)) { sx += lm[i].x; sy += lm[i].y; n++; } cx = sx / n; cy = sy / n; }
    const S = gScale;
    const P = (i) => new THREE.Vector3((lm[i].x - cx) * S, -(lm[i].y - cy) * S, -((lm[i].z || 0)) * S * depthFactor);

    // сдвиг этого кадра (см. setFrames): дрейф камеры убран, динамика сохранена
    const shift = shifts[frames.indexOf(lm)] ?? shifts[idx] ?? 0;

    const V = {}; const gp = (i) => { if (!V[i]) { V[i] = P(i); V[i].y += shift; } return V[i]; };

    // ── тело-манекен: конечности + суставы + торс + голова + кисти/стопы ──
    LIMBS.forEach(([a, b], i) => { const ok = vis(lm, a) && vis(lm, b); limbMesh[i].visible = ok; if (ok) placeCyl(limbMesh[i], gp(a), gp(b)); });
    for (const j of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { const ok = vis(lm, j); capMesh[j].visible = ok; if (ok) capMesh[j].position.copy(gp(j)); }
    const shOk = vis(lm, 11) && vis(lm, 12), hpOk = vis(lm, 23) && vis(lm, 24);
    const torsoOk = shOk && hpOk;
    torsoMesh.visible = chestMesh.visible = pelvisMesh.visible = torsoOk;
    if (torsoOk) {
      const shMid = mid(gp(11), gp(12)), hpMid = mid(gp(23), gp(24));
      placeCyl(torsoMesh, shMid, hpMid); chestMesh.position.copy(shMid); pelvisMesh.position.copy(hpMid);
    }
    head.visible = vis(lm, 0); neckMesh.visible = vis(lm, 0) && shOk;
    if (vis(lm, 0)) {
      const headC = gp(0).clone(); headC.y += 0.05; head.position.copy(headC);
      if (shOk) placeCyl(neckMesh, mid(gp(11), gp(12)), headC);
    }
    for (const w of [15, 16]) { const ok = vis(lm, w); handMesh[w].visible = ok; if (ok) handMesh[w].position.copy(gp(w)); }
    for (const [ank, toe] of [[27, 31], [28, 32]]) {
      const ok = vis(lm, ank); footMesh[ank].visible = ok;
      if (ok) {
        const a = gp(ank), b = vis(lm, toe) ? gp(toe) : a.clone().add(new THREE.Vector3(0, -0.02, -0.12));
        // стопа на своей реальной высоте — доска подстроится под неё
        footMesh[ank].position.copy(mid(a, b));
        let d = b.clone().sub(a); d.y = 0; if (d.lengthSq() < 1e-6) d.set(0, 0, -1); d.normalize();
        footMesh[ank].quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(UP, d).normalize(), UP, d));
      }
    }

    // доска / перенос веса — только если видны стопы и таз
    const feetOk = vis(lm, 27) && vis(lm, 28), hipOk = vis(lm, 23) && vis(lm, 24);
    board.visible = feetOk; disc.visible = feetOk && hipOk; beam.visible = feetOk && hipOk;
    if (feetOk) {
      const feetMid = mid(gp(27), gp(28));
      let ankleDir = gp(28).clone().sub(gp(27)); ankleDir.y = 0;
      if (ankleDir.lengthSq() < 1e-6) ankleDir.set(0, 0, 1); ankleDir.normalize();
      // Сёрф-стойка: ноги стоят ВДОЛЬ доски (передняя ближе к носу, задняя к хвосту),
      // поэтому длинная ось деки (локальный X) идёт по линии между стопами, а не поперёк неё.
      const widthAxis = new THREE.Vector3().crossVectors(ankleDir, UP).normalize();
      board.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ankleDir, UP, widthAxis));
      // Доска следует за стопами (под ними), а не приклеена к воде: при приседании
      // и прыжке связка «стопы — доска» остаётся целой. Отсчёт — от фактического
      // низа стоп-мешей (они уже расставлены выше), иначе стопа проваливается сквозь дек.
      board.position.copy(feetMid);
      const soleY = Math.min(
        footMesh[27].visible ? footMesh[27].position.y : Infinity,
        footMesh[28].visible ? footMesh[28].position.y : Infinity
      ) - FOOT_H / 2;
      board.position.y = soleY - BOARD_TH / 2;
      if (hipOk) {
        const shOk = vis(lm, 11) && vis(lm, 12);
        const com = shOk ? mid(gp(23), gp(24)).multiplyScalar(0.6).add(mid(gp(11), gp(12)).multiplyScalar(0.4)) : mid(gp(23), gp(24));
        const A = gp(27), B = gp(28), ab = B.clone().sub(A);
        let t = ab.lengthSq() > 1e-6 ? com.clone().sub(A).dot(ab) / ab.lengthSq() : 0.5;
        t = Math.max(0, Math.min(1, t));
        const foot = A.clone().add(ab.clone().multiplyScalar(t));
        foot.y = board.position.y + BOARD_TH / 2 + 0.012; // диск давления — на деке
        disc.position.copy(foot);
        const dev = Math.min(1, Math.abs(t - 0.5) * 2.2);
        const col = cGreen.clone().lerp(cWarn, dev);
        disc.material.color.copy(col); disc.material.emissive.copy(col).multiplyScalar(0.4); disc.scale.setScalar(1 + dev * 0.4);
        placeCyl(beam, mid(gp(23), gp(24)), foot); beam.material.color.copy(col); beam.material.emissive.copy(col).multiplyScalar(0.4);
      }
    }
  }

  let raf = null, onFrame = null;
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (playing && frames.length) {
      if (!lastT) lastT = t;
      if (t - lastT >= 1000 / fps) { lastT = t; idx = (idx + 1) % frames.length; draw(frames[idx]); onFrame && onFrame(idx, frames.length); }
    }
    controls.update(); renderer.render(scene, cam);
  }
  resize(); window.addEventListener("resize", resize);
  raf = requestAnimationFrame(loop);

  return {
    setFrames, setDepth, hasWorld: () => hasWorld,
    play() { playing = true; lastT = 0; }, pause() { playing = false; },
    toggle() { playing = !playing; lastT = 0; return playing; },
    setSpeed(f) { fps = f; },
    onFrame(cb) { onFrame = cb; },
    // покадровый разбор
    frameCount() { return frames.length; },
    frameIndex() { return idx; },
    isPlaying() { return playing; },
    seek(i) {
      if (!frames.length) return;
      idx = Math.max(0, Math.min(frames.length - 1, i | 0));
      playing = false;
      draw(frames[idx]);
      onFrame && onFrame(idx, frames.length);
    },
    step(d) { this.seek(idx + d); },
    resetView() { cam.position.set(1.6, 0.5, 2.9); controls.target.set(0, 0.1, 0); controls.update(); },
    renderOnce() { controls.update(); renderer.render(scene, cam); },
    scene, figure,
  };
}
