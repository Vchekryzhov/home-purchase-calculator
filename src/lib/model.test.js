import { describe, expect, it } from 'vitest';
import { DEFAULTS, NO_RENOVATION, RENOVATION_COST_SHARE, SIMULATION_HORIZON_MONTHS, loanPlan, loanPlanStepped, loanScheduleStepped, paymentForTerm, selectedLoanPlan, selectedRenovationLoanPlan, afterPurchaseSchedule, calculate, isMortgagePaymentTooLow, buildCashflow, rentPaidUntilMonth } from './model.js';
import { plural, yearsLabel, monthsLabel, duration } from './format.js';
import expected from './model.characterization.json';

const round2 = (value) => (typeof value === 'number' ? Math.round(value * 100) / 100 : value);
const roundDeep = (value) => {
  if (typeof value === 'number') return round2(value);
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === 'object') { const out = {}; for (const [key, entry] of Object.entries(value)) out[key] = roundDeep(entry); return out; }
  return value;
};

describe('loanPlan', () => {
  it('returns a zero plan for zero principal', () => {
    expect(loanPlan(0, 50000, 16.9)).toEqual({ months: 0, overpayment: 0, firstMonthInterest: 0 });
  });
  it('rejects non-positive payment', () => {
    expect(loanPlan(1000000, 0, 16.9)).toBeNull();
  });
  it('rejects payment that never covers first-month interest', () => {
    expect(loanPlan(1000000, 100, 16.9)).toBeNull();
  });
  it('rejects when the loan cannot be repaid within maxMonths', () => {
    expect(loanPlan(10000000, 1000, 16.9)).toBeNull();
  });
  it('repays a loan and reports overpayment', () => {
    const plan = loanPlan(1000000, 100000, 16.9);
    expect(plan.months).toBe(11);
    expect(plan.overpayment).toBeCloseTo(85474.55, 1);
    expect(plan.firstMonthInterest).toBeCloseTo(14083.33, 1);
  });
});

describe('paymentForTerm', () => {
  it('returns 0 for zero principal', () => {
    expect(paymentForTerm(0, 16.9)).toBe(0);
  });
  it('falls back to linear split at zero rate', () => {
    expect(paymentForTerm(1200000, 0, 12)).toBe(100000);
  });
  it('computes the annuity payment', () => {
    expect(paymentForTerm(1000000, 16.9, 360)).toBeCloseTo(14175.6, 1);
  });
});

describe('selectedLoanPlan', () => {
  it('uses the maximum payment in fast mode', () => {
    const plan = selectedLoanPlan(1000000, 100000, 16.9, 'fast');
    expect(plan.payment).toBe(100000);
    expect(plan.months).toBe(11);
  });
  it('uses the 30-year annuity in long mode when it fits', () => {
    const plan = selectedLoanPlan(1000000, 100000, 16.9, 'long');
    expect(plan.months).toBe(360);
    expect(plan.payment).toBeCloseTo(14175.6, 1);
  });
  it('rejects long mode when the annuity exceeds capacity', () => {
    expect(selectedLoanPlan(10000000, 10000, 16.9, 'long')).toBeNull();
  });
  it('rejects fast mode when even the maximum payment cannot service the loan', () => {
    expect(selectedLoanPlan(10000000, 1000, 16.9, 'fast')).toBeNull();
  });
});

