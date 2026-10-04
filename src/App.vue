<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { DEFAULTS, SIMULATION_HORIZON_MONTHS, RENOVATION_COST_SHARE, calculate, isMortgagePaymentTooLow, isPostPurchaseAvailable, buildCashflow, rentPaidUntilMonth } from './lib/model.js';
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
const renovationFunding = ref('before');
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
const result = computed(() => calculate(inputs, repaymentMode.value, { ...renovationOptions.value, funding: renovationFunding.value }));
const mortgagePaymentTooLow = computed(() => isMortgagePaymentTooLow(result.value));
const postPurchaseResult = computed(() => calculate(inputs, repaymentMode.value, { ...renovationOptions.value, funding: 'after' }));
const postPurchaseAvailable = computed(() => renovationNeeded.value && isPostPurchaseAvailable(postPurchaseResult.value, renovationMonths.value));
const moveDate = (month) => month > SIMULATION_HORIZON_MONTHS ? 'Не достижимо' : formatDate(addMonths(new Date(), month));
const moveRent = (month) => month > SIMULATION_HORIZON_MONTHS ? '—' : money.format(rentPaidUntilMonth(inputs, month));
const CASHFLOW_SEGMENTS = [
  { key: 'principal', label: 'Тело кредита', color: '#0f766e', pick: (row) => row.principal },
  { key: 'interest', label: 'Проценты', color: '#fb7185', pick: (row) => row.interest },
  { key: 'renovation', label: 'Ремонт', color: '#f59e0b', pick: (row) => row.renovation },
  { key: 'savings', label: 'Накопления', color: '#14b8a6', pick: (row) => row.savings },
  { key: 'rent', label: 'Аренда', color: '#94a3b8', pick: (row) => row.rent }
];
const cashflow = computed(() => buildCashflow(inputs, repaymentMode.value, { ...renovationOptions.value, funding: renovationFunding.value }));
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
const formatMonthYear = (month) => { const date = addMonths(new Date(), month); return `${MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`; };
const formatMonthTick = (value) => { const date = new Date(value); return `${MONTHS_SHORT[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`; };
const buildCashflowOption = (data) => {
  const monthDate = (month) => addMonths(new Date(), month).getTime();
  const categories = data.rows.map((row) => { const date = new Date(monthDate(row.month)); return `${MONTHS_SHORT[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`; });
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
        const total = points.reduce((acc, point) => acc + (point.value ?? 0), 0);
        const rowsHtml = points.filter((point) => (point.value ?? 0) > 0).map((point) => `<div style="display:flex;justify-content:space-between;gap:18px"><span>${point.marker}${point.seriesName}</span><b>${money.format(point.value)}</b></div>`).join('');
        const row = data.rows[points[0].dataIndex];
        return `<div style="min-width:210px"><div style="color:#94a3b8;font-size:11px;margin-bottom:4px">${formatMonthYear(row.month)}</div>${rowsHtml}<div style="display:flex;justify-content:space-between;gap:18px;border-top:1px solid rgba(255,255,255,.16);margin-top:6px;padding-top:5px"><span>Всего в месяц</span><b>${money.format(total)}</b></div></div>`;
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
    if (!data) { cashflowError.value = false; cashflowChart.clear(); return; }
    const sane = data.rows.length && data.rows.every((row) => [row.savings, row.rent, row.renovation, row.interest, row.principal].every((value) => Number.isFinite(value)));
    if (!sane) { cashflowError.value = true; cashflowChart.clear(); return; }
    cashflowError.value = false;
    cashflowChart.setOption(buildCashflowOption(data), { notMerge: true });
    positionCashflowBadges();
  } catch { cashflowError.value = true; try { cashflowChart?.clear(); } catch { /* dead instance */ } }
};
watch(cashflow, renderCashflow, { flush: 'post' });
watch(postPurchaseAvailable, (available) => { if (!available && renovationFunding.value === 'after') renovationFunding.value = 'before'; });
onMounted(renderCashflow);
onBeforeUnmount(() => { cashflowObserver?.disconnect(); cashflowChart?.dispose(); cashflowChart = null; });
const reset = () => { Object.assign(inputs, DEFAULTS); focusedAmount.value = null; renovationNeeded.value = false; renovationFunding.value = 'before'; renovationMonths.value = 6; renovationCostDraft.value = null; renovationCostInput.value = ''; renovationFocused.value = false; };
onMounted(() => { const context = document.modelContext; if (!context?.registerTool) return; context.registerTool({ name: 'configure_home_purchase_calculator', title: 'Рассчитать покупку недвижимости', description: 'Устанавливает параметры и возвращает сравнение ипотеки с накоплением.', inputSchema: { type: 'object', properties: { savings: { type: 'number', minimum: 0 }, monthlySavings: { type: 'number', minimum: 0 }, mortgageRate: { type: 'number', minimum: 0 }, propertyPrice: { type: 'number', minimum: 0 }, downPaymentPercent: { type: 'number', minimum: 0 }, inflation: { type: 'number', minimum: 0 }, rent: { type: 'number', minimum: 0 }, depositRate: { type: 'number', minimum: 0 } }, required: Object.keys(DEFAULTS), additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(next) { Object.assign(inputs, next); const r = result.value; return { mortgageMonths: r.months === null ? null : Math.ceil(r.months), mortgagePayment: Math.round(r.payment), cashPurchaseMonths: r.cashPurchase?.month ?? null }; } }, { signal: new AbortController().signal }).catch(() => {}); });
</script>

<template>
  <main><header><div><div class="eyebrow">⌂ &nbsp; Покупка недвижимости</div><h1>Калькулятор покупки недвижимости</h1><p>Сравните ипотеку сейчас и накопление до полной стоимости квартиры с учётом роста цен и аренды.</p></div></header>
  <div class="layout"><section class="panel"><div class="panel-heading"><h2>Ваши параметры</h2><button class="reset-icon" type="button" @click="reset" aria-label="Сбросить пример" title="Сбросить пример">↻</button></div><div class="inputs"><label class="currency-field">Текущие накопления<input :value="amountValue('savings')" @focus="focusAmount('savings')" @input="setAmount('savings', $event)" @blur="blurAmount('savings')" type="text" inputmode="numeric"><span>₽</span></label><label class="currency-field">Накопления в месяц<input :value="amountValue('monthlySavings')" @focus="focusAmount('monthlySavings')" @input="setAmount('monthlySavings', $event)" @blur="blurAmount('monthlySavings')" type="text" inputmode="numeric"><span>₽</span></label><label><span class="field-title">Доходность накоплений <span class="hint" tabindex="0" aria-label="Подробнее о доходности накоплений">?<span class="hint-popover" role="tooltip">Годовая доходность накоплений до покупки. Начисляется ежемесячно и уменьшает необходимую сумму кредита. Это предположение, а не гарантированный доход.</span></span></span><b>% годовых</b><input v-model.number="inputs.depositRate" type="number" min="0" step="0.1"></label><label><span class="field-title">Процент подорожания недвижимости <span class="hint" tabindex="0" aria-label="Исторические данные по росту цен на жильё">?<span class="hint-popover" role="tooltip">Используется для прогноза цены квартиры и первоначального взноса. Россия, 2020–2025: в среднем первичный рынок рос примерно на 14% в год, вторичный — на 9,5%; в 2025 году — на 8,7% и 3,9%. Это история, не прогноз: выбирайте ставку под свой город и сегмент. <a href="https://rosstat.gov.ru/statistics/price" target="_blank" rel="noreferrer">Источник: Росстат</a>.</span></span></span><b>% годовых</b><input v-model.number="inputs.inflation" type="number" min="0" step="0.1"></label><label class="currency-field">Стоимость недвижимости<input :value="amountValue('propertyPrice')" @focus="focusAmount('propertyPrice')" @input="setAmount('propertyPrice', $event)" @blur="blurAmount('propertyPrice')" type="text" inputmode="numeric"><span>₽</span></label><label>Ставка кредита <b>% годовых</b><input v-model.number="inputs.mortgageRate" type="number" min="0" step="0.1"></label><label>Первоначальный взнос <b>% от цены</b><input v-model.number="inputs.downPaymentPercent" type="number" min="0" max="100" step="1"></label><label class="currency-field">Аренда в месяц<input :value="amountValue('rent')" @focus="focusAmount('rent')" @input="setAmount('rent', $event)" @blur="blurAmount('rent')" type="text" inputmode="numeric"><span>₽</span></label></div><div class="state-toggle" role="group" aria-label="Состояние квартиры"><button type="button" :class="{ active: !renovationNeeded }" :aria-pressed="!renovationNeeded" @click="renovationNeeded = false">С ремонтом</button><button type="button" :class="{ active: renovationNeeded }" :aria-pressed="renovationNeeded" @click="renovationNeeded = true">Без ремонта</button></div><template v-if="renovationNeeded"><div class="state-toggle funding" role="group" aria-label="Финансирование ремонта"><button type="button" :class="{ active: renovationFunding === 'before' }" :aria-pressed="renovationFunding === 'before'" @click="renovationFunding = 'before'">Накопить до<small>сделка — после накопления взноса и ремонта</small></button><button type="button" :class="{ active: renovationFunding === 'after' }" :aria-pressed="renovationFunding === 'after'" :disabled="!postPurchaseAvailable" @click="renovationFunding = 'after'">После покупки<small>ремонт — из дохода после сделки</small></button></div><p class="funding-explain"><span class="hint" tabindex="0" aria-label="Почему сделка позже при ремонте">?<span class="hint-popover" role="tooltip"><b>Почему сделка выходит позже, чем за квартиру с ремонтом</b><br><br>Каждый месяц бюджет один и тот же: 50 000 ₽ накоплений + 80 000 ₽ арендных = 130 000 ₽. Кредит на сделке ограничен худшим месяцем — тем, как бюджет режется сразу после покупки.<table><tr><th></th><th>Аренда</th><th>Ипотека</th></tr><tr><td>С ремонтом, после сделки</td><td>—</td><td>130 000 ₽</td></tr><tr><td>Без ремонта, идут работы</td><td>80 000 ₽</td><td>50 000 ₽</td></tr><tr><td>Без ремонта, после переезда</td><td>—</td><td>130 000 ₽</td></tr></table>Аннуитет 130 000 ₽ при ставке 16,9% вытягивает тело кредита ~9,2 млн ₽, аннуитет 50 000 ₽ — лишь ~3,5 млн ₽. Разницу (~5,7 млн) пришлось бы занимать: проценты на неё — те же ~80 000 ₽ в месяц, что и аренда, то есть аренда в кредит под 16,9%. А с телом 9,2 млн первый же месяц требовал бы 127 000 ₽ процентов + 80 000 ₽ аренды = 207 000 ₽ при бюджете 130 000 ₽.<br><br>Поэтому «накопить до» требует принести на сделку больше своих денег — около 8 млн вместо 2,4 млн в ценах старта, и дата уезжает примерно на 6 лет: копилка растёт на 11,5% плюс взносы, а цель дорожает на 5% в год.</span></span></p><p v-if="!postPurchaseAvailable" class="funding-hint">Проценты по кредиту не дадут накопить на ремонт с таким доходом. Увеличьте накопления в месяц или копите до кредита.</p><p v-else-if="renovationFunding === 'after'" class="muted">Сделка может выйти позже, чем при «накопить до»: во время ремонта платёж по кредиту идёт только из накоплений, аренда ещё занята.</p><div class="inputs renovation-fields"><label class="currency-field">Стоимость ремонта<input :value="renovationCostValue()" @focus="focusRenovationCost" @input="setRenovationCost($event)" @blur="renovationFocused = false" type="text" inputmode="numeric" :placeholder="formatAmount(renovationAutoCost)"><span>₽</span></label><label>Срок ремонта <b>мес.</b><input v-model.number="renovationMonths" type="number" min="0" step="1"></label></div></template></section>
  <section><div class="cards"><article class="card mortgage" :class="{ alert: mortgagePaymentTooLow }">
    <p class="kicker">{{ mortgagePaymentTooLow ? 'Ипотека после накопления' : result.hasDownPayment ? 'Ипотека сейчас' : 'Ипотека после накопления взноса' }}</p>
    <h2>{{ mortgagePaymentTooLow ? 'Нужно копить, пока ежемесячного платежа не станет достаточно для обслуживания кредита' : result.hasDownPayment ? 'Покупка без ожидания' : 'Покупка с первоначальным взносом' }}</h2>
    <div class="repayment-toggle" role="group" aria-label="Сценарий погашения кредита">
      <button type="button" :class="{ active: repaymentMode === 'fast' }" :aria-pressed="repaymentMode === 'fast'" @click="repaymentMode = 'fast'">Максимально быстро<small>весь доступный платёж</small></button>
      <button type="button" :class="{ active: repaymentMode === 'long' }" :aria-pressed="repaymentMode === 'long'" @click="repaymentMode = 'long'">Растянуть на 30 лет<small>минимальный платёж</small></button>
    </div>
    <template v-if="result.hasDownPayment && !mortgagePaymentTooLow">
      <p class="big-label">Сумма кредита</p><p class="big">{{ money.format(result.principal) }}</p>
      <dl><div><dt>Минимальный взнос</dt><dd>{{ money.format(result.upfrontCost ?? result.requiredDownPayment) }}</dd></div><div><dt>Платёж по кредиту</dt><dd>{{ money.format(result.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ duration(result.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ money.format(result.overpayment) }}</dd></div><div><dt>Последний платёж</dt><dd>{{ formatDate(addMonths(new Date(), result.months)) }}</dd></div><div v-if="renovationNeeded"><dt>Переезд</dt><dd>{{ moveDate(result.moveMonth ?? 0) }}</dd></div><div v-if="renovationNeeded" class="wide"><dt>Аренда до переезда</dt><dd>{{ moveRent(result.moveMonth ?? 0) }}</dd></div></dl>
    </template>
    <template v-else-if="result.mortgageAtDownPayment">
      <template v-if="mortgagePaymentTooLow && result.mortgageAffordable"><p class="big-label">Ипотека станет доступна через</p><p class="big">{{ duration(result.mortgageAffordable.month) }}</p><p class="muted mortgage-date">{{ formatDate(addMonths(new Date(), result.mortgageAffordable.month)) }}</p></template>
      <template v-else-if="mortgagePaymentTooLow"><p class="big-label">Чтобы платёж был посильным</p><p class="muted mortgage-date">За 30 лет накопить нужную сумму не получится.</p></template>
      <template v-else><p class="big-label">Можно купить через</p><p class="big">{{ duration(result.mortgageAtDownPayment.month) }}</p><p class="muted mortgage-date">{{ formatDate(addMonths(new Date(), result.mortgageAtDownPayment.month)) }}</p></template>
      <dl><div><dt>Сумма кредита</dt><dd>{{ money.format(result.mortgageAtDownPayment.principal) }}</dd></div><div><dt>Платёж по кредиту</dt><dd>{{ money.format(result.mortgageAtDownPayment.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ result.mortgageAtDownPayment.months === null ? 'Не получится выплатить за 30 лет' : duration(result.mortgageAtDownPayment.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ result.mortgageAtDownPayment.overpayment === null ? '—' : money.format(result.mortgageAtDownPayment.overpayment) }}</dd></div><div><dt>Последний платёж</dt><dd>{{ result.mortgageAtDownPayment.months === null ? '—' : formatDate(addMonths(addMonths(new Date(), result.mortgageAtDownPayment.month), result.mortgageAtDownPayment.months)) }}</dd></div><div v-if="renovationNeeded && result.mortgageAtDownPayment.moveMonth !== undefined"><dt>Переезд</dt><dd>{{ moveDate(result.mortgageAtDownPayment.moveMonth) }}</dd></div><div v-if="renovationNeeded && result.mortgageAtDownPayment.moveMonth !== undefined" class="wide"><dt>Аренда до переезда</dt><dd>{{ moveRent(result.mortgageAtDownPayment.moveMonth) }}</dd></div></dl>
    </template>
    <p v-else class="empty">Первоначальный взнос не накапливается в горизонте 60 лет.</p>
  </article>
  <article class="card cash"><p class="kicker">Копить до полной суммы</p><h2>Покупка за накопления</h2><template v-if="result.cashPurchase"><p class="big-label">Сможете купить через</p><p class="big">{{ duration(result.cashPurchase.month) }}</p><p class="muted">{{ formatDate(addMonths(new Date(), result.cashPurchase.month)) }}</p><dl><div><dt>Цена квартиры тогда</dt><dd>{{ money.format(result.cashPurchase.price) }}</dd></div><div><dt>Накопления</dt><dd>{{ money.format(result.cashPurchase.balance) }}</dd></div><div class="wide"><dt>Аренда за время ожидания</dt><dd>{{ money.format(result.cashPurchase.rentPaid) }}</dd></div><div v-if="renovationNeeded" class="wide"><dt>Дата переезда</dt><dd>{{ moveDate(result.cashPurchase.moveMonth) }}</dd></div></dl></template><p v-else class="empty">При этих параметрах накопления не догоняют стоимость недвижимости за 60 лет. Увеличьте ежемесячный взнос или доходность вклада.</p></article></div>
  <div class="bottom"><article class="card threshold"><h2>Когда покупать?</h2><p class="muted">Самое выгодное время для покупки — когда проценты за первый месяц по кредиту ниже аренды.</p><template v-if="result.thresholdPurchase"><p class="big-label">Покупка через</p><p class="big">{{ duration(result.thresholdPurchase.month) }}</p><p class="muted">{{ formatDate(addMonths(new Date(), result.thresholdPurchase.month)) }}</p><div class="year"><div><small>Проценты в первый месяц</small><strong>{{ money.format(result.thresholdPurchase.firstMonthInterest) }}</strong></div><div><small>Аренда тогда</small><strong>{{ money.format(result.thresholdPurchase.rent) }}</strong></div></div><dl><div><dt>Сумма кредита</dt><dd>{{ money.format(result.thresholdPurchase.principal) }}</dd></div><div><dt>Бюджет на платёж</dt><dd>{{ money.format(result.thresholdPurchase.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ duration(result.thresholdPurchase.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ money.format(result.thresholdPurchase.overpayment) }}</dd></div><div class="wide"><dt>Последний платёж</dt><dd>{{ formatDate(addMonths(addMonths(new Date(), result.thresholdPurchase.month), result.thresholdPurchase.months)) }}</dd></div><div v-if="renovationNeeded"><dt>Переезд</dt><dd>{{ moveDate(result.thresholdPurchase.moveMonth) }}</dd></div><div v-if="renovationNeeded" class="wide"><dt>Аренда до переезда</dt><dd>{{ moveRent(result.thresholdPurchase.moveMonth) }}</dd></div></dl></template><p v-else class="empty">В горизонте 60 лет условия покупки не выполняются.</p></article><aside class="card how"><h2>Как считаем</h2><p>Ипотека доступна, когда накопления покрывают первоначальный взнос, а платёж позволяет погасить кредит максимум за 30 лет. Затем сравниваются проценты за первый месяц по кредиту и аренда. Ежемесячный платёж по кредиту — это сумма ежемесячных накоплений и текущей аренды: после покупки деньги за аренду переходят в платёж по кредиту.</p><p v-if="renovationNeeded && renovationFunding === 'before'">Квартира без ремонта: цель накоплений — первоначальный взнос плюс стоимость ремонта, обе суммы растут вместе с ценой недвижимости. Сделка ждёт, пока 30-летний аннуитет тела кредита уложится в ежемесячные накопления; во время ремонта платёж равен этому аннуитету и гасит тело понемногу, а аренда продолжается. После переезда аренда переходит в платёж по кредиту.</p><p v-if="renovationNeeded && renovationFunding === 'after'">Ремонт после покупки: сделка — при накоплении первоначального взноса. Пока ремонт не оплачен, кредит обслуживается 30-летним аннуитетом, а излишек «накопления минус аннуитет» идёт на ремонт поэтапно. Переезд — когда завершены и работы, и оплата; после переезда свободные деньги ускоряют погашение.</p></aside></div><article class="card cashflow-chart"><div class="cashflow-head"><h2>Куда уходят деньги в месяц</h2><div class="chart-legend"><span><i class="cf-principal"></i>Тело кредита</span><span><i class="cf-interest"></i>Проценты</span><span><i class="cf-renovation"></i>Ремонт</span><span><i class="cf-savings"></i>Накопления</span><span><i class="cf-rent"></i>Аренда</span></div></div><p class="muted">Каждая свеча — месяц: тело кредита, проценты, ремонт, накопления и аренда. Колесо мыши или пинч — масштаб, перетаскивание — прокрутка, полоса снизу — общий вид. Пунктирные линии — сделка и переезд, наведите для даты.</p><div class="cashflow-stage"><div v-show="cashflow && !cashflowError" ref="cashflowEl" class="cashflow-echarts"></div><template v-if="cashflow && !cashflowError"><div v-for="badge in cashflowBadges" :key="badge.key" class="cf-badge" :class="badge.key" :style="{ left: badge.x + 'px' }" @mouseenter="showBadgeTip(badge, $event)" @mousemove="showBadgeTip(badge, $event)" @mouseleave="cashflowBadgeTip = null">{{ badge.label }}</div><div v-if="cashflowBadgeTip" class="chart-tooltip chart-tooltip-plain" :style="{ left: cashflowBadgeTip.left + 'px', top: cashflowBadgeTip.top + 'px' }">{{ cashflowBadgeTip.text }}</div></template></div><p v-if="cashflowError" class="warning">Не удалось построить график — проверьте параметры. Он вернётся, когда значения станут корректными.</p><p v-else-if="!cashflow" class="warning">При этих параметрах ипотечный план не строится — график недоступен.</p></article></section></div></main>
</template>
