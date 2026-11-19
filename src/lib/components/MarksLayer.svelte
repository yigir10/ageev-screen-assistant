<script lang="ts">
	import { fade } from 'svelte/transition';
	import { motion, session, settings, ui } from '$lib/state.svelte';
	import Kbd from './Kbd.svelte';

	const px = (v: number) => session.frame.x + (v / 1000) * session.frame.w;
	const py = (v: number) => session.frame.y + (v / 1000) * session.frame.h;
	const clampX = (x: number) => Math.max(8, Math.min(x, window.innerWidth - 268));
	const clampY = (y: number) => Math.max(20, Math.min(y, window.innerHeight - 24));
</script>

<div class="pointer-events-none fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-hud px-3 py-1 text-[11px] text-muted">
	<span>≈ метки приблизительные</span>
	{#if settings.hotkeys.marks}
		<span>· убрать:</span>
		<Kbd accel={settings.hotkeys.marks} />
	{/if}
</div>

<svg class="pointer-events-none fixed inset-0 h-full w-full" aria-hidden="true">
	<defs>
		<marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
			<path d="M0 0 L10 5 L0 10 z" fill="#6ee7b7" stroke="#0b0d12" stroke-width="1" />
		</marker>
	</defs>

	{#each ui.marks as m, i (i)}
		<g transition:fade={{ duration: motion() }}>
			{#if m.type === 'box' && m.x2 !== undefined && m.y2 !== undefined}
				{@const x = Math.min(px(m.x), px(m.x2)) - 4}
				{@const y = Math.min(py(m.y), py(m.y2)) - 4}
				{@const w = Math.abs(px(m.x2) - px(m.x)) + 8}
				{@const h = Math.abs(py(m.y2) - py(m.y)) + 8}
				<rect {x} {y} width={w} height={h} rx="4" fill="rgba(110,231,183,0.12)" stroke="#0b0d12" stroke-width="5" />
				<rect {x} {y} width={w} height={h} rx="4" fill="none" stroke="#6ee7b7" stroke-width="2.5" />
			{:else if m.type === 'arrow' && m.x2 !== undefined && m.y2 !== undefined}
				<line x1={px(m.x)} y1={py(m.y)} x2={px(m.x2)} y2={py(m.y2)} stroke="#0b0d12" stroke-width="6" stroke-linecap="round" />
				<line x1={px(m.x)} y1={py(m.y)} x2={px(m.x2)} y2={py(m.y2)} stroke="#6ee7b7" stroke-width="3" stroke-linecap="round" marker-end="url(#head)" />
			{:else if m.type === 'point'}
				<circle cx={px(m.x)} cy={py(m.y)} r="11" fill="none" stroke="#0b0d12" stroke-width="5" />
				<circle cx={px(m.x)} cy={py(m.y)} r="11" fill="rgba(110,231,183,0.25)" stroke="#6ee7b7" stroke-width="2.5" />
			{/if}

			{#if m.label}
				{@const rawX = m.type === 'arrow' && m.x2 !== undefined ? px(m.x2) + 10 : px(m.x) + (m.type === 'text' ? 0 : 14)}
				{@const rawY = m.type === 'arrow' && m.y2 !== undefined ? py(m.y2) - 10 : py(m.y) - (m.type === 'text' ? 0 : 14)}
				<foreignObject x={clampX(rawX)} y={clampY(rawY) - 14} width="260" height="30" style="overflow:visible">
					<div class="inline-block max-w-[260px] truncate rounded-md border border-accent bg-hud-solid px-2 py-0.5 text-xs text-fg">
						{m.label}
					</div>
				</foreignObject>
			{/if}
		</g>
	{/each}
</svg>
