<script lang="ts">
	import { fly } from 'svelte/transition';
	import { motion, session, settings, ui } from '$lib/state.svelte';
	import Header from './Header.svelte';
	import Messages from './Messages.svelte';
	import ChatInput from './ChatInput.svelte';

	let innerWidth = $state(1280);
	let innerHeight = $state(720);

	const interactive = $derived(ui.mode === 'interactive');
	const pos = $derived(settings.panelPos ?? { x: Math.max(0, innerWidth - settings.panelWidth - 24), y: 24 });

	const dotColor = $derived(interactive ? 'bg-accent' : 'bg-muted');
	const statusText = $derived(
		session.streaming ? 'стримится…' : session.error ? 'ошибка' : session.messages.length ? 'готово' : 'ожидание'
	);

	// перетаскивание (только в Interactive)
	let drag: { dx: number; dy: number } | null = null;

	function ondragstart(e: PointerEvent) {
		drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
	}
	function onpointermove(e: PointerEvent) {
		onresizemove(e);
		if (!drag) return;
		settings.panelPos = {
			x: Math.min(Math.max(0, e.clientX - drag.dx), innerWidth - 80),
			y: Math.min(Math.max(0, e.clientY - drag.dy), innerHeight - 40)
		};
	}
	const onpointerup = () => {
		drag = null;
		resize = null;
	};

	// изменение ширины панели (правый край, только Interactive)
	let resize: { startX: number; startW: number } | null = null;
	function onresizestart(e: PointerEvent) {
		e.stopPropagation();
		resize = { startX: e.clientX, startW: settings.panelWidth };
	}
	function onresizemove(e: PointerEvent) {
		if (!resize) return;
		settings.panelWidth = Math.min(720, Math.max(320, Math.round(resize.startW + e.clientX - resize.startX)));
	}
</script>

<svelte:window bind:innerWidth bind:innerHeight {onpointermove} {onpointerup} />

<div
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

	<div class="flex items-center gap-1.5 px-3.5 py-2 text-[11px] text-muted">
		<span class="h-1.5 w-1.5 rounded-full {session.error ? 'bg-danger' : session.streaming ? 'bg-warn' : dotColor}"></span>
		<span class="truncate">{settings.provider} · {settings.models[settings.provider]} · {statusText}</span>
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
