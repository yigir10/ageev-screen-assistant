// Разметка на экране: модель в конце ответа присылает блок ```marks {...}```,
// мы вырезаем его из текста и рисуем метки SVG-слоем поверх экрана.

export type MarkType = 'point' | 'box' | 'arrow' | 'text';

export interface Mark {
	type: MarkType;
	x: number; // 0..1000, относительно изображения, которое видела модель
	y: number;
	x2?: number;
	y2?: number;
	label?: string;
}

export const MARKS_PROMPT = `

Если полезно показать конкретное место на скриншоте, в самом конце ответа добавь блок:
\`\`\`marks
{"marks":[{"type":"arrow","x":100,"y":200,"x2":400,"y2":300,"label":"короткая подпись"}]}
\`\`\`
Координаты нормализованы от 0 до 1000 относительно изображения (x вправо, y вниз, начало в левом верхнем углу).
Типы: point (x,y); box (x,y — левый верхний угол, x2,y2 — правый нижний); arrow (из x,y в x2,y2); text (подпись в x,y).
Не больше 8 меток, подписи до 40 символов. Если показывать нечего — блок не добавляй.`;

export const GRID_PROMPT = `

На изображении нанесена жёлтая сетка. Подписи на верхнем и левом краях — координаты в тысячных (100, 200 … 900). Используй её, чтобы указывать координаты меток точно.`;

const TYPES = new Set<MarkType>(['point', 'box', 'arrow', 'text']);
const clamp = (n: number) => Math.min(1000, Math.max(0, n));
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? clamp(v) : undefined);

/** Текст ответа без блока разметки (в том числе незакрытого, пока идёт стрим). */
export function stripMarks(text: string): string {
	return text.replace(/```marks[\s\S]*?```/g, '').replace(/```marks[\s\S]*$/, '').trim();
}

export function extractMarks(text: string): Mark[] {
	const m = /```marks\s*([\s\S]*?)```/.exec(text);
	if (!m) return [];
	try {
		const data = JSON.parse(m[1]);
		const arr: unknown[] = Array.isArray(data) ? data : (data?.marks ?? []);
		const out: Mark[] = [];
		for (const raw of arr.slice(0, 8)) {
			const r = raw as Record<string, unknown>;
			const type = r.type as MarkType;
			const x = num(r.x);
			const y = num(r.y);
			if (!TYPES.has(type) || x === undefined || y === undefined) continue;
			const x2 = num(r.x2);
			const y2 = num(r.y2);
			if ((type === 'box' || type === 'arrow') && (x2 === undefined || y2 === undefined)) continue;
			out.push({ type, x, y, x2, y2, label: typeof r.label === 'string' ? r.label.slice(0, 40) : undefined });
		}
		return out;
	} catch {
		return [];
	}
}
