export const DEFAULTS = { savings: 0, monthlySavings: 50000, mortgageRate: 16.9, propertyPrice: 10000000, downPaymentPercent: 20, inflation: 5, rent: 80000, depositRate: 11.5, salaryIndexPercent: 5 };
export const SIMULATION_HORIZON_MONTHS = 720;
export const AFFORDABILITY_HORIZON_MONTHS = 360;
export const MAX_LOAN_MONTHS = 360;
export const NO_RENOVATION = { needed: false, cost: 0, months: 0 };
export const RENOVATION_COST_SHARE = 0.15;

const number = (value) => Math.max(0, Number(value) || 0);

export const paymentForTerm = (principal, annualRate, months = MAX_LOAN_MONTHS) => {
  if (principal <= 0) return 0;
  const rate = annualRate / 100 / 12;
  return rate ? principal * rate / (1 - Math.pow(1 + rate, -months)) : principal / months;
};

export const rentPaidUntilMonth = (rawInputs, month) => {
  const rent = number(rawInputs.rent), growth = 1 + number(rawInputs.inflation) / 100;
  let total = 0;
  for (let m = 0; m < Math.max(0, Math.ceil(month)); m += 1) total += rent * Math.pow(growth, m / 12);
  return total;
};

// The term's last opportunity clears only the annuity formula's floating-point residual.
const paymentDue = (balance, interest, annuity, term) => term >= MAX_LOAN_MONTHS - 1 ? balance + interest : Math.min(annuity, balance + interest);

const mandatoryPayments = (principal, annuity, rate) => {
  const payments = [];
  let balance = principal;
  for (let t = 0; t < MAX_LOAN_MONTHS && balance > 0; t += 1) {
    const interest = balance * rate;
    const payment = paymentDue(balance, interest, annuity, t);
    payments.push(payment);
    balance = Math.max(0, balance - (payment - interest));
  }
  return payments;
};

const expenses = (context, dealMonth, workMonths, installment, principal, annuity, start = dealMonth) => {
  const payments = mandatoryPayments(principal, annuity, context.rate);
  const end = Math.max(start + payments.length, dealMonth + workMonths, dealMonth + 1);
  const base = [], full = [];
  for (let month = start; month < end; month += 1) {
    const rent = month < dealMonth + workMonths ? context.rents[month] : 0;
    const baseExpense = rent + (payments[month - start] ?? 0);
    base.push(baseExpense);
    full.push(baseExpense + (month >= dealMonth && month < dealMonth + workMonths ? installment : 0));
  }
  return { base, full };
};

const prefixReserve = (schedule, incomes, start, q) => {
  let prefix = 0, reserve = 0, discount = 1;
  for (let t = 0; t < schedule.length; t += 1) {
    discount /= q;
    prefix += (schedule[t] - incomes[start + t]) * discount;
    reserve = Math.max(reserve, prefix);
  }
  return reserve;
};

const backwardReserve = (schedule, incomes, start, q) => {
  let reserve = 0;
  for (let t = schedule.length - 1; t >= 0; t -= 1) reserve = Math.max(0, (schedule[t] - incomes[start + t] + reserve) / q);
  return reserve;
};

const candidate = (context, month, cashPurchase) => {
  const { inputs, workMonths, renovationCost, growth, waiting, rents, incomes } = context;
  const index = Math.pow(growth, month / 12), price = inputs.propertyPrice * index;
  const minimumDownPayment = price * inputs.downPaymentPercent / 100;
  const down = cashPurchase ? price : Math.max(minimumDownPayment, price - incomes[month] / paymentForTerm(1, inputs.mortgageRate), 0);
  if (down > price) return null;
  const principal = price - down, annuity = paymentForTerm(principal, inputs.mortgageRate);
  const cost = renovationCost * index, installment = workMonths ? cost / workMonths : 0;
  const schedule = expenses(context, month, workMonths, installment, principal, annuity);
  const totalReserve = prefixReserve(schedule.full, incomes, month, context.q);
  const deficitReserve = prefixReserve(schedule.base, incomes, month, context.q);
  const totalRequiredSavings = down + totalReserve;
  if (waiting[month] < totalRequiredSavings) return null;
  return {
    kind: principal > 0 ? 'mortgage' : 'cash', dealMonth: month, moveMonth: month + workMonths, workMonths,
    propertyPriceAtDeal: price, renovationCostAtDeal: cost, renovationMonthlyPayment: installment,
    availableSavingsAtDeal: waiting[month], indexedRentAtDeal: rents[month],
    savingsGoal: {
      minimumDownPayment, actualDownPayment: principal > 0 ? down : 0, cashPurchasePrice: principal > 0 ? 0 : price,
      renovationSavings: totalReserve - deficitReserve, deficitReserve, totalReserve, totalRequiredSavings,
      optionalSurplus: waiting[month] - totalRequiredSavings
    },
    loan: principal > 0 ? { principal, contractualAnnuity: annuity, firstMonthInterest: principal * context.rate } : null
  };
};

