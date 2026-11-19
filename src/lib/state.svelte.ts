// Общий rune-store: settings (localStorage), session (диалог), ui (режим окна, тосты)
import type { Mark } from './marks';

export type Provider = 'gemini' | 'openrouter' | 'local';
export type Mode = 'ghost' | 'interactive' | 'snipping';
export type HotkeyName = 'full' | 'snip' | 'toggle' | 'visibility' | 'marks' | 'cancel' | 'preset';
export type Phase = 'idle' | 'capturing' | 'thinking' | 'streaming';

export interface Preset {
	id: string;
	name: string;
	prompt: string;
}
export type Hotkeys = Record<HotkeyName, string>;

export interface Settings {
	provider: Provider;
	apiKeys: Record<Provider, string>;
	models: Record<Provider, string>;
	localBaseUrl: string;
	proxyEnabled: boolean;
	proxyUrl: string;
	hotkeys: Hotkeys;
	stealth: boolean;
	marksEnabled: boolean; // модель может рисовать метки на экране
	marksTtl: number; // секунд до автоисчезновения, 0 — пока не очистят
	marksGrid: boolean; // накладывать координатную сетку на скриншот (точнее метки)
	systemPrompt: string;
	presets: Preset[]; // редактируемые быстрые запросы к скриншоту
	activePreset: string;
	onboarded: boolean;
	opacity: number; // 40..100
	fontSize: number; // 12..18
	panelWidth: number; // px
	panelPos: { x: number; y: number } | null;
}

export interface Msg {
	role: 'user' | 'assistant';
	text: string;
	image?: string; // base64 JPEG
}

export interface Toast {
	id: string;
	text: string;
	kind: 'info' | 'error' | 'ok';
}

export const PRESETS: Record<Provider, string[]> = {
	gemini: ['gemini-flash-latest', 'gemini-pro-latest', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
	openrouter: [
		'google/gemini-2.5-flash',
		'google/gemini-2.5-pro',
		'openai/gpt-4o-mini',
		'anthropic/claude-sonnet-4.5',
		'qwen/qwen2.5-vl-72b-instruct',
		'google/gemini-2.0-flash-exp:free',
		'meta-llama/llama-3.2-11b-vision-instruct:free'
	],
	local: ['local-model']
};

export const HOTKEY_LABELS: Record<HotkeyName, string> = {
	full: 'Весь экран',
	snip: 'Выделить область',
	toggle: 'Ghost ⇄ Interactive',
	visibility: 'Показать / скрыть',
	marks: 'Очистить разметку',
	cancel: 'Остановить ответ',
	preset: 'Следующий пресет'
};

export const DEFAULT_HOTKEYS: Hotkeys = {
	full: 'CommandOrControl+Alt+1',
	snip: 'CommandOrControl+Alt+2',
	toggle: 'CommandOrControl+Alt+3',
	visibility: 'CommandOrControl+Alt+H',
	marks: 'CommandOrControl+Alt+4',
	cancel: 'CommandOrControl+Alt+5',
	preset: 'CommandOrControl+Alt+6'
};

export const DEFAULT_PRESETS: Preset[] = [
	{ id: 'explain', name: 'Объясни', prompt: 'Объясни, что показано на скриншоте, кратко и по делу.' },
	{ id: 'solve', name: 'Реши', prompt: 'Если на скриншоте задача или вопрос, реши её и дай ответ с коротким пояснением.' },
	{ id: 'bug', name: 'Найди ошибку', prompt: 'Найди ошибки на скриншоте (в коде, тексте, расчётах) и предложи исправление.' },
	{ id: 'translate', name: 'Переведи', prompt: 'Переведи весь текст со скриншота на русский.' },
	{ id: 'short', name: 'Кратко', prompt: 'Дай суть скриншота в 2–3 предложениях.' }
];

const DEFAULTS: Settings = {
	provider: 'gemini',
	apiKeys: { gemini: '', openrouter: '', local: '' },
	models: { gemini: PRESETS.gemini[0], openrouter: PRESETS.openrouter[0], local: PRESETS.local[0] },
	localBaseUrl: 'http://127.0.0.1:8080/v1',
	proxyEnabled: false,
	proxyUrl: '',
	hotkeys: { ...DEFAULT_HOTKEYS },
	stealth: true,
	marksEnabled: true,
	marksTtl: 20,
	marksGrid: true,
	systemPrompt: 'Ты помощник, который смотрит на скриншот. Отвечай кратко, по существу и на языке пользователя.',
	presets: structuredClone(DEFAULT_PRESETS),
	activePreset: 'explain',
	onboarded: false,
	opacity: 100,
	fontSize: 14,
	panelWidth: 420,
	panelPos: null
};

const KEY = 'stealth-hud:settings:v1';

function load(): Settings {
	const base = structuredClone(DEFAULTS);
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return base;
		const s = JSON.parse(raw) as Partial<Settings>;
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

export const settings: Settings = $state(load());

export const session = $state({
	id: '', // id диалога для истории
	messages: [] as Msg[],
	streaming: false,
	error: '',
	// область экрана (CSS-пиксели окна), которую видела модель: к ней привязаны координаты меток
	frame: { x: 0, y: 0, w: 1, h: 1 }
});

export const ui = $state({
	mode: 'ghost' as Mode,
	hidden: false,
	capturing: false, // true — UI временно скрыт на время захвата экрана
	settingsOpen: false,
	historyOpen: false,
	phase: 'idle' as Phase, // стадия запроса для индикатора
	recording: false, // идёт запись нового хоткея (глобальные бинды сняты)
	toasts: [] as Toast[],
	marks: [] as Mark[],
	snipBg: '', // «замороженный» кадр для режима выделения (base64 JPEG)
	secretsOk: false, // ключи успешно загружены из Credential Manager
	models: { gemini: [], openrouter: [], local: [] } as Record<Provider, string[]>
});

/** Длительность анимации с учётом prefers-reduced-motion. */
export function motion(ms = 150): number {
	return matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}

$effect.root(() => {
	$effect(() => {
		try {
			const { apiKeys, ...rest } = $state.snapshot(settings);
			// Ключи живут в Windows Credential Manager; в localStorage — только пока хранилище недоступно
			localStorage.setItem(KEY, JSON.stringify(ui.secretsOk ? rest : { ...rest, apiKeys }));
		} catch {
			/* localStorage недоступен — не критично */
		}
	});
});

// ───────────── история диалогов (только текст, без скриншотов) ─────────────

export interface HistoryItem {
	id: string;
	ts: number;
	title: string;
	messages: Msg[];
}

const HKEY = 'stealth-hud:history:v1';

function loadHistory(): HistoryItem[] {
	try {
		const v = JSON.parse(localStorage.getItem(HKEY) ?? '[]');
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}

export const history = $state({ items: loadHistory() });

$effect.root(() => {
	$effect(() => {
		try {
			localStorage.setItem(HKEY, JSON.stringify($state.snapshot(history.items)));
		} catch {
			/* не критично */
		}
	});
});
