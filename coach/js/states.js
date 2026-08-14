// states.js — экраны состояний раздела: нет сети, движок не загрузился,
// в видео не нашли человека, пусто. Вместо голой строки текста — понятный блок
// с иконкой, объяснением причины и кнопкой действия.

const ICON = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

export const STATE_ICONS = {
  offline: ICON(`<path d="M2 8.8a16 16 0 0 1 20 0M5.5 12.3a11 11 0 0 1 13 0M8.8 15.8a6 6 0 0 1 6.4 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/><path d="M3 3l18 18"/>`),
  noPerson: ICON(`<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20v-1.5c0-3 3-5 6.5-5s6.5 2 6.5 5V20"/><path d="M3 3l18 18"/>`),
  empty: ICON(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M9 5v14"/>`),
  wait: ICON(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>`)
};

/**
 * Показывает экран состояния в контейнере.
 * @param {HTMLElement} host куда вставить
 * @param {{kind:string, title:string, text:string, action?:{label:string, onClick:Function}}} opts
 */
export function showState(host, opts) {
  if (!host) return;
  const kind = opts.kind || "empty";
  const tone = kind === "offline" ? "bad" : kind === "noPerson" ? "warn" : "";
  host.innerHTML = `<div class="state ${tone}">
    ${STATE_ICONS[kind] || STATE_ICONS.empty}
    <b>${opts.title}</b>
    <span>${opts.text}</span>
    ${opts.action ? `<button class="state-act">${opts.action.label}</button>` : ""}
  </div>`;
  host.hidden = false;
  if (opts.action) {
    host.querySelector(".state-act").addEventListener("click", opts.action.onClick);
  }
}

export function clearState(host) {
  if (host) host.innerHTML = "";
}

// Готовые состояния — тексты в одном месте, чтобы формулировки не разъезжались
export const STATES = {
  offline: (retry) => ({
    kind: "offline",
    title: "Нет связи с ML-движком",
    text: "Распознавание позы загружается из интернета при первом запуске. Проверьте подключение и повторите — дальше разбор работает и без сети.",
    action: retry ? { label: "Повторить", onClick: retry } : null
  }),
  noPerson: (again) => ({
    kind: "noPerson",
    title: "Райдера в кадре почти не видно",
    text: "Нужен клип, где человек виден целиком и сбоку. Слишком далеко, против солнца или обрезаны ноги — поза не считывается.",
    action: again ? { label: "Выбрать другое видео", onClick: again } : null
  }),
  empty: (pick) => ({
    kind: "empty",
    title: "Пока нечего разбирать",
    text: "Загрузите видео с трюком — 5–20 секунд, съёмка сбоку, райдер в кадре целиком. Или начните с демо-клипа.",
    action: pick ? { label: "Выбрать видео", onClick: pick } : null
  })
};
