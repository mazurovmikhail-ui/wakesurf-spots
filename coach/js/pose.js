// pose.js — обёртка над MediaPipe Pose Landmarker.
// Извлекает последовательность 33 точек скелета по кадрам видео.

import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

let landmarker = null;
let poseClock = 0; // глобальный монотонный таймстамп (мс) для VIDEO-режима MediaPipe

export async function initPose() {
  if (landmarker) return landmarker;
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return landmarker;
}

// Названия точек, которые нам важны (индексы MediaPipe Pose).
export const LM = {
  nose: 0,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
  lHeel: 29, rHeel: 30,
  lToe: 31, rToe: 32,
};

// Прогоняет видео и возвращает массив кадров:
//   { t, landmarks: [{x,y,z,visibility}...] | null }
// onProgress(0..1) — колбэк прогресса.
export async function extractSequence(video, { fps = 12, onProgress } = {}) {
  await initPose();
  const duration = video.duration;
  if (!isFinite(duration) || duration === 0) {
    throw new Error("Не удалось прочитать длительность видео");
  }
  const step = 1 / fps;
  const frames = [];
  video.pause();

  for (let t = 0; t < duration; t += step) {
    await seek(video, t);
    // MediaPipe VIDEO-режим требует СТРОГО возрастающие таймстампы для ВСЕХ вызовов
    // одного распознавателя. Разные видео стартуют с t=0, поэтому используем
    // глобальный монотонный счётчик, а не время внутри клипа (иначе второе видео
    // «уходит назад» и детекция ломается).
    poseClock += 50;
    let result;
    try {
      result = landmarker.detectForVideo(video, poseClock);
    } catch (e) {
      result = null;
    }
    const lm =
      result && result.landmarks && result.landmarks.length
        ? result.landmarks[0]
        : null;
    // worldLandmarks — 3D-координаты в метрах (для 3D-вьюера), центр в тазу.
    const world =
      result && result.worldLandmarks && result.worldLandmarks.length
        ? result.worldLandmarks[0]
        : null;
    frames.push({ t, landmarks: lm, world });
    if (onProgress) onProgress(Math.min(1, t / duration));
  }
  if (onProgress) onProgress(1);
  return frames;
}

function seek(video, t) {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    // clamp, иначе seek может «зависнуть» на конце
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.001));
  });
}

// Рисует скелет одного кадра на canvas поверх видео.
export function drawFrame(canvas, video, landmarks) {
  const ctx = canvas.getContext("2d");
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;
  const du = new DrawingUtils(ctx);
  du.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: "#38bdf8",
    lineWidth: 3,
  });
  du.drawLandmarks(landmarks, {
    color: "#22d3ee",
    fillColor: "#0b1120",
    lineWidth: 1,
    radius: 3,
  });
}
