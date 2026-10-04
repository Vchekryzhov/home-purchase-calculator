import { yearsLabel, duration } from './format.js';

export const DEFAULTS = { savings: 0, monthlySavings: 50000, mortgageRate: 16.9, propertyPrice: 10000000, downPaymentPercent: 20, inflation: 5, rent: 80000, depositRate: 11.5 };
export const SIMULATION_HORIZON_MONTHS = 720;
export const AFFORDABILITY_HORIZON_MONTHS = 360;
export const MAX_LOAN_MONTHS = 360;

export const loanPlan = (principal, payment, annualRate, maxMonths = MAX_LOAN_MONTHS) => {
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

export const paymentForTerm = (principal, annualRate, months = MAX_LOAN_MONTHS) => {
  if (principal <= 0) return 0;
  const rate = annualRate / 100 / 12;
  return rate ? principal * rate / (1 - Math.pow(1 + rate, -months)) : principal / months;
};

export const selectedLoanPlan = (principal, maxPayment, annualRate, repaymentMode) => {
  if (repaymentMode === 'fast') {
    const plan = loanPlan(principal, maxPayment, annualRate);
    return plan && { ...plan, payment: maxPayment };
  }
  const payment = paymentForTerm(principal, annualRate);
  if (payment > maxPayment + 0.01) return null;
  const plan = loanPlan(principal, payment, annualRate);
  return plan && { ...plan, payment };
};

export const NO_RENOVATION = { needed: false, cost: 0, months: 0 };
export const RENOVATION_COST_SHARE = 0.15;

export const loanPlanStepped = (principal, paymentDuring, paymentAfter, annualRate, renovationMonths, maxMonths = MAX_LOAN_MONTHS) => {
  if (principal <= 0) return { months: 0, overpayment: 0, firstMonthInterest: 0 };
  if (paymentDuring <= 0 && paymentAfter <= 0) return null;
  const rate = annualRate / 100 / 12;
  const firstMonthInterest = principal * rate;
  let balance = principal, totalPaid = 0;
  for (let month = 1; month <= maxMonths; month += 1) {
    const due = balance * (1 + rate);
    const actualPayment = Math.min(month <= renovationMonths ? paymentDuring : paymentAfter, due);
    balance = due - actualPayment;
    totalPaid += actualPayment;
    if (balance < 0.01) return { months: month, overpayment: Math.max(0, totalPaid - principal), firstMonthInterest };
  }
  return null;
};

export const selectedRenovationLoanPlan = (principal, capacityDuring, capacityAfter, annualRate, repaymentMode, renovationMonths) => {
  if (repaymentMode === 'fast') {
    const plan = loanPlanStepped(principal, capacityDuring, capacityAfter, annualRate, renovationMonths);
    return plan && { ...plan, payment: capacityAfter };
  }
  const payment = paymentForTerm(principal, annualRate);
  const weakestCapacity = renovationMonths > 0 ? Math.min(capacityDuring, capacityAfter) : capacityAfter;
  if (payment > weakestCapacity + 0.01) return null;
  const plan = loanPlan(principal, payment, annualRate);
  return plan && { ...plan, payment };
};

export const loanScheduleStepped = (principal, paymentDuring, paymentAfter, annualRate, switchMonth, maxMonths) => {
  if (principal <= 0) return [];
  const rate = annualRate / 100 / 12;
  let balance = principal;
  const rows = [];
  for (let month = 1; month <= maxMonths && balance >= 0.01; month += 1) {
    const interest = balance * rate;
    const payment = Math.min(month <= switchMonth ? paymentDuring : paymentAfter, balance + interest);
    const principalPart = payment - interest;
    balance -= principalPart;
    rows.push({ interest, principal: principalPart });
  }
  return rows;
};

export const afterPurchaseSchedule = (principal, capacityDuring, annualRate, renovationCost, renovationMonths) => {
  const annuity = paymentForTerm(principal, annualRate);
  if (annuity > capacityDuring + 0.01) return null;
  if (renovationMonths <= 0 || renovationCost <= 0) return { annuity, lag: Math.max(0, renovationMonths) };
  const surplus = capacityDuring - annuity;
  if (surplus <= 0) return null;
  return { annuity, lag: Math.max(renovationMonths, Math.ceil(renovationCost / surplus)) };
};

export const rentPaidUntilMonth = (rawInputs, month) => {
  const number = (key) => Math.max(0, Number(rawInputs[key]) || 0);
  const rent = number('rent'), inflation = number('inflation');
  const rentGrowth = 1 + inflation / 100;
  let rentPaid = 0;
  for (let m = 0; m < Math.max(0, Math.ceil(month)); m += 1) rentPaid += rent * Math.pow(rentGrowth, m / 12);
  return rentPaid;
};

export const calculate = (rawInputs, repaymentMode, renovation = NO_RENOVATION) => {
  const number = (key) => Math.max(0, Number(rawInputs[key]) || 0);
  const savings = number('savings'), monthlySavings = number('monthlySavings'), propertyPrice = number('propertyPrice'), downPaymentPercent = number('downPaymentPercent'), inflation = number('inflation'), rent = number('rent'), depositRate = number('depositRate');
  const mortgageRate = number('mortgageRate');
  const propertyGrowth = 1 + inflation / 100, rentGrowth = 1 + inflation / 100;
  const payment = monthlySavings + rent;
  const rentAtMonth = (month) => rent * Math.pow(rentGrowth, month / 12);
  const savingsContribution = () => monthlySavings;
  const renoActive = Boolean(renovation?.needed);
  const renoMonths = renoActive ? Math.max(0, Math.round(Number(renovation.months) || 0)) : 0;
  const renoAfterPurchase = renoActive && renovation.funding === 'after';
  const renoCostAt = (month) => renoActive ? Math.max(0, Number(renovation.cost) || 0) * Math.pow(propertyGrowth, month / 12) : 0;
  const renoTarget = (month) => renoAfterPurchase ? 0 : renoCostAt(month);
  const renoLagAfter = (surplus, month) => {
    if (renoMonths <= 0 || renoCostAt(month) <= 0) return renoMonths;
    if (surplus <= 0) return SIMULATION_HORIZON_MONTHS;
    return Math.max(renoMonths, Math.ceil(renoCostAt(month) / surplus));
  };
  const renoLag = (surplus, month) => renoAfterPurchase ? renoLagAfter(surplus, month) : renoMonths;
  const pickPlan = (principal, month) => {
    if (!renoActive) return selectedLoanPlan(principal, payment, mortgageRate, repaymentMode);
    if (!renoAfterPurchase) return selectedRenovationLoanPlan(principal, monthlySavings, payment, mortgageRate, repaymentMode, renoMonths);
    const schedule = afterPurchaseSchedule(principal, monthlySavings, mortgageRate, renoCostAt(month), renoMonths);
    if (!schedule) return null;
    const capacityAfter = repaymentMode === 'fast' ? payment : schedule.annuity;
    const plan = loanPlanStepped(principal, schedule.annuity, capacityAfter, mortgageRate, schedule.lag);
    return plan && { ...plan, payment: capacityAfter, lag: schedule.lag };
  };
  const withReno = (object, month, lag = renoMonths) => renoActive ? { ...object, moveMonth: month + lag, renovationCost: renoCostAt(month) } : object;
  let balance = savings, rentPaid = 0, cashPurchase = null;
  for (let month = 0; month <= SIMULATION_HORIZON_MONTHS; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    if (balance >= price + renoTarget(month)) {
      const lag = renoLag(monthlySavings, month);
      for (let k = month; k < month + lag; k += 1) rentPaid += rentAtMonth(k);
      cashPurchase = withReno({ month, price, balance, rentPaid }, month, lag);
      break;
    }
    rentPaid += rentAtMonth(month);
    balance = balance * (1 + depositRate / 100 / 12) + savingsContribution(month);
  }
  const requiredDownPayment = propertyPrice * downPaymentPercent / 100;
  const upfrontCost = requiredDownPayment + renoTarget(0);
  const hasDownPayment = savings >= upfrontCost;
  const principal = Math.max(0, propertyPrice - (savings - renoTarget(0)));
  const currentPlan = hasDownPayment ? pickPlan(principal, 0) : null;
  const months = currentPlan?.months ?? null;
  const currentLag = currentPlan?.lag ?? renoLag(monthlySavings, 0);
  let downPaymentBalance = savings, mortgageAtDownPayment = null;
  for (let month = 0; month <= SIMULATION_HORIZON_MONTHS; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const required = price * downPaymentPercent / 100;
    const renoCost = renoCostAt(month);
    if (downPaymentBalance >= required + renoTarget(month)) {
      const futurePrincipal = Math.max(0, price - (downPaymentBalance - renoTarget(month)));
      const futurePlan = pickPlan(futurePrincipal, month);
      const lag = futurePlan?.lag ?? renoLag(monthlySavings, month);
      mortgageAtDownPayment = withReno({ month, price, balance: downPaymentBalance, principal: futurePrincipal, payment: futurePlan?.payment ?? payment, months: futurePlan?.months ?? null, overpayment: futurePlan?.overpayment ?? null }, month, lag);
      break;
    }
    downPaymentBalance = downPaymentBalance * (1 + depositRate / 100 / 12) + savingsContribution(month);
  }
  let affordableBalance = savings, mortgageAffordable = null;
  for (let month = 0; month <= AFFORDABILITY_HORIZON_MONTHS; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const required = price * downPaymentPercent / 100;
    const futurePrincipal = Math.max(0, price - (affordableBalance - renoTarget(month)));
    const futurePlan = pickPlan(futurePrincipal, month);
    if (affordableBalance >= required + renoTarget(month) && futurePlan !== null) {
      mortgageAffordable = withReno({ month, principal: futurePrincipal, payment: futurePlan.payment, months: futurePlan.months, overpayment: futurePlan.overpayment }, month, futurePlan.lag);
      break;
    }
    affordableBalance = affordableBalance * (1 + depositRate / 100 / 12) + savingsContribution(month);
  }
  let thresholdBalance = savings, thresholdPurchase = null;
  for (let month = 0; month <= SIMULATION_HORIZON_MONTHS; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const futureDownPayment = price * downPaymentPercent / 100;
    const futurePrincipal = Math.max(0, price - (thresholdBalance - renoTarget(month)));
    const futurePlan = pickPlan(futurePrincipal, month);
    const firstMonthInterest = futurePlan?.firstMonthInterest ?? null;
    if (thresholdBalance >= futureDownPayment + renoTarget(month) && futurePlan !== null && firstMonthInterest < rentAtMonth(month)) {
      thresholdPurchase = withReno({ month, price, balance: thresholdBalance, rent: rentAtMonth(month), firstMonthInterest, principal: futurePrincipal, payment: futurePlan.payment, months: futurePlan.months, overpayment: futurePlan.overpayment }, month, futurePlan.lag);
      break;
    }
    thresholdBalance = thresholdBalance * (1 + depositRate / 100 / 12) + savingsContribution(month);
  }
  const firstMortgagePaymentTooLow = Boolean(mortgageAtDownPayment && mortgageAtDownPayment.months === null);
  return {
    principal, payment: currentPlan?.payment ?? payment, maxPayment: payment, months, requiredDownPayment, hasDownPayment, missingDownPayment: Math.max(0, upfrontCost - savings), overpayment: currentPlan?.overpayment ?? null,
    mortgageAtDownPayment: firstMortgagePaymentTooLow && mortgageAffordable ? mortgageAffordable : mortgageAtDownPayment,
    firstMortgagePaymentTooLow, mortgageAffordable, cashPurchase, thresholdPurchase, propertyInYear: propertyPrice * propertyGrowth, rentInYear: rent * rentGrowth,
    ...(renoActive ? { moveMonth: currentLag, renovationCost: renoCostAt(0), upfrontCost } : {})
  };
};

export const buildCashflow = (rawInputs, repaymentMode, renovation = NO_RENOVATION) => {
  const plan = calculate(rawInputs, repaymentMode, renovation).mortgageAtDownPayment;
  if (!plan || plan.months === null) return null;
  const number = (key) => Math.max(0, Number(rawInputs[key]) || 0);
  const monthlySavings = number('monthlySavings'), inflation = number('inflation'), rent = number('rent'), mortgageRate = number('mortgageRate');
  const propertyGrowth = 1 + inflation / 100;
  const rentAtMonth = (month) => rent * Math.pow(propertyGrowth, month / 12);
  const renoActive = Boolean(renovation?.needed);
  const renoMonths = renoActive ? Math.max(0, Math.round(Number(renovation.months) || 0)) : 0;
  const fundingAfter = renoActive && renovation.funding === 'after';
  const renoCostAt = (month) => renoActive ? Math.max(0, Number(renovation.cost) || 0) * Math.pow(propertyGrowth, month / 12) : 0;
  const dealMonth = plan.month;
  const moveMonth = plan.moveMonth ?? dealMonth;
  const lag = moveMonth - dealMonth;
  const renoCostDeal = renoCostAt(dealMonth);
  let schedule = [];
  if (plan.principal > 0) {
    if (!renoActive) schedule = loanScheduleStepped(plan.principal, plan.payment, plan.payment, mortgageRate, 0, plan.months + 1);
    else if (fundingAfter) {
      const bought = afterPurchaseSchedule(plan.principal, monthlySavings, mortgageRate, renoCostDeal, renoMonths);
      const annuity = bought?.annuity ?? paymentForTerm(plan.principal, mortgageRate);
      const capacityAfter = repaymentMode === 'fast' ? monthlySavings + rent : annuity;
      schedule = loanScheduleStepped(plan.principal, annuity, capacityAfter, mortgageRate, lag, plan.months + lag + 1);
    } else {
      const during = repaymentMode === 'fast' ? monthlySavings : plan.payment;
      const capacityAfter = repaymentMode === 'fast' ? monthlySavings + rent : plan.payment;
      schedule = loanScheduleStepped(plan.principal, during, capacityAfter, mortgageRate, lag, plan.months + lag + 1);
    }
  }
  const accumulationReno = renoActive && !fundingAfter && dealMonth > 0 ? renoCostDeal / dealMonth : 0;
  const dealRenoLump = renoActive && !fundingAfter && dealMonth === 0 ? renoCostDeal : 0;
  let renoPaid = 0;
  const rows = [];
  const totalMonths = Math.min(SIMULATION_HORIZON_MONTHS, dealMonth + Math.max(plan.months, lag, 1));
  for (let month = 0; month < totalMonths; month += 1) {
    const entry = month >= dealMonth ? schedule[month - dealMonth] : null;
    const principalPaid = Math.max(0, entry?.principal ?? 0);
    const paymentActual = entry ? entry.interest + entry.principal : 0;
    const interestPaid = Math.max(0, paymentActual - principalPaid);
    const row = { month, savings: 0, rent: 0, renovation: 0, interest: interestPaid, principal: principalPaid };
    if (month < dealMonth) {
      row.savings = Math.max(0, monthlySavings - accumulationReno);
      row.renovation = Math.min(accumulationReno, monthlySavings);
      row.rent = rentAtMonth(month);
    } else if (month < moveMonth) {
      row.rent = rentAtMonth(month);
      if (fundingAfter) {
        row.renovation = Math.min(Math.max(0, monthlySavings - paymentActual), Math.max(0, renoCostDeal - renoPaid));
        renoPaid += row.renovation;
      } else if (dealRenoLump && month === dealMonth) {
        row.renovation = dealRenoLump;
      }
      row.savings = Math.max(0, monthlySavings - paymentActual - row.renovation);
    } else {
      row.savings = Math.max(0, monthlySavings + rent - paymentActual);
    }
    rows.push(row);
  }
  if (!rows.length) return null;
  const maximum = Math.max(1, ...rows.map(({ savings, rent: rentPart, renovation, interest, principal }) => savings + rentPart + renovation + interest + principal));
  return { rows, dealMonth, moveMonth, maximum };
};

export const isMortgagePaymentTooLow = (result) => result.hasDownPayment ? result.months === null : result.firstMortgagePaymentTooLow;

export const buildJourney = (rawInputs, mortgageAffordable, mortgageAtDownPayment) => {
  const number = (key) => Math.max(0, Number(rawInputs[key]) || 0);
  const savings = number('savings'), monthlySavings = number('monthlySavings'), propertyPrice = number('propertyPrice'), downPaymentPercent = number('downPaymentPercent'), inflation = number('inflation'), depositRate = number('depositRate');
  const markerMonth = mortgageAffordable?.month ?? null;
  const referenceMonth = markerMonth ?? mortgageAtDownPayment?.month ?? 360;
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
    middleLabel: yearsLabel(Math.round(horizon / 24)),
    endLabel: yearsLabel(Math.round(horizon / 12)),
    markerLabel: markerMonth === null ? null : duration(markerMonth)
  };
};
