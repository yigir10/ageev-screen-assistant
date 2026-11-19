<script lang="ts">
	import { stripMarks } from '$lib/marks';
	import { session, settings, HOTKEY_LABELS, type HotkeyName } from '$lib/state.svelte';
	import Markdown from './Markdown.svelte';
	import Kbd from './Kbd.svelte';

	let { interactive }: { interactive: boolean } = $props();

	let box: HTMLDivElement | undefined = $state();
	const names: HotkeyName[] = ['full', 'snip', 'toggle', 'visibility', 'marks', 'cancel', 'preset'];

	// В Ghost показываем только последний ответ; в Interactive — всю переписку
	const visible = $derived(
		interactive ? session.messages : session.messages.filter((m) => m.role === 'assistant').slice(-1)
	);

	// автоскролл вниз при росте последнего сообщения
	$effect(() => {
		void session.messages.at(-1)?.text;
		void session.messages.length;
		if (box) box.scrollTop = box.scrollHeight;
	});
</script>

<div bind:this={box} class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5 {interactive ? 'select-text' : 'select-none'}">
	{#if session.messages.length === 0}
		<div class="flex flex-col gap-2 text-muted">
			<span class="text-fg">Готов к работе. Горячие клавиши:</span>
			{#each names as n (n)}
				<div class="flex items-center justify-between gap-3">
					<span>{HOTKEY_LABELS[n]}</span>
					<Kbd accel={settings.hotkeys[n]} />
				</div>
			{/each}
		</div>
	{/if}

	{#each visible as m, i (i)}
		{#if m.role === 'user'}
			<div class="max-w-[85%] self-end rounded-[12px_12px_4px_12px] bg-accent2 px-3 py-2 text-hud-solid">
				{#if m.image}
					<img class="mb-1.5 max-h-24 rounded-md" alt="Скриншот" src="data:image/jpeg;base64,{m.image}" />
				{/if}
				<div class="whitespace-pre-wrap">{m.text}</div>
			</div>
		{:else}
			{@const isLast = m === session.messages.at(-1)}
			<div class="max-w-full self-start rounded-[12px_12px_12px_4px] {interactive ? 'bg-surface px-3 py-2' : ''}">
				<Markdown text={stripMarks(m.text)} streaming={session.streaming && isLast} />
			</div>
		{/if}
	{/each}
</div>
