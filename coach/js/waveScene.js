// waveScene.js — крупный план волны и райдера на ней.
// Катера в кадре нет: он далеко впереди, а важно то, ГДЕ на волне стоит райдер.
// Волна — гряда вдоль оси X с профилем поперёк (по Z): флэт → подошва → стенка →
// карман → гребень. Положение райдера определяет, толкает его волна или нет.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makeBoard } from "./board3d.js";
import { createAnatomy, POSES } from "./anatomy.js";

// Профиль волны поперёк: z — расстояние от гребня (0 — гребень, + за волну, − к катеру)
// amp — высота волны, steep — крутизна (скорость катера)
function waveProfile(z, amp, steep) {
  // За гребнем (z > 0) — крутой спад в флэт: у вейксёрф-волны спина короткая.
  if (z > 0) return amp * Math.exp(-Math.pow(z / (0.34 / steep), 1.5));
  // Перед гребнем (z < 0) — длинная вогнутая стенка, по ней и катаются,
  // ниже неё — подошва (корыто), из-за которой волна читается объёмной.
  const t = -z;
  const wall = Math.exp(-Math.pow(t / (1.55 / steep), 1.45));
  const trough = -0.3 * Math.exp(-Math.pow((t - 2.4 / steep) / (1.0 / steep), 2));
  return amp * (wall + trough);
}

export function createWaveScene(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 100);
  cam.position.set(4.6, 2.3, 5.2);
  const controls = new OrbitControls(cam, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.target.set(0, 0.35, 0);

  scene.add(new THREE.HemisphereLight(0xd7edff, 0x0a1a24, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(3, 6, 4); scene.add(sun);

  // ── вода ──
  const LEN = 26, WID = 16, SX = 150, SZ = 190;
  const geo = new THREE.PlaneGeometry(LEN, WID, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.24, metalness: 0.3, side: THREE.DoubleSide
  }));
  scene.add(water);
  const cDeep = new THREE.Color(0x0c4569), cMid = new THREE.Color(0x1b7ab0), cFoam = new THREE.Color(0xe4f3fa);

  // ── райдер ──
  const rider = new THREE.Group();
  const model = createAnatomy({ bulge: 1 });
  POSES["Сёрф-стойка"](model.parts);
  rider.add(model.root);
  const board = makeBoard();
  board.position.y = -0.02;
  rider.add(board);
  scene.add(rider);

  // ── подсветка зон ──
  const zoneMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const zones = {
    pocket: new THREE.Mesh(new THREE.PlaneGeometry(7, 1.15), zoneMat(0x34d399)),
    lip: new THREE.Mesh(new THREE.PlaneGeometry(7, 0.5), zoneMat(0xfbbf24)),
    flat: new THREE.Mesh(new THREE.PlaneGeometry(7, 2.4), zoneMat(0x64748b)),
  };
  for (const k in zones) { zones[k].rotation.x = -Math.PI / 2; scene.add(zones[k]); }

  // направление на катер — маленькая стрелка, чтобы было понятно, куда едем
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-3.4, 0.9, -2.6), 1.7, 0x9fd8ff, 0.4, 0.26
  );
  scene.add(arrow);

  let amp = 0.95, steep = 1, pos = 0.3, showZones = true;
  // pos: 0 — низко на стенке у подошвы, 1 — далеко на флэте за волной
  function zOfPos(p) { return -2.6 + p * 5.1; }    // −2.6 (подошва) … +2.5 (флэт)

  function updateWater() {
    const p = geo.attributes.position, col = geo.attributes.color, tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      let h = waveProfile(z, amp, steep);
      // живая вода: мелкая нерегулярная рябь, без полос вдоль гребня
      h += (Math.sin(x * 2.7 + z * 1.9) * Math.cos(x * 1.3 - z * 2.6)) * 0.012;
      p.setY(i, h);
      const k = Math.max(0, Math.min(1, h / (amp || 1)));
      // пена на самом гребне и в буруне
      const foam = Math.pow(k, 2.2) * (z > -0.35 && z < 0.5 ? 1 : 0.45);
      tmp.copy(h < 0 ? cDeep : cMid).lerp(cFoam, foam * 0.9);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    p.needsUpdate = true; col.needsUpdate = true;
    geo.computeVertexNormals();
  }

  function updateRider() {
    const z = zOfPos(pos);
    const h = waveProfile(z, amp, steep);
    rider.position.set(0, h + 0.02, z);
    // на стенке доска наклонена по склону волны
    const dz = 0.06;
    const slope = (waveProfile(z + dz, amp, steep) - waveProfile(z - dz, amp, steep)) / (2 * dz);
    rider.rotation.set(0, 0, 0);
    rider.rotation.x = Math.atan(slope) * 0.75;

    const put = (m, zc, vis) => {
      m.position.set(0, waveProfile(zc, amp, steep) + 0.05, zc);
      m.visible = showZones && vis !== false;
    };
    put(zones.pocket, -0.85);
    put(zones.lip, 0.02);
    put(zones.flat, 2.1);

    // сила: максимум в кармане (чуть ниже гребня), падает на флэте и на самом гребне
    const push = Math.max(0, Math.exp(-Math.pow((z + 0.85) / 0.9, 2)));
    if (opts.onPush) opts.onPush(push, z);
  }

  function resize() {
    const w = canvas.clientWidth || 900, h = canvas.clientHeight || 500;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  resize(); window.addEventListener("resize", resize);
  updateWater(); updateRider();

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, cam);
  })();

  return {
    setAmp(v) { amp = v; updateWater(); updateRider(); },
    setSteep(v) { steep = v; updateWater(); updateRider(); },
    setPos(v) { pos = v; updateRider(); },
    setZones(on) { showZones = on; updateRider(); },
    setView(name) {
      const V = {
        three: [4.6, 2.3, 5.2],
        side: [7.5, 1.4, 0.4],
        front: [0.4, 1.6, 6.2],
        top: [0.5, 7.5, 0.6],
      };
      cam.position.set(...(V[name] || V.three));
      controls.target.set(0, 0.35, 0);
      controls.update();
    },
    scene, rider
  };
}