describe('calculate (characterization)', () => {
  for (const [name, overrides, mode] of [
    ['defaults-fast', {}, 'fast'],
    ['defaults-long', {}, 'long'],
    ['rich-fast', { savings: 3000000 }, 'fast'],
    ['rich-long', { savings: 3000000 }, 'long'],
    ['saver-fast', { monthlySavings: 300000 }, 'fast'],
    ['lowrent-fast', { rent: 10000 }, 'fast'],
    ['midrent-fast', { rent: 60000 }, 'fast'],
    ['poor-fast', { monthlySavings: 1000, rent: 0 }, 'fast'],
    ['poor-long', { monthlySavings: 1000, rent: 0 }, 'long'],
  ]) {
    it(`matches pre-refactor behaviour: ${name}`, () => {
      const inputs = { ...DEFAULTS, ...overrides };
      const result = calculate(inputs, mode);
      expect(roundDeep(result)).toEqual(expected[name].result);
      expect(isMortgagePaymentTooLow(result)).toBe(expected[name].mortgagePaymentTooLow);
    });
  }

  it('higher rent moves the «проценты < аренда» threshold earlier', () => {
    const low = calculate({ ...DEFAULTS, rent: 10000 }, 'fast').thresholdPurchase.month;
    const mid = calculate({ ...DEFAULTS, rent: 60000 }, 'fast').thresholdPurchase.month;
    const high = calculate({ ...DEFAULTS, rent: 80000 }, 'fast').thresholdPurchase.month;
    expect(low).toBe(154);
    expect(mid).toBe(104);
    expect(high).toBe(81);
  });

  it('keeps a working mortgage scenario when renovation is absent (regression anchor)', () => {
    const result = calculate({ ...DEFAULTS, savings: 3000000 }, 'fast');
    expect(result.hasDownPayment).toBe(true);
    expect(result.months).toBe(102);
    expect(result.cashPurchase.month).toBe(92);
    expect(result.thresholdPurchase.month).toBe(20);
  });
});

describe('renovation: loanPlanStepped', () => {
  it('equals the flat plan when the switch month is zero', () => {
    expect(loanPlanStepped(3000000, 30000, 130000, 16.9, 0)).toEqual(loanPlan(3000000, 130000, 16.9));
  });
  it('takes longer when the first months pay less', () => {
    const stepped = loanPlanStepped(3000000, 30000, 130000, 16.9, 6);
    const flat = loanPlan(3000000, 130000, 16.9);
    expect(stepped.months).toBe(35);
    expect(flat.months).toBe(29);
    expect(stepped.overpayment).toBeGreaterThan(flat.overpayment);
  });
  it('returns a zero plan for zero principal', () => {
    expect(loanPlanStepped(0, 30000, 130000, 16.9, 6)).toEqual({ months: 0, overpayment: 0, firstMonthInterest: 0 });
  });
  it('rejects when never repaid within the cap', () => {
    expect(loanPlanStepped(10000000, 1000, 1000, 16.9, 6)).toBeNull();
  });
});

describe('renovation: selectedRenovationLoanPlan', () => {
  it('long mode rejects an annuity unaffordable during renovation months (rent does not help yet)', () => {
    expect(selectedRenovationLoanPlan(3000000, 30000, 130000, 16.9, 'long', 6)).toBeNull();
  });
  it('long mode accepts when the annuity fits even the renovation-phase capacity', () => {
    const plan = selectedRenovationLoanPlan(3000000, 50000, 130000, 16.9, 'long', 6);
    expect(plan.months).toBe(360);
    expect(plan.payment).toBeCloseTo(42526.79, 1);
  });
  it('long mode ignores the during-capacity once renovation months are zero', () => {
    const plan = selectedRenovationLoanPlan(3000000, 1, 130000, 16.9, 'long', 0);
    expect(plan.months).toBe(360);
  });
  it('fast mode simulates stepped payments and reports the post-move payment', () => {
    const plan = selectedRenovationLoanPlan(3000000, 30000, 130000, 16.9, 'fast', 6);
    expect(plan.months).toBe(35);
    expect(plan.payment).toBe(130000);
  });
});

