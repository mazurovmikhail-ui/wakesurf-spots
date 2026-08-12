// trickAnalysis.js — эвристический авто-разбор трюка по временному ряду поз.
// Извлекает сигналы движения (высота таза, сгиб коленей, ориентация корпуса),
// находит фазы прыжка (присед → отталкивание → полёт/апекс → приземление),
// оценивает вращение и сверяет с чек-листом WakeTime (присед, поджать ноги, амортизация).
//
// ВАЖНО: пороги — черновые, требуют калибровки на реальных трюковых клипах.
// Алгоритм детекции фаз проверяется на синтетических данных.

import { LM } from "./pose.js";

// Локальные хелперы с префиксом ta*, чтобы не конфликтовать с analysis.js
// при склейке в единый файл (общая область видимости).
function taAngle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
  if (!m1 || !m2) return null;
  let cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}
const taMid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function taMedian(arr) {
  const a = arr.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Ряд сигналов по кадрам. level: высота таза над базовой линией (в долях торса, вверх +).
export function extractSignals(frames) {
  const sig = [];
  for (const f of frames) {
    const lm = f.landmarks;
    if (!lm) { sig.push({ t: f.t, ok: false }); continue; }
    const hip = taMid(lm[LM.lHip], lm[LM.rHip]);
    const sh = taMid(lm[LM.lShoulder], lm[LM.rShoulder]);
    const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y) || 1e-6;
    const kL = taAngle(lm[LM.lHip], lm[LM.lKnee], lm[LM.lAnkle]);
    const kR = taAngle(lm[LM.rHip], lm[LM.rKnee], lm[LM.rAnkle]);
    // ширина плеч по X (падает при развороте корпуса) и знак ориентации
    const shDx = lm[LM.rShoulder].x - lm[LM.lShoulder].x;
    sig.push({
      t: f.t, ok: true,
      hipY: hip.y, torso,
      knee: taMedian([kL, kR]),
      shoulderSpread: Math.abs(shDx) / torso,
      orient: Math.sign(shDx),
    });
  }
  // базовая линия таза = медиана hipY по «стабильным» кадрам, level вверх положительный
  const baseHipY = taMedian(sig.filter((s) => s.ok).map((s) => s.hipY));
  const baseTorso = taMedian(sig.filter((s) => s.ok).map((s) => s.torso)) || 1e-6;
  for (const s of sig) {
    if (s.ok) s.level = (baseHipY - s.hipY) / baseTorso; // >0 = таз выше базовой
  }
  return { sig, baseHipY, baseTorso };
}

