// Мини-рендер markdown: кодовые блоки отдельными сегментами (для кнопки Copy), остальное — безопасный HTML.

export type Seg = { t: 'code'; lang: string; code: string } | { t: 'html'; html: string };

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(src: string): string {
	let s = esc(src);
	s = s.replace(/`([^`\n]+)`/g, '<code class="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em] text-accent">$1</code>');
	s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold">$1</strong>');
	s = s.replace(/^#{1,6}\s+(.*)$/gm, '<strong class="font-semibold">$1</strong>');
	s = s.replace(/^\s*[-*]\s+/gm, '• ');
	return s
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => `<p class="my-1.5">${p.replace(/\n/g, '<br>')}</p>`)
		.join('');
}

export function parseMarkdown(src: string): Seg[] {
	const segs: Seg[] = [];
	const re = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g; // незакрытый блок во время стрима тоже считается кодом
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(src))) {
		if (m.index > last) segs.push({ t: 'html', html: inline(src.slice(last, m.index)) });
		segs.push({ t: 'code', lang: m[1], code: m[2].replace(/\n$/, '') });
		last = re.lastIndex;
	}
	if (last < src.length) segs.push({ t: 'html', html: inline(src.slice(last)) });
	return segs;
}
