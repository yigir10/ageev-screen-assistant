<script lang="ts">
	import { fly } from 'svelte/transition';
	import { motion, ui } from '$lib/state.svelte';

	const color = { info: 'border-line', ok: 'border-accent', error: 'border-danger' } as const;
</script>

<div class="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-[min(420px,90vw)] -translate-x-1/2 flex-col gap-2">
	{#each ui.toasts as t (t.id)}
		<div
			in:fly={{ y: 4, duration: motion() }}
			out:fly={{ y: 4, duration: motion(120) }}
			role="status"
			class="rounded-ctl border bg-hud px-3 py-2 text-[13px] text-fg shadow-lg {color[t.kind]}"
		>
			{t.text}
		</div>
	{/each}
</div>
