<script lang="ts">
	import { fly } from 'svelte/transition';
	import { analyzeChess, clearChessArrows, startBoardCalibration, toast } from '$lib/actions';
	import { motion, settings, ui } from '$lib/state.svelte';
	import Kbd from './Kbd.svelte';
	import Toggle from './Toggle.svelte';

	const field =
		'h-[34px] w-full rounded-ctl border border-line bg-surface px-2.5 text-[13px] text-fg outline-none focus:border-accent';

	function onAutoChange(enabled: boolean) {
		if (enabled && !settings.chessBoard) {
			settings.chessAuto = false;
			toast('Сначала откалибруйте доску', 'error');
			return;
		}
		toast(enabled ? 'Авто-ход включён: слежу за доской' : 'Авто-ход выключен', 'info');
	}
</script>

<aside
	data-hit-area
	transition:fly={{ x: 360, duration: motion(180) }}
	aria-label="Шахматы (Stockfish 19)"
	class="fixed top-4 right-4 bottom-4 z-40 flex w-[360px] flex-col overflow-hidden rounded-panel border border-accent bg-hud text-[13px] shadow-2xl"
>
	<div class="flex items-center justify-between border-b border-line px-3.5 py-3">
		<span class="text-sm font-semibold">♟ Шахматы · Stockfish 19</span>
		<button
			type="button"
			aria-label="Закрыть"
			onclick={() => (ui.chessOpen = false)}
			class="h-[30px] w-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-fg">✕</button
		>
	</div>

	<div class="flex flex-1 flex-col gap-3.5 overflow-y-auto p-3.5 select-text">
		<div class="flex items-center justify-between gap-2 rounded-ctl border border-line bg-surface p-2.5">
			<div class="flex flex-col">
				<span class="text-xs text-muted">Область доски</span>
				<span class="font-mono text-xs text-fg">
					{settings.chessBoard
						? `${Math.round(settings.chessBoard.w)}×${Math.round(settings.chessBoard.h)} px`
						: 'Не откалибрована'}
				</span>
			</div>
			<button
				type="button"
				onclick={startBoardCalibration}
				class="h-8 cursor-pointer rounded-ctl border border-warn bg-warn/15 px-2.5 text-xs font-medium text-warn hover:bg-warn/25"
			>
				Калибровать
			</button>
		</div>

		<div class="flex flex-col gap-1.5 rounded-ctl border p-2.5 {settings.chessAuto ? 'border-accent bg-accent/10' : 'border-line bg-surface'}">
			<div class="flex items-center justify-between gap-2">
				<div class="flex flex-col">
					<span class="font-medium text-fg">Авто-ход</span>
					<span class="text-[11px] text-muted">Обновлять стрелку после хода на доске</span>
				</div>
				<Toggle label="Авто-ход" bind:checked={settings.chessAuto} onchange={onAutoChange} />
			</div>
			{#if settings.chessAuto && !settings.stealth}
				<span class="text-[11px] text-warn">
					Совет: включите Stealth в ⚙, чтобы стрелки не попадали в захват доски.
				</span>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-2">
			<label class="flex flex-col gap-1">
				<span class="text-[11px] text-muted">Снизу играют</span>
				<select
					bind:value={settings.chessBottom}
					onchange={() => (settings.chessTurn = settings.chessBottom === 'white' ? 'w' : 'b')}
					class={field}
				>
					<option value="white">Белые</option>
					<option value="black">Чёрные</option>
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-[11px] text-muted">Чей сейчас ход</span>
				<select bind:value={settings.chessTurn} class={field}>
					<option value="w">Ход белых (w)</option>
					<option value="b">Ход чёрных (b)</option>
				</select>
			</label>
		</div>

		<div class="grid grid-cols-2 gap-2">
			<button
				type="button"
				onclick={() => analyzeChess(false)}
				class="h-9 cursor-pointer rounded-ctl border-0 bg-accent px-3 text-xs font-semibold text-hud-solid"
			>
				Стрелка SF19
			</button>
			<button
				type="button"
				onclick={() => {
					ui.chessOpen = false;
					void analyzeChess(true);
				}}
				class="h-9 cursor-pointer rounded-ctl border border-accent bg-transparent px-3 text-xs font-medium text-accent hover:bg-accent/10"
			>
				Стрелка + Объяснить
			</button>
		</div>

		{#if ui.chessArrows}
			<div class="flex flex-col gap-1.5 rounded-ctl border border-accent/40 bg-surface p-2.5 text-xs">
				<div class="flex items-center justify-between">
					<span class="font-mono font-semibold text-accent">
						{ui.chessArrows.best} ({ui.chessArrows.evalText})
					</span>
					<button
						type="button"
						onclick={clearChessArrows}
						class="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-muted underline hover:text-fg"
					>
						Убрать стрелки
					</button>
				</div>
				{#if ui.chessArrows.second}
					<span class="text-[11px] text-muted">Альтернатива: <span class="font-mono text-fg">{ui.chessArrows.second}</span></span>
				{/if}
				<span class="truncate font-mono text-[10px] text-muted" title={ui.chessArrows.fen}>
					FEN: {ui.chessArrows.fen}
				</span>
			</div>
		{/if}

		<div class="flex flex-col gap-2 border-t border-line pt-3">
			<span class="text-[11px] font-semibold tracking-wider text-muted uppercase">Настройки Stockfish 19</span>
			<label class="flex flex-col gap-1">
				<span class="text-[11px] text-muted">Путь к stockfish.exe</span>
				<input class="{field} font-mono text-xs" bind:value={settings.stockfishPath} placeholder="D:\musor\stealth-hud\src-tauri\bin\stockfish.exe" />
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-[11px] text-muted">Время расчёта: {settings.stockfishMovetime} мс</span>
				<input type="range" min="100" max="1500" step="50" bind:value={settings.stockfishMovetime} class="accent-accent" />
			</label>
		</div>

		<div class="flex flex-col gap-1.5 border-t border-line pt-3 text-xs text-muted">
			<div class="flex items-center justify-between">
				<span>Калибровать доску</span>
				<Kbd accel={settings.hotkeys.chessBoard} />
			</div>
			<div class="flex items-center justify-between">
				<span>Показать стрелку хода</span>
				<Kbd accel={settings.hotkeys.chessMove} />
			</div>
			<div class="flex items-center justify-between">
				<span>Очистить стрелки</span>
				<Kbd accel={settings.hotkeys.marks} />
			</div>
		</div>
	</div>
</aside>
