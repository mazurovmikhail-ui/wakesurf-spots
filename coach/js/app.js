// app.js — UI и оркестрация: загрузка видео → распознавание позы → анализ → вывод.
import { initPose, extractSequence, drawFrame } from "./pose.js";
import { aggregate, evaluate, summarize, RULES } from "./analysis.js";
import { TRICK_GROUPS, LEVEL_COLOR, MISTAKES, SCHOOLS } from "./tricks.js";
import { analyzeTrick } from "./trickAnalysis.js";
import { LESSONS, CATS } from "./coachKnowledge.js";

const $ = (id) => document.getElementById(id);

const state = {
  student: { file: null, url: null, frames: null, metrics: null },
  ref: { file: null, url: null, frames: null, metrics: null },
  playing: false,
};

// ---- инициализация ML ----
(async () => {
  try {
    await initPose();
    setStatus("ML-движок готов ✓", "ready");
  } catch (e) {
    console.error(e);
    setStatus("Не удалось загрузить ML-движок (нужен интернет)", "error");
  }
})();

function setStatus(text, cls = "") {
  const el = $("engineStatus");
  el.textContent = text;
  el.className = "status " + cls;
}

// ---- встроенные эталоны (положи файлы в assets/reference/) ----
const PRESETS = [
  // { name: "Базовая стойка (гоу-сайд)", src: "assets/reference/basic-goofy.mp4" },
];
{
  const sel = $("refPreset");
  for (const p of PRESETS) {
    const o = document.createElement("option");
    o.value = p.src;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  if (!PRESETS.length) {
    sel.querySelector("option").textContent = "— встроенных эталонов пока нет —";
  }
}

// ---- загрузка файлов / drag&drop ----
function wireDrop(dropId, inputId, slot) {
  const drop = $(dropId);
  const input = $(inputId);
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files[0]) setFile(slot, input.files[0], drop);
  });
  ["dragover", "dragenter"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
    })
  );
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("video/")) setFile(slot, f, drop);
  });
}

function setFile(slot, file, dropEl) {
  const s = state[slot];
  if (s.url) URL.revokeObjectURL(s.url);
  s.file = file;
  s.url = URL.createObjectURL(file);
  s.frames = null;
  s.metrics = null;
  if (dropEl) {
    dropEl.classList.add("filled");
    dropEl.querySelector(".drop-title").textContent = "✓ " + file.name.slice(0, 28);
  }
  refreshAnalyzeBtn();
}

wireDrop("dropStudent", "fileStudent", "student");
wireDrop("dropRef", "fileRef", "ref");

$("refPreset").addEventListener("change", (e) => {
  const src = e.target.value;
  if (!src) return;
  state.ref.file = "preset";
  state.ref.url = src;
  state.ref.frames = null;
  state.ref.metrics = null;
  const drop = $("dropRef");
  drop.classList.add("filled");
  drop.querySelector(".drop-title").textContent = "✓ эталон выбран";
  refreshAnalyzeBtn();
});

function refreshAnalyzeBtn() {
  $("analyzeBtn").disabled = !state.student.url;
}

// ---- анализ ----
$("analyzeBtn").addEventListener("click", runAnalysis);
$("rescanBtn").addEventListener("click", () => location.reload());

async function runAnalysis() {
  $("analyzeBtn").disabled = true;
  $("progressPanel").hidden = false;
  $("resultPanel").hidden = true;
  const hasRef = !!state.ref.url;

  try {
    // 1. Ученик
    setProgress(0, "Распознаю скелет на твоём видео…");
    state.student.frames = await processVideo("videoStudent", state.student.url, (p) =>
      setProgress(p * (hasRef ? 0.5 : 0.9), "Распознаю скелет на твоём видео…")
    );
    state.student.metrics = aggregate(state.student.frames);

    // 2. Эталон (если есть)
    if (hasRef) {
      setProgress(0.5, "Распознаю скелет на эталоне…");
      state.ref.frames = await processVideo("videoRef", state.ref.url, (p) =>
        setProgress(0.5 + p * 0.4, "Распознаю скелет на эталоне…")
      );
      state.ref.metrics = aggregate(state.ref.frames);
    }

    setProgress(0.95, "Считаю метрики и ищу ошибки…");
    if (state.student.metrics.framesUsed < 3) {
      throw new Error(
        "Почти не видно силуэт в кадре. Сними сбоку, так чтобы всё тело помещалось в кадр."
      );
    }

    const result = evaluate(state.student.metrics, hasRef ? state.ref.metrics : null);
    setProgress(1, "Готово");
    renderResult(result, hasRef);
  } catch (e) {
    console.error(e);
    setProgress(1, "Ошибка");
    $("progressStage").textContent = "⚠️ " + e.message;
    $("analyzeBtn").disabled = false;
  }
}

