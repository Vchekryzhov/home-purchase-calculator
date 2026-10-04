export const plural = (count, one, few, many) => { const tens = count % 100, units = count % 10; return tens >= 11 && tens <= 14 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many; };
export const yearsLabel = (count) => `${count} ${plural(count, 'год', 'года', 'лет')}`;
export const monthsLabel = (count) => `${count} ${plural(count, 'месяц', 'месяца', 'месяцев')}`;
export const duration = (months) => { const total = Math.ceil(months); const years = Math.floor(total / 12); const rest = total % 12; return !years ? monthsLabel(rest) : rest ? `${yearsLabel(years)} ${monthsLabel(rest)}` : yearsLabel(years); };
export const addMonths = (date, months) => { const result = new Date(date); result.setMonth(result.getMonth() + months); return result; };
export const formatDate = (date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
