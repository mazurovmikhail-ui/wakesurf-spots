// riderAvatar.js — реалистичный 3D-райдер: готовая модель человека со скелетом,
// поза переносится с MediaPipe через aim-констрейнты (кость наводится на направление
// между суставами). Плюс доска, волна и визуализация переноса веса — как в rider3d.
// Модель: RiggedFigure © 2017 Cesium, CC BY 4.0.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makeBoard, BOARD_TH } from "./board3d.js";

const MODEL_URL = "models/rigged-figure.glb";

// кость → [точка MediaPipe у начала, точка у конца]; наводим кость на это направление
const CHAINS = [
  ["arm_L_1", "arm_joint_L_1", "arm_joint_L_2", 11, 13],
  ["arm_L_2", "arm_joint_L_2", "arm_joint_L_3", 13, 15],
  ["arm_R_1", "arm_joint_R_1", "arm_joint_R_2", 12, 14],
  ["arm_R_2", "arm_joint_R_2", "arm_joint_R_3", 14, 16],
  ["leg_L_1", "leg_joint_L_1", "leg_joint_L_2", 23, 25],
  ["leg_L_2", "leg_joint_L_2", "leg_joint_L_3", 25, 27],
  ["leg_R_1", "leg_joint_R_1", "leg_joint_R_2", 24, 26],
  ["leg_R_2", "leg_joint_R_2", "leg_joint_R_3", 26, 28],
];

const VIS = 0.4;
const FEETY = -0.85;
const FOOT_CLEAR = 0.06;

function makeWater() {
  const grp = new THREE.Group();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9, 9),
    new THREE.MeshStandardMaterial({ color: 0x0e3a5a, transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.3 }));
  water.rotation.x = -Math.PI / 2; water.position.y = FEETY - 0.02; grp.add(water);
  const g = new THREE.PlaneGeometry(4.6, 1.8, 48, 16);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), y = pos.getY(i);
    const ty = Math.max(0, Math.min(1, (y + 0.9) / 1.8));
    pos.setZ(i, -Math.pow(ty, 1.6) * 0.9 - Math.sin(u * 0.7) * 0.04);
  }
  g.computeVertexNormals();
  const wave = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x1c6ea3, transparent: true, opacity: 0.42, roughness: 0.25, metalness: 0.2, side: THREE.DoubleSide }));
  wave.position.set(0, FEETY + 0.72, -0.8); grp.add(wave);
  return grp;
}

