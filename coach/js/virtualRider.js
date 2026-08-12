// virtualRider.js — рисует «виртуального райдера»: анимированный скелет из
// оцифрованного движения (последовательности поз) на чистом фоне.
// Нормализует позу (центр по тазу, масштаб по торсу), чтобы аватар всегда
// был по центру и одного размера, независимо от исходного видео.

// связи скелета MediaPipe Pose (33 точки) — компактный набор
const CONN = [
  [11, 12], [11, 23], [12, 24], [23, 24],       // торс
  [11, 13], [13, 15],                            // левая рука
  [12, 14], [14, 16],                            // правая рука
  [23, 25], [25, 27], [27, 31],                  // левая нога
  [24, 26], [26, 28], [28, 32],                  // правая нога
];

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// lm: массив из 33 точек {x,y,v}. Рисует скелет по центру канваса.
export function drawSkeleton(ctx, W, H, lm, opts = {}) {
  ctx.clearRect(0, 0, W, H);
  if (!lm) return;
  const hip = mid(lm[23], lm[24]);
  const sh = mid(lm[11], lm[12]);
  const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y) || 0.001;
  const minDim = Math.min(W, H);
  const s = (0.30 / torso) * minDim; // торс ≈ 30% высоты
  const cx = W / 2, cy = H * 0.54;
  const P = (i) => ({ x: cx + (lm[i].x - hip.x) * s, y: cy + (lm[i].y - hip.y) * s, v: lm[i].v ?? lm[i].visibility ?? 1 });

  const accent = opts.color || "#38bdf8";
  // связи
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(3, minDim * 0.012);
  ctx.strokeStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = minDim * 0.02;
  for (const [a, b] of CONN) {
    const pa = P(a), pb = P(b);
    if (pa.v < 0.3 || pb.v < 0.3) continue;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  // суставы
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#22d3ee";
  for (let i = 11; i <= 32; i++) {
    const p = P(i);
    if (p.v < 0.3) continue;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, minDim * 0.008), 0, 7); ctx.fill();
  }
  // голова
  const nose = P(0);
  if (nose.v >= 0.3) {
    ctx.strokeStyle = accent; ctx.lineWidth = Math.max(2, minDim * 0.008);
    ctx.beginPath(); ctx.arc(nose.x, nose.y - minDim * 0.02, minDim * 0.03, 0, 7); ctx.stroke();
  }
}

// Проигрывает последовательность кадров на канвасе. frames: [[ [x,y,v]*33 ], ...] или [{landmarks}]
// Используем setInterval (а не requestAnimationFrame) — тикает и в фоновой вкладке.
export function playMotion(canvas, frames, { fps = 12, loop = true, onFrame } = {}) {
  const ctx = canvas.getContext("2d");
  const toLm = (f) => Array.isArray(f) ? f.map((p) => ({ x: p[0], y: p[1], v: p[2] })) : f.landmarks;
  let i = 0, timer = null, playing = true;
  const step = 1000 / fps;
  const draw = () => {
    drawSkeleton(ctx, canvas.width, canvas.height, toLm(frames[i]));
    if (onFrame) onFrame(i, frames.length);
    i++;
    if (i >= frames.length) { if (loop) i = 0; else { playing = false; clearInterval(timer); } }
  };
  draw(); // первый кадр сразу
  timer = setInterval(() => { if (playing) draw(); }, step);
  return {
    stop() { playing = false; clearInterval(timer); },
    toggle() { playing = !playing; },
  };
}
