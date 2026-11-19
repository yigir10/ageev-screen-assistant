<script lang="ts">
	import { fade } from 'svelte/transition';
	import { motion, settings, ui } from '$lib/state.svelte';

	function squareToCoords(sq: string): { cx: number; cy: number } | null {
		const b = settings.chessBoard;
		if (!b || sq.length < 2) return null;
		const file = sq.charCodeAt(0) - 97; // 'a'..'h' -> 0..7
		const rank = parseInt(sq[1], 10) - 1; // '1'..'8' -> 0..7
		if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;

		const cw = b.w / 8;
		const ch = b.h / 8;
		const col = settings.chessBottom === 'white' ? file : 7 - file;
		const row = settings.chessBottom === 'white' ? 7 - rank : rank;

		return {
			cx: b.x + col * cw + cw / 2,
			cy: b.y + row * ch + ch / 2
		};
	}

	function uciLine(uci: string | null) {
		if (!uci || uci.length < 4) return null;
		const from = squareToCoords(uci.slice(0, 2));
		const to = squareToCoords(uci.slice(2, 4));
		if (!from || !to) return null;
		return { x1: from.cx, y1: from.cy, x2: to.cx, y2: to.cy };
	}

	const bestLine = $derived(uciLine(ui.chessArrows?.best ?? null));
	const secondLine = $derived(uciLine(ui.chessArrows?.second ?? null));
</script>

{#if settings.chessBoard && ui.chessArrows}
	{@const b = settings.chessBoard}
	<svg
		transition:fade={{ duration: motion(120) }}
		class="pointer-events-none fixed inset-0 z-30 h-full w-full"
		aria-hidden="true"
	>
		<defs>
			<marker id="sf-best" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
				<path d="M0 0 L10 5 L0 10 z" fill="#10b981" stroke="#0b0d12" stroke-width="0.8" />
			</marker>
			<marker id="sf-second" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
				<path d="M0 0 L10 5 L0 10 z" fill="#38bdf8" stroke="#0b0d12" stroke-width="0.8" />
			</marker>
		</defs>

		<rect
			x={b.x}
			y={b.y}
			width={b.w}
			height={b.h}
			fill="none"
			stroke="rgba(255,255,255,0.14)"
			stroke-width="1"
		/>

		{#if secondLine}
			<line
				x1={secondLine.x1}
				y1={secondLine.y1}
				x2={secondLine.x2}
				y2={secondLine.y2}
				stroke="#0b0d12"
				stroke-width="9"
				stroke-linecap="round"
				opacity="0.45"
			/>
			<line
				x1={secondLine.x1}
				y1={secondLine.y1}
				x2={secondLine.x2}
				y2={secondLine.y2}
				stroke="rgba(56,189,248,0.8)"
				stroke-width="5.5"
				stroke-linecap="round"
				marker-end="url(#sf-second)"
			/>
		{/if}

		{#if bestLine}
			<line
				x1={bestLine.x1}
				y1={bestLine.y1}
				x2={bestLine.x2}
				y2={bestLine.y2}
				stroke="#0b0d12"
				stroke-width="12"
				stroke-linecap="round"
				opacity="0.55"
			/>
			<line
				x1={bestLine.x1}
				y1={bestLine.y1}
				x2={bestLine.x2}
				y2={bestLine.y2}
				stroke="rgba(16,185,129,0.92)"
				stroke-width="8"
				stroke-linecap="round"
				marker-end="url(#sf-best)"
			/>
		{/if}
	</svg>

	<div
		transition:fade={{ duration: motion(120) }}
		class="pointer-events-none fixed z-30 rounded-md border border-accent bg-hud-solid/95 px-2.5 py-1 font-mono text-xs font-semibold text-accent shadow-lg"
		style="left:{Math.max(8, b.x + 8)}px; top:{Math.max(8, b.y + 8)}px"
	>
		SF19: {ui.chessArrows.best} ({ui.chessArrows.evalText})
	</div>
{/if}
