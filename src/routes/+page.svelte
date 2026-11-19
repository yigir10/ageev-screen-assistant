<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import * as A from '$lib/actions';
	import { settings, ui } from '$lib/state.svelte';
	import HistoryDrawer from '$lib/components/HistoryDrawer.svelte';
	import MarksLayer from '$lib/components/MarksLayer.svelte';
	import Onboarding from '$lib/components/Onboarding.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import SettingsDrawer from '$lib/components/SettingsDrawer.svelte';
	import SnipOverlay from '$lib/components/SnipOverlay.svelte';
	import Status from '$lib/components/Status.svelte';
	import Toasts from '$lib/components/Toasts.svelte';

	onMount(() => {
		let unlisten: (() => void)[] = [];
		void (async () => {
			await A.loadSecrets();
			unlisten = await A.initEvents();
			// первый запуск — сразу Interactive с мастером настройки; дальше старт в Ghost Mode
			await A.setMode(settings.onboarded ? 'ghost' : 'interactive');
		})();
		return () => unlisten.forEach((f) => f());
	});

	// Переназначение хоткеев: пока идёт запись комбинации, глобальные бинды сняты
	$effect(() => {
		const keys = $state.snapshot(settings.hotkeys);
		const recording = ui.recording;
		void keys;
		untrack(() => {
			if (recording) void A.releaseHotkeys();
			else void A.applyHotkeys();
		});
	});

	// Сохранение API-ключей в Credential Manager при изменении
	$effect(() => {
		const keys = { ...settings.apiKeys };
		untrack(() => {
			if (!ui.secretsOk) return;
			for (const p of ['gemini', 'openrouter', 'local'] as const) void A.saveSecret(p, keys[p]);
		});
	});

	// Stealth применяется при старте и при каждом переключении
	$effect(() => {
		void settings.stealth;
		untrack(() => void A.applyStealth());
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (ui.mode === 'snipping') void A.cancelSnip();
		else if (ui.settingsOpen) ui.settingsOpen = false;
		else if (ui.historyOpen) ui.historyOpen = false;
	}
</script>

<svelte:window {onkeydown} />

<!-- invisible: «Скрыть оверлей» и временное скрытие на время захвата (если Stealth выключен) -->
<div class="fixed inset-0 overflow-hidden" class:invisible={ui.hidden || ui.capturing}>
	<Status />
	{#if ui.mode === 'snipping'}
		<SnipOverlay ondone={A.captureRegion} oncancel={A.cancelSnip} />
	{:else}
		{#if ui.marks.length}<MarksLayer />{/if}
		<Panel />
		{#if ui.mode === 'interactive' && ui.settingsOpen}
			<SettingsDrawer />
			{/if}
			{#if ui.mode === 'interactive' && ui.historyOpen}
				<HistoryDrawer />
			{/if}
			{#if ui.mode === 'interactive' && !settings.onboarded}
				<Onboarding />
			{/if}
	{/if}
</div>

<Toasts />
