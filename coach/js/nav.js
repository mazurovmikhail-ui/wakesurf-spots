// nav.js — общая навигация раздела WakeCoach и переключатель темы.
// Подключается одной строкой на каждой странице: <script src="js/nav.js"></script>

const ICON = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

const ICONS = {
  map: ICON(`<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z"/><path d="M9 4v13M15 6.5v13"/>`),
  coach: ICON(`<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12.3V17c3 2.6 9 2.6 12 0v-4.7"/>`),
  physics: ICON(`<circle cx="12" cy="12" r="2.2"/><ellipse cx="12" cy="12" rx="10" ry="4.4"/><ellipse cx="12" cy="12" rx="10" ry="4.4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.4" transform="rotate(120 12 12)"/>`),
  cube: ICON(`<path d="M12 2.6 3.5 7v10L12 21.4 20.5 17V7L12 2.6z"/><path d="M3.5 7 12 11.6 20.5 7M12 11.6v9.8"/>`),
  person: ICON(`<circle cx="12" cy="6" r="3.2"/><path d="M6 21v-2.5C6 15.5 8.7 13.5 12 13.5s6 2 6 5V21"/>`),
  anatomy: ICON(`<circle cx="12" cy="4.6" r="2.4"/><path d="M12 7v7.5M12 9.5 7 12M12 9.5l5 2.5M12 14.5 9 21M12 14.5 15 21"/>`),
  sun: ICON(`<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>`),
  moon: ICON(`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`)
};

const LINKS = [
  { href: "../", icon: "map", label: "Споты" },
  { href: "index.html", icon: "coach", label: "Тренер", match: ["", "index.html"] },
  { href: "rider3d.html", icon: "cube", label: "3D-райдер" },
  { href: "avatar.html", icon: "person", label: "Реалистичный" },
  { href: "anatomy.html", icon: "anatomy", label: "Анатомия" }
];

// ── тема ──
const THEME_KEY = "waketheme";
function currentTheme() {
  return document.documentElement.dataset.theme
    || localStorage.getItem(THEME_KEY)
    || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
function applyTheme(t, save) {
  document.documentElement.dataset.theme = t;
  if (save) { try { localStorage.setItem(THEME_KEY, t); } catch (e) {} }
  const btn = document.querySelector(".nav-theme");
  if (btn) btn.innerHTML = t === "light" ? ICONS.moon : ICONS.sun;
}
applyTheme(currentTheme(), false);

// ── разметка ──
function buildNav() {
  const here = location.pathname.split("/").pop();
  const nav = document.createElement("nav");
  nav.className = "coach-nav";
  nav.innerHTML = LINKS.map(l => {
    const active = l.match ? l.match.includes(here) : here === l.href;
    return `<a href="${l.href}"${active ? ' class="on"' : ""}>${ICONS[l.icon]}<span>${l.label}</span></a>`;
  }).join("") + `<span class="nav-spacer"></span><button class="nav-theme" title="Переключить тему"></button>`;

  const top = document.querySelector(".topbar");
  if (top && top.parentNode) top.parentNode.insertBefore(nav, top.nextSibling);
  else document.body.insertBefore(nav, document.body.firstChild);

  nav.querySelector(".nav-theme").addEventListener("click", () => {
    applyTheme(currentTheme() === "light" ? "dark" : "light", true);
  });
  applyTheme(currentTheme(), false);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildNav);
else buildNav();
