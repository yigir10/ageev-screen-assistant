import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import type { HotkeyName, Hotkeys } from './state.svelte';

const MODIFIER_CODES = new Set([
	'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
	'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'
]);

const PASS_THROUGH = new Set([
	'Space', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
	'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Semicolon',
	'Quote', 'Comma', 'Period', 'Slash', 'Backslash',
	'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'
]);

function codeToKey(code: string): string | null {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit\d$/.test(code)) return code.slice(5);
	if (/^F\d{1,2}$/.test(code)) return code;
	return PASS_THROUGH.has(code) ? code : null;
}

export function eventToAccelerator(e: KeyboardEvent): string | null {
	if (MODIFIER_CODES.has(e.code)) return null;
	const key = codeToKey(e.code);
	if (!key) return null;
	const mods: string[] = [];
	if (e.ctrlKey) mods.push('CommandOrControl');
	if (e.altKey) mods.push('Alt');
	if (e.shiftKey) mods.push('Shift');
	if (e.metaKey) mods.push('Super');
	if (mods.length === 0 && !/^F\d{1,2}$/.test(key)) return null;
	return [...mods, key].join('+');
}

const PRETTY: Record<string, string> = {
	CommandOrControl: 'Ctrl', Super: 'Win', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
	Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
	Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\'
};

export function prettyAccelerator(accel: string): string[] {
	if (!accel.trim()) return ['—'];
	return accel.split('+').map((p) => PRETTY[p] ?? p);
}

export async function unregisterHotkeys() {
	try {
		await unregisterAll();
	} catch {}
}

export async function registerHotkeys(
	keys: Hotkeys,
	handlers: Record<HotkeyName, () => void>
): Promise<HotkeyName[]> {
	await unregisterHotkeys();
	const failed: HotkeyName[] = [];
	for (const name of Object.keys(keys) as HotkeyName[]) {
		const accel = keys[name]?.trim();
		if (!accel) continue;
		try {
			await register(accel, (ev) => {
				if (ev.state === 'Pressed') handlers[name]();
			});
		} catch {
			failed.push(name);
		}
	}
	return failed;
}
