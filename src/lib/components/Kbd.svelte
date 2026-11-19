<script lang="ts">
	import { prettyAccelerator } from '$lib/hotkeys';

	let { accel }: { accel: string } = $props();
	const parts = $derived(prettyAccelerator(accel));
</script>

<span class="inline-flex items-center gap-1">
	{#each parts as p, i (i)}
		<kbd class="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg">{p}</kbd>
	{/each}
</span>
