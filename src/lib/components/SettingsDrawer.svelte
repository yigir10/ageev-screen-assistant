<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
	import {
		addPreset,
		checkProxy,
		clearMarks,
		clearPinnedRegion,
		loadModels,
		quitApp,
		removePreset,
		resetPresets,
		testKey,
		toast
	} from '$lib/actions';
	import { PRESETS, motion, settings, ui, type HotkeyName, type Provider } from '$lib/state.svelte';
	import HotkeyField from './HotkeyField.svelte';
	import Toggle from './Toggle.svelte';

	const providers: [Provider, string][] = [
		['gemini', 'Google AI'],
		['openrouter', 'OpenRouter'],
		['local', 'Local']
	];
	const hotkeyNames: HotkeyName[] = ['full', 'snip', 'toggle', 'visibility', 'marks', 'cancel', 'preset', 'chessBoard', 'chessMove'];

	let showKey = $state(false);
	let busyKey = $state(false);
	let busyModels = $state(false);
	let autostart = $state(false);

	const modelOptions = $derived([...new Set([...PRESETS[settings.provider], ...ui.models[settings.provider]])]);

	onMount(() => {
		void isEnabled()
			.then((v) => (autostart = v))
			.catch(() => {});
	});

	async function onAutostartChange(want: boolean) {
		try {
			if (want) await enable();
			else await disable();
		} catch (e) {
			autostart = !want;
			toast(`Автозапуск: ${e}`, 'error');
		}
	}

	async function checkKey() {
		busyKey = true;
		await testKey();
		busyKey = false;
	}

	async function fetchModels() {
		busyModels = true;
		await loadModels();
		busyModels = false;
	}

	const field =
		'h-[34px] w-full rounded-ctl border border-line bg-surface px-2.5 text-[13px] text-fg outline-none focus:border-accent';
	const label = 'text-[11px] font-semibold tracking-wider text-muted uppercase';
	const summary = 'cursor-pointer list-none py-2 text-[11px] font-semibold tracking-wider text-muted uppercase';
</script>

<aside
	data-hit-area
	transition:fly={{ x: 360, duration: motion(180) }}
	aria-label="Настройки"
	class="fixed top-4 right-4 bottom-4 z-40 flex w-[360px] flex-col overflow-hidden rounded-panel border border-accent bg-hud text-[13px] shadow-2xl"