const protectionAfter = (context, plan, month, principal) => {
  const remaining = expenses(context, plan.dealMonth, plan.workMonths, plan.renovationMonthlyPayment, principal, plan.loan?.contractualAnnuity ?? 0, month + 1);
  return backwardReserve(remaining.full, context.incomes, month + 1, context.q);
};

const fillLedger = (context, plan, fast) => {
  const { dealMonth, moveMonth } = plan;
  const annuity = plan.loan?.contractualAnnuity ?? 0;
  const mandatoryLength = plan.loan ? mandatoryPayments(plan.loan.principal, annuity, context.rate).length : 0;
  const hardEnd = Math.max(dealMonth + Math.max(0, mandatoryLength - 1), moveMonth - 1, dealMonth);
  const lastStop = Math.max(dealMonth, moveMonth - 1);
  let cash = context.inputs.savings, balance = 0;
  const ledger = [];
  for (let month = 0; month <= hardEnd; month += 1) {
    if (month === dealMonth) balance = plan.loan?.principal ?? 0;
    const openingCash = cash, openingLoanPrincipal = balance;
    const purchaseCapital = month === dealMonth ? plan.savingsGoal.actualDownPayment + plan.savingsGoal.cashPurchasePrice : 0;
    const cashAfterDeal = openingCash - purchaseCapital;
    const depositYield = (context.q - 1) * cashAfterDeal;
    const budgetIncome = context.incomes[month];
    const rent = month < moveMonth ? context.rents[month] : 0;
    const renovation = month >= dealMonth && month < moveMonth ? plan.renovationMonthlyPayment : 0;
    const interest = balance * context.rate;
    const term = month - dealMonth;
    const contractualPayment = balance > 0 && term >= 0
      ? paymentDue(balance, interest, annuity, term)
      : 0;
    balance = Math.max(0, balance - (contractualPayment - interest));
    cash = cashAfterDeal + depositYield + budgetIncome - rent - contractualPayment - renovation;
    let earlyRepayment = 0;
    let protectedReserveAfter = month >= dealMonth ? protectionAfter(context, plan, month, balance) : 0;
    if (fast && balance > 0) {
      for (;;) {
        const repay = Math.min(Math.max(0, cash - protectedReserveAfter), balance);
        if (repay <= 0.01) break;
        earlyRepayment += repay;
        balance -= repay;
        cash -= repay;
        protectedReserveAfter = protectionAfter(context, plan, month, balance);
      }
    }
    const principal = contractualPayment - interest + earlyRepayment;
    const renovationFromIncome = Math.min(renovation, Math.max(0, budgetIncome - rent - contractualPayment));
    const savings = Math.max(0, budgetIncome - rent - renovation - interest - principal);
    ledger.push({
      month, openingCash, purchaseCapital, cashAfterDeal, depositYield, budgetIncome, rent, renovation,
      openingLoanPrincipal, contractualPayment, earlyRepayment, interest, principal, closingLoanPrincipal: balance,
      renovationFromIncome, renovationFromCash: renovation - renovationFromIncome,
      nonRenovationFromCash: Math.max(0, rent + contractualPayment - budgetIncome), protectedReserveAfter,
      closingCash: cash, savings
    });
    if ((!plan.loan || balance < 1e-6) && month >= lastStop) break;
  }
  plan.ledger = ledger;
  plan.totals = Object.fromEntries(['rent', 'renovation', 'interest', 'principal', 'depositYield', 'budgetIncome', 'purchaseCapital'].map((key) => [key, ledger.reduce((total, row) => total + row[key], 0)]));
  plan.totals.finalCash = ledger.at(-1).closingCash;
  if (plan.loan) {
    const paymentRows = ledger.filter((row) => row.contractualPayment > 0);
    Object.assign(plan.loan, {
      firstMonthPlannedPayment: ledger[dealMonth].contractualPayment + ledger[dealMonth].earlyRepayment,
      repaymentMonths: paymentRows.length,
      lastPaymentRowMonth: paymentRows.at(-1).month,
      lastPaymentBoundaryMonth: paymentRows.at(-1).month + 1,
      totalInterest: plan.totals.interest, totalPrincipal: plan.totals.principal
    });
  }
  return plan;
};

