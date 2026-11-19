<script lang="ts">
	import { fade } from 'svelte/transition';
	import { ask, cancel, retry, runPresetNow, selectPreset, toast } from '$lib/actions';
	import { motion, session, settings } from '$lib/state.svelte';

	let text = $state('');
	let pendingImage = $state<string | null>(null);
	let zoom = $state(false);

	const shot = $derived(pendingImage ?? session.messages.find((m) => m.image)?.image ?? null);
	const placeholder = $derived(
		pendingImage
			? 'Картинка из буфера готова — напишите вопрос или Enter…'
			: session.fromHistory
				? 'Диалог из истории (без скриншота) — спросите текстом или Ctrl+V…'
				: session.messages.length
					? 'Уточнить вопрос или Ctrl+V скриншот…'
					: 'Спросите текстом или вставьте скриншот (Ctrl+V)…'
	);

	function submit() {
		if (!text.trim() && !pendingImage) return;
		const img = pendingImage;
		pendingImage = null;
		ask(text, img);
		text = '';
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	function onpaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (!item.type.startsWith('image/')) continue;
			const file = item.getAsFile();
			if (!file) continue;
			e.preventDefault();
			const url = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => {
				const maxW = 1800;
				const scale = img.width > maxW ? maxW / img.width : 1;
				const canvas = document.createElement('canvas');
				canvas.width = Math.round(img.width * scale);
				canvas.height = Math.round(img.height * scale);
				const ctx = canvas.getContext('2d');
				if (ctx) {
					ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
					pendingImage = canvas.toDataURL('image/jpeg', 0.82).split(',')[1] ?? null;
					toast('Скриншот из буфера прикреплён', 'ok');
				}
				URL.revokeObjectURL(url);
			};
			img.src = url;
			break;
		}
	}
</script>

<div class="relative flex flex-col gap-2 border-t border-line p-3">
	<div class="flex flex-wrap gap-1.5" role="group" aria-label="Пресеты запросов">
		{#each settings.presets as p (p.id)}
			<button
				type="button"
				aria-pressed={settings.activePreset === p.id}
				title="{p.prompt}\n(Двойной клик — сразу спросить по текущему скриншоту)"
				onclick={() => selectPreset(p.id)}
				ondblclick={() => runPresetNow(p.id)}
				class="h-6 cursor-pointer rounded-full border px-2.5 text-[11px] {settings.activePreset === p.id
					? 'border-accent bg-accent/15 text-accent'
					: 'border-line bg-surface text-muted hover:text-fg'}"
			>{p.name}</button>
		{/each}
	</div>

	{#if zoom && shot}
		<div
			data-hit-area
			transition:fade={{ duration: motion() }}
			class="absolute bottom-full left-3 z-10 mb-2 overflow-hidden rounded-ctl border border-line bg-hud-solid shadow-xl"
		>
			<img alt="Скриншот" class="max-h-64 max-w-[380px]" src="data:image/jpeg;base64,{shot}" />
		</div>
	{/if}

	<div class="flex items-end gap-2">
		<div class="relative">
			<button
				type="button"
				aria-label="Показать скриншот"
				disabled={!shot}
				onclick={() => (zoom = !zoom)}
				class="h-9 w-14 flex-none cursor-pointer overflow-hidden rounded-ctl border bg-surface p-0 disabled:cursor-default disabled:opacity-40 {pendingImage
					? 'border-accent'
					: 'border-line'}"
			>
				{#if shot}<img alt="" class="h-full w-full object-cover" src="data:image/jpeg;base64,{shot}" />{/if}
			</button>
			{#if pendingImage}
				<button
					type="button"
					title="Убрать вставленную картинку"
					onclick={() => (pendingImage = null)}
					class="absolute -top-1.5 -right-1.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-danger text-[10px] text-hud-solid"
				>✕</button>
			{/if}
		</div>

		<textarea
			aria-label="Уточнить вопрос"
			rows="1"
			bind:value={text}
			{onkeydown}
			{onpaste}
			{placeholder}
			class="max-h-28 min-h-9 flex-1 resize-none rounded-ctl border border-line bg-surface px-3 py-2 text-[13px] text-fg outline-none placeholder:text-muted focus:border-accent"
		></textarea>

		{#if !session.streaming && session.messages.length}
			<button
				type="button"
				aria-label="Повторить"
				title="Повторить запрос"
				onclick={retry}
				class="h-9 cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-[13px] text-fg hover:border-accent">↻</button
			>
		{/if}

		{#if session.streaming}
			<button
				type="button"
				onclick={cancel}
				class="h-9 cursor-pointer rounded-ctl border border-danger bg-transparent px-3 text-[13px] text-danger">Стоп</button
			>
		{:else}
			<button
				type="button"
				aria-label="Отправить"
				onclick={submit}
				class="h-9 cursor-pointer rounded-ctl border-0 bg-accent px-3.5 text-[13px] font-semibold text-hud-solid">↵</button
			>
		{/if}
	</div>
</div>
