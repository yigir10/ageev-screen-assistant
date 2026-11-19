import type { Mark } from './marks';

export type Provider = 'gemini' | 'openrouter' | 'local';
export type Mode = 'ghost' | 'interactive' | 'snipping';
export type Phase = 'idle' | 'capturing' | 'thinking' | 'streaming';
export type HotkeyName = 'full' | 'snip' | 'toggle' | 'visibility' | 'marks' | 'cancel' | 'preset';
export type Hotkeys = Record<HotkeyName, string>;

export interface Preset {
	id: string;
	name: string;
	prompt: string;
}

export interface PinnedRegion {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ChatMessage {
	role: 'user' | 'assistant';
	text: string;
	image?: string;
}

export interface HistoryItem {
	id: string;
	ts: number;
	title: string;
	messages: { role: 'user' | 'assistant'; text: string }[];
}

export const PRESETS: Record<Provider, string[]> = {
	gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
	openrouter: [
		'google/gemini-2.5-flash',
		'google/gemini-2.0-flash-exp:free',
		'qwen/qwen2.5-vl-72b-instruct:free',
		'openai/gpt-4o-mini'
	],
	local: ['local-model']
};

export const DEFAULT_HOTKEYS: Hotkeys = {
	full: 'Alt+Q',
	snip: 'Alt+W',
	toggle: 'Alt+G',
	visibility: 'Alt+H',
	marks: 'Alt+M',
	cancel: 'Alt+X',
	preset: 'Alt+P'
};

export const HOTKEY_LABELS: Record<HotkeyName, string> = {
	full: 'РЎРєСЂРёРЅ (РѕР±Р»Р°СЃС‚СЊ / СЌРєСЂР°РЅ)',
	snip: 'Р’С‹РґРµР»РёС‚СЊ РѕР±Р»Р°СЃС‚СЊ',
	toggle: 'Ghost в‡„ Interactive',
	visibility: 'РЎРєСЂС‹С‚СЊ / РїРѕРєР°Р·Р°С‚СЊ HUD',
	marks: 'РћС‡РёСЃС‚РёС‚СЊ РјРµС‚РєРё',
	cancel: 'РЎС‚РѕРї РіРµРЅРµСЂР°С†РёРё',
	preset: 'РЎР»РµРґСѓСЋС‰РёР№ РїСЂРµСЃРµС‚'
};

export const DEFAULT_PRESETS: Preset[] = [
	{
		id: 'solve',
		name: 'Р РµС€РёС‚СЊ',
		prompt: 'Р РµС€Рё Р·Р°РґР°С‡Сѓ СЃРѕ СЃРєСЂРёРЅС€РѕС‚Р° РїРѕС€Р°РіРѕРІРѕ (РёСЃРїРѕР»СЊР·СѓР№ С„РѕСЂРјСѓР»С‹ LaTeX $...$) Рё С‡С‘С‚РєРѕ РІС‹РґРµР»Рё РёС‚РѕРіРѕРІС‹Р№ РѕС‚РІРµС‚.'
	},
	{
		id: 'brief',
		name: 'РљСЂР°С‚РєРѕ',
		prompt: 'РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ СЃРєСЂРёРЅС€РѕС‚ Рё РґР°Р№ РјР°РєСЃРёРјР°Р»СЊРЅРѕ РєСЂР°С‚РєРёР№, С‚РѕС‡РЅС‹Р№ РѕС‚РІРµС‚ РЅР° СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ Р±РµР· РІРѕРґС‹.'
	},
	{
		id: 'code',
		name: 'РљРѕРґ',
		prompt: 'Р Р°Р·Р±РµСЂРё РєРѕРґ РЅР° СЃРєСЂРёРЅС€РѕС‚Рµ, РЅР°Р№РґРё РѕС€РёР±РєРё РёР»Рё РЅР°РїРёС€Рё РёСЃРїСЂР°РІР»РµРЅРЅС‹Р№ РІР°СЂРёР°РЅС‚.'
	},
	{
		id: 'translate',
		name: 'РџРµСЂРµРІРѕРґ',
		prompt: 'РџРµСЂРµРІРµРґРё РІРµСЃСЊ С‚РµРєСЃС‚ СЃРѕ СЃРєСЂРёРЅС€РѕС‚Р° РЅР° РµСЃС‚РµСЃС‚РІРµРЅРЅС‹Р№ СЂСѓСЃСЃРєРёР№ СЏР·С‹Рє.'
	}
];

function loadJson<T>(key: string, fallback: T): T {
	if (typeof localStorage === 'undefined') return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
	} catch {
		return fallback;
	}
}