function setProgress(p, stage) {
  const pct = Math.round(p * 100);
  $("progressFill").style.width = pct + "%";
  $("progressLabel").textContent = pct + "%";
  if (stage) $("progressStage").textContent = stage;
}

// Загружает видео в <video> и извлекает последовательность поз.
function processVideo(videoElId, url, onProgress) {
  return new Promise((resolve, reject) => {
    const video = $(videoElId);
    video.src = url;
    video.crossOrigin = "anonymous";
    const onReady = async () => {
      video.removeEventListener("loadeddata", onReady);
      try {
        // адаптивный fps: короткое видео — плотнее, длинное — реже
        const fps = video.duration > 15 ? 8 : 12;
        const frames = await extractSequence(video, { fps, onProgress });
        video.currentTime = 0;
        resolve(frames);
      } catch (err) {
        reject(err);
      }
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", () =>
      reject(new Error("Не удалось открыть видео (формат не поддержан браузером)"))
    );
    video.load();
  });
}

// ---- вывод результата ----
function renderResult(result, hasRef) {
  $("progressPanel").hidden = true;
  $("resultPanel").hidden = false;

  // балл
  $("scoreValue").textContent = result.score;
  $("scoreRing").style.setProperty("--pct", result.score);
  const ringColor =
    result.score >= 85 ? "var(--good)" : result.score >= 60 ? "var(--accent)" : result.score >= 45 ? "var(--warn)" : "var(--bad)";
  $("scoreRing").style.background = `conic-gradient(${ringColor} calc(var(--pct) * 1%), var(--panel-2) 0)`;
  $("scoreSummary").textContent = summarize(result.score, result.findings);

  // подсказки
  const list = $("feedbackList");
  list.innerHTML = "";
  const icons = { bad: "🔴", warn: "🟡", good: "🟢" };
  for (const f of result.findings) {
    const li = document.createElement("li");
    li.className = f.severity;
    const phase = f.phase ? `<span class="fb-phase">${f.phase}</span>` : "";
    const cue = f.cue ? `<p class="fb-cue">→ ${f.cue}</p>` : "";
    li.innerHTML = `
      <span class="fb-icon">${icons[f.severity]}</span>
      <div>
        <p class="fb-title">${f.title} ${phase}</p>
        <p class="fb-body">${f.body}</p>
        ${cue}
      </div>`;
    list.appendChild(li);
  }

  // таблица метрик
  renderMetrics(hasRef);

  // эталонный плеер
  $("refFigure").hidden = !hasRef;

  drawStills();
  $("resultPanel").scrollIntoView({ behavior: "smooth" });
}

function renderMetrics(hasRef) {
  const s = state.student.metrics;
  const r = hasRef ? state.ref.metrics : null;
  let html = `<table><thead><tr><th>Метрика</th><th>Ты</th>${
    r ? "<th>Эталон</th>" : ""
  }<th>Норма</th></tr></thead><tbody>`;
  for (const rule of RULES) {
    const v = s[rule.key];
    const rv = r ? r[rule.key] : null;
    const digits = rule.unit === "°" ? 0 : 2;
    const vs = v == null ? "—" : v.toFixed(digits) + rule.unit;
    const rvs = rv == null ? "—" : rv.toFixed(digits) + rule.unit;
    html += `<tr><td>${rule.label}</td><td>${vs}</td>${
      r ? `<td>${rvs}</td>` : ""
    }<td class="muted">${rule.good[0]}–${rule.good[1]}${rule.unit}</td></tr>`;
  }
  html += "</tbody></table>";
  $("metricsTable").innerHTML = html;
}

