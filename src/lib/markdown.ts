import katex from 'katex';

export type Seg = { t: 'code'; lang: string; code: string } | { t: 'html'; html: string };

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMath(math: string, displayMode: boolean): string {
	try {
		return katex.renderToString(math.trim(), { displayMode, throwOnError: false });
	} catch {
		return esc(math);
	}
}

function inline(src: string): string {
	const tokens: string[] = [];
	const stash = (html: string) => {
		const idx = tokens.push(html) - 1;
		return `\x00TOK${idx}\x00`;
	};

	let s = src;
	// 1. Инлайн-код
	s = s.replace(/`([^`\n]+)`/g, (_, code) =>
		stash(`<code class="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em] text-accent">${esc(code)}</code>`)
	);
	// 2. Блочные формулы $$...$$
	s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => stash(renderMath(math, true)));
	// 3. Инлайн-формулы $...$
	s = s.replace(/(?<!\\)\$([^\n$]+?)\$/g, (_, math) => stash(renderMath(math, false)));

	s = esc(s);
	s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold">$1</strong>');
	s = s.replace(/^#{1,6}\s+(.*)$/gm, '<strong class="font-semibold">$1</strong>');
	s = s.replace(/^\s*[-*]\s+/gm, '• ');

	let html = s
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => `<p class="my-1.5">${p.replace(/\n/g, '<br>')}</p>`)
		.join('');

	return html.replace(/\x00TOK(\d+)\x00/g, (_, i) => tokens[Number(i)] ?? '');
}

export function parseMarkdown(src: string): Seg[] {
	const segs: Seg[] = [];
	const re = /\`\`\`([\w+-]*)\n?([\s\S]*?)(\`\`\`|$)/g;
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
