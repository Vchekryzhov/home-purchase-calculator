<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { DEFAULTS, SIMULATION_HORIZON_MONTHS, RENOVATION_COST_SHARE, calculate, isMortgagePaymentTooLow, buildJourney, buildCashflow, rentPaidUntilMonth } from './lib/model.js';
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
const result = computed(() => calculate(inputs, repaymentMode.value, { needed: renovationNeeded.value, cost: renovationCost.value, months: renovationMonths.value, funding: renovationFunding.value }));
const mortgagePaymentTooLow = computed(() => isMortgagePaymentTooLow(result.value));
const journey = computed(() => buildJourney(inputs, result.value.mortgageAffordable, result.value.mortgageAtDownPayment));
const CASHFLOW_SEGMENTS = [
  { key: 'principal', label: 'Тело кредита', pick: (row) => row.principal },
  { key: 'interest', label: 'Проценты', pick: (row) => row.interest },
  { key: 'renovation', label: 'Ремонт', pick: (row) => row.renovation },
  { key: 'savings', label: 'Накопления', pick: (row) => row.savings },
  { key: 'rent', label: 'Аренда', pick: (row) => row.rent }
];
const cashflow = computed(() => buildCashflow(inputs, repaymentMode.value, { needed: renovationNeeded.value, cost: renovationCost.value, months: renovationMonths.value, funding: renovationFunding.value }));
const cashflowChart = computed(() => {
  const data = cashflow.value;
  if (!data) return null;
  const total = data.rows.length;
  const barWidth = 608 / total;
  const rows = data.rows.map((row) => {
    const segments = [];
    let top = 200;
    for (const segment of CASHFLOW_SEGMENTS) {
      const value = segment.pick(row);
      if (value < 0.5) continue;
      const height = value / data.maximum * 166;
      top -= height;
      segments.push({ key: segment.key, y: top, height, label: segment.label, value });
    }
    const parts = segments.filter(({ value }) => value >= 1).map(({ label, value }) => `${label}: ${money.format(value)}`);
    return { month: row.month, x: 64 + row.month * barWidth, segments, title: `${formatDate(addMonths(new Date(), row.month))} — ${parts.join(', ')}` };
  });
  const marker = (month) => 64 + month * barWidth;
  return {
    rows, barWidth,
    maximum: data.maximum, maxLabel: money.format(data.maximum),
    dealX: data.dealMonth > 0 ? marker(data.dealMonth) : null,
    moveX: data.moveMonth > data.dealMonth ? marker(data.moveMonth) : null,
    endLabel: duration(total)
  };
});
const moveDate = (month) => month > SIMULATION_HORIZON_MONTHS ? 'Не достижимо' : formatDate(addMonths(new Date(), month));
const moveRent = (month) => month > SIMULATION_HORIZON_MONTHS ? '—' : money.format(rentPaidUntilMonth(inputs, month));
const reset = () => { Object.assign(inputs, DEFAULTS); focusedAmount.value = null; renovationNeeded.value = false; renovationFunding.value = 'before'; renovationMonths.value = 6; renovationCostDraft.value = null; renovationCostInput.value = ''; renovationFocused.value = false; };
onMounted(() => { const context = document.modelContext; if (!context?.registerTool) return; context.registerTool({ name: 'configure_home_purchase_calculator', title: 'Рассчитать покупку недвижимости', description: 'Устанавливает параметры и возвращает сравнение ипотеки с накоплением.', inputSchema: { type: 'object', properties: { savings: { type: 'number', minimum: 0 }, monthlySavings: { type: 'number', minimum: 0 }, mortgageRate: { type: 'number', minimum: 0 }, propertyPrice: { type: 'number', minimum: 0 }, downPaymentPercent: { type: 'number', minimum: 0 }, inflation: { type: 'number', minimum: 0 }, rent: { type: 'number', minimum: 0 }, depositRate: { type: 'number', minimum: 0 } }, required: Object.keys(DEFAULTS), additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(next) { Object.assign(inputs, next); const r = result.value; return { mortgageMonths: r.months === null ? null : Math.ceil(r.months), mortgagePayment: Math.round(r.payment), cashPurchaseMonths: r.cashPurchase?.month ?? null }; } }, { signal: new AbortController().signal }).catch(() => {}); });
</script>

<template>
  <main><header><div><div class="eyebrow">⌂ &nbsp; Покупка недвижимости</div><h1>Калькулятор покупки недвижимости</h1><p>Сравните ипотеку сейчас и накопление до полной стоимости квартиры с учётом роста цен и аренды.</p></div></header>
  <div class="layout"><section class="panel"><div class="panel-heading"><h2>Ваши параметры</h2><button class="reset-icon" type="button" @click="reset" aria-label="Сбросить пример" title="Сбросить пример">↻</button></div><div class="inputs"><label class="currency-field">Текущие накопления<input :value="amountValue('savings')" @focus="focusAmount('savings')" @input="setAmount('savings', $event)" @blur="blurAmount('savings')" type="text" inputmode="numeric"><span>₽</span></label><label class="currency-field">Накопления в месяц<input :value="amountValue('monthlySavings')" @focus="focusAmount('monthlySavings')" @input="setAmount('monthlySavings', $event)" @blur="blurAmount('monthlySavings')" type="text" inputmode="numeric"><span>₽</span></label><label><span class="field-title">Доходность накоплений <span class="hint" tabindex="0" aria-label="Подробнее о доходности накоплений">?<span class="hint-popover" role="tooltip">Годовая доходность накоплений до покупки. Начисляется ежемесячно и уменьшает необходимую сумму кредита. Это предположение, а не гарантированный доход.</span></span></span><b>% годовых</b><input v-model.number="inputs.depositRate" type="number" min="0" step="0.1"></label><label><span class="field-title">Процент подорожания недвижимости <span class="hint" tabindex="0" aria-label="Исторические данные по росту цен на жильё">?<span class="hint-popover" role="tooltip">Используется для прогноза цены квартиры и первоначального взноса. Россия, 2020–2025: в среднем первичный рынок рос примерно на 14% в год, вторичный — на 9,5%; в 2025 году — на 8,7% и 3,9%. Это история, не прогноз: выбирайте ставку под свой город и сегмент. <a href="https://rosstat.gov.ru/statistics/price" target="_blank" rel="noreferrer">Источник: Росстат</a>.</span></span></span><b>% годовых</b><input v-model.number="inputs.inflation" type="number" min="0" step="0.1"></label><label class="currency-field">Стоимость недвижимости<input :value="amountValue('propertyPrice')" @focus="focusAmount('propertyPrice')" @input="setAmount('propertyPrice', $event)" @blur="blurAmount('propertyPrice')" type="text" inputmode="numeric"><span>₽</span></label><label>Ставка кредита <b>% годовых</b><input v-model.number="inputs.mortgageRate" type="number" min="0" step="0.1"></label><label>Первоначальный взнос <b>% от цены</b><input v-model.number="inputs.downPaymentPercent" type="number" min="0" max="100" step="1"></label><label class="currency-field">Аренда в месяц<input :value="amountValue('rent')" @focus="focusAmount('rent')" @input="setAmount('rent', $event)" @blur="blurAmount('rent')" type="text" inputmode="numeric"><span>₽</span></label></div><div class="state-toggle" role="group" aria-label="Состояние квартиры"><button type="button" :class="{ active: !renovationNeeded }" :aria-pressed="!renovationNeeded" @click="renovationNeeded = false">С ремонтом</button><button type="button" :class="{ active: renovationNeeded }" :aria-pressed="renovationNeeded" @click="renovationNeeded = true">Без ремонта</button></div><template v-if="renovationNeeded"><div class="state-toggle funding" role="group" aria-label="Финансирование ремонта"><button type="button" :class="{ active: renovationFunding === 'before' }" :aria-pressed="renovationFunding === 'before'" @click="renovationFunding = 'before'">Накопить до<small>сделка — после накопления взноса и ремонта</small></button><button type="button" :class="{ active: renovationFunding === 'after' }" :aria-pressed="renovationFunding === 'after'" @click="renovationFunding = 'after'">После покупки<small>ремонт — из дохода после сделки</small></button></div><div class="inputs renovation-fields"><label class="currency-field">Стоимость ремонта<input :value="renovationCostValue()" @focus="focusRenovationCost" @input="setRenovationCost($event)" @blur="renovationFocused = false" type="text" inputmode="numeric" :placeholder="formatAmount(renovationAutoCost)"><span>₽</span></label><label>Срок ремонта <b>мес.</b><input v-model.number="renovationMonths" type="number" min="0" step="1"></label></div></template></section>
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
  <div class="bottom"><article class="card threshold"><h2>Когда покупать?</h2><p class="muted">Самое выгодное время для покупки — когда проценты за первый месяц по кредиту ниже аренды.</p><template v-if="result.thresholdPurchase"><p class="big-label">Покупка через</p><p class="big">{{ duration(result.thresholdPurchase.month) }}</p><p class="muted">{{ formatDate(addMonths(new Date(), result.thresholdPurchase.month)) }}</p><div class="year"><div><small>Проценты в первый месяц</small><strong>{{ money.format(result.thresholdPurchase.firstMonthInterest) }}</strong></div><div><small>Аренда тогда</small><strong>{{ money.format(result.thresholdPurchase.rent) }}</strong></div></div><dl><div><dt>Сумма кредита</dt><dd>{{ money.format(result.thresholdPurchase.principal) }}</dd></div><div><dt>Бюджет на платёж</dt><dd>{{ money.format(result.thresholdPurchase.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ duration(result.thresholdPurchase.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ money.format(result.thresholdPurchase.overpayment) }}</dd></div><div class="wide"><dt>Последний платёж</dt><dd>{{ formatDate(addMonths(addMonths(new Date(), result.thresholdPurchase.month), result.thresholdPurchase.months)) }}</dd></div><div v-if="renovationNeeded"><dt>Переезд</dt><dd>{{ moveDate(result.thresholdPurchase.moveMonth) }}</dd></div><div v-if="renovationNeeded" class="wide"><dt>Аренда до переезда</dt><dd>{{ moveRent(result.thresholdPurchase.moveMonth) }}</dd></div></dl></template><p v-else class="empty">В горизонте 60 лет условия покупки не выполняются.</p></article><aside class="card how"><h2>Как считаем</h2><p>Ипотека доступна, когда накопления покрывают первоначальный взнос, а платёж позволяет погасить кредит максимум за 30 лет. Затем сравниваются проценты за первый месяц по кредиту и аренда. Ежемесячный платёж по кредиту — это сумма ежемесячных накоплений и текущей аренды: после покупки деньги за аренду переходят в платёж по кредиту.</p><p v-if="renovationNeeded && renovationFunding === 'before'">Квартира без ремонта: цель накоплений — первоначальный взнос плюс стоимость ремонта, обе суммы растут вместе с ценой недвижимости. Сделка, затем ремонт — в это время аренда продолжается, а платёж по кредиту обслуживается только из ежемесячных накоплений. Аренда переходит в платёж по кредиту после переезда.</p><p v-if="renovationNeeded && renovationFunding === 'after'">Ремонт после покупки: сделка — при накоплении первоначального взноса. Пока ремонт не оплачен, кредит обслуживается 30-летним аннуитетом, а излишек «накопления минус аннуитет» идёт на ремонт поэтапно. Переезд — когда завершены и работы, и оплата; после переезда свободные деньги ускоряют погашение.</p></aside></div><article class="card journey-chart"><div><h2>Путь до покупки</h2><p class="muted">Зелёное — накопленный капитал. Янтарное — сумма, которой ещё не хватает до первоначального взноса.</p></div><div class="chart-legend"><span><i class="legend-savings"></i>Накопления</span><span><i class="legend-shortage"></i>Не хватает до взноса</span><span><i class="legend-down-payment"></i>Первоначальный взнос</span></div><svg viewBox="0 0 720 250" role="img" aria-label="График накоплений и первоначального взноса"><defs><linearGradient id="savings-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#14b8a6" stop-opacity=".5"/><stop offset="1" stop-color="#14b8a6" stop-opacity=".05"/></linearGradient><linearGradient id="shortage-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity=".35"/><stop offset="1" stop-color="#f59e0b" stop-opacity=".08"/></linearGradient></defs><rect class="chart-frame" x="64" y="34" width="608" height="166" rx="8"/><line class="chart-grid" x1="64" y1="117" x2="672" y2="117"/><path class="chart-area-savings" :d="journey.savingsArea"/><path v-if="journey.shortageArea" class="chart-area-shortage" :d="journey.shortageArea"/><line v-if="journey.markerX !== null" class="chart-marker" :x1="journey.markerX" y1="34" :x2="journey.markerX" y2="200"/><path class="chart-line chart-down-payment" :d="journey.requiredPath"/><path class="chart-line chart-savings" :d="journey.savingsPath"/><text x="56" y="40" text-anchor="end">{{ money.format(journey.maximum) }}</text><text x="56" y="204" text-anchor="end">0 ₽</text><text x="64" y="226">Сейчас</text><text :x="journey.middleX" y="226" text-anchor="middle">{{ journey.middleLabel }}</text><text x="672" y="226" text-anchor="end">{{ journey.endLabel }}</text></svg><p v-if="journey.markerLabel" class="chart-note"><span></span>Ипотека становится доступна через {{ journey.markerLabel }}.</p><p v-else class="chart-note muted">В ближайшие 30 лет ипотека не становится доступна при текущих параметрах.</p></article><article v-if="cashflowChart" class="card cashflow-chart"><div><h2>Куда уходят деньги в месяц</h2><p class="muted">Каждая свеча — месяц. До сделки: накопления и аренда. На ремонте: платёж по кредиту и аренда. После переезда аренда переходит в ипотеку, а свободные деньги — снова в накопления.</p></div><div class="chart-legend"><span><i class="cf-principal"></i>Тело кредита</span><span><i class="cf-interest"></i>Проценты</span><span><i class="cf-renovation"></i>Ремонт</span><span><i class="cf-savings"></i>Накопления</span><span><i class="cf-rent"></i>Аренда</span></div><svg viewBox="0 0 720 250" role="img" aria-label="Ежемесячное распределение платежей по категориям"><rect class="chart-frame" x="64" y="34" width="608" height="166" rx="8"/><line class="chart-grid" x1="64" y1="117" x2="672" y2="117"/><g v-for="row in cashflowChart.rows" :key="row.month"><title>{{ row.title }}</title><rect v-for="seg in row.segments" :key="seg.key" :class="'cf-' + seg.key" :x="row.x" :y="seg.y" :width="cashflowChart.barWidth + 0.4" :height="seg.height"/></g><line v-if="cashflowChart.dealX !== null" class="chart-marker" :x1="cashflowChart.dealX" y1="34" :x2="cashflowChart.dealX" y2="200"/><text v-if="cashflowChart.dealX !== null" :x="cashflowChart.dealX" y="24" text-anchor="middle">Сделка</text><line v-if="cashflowChart.moveX !== null" class="chart-marker" :x1="cashflowChart.moveX" y1="34" :x2="cashflowChart.moveX" y2="200"/><text v-if="cashflowChart.moveX !== null" :x="cashflowChart.moveX" y="24" text-anchor="middle">Переезд</text><text x="56" y="40" text-anchor="end">{{ cashflowChart.maxLabel }}</text><text x="56" y="204" text-anchor="end">0 ₽</text><text x="64" y="226">Сейчас</text><text x="672" y="226" text-anchor="end">{{ cashflowChart.endLabel }}</text></svg></article></section></div></main>
</template>