// нарисовать скелет на «стоп-кадре» (середина заезда)
function drawStills() {
  drawStillFor("videoStudent", "canvasStudent", state.student.frames);
  if (state.ref.frames) drawStillFor("videoRef", "canvasRef", state.ref.frames);
}

function drawStillFor(videoId, canvasId, frames) {
  const video = $(videoId);
  const canvas = $(canvasId);
  const midIdx = Math.floor(frames.length / 2);
  const frame = frames[midIdx] || frames.find((f) => f.landmarks);
  const draw = () => {
    video.removeEventListener("seeked", draw);
    drawFrame(canvas, video, frame ? frame.landmarks : null);
  };
  video.addEventListener("seeked", draw);
  video.currentTime = frame ? frame.t : 0;
}

// ---- синхронное воспроизведение со скелетом ----
$("playBtn").addEventListener("click", togglePlay);

let rafId = null;
function togglePlay() {
  const vs = $("videoStudent");
  const vr = state.ref.frames ? $("videoRef") : null;
  if (state.playing) {
    vs.pause();
    if (vr) vr.pause();
    cancelAnimationFrame(rafId);
    state.playing = false;
    $("playBtn").textContent = "▶︎ Проиграть синхронно";
    return;
  }
  state.playing = true;
  $("playBtn").textContent = "⏸ Пауза";
  vs.currentTime = 0;
  vs.play();
  if (vr) {
    vr.currentTime = 0;
    vr.play();
  }
  const loop = () => {
    if (!state.playing) return;
    overlayLive(vs, "canvasStudent", state.student.frames);
    if (vr) overlayLive(vr, "canvasRef", state.ref.frames);
    rafId = requestAnimationFrame(loop);
  };
  loop();
  vs.onended = () => togglePlay();
}

