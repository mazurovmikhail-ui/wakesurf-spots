// analysis.js — превращает последовательность поз в метрики техники,
// затем в понятные подсказки. Всё — эвристика по 2D-скелету.
//
// Заложен задел под будущую ML-модель: evaluate() принимает опциональные
// метрики эталона и/или веса из обученной модели.

import { LM } from "./pose.js";

// ---------- геометрия ----------
function angle(a, b, c) {
  // угол в точке b между лучами b->a и b->c, в градусах
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 === 0 || m2 === 0) return null;
  let cos = dot / (m1 * m2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

// наклон вектора a->b от вертикали, в градусах (0 = вертикально вверх)
function leanFromVertical(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y; // y вниз в координатах кадра
  return (Math.atan2(dx, -dy) * 180) / Math.PI; // знак: + вправо
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) };
}

function vis(p, thr = 0.4) {
  return p && (p.visibility === undefined || p.visibility >= thr);
}

function median(arr) {
  const a = arr.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---------- метрики одного кадра ----------
function frameMetrics(lm) {
  if (!lm) return null;
  const g = (i) => lm[i];
  const lHip = g(LM.lHip), rHip = g(LM.rHip);
  const lSh = g(LM.lShoulder), rSh = g(LM.rShoulder);
  const lKnee = g(LM.lKnee), rKnee = g(LM.rKnee);
  const lAnk = g(LM.lAnkle), rAnk = g(LM.rAnkle);
  const lElb = g(LM.lElbow), rElb = g(LM.rElbow);
  const lWr = g(LM.lWrist), rWr = g(LM.rWrist);
  const nose = g(LM.nose);

  const hip = mid(lHip, rHip);
  const sh = mid(lSh, rSh);
  const torsoLen = Math.hypot(sh.x - hip.x, sh.y - hip.y) || 1e-6;

  const m = {};

  // Сгиб коленей: угол бедро-колено-лодыжка. 180 = прямая нога.
  const kL = vis(lHip) && vis(lKnee) && vis(lAnk) ? angle(lHip, lKnee, lAnk) : null;
  const kR = vis(rHip) && vis(rKnee) && vis(rAnk) ? angle(rHip, rKnee, rAnk) : null;
  m.knee = median([kL, kR]);

  // Наклон корпуса от вертикали (бёдра->плечи). + = наклон вперёд/назад по ходу.
  m.torsoLean = vis(hip) && vis(sh) ? Math.abs(leanFromVertical(hip, sh)) : null;

  // «Присед назад»: горизонтальный сдвиг плеч за таз относительно длины корпуса.
  // >0 — плечи отстают от таза (завал корпуса), характерно для новичков.
  m.hipShoulderOffset =
    vis(hip) && vis(sh) ? (hip.x - sh.x) / torsoLen : null;

  // Ширина стойки: расстояние между лодыжками / длину корпуса.
  m.stance =
    vis(lAnk) && vis(rAnk)
      ? Math.hypot(lAnk.x - rAnk.x, lAnk.y - rAnk.y) / torsoLen
      : null;

  // Распределение веса: положение таза по X между лодыжками (0..1),
  // 0.5 = по центру. <0.5 либо >0.5 — смещение к одной ноге.
  const ankMinX = Math.min(lAnk.x, rAnk.x);
  const ankMaxX = Math.max(lAnk.x, rAnk.x);
  m.weightBias =
    vis(lAnk) && vis(rAnk) && ankMaxX - ankMinX > 1e-4
      ? (hip.x - ankMinX) / (ankMaxX - ankMinX)
      : null;

  // Разгиб рук (средний угол в локте). 180 = прямые руки.
  const aL = vis(lSh) && vis(lElb) && vis(lWr) ? angle(lSh, lElb, lWr) : null;
  const aR = vis(rSh) && vis(rElb) && vis(rWr) ? angle(rSh, rElb, rWr) : null;
  m.armAngle = median([aL, aR]);

  // Голова: вертикальный уровень носа над плечами / длину корпуса.
  // Отрицательное и малое — голова опущена (смотрит вниз).
  m.headUp = vis(nose) && vis(sh) ? (sh.y - nose.y) / torsoLen : null;

  // Уверенность считаем по ТОРСУ (плечи+бёдра) — он надёжен даже когда райдер
  // далеко. Ноги (колени/лодыжки) на реальном видео часто теряются — метрики по
  // ним считаем отдельно и лишь когда ноги видны.
  m._confident =
    vis(lHip, 0.5) && vis(rHip, 0.5) && vis(lSh, 0.5) && vis(rSh, 0.5);
  m._legs = vis(lKnee, 0.4) && vis(rKnee, 0.4);
  return m;
}

// ---------- агрегирование по видео ----------
// Берём «стабильную» серединную часть заезда: отбрасываем первые/последние 15%
// и кадры с плохой видимостью.
export function aggregate(frames) {
  const per = frames.map((f) => frameMetrics(f.landmarks));
  const n = per.length;
  const lo = Math.floor(n * 0.15);
  const hi = Math.ceil(n * 0.85);
  const window = per.slice(lo, hi).filter((m) => m && m._confident);
  const used = window.length ? window : per.filter((m) => m && m._confident);

  const keys = ["knee", "torsoLean", "hipShoulderOffset", "stance", "weightBias", "armAngle", "headUp"];
  const out = { framesTotal: n, framesUsed: used.length, legsUsed: used.filter((m) => m._legs).length };
  for (const k of keys) out[k] = median(used.map((m) => m[k]));
  return out;
}

// ---------- правила хорошей техники (вейксёрф-специфичные) ----------
// Диапазоны — ориентир для любительского вейксёрфинга, вид сбоку.
// Формулировки опираются на методику школы WakeTime (см. knowledge/waketime-corpus.md):
// уроки «Как встать / выход из воды» и «Как отпустить фал».
// Ключевые установки WakeTime: РУКИ ПРЯМЫЕ, НОГИ СОГНУТЫ, спина прямая,
// вес на переднюю ногу, давить на носочки, законтовать передним кантом, нос не топить.
// Каждое сообщение: что видно → чем грозит на волне → как исправить (cue). Не заменяют тренера.
export const RULES = [
  {
    key: "knee",
    label: "Сгиб коленей",
    unit: "°",
    phase: "стойка",
    good: [130, 165],
    lowMsg: {
      title: "Глубокий присед — «садишься» на доску",
      body: "Колени пересогнуты (<b>{v}°</b>). В вейксёрфе нужна атлетичная пружинистая стойка, а не глубокий сед: он крадёт манёвренность и быстро забивает ноги.",
      cue: "Встань чуть выше, вес — серединой стопы, таз не проваливай.",
    },
    highMsg: {
      title: "Прямые ноги — нет амортизации",
      body: "Колени почти прямые (<b>{v}°</b>). На волне это ошибка №1: любая неровность выбивает из равновесия, гасить нечем.",
      cue: "WakeTime: «НОГИ СОГНУТЫ». Согни колени и «попружинь коленочками» — стойка собранная, пружинистая.",
    },
  },
  {
    key: "hipShoulderOffset",
    label: "Ось корпуса",
    unit: "",
    phase: "баланс",
    good: [-0.15, 0.18],
    highMsg: {
      title: "Корпус завален назад — вес висит на фале",
      body: "Плечи ушли за таз (<b>{v}</b>). Классика новичка: доска тормозит, нос всплывает, катер дёргает рывками, руки устают.",
      cue: "WakeTime: «спина прямая», «вырастаем плечами вверх, а не в сторону катера». Выведи грудь вперёд, встань НАД ногами. Проверка: смог бы на секунду отпустить фал и не упасть назад?",
    },
    lowMsg: {
      title: "Навалился вперёд",
      body: "Плечи впереди таза (<b>{v}</b>). Разгонит и уткнёт нос доски в воду.",
      cue: "Выпрями корпус, плечи ровно над тазом.",
    },
  },
  {
    key: "stance",
    label: "Ширина стойки",
    unit: "×торс",
    phase: "стойка",
    good: [0.7, 1.4],
    lowMsg: {
      title: "Узкая стойка — мало устойчивости",
      body: "Стопы близко (<b>{v}</b>). Теряешь баланс и контроль кантов доски.",
      cue: "Расставь шире плеч: передняя стопа ближе к носу, задняя к хвосту (staggered).",
    },
    highMsg: {
      title: "Слишком широкая стойка",
      body: "Стопы очень широко (<b>{v}</b>). Пропадает чувство доски и работа кантами.",
      cue: "Немного сузь — примерно на ширину плеч плюс.",
    },
  },
  {
    key: "weightBias",
    label: "Контроль скорости (вес)",
    unit: "",
    phase: "движение",
    good: [0.42, 0.68],
    lowMsg: {
      title: "Вес на задней ноге — доска тормозит",
      body: "Таз смещён к хвосту (<b>{v}</b>). Доска замедляется, проседает хвостом, тянет упасть назад и не даёт догнать волну.",
      cue: "WakeTime: «перенести вес на переднюю ногу, давить на носочки, законтовать передним кантом; нос не топить». Держи баланс ближе к центру и подкачивай, а не тормози.",
    },
    highMsg: {
      title: "Перегруз передней ноги",
      body: "Слишком много веса впереди (<b>{v}</b>). Разгон и нос зарывается в воду.",
      cue: "Верни вес к центру / чуть на заднюю, чтобы притормозить.",
    },
  },
  {
    key: "armAngle",
    label: "Работа с фалом",
    unit: "°",
    phase: "фал",
    good: [90, 165],
    lowMsg: {
      title: "Подтягиваешься к фалу руками",
      body: "Руки сильно согнуты (<b>{v}°</b>) — верный признак, что вес сзади и ты «висишь» на верёвке. Тянуть должна доска и волна, а не бицепс.",
      cue: "WakeTime: «РУКИ ПРЯМЫЕ». Держи руки прямыми и расслабленными. Поймал «карман» — фал провиснет сам, готовься его сбросить.",
    },
    highMsg: null,
  },
  {
    key: "headUp",
    label: "Взгляд",
    unit: "",
    phase: "баланс",
    good: [0.35, 10],
    lowMsg: {
      title: "Смотришь вниз на доску",
      body: "Голова опущена (<b>{v}</b>). За взглядом закрывается корпус и уходит баланс всего тела.",
      cue: "Подними глаза по ходу движения — смотри на волну впереди, а не под ноги.",
    },
    highMsg: null,
  },
];

function fmt(v, unit) {
  if (v == null) return "—";
  const digits = unit === "°" ? 0 : 2;
  return v.toFixed(digits) + (unit || "");
}

// Оценка: сравниваем метрики ученика с правилами и (если есть) с эталоном.
// weights — задел под ML: карта key->важность, по умолчанию 1.
export function evaluate(student, reference = null, weights = {}) {
  const findings = [];
  let penalty = 0;
  let maxPenalty = 0;

  for (const rule of RULES) {
    const w = weights[rule.key] ?? 1;
    maxPenalty += 20 * w;
    const v = student[rule.key];
    if (v == null) continue;

    const [gLo, gHi] = rule.good;
    // Если есть эталон — подстраиваем целевой ориентир под него (в пределах разумного).
    let target = null;
    if (reference && reference[rule.key] != null) target = reference[rule.key];

    let severity = "good";
    let msg = null;
    let dev = 0;

    if (v < gLo && rule.lowMsg) {
      dev = gLo - v;
      msg = rule.lowMsg;
    } else if (v > gHi && rule.highMsg) {
      dev = v - gHi;
      msg = rule.highMsg;
    }

    if (msg) {
      const span = Math.max(gHi - gLo, 1e-6);
      const rel = dev / span;
      severity = rel > 0.6 ? "bad" : "warn";
      penalty += (severity === "bad" ? 20 : 11) * w;
      findings.push({
        key: rule.key,
        label: rule.label,
        severity,
        phase: rule.phase,
        title: msg.title,
        body: msg.body.replace("{v}", fmt(v, "")),
        cue: msg.cue || null,
        value: v,
        unit: rule.unit,
        target,
      });
    } else {
      findings.push({
        key: rule.key,
        label: rule.label,
        severity: "good",
        title: rule.label + " — в норме",
        body: "Держишь хороший диапазон.",
        value: v,
        unit: rule.unit,
        target,
      });
    }
  }

  // Дополнительно: заметное расхождение с эталоном там, где правило «в норме».
  if (reference) {
    for (const rule of RULES) {
      const v = student[rule.key], r = reference[rule.key];
      if (v == null || r == null) continue;
      const f = findings.find((x) => x.key === rule.key);
      if (f && f.severity === "good") {
        const scale = rule.unit === "°" ? 25 : rule.key === "knee" ? 25 : 0.35;
        if (Math.abs(v - r) > scale) {
          f.severity = "warn";
          f.title = rule.label + ": отличается от эталона";
          f.body = `У тебя <b>${fmt(v, rule.unit)}</b>, у эталона <b>${fmt(r, rule.unit)}</b>. Приблизь к образцу.`;
          penalty += 8;
        }
      }
    }
  }

  const score = Math.max(5, Math.round(100 - (penalty / maxPenalty) * 100));

  // Сортировка: сначала грубые ошибки, потом мелкие, потом «ок».
  const order = { bad: 0, warn: 1, good: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return { score, findings };
}

export function summarize(score, findings) {
  const bad = findings.filter((f) => f.severity === "bad").length;
  const warn = findings.filter((f) => f.severity === "warn").length;
  const first = bad ? "🔴 красных" : "🟡 жёлтых";
  if (score >= 85) return "Отличная база! Мелкие детали ниже — и будет совсем чисто.";
  if (score >= 65)
    return `Хорошо едешь. Главное — ${bad ? "убрать грубые ошибки" : "подчистить детали"} ниже.`;
  if (score >= 45)
    return `Есть над чем поработать: ${bad} серьёзных и ${warn} мелких замечаний. Начни с ${first} пунктов.`;
  return `Базовую стойку стоит перестроить: ${bad} серьёзных замечаний. Разбирай ${first} пункты по одному.`;
}
