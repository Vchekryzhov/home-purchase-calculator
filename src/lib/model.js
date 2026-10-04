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

export const allocateAfterPurchase = (price, balance, capacityDuring, annualRate, downPaymentPercent, renovationCost, renovationMonths) => {
  const rate = annualRate / 100 / 12;
  const perRouble = rate ? rate / (1 - Math.pow(1 + rate, -MAX_LOAN_MONTHS)) : 1 / MAX_LOAN_MONTHS;
  const principalMax = capacityDuring / perRouble;
  const downMin = Math.max(price * downPaymentPercent / 100, price - principalMax, price - balance);
  if (balance < downMin - 0.01) return null;
  const evaluate = (down) => {
    const principal = Math.max(0, price - down);
    const annuity = principal * perRouble;
    const surplus = capacityDuring - annuity;
    const renoCash = Math.min(renovationCost, Math.max(0, balance - down));
    const remaining = Math.max(0, renovationCost - renoCash);
    if (remaining <= 0) return { down, principal, annuity, surplus, renoCash, lag: Math.max(0, renovationMonths) };
    if (surplus <= 0) return null;
    return { down, principal, annuity, surplus, renoCash, lag: Math.max(renovationMonths, Math.ceil(remaining / surplus)) };
  };
  const options = [evaluate(downMin), evaluate(balance)].filter(Boolean);
  if (!options.length) return null;
  return options.reduce((best, option) => option.lag < best.lag ? option : best);
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
  const priceAt = (month) => propertyPrice * Math.pow(propertyGrowth, month / 12);
  const pickPlan = (month, simBalance) => {
    const price = priceAt(month);
    if (!renoActive) return selectedLoanPlan(Math.max(0, price - simBalance), payment, mortgageRate, repaymentMode);
    if (!renoAfterPurchase) return selectedRenovationLoanPlan(Math.max(0, price - (simBalance - renoCostAt(month))), monthlySavings, payment, mortgageRate, repaymentMode, renoMonths);
    const allocation = allocateAfterPurchase(price, simBalance, monthlySavings, mortgageRate, downPaymentPercent, renoCostAt(month), renoMonths);
    if (!allocation || allocation.lag > SIMULATION_HORIZON_MONTHS - month) return null;
    const capacityAfter = repaymentMode === 'fast' ? payment : allocation.annuity;
    const plan = loanPlanStepped(allocation.principal, allocation.annuity, capacityAfter, mortgageRate, allocation.lag);
    return plan && { ...plan, principal: allocation.principal, payment: capacityAfter, lag: allocation.lag, renoCash: allocation.renoCash, annuity: allocation.annuity, surplus: allocation.surplus };
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
  const principal = hasDownPayment ? (pickPlan(0, savings)?.principal ?? Math.max(0, propertyPrice - (savings - renoTarget(0)))) : Math.max(0, propertyPrice - (savings - renoTarget(0)));
  const currentPlan = hasDownPayment ? pickPlan(0, savings) : null;
  const months = currentPlan?.months ?? null;
  const currentLag = currentPlan?.lag ?? renoLag(monthlySavings, 0);
  let downPaymentBalance = savings, mortgageAtDownPayment = null;
  for (let month = 0; month <= SIMULATION_HORIZON_MONTHS; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const required = price * downPaymentPercent / 100;
    const renoCost = renoCostAt(month);
    if (downPaymentBalance >= required + renoTarget(month)) {
      const futurePlan = pickPlan(month, downPaymentBalance);
      const futurePrincipal = futurePlan?.principal ?? Math.max(0, price - (downPaymentBalance - renoTarget(month)));
      const lag = futurePlan?.lag ?? renoLag(monthlySavings, month);
      mortgageAtDownPayment = withReno({ month, price, balance: downPaymentBalance, principal: futurePrincipal, payment: futurePlan?.payment ?? payment, months: futurePlan?.months ?? null, overpayment: futurePlan?.overpayment ?? null, renoCash: futurePlan?.renoCash, annuity: futurePlan?.annuity }, month, lag);
      break;
    }
    downPaymentBalance = downPaymentBalance * (1 + depositRate / 100 / 12) + savingsContribution(month);
  }
  let affordableBalance = savings, mortgageAffordable = null, affordableBestMove = Infinity;
  for (let month = 0; month <= AFFORDABILITY_HORIZON_MONTHS; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const required = price * downPaymentPercent / 100;
    const futurePlan = pickPlan(month, affordableBalance);
    if (affordableBalance >= required + renoTarget(month) && futurePlan !== null) {
      const move = month + (futurePlan.lag ?? 0);
      if (move < affordableBestMove) {
        affordableBestMove = move;
        const futurePrincipal = futurePlan.principal ?? Math.max(0, price - (affordableBalance - renoTarget(month)));
        mortgageAffordable = withReno({ month, principal: futurePrincipal, payment: futurePlan.payment, months: futurePlan.months, overpayment: futurePlan.overpayment, renoCash: futurePlan.renoCash, annuity: futurePlan.annuity }, month, futurePlan.lag);
      }
      if (!renoAfterPurchase) break;
    }
    affordableBalance = affordableBalance * (1 + depositRate / 100 / 12) + savingsContribution(month);
  }
  let thresholdBalance = savings, thresholdPurchase = null, thresholdBestMove = Infinity;
  for (let month = 0; month <= SIMULATION_HORIZON_MONTHS; month += 1) {
    const price = propertyPrice * Math.pow(propertyGrowth, month / 12);
    const futureDownPayment = price * downPaymentPercent / 100;
    const futurePlan = pickPlan(month, thresholdBalance);
    const firstMonthInterest = futurePlan?.firstMonthInterest ?? null;
    if (thresholdBalance >= futureDownPayment + renoTarget(month) && futurePlan !== null && firstMonthInterest < rentAtMonth(month)) {
      const move = month + (futurePlan.lag ?? 0);
      if (move < thresholdBestMove) {
        thresholdBestMove = move;
        thresholdPurchase = withReno({ month, price, balance: thresholdBalance, rent: rentAtMonth(month), firstMonthInterest, principal: futurePlan.principal ?? Math.max(0, price - (thresholdBalance - renoTarget(month))), payment: futurePlan.payment, months: futurePlan.months, overpayment: futurePlan.overpayment, renoCash: futurePlan.renoCash, annuity: futurePlan.annuity }, month, futurePlan.lag);
      }
      if (!renoAfterPurchase) break;
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
  const monthlySavings = number('monthlySavings'), rent = number('rent'), mortgageRate = number('mortgageRate'), inflation = number('inflation');
  const propertyGrowth = 1 + inflation / 100;
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
      const annuity = plan.annuity ?? plan.payment;
      const capacityAfter = repaymentMode === 'fast' ? monthlySavings + rent : annuity;
      schedule = loanScheduleStepped(plan.principal, annuity, capacityAfter, mortgageRate, plan.lag ?? lag, plan.months + (plan.lag ?? lag) + 1);
    } else {
      const during = repaymentMode === 'fast' ? monthlySavings : plan.payment;
      const capacityAfter = repaymentMode === 'fast' ? monthlySavings + rent : plan.payment;
      schedule = loanScheduleStepped(plan.principal, during, capacityAfter, mortgageRate, lag, plan.months + lag + 1);
    }
  }
  const renoCash = fundingAfter ? (plan.renoCash ?? 0) : 0;
  const accumulationReno = renoActive && dealMonth > 0 ? (fundingAfter ? renoCash : renoCostDeal) / dealMonth : 0;
  const dealRenoLump = renoActive && dealMonth === 0 ? (fundingAfter ? renoCash : renoCostDeal) : 0;
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
      row.rent = rent;
    } else if (month < moveMonth) {
      row.rent = rent;
      let monthlyReno = 0;
      if (fundingAfter) {
        monthlyReno = Math.min(Math.max(0, monthlySavings - paymentActual), Math.max(0, renoCostDeal - renoCash - renoPaid));
        renoPaid += monthlyReno;
      }
      if (dealRenoLump > 0 && month === dealMonth) row.renovation += dealRenoLump;
      row.renovation += monthlyReno;
      row.savings = Math.max(0, monthlySavings - paymentActual - monthlyReno);
    } else {
      row.interest = interestPaid;
      row.principal = principalPaid;
    }
    rows.push(row);
  }
  if (!rows.length) return null;
  const maximum = Math.max(1, ...rows.map(({ savings, rent: rentPart, renovation, interest, principal }) => savings + rentPart + renovation + interest + principal));
  return { rows, dealMonth, moveMonth, maximum };
};

export const isMortgagePaymentTooLow = (result) => result.hasDownPayment ? result.months === null : result.firstMortgagePaymentTooLow;
