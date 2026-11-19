<script lang="ts">
	import { eventToAccelerator } from '$lib/hotkeys';
	import { DEFAULT_HOTKEYS, HOTKEY_LABELS, settings, ui, type HotkeyName } from '$lib/state.svelte';
	import Kbd from './Kbd.svelte';

	let { name }: { name: HotkeyName } = $props();

	let recording = $state(false);
	let warning = $state('');

	function start() {
		recording = true;
		ui.recording = true; // на время записи глобальные бинды снимаются, чтобы нажатие не сработало как команда
		warning = '';
	}
	function stop() {
		recording = false;
		ui.recording = false;
	}

	function onkeydown(e: KeyboardEvent) {
		if (!recording) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape') return stop();
		const accel = eventToAccelerator(e);
		if (!accel) {
			warning = 'Нужен модификатор (Ctrl / Alt / Shift) и клавиша';
			return;
		}
		const clash = (Object.keys(settings.hotkeys) as HotkeyName[]).find((n) => n !== name && settings.hotkeys[n] === accel);
		if (clash) {
			warning = `Конфликт с «${HOTKEY_LABELS[clash]}»`;
			return;
		}
		settings.hotkeys[name] = accel;
		stop();
	}

	function reset() {
		settings.hotkeys[name] = DEFAULT_HOTKEYS[name];
		warning = '';
	}
</script>

<div class="flex flex-col gap-1">
	<div class="flex items-center justify-between gap-2">
		<span>{HOTKEY_LABELS[name]}</span>
		<div class="flex items-center gap-1.5">
			<button
				type="button"
				{onkeydown}
				onclick={start}
				onblur={stop}
				class="min-h-[30px] cursor-pointer rounded-md border bg-surface px-2 {recording ? 'border-accent text-accent' : 'border-line'}"
			>
				{#if recording}Нажмите комбинацию…{:else}<Kbd accel={settings.hotkeys[name]} />{/if}
			</button>
			<button type="button" aria-label="Сбросить хоткей" onclick={reset} class="h-[30px] cursor-pointer rounded-md border border-line bg-surface px-2 text-muted hover:text-fg">↺</button>
		</div>
	</div>
	{#if warning}<span class="text-[11px] text-warn">{warning}</span>{/if}
</div>
