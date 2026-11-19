<script lang="ts">
	import { fly } from 'svelte/transition';
	import { finishOnboarding, loadModels, testKey } from '$lib/actions';
	import { HOTKEY_LABELS, PRESETS, motion, settings, ui, type HotkeyName, type Provider } from '$lib/state.svelte';
	import Kbd from './Kbd.svelte';

	let step = $state(0);
	let busy = $state(false);
	let busyModels = $state(false);

	const providers: { id: Provider; title: string; hint: string }[] = [
		{ id: 'gemini', title: 'Google AI Studio', hint: 'Бесплатный ключ на aistudio.google.com/apikey. Из России нужен прокси или VPN.' },
		{ id: 'openrouter', title: 'OpenRouter', hint: 'Один ключ, много моделей, есть бесплатные. Обычно работает без прокси.' },
		{ id: 'local', title: 'Локальная модель', hint: 'Своя модель через llama-server. Ключ не нужен.' }
	];
	const names: HotkeyName[] = ['full', 'snip', 'toggle', 'visibility', 'marks', 'cancel', 'preset'];
	const modelOptions = $derived([...new Set([...PRESETS[settings.provider], ...ui.models[settings.provider]])]);

	async function check() {
		busy = true;
		await testKey();
		busy = false;
	}

	async function fetchModels() {
		busyModels = true;
		await loadModels();
		busyModels = false;
	}

	const field =
		'h-[34px] w-full rounded-ctl border border-line bg-surface px-2.5 text-[13px] text-fg outline-none focus:border-accent';
	const primary = 'h-9 cursor-pointer rounded-ctl border-0 bg-accent px-4 text-[13px] font-semibold text-hud-solid';
	const ghost = 'h-9 cursor-pointer rounded-ctl border border-line bg-surface px-4 text-[13px] text-fg';
</script>

<div class="pointer-events-none fixed inset-0 z-50 grid place-items-center">
	<div
		data-hit-area
		in:fly={{ y: 4, duration: motion() }}
		role="dialog"
		aria-label="Первый запуск"
		class="pointer-events-auto flex w-[480px] max-w-[92vw] flex-col gap-4 rounded-panel border border-accent bg-hud p-5 text-[13px] shadow-2xl"
	>
		<div class="flex items-center justify-between">
			<span class="text-base font-semibold">Stealth HUD · настройка {step + 1}/3</span>
			<button type="button" onclick={finishOnboarding} class="cursor-pointer border-0 bg-transparent text-xs text-muted hover:text-fg">Пропустить</button>
		</div>

		{#if step === 0}
			<p class="m-0 text-muted">Выберите, какая модель будет отвечать по вашим скриншотам.</p>
			<div class="flex flex-col gap-2">
				{#each providers as p (p.id)}
					<button
						type="button"
						aria-pressed={settings.provider === p.id}
						onclick={() => (settings.provider = p.id)}
						class="cursor-pointer rounded-ctl border bg-surface p-3 text-left text-fg {settings.provider === p.id ? 'border-accent' : 'border-line'}"
					>
						<div class="font-semibold">{p.title}</div>
						<div class="text-xs text-muted">{p.hint}</div>
					</button>
				{/each}
			</div>
			<div class="flex justify-end"><button type="button" class={primary} onclick={() => (step = 1)}>Далее</button></div>
		{:else if step === 1}
			{#if settings.provider === 'local'}
				<p class="m-0 text-muted">Адрес вашего локального сервера (OpenAI-совместимого).</p>
				<input class={field} aria-label="Base URL" bind:value={settings.localBaseUrl} />
			{:else}
				<p class="m-0 text-muted">Вставьте API-ключ. Он хранится в Windows Credential Manager.</p>
				<input
					class={field}
					aria-label="API-ключ"
					type="password"
					autocomplete="off"
					placeholder="API-ключ"
					bind:value={settings.apiKeys[settings.provider]}
				/>
			{/if}

			<div class="flex gap-1.5">
				<input
					class="{field} font-mono text-xs"
					aria-label="Модель"
					list="onboard-models"
					placeholder="ID модели"
					bind:value={settings.models[settings.provider]}
				/>
				<datalist id="onboard-models">
					{#each modelOptions as m (m)}<option value={m}></option>{/each}
				</datalist>
				<button
					type="button"
					onclick={fetchModels}
					disabled={busyModels}
					class="h-[34px] flex-none cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-xs text-fg disabled:opacity-50"
				>
					{busyModels ? '…' : 'Список'}
				</button>
			</div>

			{#if settings.provider !== 'local'}
				<label class="flex items-center gap-2 text-muted">
					<input type="checkbox" bind:checked={settings.proxyEnabled} class="accent-accent" /> Нужен прокси (например, из России для Gemini)
				</label>
				{#if settings.proxyEnabled}
					<input class={field} aria-label="URL прокси" placeholder="socks5://127.0.0.1:1080" bind:value={settings.proxyUrl} />
				{/if}
			{/if}

			<div class="flex justify-between gap-2">
				<button type="button" class={ghost} onclick={() => (step = 0)}>Назад</button>
				<div class="flex gap-2">
					<button type="button" class={ghost} onclick={check} disabled={busy}>{busy ? 'Проверяю…' : 'Проверить'}</button>
					<button type="button" class={primary} onclick={() => (step = 2)}>Далее</button>
				</div>
			</div>
		{:else}
			<p class="m-0 text-muted">Горячие клавиши работают в любом окне. Их можно поменять в ⚙ → Хоткеи.</p>
			<div class="flex flex-col gap-1.5">
				{#each names as n (n)}
					<div class="flex items-center justify-between"><span>{HOTKEY_LABELS[n]}</span><Kbd accel={settings.hotkeys[n]} /></div>
				{/each}
			</div>
			<p class="m-0 text-xs text-muted">В Interactive Mode экран вокруг панели остаётся кликабельным. Esc возвращает в Ghost Mode.</p>
			<div class="flex justify-between">
				<button type="button" class={ghost} onclick={() => (step = 1)}>Назад</button>
				<button type="button" class={primary} onclick={finishOnboarding}>Готово</button>
			</div>
		{/if}
	</div>
</div>
