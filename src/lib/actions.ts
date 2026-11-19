// Бизнес-логика: режимы окна, захват, чат со стримингом, хоткеи. Работает поверх rune-store.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tick } from 'svelte';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { extractMarks, GRID_PROMPT, MARKS_PROMPT } from './marks';
import { friendlyError } from './errors';
import { DEFAULT_PRESETS, HOTKEY_LABELS, history, session, settings, ui, type HotkeyName, type Mode } from './state.svelte';

let reqId = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toast(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
	const id = crypto.randomUUID();
	ui.toasts.push({ id, text, kind });
	setTimeout(() => {
		ui.toasts = ui.toasts.filter((t) => t.id !== id);
	}, 4500);
}

// ───────────── режимы окна ─────────────

export async function setMode(mode: Mode) {
	ui.mode = mode;
	if (mode !== 'interactive') {
		ui.settingsOpen = false;
		ui.historyOpen = false;
	}
	try {
		await invoke('set_interactive', { interactive: mode !== 'ghost' });
	} catch (e) {
		toast(String(e), 'error');
	}
}

export const toggleMode = () => setMode(ui.mode === 'ghost' ? 'interactive' : 'ghost');

export function toggleVisibility() {
	ui.hidden = !ui.hidden;
	if (ui.hidden && ui.mode !== 'ghost') setMode('ghost');
}

export async function applyStealth() {
	try {
		await invoke('set_stealth', { enabled: settings.stealth });
	} catch (e) {
		toast(`Stealth: ${e}`, 'error');
	}
}

// ───────────── захват экрана ─────────────

/** Если stealth выключен, на время захвата прячем свой UI, чтобы он не попал в кадр. */
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
	if (!skipHide) await hideUiForCapture();
	ui.phase = 'capturing';
	try {
		const image = await invoke<string>(cmd, args);
		session.frame = frame; // координаты меток модели привязываются к этой области
		beginChat(image);
	} catch (e) {
		ui.phase = 'idle';
		toast(String(e), 'error');
	} finally {
		ui.capturing = false;
	}
}

const useGrid = () => settings.marksEnabled && settings.marksGrid;

