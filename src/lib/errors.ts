// Человеческие тексты вместо сырых «HTTP 403: {json}».
import type { Provider } from './state.svelte';

export function friendlyError(raw: string, provider: Provider, proxyOn: boolean): string {
	const r = raw.toLowerCase();
	const proxyHint = proxyOn ? ' Проверьте, что прокси работает (⚙ → Прокси → Проверить).' : ' Включите прокси или VPN (⚙ → Прокси) либо выберите OpenRouter.';

	if (r.includes('location is not supported') || r.includes('user location')) {
		return `Gemini недоступен в вашем регионе.${proxyHint}`;
	}
	if (r.includes('api key not valid') || r.includes('api_key_invalid') || r.includes('http 401') || r.includes('invalid api key') || r.includes('no auth')) {
		return 'Неверный API-ключ. Создайте новый и вставьте заново (⚙ → Провайдер).';
	}
	if (r.includes('http 403')) {
		return provider === 'gemini'
			? `Gemini отклонил запрос (403): либо неверный ключ, либо блокировка по региону.${proxyHint}`
			: 'Доступ запрещён (403): проверьте ключ и права на модель.';
	}
	if (r.includes('http 404')) return 'Модель не найдена. Выберите другую в ⚙ → Модель или загрузите список по API.';
	if (r.includes('http 429') || r.includes('quota') || r.includes('rate limit')) {
		return 'Лимит запросов исчерпан. Подождите минуту или выберите другую модель/провайдера.';
	}
	if (r.includes('http 400')) return `Запрос отклонён (400): возможно, модель не принимает изображения. ${raw.slice(0, 160)}`;
	if (/http 5\d\d/.test(r)) return 'Сервер провайдера временно недоступен. Нажмите ↻ «Повторить» чуть позже.';
	if (r.startsWith('прокси')) return `${raw} Проверьте формат: http://host:port или socks5://host:port`;
	if (r.startsWith('сеть')) {
		return provider === 'local'
			? 'Локальный сервер не отвечает. Запущен ли llama-server и верен ли адрес (⚙ → Провайдер → Base URL)?'
			: `Нет связи с сервером.${proxyHint}`;
	}
	return raw;
}
