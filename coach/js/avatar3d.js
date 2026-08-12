// avatar3d.js — реалистичный 3D-человек (готовая модель Soldier, риг Mixamo),
// поза переносится с MediaPipe через Kalidokit. Вращение мышкой, плейбек.
// Требует import map ("three","three/addons/") + Kalidokit UMD (window.Kalidokit).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const MODEL_URL = "https://threejs.org/examples/models/gltf/Soldier.glb";
// Kalidokit-имя → кость Mixamo
const MAP = {
  Hips: "mixamorigHips", Spine: "mixamorigSpine1",
  LeftUpperArm: "mixamorigLeftArm", LeftLowerArm: "mixamorigLeftForeArm",
  RightUpperArm: "mixamorigRightArm", RightLowerArm: "mixamorigRightForeArm",
  LeftUpperLeg: "mixamorigLeftUpLeg", LeftLowerLeg: "mixamorigLeftLeg",
  RightUpperLeg: "mixamorigRightUpLeg", RightLowerLeg: "mixamorigRightLeg",
};

export function create(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 16 / 10, 0.1, 100);
  cam.position.set(0, 1.1, 3.4);
  const controls = new OrbitControls(cam, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.set(0, 1.0, 0);
  function resize() { const w = canvas.clientWidth || 640, h = canvas.clientHeight || 400; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }

  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x223044, 1.3));
  const dl = new THREE.DirectionalLight(0xffffff, 2.0); dl.position.set(2, 4, 3); scene.add(dl);
  const grid = new THREE.GridHelper(8, 24, 0x1c3a5e, 0x14263f); grid.position.y = 0; scene.add(grid);

  const bones = {}; const initQ = {};
  let model = null, ready = false, pendingDraw = null;
  const K = window.Kalidokit;
  const loader = new GLTFLoader();
  loader.load(MODEL_URL, (gltf) => {
    model = gltf.scene;
    model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; if (o.isBone) { bones[o.name] = o; } });
    // сохранить исходные (rest) кватернионы костей
    for (const b in bones) initQ[b] = bones[b].quaternion.clone();
    scene.add(model);
    ready = true;
    if (pendingDraw) { draw(pendingDraw); pendingDraw = null; }
    if (opts.onReady) opts.onReady(Object.keys(bones).length);
  }, undefined, (e) => { if (opts.onError) opts.onError(String(e)); });

  // применить эйлер к кости: rest * delta, slerp для плавности
  const damp = { Hips: 0.7, Spine: 0.5, arm: 1, leg: 1 };
  function rigRot(kName, rot, dampener, lerp = 0.4) {
    const bone = bones[MAP[kName]]; if (!bone || !rot) return;
    const e = new THREE.Euler(rot.x * dampener, rot.y * dampener, rot.z * dampener);
    const target = new THREE.Quaternion().setFromEuler(e);
    // rest * delta (сохранить исходную ориентацию Mixamo-кости)
    const composed = initQ[MAP[kName]].clone().multiply(target);
    bone.quaternion.slerp(composed, lerp);
  }

  function applyRig(rig) {
    if (!rig) return;
    if (rig.Hips && rig.Hips.rotation) rigRot("Hips", rig.Hips.rotation, damp.Hips, 0.35);
    if (rig.Spine) rigRot("Spine", rig.Spine, damp.Spine, 0.35);
    rigRot("LeftUpperArm", rig.LeftUpperArm, damp.arm);
    rigRot("LeftLowerArm", rig.LeftLowerArm, damp.arm);
    rigRot("RightUpperArm", rig.RightUpperArm, damp.arm);
    rigRot("RightLowerArm", rig.RightLowerArm, damp.arm);
    rigRot("LeftUpperLeg", rig.LeftUpperLeg, damp.leg);
    rigRot("LeftLowerLeg", rig.LeftLowerLeg, damp.leg);
    rigRot("RightUpperLeg", rig.RightUpperLeg, damp.leg);
    rigRot("RightLowerLeg", rig.RightLowerLeg, damp.leg);
  }

  let frames = [], idx = 0, playing = true, fps = 12, lastT = 0;
  function draw(frame) {
    if (!ready) { pendingDraw = frame; return; }
    if (!frame || !frame.world || !frame.landmarks) return;
    let rig = null;
    try { rig = K.Pose.solve(frame.world, frame.landmarks, { runtime: "mediapipe", enableLegs: true }); } catch (e) { }
    applyRig(rig);
  }
  function setFrames(rawFrames) {
    frames = rawFrames.filter((f) => f.world && f.landmarks);
    idx = 0; if (frames.length) draw(frames[0]);
  }

  let raf = null, onFrame = null;
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (playing && frames.length && ready) {
      if (!lastT) lastT = t;
      if (t - lastT >= 1000 / fps) { lastT = t; idx = (idx + 1) % frames.length; draw(frames[idx]); onFrame && onFrame(idx, frames.length); }
    }
    controls.update(); renderer.render(scene, cam);
  }
  resize(); window.addEventListener("resize", resize); raf = requestAnimationFrame(loop);

  return {
    setFrames, isReady: () => ready,
    play() { playing = true; lastT = 0; }, pause() { playing = false; },
    toggle() { playing = !playing; lastT = 0; return playing; },
    setSpeed(f) { fps = f; },
    setDamp(k, v) { damp[k] = v; if (frames.length) draw(frames[idx]); },
    onFrame(cb) { onFrame = cb; },
    resetView() { cam.position.set(0, 1.1, 3.4); controls.target.set(0, 1.0, 0); controls.update(); },
    renderOnce() { controls.update(); renderer.render(scene, cam); },
    boneNames: () => Object.keys(bones), scene, cam,
  };
}