>
	<div class="flex items-center justify-between border-b border-line px-3.5 py-3">
		<span class="text-sm font-semibold">Настройки</span>
		<button
			type="button"
			aria-label="Закрыть"
			onclick={() => (ui.settingsOpen = false)}
			class="h-[30px] w-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-fg">✕</button
		>
	</div>

	<div class="flex-1 space-y-1 overflow-y-auto px-3.5 py-2 select-text">
		<details open>
			<summary class={summary}>Провайдер</summary>
			<div class="flex flex-col gap-2 pb-3">
				<div class="flex gap-[3px] rounded-ctl bg-surface p-[3px]" role="group" aria-label="Провайдер">
					{#each providers as [id, title] (id)}
						<button
							type="button"
							aria-pressed={settings.provider === id}
							onclick={() => (settings.provider = id)}
							class="h-[30px] flex-1 cursor-pointer rounded-md border-0 text-xs {settings.provider === id
								? 'bg-accent font-semibold text-hud-solid'
								: 'bg-transparent text-muted'}"
						>{title}</button>
					{/each}
				</div>

				<div class="flex gap-1.5">
					<input
						class={field}
						aria-label="API-ключ"
						type={showKey ? 'text' : 'password'}
						autocomplete="off"
						placeholder={settings.provider === 'local' ? 'API-ключ (необязательно)' : 'API-ключ'}
						bind:value={settings.apiKeys[settings.provider]}
					/>
					<button
						type="button"
						onclick={() => (showKey = !showKey)}
						class="h-[34px] flex-none cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-xs text-fg"
					>{showKey ? 'Скрыть' : 'Показать'}</button>
				</div>

				<button
					type="button"
					onclick={checkKey}
					disabled={busyKey}
					class="h-[34px] cursor-pointer rounded-ctl border border-accent bg-transparent text-xs text-accent disabled:opacity-50"
				>
					{busyKey ? 'Проверяю…' : 'Проверить ключ и соединение'}
				</button>

				{#if settings.provider === 'local'}
					<input class={field} aria-label="Base URL" placeholder="http://127.0.0.1:8080/v1" bind:value={settings.localBaseUrl} />
				{/if}
			</div>
		</details>

		<details open>
			<summary class={summary}>Модель</summary>
			<div class="flex flex-col gap-2 pb-3">
				<input
					class="{field} font-mono text-xs"
					aria-label="ID модели"
					list="model-options"
					placeholder="Выберите или введите ID вручную"
					bind:value={settings.models[settings.provider]}
				/>
				<datalist id="model-options">
					{#each modelOptions as m (m)}<option value={m}></option>{/each}
				</datalist>
				<button
					type="button"
					onclick={fetchModels}
					disabled={busyModels}
					class="h-[34px] cursor-pointer rounded-ctl border border-accent bg-transparent text-xs text-accent disabled:opacity-50"
				>
					{busyModels ? 'Загрузка…' : 'Загрузить список по API'}
				</button>
			</div>
		</details>

		<details>
			<summary class={summary}>Прокси</summary>
			<div class="flex flex-col gap-2 pb-3">
				<div class="flex items-center justify-between"><span>Использовать прокси</span><Toggle label="Прокси" bind:checked={settings.proxyEnabled} /></div>
				<div class="flex gap-1.5">
					<input class={field} aria-label="URL прокси" placeholder="socks5://127.0.0.1:1080" bind:value={settings.proxyUrl} />
					<button type="button" onclick={checkProxy} class="h-[34px] flex-none cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-xs text-fg">Проверить</button>
				</div>
				<span class="text-[11px] text-muted">http://, https://, socks5://. Local LLM всегда идёт напрямую.</span>
			</div>
		</details>

		<details open>
			<summary class={summary}>Хоткеи</summary>
			<div class="flex flex-col gap-2 pb-3">
				{#each hotkeyNames as n (n)}<HotkeyField name={n} />{/each}
			</div>
		</details>

		<details open>
			<summary class={summary}>Захват и Stealth</summary>
			<div class="flex flex-col gap-2 pb-3">
				<div class="flex items-center justify-between">
					<span>Скрывать от записи экрана</span>
					<Toggle label="Stealth" bind:checked={settings.stealth} />
				</div>
				{#if settings.pinnedRegion}
					<button
						type="button"
						onclick={clearPinnedRegion}
						class="h-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-xs text-fg"
					>
						Сбросить область ({Math.round(settings.pinnedRegion.w)}×{Math.round(settings.pinnedRegion.h)}) на весь экран
					</button>
				{/if}
			</div>
		</details>

		<details>
			<summary class={summary}>Разметка на экране</summary>
			<div class="flex flex-col gap-3 pb-3">
				<div class="flex items-center justify-between"><span>Модель может рисовать метки</span><Toggle label="Разметка" bind:checked={settings.marksEnabled} /></div>
				<label class="flex flex-col gap-1">
					<span>Исчезают через: {settings.marksTtl === 0 ? 'только вручную' : `${settings.marksTtl} с`}</span>
					<input type="range" min="0" max="120" step="5" bind:value={settings.marksTtl} class="accent-accent" />
				</label>
				<div class="flex items-center justify-between"><span>Сетка на скриншоте (точнее)</span><Toggle label="Сетка" bind:checked={settings.marksGrid} /></div>
				<button type="button" onclick={clearMarks} class="h-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-xs text-fg">Очистить сейчас</button>
			</div>
		</details>

		<details>
			<summary class={summary}>Пресеты запросов</summary>
			<div class="flex flex-col gap-2.5 pb-3">
				<span class="text-[11px] text-muted">Активный пресет (●) используется при каждом скрине. В чате двойной клик по пресету сразу переспрашивает по текущему скриншоту.</span>
				{#each settings.presets as p (p.id)}
					<div class="flex flex-col gap-1.5 rounded-ctl border p-2 {settings.activePreset === p.id ? 'border-accent' : 'border-line'}">
						<div class="flex gap-1.5">
							<input class={field} aria-label="Название пресета" bind:value={p.name} />
							<button type="button" aria-label="Сделать активным" onclick={() => (settings.activePreset = p.id)} class="h-[34px] w-9 flex-none cursor-pointer rounded-ctl border border-line bg-surface text-fg">{settings.activePreset === p.id ? '●' : '○'}</button>
							<button type="button" aria-label="Удалить пресет" disabled={settings.presets.length <= 1} onclick={() => removePreset(p.id)} class="h-[34px] w-9 flex-none cursor-pointer rounded-ctl border border-line bg-surface text-fg disabled:opacity-40">✕</button>
						</div>
						<textarea class="{field} h-16 resize-none py-2" aria-label="Текст пресета" bind:value={p.prompt}></textarea>
					</div>
				{/each}
				<button type="button" onclick={addPreset} class="h-[30px] cursor-pointer rounded-ctl border border-accent bg-transparent text-xs text-accent">+ Добавить пресет</button>
				<button type="button" onclick={resetPresets} class="h-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-xs text-muted">Сбросить к стандартным</button>
			</div>
		</details>

		<details>
			<summary class={summary}>Промпты</summary>
			<div class="flex flex-col gap-2 pb-3">
				<span class={label}>System prompt</span>
				<textarea class="{field} h-20 resize-none py-2" aria-label="System prompt" bind:value={settings.systemPrompt}></textarea>
			</div>
		</details>

		<details>
			<summary class={summary}>Система</summary>
			<div class="flex flex-col gap-2 pb-3">
				<div class="flex items-center justify-between">
					<span>Запускать с Windows</span>
					<Toggle label="Автозапуск" bind:checked={autostart} onchange={onAutostartChange} />
				</div>
				<button type="button" onclick={quitApp} class="h-[30px] cursor-pointer rounded-ctl border border-danger bg-transparent text-xs text-danger">Выйти из приложения</button>
				<span class="text-[11px] text-muted">API-ключи хранятся в Windows Credential Manager.</span>
			</div>
		</details>

		<details>
			<summary class={summary}>Вид</summary>
			<div class="flex flex-col gap-3 pb-3">
				<label class="flex flex-col gap-1"><span>Прозрачность: {settings.opacity}%</span><input type="range" min="40" max="100" bind:value={settings.opacity} class="accent-accent" /></label>
				<label class="flex flex-col gap-1"><span>Шрифт: {settings.fontSize}px</span><input type="range" min="12" max="18" bind:value={settings.fontSize} class="accent-accent" /></label>
				<label class="flex flex-col gap-1"><span>Ширина панели: {settings.panelWidth}px</span><input type="range" min="320" max="720" step="10" bind:value={settings.panelWidth} class="accent-accent" /></label>
				<button type="button" onclick={() => (settings.panelPos = null)} class="h-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-xs text-fg">Вернуть панель в угол</button>
			</div>
		</details>
	</div>
</aside>
