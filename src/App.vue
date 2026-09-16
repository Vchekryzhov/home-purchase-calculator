<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';

const defaults = { savings: 0, monthlySavings: 50000, mortgageRate: 16.9, propertyPrice: 10000000, downPaymentPercent: 20, inflation: 5, rent: 80000, indexRent: true, depositRate: 11.5 };
const inputs = reactive({ ...defaults });
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const plainNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const number = (key) => Math.max(0, Number(inputs[key]) || 0);
const formatAmount = (value) => plainNumber.format(Number(value) || 0);
const amountDrafts = reactive({ savings: '', monthlySavings: '', propertyPrice: '', rent: '' });
const focusedAmount = ref(null);
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
const result = computed(() => {
  const savings = number('savings'), monthlySavings = number('monthlySavings'), propertyPrice = number('propertyPrice'), downPaymentPercent = number('downPaymentPercent'), inflation = number('inflation'), rent = number('rent'), depositRate = number('depositRate');
  const propertyGrowth = 1 + inflation / 100, rentGrowth = 1 + (inputs.indexRent ? inflation : 0) / 100;
  let balance = savings, rentPaid = 0, cashPurchase = null;
  for (let month = 0; month <= 720; month += 1) { const price = propertyPrice * Math.pow(propertyGrowth, month / 12); if (balance >= price) { cashPurchase = { month, price, balance, rentPaid }; break; } rentPaid += rent * Math.pow(rentGrowth, month / 12); balance = balance * (1 + depositRate / 100 / 12) + monthlySavings; }
  const requiredDownPayment = propertyPrice * downPaymentPercent / 100;
  const hasDownPayment = savings >= requiredDownPayment;
  const principal = Math.max(0, propertyPrice - savings), payment = monthlySavings + rent;
  const currentPlan = hasDownPayment ? loanPlan(principal, payment, number('mortgageRate')) : null;
  const months = currentPlan?.months ?? null;
  let downPaymentBalance = savings, mortgageAtDownPayment = null;
  for (let month = 0; month <= 720; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const required = price * downPaymentPercent / 100;
    if (downPaymentBalance >= required) {
      const currentRent = rent * Math.pow(rentGrowth, month / 12);
      const futurePrincipal = Math.max(0, price - downPaymentBalance);
      const futurePayment = monthlySavings + rent;
      const futurePlan = loanPlan(futurePrincipal, futurePayment, number('mortgageRate'));
      mortgageAtDownPayment = { month, price, balance: downPaymentBalance, principal: futurePrincipal, payment: futurePayment, months: futurePlan?.months ?? null, overpayment: futurePlan?.overpayment ?? null };
      break;
    }
    downPaymentBalance = downPaymentBalance * (1 + depositRate / 100 / 12) + monthlySavings;
  }
  let affordableBalance = savings, mortgageAffordable = null;
  for (let month = 0; month <= 360; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const required = price * downPaymentPercent / 100;
    const futurePrincipal = Math.max(0, price - affordableBalance);
    const futurePayment = monthlySavings + rent;
    const futurePlan = loanPlan(futurePrincipal, futurePayment, number('mortgageRate'));
    if (affordableBalance >= required && futurePlan !== null) {
      mortgageAffordable = { month, principal: futurePrincipal, payment: futurePayment, months: futurePlan.months, overpayment: futurePlan.overpayment };
      break;
    }
    affordableBalance = affordableBalance * (1 + depositRate / 100 / 12) + monthlySavings;
  }
  let thresholdBalance = savings, thresholdPurchase = null;
  for (let month = 0; month <= 720; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const currentRent = rent * Math.pow(rentGrowth, month / 12);
    const futureDownPayment = price * downPaymentPercent / 100;
    const futurePrincipal = Math.max(0, price - thresholdBalance);
    const futurePayment = monthlySavings + rent;
    const futurePlan = loanPlan(futurePrincipal, futurePayment, number('mortgageRate'));
    const firstMonthInterest = futurePlan?.firstMonthInterest ?? null;
    if (thresholdBalance >= futureDownPayment && futurePlan !== null && firstMonthInterest < currentRent) {
      thresholdPurchase = { month, price, balance: thresholdBalance, rent: currentRent, firstMonthInterest, principal: futurePrincipal, payment: futurePayment, months: futurePlan.months, overpayment: futurePlan.overpayment };
      break;
    }
    thresholdBalance = thresholdBalance * (1 + depositRate / 100 / 12) + monthlySavings;
  }
  const firstMortgagePaymentTooLow = Boolean(mortgageAtDownPayment && mortgageAtDownPayment.months === null);
  return { principal, payment, months, requiredDownPayment, hasDownPayment, missingDownPayment: Math.max(0, requiredDownPayment - savings), overpayment: currentPlan?.overpayment ?? null, mortgageAtDownPayment: firstMortgagePaymentTooLow && mortgageAffordable ? mortgageAffordable : mortgageAtDownPayment, firstMortgagePaymentTooLow, mortgageAffordable, cashPurchase, thresholdPurchase, propertyInYear: propertyPrice * propertyGrowth, rentInYear: rent * rentGrowth };
});
const mortgagePaymentTooLow = computed(() => {
  const plan = result.value.mortgageAtDownPayment;
  return result.value.hasDownPayment ? result.value.months === null : result.value.firstMortgagePaymentTooLow;
});
const reset = () => { Object.assign(inputs, defaults); focusedAmount.value = null; };
onMounted(() => { const context = document.modelContext; if (!context?.registerTool) return; context.registerTool({ name: 'configure_home_purchase_calculator', title: 'Рассчитать покупку недвижимости', description: 'Устанавливает параметры и возвращает сравнение ипотеки с накоплением.', inputSchema: { type: 'object', properties: { savings: { type: 'number', minimum: 0 }, monthlySavings: { type: 'number', minimum: 0 }, mortgageRate: { type: 'number', minimum: 0 }, propertyPrice: { type: 'number', minimum: 0 }, downPaymentPercent: { type: 'number', minimum: 0 }, inflation: { type: 'number', minimum: 0 }, rent: { type: 'number', minimum: 0 }, indexRent: { type: 'boolean' }, depositRate: { type: 'number', minimum: 0 } }, required: Object.keys(defaults), additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(next) { Object.assign(inputs, next); const r = result.value; return { mortgageMonths: r.months === null ? null : Math.ceil(r.months), mortgagePayment: Math.round(r.payment), cashPurchaseMonths: r.cashPurchase?.month ?? null }; } }, { signal: new AbortController().signal }).catch(() => {}); });
</script>

<template>
  <main><header><div><div class="eyebrow">⌂ &nbsp; Покупка недвижимости</div><h1>Калькулятор покупки недвижимости</h1><p>Сравните ипотеку сейчас и накопление до полной стоимости квартиры с учётом инфляции и аренды.</p></div></header>
  <div class="layout"><section class="panel"><div class="panel-heading"><h2>Ваши параметры</h2><button class="reset-icon" type="button" @click="reset" aria-label="Сбросить пример" title="Сбросить пример">↻</button></div><div class="inputs"><label class="currency-field">Текущие накопления<input :value="amountValue('savings')" @focus="focusAmount('savings')" @input="setAmount('savings', $event)" @blur="blurAmount('savings')" type="text" inputmode="numeric"><span>₽</span></label><label class="currency-field">Накопления в месяц<input :value="amountValue('monthlySavings')" @focus="focusAmount('monthlySavings')" @input="setAmount('monthlySavings', $event)" @blur="blurAmount('monthlySavings')" type="text" inputmode="numeric"><span>₽</span></label><label>Ставка вклада / доходность по инвестициям <b>% годовых</b><input v-model.number="inputs.depositRate" type="number" min="0" step="0.1"></label><label>Инфляция <b>% годовых</b><input v-model.number="inputs.inflation" type="number" min="0" step="0.1"></label><label class="currency-field">Стоимость недвижимости<input :value="amountValue('propertyPrice')" @focus="focusAmount('propertyPrice')" @input="setAmount('propertyPrice', $event)" @blur="blurAmount('propertyPrice')" type="text" inputmode="numeric"><span>₽</span></label><label>Ставка кредита <b>% годовых</b><input v-model.number="inputs.mortgageRate" type="number" min="0" step="0.1"></label><label>Первоначальный взнос <b>% от цены</b><input v-model.number="inputs.downPaymentPercent" type="number" min="0" max="100" step="1"></label><label class="currency-field">Аренда в месяц<input :value="amountValue('rent')" @focus="focusAmount('rent')" @input="setAmount('rent', $event)" @blur="blurAmount('rent')" type="text" inputmode="numeric"><span>₽</span></label></div><label class="check"><input v-model="inputs.indexRent" type="checkbox"><span><strong>Учитывать инфляцию в аренде</strong><em>Арендные платежи будут расти вместе с инфляцией во время накопления.</em></span></label></section>
  <section><div class="cards"><article class="card mortgage" :class="{ alert: mortgagePaymentTooLow }"><p class="kicker">{{ mortgagePaymentTooLow ? 'Ипотека после накопления' : result.hasDownPayment ? 'Ипотека сейчас' : 'Ипотека после накопления взноса' }}</p><h2>{{ mortgagePaymentTooLow ? 'Нужно копить, пока ежемесячного платежа не станет достаточно для обслуживания кредита' : result.hasDownPayment ? 'Покупка без ожидания' : 'Покупка с первоначальным взносом' }}</h2><template v-if="result.hasDownPayment"><p class="big-label">Сумма кредита</p><p class="big">{{ money.format(result.principal) }}</p><dl><div><dt>Минимальный взнос</dt><dd>{{ money.format(result.requiredDownPayment) }}</dd></div><div><dt>Бюджет на платёж</dt><dd>{{ money.format(result.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ result.months === null ? 'Суммы платежа недостаточно' : duration(result.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ result.overpayment === null ? '—' : money.format(result.overpayment) }}</dd></div><div><dt>Последний платёж</dt><dd>{{ result.months === null ? '—' : formatDate(addMonths(new Date(), Math.ceil(result.months))) }}</dd></div></dl></template><template v-else-if="result.mortgageAtDownPayment"><template v-if="mortgagePaymentTooLow && result.mortgageAffordable"><p class="big-label">Ипотека станет доступна через</p><p class="big">{{ duration(result.mortgageAffordable.month) }}</p><p class="muted mortgage-date">{{ formatDate(addMonths(new Date(), result.mortgageAffordable.month)) }}</p></template><template v-else-if="mortgagePaymentTooLow"><p class="big-label">Чтобы платёж был посильным</p><p class="muted mortgage-date">За 30 лет накопить нужную сумму не получится.</p></template><template v-else><p class="big-label">Можно купить через</p><p class="big">{{ duration(result.mortgageAtDownPayment.month) }}</p><p class="muted mortgage-date">{{ formatDate(addMonths(new Date(), result.mortgageAtDownPayment.month)) }}</p></template><dl><div><dt>Сумма кредита</dt><dd>{{ money.format(result.mortgageAtDownPayment.principal) }}</dd></div><div><dt>Бюджет на платёж</dt><dd>{{ money.format(result.mortgageAtDownPayment.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ result.mortgageAtDownPayment.months === null ? 'Суммы платежа недостаточно' : duration(result.mortgageAtDownPayment.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ result.mortgageAtDownPayment.overpayment === null ? '—' : money.format(result.mortgageAtDownPayment.overpayment) }}</dd></div><div><dt>Последний платёж</dt><dd>{{ result.mortgageAtDownPayment.months === null ? '—' : formatDate(addMonths(addMonths(new Date(), result.mortgageAtDownPayment.month), Math.ceil(result.mortgageAtDownPayment.months))) }}</dd></div></dl></template><p v-else class="empty">Первоначальный взнос не накапливается в горизонте 60 лет.</p></article>
  <article class="card cash"><p class="kicker">Копить до полной суммы</p><h2>Покупка за накопления</h2><template v-if="result.cashPurchase"><p class="big-label">Сможете купить через</p><p class="big">{{ duration(result.cashPurchase.month) }}</p><p class="muted">{{ formatDate(addMonths(new Date(), result.cashPurchase.month)) }}</p><dl><div><dt>Цена квартиры тогда</dt><dd>{{ money.format(result.cashPurchase.price) }}</dd></div><div><dt>Накопления</dt><dd>{{ money.format(result.cashPurchase.balance) }}</dd></div><div class="wide"><dt>Аренда за время ожидания</dt><dd>{{ money.format(result.cashPurchase.rentPaid) }}</dd></div></dl></template><p v-else class="empty">При этих параметрах накопления не догоняют стоимость недвижимости за 60 лет. Увеличьте ежемесячный взнос или доходность вклада.</p></article></div>
  <div class="bottom"><article class="card threshold"><h2>Когда покупать?</h2><p class="muted">Самое выгодное время для покупки — когда проценты за первый месяц по кредиту ниже аренды.</p><template v-if="result.thresholdPurchase"><p class="big-label">Покупка через</p><p class="big">{{ duration(result.thresholdPurchase.month) }}</p><p class="muted">{{ formatDate(addMonths(new Date(), result.thresholdPurchase.month)) }}</p><div class="year"><div><small>Проценты в первый месяц</small><strong>{{ money.format(result.thresholdPurchase.firstMonthInterest) }}</strong></div><div><small>Аренда тогда</small><strong>{{ money.format(result.thresholdPurchase.rent) }}</strong></div></div><dl><div><dt>Сумма кредита</dt><dd>{{ money.format(result.thresholdPurchase.principal) }}</dd></div><div><dt>Бюджет на платёж</dt><dd>{{ money.format(result.thresholdPurchase.payment) }} / мес.</dd></div><div><dt>Срок выплаты</dt><dd>{{ duration(result.thresholdPurchase.months) }}</dd></div><div><dt>Переплата</dt><dd>{{ money.format(result.thresholdPurchase.overpayment) }}</dd></div><div class="wide"><dt>Последний платёж</dt><dd>{{ formatDate(addMonths(addMonths(new Date(), result.thresholdPurchase.month), result.thresholdPurchase.months)) }}</dd></div></dl></template><p v-else class="empty">В горизонте 60 лет условия покупки не выполняются.</p></article><aside class="card how"><h2>Как считаем</h2><p>Ипотека доступна, когда накопления покрывают первоначальный взнос, а платёж позволяет погасить кредит максимум за 30 лет. Затем сравниваются проценты за первый месяц по кредиту и аренда. Ежемесячный платёж по кредиту — это сумма ежемесячных накоплений и аренды: после покупки деньги за аренду переходят в платёж по кредиту.</p></aside></div></section></div></main>
</template>