function overlayLive(video, canvasId, frames) {
  // подобрать ближайший по времени кадр
  const t = video.currentTime;
  let best = frames[0];
  let bestD = Infinity;
  for (const f of frames) {
    const d = Math.abs(f.t - t);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  drawFrame($(canvasId), video, best ? best.landmarks : null);
}

// ---- библиотека трюков ----
let trickFilter = "все";

function renderTricksLibrary() {
  // фильтр по уровню
  const levels = ["все", "база", "средний", "продвинутый"];
  const fbox = $("tricksFilter");
  fbox.innerHTML = "";
  for (const lv of levels) {
    const b = document.createElement("button");
    b.className = "chip" + (lv === trickFilter ? " active" : "");
    b.textContent = lv;
    b.addEventListener("click", () => { trickFilter = lv; renderTricksLibrary(); });
    fbox.appendChild(b);
  }

  const lib = $("tricksLib");
  lib.innerHTML = "";
  for (const grp of TRICK_GROUPS) {
    const tricks = grp.tricks.filter(
      (t) => trickFilter === "все" || t.level === trickFilter
    );
    if (!tricks.length) continue;

    const h = document.createElement("h3");
    h.className = "trick-group";
    h.textContent = grp.group;
    lib.appendChild(h);

    for (const t of tricks) {
      const d = document.createElement("details");
      d.className = "trick";
      const lvl = LEVEL_COLOR[t.level] || "warn";
      const def = t.def ? `<p class="trick-def">${t.def}</p>` : "";
      const steps = t.steps && t.steps.length
        ? `<div class="trick-block"><span class="trick-lbl acc">Как делать · WakeTime</span><ol class="trick-steps">${t.steps.map((s) => `<li>${s}</li>`).join("")}</ol></div>`
        : "";
      const cues = t.cues && t.cues.length
        ? `<div class="trick-block"><span class="trick-lbl warn">Кью</span><ul class="trick-cues">${t.cues.map((c) => `<li>${c}</li>`).join("")}</ul></div>`
        : "";
      const links = (t.src || [])
        .map((sc) => `<a class="src-chip ${(SCHOOLS[sc.s]||{}).color||'acc'}" href="https://www.youtube.com/watch?v=${sc.id}" target="_blank" rel="noopener">${sc.s} ▶</a>`)
        .join("");
      d.innerHTML = `
        <summary>
          <span class="trick-dot ${lvl}"></span>
          <span class="trick-name">${t.name}</span>
          <span class="trick-meta">${t.board} · ${t.level}</span>
        </summary>
        <div class="trick-body">
          ${def}${steps}${cues}
          <div class="trick-links">${links}</div>
        </div>`;
      lib.appendChild(d);
    }
  }
}

// ---- разбор трюка (прыжок/вращение) ----
$("trickBtn").addEventListener("click", () => {
  const box = $("trickResult");
  if (!state.student.frames) {
    box.innerHTML = `<p class="muted">Сначала разбери видео.</p>`;
    return;
  }
  const r = analyzeTrick(state.student.frames);
  if (!r.isTrick) {
    box.innerHTML = `<div class="trick-verdict none">На видео не видно прыжка/трюка (${r.reason || "мало отрыва"}). Разбор трюка нужен для прыжковых и вращательных элементов.</div>`;
    return;
  }
  const chips = r.checks
    .map(
      (c) =>
        `<li class="${c.ok ? "good" : "bad"}"><span>${c.ok ? "🟢" : "🔴"}</span><div><b>${c.label}</b><br><span class="muted">${c.detail}</span></div></li>`
    )
    .join("");
  const ph = r.phases;
  box.innerHTML = `
    <div class="trick-verdict">
      🎬 Обнаружен прыжок. Амплитуда <b>${r.amplitude.toFixed(2)}×торс</b>${
        r.rotationDeg >= 180 ? `, вращение ~<b>${r.rotationDeg}°</b>` : ""
      }.
    </div>
    <div class="trick-timeline">
      <span>присед ${ph.prep.toFixed(1)}s</span><i>→</i>
      <span>отталкивание ${ph.takeoff.toFixed(1)}s</span><i>→</i>
      <span>апекс ${ph.apex.toFixed(1)}s</span><i>→</i>
      <span>приземление ${ph.landing.toFixed(1)}s</span>
    </div>
    <ul class="trick-checks">${chips}</ul>
    <p class="muted trick-note">Пороги черновые — уточним на реальных трюковых клипах. По WakeTime: присед → отталкивание → поджать ноги → присед на приземлении.</p>`;
});

// ---- ТРЕНЕР: поиск по базе знаний ----
function trickBodyHTML(t) {
  const def = t.def ? `<p class="trick-def">${t.def}</p>` : "";
  const steps = t.steps && t.steps.length
    ? `<div class="trick-block"><span class="trick-lbl acc">Как делать · WakeTime</span><ol class="trick-steps">${t.steps.map((s) => `<li>${s}</li>`).join("")}</ol></div>` : "";
  const cues = t.cues && t.cues.length
    ? `<div class="trick-block"><span class="trick-lbl warn">Кью</span><ul class="trick-cues">${t.cues.map((c) => `<li>${c}</li>`).join("")}</ul></div>` : "";
  const links = (t.src || []).map((sc) => `<a class="src-chip ${(SCHOOLS[sc.s]||{}).color||'acc'}" href="https://www.youtube.com/watch?v=${sc.id}" target="_blank" rel="noopener">${sc.s} ▶</a>`).join("");
  return `${def}${steps}${cues}<div class="trick-links">${links}</div>`;
}

// собрать единый индекс: уроки + трюки
const COACH_INDEX = (() => {
  const idx = LESSONS.map((l) => ({ ...l, kind: "lesson" }));
  for (const g of TRICK_GROUPS) for (const t of g.tricks) {
    idx.push({
      id: "trick:" + t.name, title: t.name, cat: "Трюки", kind: "trick",
      keys: (t.name + " " + (t.def || "") + " трюк как сделать делать " + (t.board || "")).toLowerCase(),
      body: trickBodyHTML(t), meta: `${t.board} · ${t.level}`,
    });
  }
  return idx;
})();

const STOP = new Set(["как","что","на","в","и","с","по","за","до","的","the","a","to","how","do","и","мне","я","ты","это"]);
function tokens(s) {
  return (s.toLowerCase().match(/[a-zа-яё0-9]+/gi) || []).filter((w) => w.length > 2 && !STOP.has(w));
}
function coachSearch(query) {
  const qt = tokens(query);
  if (!qt.length) return [];
  const scored = COACH_INDEX.map((e) => {
    const title = e.title.toLowerCase(), keys = (e.keys || "").toLowerCase();
    let s = 0;
    for (const t of qt) {
      if (title.includes(t)) s += 4;
      if (keys.includes(t)) s += 3;
    }
    // бонус за прямое совпадение названия трюка
    if (e.kind === "trick" && query.toLowerCase().includes(e.title.toLowerCase().split(" ")[0])) s += 3;
    return { e, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.map((x) => x.e);
}

function renderCoachAnswer(query) {
  const box = $("coachAnswer");
  const res = coachSearch(query);
  box.hidden = false;
  if (!res.length) {
    box.innerHTML = `<p class="muted">Не нашёл точный ответ на «${query}». Полистай темы ниже или спроси про трюк/ошибку/старт другими словами.</p>`;
    return;
  }
  const top = res[0];
  const related = res.slice(1, 5);
  box.innerHTML = `
    <div class="coach-a-head"><span class="coach-cat">${top.cat}</span><h3>${top.title}</h3>${top.meta ? `<span class="trick-meta">${top.meta}</span>` : ""}</div>
    <div class="coach-a-body">${top.body}</div>
    ${related.length ? `<div class="coach-related"><span class="muted">Ещё по теме:</span> ${related.map((r) => `<button class="rel-chip" data-t="${r.title.replace(/"/g,'')}">${r.title}</button>`).join("")}</div>` : ""}`;
  box.querySelectorAll(".rel-chip").forEach((b) => b.addEventListener("click", () => { $("coachInput").value = b.dataset.t; ask(b.dataset.t); }));
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function ask(q) { if (q && q.trim()) renderCoachAnswer(q.trim()); }

function initCoach() {
  const chips = ["Как встать?", "Падаю назад", "Какую доску выбрать", "Волна слабая", "Как сделать 360", "Air", "Стойка regular/goofy", "Как бросить фал"];
  $("coachChips").innerHTML = chips.map((c) => `<button class="chip coach-chip">${c}</button>`).join("");
  $("coachChips").querySelectorAll(".coach-chip").forEach((b) => b.addEventListener("click", () => { $("coachInput").value = b.textContent; ask(b.textContent); }));
  $("coachBtn").addEventListener("click", () => ask($("coachInput").value));
  $("coachInput").addEventListener("keydown", (e) => { if (e.key === "Enter") ask($("coachInput").value); });
  // темы
  const byCat = {};
  for (const e of COACH_INDEX) (byCat[e.cat] = byCat[e.cat] || []).push(e);
  const order = [...CATS, "Трюки"];
  $("coachTopics").innerHTML = order.filter((c) => byCat[c]).map((c) =>
    `<div class="topic-group"><h4>${c}</h4>${byCat[c].slice(0, 12).map((e) => `<button class="topic-link" data-t="${e.title.replace(/"/g,'')}">${e.title}</button>`).join("")}</div>`
  ).join("");
  $("coachTopics").querySelectorAll(".topic-link").forEach((b) => b.addEventListener("click", () => { $("coachInput").value = b.dataset.t; ask(b.dataset.t); }));
}

function renderMistakes() {
  const ul = $("mistakesList");
  ul.innerHTML = "";
  for (const m of MISTAKES) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="fb-icon">🔴</span>
      <div>
        <p class="fb-title">${m.mistake}</p>
        <p class="fb-body">${m.why}</p>
        <p class="fb-cue">→ ${m.fix} <a href="https://www.youtube.com/watch?v=${m.src}" target="_blank" rel="noopener">урок ▶︎</a></p>
      </div>`;
    ul.appendChild(li);
  }
}

initCoach();
renderMistakes();
renderTricksLibrary();
