<script lang="ts">
	import { fade } from 'svelte/transition';
	import { motion, ui, type Phase } from '$lib/state.svelte';

	const label: Record<Phase, string> = {
		idle: '',
		capturing: 'Снимаю экран…',
		thinking: 'Думаю…',
		streaming: 'Пишу ответ…'
	};
</script>

<!-- обратная связь в Ghost Mode: видно, что хоткей сработал -->
{#if ui.phase !== 'idle'}
	<div
		transition:fade={{ duration: motion(120) }}
		role="status"
		class="pointer-events-none fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent bg-hud px-3 py-1 text-xs text-fg shadow-lg"
	>
		<span class="h-2 w-2 animate-pulse rounded-full bg-accent"></span>{label[ui.phase]}
	</div>
{/if}
