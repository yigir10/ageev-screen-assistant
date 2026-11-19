<script lang="ts">
	import type { Rect } from '$lib/actions';
	import { ui } from '$lib/state.svelte';

	let { ondone, oncancel }: { ondone: (r: Rect) => void; oncancel: () => void } = $props();

	let start = $state<{ x: number; y: number } | null>(null);
	let cur = $state({ x: 0, y: 0 });

	const rect = $derived(
		start
			? {
					x: Math.min(start.x, cur.x),
					y: Math.min(start.y, cur.y),
					w: Math.abs(cur.x - start.x),
					h: Math.abs(cur.y - start.y)
				}
			: null
	);
	const dpr = $derived(window.devicePixelRatio || 1);
	const isBoard = $derived(ui.snipPurpose === 'board');

	function onpointerdown(e: PointerEvent) {
		if (e.button === 2) {
			e.preventDefault();
			oncancel();
			return;
		}
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		start = { x: e.clientX, y: e.clientY };
		cur = { x: e.clientX, y: e.clientY };
	}
	function onpointermove(e: PointerEvent) {
		cur = { x: e.clientX, y: e.clientY };
	}
	function onpointerup(e: PointerEvent) {
		if (e.button !== 0) return;
		const r = rect;
		start = null;
		if (r && r.w >= 8 && r.h >= 8) ondone(r);
		else oncancel();
	}
</script>

<div
	role="application"
	aria-label="Выделение области экрана"
	class="fixed inset-0 cursor-crosshair select-none"
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	oncontextmenu={(e) => {
		e.preventDefault();
		oncancel();
	}}
>
	{#if ui.snipBg}
		<img alt="" draggable="false" class="absolute inset-0 h-full w-full object-fill" src="data:image/jpeg;base64,{ui.snipBg}" />
	{/if}
	{#if rect}
		{@const badgeTop = rect.y + rect.h + 32 > window.innerHeight ? Math.max(8, rect.y - 26) : rect.y + rect.h + 8}
		<div
			class="absolute box-border border {isBoard ? 'border-warn' : 'border-accent'}"
			style="left:{rect.x}px; top:{rect.y}px; width:{rect.w}px; height:{rect.h}px; box-shadow:0 0 0 9999px rgba(0,0,0,0.35)"
		></div>
		{#each [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]] as c, i (i)}
			<div class="absolute h-2 w-2 {isBoard ? 'bg-warn' : 'bg-accent'}" style="left:{c[0] - 4}px; top:{c[1] - 4}px"></div>
		{/each}
		<div
			class="absolute rounded-md bg-hud-solid px-2 py-0.5 font-mono text-xs {isBoard ? 'text-warn' : 'text-accent'}"
			style="left:{rect.x}px; top:{badgeTop}px"
		>
			{Math.round(rect.w * dpr)}×{Math.round(rect.h * dpr)}
		</div>
	{:else}
		<div class="absolute inset-0 bg-black/35"></div>
		<div class="absolute top-0 h-full w-px bg-accent/50" style="left:{cur.x}px"></div>
		<div class="absolute left-0 h-px w-full bg-accent/50" style="top:{cur.y}px"></div>
	{/if}

	<div class="absolute top-5 left-1/2 -translate-x-1/2 rounded-[10px] border border-line bg-hud px-3.5 py-2 text-xs">
		{isBoard ? 'Обведите квадрат шахматной доски (ровно по краям 8×8)' : 'Выделите область (закрепится за «Скрин»)'} ·
		<kbd class="font-mono text-accent">Esc</kbd> или <kbd class="font-mono text-accent">ПКМ</kbd> — отмена
	</div>
</div>
