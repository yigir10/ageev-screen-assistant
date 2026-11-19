import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tick } from 'svelte';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { extractMarks, GRID_PROMPT, MARKS_PROMPT } from './marks';
import { friendlyError } from './errors';
import {
	DEFAULT_PRESETS,
	HOTKEY_LABELS,
	history,
	session,
	settings,
	ui,
	type HotkeyName,
	type Mode
} from './state.svelte';

let reqId = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toast(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
	const id = crypto.randomUUID();
	ui.toasts.push({ id, text, kind });
	setTimeout(() => {
		ui.toasts = ui.toasts.filter((t) => t.id !== id);
	}, 4500);
}

// ───────────── режимы окна и шторки ─────────────

export async function setMode(mode: Mode) {
	ui.mode = mode;
	if (mode !== 'ghost') ui.hidden = false;
	if (mode !== 'interactive') {
		ui.settingsOpen = false;
		ui.historyOpen = false;
		ui.chessOpen = false;
		ui.dragging = false;
	}
	try {
		await invoke('set_window_mode', { mode });
	} catch (e) {
		toast(String(e), 'error');
	}
}

export const toggleMode = () => setMode(ui.mode === 'ghost' ? 'interactive' : 'ghost');

export function toggleVisibility() {
	ui.hidden = !ui.hidden;
	if (ui.hidden && ui.mode !== 'ghost') void setMode('ghost');
}

export function openSettings(open?: boolean) {
	const next = open ?? !ui.settingsOpen;
	ui.settingsOpen = next;
	if (next) {
		ui.historyOpen = false;
		ui.chessOpen = false;
	}
}

export function openHistory(open?: boolean) {
	const next = open ?? !ui.historyOpen;
	ui.historyOpen = next;
	if (next) {
		ui.settingsOpen = false;
		ui.chessOpen = false;
	}
}

export function openChess(open?: boolean) {
	const next = open ?? !ui.chessOpen;
	ui.chessOpen = next;
	if (next) {
		ui.settingsOpen = false;
		ui.historyOpen = false;
	}
}

export async function applyStealth() {
	try {
		await invoke('set_stealth', { enabled: settings.stealth });
	} catch (e) {
		toast(`Stealth: ${e}`, 'error');
	}
}

// ───────────── захват экрана, закреплённая область и калибровка доски ─────────────

async function hideUiForCapture() {
	if (settings.stealth) return;
	ui.capturing = true;
	await tick();
	await new Promise((r) => requestAnimationFrame(() => r(null)));
	await sleep(90);
}

async function capture(
	cmd: 'capture_full' | 'capture_region',
	frame: { x: number; y: number; w: number; h: number },
	args?: Record<string, unknown>,
	skipHide = false
) {
	await cancel();
	ui.hidden = false;
	if (!skipHide) await hideUiForCapture();
	ui.phase = 'capturing';
	ui.statusDetail = '';
	try {
		const image = await invoke<string>(cmd, args);
		session.frame = frame;
		beginChat(image);
	} catch (e) {
		ui.phase = 'idle';
		toast(String(e), 'error');
	} finally {
		ui.capturing = false;
	}
}

const useGrid = () => settings.marksEnabled && settings.marksGrid;

function clampRect(r: Rect): Rect | null {
	const maxW = window.innerWidth;
	const maxH = window.innerHeight;
	const x = Math.max(0, Math.min(r.x, maxW - 10));
	const y = Math.max(0, Math.min(r.y, maxH - 10));
	const w = Math.min(r.w, maxW - x);
	const h = Math.min(r.h, maxH - y);
	return w >= 10 && h >= 10 ? { x, y, w, h } : null;
}

