<script lang="ts">
	import { fly } from 'svelte/transition';
	import { clearPinnedRegion } from '$lib/actions';
	import { motion, session, settings, ui } from '$lib/state.svelte';
	import Header from './Header.svelte';
	import Messages from './Messages.svelte';
	import ChatInput from './ChatInput.svelte';

	let innerWidth = $state(1280);
	let innerHeight = $state(720);

	const interactive = $derived(ui.mode === 'interactive');
	const pos = $derived.by(() => {
		const raw = settings.panelPos ?? { x: Math.max(0, innerWidth - settings.panelWidth - 24), y: 24 };
		return {
			x: Math.min(Math.max(0, raw.x), Math.max(0, innerWidth - Math.min(settings.panelWidth, 160))),
			y: Math.min(Math.max(0, raw.y), Math.max(0, innerHeight - 60))
		};
	});

	const dotColor = $derived(interactive ? 'bg-accent' : 'bg-muted');
	const statusText = $derived(
		session.streaming ? 'стримится…' : session.error ? 'ошибка' : session.messages.length ? 'готово' : 'ожидание'
	);

	let drag: { dx: number; dy: number } | null = null;
	let resize: { startX: number; startW: number } | null = null;

	function ondragstart(e: PointerEvent) {
		drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
		ui.dragging = true;
	}
	function onpointermove(e: PointerEvent) {
		if (resize) {
			settings.panelWidth = Math.min(720, Math.max(320, Math.round(resize.startW + e.clientX - resize.startX)));
		}
		if (!drag) return;
		settings.panelPos = {
			x: Math.min(Math.max(0, e.clientX - drag.dx), Math.max(0, innerWidth - 80)),
			y: Math.min(Math.max(0, e.clientY - drag.dy), Math.max(0, innerHeight - 40))
		};
	}
	function onpointerup() {
		drag = null;
		resize = null;
		ui.dragging = false;
	}
	function onresizestart(e: PointerEvent) {
		e.stopPropagation();
		resize = { startX: e.clientX, startW: settings.panelWidth };
		ui.dragging = true;
	}
</script>

<svelte:window bind:innerWidth bind:innerHeight {onpointermove} {onpointerup} />

<div
	data-hit-area
	class="fixed flex flex-col overflow-hidden rounded-panel border bg-hud shadow-2xl {interactive ? 'border-accent' : 'border-line'}"
	style="left:{pos.x}px; top:{pos.y}px; width:{settings.panelWidth}px; font-size:{settings.fontSize}px; opacity:{settings.opacity / 100};
		{interactive ? 'height:min(72vh, 640px)' : 'max-height:60vh'}"
>
	{#if interactive}
		<div transition:fly={{ y: -4, duration: motion() }}>
			<Header {ondragstart} />
		</div>
	{/if}

	<Messages {interactive} />

	<div class="flex items-center justify-between gap-2 px-3.5 py-2 text-[11px] text-muted">
		<div class="flex min-w-0 items-center gap-1.5">
			<span class="h-1.5 w-1.5 flex-none rounded-full {session.error ? 'bg-danger' : session.streaming ? 'bg-warn' : dotColor}"></span>
			<span class="truncate">{settings.provider} · {settings.models[settings.provider]} · {statusText}</span>
		</div>

		{#if settings.pinnedRegion}
			<span class="inline-flex flex-none items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
				{Math.round(settings.pinnedRegion.w)}×{Math.round(settings.pinnedRegion.h)}
				{#if interactive}
					<button
						type="button"
						title="Сбросить на весь экран"
						onclick={clearPinnedRegion}
						class="cursor-pointer border-0 bg-transparent p-0 text-accent hover:text-fg">✕</button
					>
				{/if}
			</span>
		{:else}
			<span class="flex-none text-[10px] text-muted">Весь экран</span>
		{/if}
	</div>

	{#if interactive}
		<div transition:fly={{ y: 4, duration: motion() }}>
			<ChatInput />
		</div>
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Изменить ширину панели"
			onpointerdown={onresizestart}
			class="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize hover:bg-accent/40"
		></div>
	{/if}
</div>