const initialSettings = loadJson('stealth_hud_settings', {
	provider: 'gemini' as Provider,
	apiKeys: { gemini: '', openrouter: '', local: '' } as Record<Provider, string>,
	models: {
		gemini: 'gemini-2.5-flash',
		openrouter: 'google/gemini-2.0-flash-exp:free',
		local: 'local-model'
	} as Record<Provider, string>,
	localBaseUrl: 'http://127.0.0.1:8080/v1',
	proxyEnabled: false,
	proxyUrl: '',
	hotkeys: { ...DEFAULT_HOTKEYS } as Hotkeys,
	stealth: true,
	marksEnabled: false,
	marksTtl: 15,
	marksGrid: true,
	presets: structuredClone(DEFAULT_PRESETS) as Preset[],
	activePreset: DEFAULT_PRESETS[0].id,
	systemPrompt: 'РўС‹ Р»Р°РєРѕРЅРёС‡РЅС‹Р№ Рё С‚РѕС‡РЅС‹Р№ РР-Р°СЃСЃРёСЃС‚РµРЅС‚. РћС‚РІРµС‡Р°Р№ РЅР° СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ С‡С‘С‚РєРѕ Рё РїРѕ РґРµР»Сѓ.',
	opacity: 92,
	fontSize: 13,
	panelWidth: 420,
	panelPos: null as { x: number; y: number } | null,
	pinnedRegion: null as PinnedRegion | null,
	onboarded: false
});

initialSettings.hotkeys = { ...DEFAULT_HOTKEYS, ...initialSettings.hotkeys };
if (!Array.isArray(initialSettings.presets) || !initialSettings.presets.length) {
	initialSettings.presets = structuredClone(DEFAULT_PRESETS);
}

export const settings = $state(initialSettings);

export const ui = $state({
	mode: 'ghost' as Mode,
	hidden: false,
	capturing: false,
	phase: 'idle' as Phase,
	statusDetail: '',
	settingsOpen: false,
	historyOpen: false,
	recording: false,
	dragging: false,
	snipBg: '',
	marks: [] as Mark[],
	toasts: [] as { id: string; text: string; kind: 'info' | 'error' | 'ok' }[],
	models: { gemini: [], openrouter: [], local: [] } as Record<Provider, string[]>,
	secretsOk: false
});

export const session = $state({
	id: '',
	frame: { x: 0, y: 0, w: 1280, h: 720 },
	messages: [] as ChatMessage[],
	streaming: false,
	error: '',
	fromHistory: false
});

const initialHistory = (() => {
	if (typeof localStorage === 'undefined') return [] as HistoryItem[];
	try {
		const raw = localStorage.getItem('stealth_hud_history');
		return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
	} catch {
		return [];
	}
})();

export const history = $state({
	items: initialHistory
});

export function motion(ms = 150): number {
	if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		return 0;
	}
	return ms;
}

if (typeof window !== 'undefined') {
	$effect.root(() => {
		$effect(() => {
			const snap = $state.snapshot(settings);
			const { apiKeys: _omit, ...safe } = snap;
			try {
				localStorage.setItem('stealth_hud_settings', JSON.stringify(safe));
			} catch {}
		});
		$effect(() => {
			const items = $state.snapshot(history.items);
			try {
				localStorage.setItem('stealth_hud_history', JSON.stringify(items));
			} catch {}
		});
	});
}

