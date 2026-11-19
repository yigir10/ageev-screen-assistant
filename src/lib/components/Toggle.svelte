<script lang="ts">
	let { checked = $bindable(false), label }: { checked?: boolean; label: string } = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	onclick={() => (checked = !checked)}
	class="relative h-[18px] w-[34px] flex-none cursor-pointer rounded-full border border-line p-0 transition-colors {checked ? 'bg-accent' : 'bg-surface'}"
>
	<span
		class="absolute top-[2px] h-3 w-3 rounded-full transition-all {checked ? 'left-[18px] bg-hud-solid' : 'left-[2px] bg-muted'}"
	></span>
</button>