export function create(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 16 / 10, 0.1, 100);
  cam.position.set(1.7, 0.45, 3.0);
  const controls = new OrbitControls(cam, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.set(0, 0.05, 0);
  function resize() { const w = canvas.clientWidth || 640, h = canvas.clientHeight || 400; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }

  scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x0b1120, 1.15));
  const dl = new THREE.DirectionalLight(0xffffff, 1.8); dl.position.set(2.5, 4, 3); scene.add(dl);
  scene.add(makeWater());

  const rig = new THREE.Group(); scene.add(rig);
  const board = makeBoard(); scene.add(board);

  // перенос веса
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 24),
    new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x0f5a3a, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 10),
    new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x0f5a3a, emissiveIntensity: 0.7, transparent: true, opacity: 0.7 }));
  scene.add(disc, beam);
  const cGreen = new THREE.Color(0x34d399), cWarn = new THREE.Color(0xfbbf24);

  let model = null, bones = {}, ready = false, hips = null, chest = null;
  let modelScale = 1, restLegLen = 0, targetLegLen = 0;
  function applyScale() {
    if (!restLegLen) return;
    modelScale = (targetLegLen || 0.78) / restLegLen;
    rig.scale.setScalar(modelScale);
  }

  new GLTFLoader().load(MODEL_URL, (gltf) => {
    model = gltf.scene;
    model.traverse(o => {
      if (o.isBone) bones[o.name] = o;
      if (o.isMesh) {
        o.frustumCulled = false;
        o.material = new THREE.MeshStandardMaterial({ color: 0x2b3a4d, roughness: 0.5, metalness: 0.12, emissive: 0x0c141d, emissiveIntensity: 0.5, skinning: true });
      }
    });
    hips = bones["torso_joint_1"]; chest = bones["torso_joint_3"];
    rig.add(model);
    // Масштаб — по длине ноги: именно ноги решают, где окажется доска.
    // Rest-длина бедро→щиколотка приводится к длине из видео.
    model.updateWorldMatrix(true, true);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const hipB = bones["leg_joint_L_1"], kneeB = bones["leg_joint_L_2"], ankB = bones["leg_joint_L_3"];
    if (hipB && kneeB && ankB) {
      hipB.getWorldPosition(a); kneeB.getWorldPosition(b); ankB.getWorldPosition(c);
      restLegLen = a.distanceTo(b) + b.distanceTo(c);
    }
    applyScale();
    ready = true;
    opts.onReady && opts.onReady(Object.keys(bones).length);
    if (frames.length) draw(frames[idx]);
  }, undefined, e => opts.onError && opts.onError(String(e)));

  // ── риггинг: наводим кость на нужное направление ──
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  function aim(bone, child, targetDir) {
    if (!bone || !child || targetDir.lengthSq() < 1e-8) return;
    bone.updateWorldMatrix(true, false);
    child.updateWorldMatrix(true, false);
    bone.getWorldPosition(v1); child.getWorldPosition(v2);
    v3.copy(v2).sub(v1);
    if (v3.lengthSq() < 1e-8) return;
    v3.normalize();
    qa.setFromUnitVectors(v3, targetDir);
    bone.getWorldQuaternion(qb);
    qb.premultiply(qa);
    bone.parent.getWorldQuaternion(qc);
    bone.quaternion.copy(qc.invert().multiply(qb));
    bone.updateWorldMatrix(false, true);
  }

  let frames = [], idx = 0, playing = true, fps = 12, lastT = 0, onFrame = null;
  let gScale = 3, depthFactor = 0.35, shifts = [];

  const vis = (lm, i) => (lm[i] && (lm[i].visibility ?? 1)) >= VIS;

  function smooth(arr, win) {
    const N = arr.length, out = arr.map(f => f.map(p => ({ ...p }))), k = win >> 1;
    for (let i = 0; i < N; i++) for (let j = 0; j < 33; j++) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let w = Math.max(0, i - k); w <= Math.min(N - 1, i + k); w++) { sx += arr[w][j].x; sy += arr[w][j].y; sz += arr[w][j].z; n++; }
      out[i][j] = { x: sx / n, y: sy / n, z: sz / n, visibility: arr[i][j].visibility };
    }
    return out;
  }

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

  function setFrames(rawFrames, smoothWin = 5) {
    const poses = rawFrames.filter(f => f.landmarks).map(f => f.landmarks);
    frames = poses.length > 3 ? (smoothWin > 1 ? smooth(poses, smoothWin) : poses) : [];
    const hs = [];
    for (const f of frames) {
      let mn = 1e9, mx = -1e9, n = 0;
      for (let i = 0; i < 33; i++) if ((f[i].visibility ?? 1) >= VIS) { mn = Math.min(mn, f[i].y); mx = Math.max(mx, f[i].y); n++; }
      if (n >= 6) hs.push(mx - mn);
    }
    hs.sort((a, b) => a - b);
    gScale = 1.7 / Math.max(hs.length ? hs[hs.length >> 1] : 0.5, 1e-3);
    // длина ноги из видео (медиана) — под неё масштабируется модель
    const legs = [];
    for (const f of frames) {
      if (!vis(f, 23) || !vis(f, 25) || !vis(f, 27)) continue;
      const d = (i, j) => Math.hypot(f[i].x - f[j].x, f[i].y - f[j].y) * gScale;
      legs.push(d(23, 25) + d(25, 27));
    }
    legs.sort((a, b) => a - b);
    if (legs.length) { targetLegLen = legs[legs.length >> 1]; applyScale(); }
    const fy = frames.map(f => footYOf(f));
    for (let i = 0; i < fy.length; i++) if (fy[i] == null) fy[i] = fy[i - 1] ?? 0;
    const win = Math.max(5, Math.min(41, Math.floor(frames.length / 6) | 1)), k = win >> 1;
    shifts = fy.map((_, i) => {
      let s = 0, n = 0;
      for (let w = Math.max(0, i - k); w <= Math.min(fy.length - 1, i + k); w++) { s += fy[w]; n++; }
      return FEETY + 0.02 - s / n;
    });
    idx = 0; if (frames.length && ready) draw(frames[0]);
  }
  function setDepth(d) { depthFactor = d; if (frames.length && ready) draw(frames[idx]); }

  function draw(lm) {
    if (!ready || !hips) return;
    let nv = 0; for (let i = 0; i < 33; i++) if (vis(lm, i)) nv++;
    if (nv < 6) return;

    let cx, cy;
    if (vis(lm, 23) && vis(lm, 24)) { cx = (lm[23].x + lm[24].x) / 2; cy = (lm[23].y + lm[24].y) / 2; }
    else { let sx = 0, sy = 0, n = 0; for (let i = 0; i < 33; i++) if (vis(lm, i)) { sx += lm[i].x; sy += lm[i].y; n++; } cx = sx / n; cy = sy / n; }
    const shift = shifts[idx] ?? 0;
    const P = i => new THREE.Vector3((lm[i].x - cx) * gScale, -(lm[i].y - cy) * gScale + shift, -((lm[i].z || 0)) * gScale * depthFactor);

    const V = {}; const gp = i => (V[i] || (V[i] = P(i)));

    // корень: таз в мире + поворот корпуса (таз→грудь и линия плеч)
    const hipOk = vis(lm, 23) && vis(lm, 24), shOk = vis(lm, 11) && vis(lm, 12);
    if (!hipOk) return;
    const hipMid = gp(23).clone().add(gp(24)).multiplyScalar(0.5);
    rig.position.copy(hipMid);
    rig.updateWorldMatrix(true, true);
    // компенсация: origin модели ≠ таз, поэтому доводим таз ровно в hipMid
    const hw = new THREE.Vector3(); hips.getWorldPosition(hw);
    rig.position.add(hipMid.clone().sub(hw));
    if (shOk) {
      const shMid = gp(11).clone().add(gp(12)).multiplyScalar(0.5);
      const up = shMid.clone().sub(hipMid).normalize();
      const across = gp(12).clone().sub(gp(11)); across.normalize();
      const fwd = new THREE.Vector3().crossVectors(across, up).normalize();
      const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
      rig.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
    }
    rig.updateWorldMatrix(true, true);

    // конечности
    for (const [, boneName, childName, a, b] of CHAINS) {
      if (!vis(lm, a) || !vis(lm, b)) continue;
      const dir = gp(b).clone().sub(gp(a));
      if (dir.lengthSq() < 1e-8) continue;
      aim(bones[boneName], bones[childName], dir.normalize());
    }

    // доска — под стопами, длинной осью вдоль линии стоп (сёрф-стойка)
    const feetOk = vis(lm, 27) && vis(lm, 28);
    board.visible = disc.visible = beam.visible = feetOk;
    if (feetOk) {
      // доска ставится под СТОПЫ МОДЕЛИ (а не под точки видео) — иначе она
      // разъезжается с фигурой, у которой свои пропорции
      rig.updateWorldMatrix(true, true);
      const ankL = bones["leg_joint_L_3"], ankR = bones["leg_joint_R_3"];
      const A = new THREE.Vector3(), B = new THREE.Vector3();
      if (ankL && ankR) { ankL.getWorldPosition(A); ankR.getWorldPosition(B); }
      else { A.copy(gp(27)); B.copy(gp(28)); }
      const feetMid = A.clone().add(B).multiplyScalar(0.5);
      const along = B.clone().sub(A); along.y = 0;
      if (along.lengthSq() < 1e-6) along.set(0, 0, 1);
      along.normalize();
      const width = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0)).normalize();
      board.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, new THREE.Vector3(0, 1, 0), width));
      board.position.copy(feetMid);
      board.position.y = Math.min(A.y, B.y) - FOOT_CLEAR - BOARD_TH / 2;

      // точка приложения веса между стопами
      const com = shOk
        ? hipMid.clone().multiplyScalar(0.6).add(gp(11).clone().add(gp(12)).multiplyScalar(0.5).multiplyScalar(0.4))
        : hipMid.clone();
      const ab = B.clone().sub(A);
      let t = ab.lengthSq() > 1e-6 ? com.clone().sub(A).dot(ab) / ab.lengthSq() : 0.5;
      t = Math.max(0, Math.min(1, t));
      const foot = A.clone().add(ab.multiplyScalar(t));
      foot.y = board.position.y + BOARD_TH / 2 + 0.012;
      disc.position.copy(foot);
      const dev = Math.min(1, Math.abs(t - 0.5) * 2.2);
      const col = cGreen.clone().lerp(cWarn, dev);
      disc.material.color.copy(col); disc.material.emissive.copy(col).multiplyScalar(0.4);
      disc.scale.setScalar(1 + dev * 0.4);
      const d = foot.clone().sub(hipMid), len = d.length() || 1e-4;
      beam.position.copy(hipMid).add(foot).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      beam.scale.set(1, len, 1);
      beam.material.color.copy(col); beam.material.emissive.copy(col).multiplyScalar(0.4);
    }
  }

  function loop(t) {
    requestAnimationFrame(loop);
    if (playing && frames.length && ready) {
      if (!lastT) lastT = t;
      if (t - lastT >= 1000 / fps) { lastT = t; idx = (idx + 1) % frames.length; draw(frames[idx]); onFrame && onFrame(idx, frames.length); }
    }
    controls.update(); renderer.render(scene, cam);
  }
  resize(); window.addEventListener("resize", resize);
  requestAnimationFrame(loop);

  return {
    setFrames, setDepth,
    isReady: () => ready,
    play() { playing = true; lastT = 0; }, pause() { playing = false; },
    toggle() { playing = !playing; lastT = 0; return playing; },
    isPlaying: () => playing,
    setSpeed(f) { fps = f; },
    onFrame(cb) { onFrame = cb; },
    frameCount: () => frames.length,
    frameIndex: () => idx,
    seek(i) {
      if (!frames.length) return;
      idx = Math.max(0, Math.min(frames.length - 1, i | 0));
      playing = false; draw(frames[idx]);
      onFrame && onFrame(idx, frames.length);
    },
    step(d) { this.seek(idx + d); },
    resetView() { cam.position.set(1.7, 0.45, 3.0); controls.target.set(0, 0.05, 0); controls.update(); },
    // снимок сцены (для проверки картинки без окна браузера)
    snapshot(camPos, target) {
      if (camPos) cam.position.set(...camPos);
      if (target) controls.target.set(...target);
      cam.lookAt(controls.target);
      renderer.render(scene, cam);
      return canvas.toDataURL("image/png");
    },
    scene, rig
  };
}