describe('renovation: calculate «накопить до»', () => {
  const reno = { needed: true, cost: 1500000, months: 6 };

  it('is byte-identical to the pre-renovation model when renovation is off', () => {
    expect(calculate(DEFAULTS, 'fast', NO_RENOVATION)).toEqual(calculate(DEFAULTS, 'fast'));
    expect(calculate(DEFAULTS, 'fast', { needed: false, cost: 999999, months: 6 })).toEqual(calculate(DEFAULTS, 'fast'));
  });

  it('adds no renovation fields when renovation is off', () => {
    const result = calculate(DEFAULTS, 'fast');
    expect(result.moveMonth).toBeUndefined();
    expect(result.cashPurchase.moveMonth).toBeUndefined();
  });

  it('cash purchase waits for price + indexed renovation cost, move comes after renovation', () => {
    const result = calculate(DEFAULTS, 'fast', reno);
    expect(result.cashPurchase.month).toBe(181);
    expect(result.cashPurchase.moveMonth).toBe(187);
    expect(result.cashPurchase.renovationCost).toBeCloseTo(3131096.99, 1);
    expect(result.cashPurchase.rentPaid).toBeCloseTo(22364493.65, 1);
  });

  it('cash rent paid includes the renovation months (cross-check with rentPaidUntilMonth)', () => {
    const result = calculate(DEFAULTS, 'fast', reno);
    expect(result.cashPurchase.rentPaid).toBeCloseTo(rentPaidUntilMonth(DEFAULTS, result.cashPurchase.moveMonth), 1);
  });

  it('down payment target grows by the indexed renovation cost and the deal shifts later', () => {
    const result = calculate(DEFAULTS, 'fast', reno);
    expect(result.mortgageAtDownPayment.month).toBe(104);
    expect(result.mortgageAtDownPayment.moveMonth).toBe(110);
    expect(result.mortgageAtDownPayment.months).toBe(348);
  });

  it('mortgage now: upfront cost = down payment + renovation cost, principal shrinks by the renovation budget', () => {
    const result = calculate({ ...DEFAULTS, savings: 8000000 }, 'fast', reno);
    expect(result.hasDownPayment).toBe(true);
    expect(result.upfrontCost).toBe(3500000);
    expect(result.principal).toBe(3500000);
    expect(result.moveMonth).toBe(6);
  });

  it('rent does not flow into the mortgage payment during renovation months', () => {
    const inputs = { ...DEFAULTS, savings: 8000000, monthlySavings: 30000, rent: 100000 };
    const without = calculate(inputs, 'long');
    const withReno = calculate(inputs, 'long', { needed: true, cost: 1000000, months: 6 });
    expect(without.months).toBe(360);
    expect(withReno.months).toBeNull();
    expect(withReno.hasDownPayment).toBe(true);
    expect(isMortgagePaymentTooLow(withReno)).toBe(true);
  });

  it('threshold purchase also waits for the renovation budget and reports the move month', () => {
    const result = calculate(DEFAULTS, 'fast', reno);
    expect(result.thresholdPurchase.month).toBe(105);
    expect(result.thresholdPurchase.moveMonth).toBe(111);
  });

  it('affordability waits for down payment + renovation and reports the move month', () => {
    const result = calculate({ ...DEFAULTS, monthlySavings: 300000 }, 'fast', reno);
    expect(result.mortgageAffordable.month).toBe(12);
    expect(result.mortgageAffordable.moveMonth).toBe(18);
  });
});

describe('renovation: afterPurchaseSchedule', () => {
  it('rejects when the 30-year annuity exceeds the renovation-phase capacity', () => {
    expect(afterPurchaseSchedule(8701642.9, 50000, 16.9, 2289453.6, 6)).toBeNull();
  });
  it('rejects when the annuity consumes the whole capacity with a cost to cover', () => {
    expect(afterPurchaseSchedule(3540000, 50000, 16.9, 1500000, 6)).toBeNull();
  });
  it('keeps the works duration when funding finishes earlier', () => {
    const schedule = afterPurchaseSchedule(3000000, 50000, 16.9, 100000, 24);
    expect(schedule.lag).toBe(24);
    expect(schedule.annuity).toBeCloseTo(42526.79, 1);
  });
  it('extends the lag when funding takes longer than the works', () => {
    const schedule = afterPurchaseSchedule(3000000, 50000, 16.9, 2000000, 6);
    expect(schedule.lag).toBe(268);
    expect(schedule.annuity).toBeCloseTo(42526.79, 1);
  });
  it('skips the lag for zero cost', () => {
    const schedule = afterPurchaseSchedule(3000000, 50000, 16.9, 0, 6);
    expect(schedule.lag).toBe(6);
    expect(schedule.annuity).toBeCloseTo(42526.79, 1);
  });
});