// Главный разбор. Возвращает { isTrick, amplitude, phases, rotationDeg, checks[] }.
export function analyzeTrick(frames) {
  const { sig } = extractSignals(frames);
  const ok = sig.filter((s) => s.ok);
  if (ok.length < 6) return { isTrick: false, reason: "мало распознанных кадров" };

  const rideKnee = taMedian(ok.map((s) => s.knee)); // типичный сгиб «в езде»

  // Сглаживаем level (скользящее среднее по 3) — гасим покадровый шум/дрожь.
  const lvl = ok.map((s) => s.level);
  for (let i = 0; i < ok.length; i++) {
    const a = Math.max(0, i - 1), b = Math.min(ok.length - 1, i + 1);
    let sum = 0, cnt = 0;
    for (let j = a; j <= b; j++) { sum += lvl[j]; cnt++; }
    ok[i].slevel = sum / cnt;
  }

  // Прыжок = УСТОЙЧИВЫЙ отрыв: непрерывный участок slevel > AIR длиной ≥ MIN кадров/секунд.
  // Это отсекает одиночные всплески (шум камеры/точек) — их сглаживание убивает.
  const AIR = 0.10, MIN_AIR_FRAMES = 3, MIN_AIR_SEC = 0.22, MAX_AIR_SEC = 1.3;
  const maxSm = Math.max(...ok.map((s) => s.slevel));
  let best = null, cur = null;
  for (let i = 0; i < ok.length; i++) {
    if (ok[i].slevel > AIR) { cur = cur || { s: i, e: i }; cur.e = i; }
    else if (cur) { if (!best || cur.e - cur.s > best.e - best.s) best = cur; cur = null; }
  }
  if (cur && (!best || cur.e - cur.s > best.e - best.s)) best = cur;

  if (!best || best.e - best.s + 1 < MIN_AIR_FRAMES) {
    return { isTrick: false, amplitude: maxSm, reason: "прыжок не обнаружен (нет устойчивого отрыва)" };
  }
  const runFrames = ok.slice(best.s, best.e + 1);
  const airDur = runFrames[runFrames.length - 1].t - runFrames[0].t;
  if (airDur < MIN_AIR_SEC) {
    return { isTrick: false, amplitude: maxSm, reason: "прыжок слишком короткий (похоже на шум)" };
  }
  if (airDur > MAX_AIR_SEC) {
    // слишком долгий «отрыв» — это не прыжок, а езда выше по кадру / панорама камеры
    return { isTrick: false, amplitude: maxSm, reason: "устойчивый отрыв слишком длинный для прыжка" };
  }

  let apex = runFrames[0];
  for (const s of runFrames) if (s.slevel > apex.slevel) apex = s;
  const amplitude = apex.slevel;
  const takeoff = ok[best.s];
  const landing = ok[best.e];

  // присед перед отталкиванием: минимум knee в окне до takeoff (присед — короткий провал)
  const prepWin = ok.filter((s) => s.t <= takeoff.t && s.t > takeoff.t - 0.5);
  const prepKnees = prepWin.map((s) => s.knee).filter((x) => x != null);
  const prepKneeMin = prepKnees.length ? Math.min(...prepKnees) : rideKnee;
  // сгиб/поджатие в апексе
  const apexWin = ok.filter((s) => Math.abs(s.t - apex.t) < 0.15);
  const apexKnee = taMedian(apexWin.map((s) => s.knee)) ?? apex.knee;
  // амортизация после приземления: минимум knee сразу после landing
  const landWin = ok.filter((s) => s.t >= landing.t && s.t < landing.t + 0.4);
  const landKneeMin = Math.min(...landWin.map((s) => s.knee).filter((x) => x != null), rideKnee);

  // оценка вращения: смена знака ориентации + минимумы ширины плеч
  let flips = 0;
  const window = ok.filter((s) => s.t >= takeoff.t - 0.1 && s.t <= landing.t + 0.1);
  for (let i = 1; i < window.length; i++) {
    if (window[i].orient && window[i - 1].orient && window[i].orient !== window[i - 1].orient) flips++;
  }
  const rotationDeg = flips * 180;

  // чек-лист WakeTime (для прыжковых трюков)
  const checks = [
    {
      label: "Присед перед отталкиванием",
      ok: prepKneeMin < rideKnee - 8,
      detail: `колени сгибались до ~${Math.round(prepKneeMin)}° (норма езды ~${Math.round(rideKnee)}°)`,
    },
    {
      label: "Поджатие ног в воздухе",
      ok: apexKnee < rideKnee - 12,
      detail: `в апексе колени ~${Math.round(apexKnee)}° (чем меньше — тем сильнее поджал)`,
    },
    {
      label: "Амортизация на приземлении",
      ok: landKneeMin < rideKnee - 8,
      detail: `после приземления присед до ~${Math.round(landKneeMin)}° (WakeTime: «при приземлении приседаем»)`,
    },
    {
      label: "Амплитуда прыжка",
      ok: amplitude > 0.18,
      detail: `отрыв ~${amplitude.toFixed(2)}×торс (${amplitude > 0.18 ? "хорошая высота" : "низкий отрыв"})`,
    },
  ];
  if (rotationDeg >= 180) {
    checks.push({
      label: "Вращение",
      ok: true,
      detail: `оценка вращения ~${rotationDeg}° (по развороту корпуса)`,
    });
  }

  return {
    isTrick: true,
    amplitude,
    rotationDeg,
    rideKnee,
    phases: {
      prep: takeoff.t - 0.3,
      takeoff: takeoff.t,
      apex: apex.t,
      landing: landing.t,
    },
    checks,
  };
}
