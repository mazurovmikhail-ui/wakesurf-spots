// waveScene.js — интерактивная сцена «катер и волна»: анатомия волны (карман,
// лип, стенка, флэт) и то, как положение райдера меняет силу, которая его несёт.
// Волна строится по той же логике, что реальная кильватерная: гребень идёт от
// кормы под углом, высота зависит от балласта, длина — от скорости катера.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makeBoard } from "./board3d.js";
import { createAnatomy, POSES } from "./anatomy.js";

// ── катер: корпус лофтом, палуба, стекло, вышка ──
function makeBoat() {
  const g = new THREE.Group();
  const L = 6.4, W = 2.1, H = 1.05;
  const NL = 26, NC = 16;
  const verts = [], idx = [];
  const outline = u => 0.32 + 0.68 * Math.sin(Math.min(1, u * 1.25) * Math.PI * 0.62); // нос уже кормы
  const deck = u => 1 - 0.16 * Math.pow(Math.max(0, u - 0.55) / 0.45, 2);
  for (let i = 0; i < NL; i++) {
    const u = i / (NL - 1);
    const x = (u - 0.5) * L;
    const w = (W / 2) * outline(u);
    const h = H * deck(u);
    for (let j = 0; j < NC; j++) {
      const a = (j / NC) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // V-образное днище: снизу сечение сужается
      const down = sa < 0 ? 0.55 : 1;
      verts.push(
        x,
        h * 0.5 * Math.sign(sa) * Math.pow(Math.abs(sa), 0.85),
        w * down * Math.sign(ca) * Math.pow(Math.abs(ca), 0.7)
      );
    }
  }
  for (let i = 0; i < NL - 1; i++) for (let j = 0; j < NC; j++) {
    const a = i * NC + j, b = i * NC + (j + 1) % NC, c = (i + 1) * NC + j, d = (i + 1) * NC + (j + 1) % NC;
    idx.push(a, c, b, b, c, d);
  }
  for (const [ring, dir] of [[0, -1], [NL - 1, 1]]) {
    const cI = verts.length / 3;
    verts.push((ring / (NL - 1) - 0.5) * L, 0, 0);
    for (let j = 0; j < NC; j++) {
      const a = ring * NC + j, b = ring * NC + (j + 1) % NC;
      if (dir > 0) idx.push(cI, a, b); else idx.push(cI, b, a);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.35, metalness: 0.15 })));

  // ватерлиния и палуба
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.94, 0.07, W * 0.86),
    new THREE.MeshStandardMaterial({ color: 0x2b8fd0, roughness: 0.3 }));
  stripe.position.y = -0.16; g.add(stripe);

  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, W * 0.72),
    new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.4 }));
  glass.position.set(0.35, 0.42, 0); glass.rotation.z = -0.22; g.add(glass);

  // вышка для фала
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0xb9c6cf, roughness: 0.3, metalness: 0.6 });
  for (const dz of [-0.62, 0.62]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10), tubeMat);
    leg.position.set(-0.15, 0.85, dz); leg.rotation.z = 0.18; g.add(leg);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.34, 10), tubeMat);
  bar.rotation.x = Math.PI / 2; bar.position.set(-0.4, 1.58, 0); g.add(bar);
  return g;
}

// ── волна: поверхность за кормой ──
// amp — высота (балласт), len — длина волны (скорость катера)
function waveHeight(x, z, amp, len) {
  // x — вдоль движения (0 у кормы, растёт назад), z — вбок
  if (x < -0.5) return 0;
  const decay = Math.exp(-x / (len * 3.2));           // затухание за кормой
  const dist = Math.abs(z) - x * 0.15 - 1.1;
  const across = Math.exp(-Math.pow(dist / 0.78, 2)); // гребень уходит вбок узкой полосой
  const crest = Math.sin(Math.min(1, Math.max(0, x) / (len * 0.45)) * Math.PI * 0.5);
  // впадина перед гребнем (корыто) — из-за неё волна читается объёмной
  const trough = -0.35 * Math.exp(-Math.pow((dist + 1.0) / 0.7, 2)) * decay;
  return amp * 1.5 * (decay * across * crest + trough);
}