export const captureFull = () =>
	capture('capture_full', { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, { grid: useGrid() });

/** Режим выделения: сначала замораживаем кадр в ОЗУ (картинка не поменяется, пока выделяешь), потом показываем оверлей. */
export async function startSnip() {
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

/** rect — в CSS-пикселях окна; в Rust уходят физические пиксели (× devicePixelRatio). */
export async function captureRegion(rect: Rect) {
	const dpr = window.devicePixelRatio || 1;
	const cached = !!ui.snipBg;
	ui.snipBg = '';
	await setMode('ghost'); // убираем затемнение и возвращаемся в Ghost
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
		cached // кадр уже снят заранее — прятать UI не нужно
	);
}

// ───────────── чат ─────────────

const proxyOn = () => settings.proxyEnabled && settings.proxyUrl.trim() !== '';

function activePrompt(): string {
	const p = settings.presets.find((x) => x.id === settings.activePreset) ?? settings.presets[0];
	return p?.prompt.trim() || 'Проанализируй скриншот и ответь на то, что на нём спрашивается или требуется сделать.';
}

/** Выбрать пресет; если скриншот уже есть — сразу задать этот вопрос по нему. */
export function usePreset(id: string) {
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

function beginChat(image: string) {
	session.id = crypto.randomUUID();
	session.messages = [
		{ role: 'user', text: activePrompt(), image },
		{ role: 'assistant', text: '' }
	];
	void send();
}

export function ask(text: string) {
	const t = text.trim();
	if (!t || session.streaming || session.messages.length === 0) return;
	session.messages.push({ role: 'user', text: t }, { role: 'assistant', text: '' });
	void send();
}

async function send() {
	const id = ++reqId;
	const p = settings.provider;
	session.streaming = true;
	session.error = '';
	ui.phase = 'thinking';
	clearMarks();
	// Скриншот есть только в первом сообщении; длинную историю обрезаем, первое сообщение сохраняем
	const all = session.messages.slice(0, -1);
	const trimmed = all.length > 13 ? [all[0], ...all.slice(-12)] : all;
	const history = trimmed.map((m) => ({ role: m.role, text: m.text, image: m.image ?? null }));
	const cfg = {
		provider: p,
		apiKey: settings.apiKeys[p],
		model: settings.models[p],
		baseUrl: settings.localBaseUrl,
		proxy: settings.proxyEnabled && settings.proxyUrl.trim() ? settings.proxyUrl.trim() : null,
		systemPrompt: settings.systemPrompt + (settings.marksEnabled ? MARKS_PROMPT + (settings.marksGrid ? GRID_PROMPT : '') : '')
	};
	try {
		await invoke('stream_chat', { cfg, messages: history, requestId: id });
	} catch (e) {
		fail(String(e));
	}
}

function fail(message: string) {
	session.streaming = false;
	ui.phase = 'idle';
	message = friendlyError(message, settings.provider, proxyOn());
	session.error = message;
	const last = session.messages.at(-1);
	if (last?.role === 'assistant' && !last.text) session.messages.pop();
	toast(message, 'error');
}

/** Повторить последний запрос (после ошибки или чтобы получить другой ответ). */
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
}

// ───────────── разметка на экране ─────────────

let marksTimer: ReturnType<typeof setTimeout> | undefined;

export function clearMarks() {
	clearTimeout(marksTimer);
	ui.marks = [];
}

function showMarksFrom(text: string) {
	if (!settings.marksEnabled) return;
	const marks = extractMarks(text);
	if (!marks.length) return;
	ui.marks = marks;
	clearTimeout(marksTimer);
	if (settings.marksTtl > 0) marksTimer = setTimeout(clearMarks, settings.marksTtl * 1000);
}

export function clearChat() {
	void cancel();
	clearMarks();
	session.messages = [];
	session.id = '';
	session.error = '';
}

// ───────────── ключи в Windows Credential Manager ─────────────

const PROVIDERS = ['gemini', 'openrouter', 'local'] as const;

export async function loadSecrets() {
	try {
		for (const p of PROVIDERS) {
			const v = await invoke<string | null>('secret_get', { name: `apikey-${p}` });
			if (v) settings.apiKeys[p] = v;
			else if (settings.apiKeys[p]) await invoke('secret_set', { name: `apikey-${p}`, value: settings.apiKeys[p] }); // миграция из localStorage
		}
		ui.secretsOk = true;
	} catch (e) {
		ui.secretsOk = false;
		toast(`Хранилище ключей недоступно: ${e}`, 'error');
	}
}

export async function saveSecret(p: (typeof PROVIDERS)[number], value: string) {
	if (!ui.secretsOk) return;
	await invoke('secret_set', { name: `apikey-${p}`, value }).catch((e) => toast(String(e), 'error'));
}

export const quitApp = () => invoke('quit_app');

export async function initEvents(): Promise<UnlistenFn[]> {
	return [
		await listen<string>('tray', (e) => {
			if (e.payload === 'toggle') void toggleMode();
			else if (e.payload === 'visibility') toggleVisibility();
			else if (e.payload === 'interactive') void setMode('interactive');
			else if (e.payload === 'settings') {
				void setMode('interactive');
				ui.settingsOpen = true;
			}
		}),
		await listen<{ id: number; text: string }>('ai-chunk', (e) => {
			if (e.payload.id !== reqId) return;
			const last = session.messages.at(-1);
			if (last?.role === 'assistant') last.text += e.payload.text;
			ui.phase = 'streaming';
		}),
		await listen<{ id: number }>('ai-done', (e) => {
			if (e.payload.id !== reqId) return;
			session.streaming = false;
			ui.phase = 'idle';
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
				proxy: settings.proxyEnabled && settings.proxyUrl.trim() ? settings.proxyUrl.trim() : null,
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
			full: captureFull,
			snip: startSnip,
			toggle: toggleMode,
			visibility: toggleVisibility,
			marks: clearMarks,
			cancel: () => {
				void cancel();
				clearMarks();
			},
			preset: cyclePreset
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
	const title = firstAnswer.text.replace(/```marks[\s\S]*$/, '').trim().slice(0, 70) || 'Без названия';
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
	const md = item.messages.map((m) => `**${m.role === 'user' ? 'Вы' : 'Модель'}:**\n\n${m.text.replace(/```marks[\s\S]*?```/g, '').trim()}`).join('\n\n---\n\n');
	try {
		await navigator.clipboard.writeText(md);
		toast('Диалог скопирован в буфер как markdown', 'ok');
	} catch {
		toast('Не удалось скопировать в буфер', 'error');
	}
}
