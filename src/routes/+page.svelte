<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
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

	function syncHitRects() {
		if (ui.mode !== 'interactive' || ui.hidden || ui.capturing) return;
		const dpr = window.devicePixelRatio || 1;
		const rects = Array.from(document.querySelectorAll<HTMLElement>('[data-hit-area]'))
			.map((el) => {
				const r = el.getBoundingClientRect();
				return {
					x: Math.round(r.left * dpr),
					y: Math.round(r.top * dpr),
					w: Math.round(r.width * dpr),
					h: Math.round(r.height * dpr)
				};
			})
			.filter((r) => r.w > 0 && r.h > 0);
		void invoke('set_hit_rects', { rects, forceCapture: ui.dragging }).catch(() => {});
	}

	onMount(() => {
		let unlisten: (() => void)[] = [];
		void (async () => {
			await A.loadSecrets();
			unlisten = await A.initEvents();
			await A.setMode(settings.onboarded ? 'ghost' : 'interactive');
			syncHitRects();
		})();

		const timer = setInterval(syncHitRects, 120);
		return () => {
			clearInterval(timer);
			unlisten.forEach((f) => f());
		};
	});

	$effect(() => {
		void ui.mode;
		void ui.settingsOpen;
		void ui.historyOpen;
		void ui.dragging;
		void settings.onboarded;
		void settings.panelPos;
		void settings.panelWidth;
		requestAnimationFrame(syncHitRects);
	});

	$effect(() => {
		const keys = $state.snapshot(settings.hotkeys);
		const recording = ui.recording;
		void keys;
		untrack(() => {
			if (recording) void A.releaseHotkeys();
			else void A.applyHotkeys();
		});
	});

	$effect(() => {
		const keys = { ...settings.apiKeys };
		untrack(() => {
			if (!ui.secretsOk) return;
			for (const p of ['gemini', 'openrouter', 'local'] as const) A.scheduleSaveSecret(p, keys[p]);
		});
	});

	$effect(() => {
		void settings.stealth;
		untrack(() => void A.applyStealth());
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (ui.mode === 'snipping') void A.cancelSnip();
		else if (ui.settingsOpen) ui.settingsOpen = false;
		else if (ui.historyOpen) ui.historyOpen = false;
		else if (ui.mode === 'interactive' && !ui.recording && settings.onboarded) void A.setMode('ghost');
	}
</script>

<svelte:window {onkeydown} />

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