export const buildCashflow = (plan) => {
  if (!plan) return null;
  const rows = plan.ledger.map((row) => ({
    month: row.month, savings: row.savings, rent: row.rent, renovation: row.renovation,
    interest: row.interest, principal: row.principal, openingCash: row.openingCash,
    cashAfterDeal: row.cashAfterDeal, depositYield: row.depositYield, budgetIncome: row.budgetIncome,
    purchaseCapital: row.purchaseCapital, protectedReserveAfter: row.protectedReserveAfter,
    closingCash: row.closingCash
  }));
  const maximum = rows.reduce((top, row) => Math.max(top, row.savings + row.rent + row.renovation + row.interest + row.principal), 1);
  return { rows, dealMonth: plan.dealMonth, moveMonth: plan.moveMonth, maximum };
};

export const calculate = (rawInputs, repaymentMode, renovation = NO_RENOVATION, selectedCriterion = 'earliest') => {
  const inputs = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, number(rawInputs[key])]));
  const workMonths = renovation.needed ? Math.max(0, Math.round(Number(renovation.months) || 0)) : 0;
  const renovationCost = renovation.needed ? number(renovation.cost) : 0;
  const validationErrors = [];
  if (renovationCost > 0 && workMonths === 0) validationErrors.push('Для ремонта с ненулевой стоимостью укажите срок не менее 1 месяца');
  if (!['fast', 'long'].includes(repaymentMode)) validationErrors.push('Неизвестный режим погашения');
  if (!['earliest', 'interestBelowRent'].includes(selectedCriterion)) validationErrors.push('Неизвестный критерий выбора плана');
  const invalid = validationErrors.length > 0;
  const monthlyBudget = inputs.monthlySavings + inputs.rent;
  const growth = 1 + inputs.inflation / 100;
  const plans = { earliest: null, interestBelowRent: null, cash: null };
  if (!invalid) {
    const q = 1 + inputs.depositRate / 100 / 12;
    // The income series covers the search horizon plus a full loan term: ledger months may run
    // past SIMULATION_HORIZON_MONTHS while reserve/protection windows are indexed by start month.
    const salaryGrowth = 1 + inputs.salaryIndexPercent / 100;
    const incomes = [], rents = [], waiting = [];
    for (let month = 0; month <= SIMULATION_HORIZON_MONTHS + MAX_LOAN_MONTHS; month += 1) {
      incomes.push(inputs.rent + inputs.monthlySavings * Math.pow(salaryGrowth, month / 12));
      rents.push(inputs.rent * Math.pow(growth, month / 12));
    }
    let balance = inputs.savings;
    for (let month = 0; month <= SIMULATION_HORIZON_MONTHS && balance >= 0; month += 1) {
      waiting.push(balance);
      balance = q * balance + incomes[month] - rents[month];
    }
    const context = { inputs, workMonths, renovationCost, growth, q, rate: inputs.mortgageRate / 100 / 12, waiting, rents, incomes };
    for (let month = 0; month < waiting.length && month + workMonths <= SIMULATION_HORIZON_MONTHS; month += 1) {
      const needMortgage = (!plans.earliest && month <= AFFORDABILITY_HORIZON_MONTHS) || !plans.interestBelowRent;
      const mortgage = needMortgage ? candidate(context, month, false) : null;
      if (!plans.earliest && month <= AFFORDABILITY_HORIZON_MONTHS && mortgage) plans.earliest = mortgage;
      if (!plans.cash) plans.cash = candidate(context, month, true);
      if (!plans.interestBelowRent && mortgage && (mortgage.loan ? mortgage.loan.firstMonthInterest : 0) < mortgage.indexedRentAtDeal) plans.interestBelowRent = mortgage;
    }
    for (const key of Object.keys(plans)) if (plans[key]) fillLedger(context, plans[key], repaymentMode === 'fast');
  }
  const selectedPlan = invalid ? null : plans[selectedCriterion];
  return {
    status: invalid ? 'invalid-input' : 'ok', validationErrors, monthlyBudget, selectedCriterion,
    selectionStatus: invalid ? 'invalid-input' : selectedPlan ? 'available' : 'unavailable',
    selectionReason: invalid ? 'Исправьте некорректные входные данные' : selectedPlan ? null : 'План по выбранному критерию недоступен в горизонте поиска',
    plans, selectedPlan,
    forecast: { propertyInYear: inputs.propertyPrice * growth, rentInYear: inputs.rent * growth }
  };
};
