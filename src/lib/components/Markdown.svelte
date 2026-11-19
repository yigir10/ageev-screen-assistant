<script lang="ts">
	import { parseMarkdown } from '$lib/markdown';

	let { text, streaming = false }: { text: string; streaming?: boolean } = $props();

	const segs = $derived(parseMarkdown(text));
	let copiedIdx = $state(-1);

	async function copy(code: string, i: number) {
		try {
			await navigator.clipboard.writeText(code);
			copiedIdx = i;
			setTimeout(() => (copiedIdx = -1), 1200);
		} catch {
			/* буфер обмена недоступен */
		}
	}
</script>

<div class="leading-[1.55]">
	{#each segs as s, i (i)}
		{#if s.t === 'html'}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html s.html}
		{:else}
			<div class="my-2 overflow-hidden rounded-ctl border border-line bg-hud-solid">
				<div class="flex items-center justify-between border-b border-line px-2.5 py-1 text-[11px] text-muted">
					<span>{s.lang || 'code'}</span>
					<button
						class="h-6 cursor-pointer rounded-md border-0 bg-transparent px-2 text-[11px] text-muted hover:text-fg"
						onclick={() => copy(s.code, i)}>{copiedIdx === i ? 'Скопировано' : 'Copy'}</button
					>
				</div>
				<pre class="m-0 overflow-x-auto p-2.5 font-mono text-[0.9em] leading-[1.5] text-fg">{s.code}</pre>
			</div>
		{/if}
	{/each}
	{#if streaming}<span class="caret">▍</span>{/if}
</div>
