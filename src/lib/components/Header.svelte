<script lang="ts">
	import { captureFull, clearChat, startSnip, toggleVisibility } from '$lib/actions';
	import { settings, ui } from '$lib/state.svelte';

	let { ondragstart }: { ondragstart: (e: PointerEvent) => void } = $props();

	const btn =
		'h-[30px] cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-xs text-fg hover:border-accent';
</script>

<div
	role="toolbar"
	tabindex="-1"
	aria-label="Панель управления"
	onpointerdown={ondragstart}
	class="flex cursor-move items-center gap-1.5 border-b border-line px-3 py-2.5"
>
	<span class="h-2 w-2 rounded-full bg-accent"></span>
	<span class="flex-1 text-xs font-semibold">Interactive</span>

	<button class={btn} onclick={captureFull} onpointerdown={(e) => e.stopPropagation()}>Экран</button>
	<button class={btn} onclick={startSnip} onpointerdown={(e) => e.stopPropagation()}>Область</button>
	<button
		class="{btn} {settings.stealth ? '!border-accent !text-accent' : ''}"
		aria-pressed={settings.stealth}
		title="Скрывать от записи экрана"
		onclick={() => (settings.stealth = !settings.stealth)}
		onpointerdown={(e) => e.stopPropagation()}>Stealth</button
	>
	<button class={btn} aria-label="Очистить диалог" onclick={clearChat} onpointerdown={(e) => e.stopPropagation()}>⌫</button>
	<button class={btn} aria-label="История" title="История диалогов" onclick={() => { ui.historyOpen = !ui.historyOpen; ui.settingsOpen = false; }} onpointerdown={(e) => e.stopPropagation()}>🕘</button>
	<button class={btn} aria-label="Настройки" onclick={() => { ui.settingsOpen = !ui.settingsOpen; ui.historyOpen = false; }} onpointerdown={(e) => e.stopPropagation()}>⚙</button>
	<button class={btn} aria-label="Скрыть оверлей" onclick={toggleVisibility} onpointerdown={(e) => e.stopPropagation()}>✕</button>
</div>
