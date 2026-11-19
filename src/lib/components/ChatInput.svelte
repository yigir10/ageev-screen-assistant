<script lang="ts">
	import { fade } from 'svelte/transition';
	import { ask, cancel, retry, usePreset } from '$lib/actions';
	import { motion, session, settings } from '$lib/state.svelte';

	let text = $state('');
	let zoom = $state(false);
	const shot = $derived(session.messages.find((m) => m.image)?.image);

	function submit() {
		if (!text.trim()) return;
		ask(text);
		text = '';
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}
</script>

<div class="relative flex flex-col gap-2 border-t border-line p-3">
	<!-- пресеты: клик выбирает активный; если скриншот уже есть — сразу задаёт этот вопрос -->
	<div class="flex flex-wrap gap-1.5" role="group" aria-label="Пресеты запросов">
		{#each settings.presets as p (p.id)}
			<button
				type="button"
				aria-pressed={settings.activePreset === p.id}
				title={p.prompt}
				onclick={() => usePreset(p.id)}
				class="h-6 cursor-pointer rounded-full border px-2.5 text-[11px] {settings.activePreset === p.id ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-surface text-muted hover:text-fg'}"
			>{p.name}</button>
		{/each}
	</div>

	{#if zoom && shot}
		<div transition:fade={{ duration: motion() }} class="absolute bottom-full left-3 z-10 mb-2 overflow-hidden rounded-ctl border border-line bg-hud-solid shadow-xl">
			<img alt="Скриншот" class="max-h-64 max-w-[380px]" src="data:image/jpeg;base64,{shot}" />
		</div>
	{/if}

	<div class="flex items-end gap-2">
		<button
			type="button"
			aria-label="Показать скриншот"
			disabled={!shot}
			onclick={() => (zoom = !zoom)}
			class="h-9 w-14 flex-none cursor-pointer overflow-hidden rounded-ctl border border-line bg-surface p-0 disabled:cursor-default disabled:opacity-40"
		>
			{#if shot}<img alt="" class="h-full w-full object-cover" src="data:image/jpeg;base64,{shot}" />{/if}
		</button>

		<textarea
			aria-label="Уточнить вопрос"
			rows="1"
			bind:value={text}
			{onkeydown}
			placeholder="Уточнить вопрос по скриншоту…"
			class="max-h-28 min-h-9 flex-1 resize-none rounded-ctl border border-line bg-surface px-3 py-2 text-[13px] text-fg outline-none placeholder:text-muted focus:border-accent"
		></textarea>

		{#if !session.streaming && session.messages.length}
			<button type="button" aria-label="Повторить" title="Повторить запрос" onclick={retry} class="h-9 cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-[13px] text-fg hover:border-accent">↻</button>
		{/if}

		{#if session.streaming}
			<button type="button" onclick={cancel} class="h-9 cursor-pointer rounded-ctl border border-danger bg-transparent px-3 text-[13px] text-danger">Стоп</button>
		{:else}
			<button type="button" aria-label="Отправить" onclick={submit} class="h-9 cursor-pointer rounded-ctl border-0 bg-accent px-3.5 text-[13px] font-semibold text-hud-solid">↵</button>
		{/if}
	</div>
</div>