export function createWaveScene(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
  cam.position.set(7.2, 3.4, 7.6);
  const controls = new OrbitControls(cam, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.target.set(1.8, 0.1, 0.9);

  scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x0a1a24, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.position.set(6, 9, 5); scene.add(sun);

  // вода
  const SIZE = 46, SEG = 190;
  const waterGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  waterGeo.rotateX(-Math.PI / 2);
  // цвет по вершинам: гребень белеет пеной, впадина темнее — так волна читается
  const colors = new Float32Array(waterGeo.attributes.position.count * 3);
  waterGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.26, metalness: 0.32, side: THREE.DoubleSide
  }));
  scene.add(water);
  const cDeep = new THREE.Color(0x0d4a72), cMid = new THREE.Color(0x1a76ab), cFoam = new THREE.Color(0xd8eef7);

  const boat = makeBoat();
  boat.position.set(-3.4, 0.32, 0);
  scene.add(boat);

  // райдер на доске
  const rider = new THREE.Group();
  const model = createAnatomy({ bulge: 1 });
  POSES["Сёрф-стойка"](model.parts);
  model.root.scale.setScalar(0.92);
  rider.add(model.root);
  const board = makeBoard();
  board.rotation.y = Math.PI / 2;      // доска вдоль движения
  board.position.y = -0.02;
  rider.add(board);
  scene.add(rider);

  // фал
  const ropeMat = new THREE.LineBasicMaterial({ color: 0xf1f5f9, transparent: true, opacity: 0.5 });
  const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), ropeMat);
  scene.add(rope);

  // подсветка зон волны
  const zoneMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false });
  const zones = {
    pocket: new THREE.Mesh(new THREE.CircleGeometry(0.95, 28), zoneMat(0x34d399)),
    lip: new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), zoneMat(0xfbbf24)),
    flat: new THREE.Mesh(new THREE.CircleGeometry(1.15, 28), zoneMat(0x64748b)),
  };
  for (const k in zones) { zones[k].rotation.x = -Math.PI / 2; scene.add(zones[k]); }

  let amp = 0.62, len = 2.2, pos = 0.42, showZones = true;
  const STERN = () => boat.position.x + 3.2;   // корма: волна и дистанции считаются от неё

  function updateWater() {
    const p = waterGeo.attributes.position;
    const col = waterGeo.attributes.color;
    const tmp = new THREE.Color();
    const peak = amp * 1.5;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const bx = x - STERN();                             // расстояние за кормой
      let h = waveHeight(bx, z, amp, len);
      h += Math.sin(x * 3.1 + z * 2.3) * Math.cos(z * 1.9) * 0.008; // мелкая рябь
      p.setY(i, h);
      const k = Math.max(0, Math.min(1, h / (peak || 1)));
      tmp.copy(h < 0 ? cDeep : cMid).lerp(cFoam, Math.pow(k, 1.6) * 0.85);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    p.needsUpdate = true;
    col.needsUpdate = true;
    waterGeo.computeVertexNormals();
  }

  // положение райдера: 0 — у самой кормы (в кармане), 1 — далеко назад (на флэте)
  function updateRider() {
    const xFromStern = 1.7 + pos * 5.0;                   // 1.7…6.7 м за кормой
    const x = STERN() + xFromStern;
    const zC = xFromStern * 0.15 + 1.1;                   // гребень уходит вбок
    const h = waveHeight(xFromStern, zC, amp, len);
    rider.position.set(x, h + 0.02, zC);
    rider.rotation.y = -0.22;

    // зоны
    const put = (m, dx, dz, r) => {
      const xx = xFromStern + dx, zz = zC + dz;
      m.position.set(STERN() + xx, waveHeight(xx, zz, amp, len) + 0.04, zz);
      m.scale.setScalar(r);
      m.visible = showZones;
    };
    put(zones.pocket, -0.15, 0, 1);
    put(zones.lip, 0.05, -0.72, 1);
    put(zones.flat, 2.2, 1.6, 1);

    // фал от вышки к рукам
    const handle = new THREE.Vector3(boat.position.x - 0.4, 1.9, 0);
    const hands = new THREE.Vector3(x, h + 1.05, zC);
    rope.geometry.setFromPoints([handle, hands]);
    rope.visible = pos < 0.5;                             // в кармане фал брошен

    // сила: в кармане волна толкает, дальше — отстаёшь
    const push = Math.max(0, 1 - Math.pow(Math.max(0, pos - 0.12) / 0.55, 2));
    if (opts.onPush) opts.onPush(push, pos);
  }

  function resize() {
    const w = canvas.clientWidth || 900, h = canvas.clientHeight || 500;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  resize(); window.addEventListener("resize", resize);
  updateWater(); updateRider();

  let t = 0;
  (function loop() {
    requestAnimationFrame(loop);
    t += 0.016;
    controls.update();
    renderer.render(scene, cam);
  })();

  return {
    setAmp(v) { amp = v; updateWater(); updateRider(); },
    setLen(v) { len = v; updateWater(); updateRider(); },
    setPos(v) { pos = v; updateRider(); },
    setZones(on) { showZones = on; updateRider(); },
    setView(name) {
      const V = {
        side: [0.5, 1.9, 9.5],
        back: [10.5, 2.6, 0.4],
        top: [1.5, 11, 0.6],
        three: [7.2, 3.4, 7.6],
      };
      cam.position.set(...(V[name] || V.three));
      controls.target.set(1.8, 0.1, 0.9);
      controls.update();
    },
    scene, rider, boat
  };
}
