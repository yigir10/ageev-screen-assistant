import { a5 as ensure_array_like, a6 as attr, e as escape_html, a4 as derived, a7 as attr_class, a8 as clsx, a9 as stringify, aa as attr_style } from "../../chunks/index.js";
import "@tauri-apps/api/core";
import "@tauri-apps/api/event";
import "@tauri-apps/plugin-global-shortcut";
import "clsx";
import "@tauri-apps/plugin-autostart";
function html(value) {
  var html2 = String(value ?? "");
  var open = "<!---->";
  return open + html2 + "<!---->";
}
const PRETTY = {
  CommandOrControl: "Ctrl",
  Super: "Win",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\"
};
function prettyAccelerator(accel) {
  return accel.split("+").map((p) => PRETTY[p] ?? p);
}
function stripMarks(text) {
  return text.replace(/```marks[\s\S]*?```/g, "").replace(/```marks[\s\S]*$/, "").trim();
}
const PRESETS = {
  gemini: [
    "gemini-flash-latest",
    "gemini-pro-latest",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite"
  ],
  openrouter: [
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "openai/gpt-4o-mini",
    "anthropic/claude-sonnet-4.5",
    "qwen/qwen2.5-vl-72b-instruct",
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free"
  ],
  local: ["local-model"]
};
const HOTKEY_LABELS = {
  full: "Весь экран",
  snip: "Выделить область",
  toggle: "Ghost ⇄ Interactive",
  visibility: "Показать / скрыть",
  marks: "Очистить разметку",
  cancel: "Остановить ответ",
  preset: "Следующий пресет"
};
const DEFAULT_HOTKEYS = {
  full: "CommandOrControl+Alt+1",
  snip: "CommandOrControl+Alt+2",
  toggle: "CommandOrControl+Alt+3",
  visibility: "CommandOrControl+Alt+H",
  marks: "CommandOrControl+Alt+4",
  cancel: "CommandOrControl+Alt+5",
  preset: "CommandOrControl+Alt+6"
};
const DEFAULT_PRESETS = [
  {
    id: "explain",
    name: "Объясни",
    prompt: "Объясни, что показано на скриншоте, кратко и по делу."
  },
  {
    id: "solve",
    name: "Реши",
    prompt: "Если на скриншоте задача или вопрос, реши её и дай ответ с коротким пояснением."
  },
  {
    id: "bug",
    name: "Найди ошибку",
    prompt: "Найди ошибки на скриншоте (в коде, тексте, расчётах) и предложи исправление."
  },
  {
    id: "translate",
    name: "Переведи",
    prompt: "Переведи весь текст со скриншота на русский."
  },
  {
    id: "short",
    name: "Кратко",
    prompt: "Дай суть скриншота в 2–3 предложениях."
  }
];
const DEFAULTS = {
  provider: "gemini",
  apiKeys: { gemini: "", openrouter: "", local: "" },
  models: {
    gemini: PRESETS.gemini[0],
    openrouter: PRESETS.openrouter[0],
    local: PRESETS.local[0]
  },
  localBaseUrl: "http://127.0.0.1:8080/v1",
  proxyEnabled: false,
  proxyUrl: "",
  hotkeys: { ...DEFAULT_HOTKEYS },
  stealth: true,
  marksEnabled: true,
  marksTtl: 20,
  marksGrid: true,
  systemPrompt: "Ты помощник, который смотрит на скриншот. Отвечай кратко, по существу и на языке пользователя.",
  presets: structuredClone(DEFAULT_PRESETS),
  activePreset: "explain",
  onboarded: false,
  opacity: 100,
  fontSize: 14,
  panelWidth: 420,
  panelPos: null
};
const KEY = "stealth-hud:settings:v1";
function load() {
  const base = structuredClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      ...base,
      ...s,
      apiKeys: { ...base.apiKeys, ...s.apiKeys },
      models: { ...base.models, ...s.models },
      hotkeys: { ...base.hotkeys, ...s.hotkeys }
    };
  } catch {
    return base;
  }
}
const settings = load();
const session = {
  // id диалога для истории
  messages: [],
  streaming: false,
  // область экрана (CSS-пиксели окна), которую видела модель: к ней привязаны координаты меток
  frame: { x: 0, y: 0, w: 1, h: 1 }
};
const ui = {
  mode: "ghost",
  capturing: false,
  // идёт запись нового хоткея (глобальные бинды сняты)
  toasts: [],
  marks: []
};
const HKEY = "stealth-hud:history:v1";
function loadHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(HKEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
({ items: loadHistory() });
function MarksLayer($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const px = (v) => session.frame.x + v / 1e3 * session.frame.w;
    const py = (v) => session.frame.y + v / 1e3 * session.frame.h;
    $$renderer2.push(`<div class="pointer-events-none fixed bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-full border border-line bg-hud px-3 py-1 text-[11px] text-muted">≈ метки приблизительные: для точности выделите меньшую область</div> <svg class="pointer-events-none fixed inset-0 h-full w-full" aria-hidden="true"><defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#6ee7b7" stroke="#0b0d12" stroke-width="1"></path></marker></defs><!--[-->`);
    const each_array = ensure_array_like(ui.marks);
    for (let i = 0, $$length = each_array.length; i < $$length; i++) {
      let m = each_array[i];
      $$renderer2.push(`<g>`);
      if (m.type === "box" && m.x2 !== void 0 && m.y2 !== void 0) {
        $$renderer2.push("<!--[0-->");
        const x = Math.min(px(m.x), px(m.x2)) - 4;
        const y = Math.min(py(m.y), py(m.y2)) - 4;
        const w = Math.abs(px(m.x2) - px(m.x)) + 8;
        const h = Math.abs(py(m.y2) - py(m.y)) + 8;
        $$renderer2.push(`<rect${attr("x", x)}${attr("y", y)}${attr("width", w)}${attr("height", h)} rx="4" fill="rgba(110,231,183,0.12)" stroke="#0b0d12" stroke-width="5"></rect><rect${attr("x", x)}${attr("y", y)}${attr("width", w)}${attr("height", h)} rx="4" fill="none" stroke="#6ee7b7" stroke-width="2.5"></rect>`);
      } else if (m.type === "arrow" && m.x2 !== void 0 && m.y2 !== void 0) {
        $$renderer2.push(`<!--[1--><line${attr("x1", px(m.x))}${attr("y1", py(m.y))}${attr("x2", px(m.x2))}${attr("y2", py(m.y2))} stroke="#0b0d12" stroke-width="6" stroke-linecap="round"></line><line${attr("x1", px(m.x))}${attr("y1", py(m.y))}${attr("x2", px(m.x2))}${attr("y2", py(m.y2))} stroke="#6ee7b7" stroke-width="3" stroke-linecap="round" marker-end="url(#head)"></line>`);
      } else if (m.type === "point") {
        $$renderer2.push(`<!--[2--><circle${attr("cx", px(m.x))}${attr("cy", py(m.y))} r="11" fill="none" stroke="#0b0d12" stroke-width="5"></circle><circle${attr("cx", px(m.x))}${attr("cy", py(m.y))} r="11" fill="rgba(110,231,183,0.25)" stroke="#6ee7b7" stroke-width="2.5"></circle>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
      if (m.label) {
        $$renderer2.push("<!--[0-->");
        const lx = m.type === "arrow" && m.x2 !== void 0 ? px(m.x2) + 10 : px(m.x) + (m.type === "text" ? 0 : 14);
        const ly = m.type === "arrow" && m.y2 !== void 0 ? py(m.y2) - 10 : py(m.y) - (m.type === "text" ? 0 : 14);
        $$renderer2.push(`<foreignObject${attr("x", lx)}${attr("y", ly - 14)} width="260" height="30" style="overflow:visible"><div class="inline-block max-w-[260px] truncate rounded-md border border-accent bg-hud-solid px-2 py-0.5 text-xs text-fg">${escape_html(m.label)}</div></foreignObject>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></g>`);
    }
    $$renderer2.push(`<!--]--></svg>`);
  });
}
function Kbd($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { accel } = $$props;
    const parts = derived(() => prettyAccelerator(accel));
    $$renderer2.push(`<span class="inline-flex items-center gap-1"><!--[-->`);
    const each_array = ensure_array_like(parts());
    for (let i = 0, $$length = each_array.length; i < $$length; i++) {
      let p = each_array[i];
      $$renderer2.push(`<kbd class="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg">${escape_html(p)}</kbd>`);
    }
    $$renderer2.push(`<!--]--></span>`);
  });
}
function Header($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const btn = "h-[30px] cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-xs text-fg hover:border-accent";
    $$renderer2.push(`<div role="toolbar" tabindex="-1" aria-label="Панель управления" class="flex cursor-move items-center gap-1.5 border-b border-line px-3 py-2.5"><span class="h-2 w-2 rounded-full bg-accent"></span> <span class="flex-1 text-xs font-semibold">Interactive</span> <button${attr_class(clsx(btn))}>Экран</button> <button${attr_class(clsx(btn))}>Область</button> <button${attr_class(`h-[30px] cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-xs text-fg hover:border-accent ${settings.stealth ? "!border-accent !text-accent" : ""}`)}${attr("aria-pressed", settings.stealth)} title="Скрывать от записи экрана">Stealth</button> <button${attr_class(clsx(btn))} aria-label="Очистить диалог">⌫</button> <button${attr_class(clsx(btn))} aria-label="История" title="История диалогов">🕘</button> <button${attr_class(clsx(btn))} aria-label="Настройки">⚙</button> <button${attr_class(clsx(btn))} aria-label="Скрыть оверлей">✕</button></div>`);
  });
}
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(src) {
  let s = esc(src);
  s = s.replace(/`([^`\n]+)`/g, '<code class="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em] text-accent">$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold">$1</strong>');
  s = s.replace(/^#{1,6}\s+(.*)$/gm, '<strong class="font-semibold">$1</strong>');
  s = s.replace(/^\s*[-*]\s+/gm, "• ");
  return s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p class="my-1.5">${p.replace(/\n/g, "<br>")}</p>`).join("");
}
function parseMarkdown(src) {
  const segs = [];
  const re = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g;
  let last = 0;
  let m;
  while (m = re.exec(src)) {
    if (m.index > last) segs.push({ t: "html", html: inline(src.slice(last, m.index)) });
    segs.push({ t: "code", lang: m[1], code: m[2].replace(/\n$/, "") });
    last = re.lastIndex;
  }
  if (last < src.length) segs.push({ t: "html", html: inline(src.slice(last)) });
  return segs;
}
function Markdown($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { text, streaming = false } = $$props;
    const segs = derived(() => parseMarkdown(text));
    let copiedIdx = -1;
    $$renderer2.push(`<div class="leading-[1.55]"><!--[-->`);
    const each_array = ensure_array_like(segs());
    for (let i = 0, $$length = each_array.length; i < $$length; i++) {
      let s = each_array[i];
      if (s.t === "html") {
        $$renderer2.push(`<!--[0-->${html(s.html)}`);
      } else {
        $$renderer2.push(`<!--[-1--><div class="my-2 overflow-hidden rounded-ctl border border-line bg-hud-solid"><div class="flex items-center justify-between border-b border-line px-2.5 py-1 text-[11px] text-muted"><span>${escape_html(s.lang || "code")}</span> <button class="h-6 cursor-pointer rounded-md border-0 bg-transparent px-2 text-[11px] text-muted hover:text-fg">${escape_html(copiedIdx === i ? "Скопировано" : "Copy")}</button></div> <pre class="m-0 overflow-x-auto p-2.5 font-mono text-[0.9em] leading-[1.5] text-fg">${escape_html(s.code)}</pre></div>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--> `);
    if (streaming) {
      $$renderer2.push(`<!--[0--><span class="caret">▍</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function Messages($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { interactive } = $$props;
    const names = [
      "full",
      "snip",
      "toggle",
      "visibility",
      "marks",
      "cancel",
      "preset"
    ];
    const visible = derived(() => interactive ? session.messages : session.messages.filter((m) => m.role === "assistant").slice(-1));
    $$renderer2.push(`<div${attr_class(`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5 ${// автоскролл вниз при росте последнего сообщения
    interactive ? "select-text" : "select-none"}`)}>`);
    if (session.messages.length === 0) {
      $$renderer2.push(`<!--[0--><div class="flex flex-col gap-2 text-muted"><span class="text-fg">Готов к работе. Горячие клавиши:</span> <!--[-->`);
      const each_array = ensure_array_like(names);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let n = each_array[$$index];
        $$renderer2.push(`<div class="flex items-center justify-between gap-3"><span>${escape_html(HOTKEY_LABELS[n])}</span> `);
        Kbd($$renderer2, { accel: settings.hotkeys[n] });
        $$renderer2.push(`<!----></div>`);
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <!--[-->`);
    const each_array_1 = ensure_array_like(visible());
    for (let i = 0, $$length = each_array_1.length; i < $$length; i++) {
      let m = each_array_1[i];
      if (m.role === "user") {
        $$renderer2.push(`<!--[0--><div class="max-w-[85%] self-end rounded-[12px_12px_4px_12px] bg-accent2 px-3 py-2 text-hud-solid">`);
        if (m.image) {
          $$renderer2.push(`<!--[0--><img class="mb-1.5 max-h-24 rounded-md" alt="Скриншот"${attr("src", `data:image/jpeg;base64,${stringify(m.image)}`)}/>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> <div class="whitespace-pre-wrap">${escape_html(m.text)}</div></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
        m === session.messages.at(-1);
        $$renderer2.push(`<div${attr_class(`max-w-full self-start rounded-[12px_12px_12px_4px] ${interactive ? "bg-surface px-3 py-2" : ""}`)}>`);
        Markdown($$renderer2, {
          text: stripMarks(m.text),
          streaming: session.streaming
        });
        $$renderer2.push(`<!----></div>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function ChatInput($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let text = "";
    const shot = derived(() => session.messages.find((m) => m.image)?.image);
    $$renderer2.push(`<div class="relative flex flex-col gap-2 border-t border-line p-3"><div class="flex flex-wrap gap-1.5" role="group" aria-label="Пресеты запросов"><!--[-->`);
    const each_array = ensure_array_like(settings.presets);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let p = each_array[$$index];
      $$renderer2.push(`<button type="button"${attr("aria-pressed", settings.activePreset === p.id)}${attr("title", p.prompt)}${attr_class(`h-6 cursor-pointer rounded-full border px-2.5 text-[11px] ${settings.activePreset === p.id ? "border-accent bg-accent/15 text-accent" : "border-line bg-surface text-muted hover:text-fg"}`)}>${escape_html(p.name)}</button>`);
    }
    $$renderer2.push(`<!--]--></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div class="flex items-end gap-2"><button type="button" aria-label="Показать скриншот"${attr("disabled", !shot(), true)} class="h-9 w-14 flex-none cursor-pointer overflow-hidden rounded-ctl border border-line bg-surface p-0 disabled:cursor-default disabled:opacity-40">`);
    if (shot()) {
      $$renderer2.push(`<!--[0--><img alt="" class="h-full w-full object-cover"${attr("src", `data:image/jpeg;base64,${stringify(shot())}`)}/>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></button> <textarea aria-label="Уточнить вопрос" rows="1" placeholder="Уточнить вопрос по скриншоту…" class="max-h-28 min-h-9 flex-1 resize-none rounded-ctl border border-line bg-surface px-3 py-2 text-[13px] text-fg outline-none placeholder:text-muted focus:border-accent">`);
    const $$body = escape_html(text);
    if ($$body) {
      $$renderer2.push(`${$$body}`);
    }
    $$renderer2.push(`</textarea> `);
    if (session.messages.length) {
      $$renderer2.push(`<!--[0--><button type="button" aria-label="Повторить" title="Повторить запрос" class="h-9 cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-[13px] text-fg hover:border-accent">↻</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    {
      $$renderer2.push(`<!--[-1--><button type="button" aria-label="Отправить" class="h-9 cursor-pointer rounded-ctl border-0 bg-accent px-3.5 text-[13px] font-semibold text-hud-solid">↵</button>`);
    }
    $$renderer2.push(`<!--]--></div></div>`);
  });
}
function Panel($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let innerWidth = 1280;
    const interactive = derived(() => ui.mode === "interactive");
    const pos = derived(() => settings.panelPos ?? { x: Math.max(0, innerWidth - settings.panelWidth - 24), y: 24 });
    const dotColor = derived(() => interactive() ? "bg-accent" : "bg-muted");
    const statusText = derived(() => session.messages.length ? "готово" : "ожидание");
    $$renderer2.push(`<div${attr_class(`fixed flex flex-col overflow-hidden rounded-panel border bg-hud shadow-2xl ${interactive() ? "border-accent" : "border-line"}`)}${attr_style(`left:${stringify(pos().x)}px; top:${stringify(pos().y)}px; width:${stringify(settings.panelWidth)}px; font-size:${stringify(settings.fontSize)}px; opacity:${stringify(settings.opacity / 100)}; ${interactive() ? "height:min(72vh, 640px)" : "max-height:60vh"}`)}>`);
    if (interactive()) {
      $$renderer2.push(`<!--[0--><div>`);
      Header($$renderer2);
      $$renderer2.push(`<!----></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    Messages($$renderer2, { interactive: interactive() });
    $$renderer2.push(`<!----> <div class="flex items-center gap-1.5 px-3.5 py-2 text-[11px] text-muted"><span${attr_class(`h-1.5 w-1.5 rounded-full ${dotColor()}`)}></span> <span class="truncate">${escape_html(settings.provider)} · ${escape_html(settings.models[settings.provider])} · ${escape_html(statusText())}</span></div> `);
    if (interactive()) {
      $$renderer2.push(`<!--[0--><div>`);
      ChatInput($$renderer2);
      $$renderer2.push(`<!----></div> <div role="separator" aria-orientation="vertical" aria-label="Изменить ширину панели" class="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize hover:bg-accent/40"></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function Status($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function Toasts($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const color = {
      info: "border-line",
      ok: "border-accent",
      error: "border-danger"
    };
    $$renderer2.push(`<div class="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-[min(420px,90vw)] -translate-x-1/2 flex-col gap-2"><!--[-->`);
    const each_array = ensure_array_like(ui.toasts);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let t = each_array[$$index];
      $$renderer2.push(`<div role="status"${attr_class(`rounded-ctl border bg-hud px-3 py-2 text-[13px] text-fg shadow-lg ${stringify(color[t.kind])}`)}>${escape_html(t.text)}</div>`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    $$renderer2.push(`<div${attr_class("fixed inset-0 overflow-hidden", void 0, { "invisible": ui.capturing })}>`);
    Status($$renderer2);
    $$renderer2.push(`<!----> `);
    {
      $$renderer2.push("<!--[-1-->");
      if (ui.marks.length) {
        $$renderer2.push("<!--[0-->");
        MarksLayer($$renderer2);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      Panel($$renderer2);
      $$renderer2.push(`<!----> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></div> `);
    Toasts($$renderer2);
    $$renderer2.push(`<!---->`);
  });
}
export {
  _page as default
};
