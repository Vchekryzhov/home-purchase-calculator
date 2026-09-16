<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';

const defaults = { savings: 0, monthlySavings: 50000, mortgageRate: 16.9, propertyPrice: 10000000, downPaymentPercent: 20, inflation: 5, rent: 80000, depositRate: 11.5 };
const inputs = reactive({ ...defaults });
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const plainNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const number = (key) => Math.max(0, Number(inputs[key]) || 0);
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
  nextTick(() => {
    const formatted = formatDraftAmount(digits);
    let position = 0, seenDigits = 0;
    while (position < formatted.length && seenDigits < cursorDigits) { if (/\d/.test(formatted[position])) seenDigits += 1; position += 1; }
    event.target.setSelectionRange(position, position);
  });
};
const blurAmount = (key) => { if (focusedAmount.value === key) focusedAmount.value = null; };
const addMonths = (date, months) => { const result = new Date(date); result.setMonth(result.getMonth() + months); return result; };
const formatDate = (date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
const duration = (months) => { const total = Math.ceil(months); const years = Math.floor(total / 12); const rest = total % 12; return !years ? `${rest} мес.` : rest ? `${years} г. ${rest} мес.` : `${years} г.`; };
const loanPlan = (principal, payment, annualRate, maxMonths = 360) => {
  if (principal <= 0) return { months: 0, overpayment: 0, firstMonthInterest: 0 };
  if (payment <= 0) return null;
  const rate = annualRate / 100 / 12;
  const firstMonthInterest = principal * rate;
  if (rate && payment <= firstMonthInterest) return null;
  let balance = principal, totalPaid = 0;
  for (let month = 1; month <= maxMonths; month += 1) {
    const due = balance * (1 + rate);
    const actualPayment = Math.min(payment, due);
    balance = due - actualPayment;
    totalPaid += actualPayment;
    if (balance < 0.01) return { months: month, overpayment: Math.max(0, totalPaid - principal), firstMonthInterest };
  }
  return null;
};
const paymentForTerm = (principal, annualRate, months = 360) => {
  if (principal <= 0) return 0;
  const rate = annualRate / 100 / 12;
  return rate ? principal * rate / (1 - Math.pow(1 + rate, -months)) : principal / months;
};
const selectedLoanPlan = (principal, maxPayment, annualRate) => {
  if (repaymentMode.value === 'fast') {
    const plan = loanPlan(principal, maxPayment, annualRate);
    return plan && { ...plan, payment: maxPayment };
  }
  const payment = paymentForTerm(principal, annualRate);
  if (payment > maxPayment + 0.01) return null;
  const plan = loanPlan(principal, payment, annualRate);
  return plan && { ...plan, payment };
};
const result = computed(() => {
  const savings = number('savings'), monthlySavings = number('monthlySavings'), propertyPrice = number('propertyPrice'), downPaymentPercent = number('downPaymentPercent'), inflation = number('inflation'), rent = number('rent'), depositRate = number('depositRate');
  const propertyGrowth = 1 + inflation / 100, rentGrowth = 1 + inflation / 100;
  const payment = monthlySavings + rent;
  const rentAtMonth = (month) => rent * Math.pow(rentGrowth, month / 12);
  const savingsContribution = () => monthlySavings;
  let balance = savings, rentPaid = 0, cashPurchase = null;
  for (let month = 0; month <= 720; month += 1) { const price = propertyPrice * Math.pow(propertyGrowth, month / 12); if (balance >= price) { cashPurchase = { month, price, balance, rentPaid }; break; } const currentRent = rentAtMonth(month); rentPaid += currentRent; balance = balance * (1 + depositRate / 100 / 12) + savingsContribution(month); }
  const requiredDownPayment = propertyPrice * downPaymentPercent / 100;
  const hasDownPayment = savings >= requiredDownPayment;
  const principal = Math.max(0, propertyPrice - savings);
  const currentPlan = hasDownPayment ? selectedLoanPlan(principal, payment, number('mortgageRate')) : null;
  const months = currentPlan?.months ?? null;
  let downPaymentBalance = savings, mortgageAtDownPayment = null;
  for (let month = 0; month <= 720; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const required = price * downPaymentPercent / 100;
    if (downPaymentBalance >= required) {
      const futurePrincipal = Math.max(0, price - downPaymentBalance);
      const futurePayment = monthlySavings + rent;
      const futurePlan = selectedLoanPlan(futurePrincipal, futurePayment, number('mortgageRate'));
      mortgageAtDownPayment = { month, price, balance: downPaymentBalance, principal: futurePrincipal, payment: futurePlan?.payment ?? futurePayment, months: futurePlan?.months ?? null, overpayment: futurePlan?.overpayment ?? null };
      break;
    }
    downPaymentBalance = downPaymentBalance * (1 + depositRate / 100 / 12) + savingsContribution(month);
  }
  let affordableBalance = savings, mortgageAffordable = null;
  for (let month = 0; month <= 360; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const required = price * downPaymentPercent / 100;
    const futurePrincipal = Math.max(0, price - affordableBalance);
    const futurePayment = monthlySavings + rent;
    const futurePlan = selectedLoanPlan(futurePrincipal, futurePayment, number('mortgageRate'));
    if (affordableBalance >= required && futurePlan !== null) {
      mortgageAffordable = { month, principal: futurePrincipal, payment: futurePlan.payment, months: futurePlan.months, overpayment: futurePlan.overpayment };
      break;
    }
    affordableBalance = affordableBalance * (1 + depositRate / 100 / 12) + savingsContribution(month);
  }
  let thresholdBalance = savings, thresholdPurchase = null;
  for (let month = 0; month <= 720; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const futureDownPayment = price * downPaymentPercent / 100;
    const futurePrincipal = Math.max(0, price - thresholdBalance);
    const futurePayment = monthlySavings + rent;
    const futurePlan = selectedLoanPlan(futurePrincipal, futurePayment, number('mortgageRate'));
    const firstMonthInterest = futurePlan?.firstMonthInterest ?? null;
    if (thresholdBalance >= futureDownPayment && futurePlan !== null && firstMonthInterest < rentAtMonth(month)) {
      thresholdPurchase = { month, price, balance: thresholdBalance, rent: rentAtMonth(month), firstMonthInterest, principal: futurePrincipal, payment: futurePlan.payment, months: futurePlan.months, overpayment: futurePlan.overpayment };
      break;
    }
    thresholdBalance = thresholdBalance * (1 + depositRate / 100 / 12) + savingsContribution(month);
  }
  const firstMortgagePaymentTooLow = Boolean(mortgageAtDownPayment && mortgageAtDownPayment.months === null);
  return { principal, payment: currentPlan?.payment ?? payment, maxPayment: payment, months, requiredDownPayment, hasDownPayment, missingDownPayment: Math.max(0, requiredDownPayment - savings), overpayment: currentPlan?.overpayment ?? null, mortgageAtDownPayment: firstMortgagePaymentTooLow && mortgageAffordable ? mortgageAffordable : mortgageAtDownPayment, firstMortgagePaymentTooLow, mortgageAffordable, cashPurchase, thresholdPurchase, propertyInYear: propertyPrice * propertyGrowth, rentInYear: rent * rentGrowth };
});
const mortgagePaymentTooLow = computed(() => {
  const plan = result.value.mortgageAtDownPayment;
  return result.value.hasDownPayment ? result.value.months === null : result.value.firstMortgagePaymentTooLow;
});
const journey = computed(() => {
  const savings = number('savings'), monthlySavings = number('monthlySavings'), propertyPrice = number('propertyPrice'), downPaymentPercent = number('downPaymentPercent'), inflation = number('inflation'), depositRate = number('depositRate');
  const markerMonth = result.value.mortgageAffordable?.month ?? null;
  const referenceMonth = markerMonth ?? result.value.mortgageAtDownPayment?.month ?? 360;
  const horizon = Math.max(60, Math.min(360, Math.ceil(referenceMonth / 12) * 12));
  const growth = 1 + inflation / 100;
  let balance = savings;
  const values = [];
  for (let month = 0; month <= horizon; month += 1) {
    values.push({ month, balance, required: propertyPrice * Math.pow(growth, month / 12) * downPaymentPercent / 100 });
    balance = balance * (1 + depositRate / 100 / 12) + monthlySavings;
  }
  const maximum = Math.max(1, ...values.flatMap(({ balance: amount, required }) => [amount, required]));
  const x = (month) => 64 + month / horizon * 608;
  const y = (value) => 34 + (1 - value / maximum) * 166;
  const path = (key) => values.map(({ month, [key]: value }, index) => `${index ? 'L' : 'M'}${x(month).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const area = (key) => `M${x(values[0].month).toFixed(1)},200 ${values.map(({ month, [key]: value }) => `L${x(month).toFixed(1)},${y(value).toFixed(1)}`).join(' ')} L${x(values.at(-1).month).toFixed(1)},200 Z`;
  const firstCoveredIndex = values.findIndex(({ balance: amount, required }) => amount >= required);
  const shortage = values.slice(0, (firstCoveredIndex === -1 ? values.length - 1 : firstCoveredIndex) + 1);
  const shortageArea = shortage.length > 1 ? `M${shortage.map(({ month, required }) => `${x(month).toFixed(1)},${y(required).toFixed(1)}`).join(' L')} L${[...shortage].reverse().map(({ month, balance: amount }) => `${x(month).toFixed(1)},${y(amount).toFixed(1)}`).join(' L')} Z` : null;
  return {
    savingsPath: path('balance'),
    requiredPath: path('required'),
    savingsArea: area('balance'),
    shortageArea,
    markerX: markerMonth === null ? null : x(markerMonth),
    maximum,
    middleX: x(horizon / 2),
    middleLabel: `${Math.round(horizon / 24)} лет`,
    endLabel: `${Math.round(horizon / 12)} лет`,
    markerLabel: markerMonth === null ? null : duration(markerMonth)
  };
});
const reset = () => { Object.assign(inputs, defaults); focusedAmount.value = null; };
onMounted(() => { const context = document.modelContext; if (!context?.registerTool) return; context.registerTool({ name: 'configure_home_purchase_calculator', title: 'Рассчитать покупку недвижимости', description: 'Устанавливает параметры и возвращает сравнение ипотеки с накоплением.', inputSchema: { type: 'object', properties: { savings: { type: 'number', minimum: 0 }, monthlySavings: { type: 'number', minimum: 0 }, mortgageRate: { type: 'number', minimum: 0 }, propertyPrice: { type: 'number', minimum: 0 }, downPaymentPercent: { type: 'number', minimum: 0 }, inflation: { type: 'number', minimum: 0 }, rent: { type: 'number', minimum: 0 }, depositRate: { type: 'number', minimum: 0 } }, required: Object.keys(defaults), additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(next) { Object.assign(inputs, next); const r = result.value; return { mortgageMonths: r.months === null ? null : Math.ceil(r.months), mortgagePayment: Math.round(r.payment), cashPurchaseMonths: r.cashPurchase?.month ?? null }; } }, { signal: new AbortController().signal }).catch(() => {}); });
</script>

<template>
  <main><header><div><div class="eyebrow">⌂ &nbsp; Покупка недвижимости</div><h1>Калькулятор покупки недвижимости</h1><p>Сравните ипотеку сейчас и накопление до полной стоимости квартиры с учётом роста цен и аренды.</p></div></header>
  <div class="layout"><section class="panel"><div class="panel-heading"><h2>Ваши параметры</h2><button class="reset-icon" type="button" @click="reset" aria-label="Сбросить пример" title="Сбросить пример">↻</button></div><div class="inputs"><label class="currency-field">Текущие накопления<input :value="amountValue('savings')" @focus="focusAmount('savings')" @input="setAmount('savings', $event)" @blur="blurAmount('savings')" type="text" inputmode="numeric"><span>₽</span></label><label class="currency-field">Накопления в месяц<input :value="amountValue('monthlySavings')" @focus="focusAmount('monthlySavings')" @input="setAmount('monthlySavings', $event)" @blur="blurAmount('monthlySavings')" type="text" inputmode="numeric"><span>₽</span></label><label><span class="field-title">Доходность накоплений <span class="hint" tabindex="0" aria-label="Подробнее о доходности накоплений">?<span class="hint-popover" role="tooltip">Годовая доходность накоплений до покупки. Начисляется ежемесячно и уменьшает необходимую сумму кредита. Это предположение, а не гарантированный доход.</span></span></span><b>% годовых</b><input v-model.number="inputs.depositRate" type="number" min="0" step="0.1"></label><label><span class="field-title">Процент подорожания недвижимости <span class="hint" tabindex="0" aria-label="Исторические данные по росту цен на жильё">?<span class="hint-popover" role="tooltip">Используется для прогноза цены квартиры и первоначального взноса. Россия, 2020–2025: в среднем первичный рынок рос примерно на 14% в год, вторичный — на 9,5%; в 2025 году — на 8,7% и 3,9%. Это история, не прогноз: выбирайте ставку под свой город и сегмент. <a href="https://rosstat.gov.ru/statistics/price" target="_blank" rel="noreferrer">Источник: Росстат</a>.</span></span></span><b>% годовых</b><input v-model.number="inputs.inflation" type="number" min="0" step="0.1"></label><label class="currency-field">Стоимость недвижимости<input :value="amountValue('propertyPrice')" @focus="focusAmount('propertyPrice')" @input="setAmount('propertyPrice', $event)" @blur="blurAmount('propertyPrice')" type="text" inputmode="numeric"><span>₽</span></label><label>Ставка кредита <b>% годовых</b><input v-model.number="inputs.mortgageRate" type="number" min="0" step="0.1"></label><label>Первоначальный взнос <b>% от цены</b><input v-model.number="inputs.downPaymentPercent" type="number" min="0" max="100" step="1"></label><label class="currency-field">Аренда в месяц<input :value="amountValue('rent')" @focus="focusAmount('rent')" @input="setAmount('rent', $event)" @blur="blurAmount('rent')" type="text" inputmode="numeric"><span>₽</span></label></div></section>
  <section><div class="cards"><article class="card mortgage" :class="{ alert: mortgagePaymentTooLow }">
    <p class="kicker">{{ mortgagePaymentTooLow ? 'Ипотека после накопления' : result.hasDownPayment ? 'Ипотека сейчас' : 'Ипотека после накопления взноса' }}</p>
    <h2>{{ mortgagePaymentTooLow ? 'Нужно копить, пока ежемесячного платежа не станет достаточно для обслуживания кредита' : result.hasDownPayment ? 'Покупка без ожидания' : 'Покупка с первоначальным взносом' }}</h2>
    <div class="repayment-toggle" role="group" aria-label="Сценарий погашения кредита">
      <button type="button" :class="{ active: repaymentMode === 'fast' }" :aria-pressed="repaymentMode === 'fast'" @click="repaymentMode = 'fast'">Максимально быстро<small>весь доступный платёж</small></button>
      <button type="button" :class="{ active: repaymentMode === 'long' }" :aria-pressed="repaymentMode === 'long'" @click="repaymentMode = 'long'">Растянуть на 30 лет<small>минимальный платёж</small></button>
    </div>
    <template v-if="result.hasDownPayment && !mortgagePaymentTooLow">
      <p class="big-label">Сумма кредита</p><p class="big">{{ money.format(result.principal) }}</p>
      <dl><div><dt>Минимальный взнос</dt><dd>{{ money.format(result.requiredDownPayment) }}</dd></div><div><dt>Платёж по кредиту</dt><dd>{{ money.format(result.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ duration(result.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ money.format(result.overpayment) }}</dd></div><div><dt>Последний платёж</dt><dd>{{ formatDate(addMonths(new Date(), result.months)) }}</dd></div></dl>
    </template>
    <template v-else-if="result.mortgageAtDownPayment">
      <template v-if="mortgagePaymentTooLow && result.mortgageAffordable"><p class="big-label">Ипотека станет доступна через</p><p class="big">{{ duration(result.mortgageAffordable.month) }}</p><p class="muted mortgage-date">{{ formatDate(addMonths(new Date(), result.mortgageAffordable.month)) }}</p></template>
      <template v-else-if="mortgagePaymentTooLow"><p class="big-label">Чтобы платёж был посильным</p><p class="muted mortgage-date">За 30 лет накопить нужную сумму не получится.</p></template>
      <template v-else><p class="big-label">Можно купить через</p><p class="big">{{ duration(result.mortgageAtDownPayment.month) }}</p><p class="muted mortgage-date">{{ formatDate(addMonths(new Date(), result.mortgageAtDownPayment.month)) }}</p></template>
      <dl><div><dt>Сумма кредита</dt><dd>{{ money.format(result.mortgageAtDownPayment.principal) }}</dd></div><div><dt>Платёж по кредиту</dt><dd>{{ money.format(result.mortgageAtDownPayment.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ result.mortgageAtDownPayment.months === null ? 'Не получится выплатить за 30 лет' : duration(result.mortgageAtDownPayment.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ result.mortgageAtDownPayment.overpayment === null ? '—' : money.format(result.mortgageAtDownPayment.overpayment) }}</dd></div><div><dt>Последний платёж</dt><dd>{{ result.mortgageAtDownPayment.months === null ? '—' : formatDate(addMonths(addMonths(new Date(), result.mortgageAtDownPayment.month), result.mortgageAtDownPayment.months)) }}</dd></div></dl>
    </template>
    <p v-else class="empty">Первоначальный взнос не накапливается в горизонте 60 лет.</p>
  </article>
  <article class="card cash"><p class="kicker">Копить до полной суммы</p><h2>Покупка за накопления</h2><template v-if="result.cashPurchase"><p class="big-label">Сможете купить через</p><p class="big">{{ duration(result.cashPurchase.month) }}</p><p class="muted">{{ formatDate(addMonths(new Date(), result.cashPurchase.month)) }}</p><dl><div><dt>Цена квартиры тогда</dt><dd>{{ money.format(result.cashPurchase.price) }}</dd></div><div><dt>Накопления</dt><dd>{{ money.format(result.cashPurchase.balance) }}</dd></div><div class="wide"><dt>Аренда за время ожидания</dt><dd>{{ money.format(result.cashPurchase.rentPaid) }}</dd></div></dl></template><p v-else class="empty">При этих параметрах накопления не догоняют стоимость недвижимости за 60 лет. Увеличьте ежемесячный взнос или доходность вклада.</p></article></div>
  <div class="bottom"><article class="card threshold"><h2>Когда покупать?</h2><p class="muted">Самое выгодное время для покупки — когда проценты за первый месяц по кредиту ниже аренды.</p><template v-if="result.thresholdPurchase"><p class="big-label">Покупка через</p><p class="big">{{ duration(result.thresholdPurchase.month) }}</p><p class="muted">{{ formatDate(addMonths(new Date(), result.thresholdPurchase.month)) }}</p><div class="year"><div><small>Проценты в первый месяц</small><strong>{{ money.format(result.thresholdPurchase.firstMonthInterest) }}</strong></div><div><small>Аренда тогда</small><strong>{{ money.format(result.thresholdPurchase.rent) }}</strong></div></div><dl><div><dt>Сумма кредита</dt><dd>{{ money.format(result.thresholdPurchase.principal) }}</dd></div><div><dt>Бюджет на платёж</dt><dd>{{ money.format(result.thresholdPurchase.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ duration(result.thresholdPurchase.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ money.format(result.thresholdPurchase.overpayment) }}</dd></div><div class="wide"><dt>Последний платёж</dt><dd>{{ formatDate(addMonths(addMonths(new Date(), result.thresholdPurchase.month), result.thresholdPurchase.months)) }}</dd></div></dl></template><p v-else class="empty">В горизонте 60 лет условия покупки не выполняются.</p></article><aside class="card how"><h2>Как считаем</h2><p>Ипотека доступна, когда накопления покрывают первоначальный взнос, а платёж позволяет погасить кредит максимум за 30 лет. Затем сравниваются проценты за первый месяц по кредиту и аренда. Ежемесячный платёж по кредиту — это сумма ежемесячных накоплений и текущей аренды: после покупки деньги за аренду переходят в платёж по кредиту.</p></aside></div><article class="card journey-chart"><div><h2>Путь до покупки</h2><p class="muted">Зелёное — накопленный капитал. Янтарное — сумма, которой ещё не хватает до первоначального взноса.</p></div><div class="chart-legend"><span><i class="legend-savings"></i>Накопления</span><span><i class="legend-shortage"></i>Не хватает до взноса</span><span><i class="legend-down-payment"></i>Первоначальный взнос</span></div><svg viewBox="0 0 720 250" role="img" aria-label="График накоплений и первоначального взноса"><defs><linearGradient id="savings-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#14b8a6" stop-opacity=".5"/><stop offset="1" stop-color="#14b8a6" stop-opacity=".05"/></linearGradient><linearGradient id="shortage-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity=".35"/><stop offset="1" stop-color="#f59e0b" stop-opacity=".08"/></linearGradient></defs><rect class="chart-frame" x="64" y="34" width="608" height="166" rx="8"/><line class="chart-grid" x1="64" y1="117" x2="672" y2="117"/><path class="chart-area-savings" :d="journey.savingsArea"/><path v-if="journey.shortageArea" class="chart-area-shortage" :d="journey.shortageArea"/><line v-if="journey.markerX !== null" class="chart-marker" :x1="journey.markerX" y1="34" :x2="journey.markerX" y2="200"/><path class="chart-line chart-down-payment" :d="journey.requiredPath"/><path class="chart-line chart-savings" :d="journey.savingsPath"/><text x="56" y="40" text-anchor="end">{{ money.format(journey.maximum) }}</text><text x="56" y="204" text-anchor="end">0 ₽</text><text x="64" y="226">Сейчас</text><text :x="journey.middleX" y="226" text-anchor="middle">{{ journey.middleLabel }}</text><text x="672" y="226" text-anchor="end">{{ journey.endLabel }}</text></svg><p v-if="journey.markerLabel" class="chart-note"><span></span>Ипотека становится доступна через {{ journey.markerLabel }}.</p><p v-else class="chart-note muted">В ближайшие 30 лет ипотека не становится доступна при текущих параметрах.</p></article></section></div></main>
</template>
