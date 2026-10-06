<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { DEFAULTS, RENOVATION_COST_SHARE, calculate, buildCashflow } from './lib/model.js';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);
import { addMonths, formatDate, duration } from './lib/format.js';

const inputs = reactive({ ...DEFAULTS });
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const plainNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const formatAmount = (value) => plainNumber.format(Number(value) || 0);
const amountDrafts = reactive({ savings: '', monthlySavings: '', propertyPrice: '', rent: '' });
const focusedAmount = ref(null);
const repaymentMode = ref('fast');
const formatDraftAmount = (value) => String(value).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const amountValue = (key) => focusedAmount.value === key ? formatDraftAmount(amountDrafts[key]) : formatAmount(inputs[key]);
const focusAmount = (key) => { focusedAmount.value = key; amountDrafts[key] = String(inputs[key] ?? ''); };
const setAmount = (key, event) => {
  const cursorDigits = event.target.value.slice(0, event.target.selectionStart ?? 0).replace(/\D/g, '').length;
  const digits = event.target.value.replace(/\D/g, '');
  amountDrafts[key] = digits;
  inputs[key] = Number(digits) || 0;
  restoreAmountCursor(event, digits, cursorDigits);
};
const restoreAmountCursor = (event, digits, cursorDigits) => nextTick(() => {
  const formatted = formatDraftAmount(digits);
  let position = 0, seenDigits = 0;
  while (position < formatted.length && seenDigits < cursorDigits) { if (/\d/.test(formatted[position])) seenDigits += 1; position += 1; }
  event.target.setSelectionRange(position, position);
});
const blurAmount = (key) => { if (focusedAmount.value === key) focusedAmount.value = null; };
const renovationNeeded = ref(false);
const renovationMonths = ref(6);
const renovationCostDraft = ref(null);
const renovationFocused = ref(false);
const renovationCostInput = ref('');
const renovationAutoCost = computed(() => Math.round(Math.max(0, Number(inputs.propertyPrice) || 0) * RENOVATION_COST_SHARE));
const renovationCost = computed(() => renovationCostDraft.value ?? renovationAutoCost.value);
const renovationCostValue = () => renovationFocused.value ? formatDraftAmount(renovationCostInput.value) : formatAmount(renovationCost.value);
const focusRenovationCost = () => { renovationFocused.value = true; renovationCostInput.value = String(renovationCost.value ?? ''); };
const setRenovationCost = (event) => {
  const cursorDigits = event.target.value.slice(0, event.target.selectionStart ?? 0).replace(/\D/g, '').length;
  const digits = event.target.value.replace(/\D/g, '');
  renovationCostInput.value = digits;
  renovationCostDraft.value = digits === '' ? null : Number(digits) || 0;
  restoreAmountCursor(event, digits, cursorDigits);
};
const renovationOptions = computed(() => ({ needed: renovationNeeded.value, cost: renovationCost.value, months: renovationMonths.value }));
const renovationCostHint = computed(() => {
  const p = plan.value;
  if (!p) return null;
  const payment = `равными платежами по ${money.format(p.renovationMonthlyPayment)} в течение ${p.workMonths} мес.`;
  return p.dealMonth > 0
    ? `Стоимость ${money.format(renovationCost.value)} — сегодняшняя; она индексируется к дате сделки вместе с ценами на квартиры. До сделки ${duration(p.dealMonth)}, к этому моменту ремонт будет стоить ${money.format(p.renovationCostAtDeal)}: ${payment}.`
    : `Сделка проходит в текущем месяце — индексации нет, ремонт оплачивается по введённой стоимости ${money.format(p.renovationCostAtDeal)}: ${payment}.`;
});
const result = computed(() => calculate(inputs, repaymentMode.value, renovationOptions.value));
const plan = computed(() => result.value.selectedPlan);
const cashPlan = computed(() => result.value.plans.cash);
const invalidInput = computed(() => result.value.status === 'invalid-input');
const mortgageEmptyText = computed(() => invalidInput.value ? result.value.validationErrors.join(' ') : 'При этих параметрах выполнимый план покупки не найден в горизонте 30 лет.');
const referenceDate = ref(new Date());
watch(result, () => { referenceDate.value = new Date(); });
const CASHFLOW_SEGMENTS = [
  { key: 'principal', label: 'Тело кредита', color: '#0f766e', pick: (row) => row.principal },
  { key: 'interest', label: 'Проценты', color: '#fb7185', pick: (row) => row.interest },
  { key: 'renovation', label: 'Ремонт', color: '#f59e0b', pick: (row) => row.renovation },
  { key: 'savings', label: 'Накопления', color: '#14b8a6', pick: (row) => row.savings },
  { key: 'rent', label: 'Аренда', color: '#94a3b8', pick: (row) => row.rent }
];
const cashflow = computed(() => buildCashflow(result.value.selectedPlan));
const cashflowEl = ref(null);
const cashflowError = ref(false);
const cashflowBadges = ref([]);
const cashflowBadgeTip = ref(null);
const positionCashflowBadges = () => {
  const data = cashflow.value;
  if (!cashflowChart || !data || !cashflowEl.value) { cashflowBadges.value = []; return; }
  const option = cashflowChart.getOption();
  const zoom = option.dataZoom?.[0];
  const count = data.rows.length;
  const startIdx = Math.floor((zoom?.start ?? 0) / 100 * count);
  const endIdx = Math.ceil((zoom?.end ?? 100) / 100 * count);
  const width = cashflowEl.value.clientWidth;
  const badges = [];
  const push = (month, key, label) => {
    if (month <= 0 || month < startIdx || month > endIdx) return;
    const x = cashflowChart.convertToPixel({ xAxisIndex: 0 }, month);
    if (!Number.isFinite(x)) return;
    badges.push({ key, label, month, x: Math.max(60, Math.min(width - 30, x)) });
  };
  push(data.dealMonth, 'deal', 'Сделка');
  if (data.moveMonth > data.dealMonth) push(data.moveMonth, 'move', 'Переезд');
  cashflowBadges.value = badges;
};
const showBadgeTip = (badge, event) => {
  const container = event.currentTarget.closest('.cashflow-stage');
  const rect = container.getBoundingClientRect();
  let left = event.clientX - rect.left + 12, top = event.clientY - rect.top + 14;
  if (left > rect.width - 210) left -= 226;
  cashflowBadgeTip.value = { left: Math.max(4, left), top: Math.max(4, top), text: `${badge.label}: ${formatMonthYear(badge.month)}` };
};
let cashflowChart = null;
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const formatMonthYear = (month) => { const date = addMonths(referenceDate.value, month); return `${MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`; };
const buildCashflowOption = (data) => {
  const categories = data.rows.map((row) => { const date = addMonths(referenceDate.value, row.month); return `${MONTHS_SHORT[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`; });
  const series = CASHFLOW_SEGMENTS.map((segment) => ({
    name: segment.label,
    type: 'bar',
    stack: 'month',
    barMaxWidth: 34,
    itemStyle: { color: segment.color },
    data: data.rows.map((row) => Math.round(segment.pick(row)))
  }));
  const marks = [];
  if (data.dealMonth > 0) marks.push({ xAxis: data.dealMonth, label: { show: false }, lineStyle: { color: '#334155', type: 'dashed', width: 1.5 } });
  if (data.moveMonth > data.dealMonth) marks.push({ xAxis: data.moveMonth, label: { show: false }, lineStyle: { color: '#334155', type: 'dashed', width: 1.5 } });
  if (marks.length) series[0].markLine = { symbol: 'none', silent: true, animation: false, data: marks };
    return {
      animationDuration: 150,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(15, 23, 42, .06)' } },
      backgroundColor: '#0f172a',
      borderWidth: 0,
      padding: [10, 12],
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (points) => {
        const row = data.rows[points[0].dataIndex];
        const total = points.reduce((acc, point) => acc + (point.value ?? 0), 0);
        const line = (label, value) => `<div style="display:flex;justify-content:space-between;gap:18px"><span>${label}</span><b>${money.format(value)}</b></div>`;
        const rowsHtml = points.filter((point) => (point.value ?? 0) > 0).map((point) => line(`${point.marker}${point.seriesName}`, point.value)).join('') + line('<span style="color:#94a3b8">Остаток наличных</span>', row.closingCash) + line('<span style="color:#94a3b8">Доход вклада</span>', row.depositYield);
        return `<div style="min-width:210px"><div style="color:#94a3b8;font-size:11px;margin-bottom:4px">${formatMonthYear(row.month)}</div>${rowsHtml}<div style="display:flex;justify-content:space-between;gap:18px;border-top:1px solid rgba(255,255,255,.16);margin-top:6px;padding-top:5px"><span>Расходы и пополнение накоплений</span><b>${money.format(total)}</b></div></div>`;
      }
    },
    grid: { left: 64, right: 10, top: 34, bottom: 58 },
    xAxis: { type: 'category', data: categories, axisLine: { lineStyle: { color: '#dbe3e8' } }, axisTick: { show: false }, axisLabel: { color: '#64748b', fontSize: 11, hideOverlap: true } },
    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#64748b', fontSize: 11, formatter: (value) => plainNumber.format(value) }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
    dataZoom: [
      { type: 'inside', filterMode: 'none', start: 0, end: 100 },
      { type: 'slider', height: 20, bottom: 8, filterMode: 'none', start: 0, end: 100, borderColor: '#dbe3e8', fillerColor: 'rgba(15, 118, 110, .12)', handleStyle: { color: '#0f766e' }, moveHandleStyle: { color: '#cbd5e1' }, emphasis: { handleStyle: { borderColor: '#0f766e' } }, textStyle: { color: '#64748b', fontSize: 10 }, labelFormatter: (value) => categories[Math.round(value)] ?? '' }
    ],
    series
  };
};
let cashflowChartEl = null;
let cashflowObserver = null;
const renderCashflow = () => {
  if (!cashflowEl.value) {
    if (cashflowChart) { cashflowChart.dispose(); cashflowChart = null; }
    return;
  }
  try {
    if (cashflowChart && cashflowChartEl !== cashflowEl.value) { cashflowChart.dispose(); cashflowChart = null; }
    if (!cashflowChart) {
      cashflowChart = echarts.init(cashflowEl.value);
      cashflowChartEl = cashflowEl.value;
      cashflowObserver?.disconnect();
      cashflowObserver = new ResizeObserver(() => { cashflowChart?.resize(); positionCashflowBadges(); });
      cashflowObserver.observe(cashflowEl.value);
      cashflowChart.on('datazoom', positionCashflowBadges);
      cashflowChart.on('finished', positionCashflowBadges);
    }
    const data = cashflow.value;
    if (!data) { cashflowError.value = false; cashflowBadges.value = []; cashflowChart.clear(); return; }
    const sane = data.rows.length && data.rows.every((row) => [row.savings, row.rent, row.renovation, row.interest, row.principal].every((value) => Number.isFinite(value)));
    if (!sane) { cashflowError.value = true; cashflowBadges.value = []; cashflowChart.clear(); return; }
    cashflowError.value = false;
    cashflowChart.setOption(buildCashflowOption(data), { notMerge: true });
    positionCashflowBadges();
  } catch { cashflowError.value = true; try { cashflowChart?.clear(); } catch { /* dead instance */ } }
};
watch(cashflow, renderCashflow, { flush: 'post' });
onMounted(renderCashflow);
onBeforeUnmount(() => { cashflowObserver?.disconnect(); cashflowChart?.dispose(); cashflowChart = null; });
const reset = () => { Object.assign(inputs, DEFAULTS); focusedAmount.value = null; repaymentMode.value = 'fast'; renovationNeeded.value = false; renovationMonths.value = 6; renovationCostDraft.value = null; renovationCostInput.value = ''; renovationFocused.value = false; };
onMounted(() => { const context = document.modelContext; if (!context?.registerTool) return; context.registerTool({ name: 'configure_home_purchase_calculator', title: 'Рассчитать покупку недвижимости', description: 'Устанавливает параметры и возвращает выбранный план покупки по критерию.', inputSchema: { type: 'object', properties: { savings: { type: 'number', minimum: 0 }, monthlySavings: { type: 'number', minimum: 0 }, mortgageRate: { type: 'number', minimum: 0 }, propertyPrice: { type: 'number', minimum: 0 }, downPaymentPercent: { type: 'number', minimum: 0 }, inflation: { type: 'number', minimum: 0 }, rent: { type: 'number', minimum: 0 }, depositRate: { type: 'number', minimum: 0 }, salaryIndexPercent: { type: 'number', minimum: 0 } }, required: Object.keys(DEFAULTS), additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(next) { Object.assign(inputs, next); const r = result.value; const selected = r.selectedPlan; return { status: r.status, validationErrors: r.validationErrors, selectionStatus: r.selectionStatus, selectionReason: r.selectionReason, selectedPlan: selected && { kind: selected.kind, dealMonth: selected.dealMonth, moveMonth: selected.moveMonth, lastPaymentBoundaryMonth: selected.loan?.lastPaymentBoundaryMonth ?? null, savingsGoal: { minimumDownPayment: Math.round(selected.savingsGoal.minimumDownPayment), actualDownPayment: Math.round(selected.savingsGoal.actualDownPayment), renovationSavings: Math.round(selected.savingsGoal.renovationSavings), deficitReserve: Math.round(selected.savingsGoal.deficitReserve), totalRequiredSavings: Math.round(selected.savingsGoal.totalRequiredSavings), optionalSurplus: Math.round(selected.savingsGoal.optionalSurplus) }, loan: selected.loan && { principal: Math.round(selected.loan.principal), contractualAnnuity: Math.round(selected.loan.contractualAnnuity), repaymentMonths: selected.loan.repaymentMonths, totalInterest: Math.round(selected.loan.totalInterest) } } }; } }, { signal: new AbortController().signal }).catch(() => {}); });
</script>

<template>
  <main><header><div><div class="eyebrow">⌂ &nbsp; Покупка недвижимости</div><h1>Калькулятор покупки недвижимости</h1><p>Сравните ипотеку сейчас и накопление до полной стоимости квартиры с учётом роста цен и аренды.</p></div></header>
  <div class="layout"><section class="panel"><div class="panel-heading"><h2>Ваши параметры</h2><button class="reset-icon" type="button" @click="reset" aria-label="Сбросить пример" title="Сбросить пример">↻</button></div><div class="inputs"><label class="currency-field">Текущие накопления<input :value="amountValue('savings')" @focus="focusAmount('savings')" @input="setAmount('savings', $event)" @blur="blurAmount('savings')" type="text" inputmode="numeric"><span>₽</span></label><label class="currency-field">Накопления в месяц<input :value="amountValue('monthlySavings')" @focus="focusAmount('monthlySavings')" @input="setAmount('monthlySavings', $event)" @blur="blurAmount('monthlySavings')" type="text" inputmode="numeric"><span>₽</span></label><label><span class="field-title">Процент индексации зарплаты <span class="hint above-host" tabindex="0" aria-label="Исторические данные по росту зарплаты">?<span class="hint-popover above" role="tooltip">Историческая статистика средней начисленной заработной платы в России — это не прогноз и не гарантия роста личного дохода.<table><thead><tr><th>Год</th><th>Номинальный годовой рост</th><th>Реальный годовой рост</th></tr></thead><tbody><tr><td>2016</td><td>7,9%</td><td>0,8%</td></tr><tr><td>2017</td><td>6,7%</td><td>2,9%</td></tr><tr><td>2018</td><td>11,6%</td><td>8,5%</td></tr><tr><td>2019</td><td>9,5%</td><td>4,8%</td></tr><tr><td>2020</td><td>7,3%</td><td>3,8%</td></tr><tr><td>2021</td><td>11,5%</td><td>4,5%</td></tr><tr><td>2022</td><td>14,1%</td><td>0,3%</td></tr><tr><td>2023</td><td>14,6%</td><td>8,2%</td></tr><tr><td>2024</td><td>19,0%</td><td>9,7%</td></tr><tr><td>2025</td><td>14,3%</td><td>5,2%</td></tr></tbody></table><ul><li>Номинальный рост рассчитан из годовых номинальных уровней средней начисленной зарплаты: (уровень текущего года / уровень предыдущего года − 1) × 100%.</li><li>Реальный рост взят непосредственно из опубликованного Росстатом реального индекса: индекс в процентах к предыдущему году минус 100%.</li><li>Последние официальные значения за 2025 год: номинальный рост +14,3%, реальный рост +5,2%. Первоначальная оценка марта 2026 года (+13,5% / +4,4%) была пересмотрена и не должна использоваться как актуальная.</li><li>Значение 5% — начальная настройка сценария, а не гарантированный или «обычный» будущий рост.</li></ul><ul class="hint-links"><li><a href="https://rosstat.gov.ru/labor_market_employment_salaries" target="_blank" rel="noreferrer">Официальный раздел Росстата</a></li><li><a href="https://rosstat.gov.ru/storage/mediabank/tab1-zpl_07-2026.xlsx" target="_blank" rel="noreferrer">Первичная таблица номинальной зарплаты (обновлена 30.09.2026)</a></li><li><a href="https://rosstat.gov.ru/storage/mediabank/tab5-zpl-2025.xlsx" target="_blank" rel="noreferrer">Первичная таблица реальных индексов (обновлена 13.05.2026)</a></li></ul></span></span></span><b>% годовых</b><input v-model.number="inputs.salaryIndexPercent" type="number" min="0" step="0.1"></label><label><span class="field-title">Доходность накоплений <span class="hint" tabindex="0" aria-label="Подробнее о доходности накоплений">?<span class="hint-popover" role="tooltip">Годовая доходность накоплений до покупки. Начисляется ежемесячно и уменьшает необходимую сумму кредита. Это предположение, а не гарантированный доход.</span></span></span><b>% годовых</b><input v-model.number="inputs.depositRate" type="number" min="0" step="0.1"></label><label><span class="field-title">Коэффициент удорожания недвижимости <span class="hint" tabindex="0" aria-label="Исторические данные по росту цен на жильё">?<span class="hint-popover" role="tooltip">Используется для прогноза цены квартиры и первоначального взноса. Россия, 2020–2025: в среднем первичный рынок рос примерно на 14% в год, вторичный — на 9,5%; в 2025 году — на 8,7% и 3,9%. Это история, не прогноз: выбирайте ставку под свой город и сегмент. <a href="https://rosstat.gov.ru/statistics/price" target="_blank" rel="noreferrer">Источник: Росстат</a>.</span></span></span><b>% годовых</b><input v-model.number="inputs.inflation" type="number" min="0" step="0.1"></label><label class="currency-field">Стоимость недвижимости<input :value="amountValue('propertyPrice')" @focus="focusAmount('propertyPrice')" @input="setAmount('propertyPrice', $event)" @blur="blurAmount('propertyPrice')" type="text" inputmode="numeric"><span>₽</span></label><label>Ставка кредита <b>% годовых</b><input v-model.number="inputs.mortgageRate" type="number" min="0" step="0.1"></label><label>Первоначальный взнос <b>% от цены</b><input v-model.number="inputs.downPaymentPercent" type="number" min="0" max="100" step="1"></label><label class="currency-field">Аренда в месяц<input :value="amountValue('rent')" @focus="focusAmount('rent')" @input="setAmount('rent', $event)" @blur="blurAmount('rent')" type="text" inputmode="numeric"><span>₽</span></label></div><div class="state-toggle" role="group" aria-label="Состояние квартиры"><button type="button" :class="{ active: !renovationNeeded }" :aria-pressed="!renovationNeeded" @click="renovationNeeded = false">С ремонтом</button><button type="button" :class="{ active: renovationNeeded }" :aria-pressed="renovationNeeded" @click="renovationNeeded = true">Без ремонта</button></div><template v-if="renovationNeeded"><div class="inputs renovation-fields"><label class="currency-field">Стоимость ремонта <span v-if="renovationCostHint" class="hint" tabindex="0" aria-label="Про индексацию стоимости ремонта">?<span class="hint-popover" role="tooltip">{{ renovationCostHint }}</span></span><input :value="renovationCostValue()" @focus="focusRenovationCost" @input="setRenovationCost($event)" @blur="renovationFocused = false" type="text" inputmode="numeric" :placeholder="formatAmount(renovationAutoCost)"><span>₽</span></label><label>Срок ремонта <b>мес.</b><input v-model.number="renovationMonths" type="number" min="0" step="1"></label></div></template></section>
  <section><div class="cards"><article class="card mortgage">
    <p class="kicker">{{ plan?.kind === 'cash' ? 'Покупка без кредита' : 'Ипотека' }}</p>
    <h2>Самый ранний переезд</h2>
    <div class="repayment-toggle" role="group" aria-label="Сценарий погашения кредита">
      <button type="button" :class="{ active: repaymentMode === 'fast' }" :aria-pressed="repaymentMode === 'fast'" @click="repaymentMode = 'fast'">Максимально быстро<small>весь доступный платёж</small></button>
      <button type="button" :class="{ active: repaymentMode === 'long' }" :aria-pressed="repaymentMode === 'long'" @click="repaymentMode = 'long'">Растянуть на 30 лет<small>минимальный платёж</small></button>
    </div>
    <template v-if="plan">
      <p class="big-label">Дата покупки</p>
      <p class="big">{{ duration(plan.dealMonth) }}</p>
      <p class="muted mortgage-date">{{ formatDate(addMonths(referenceDate, plan.dealMonth)) }}</p>
      <dl>
        <div><dt>Минимальный первоначальный взнос</dt><dd>{{ money.format(plan.savingsGoal.minimumDownPayment) }}</dd></div>
        <div><dt>{{ plan.kind === 'cash' ? 'Стоимость квартиры' : 'Фактический первоначальный взнос' }}</dt><dd>{{ money.format(plan.kind === 'cash' ? plan.savingsGoal.cashPurchasePrice : plan.savingsGoal.actualDownPayment) }}</dd></div>
        <div v-if="renovationNeeded"><dt>Ремонт на дату сделки</dt><dd>{{ money.format(plan.renovationCostAtDeal) }} · {{ money.format(plan.renovationMonthlyPayment) }}/мес. в течение {{ plan.workMonths }} мес.</dd></div>
        <div v-if="renovationNeeded"><dt><span class="field-title">Накопить на ремонт <span class="hint" tabindex="0" aria-label="Что значит накопить на ремонт">?<span class="hint-popover" role="tooltip">Начальный запас, с которым нужно выйти к сделке: он рассчитан после учёта будущего свободного дохода и доходности накоплений. Это не полная стоимость ремонта и не часть, которую оплатит будущий доход, — свободный доход после аренды и платежа по кредиту сам покрывает часть равных платежей, а этот запас закрывает остальное.</span></span></span></dt><dd>{{ money.format(plan.savingsGoal.renovationSavings) }}</dd></div>
        <div v-if="renovationNeeded"><dt>Резерв на временный дефицит</dt><dd>{{ money.format(plan.savingsGoal.deficitReserve) }}</dd></div>
        <div class="wide goal-total"><dt>Всего необходимых накоплений</dt><dd>{{ money.format(plan.savingsGoal.totalRequiredSavings) }}</dd></div>
        <div v-if="plan.savingsGoal.optionalSurplus > 0" class="wide goal-surplus"><dt>Необязательный излишек</dt><dd>{{ money.format(plan.savingsGoal.optionalSurplus) }}</dd></div>
      </dl>
      <p v-if="renovationNeeded" class="goal-caption">Необходимые накопления на ремонт и резерв учтены в датах покупки и переезда</p>
      <dl>
        <div v-if="plan.loan"><dt>Сумма кредита</dt><dd>{{ money.format(plan.loan.principal) }}</dd></div>
        <div v-if="plan.loan"><dt><span class="field-title">Обязательный платёж <span v-if="repaymentMode === 'fast'" class="hint" tabindex="0" aria-label="Про обязательный платёж">?<span class="hint-popover" role="tooltip">Договорной аннуитет, который вносится каждый месяц по графику, даже во время ремонта. В быстром режиме платежи могут превышать аннуитет, когда есть незащищённый излишек сверх резерва: он направляется на досрочное погашение.</span></span></span></dt><dd>{{ money.format(plan.loan.contractualAnnuity) }} / мес.</dd></div>
        <div v-if="plan.loan"><dt>Срок выплаты</dt><dd>{{ duration(plan.loan.repaymentMonths) }}</dd></div>
        <div v-if="plan.loan"><dt>Переплата</dt><dd>{{ money.format(plan.loan.totalInterest) }}</dd></div>
        <div v-if="plan.loan" class="wide"><dt>Последний платёж</dt><dd>{{ formatDate(addMonths(referenceDate, plan.loan.lastPaymentBoundaryMonth)) }}</dd></div>
        <div><dt>Дата переезда</dt><dd>{{ formatDate(addMonths(referenceDate, plan.moveMonth)) }}</dd></div>
        <div v-if="renovationNeeded" class="wide"><dt>Аренда до переезда</dt><dd>{{ money.format(plan.totals.rent) }}</dd></div>
      </dl>
    </template>
    <p v-else class="empty">{{ mortgageEmptyText }}</p>
  </article>
  <article class="card cash"><p class="kicker">Копить до полной суммы</p><h2>Покупка за накопления</h2><template v-if="cashPlan"><p class="big-label">Сможете купить через</p><p class="big">{{ duration(cashPlan.dealMonth) }}</p><p class="muted">{{ formatDate(addMonths(referenceDate, cashPlan.dealMonth)) }}</p><dl><div><dt>Цена квартиры тогда</dt><dd>{{ money.format(cashPlan.propertyPriceAtDeal) }}</dd></div><div><dt>Накопления</dt><dd>{{ money.format(cashPlan.availableSavingsAtDeal) }}</dd></div><div class="wide"><dt>Аренда до переезда</dt><dd>{{ money.format(cashPlan.totals.rent) }}</dd></div><div class="wide"><dt>Дата переезда</dt><dd>{{ formatDate(addMonths(referenceDate, cashPlan.moveMonth)) }}</dd></div></dl></template><p v-else class="empty">При этих параметрах выполнимая покупка за накопления не найдена в горизонте 60 лет.</p></article></div>
  <article class="card cashflow-chart"><div class="cashflow-head"><h2>Куда уходят деньги в месяц</h2><div class="chart-legend"><span><i class="cf-principal"></i>Тело кредита</span><span><i class="cf-interest"></i>Проценты</span><span><i class="cf-renovation"></i>Ремонт</span><span><i class="cf-savings"></i>Накопления</span><span><i class="cf-rent"></i>Аренда</span></div></div><p class="muted">Каждая свеча — месяц: тело кредита, проценты, ремонт, накопления и аренда. Колесо мыши или пинч — масштаб, перетаскивание — прокрутка, полоса снизу — общий вид. Пунктирные линии — сделка и переезд, наведите для даты.</p><div class="cashflow-stage"><div v-show="cashflow && !cashflowError" ref="cashflowEl" class="cashflow-echarts"></div><template v-if="cashflow && !cashflowError"><div v-for="badge in cashflowBadges" :key="badge.key" class="cf-badge" :class="badge.key" :style="{ left: badge.x + 'px' }" @mouseenter="showBadgeTip(badge, $event)" @mousemove="showBadgeTip(badge, $event)" @mouseleave="cashflowBadgeTip = null">{{ badge.label }}</div><div v-if="cashflowBadgeTip" class="chart-tooltip chart-tooltip-plain" :style="{ left: cashflowBadgeTip.left + 'px', top: cashflowBadgeTip.top + 'px' }">{{ cashflowBadgeTip.text }}</div></template></div><p v-if="cashflowError" class="warning">Не удалось построить график — проверьте параметры. Он вернётся, когда значения станут корректными.</p><p v-else-if="!cashflow" class="warning">Нет выполнимого плана для отображения графика.</p></article><div class="bottom"><aside class="card how"><h2>Как считаем</h2><p>Ипотека доступна, когда накопления покрывают фактический первоначальный взнос и необходимый резерв на полный график обязательств, а договорной аннуитет на 30 лет укладывается в месячный доход границы сделки — сегодняшнюю аренду плюс проиндексированные накопления этого месяца.</p><p>Ежемесячная способность откладывать индексируется по формуле M(m) = M0 × (1 + s/100)<sup>m/12</sup>, где s — «Процент индексации зарплаты», M0 — базовая сумма в сегодняшних ценах. Индексация плавная по месяцам и продолжается после покупки без обнуления отсчёта; доход строки каждого месяца = сегодняшняя аренда + M(m). Прежнее ограничение фиксированного номинального бюджета пересмотрено только в части индексации ежемесячных накоплений — аренда, стоимость недвижимости и доходность вклада индексируются отдельно.</p><p v-if="renovationNeeded">Квартира без ремонта: месячный доход индексируется процентом индексации зарплаты, а индексированная аренда сжимает накопления до переезда. Фактический взнос — наименьший допустимый: не меньше процента от цены на дату сделки и такой, чтобы аннуитет на 30 лет уложился в месячный доход границы сделки. Ремонт индексируется к дате сделки и оплачивается равными платежами после неё; резерв покрывает временный дефицит и часть ремонта, которую не оплачивает свободный доход. Полный договорной аннуитет вносится по графику даже во время работ. Режим «Максимально быстро» гасит кредит досрочно только деньгами сверх защищённого резерва, «Растянуть на 30 лет» — копит свободные деньги под доходность вклада.</p></aside></div></section></div></main>
</template>