describe('renovation: calculate «после покупки»', () => {
  const renoAfter = { needed: true, cost: 1500000, months: 6, funding: 'after' };

  it('deal target is the down payment only: rich savings buy now, renovation funded from surplus', () => {
    const result = calculate({ ...DEFAULTS, savings: 8000000 }, 'fast', renoAfter);
    expect(result.hasDownPayment).toBe(true);
    expect(result.upfrontCost).toBe(2000000);
    expect(result.principal).toBe(2000000);
    expect(result.moveMonth).toBe(70);
    expect(result.months).toBe(88);
  });

  it('long mode keeps the annuity after the move', () => {
    const result = calculate({ ...DEFAULTS, savings: 8000000 }, 'long', renoAfter);
    expect(result.months).toBe(360);
    expect(result.payment).toBeCloseTo(28351.19, 1);
    expect(result.moveMonth).toBe(70);
  });

  it('the annuity gate pushes the affordable deal month until the annuity fits monthly savings', () => {
    const result = calculate(DEFAULTS, 'fast', renoAfter);
    expect(result.mortgageAffordable.month).toBe(136);
    expect(result.mortgageAffordable.principal).toBeCloseTo(3511968.48, 1);
    expect(result.mortgageAffordable.months).toBe(360);
  });

  it('a near-zero surplus delays the move beyond the horizon (UI shows «Не достижимо»)', () => {
    const result = calculate(DEFAULTS, 'fast', renoAfter);
    expect(result.mortgageAffordable.moveMonth).toBe(12223);
    expect(result.mortgageAffordable.moveMonth).toBeGreaterThan(SIMULATION_HORIZON_MONTHS);
  });

  it('cash deal waits for the price only, then funds renovation from monthly savings', () => {
    const result = calculate(DEFAULTS, 'fast', renoAfter);
    expect(result.cashPurchase.month).toBe(163);
    expect(result.cashPurchase.moveMonth).toBe(222);
    expect(result.cashPurchase.rentPaid).toBeCloseTo(28787556.94, 1);
  });

  it('threshold deal also gates on the annuity and reports the lagged move', () => {
    const result = calculate(DEFAULTS, 'long', renoAfter);
    expect(result.thresholdPurchase.month).toBe(136);
    expect(result.thresholdPurchase.payment).toBeCloseTo(49784.25, 1);
  });
});

describe('rentPaidUntilMonth', () => {
  it('matches the cash simulation rent total for the base case', () => {
    expect(rentPaidUntilMonth(DEFAULTS, 163)).toBeCloseTo(18459674.31, 1);
  });
  it('grows with the month index and is zero at move-in now', () => {
    expect(rentPaidUntilMonth(DEFAULTS, 0)).toBe(0);
    expect(rentPaidUntilMonth(DEFAULTS, 200)).toBeGreaterThan(rentPaidUntilMonth(DEFAULTS, 100));
  });
});

