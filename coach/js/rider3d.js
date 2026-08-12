// rider3d.js — интерактивный 3D-вьюер «виртуального райдера» v2.
// Объёмная фигура из 3D-точек MediaPipe + РЕАЛЬНАЯ доска (форма сёрфа с финами),
// образ волны (стенка + вода) и визуализация ПЕРЕНОСА ВЕСА (диск давления + луч).
// Требует import map в HTML: "three" и "three/addons/".
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
];
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const ACCENT = 0x38bdf8, JOINTC = 0x22d3ee;

function toVec(p) { return new THREE.Vector3(p.x, -p.y, -p.z); }
function mid(a, b) { return a.clone().add(b).multiplyScalar(0.5); }

// ---- реальная доска (форма сёрфа) как Group ----
function makeBoard() {
  const L = 1.0, W = 0.30, w = W / 2, th = 0.045;
  const s = new THREE.Shape();
  s.moveTo(-L / 2, 0);
  s.bezierCurveTo(-L / 2, w, -L / 4, w, 0, w);
  s.bezierCurveTo(L / 3, w, L / 2, w * 0.35, L / 2, 0);
  s.bezierCurveTo(L / 2, -w * 0.35, L / 3, -w, 0, -w);
  s.bezierCurveTo(-L / 4, -w, -L / 2, -w, -L / 2, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, steps: 1 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, th / 2, 0); // положить плоско
  const deck = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2f8fce, roughness: 0.35, metalness: 0.15, emissive: 0x0a2f47, emissiveIntensity: 0.4 }));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.9, 0.005, 0.02), new THREE.MeshStandardMaterial({ color: 0x8fd6ff, emissive: 0x2a6f92, emissiveIntensity: 0.6 }));
  stripe.position.y = th + 0.005;
  const group = new THREE.Group(); group.add(deck, stripe);
  // фины снизу у хвоста
  const finMat = new THREE.MeshStandardMaterial({ color: 0x14364f, roughness: 0.5 });
  for (const dz of [-0.09, 0.09, 0]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 4), finMat);
    fin.rotation.x = Math.PI; fin.rotation.y = Math.PI / 4;
    fin.position.set(-L / 2 + 0.14, -0.05, dz === 0 ? 0 : dz);
    if (dz === 0) fin.position.x = -L / 2 + 0.06;
    group.add(fin);
  }
  return group;
}

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

  // материал «манекен» (мягкий телесно-серый, приближено к реалистичному телу)
  const skin = new THREE.MeshStandardMaterial({ color: 0xc7bcb0, roughness: 0.8, metalness: 0.04, emissive: 0x241d17, emissiveIntensity: 0.35 });
  const figure = new THREE.Group(); scene.add(figure);

  // конечности: цилиндр + сферы на концах = капсула с объёмом (разная толщина)
  const LIMBS = [
    [11, 13, 0.05], [13, 15, 0.038], [12, 14, 0.05], [14, 16, 0.038],   // руки: плечо, предплечье
    [23, 25, 0.078], [25, 27, 0.055], [24, 26, 0.078], [26, 28, 0.055],  // ноги: бедро, голень
  ];
  const limbMesh = LIMBS.map(([, , r]) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 14), skin); figure.add(m); return m; });
  const JOINTR = { 11: 0.075, 12: 0.075, 13: 0.05, 14: 0.05, 15: 0.045, 16: 0.045, 23: 0.09, 24: 0.09, 25: 0.075, 26: 0.075, 27: 0.055, 28: 0.055 };
  const capMesh = {};
  for (const j of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { const m = new THREE.Mesh(new THREE.SphereGeometry(JOINTR[j], 16, 12), skin); figure.add(m); capMesh[j] = m; }

  // корпус: торс, грудь, таз, шея, голова, кисти, стопы
  const torsoMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.11, 1, 18), skin); figure.add(torsoMesh);
  const chestMesh = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 14), skin); figure.add(chestMesh);
  const pelvisMesh = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), skin); figure.add(pelvisMesh);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 1, 10), skin); figure.add(neckMesh);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 22, 18), skin); figure.add(head);
  const handMesh = { 15: new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), skin), 16: new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), skin) };
  figure.add(handMesh[15], handMesh[16]);
  const footMesh = { 27: new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.2), skin), 28: new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.2), skin) };
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
    mesh.scale.set(1, len, 1);
  }
  const cGreen = new THREE.Color(0x34d399), cWarn = new THREE.Color(0xfbbf24);

  let frames = [], idx = 0, playing = true, fps = 12, lastT = 0, hasWorld = false, _raw = [];
  let gScale = 3, depthFactor = 0.35; // единый масштаб на клип + слабая глубина (почти 2D)

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
    idx = 0; if (frames.length) draw(frames[0]);
  }
  function setDepth(d) { depthFactor = d; if (frames.length) draw(frames[idx]); }

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

    // ступни на воду
    const feetPts = [27, 28, 31, 32].filter((i) => vis(lm, i)).map((i) => P(i).y);
    const footY = feetPts.length ? Math.min(...feetPts) : -0.85;
    const shift = FEETY + 0.02 - footY;

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
        footMesh[ank].position.copy(mid(a, b)); footMesh[ank].position.y = FEETY + 0.03;
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
      const lenAxis = new THREE.Vector3().crossVectors(UP, ankleDir).normalize();
      board.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(lenAxis, UP, ankleDir));
      board.position.copy(feetMid); board.position.y = FEETY;
      if (hipOk) {
        const shOk = vis(lm, 11) && vis(lm, 12);
        const com = shOk ? mid(gp(23), gp(24)).multiplyScalar(0.6).add(mid(gp(11), gp(12)).multiplyScalar(0.4)) : mid(gp(23), gp(24));
        const A = gp(27), B = gp(28), ab = B.clone().sub(A);
        let t = ab.lengthSq() > 1e-6 ? com.clone().sub(A).dot(ab) / ab.lengthSq() : 0.5;
        t = Math.max(0, Math.min(1, t));
        const foot = A.clone().add(ab.clone().multiplyScalar(t)); foot.y = FEETY + 0.03;
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
    resetView() { cam.position.set(1.6, 0.5, 2.9); controls.target.set(0, 0.1, 0); controls.update(); },
    renderOnce() { controls.update(); renderer.render(scene, cam); },
    scene, figure,
  };
}
