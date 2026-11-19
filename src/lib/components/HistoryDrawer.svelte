<script lang="ts">
	import { fly } from 'svelte/transition';
	import { clearHistory, deleteHistoryItem, exportHistoryItem, openHistoryItem } from '$lib/actions';
	import { history, motion, ui } from '$lib/state.svelte';

	const fmt = (ts: number) =>
		new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	const small = 'h-7 cursor-pointer rounded-md border border-line bg-surface px-2 text-[11px] text-muted hover:text-fg';
</script>

<aside
	data-hit-area
	transition:fly={{ x: 360, duration: motion(180) }}
	aria-label="История"
	class="fixed top-4 right-4 bottom-4 z-40 flex w-[360px] flex-col overflow-hidden rounded-panel border border-accent bg-hud text-[13px] shadow-2xl"
>
	<div class="flex items-center justify-between border-b border-line px-3.5 py-3">
		<span class="text-sm font-semibold">История</span>
		<div class="flex gap-1.5">
			{#if history.items.length}<button type="button" class={small} onclick={clearHistory}>Очистить всё</button>{/if}
			<button
				type="button"
				aria-label="Закрыть"
				onclick={() => (ui.historyOpen = false)}
				class="h-[30px] w-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-fg">✕</button
			>
		</div>
	</div>

	<div class="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
		{#each history.items as h (h.id)}
			<div class="rounded-ctl border border-line bg-surface p-2.5">
				<button
					type="button"
					onclick={() => openHistoryItem(h.id)}
					class="w-full cursor-pointer border-0 bg-transparent p-0 text-left text-fg"
				>
					<div class="text-[11px] text-muted">{fmt(h.ts)} · сообщений: {h.messages.length}</div>
					<div class="mt-0.5 line-clamp-2">{h.title}</div>
				</button>
				<div class="mt-2 flex gap-1.5">
					<button type="button" class={small} onclick={() => exportHistoryItem(h.id)}>Копировать markdown</button>
					<button type="button" class={small} onclick={() => deleteHistoryItem(h.id)}>Удалить</button>
				</div>
			</div>
		{:else}
			<span class="text-muted">Пока пусто. Диалоги сохраняются автоматически (только текст, без скриншотов).</span>
		{/each}
	</div>
</aside>