describe('buildCashflow', () => {
  const total = (row) => row.savings + row.rent + row.renovation + row.interest + row.principal;
  const sum = (rows, key) => rows.reduce((acc, row) => acc + row[key], 0);
  const zero = { ...DEFAULTS, inflation: 0, depositRate: 0 };

  it('returns null when no feasible mortgage plan exists', () => {
    expect(buildCashflow({ ...DEFAULTS, monthlySavings: 1000, rent: 0 }, 'fast')).toBeNull();
  });

  it('accumulation months split into savings and rent; loan months into principal and interest', () => {
    const data = buildCashflow({ ...zero, rent: 0 }, 'fast');
    expect(data.rows[0]).toEqual({ month: 0, savings: 50000, rent: 0, renovation: 0, interest: 0, principal: 0 });
    const loanRow = data.rows[data.dealMonth];
    expect(loanRow.rent).toBe(0);
    expect(loanRow.principal).toBeGreaterThan(0);
    expect(loanRow.interest).toBeGreaterThan(0);
    expect(loanRow.principal + loanRow.interest).toBeCloseTo(50000, 1);
  });

  it('keeps every month total at savings-plus-rent (rent converts into the mortgage payment)', () => {
    for (const [name, renovation] of [
      ['no-renovation', NO_RENOVATION],
      ['before', { needed: true, cost: 1500000, months: 6, funding: 'before' }],
      ['after', { needed: true, cost: 1500000, months: 6, funding: 'after' }],
    ]) {
      const data = buildCashflow(DEFAULTS, 'fast', renovation);
      const rentAt = (month) => 80000 * Math.pow(1.05, month / 12);
      for (const row of data.rows) {
        const expected = 50000 + (row.month < data.moveMonth ? rentAt(row.month) : 80000);
        expect(total(row)).toBeCloseTo(expected, 0);
      }
      expect(data.rows.length).toBeGreaterThan(0);
    }
  });

  it('«накопить до»: renovation is spread over the accumulation months and sums to its indexed cost', () => {
    const data = buildCashflow({ ...zero, propertyPrice: 2500000, savings: 0, monthlySavings: 100000, rent: 0 }, 'fast', { needed: true, cost: 300000, months: 6, funding: 'before' });
    expect(data.dealMonth).toBe(8);
    expect(data.moveMonth).toBe(14);
    for (let month = 0; month < data.dealMonth; month += 1) {
      expect(data.rows[month].renovation).toBeCloseTo(37500, 1);
      expect(data.rows[month].savings).toBeCloseTo(62500, 1);
    }
    expect(sum(data.rows, 'renovation')).toBeCloseTo(300000, 1);
    for (let month = data.dealMonth; month < data.moveMonth; month += 1) {
      expect(data.rows[month].principal + data.rows[month].interest).toBeCloseTo(100000, 1);
      expect(data.rows[month].rent).toBe(0);
    }
  });

  it('«после покупки»: renovation equals the monthly surplus until the cost is covered', () => {
    const data = buildCashflow({ ...zero, propertyPrice: 4000000, savings: 3400000, monthlySavings: 100000, rent: 0 }, 'fast', { needed: true, cost: 1200000, months: 6, funding: 'after' });
    expect(data.dealMonth).toBe(0);
    expect(data.moveMonth).toBe(14);
    expect(sum(data.rows, 'renovation')).toBeCloseTo(1200000, 1);
    for (let month = 0; month < 13; month += 1) {
      expect(data.rows[month].renovation + data.rows[month].principal + data.rows[month].interest).toBeCloseTo(100000, 1);
      expect(data.rows[month].savings).toBe(0);
    }
    expect(data.rows[13].renovation).toBeLessThan(data.rows[0].renovation);
  });

  it('loan payments match the amortization plan', () => {
    const inputs = { ...zero, rent: 0, monthlySavings: 100000, propertyPrice: 2500000, savings: 0 };
    const plan = calculate(inputs, 'fast').mortgageAtDownPayment;
    const data = buildCashflow(inputs, 'fast');
    expect(sum(data.rows, 'principal')).toBeCloseTo(plan.principal, 1);
    expect(sum(data.rows, 'principal') + sum(data.rows, 'interest')).toBeCloseTo(plan.principal + plan.overpayment, 1);
  });
});

describe('format helpers', () => {
  it('picks correct Russian plural forms', () => {
    expect(plural(1, 'год', 'года', 'лет')).toBe('год');
    expect(plural(3, 'год', 'года', 'лет')).toBe('года');
    expect(plural(11, 'год', 'года', 'лет')).toBe('лет');
    expect(plural(21, 'месяц', 'месяца', 'месяцев')).toBe('месяц');
  });
  it('labels years and months', () => {
    expect(yearsLabel(5)).toBe('5 лет');
    expect(monthsLabel(2)).toBe('2 месяца');
  });
  it('formats durations', () => {
    expect(duration(6)).toBe('6 месяцев');
    expect(duration(13)).toBe('1 год 1 месяц');
    expect(duration(24)).toBe('2 года');
    expect(duration(47)).toBe('3 года 11 месяцев');
  });
});
