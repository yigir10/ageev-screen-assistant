export interface Mark {
	type: 'box' | 'arrow' | 'point' | 'text';
	x: number;
	y: number;
	x2?: number;
	y2?: number;
	label?: string;
}

export const MARKS_PROMPT = `
Если нужно указать конкретное место на скриншоте, добавь в самом конце ответа блок:
\`\`\`marks
[{"type":"arrow","x":200,"y":300,"x2":500,"y2":600,"label":"Сюда"}]
\`\`\`
Координаты от 0 до 1000 относительно скриншота. Типы: box (x,y,x2,y2), arrow (x,y,x2,y2), point (x,y), text (x,y,label).`;

export const GRID_PROMPT = `
На скриншоте нанесена жёлтая координатная сетка 100..900 — используй её для точных координат в блоке marks.`;

export function stripMarks(text: string): string {
	return text.replace(/\`\`\`marks[\s\S]*?(\`\`\`|$)/g, '').trimEnd();
}

export function extractMarks(text: string): Mark[] {
	const m = text.match(/\`\`\`marks\s*([\s\S]*?)\`\`\`/);
	if (!m) return [];
	try {
		const arr = JSON.parse(m[1].trim());
		if (!Array.isArray(arr)) return [];
		return arr.filter(
			(x): x is Mark =>
				x &&
				typeof x === 'object' &&
				['box', 'arrow', 'point', 'text'].includes(x.type) &&
				typeof x.x === 'number' &&
				typeof x.y === 'number'
		);
	} catch {
		return [];
	}
}
