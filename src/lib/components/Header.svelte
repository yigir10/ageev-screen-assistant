<script lang="ts">
	import { captureFull, clearChat, openHistory, openSettings, setMode, startSnip } from '$lib/actions';
	import { session, ui } from '$lib/state.svelte';

	let { ondragstart }: { ondragstart: (e: PointerEvent) => void } = $props();
	const btn =
		'h-7 cursor-pointer rounded-md border border-line bg-surface px-2 text-xs text-muted hover:border-accent hover:text-fg';
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	onpointerdown={ondragstart}
	class="flex cursor-move items-center justify-between gap-2 border-b border-line bg-white/[0.02] px-3 py-2 select-none"
>
	<div class="flex items-center gap-1.5">
		<span class="text-xs font-semibold text-fg">Stealth HUD</span>
		<button
			type="button"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={captureFull}
			title="Сделать быстрый скрин"
			class={btn}>Скрин</button
		>
		<button
			type="button"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={startSnip}
			title="Выделить и закрепить область"
			class={btn}>Область</button
		>
	</div>

	<div class="flex items-center gap-1" onpointerdown={(e) => e.stopPropagation()}>
		{#if session.messages.length}
			<button type="button" title="Очистить чат" onclick={clearChat} class={btn}>✕</button>
		{/if}
		<button
			type="button"
			title="История"
			onclick={() => openHistory()}
			class="{btn} {ui.historyOpen ? 'border-accent text-accent' : ''}">История</button
		>
		<button
			type="button"
			title="Настройки"
			onclick={() => openSettings()}
			class="{btn} {ui.settingsOpen ? 'border-accent text-accent' : ''}">⚙</button
		>
		<button type="button" title="Вернуться в Ghost Mode (Esc)" onclick={() => setMode('ghost')} class={btn}>Ghost</button>
	</div>
</div>