export async function captureFull() {
	const pinned = settings.pinnedRegion ? clampRect(settings.pinnedRegion) : null;
	if (pinned) {
		const dpr = window.devicePixelRatio || 1;
		await capture('capture_region', pinned, {
			region: {
				x: Math.round(pinned.x * dpr),
				y: Math.round(pinned.y * dpr),
				w: Math.round(pinned.w * dpr),
				h: Math.round(pinned.h * dpr)
			},
			grid: useGrid(),
			useCached: false
		});
		return;
	}
	await capture('capture_full', { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, { grid: useGrid() });
}

export function clearPinnedRegion() {
	settings.pinnedRegion = null;
	toast('Сброшено: быстрый скрин снимает весь экран', 'info');
}

async function beginSnipOverlay(purpose: 'region' | 'board') {
	await cancel();
	ui.hidden = false;
	ui.snipPurpose = purpose;
	if (purpose === 'board') ui.chessArrows = null;
	await hideUiForCapture();
	try {
		ui.snipBg = await invoke<string>('snapshot_begin');
	} catch (e) {
		ui.snipBg = '';
		toast(String(e), 'error');
	} finally {
		ui.capturing = false;
	}
	await setMode('snipping');
}

export const startSnip = () => beginSnipOverlay('region');
export const startBoardCalibration = () => beginSnipOverlay('board');

export async function cancelSnip() {
	ui.snipBg = '';
	await invoke('snapshot_drop').catch(() => {});
	await setMode('ghost');
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export async function captureRegion(rect: Rect) {
	if (ui.snipPurpose === 'board') {
		ui.snipBg = '';
		await invoke('snapshot_drop').catch(() => {});
		settings.chessBoard = { ...rect };
		await setMode('interactive');
		openChess(true);
		toast(`Доска откалибрована (${Math.round(rect.w)}×${Math.round(rect.h)}px)`, 'ok');
		return;
	}

	const dpr = window.devicePixelRatio || 1;
	const cached = !!ui.snipBg;
	ui.snipBg = '';
	settings.pinnedRegion = { ...rect };
	await setMode('ghost');
	await capture(
		'capture_region',
		rect,
		{
			region: {
				x: Math.round(rect.x * dpr),
				y: Math.round(rect.y * dpr),
				w: Math.round(rect.w * dpr),
				h: Math.round(rect.h * dpr)
			},
			grid: useGrid(),
			useCached: cached
		},
		cached
	);
}

// ───────────── шахматный модуль (Stockfish 19 + VLM) ─────────────

let chessBusy = false;
let lastChessDoneAt = 0;

export function clearChessArrows() {
	ui.chessArrows = null;
}

export async function stopChessWatcher() {
	await invoke('stop_chess_watcher').catch(() => {});
}

export async function syncChessWatcher() {
	const board = settings.chessBoard ? clampRect(settings.chessBoard) : null;
	if (!settings.chessAuto || !board || ui.mode === 'snipping') {
		await stopChessWatcher();
		return;
	}
	const dpr = window.devicePixelRatio || 1;
	await invoke('start_chess_watcher', {
		region: {
			x: Math.round(board.x * dpr),
			y: Math.round(board.y * dpr),
			w: Math.round(board.w * dpr),
			h: Math.round(board.h * dpr)
		},
		intervalMs: 450
	}).catch((e) => toast(String(e), 'error'));
}

export async function analyzeChess(withExplanation = false, isAuto = false) {
	if (chessBusy) return;
	if (isAuto && Date.now() - lastChessDoneAt < 1500) return;
	const board = settings.chessBoard ? clampRect(settings.chessBoard) : null;
	if (!board) {
		toast(`Сначала откалибруйте доску (${settings.hotkeys.chessBoard || 'кнопка в ♟'})`, 'error');
		return;
	}

	chessBusy = true;
	if (!isAuto) await cancel();
	ui.hidden = false;
	if (!settings.stealth) ui.chessArrows = null;
	await tick();
	await hideUiForCapture();
	await sleep(30);

	ui.phase = 'capturing';
	ui.statusDetail = 'Снимаю доску…';
	try {
		const dpr = window.devicePixelRatio || 1;
		const b64 = await invoke<string>('capture_region', {
			region: {
				x: Math.round(board.x * dpr),
				y: Math.round(board.y * dpr),
				w: Math.round(board.w * dpr),
				h: Math.round(board.h * dpr)
			},
			grid: false,
			useCached: false
		});
		ui.capturing = false;

		ui.phase = 'thinking';
		ui.statusDetail = 'Распознаю позицию (FEN)…';
		const p = settings.provider;
		const fenPrompt = `You are a chess board OCR. Inspect this cropped 8x8 chess board (${settings.chessBottom === 'white' ? 'White pieces are at the bottom, rank 1 at bottom, file a on left' : 'Black pieces are at the bottom, rank 8 at bottom, file h on left'}). Output ONLY the exact FEN string for this position with '${settings.chessTurn}' to move (format: <8 ranks separated by /> ${settings.chessTurn} KQkq - 0 1). No markdown, no backticks, no extra words.`;

		const rawFen = await invoke<string>('quick_vision', {
			cfg: {
				provider: p,
				apiKey: settings.apiKeys[p],
				model: settings.models[p],
				baseUrl: settings.localBaseUrl,
				proxy: proxyOn() ? settings.proxyUrl.trim() : null,
				systemPrompt: ''
			},
			prompt: fenPrompt,
			image: b64
		});

		ui.statusDetail = 'Stockfish 19 считает…';
		const res = await invoke<{
			bestMove: string;
			secondMove: string | null;
			evalText: string;
			normalizedFen: string;
		}>('analyze_chess_uci', {
			stockfishPath: settings.stockfishPath,
			fen: rawFen,
			turn: settings.chessTurn,
			movetimeMs: Number(settings.stockfishMovetime) || 250
		});

		ui.chessArrows = {
			best: res.bestMove,
			second: res.secondMove,
			evalText: res.evalText,
			fen: res.normalizedFen
		};
		ui.phase = 'idle';
		ui.statusDetail = '';
		if (!isAuto) toast(`SF19: ${res.bestMove} (${res.evalText})`, 'ok');

		if (withExplanation) {
			session.frame = board;
			const explainPrompt = `Позиция FEN: ${res.normalizedFen}. Движок Stockfish 19 рекомендует ход ${res.bestMove} (оценка ${res.evalText}${res.secondMove ? `, альтернатива ${res.secondMove}` : ''}). Кратко на русском языке объясни главную тактическую или стратегическую идею этого хода.`;
			beginChat(b64, explainPrompt);
		}
	} catch (e) {
		ui.capturing = false;
		ui.phase = 'idle';
		ui.statusDetail = '';
		toast(friendlyError(String(e), settings.provider, proxyOn()), 'error');
	} finally {
		chessBusy = false;
		lastChessDoneAt = Date.now();
	}
}

// ───────────── чат и пресеты ─────────────

const proxyOn = () => settings.proxyEnabled && settings.proxyUrl.trim() !== '';

export function activePrompt(): string {
	const p = settings.presets.find((x) => x.id === settings.activePreset) ?? settings.presets[0];
	return p?.prompt.trim() || 'Проанализируй скриншот и ответь на то, что на нём спрашивается или требуется сделать.';
}

export function selectPreset(id: string) {
	settings.activePreset = id;
}

export function runPresetNow(id: string) {
	settings.activePreset = id;
	if (session.messages.length && !session.streaming) ask(activePrompt());
}

export function cyclePreset() {
	if (!settings.presets.length) return;
	const i = settings.presets.findIndex((p) => p.id === settings.activePreset);
	const next = settings.presets[(i + 1) % settings.presets.length];
	settings.activePreset = next.id;
	toast(`Пресет: ${next.name}`, 'info');
}

export function addPreset() {
	settings.presets.push({ id: crypto.randomUUID(), name: 'Новый пресет', prompt: '' });
}

export function removePreset(id: string) {
	if (settings.presets.length <= 1) return;
	settings.presets = settings.presets.filter((p) => p.id !== id);
	if (settings.activePreset === id) settings.activePreset = settings.presets[0].id;
}

export function resetPresets() {
	settings.presets = structuredClone(DEFAULT_PRESETS);
	settings.activePreset = DEFAULT_PRESETS[0].id;
}

function beginChat(image: string, customText?: string) {
	session.id = crypto.randomUUID();
	session.fromHistory = false;
	session.messages = [
		{ role: 'user', text: customText?.trim() || activePrompt(), image },
		{ role: 'assistant', text: '' }
	];
	void send();
}

export function ask(text: string, pastedImage?: string | null) {
	const t = text.trim();
	if (session.streaming) return;
	if (!t && !pastedImage) return;

	if (session.messages.length === 0) {
		session.id = crypto.randomUUID();
		session.fromHistory = false;
		session.frame = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
		session.messages = [
			{ role: 'user', text: t || activePrompt(), image: pastedImage ?? undefined },
			{ role: 'assistant', text: '' }
		];
	} else {
		if (pastedImage) session.fromHistory = false;
		session.messages.push(
			{ role: 'user', text: t || activePrompt(), image: pastedImage ?? undefined },
			{ role: 'assistant', text: '' }
		);
	}
	void send();
}

async function send() {
	const id = ++reqId;
	const p = settings.provider;
	session.streaming = true;
	session.error = '';
	ui.phase = 'thinking';
	ui.statusDetail = '';
	clearMarks();

	const all = session.messages.slice(0, -1);
	const trimmed = all.length > 13 ? [all[0], ...all.slice(-12)] : all;
	const payload = trimmed.map((m) => ({ role: m.role, text: m.text, image: m.image ?? null }));
	const cfg = {
		provider: p,
		apiKey: settings.apiKeys[p],
		model: settings.models[p],
		baseUrl: settings.localBaseUrl,
		proxy: proxyOn() ? settings.proxyUrl.trim() : null,
		systemPrompt:
			settings.systemPrompt +
			(settings.marksEnabled ? MARKS_PROMPT + (settings.marksGrid ? GRID_PROMPT : '') : '')
	};
	try {
		await invoke('stream_chat', { cfg, messages: payload, requestId: id });
	} catch (e) {
		fail(String(e));
	}
}

function fail(message: string) {
	session.streaming = false;
	ui.phase = 'idle';
	ui.statusDetail = '';
	message = friendlyError(message, settings.provider, proxyOn());
	session.error = message;
	const last = session.messages.at(-1);
	if (last?.role === 'assistant' && !last.text) session.messages.pop();
	toast(message, 'error');
}

export function retry() {
	if (session.streaming) return;
	if (session.messages.at(-1)?.role === 'assistant') session.messages.pop();
	if (session.messages.at(-1)?.role !== 'user') return;
	session.messages.push({ role: 'assistant', text: '' });
	void send();
}

export async function cancel() {
	await invoke('cancel_chat').catch(() => {});
	session.streaming = false;
	ui.phase = 'idle';
	ui.statusDetail = '';
}

// ───────────── разметка на экране ─────────────

let marksTimer: ReturnType<typeof setTimeout> | undefined;

export function clearMarks() {
	clearTimeout(marksTimer);
	ui.marks = [];
	ui.chessArrows = null;
}

function showMarksFrom(text: string) {
	if (!settings.marksEnabled) return;
	const marks = extractMarks(text);
	if (!marks.length) return;
	ui.marks = marks;
	clearTimeout(marksTimer);
	if (settings.marksTtl > 0) marksTimer = setTimeout(() => (ui.marks = []), settings.marksTtl * 1000);
}

export function clearChat() {
	void cancel();
	clearMarks();
	session.messages = [];
	session.id = '';
	session.error = '';
	session.fromHistory = false;
}

// ───────────── ключи в Windows Credential Manager ─────────────

const PROVIDERS = ['gemini', 'openrouter', 'local'] as const;
const lastSavedKeys: Record<(typeof PROVIDERS)[number], string> = { gemini: '', openrouter: '', local: '' };
const saveTimers: Partial<Record<(typeof PROVIDERS)[number], ReturnType<typeof setTimeout>>> = {};

export async function loadSecrets() {
	try {
		for (const p of PROVIDERS) {
			const v = await invoke<string | null>('secret_get', { name: `apikey-${p}` });
			if (v) {
				settings.apiKeys[p] = v;
				lastSavedKeys[p] = v;
			} else if (settings.apiKeys[p]) {
				await invoke('secret_set', { name: `apikey-${p}`, value: settings.apiKeys[p] });
				lastSavedKeys[p] = settings.apiKeys[p];
			}
		}
		ui.secretsOk = true;
	} catch (e) {
		ui.secretsOk = false;
		toast(`Хранилище ключей недоступно: ${e}`, 'error');
	}
}

export function scheduleSaveSecret(p: (typeof PROVIDERS)[number], value: string) {
	if (!ui.secretsOk || lastSavedKeys[p] === value) return;
	clearTimeout(saveTimers[p]);
	saveTimers[p] = setTimeout(() => {
		lastSavedKeys[p] = value;
		void invoke('secret_set', { name: `apikey-${p}`, value }).catch((e) => toast(String(e), 'error'));
	}, 400);
}

export const quitApp = () => invoke('quit_app');

export async function initEvents(): Promise<UnlistenFn[]> {
	return [
		await listen('chess-board-changed', () => {
			if (settings.chessAuto && ui.mode !== 'snipping') void analyzeChess(false, true);
		}),
		await listen<string>('tray', (e) => {
			if (e.payload === 'toggle') void toggleMode();
			else if (e.payload === 'visibility') toggleVisibility();
			else if (e.payload === 'interactive') void setMode('interactive');
			else if (e.payload === 'settings') {
				void setMode('interactive');
				openSettings(true);
			}
		}),
		await listen<{ id: number; text: string }>('ai-status', (e) => {
			if (e.payload.id !== reqId) return;
			ui.statusDetail = e.payload.text;
		}),
		await listen<{ id: number; text: string }>('ai-chunk', (e) => {
			if (e.payload.id !== reqId) return;
			const last = session.messages.at(-1);
			if (last?.role === 'assistant') last.text += e.payload.text;
			ui.phase = 'streaming';
			ui.statusDetail = '';
		}),
		await listen<{ id: number }>('ai-done', (e) => {
			if (e.payload.id !== reqId) return;
			session.streaming = false;
			ui.phase = 'idle';
			ui.statusDetail = '';
			const last = session.messages.at(-1);
			if (last?.role === 'assistant') showMarksFrom(last.text);
			saveHistory();
		}),
		await listen<{ id: number; message: string }>('ai-error', (e) => {
			if (e.payload.id === reqId) fail(e.payload.message);
		})
	];
}

// ───────────── настройки: модели и прокси ─────────────

export async function loadModels(): Promise<void> {
	const p = settings.provider;
	try {
		const list = await invoke<string[]>('fetch_models', {
			cfg: {
				provider: p,
				apiKey: settings.apiKeys[p],
				model: '',
				baseUrl: settings.localBaseUrl,
				proxy: proxyOn() ? settings.proxyUrl.trim() : null,
				systemPrompt: ''
			}
		});
		ui.models[p] = list;
		toast(`Загружено моделей: ${list.length}`, 'ok');
	} catch (e) {
		toast(friendlyError(String(e), p, proxyOn()), 'error');
	}
}

export async function checkProxy(): Promise<void> {
	if (!settings.proxyUrl.trim()) return toast('Введите URL прокси', 'error');
	try {
		const ms = await invoke<number>('test_proxy', { proxy: settings.proxyUrl.trim() });
		toast(`Прокси работает: ${ms} мс`, 'ok');
	} catch (e) {
		toast(friendlyError(String(e), settings.provider, true), 'error');
	}
}

// ───────────── хоткеи ─────────────

export async function applyHotkeys() {
	const failed = await registerHotkeys(
		{ ...settings.hotkeys },
		{
			full: () => void captureFull(),
			snip: () => void startSnip(),
			toggle: () => void toggleMode(),
			visibility: toggleVisibility,
			marks: clearMarks,
			cancel: () => {
				void cancel();
				clearMarks();
			},
			preset: cyclePreset,
			chessBoard: () => void startBoardCalibration(),
			chessMove: () => void analyzeChess(false)
		}
	);
	if (failed.length) {
		toast(`Хоткей занят: ${failed.map((n: HotkeyName) => HOTKEY_LABELS[n]).join(', ')}`, 'error');
	}
}

export const releaseHotkeys = unregisterHotkeys;

// ───────────── проверка ключа, онбординг ─────────────

export async function testKey(): Promise<boolean> {
	const p = settings.provider;
	try {
		const ms = await invoke<number>('test_key', {
			cfg: {
				provider: p,
				apiKey: settings.apiKeys[p],
				model: '',
				baseUrl: settings.localBaseUrl,
				proxy: proxyOn() ? settings.proxyUrl.trim() : null,
				systemPrompt: ''
			}
		});
		toast(`Подключение работает (${ms} мс)`, 'ok');
		return true;
	} catch (e) {
		toast(friendlyError(String(e), p, proxyOn()), 'error');
		return false;
	}
}

export function finishOnboarding() {
	settings.onboarded = true;
}

// ───────────── история ─────────────

function saveHistory() {
	if (!session.id) return;
	const msgs = session.messages.map((m) => ({ role: m.role, text: m.text }));
	const firstAnswer = msgs.find((m) => m.role === 'assistant' && m.text);
	if (!firstAnswer) return;
	const title = firstAnswer.text.replace(/\`\`\`marks[\s\S]*$/, '').trim().slice(0, 70) || 'Без названия';
	const i = history.items.findIndex((h) => h.id === session.id);
	if (i >= 0) history.items.splice(i, 1);
	history.items.unshift({ id: session.id, ts: Date.now(), title, messages: msgs });
	if (history.items.length > 30) history.items.length = 30;
}

export function openHistoryItem(id: string) {
	const item = history.items.find((h) => h.id === id);
	if (!item) return;
	void cancel();
	clearMarks();
	session.messages = JSON.parse(JSON.stringify(item.messages));
	session.id = item.id;
	session.error = '';
	session.fromHistory = true;
	ui.historyOpen = false;
}

export function deleteHistoryItem(id: string) {
	history.items = history.items.filter((h) => h.id !== id);
}

export function clearHistory() {
	history.items = [];
}

export async function exportHistoryItem(id: string) {
	const item = history.items.find((h) => h.id === id);
	if (!item) return;
	const md = item.messages
		.map((m) => `**${m.role === 'user' ? 'Вы' : 'Модель'}:**\n\n${m.text.replace(/\`\`\`marks[\s\S]*?\`\`\`/g, '').trim()}`)
		.join('\n\n---\n\n');
	try {
		await navigator.clipboard.writeText(md);
		toast('Диалог скопирован в буфер как markdown', 'ok');
	} catch {
		toast('Не удалось скопировать в буфер', 'error');
	}
}
