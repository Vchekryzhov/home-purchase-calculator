import { describe, expect, it } from 'vitest';
import * as model from './model.js';
import fixtures from './model.characterization.json';
import { addMonths } from './format.js';

const run = (id) => {
  const entry = fixtures[id];
  return model.calculate(entry.inputs, entry.repaymentMode, entry.renovation, entry.selectedCriterion);
};
const moneyEqual = (actual, expected, path = 'value') => {
  expect(typeof actual, path).toBe('number');
  expect(Number.isFinite(actual), path).toBe(true);
  expect(Math.abs(actual - expected), `${path}: actual=${actual}, expected=${expected}`).toBeLessThanOrEqual(0.01);
};

describe('slice 1: normalization, validation and envelope', () => {
  for (const id of ['target-zero-work-invalid', 'target-mode-invalid', 'target-criterion-invalid']) {
    it(`rejects ${id} with exact validation messages`, () => {
      const result = run(id);
      expect(result.status).toBe('invalid-input');
      expect(result.validationErrors).toEqual(fixtures[id].expected.statuses.validationErrors);
      expect(result.selectionStatus).toBe('invalid-input');
      expect(result.plans).toEqual({ earliest: null, interestBelowRent: null, cash: null });
      expect(result.selectedPlan).toBeNull();
      expect(result.selectionReason).toMatch(/[А-Яа-я]/);
    });
  }
  it('returns the fixed-budget and forecast envelope for a simple entry', () => {
    const result = run('matrix-no-renovation-fast');
    expect(result.status).toBe('ok');
    expect(result.validationErrors).toEqual([]);
    expect(result.selectedCriterion).toBe('earliest');
    expect(result.monthlyBudget).toBe(15);
    expect(result.forecast).toEqual({ propertyInYear: 1000, rentInYear: 5 });
    expect(Object.keys(result).sort()).toEqual(['status', 'validationErrors', 'monthlyBudget', 'selectedCriterion', 'selectionStatus', 'selectionReason', 'plans', 'selectedPlan', 'forecast'].sort());
  });
  it('normalizes all input fields without adding invalid cases', () => {
    const result = model.calculate(Object.fromEntries(Object.keys(model.DEFAULTS).map((key) => [key, '-20'])), 'long');
    expect(result.status).toBe('ok');
    expect(result.monthlyBudget).toBe(0);
    expect(result.forecast).toEqual({ propertyInYear: 0, rentInYear: 0 });
  });
});

describe('slice 2: fixed budget and indexed waiting', () => {
  it('accumulates the zero-rate cash price from the fixed nominal budget', () => {
    const plan = run('matrix-zero-rates').plans.cash;
    const golden = fixtures['matrix-zero-rates'].expected.plans.cash;
    expect(plan.dealMonth).toBe(golden.dealMonth);
    moneyEqual(plan.availableSavingsAtDeal, golden.availableSavingsAtDeal);
    moneyEqual(plan.propertyPriceAtDeal, golden.propertyPriceAtDeal);
    moneyEqual(plan.renovationCostAtDeal, golden.renovationCostAtDeal);
  });
  it('stops waiting when indexed rent exhausts cash instead of clamping contributions', () => {
    const result = run('matrix-inflation-unreachable');
    expect(result.monthlyBudget).toBe(10);
    expect(result.plans.cash).toBeNull();
    expect(result.forecast).toEqual({ propertyInYear: 200, rentInYear: 20 });
  });
});

describe('slice 3: smallest-admissible down payment', () => {
  for (const id of ['target-interior-floor', 'matrix-rich-surplus']) {
    it(`uses only the percentage and annuity floors: ${id}`, () => {
      const result = run(id), plan = result.plans.earliest;
      const golden = fixtures[id].expected.plans.earliest;
      expect(plan.dealMonth).toBe(golden.dealMonth);
      moneyEqual(plan.savingsGoal.minimumDownPayment, golden.savingsGoal.minimumDownPayment);
      moneyEqual(plan.savingsGoal.actualDownPayment, golden.savingsGoal.actualDownPayment);
      moneyEqual(plan.loan.principal, golden.loan.principal);
      moneyEqual(plan.loan.contractualAnnuity, golden.loan.contractualAnnuity);
      moneyEqual(plan.loan.firstMonthInterest, golden.loan.firstMonthInterest);
      expect(plan.loan.contractualAnnuity).toBeLessThanOrEqual(result.monthlyBudget + 1e-8);
    });
  }
});

describe('slice 4: minimal reserve and exact split', () => {
  for (const id of ['matrix-immediate-reserve', 'matrix-wait-reserve', 'target-prefix-offset', 'target-yield-reserve-nominal', 'matrix-cash-future-income']) {
    it(`funds the discounted prefix maximum: ${id}`, () => {
      const result = run(id);
      for (const key of ['earliest', 'cash']) {
        const golden = fixtures[id].expected.plans[key];
        if (!golden) continue;
        const plan = result.plans[key];
        expect(plan.dealMonth).toBe(golden.dealMonth);
        for (const field of Object.keys(golden.savingsGoal)) moneyEqual(plan.savingsGoal[field], golden.savingsGoal[field], `${id}.${key}.${field}`);
        expect(plan.savingsGoal.renovationSavings + plan.savingsGoal.deficitReserve).toBe(plan.savingsGoal.totalReserve);
      }
    });
  }
});

const boundaryIndices = (plan) => ({
  beforeDeal: plan.dealMonth > 0 ? plan.dealMonth - 1 : null,
  deal: plan.dealMonth,
  firstWork: plan.workMonths > 0 ? plan.dealMonth : null,
  lastWork: plan.workMonths > 0 ? plan.moveMonth - 1 : null,
  moveIn: plan.moveMonth,
  lastLoanPayment: plan.loan?.lastPaymentRowMonth ?? null
});

describe('slice 5: complete ledger and boundary ordering', () => {
  for (const id of ['matrix-no-renovation-long', 'target-interior-floor']) {
    it(`reconciles every row and performs deal before yield: ${id}`, () => {
      const result = run(id);
      for (const key of ['earliest', 'cash']) {
        const plan = result.plans[key], golden = fixtures[id].expected.plans[key];
        if (!golden) continue;
        expect(plan.ledger.length).toBeGreaterThan(plan.dealMonth);
        for (const [index, row] of plan.ledger.entries()) {
          expect(row.month).toBe(index);
          moneyEqual(row.openingCash, index ? plan.ledger[index - 1].closingCash : fixtures[id].inputs.savings);
          moneyEqual(row.closingCash, row.openingCash - row.purchaseCapital + row.depositYield + row.budgetIncome - row.rent - row.renovation - row.interest - row.principal);
        }
        const indices = boundaryIndices(plan);
        for (const [name, expectedRow] of Object.entries(golden.boundaryRows)) {
          if (name === 'lastLoanPayment') continue;
          const actual = indices[name] === null ? null : plan.ledger[indices[name]] ?? null;
          if (!expectedRow) { expect(actual).toBeNull(); continue; }
          for (const [field, value] of Object.entries(expectedRow)) {
            if (field === 'savings') continue;
            if (field === 'month') expect(actual[field]).toBe(value);
            else moneyEqual(actual[field], value, `${id}.${key}.${name}.${field}`);
          }
        }
      }
    });
  }
  it('includes the cash deal row with zero work duration and no rows afterward', () => {
    const plan = run('matrix-no-renovation-long').plans.cash;
    expect(plan.ledger.length).toBe(plan.dealMonth + 1);
    expect(plan.ledger.at(-1).purchaseCapital).toBe(1000);
    expect(plan.ledger.at(-1).rent).toBe(0);
  });
});

describe('slice 7: chart savings field from actual row flows', () => {
  it('long mode retains the unconsumed budget as savings', () => {
    const plan = run('matrix-no-renovation-long').plans.earliest;
    const golden = fixtures['matrix-no-renovation-long'].expected.plans.earliest;
    moneyEqual(plan.ledger[0].savings, golden.boundaryRows.deal.savings, 'deal.savings');
    moneyEqual(plan.ledger[golden.loan.lastPaymentRowMonth].savings, golden.boundaryRows.lastLoanPayment.savings, 'lastPayment.savings');
    for (const row of plan.ledger) {
      moneyEqual(row.savings, Math.max(0, row.budgetIncome - row.rent - row.renovation - row.interest - row.principal), `row ${row.month}.savings`);
    }
  });
  it('fast mode reports zero savings on loan rows and the remainder after payoff', () => {
    const plan = run('matrix-no-renovation-fast').plans.earliest;
    const golden = fixtures['matrix-no-renovation-fast'].expected.plans.earliest;
    moneyEqual(plan.ledger[0].savings, golden.boundaryRows.deal.savings, 'deal.savings');
    expect(plan.ledger[0].savings).toBe(0);
    moneyEqual(plan.ledger[golden.loan.lastPaymentRowMonth].savings, golden.boundaryRows.lastLoanPayment.savings, 'lastPayment.savings');
    for (const row of plan.ledger) {
      moneyEqual(row.savings, Math.max(0, row.budgetIncome - row.rent - row.renovation - row.interest - row.principal), `row ${row.month}.savings`);
    }
  });
});

describe('slice 8: fast-mode protected early repayment', () => {
  for (const id of ['matrix-zero-rates', 'matrix-immediate-reserve', 'matrix-wait-reserve', 'rich-fast']) {
    it(`repays unprotected cash down to remaining-obligation protection: ${id}`, () => {
      const entry = fixtures[id];
      const plan = model.calculate(entry.inputs, entry.repaymentMode, entry.renovation, entry.selectedCriterion).plans.earliest;
      const golden = entry.expected.plans.earliest;
      expect(plan.loan.repaymentMonths).toBe(golden.loan.repaymentMonths);
      expect(plan.loan.lastPaymentRowMonth).toBe(golden.loan.lastPaymentRowMonth);
      moneyEqual(plan.loan.totalInterest, golden.loan.totalInterest, `${id}.totalInterest`);
      moneyEqual(plan.totals.finalCash, golden.totals.finalCash, `${id}.finalCash`);
      expect(plan.ledger.length).toBe(Math.max(golden.loan.lastPaymentRowMonth, golden.moveMonth - 1) + 1);
      const indices = boundaryIndices(plan);
      for (const [name, expectedRow] of Object.entries(golden.boundaryRows)) {
        const actual = indices[name] === null ? null : plan.ledger[indices[name]] ?? null;
        if (!expectedRow) { expect(actual, `${id}.${name}`).toBeNull(); continue; }
        for (const [field, value] of Object.entries(expectedRow)) {
          if (field === 'month') expect(actual[field], `${id}.${name}.month`).toBe(value);
          else moneyEqual(actual[field], value, `${id}.${name}.${field}`);
        }
      }
      for (const row of plan.ledger) {
        if (row.closingLoanPrincipal > 0.01) expect(row.closingCash, `${id} row ${row.month}`).toBeLessThanOrEqual(row.protectedReserveAfter + 0.01);
      }
    });
  }
  it('keeps the savings goal of the mandatory schedule in fast mode', () => {
    const entry = fixtures['matrix-immediate-reserve'];
    const plan = model.calculate(entry.inputs, entry.repaymentMode, entry.renovation, entry.selectedCriterion).plans.earliest;
    for (const [field, value] of Object.entries(entry.expected.plans.earliest.savingsGoal)) {
      moneyEqual(plan.savingsGoal[field], value, `savingsGoal.${field}`);
    }
  });
});

describe('slice 9: interestBelowRent threshold search', () => {
  const cases = [
    ['matrix-threshold-base', 144], ['rich-fast', 118], ['target-payoff-beyond720', 432],
    ['matrix-cash-future-income', 0], ['matrix-immediate-reserve', null], ['target-strict-equality', null]
  ];
  for (const [id, dealMonth] of cases) {
    it(`finds the first qualifying boundary with strictly lower first-month interest: ${id}`, () => {
      const entry = fixtures[id];
      const plan = model.calculate(entry.inputs, entry.repaymentMode, entry.renovation, entry.selectedCriterion).plans.interestBelowRent;
      const golden = entry.expected.plans.interestBelowRent;
      if (golden === null) { expect(plan, id).toBeNull(); return; }
      expect(plan.kind, id).toBe(golden.kind);
      expect(plan.dealMonth, id).toBe(dealMonth);
      if (plan.loan) expect(plan.loan.firstMonthInterest, id).toBeLessThan(plan.indexedRentAtDeal);
      else expect(plan.loan, id).toBeNull();
      moneyEqual(plan.propertyPriceAtDeal, golden.propertyPriceAtDeal, `${id}.price`);
      moneyEqual(plan.indexedRentAtDeal, golden.indexedRentAtDeal, `${id}.rent`);
      if (golden.loan) {
        moneyEqual(plan.loan.principal, golden.loan.principal, `${id}.principal`);
        moneyEqual(plan.loan.contractualAnnuity, golden.loan.contractualAnnuity, `${id}.annuity`);
        moneyEqual(plan.loan.firstMonthInterest, golden.loan.firstMonthInterest, `${id}.firstInterest`);
        expect(plan.loan.lastPaymentRowMonth, id).toBe(golden.loan.lastPaymentRowMonth);
      }
    });
  }
  it('keeps the threshold plan available without earliest fallback when selected', () => {
    const result = run('target-payoff-beyond720');
    expect(result.selectedCriterion).toBe('interestBelowRent');
    expect(result.selectionStatus).toBe('available');
    expect(result.selectedPlan.dealMonth).toBe(432);
  });
  it('reports an unavailable selected criterion without falling back to earliest', () => {
    const result = run('target-strict-equality');
    expect(result.selectionStatus).toBe('unavailable');
    expect(result.selectedPlan).toBeNull();
    expect(result.plans.earliest.dealMonth).toBe(0);
    expect(result.selectionReason).toMatch(/[А-Яа-я]/);
  });
});

describe('slice 10: buildCashflow projection', () => {
  it('projects the ledger without replanning, for selected and unselected plans alike', () => {
    const entry = fixtures['matrix-immediate-reserve'];
    const result = model.calculate(entry.inputs, entry.repaymentMode, entry.renovation, entry.selectedCriterion);
    for (const plan of [result.selectedPlan, result.plans.cash]) {
      const flow = model.buildCashflow(plan);
      expect(flow.dealMonth).toBe(plan.dealMonth);
      expect(flow.moveMonth).toBe(plan.moveMonth);
      expect(flow.rows.length).toBe(plan.ledger.length);
      for (const [index, row] of flow.rows.entries()) {
        expect(row.month).toBe(index);
        for (const field of ['savings', 'rent', 'renovation', 'interest', 'principal', 'openingCash', 'cashAfterDeal', 'depositYield', 'budgetIncome', 'purchaseCapital', 'protectedReserveAfter', 'closingCash']) {
          expect(row[field]).toBe(plan.ledger[index][field]);
        }
      }
      const stack = (row) => row.savings + row.rent + row.renovation + row.interest + row.principal;
      expect(flow.maximum).toBe(Math.max(1, ...flow.rows.map(stack)));
      expect(flow.maximum).toBeGreaterThanOrEqual(1);
    }
  });
  it('returns null for a null plan and never mutates the plan it projected', () => {
    expect(model.buildCashflow(null)).toBeNull();
    const entry = fixtures['matrix-zero-rates'];
    const result = model.calculate(entry.inputs, entry.repaymentMode, entry.renovation, entry.selectedCriterion);
    const before = structuredClone(result.selectedPlan);
    const first = model.buildCashflow(result.selectedPlan);
    const second = model.buildCashflow(result.selectedPlan);
    expect(second).toEqual(first);
    expect(result.selectedPlan).toEqual(before);
  });
});

describe('slice 6: contractual amortization and L-limited totals', () => {
  for (const id of ['matrix-no-renovation-long', 'target-interior-floor', 'rich-long', 'target-yield-reserve-nominal']) {
    it(`retains cash and pays the original annuity: ${id}`, () => {
      const plan = run(id).plans.earliest, golden = fixtures[id].expected.plans.earliest;
      for (const [key, value] of Object.entries(golden.loan)) {
        if (['repaymentMonths', 'lastPaymentRowMonth', 'lastPaymentBoundaryMonth'].includes(key)) expect(plan.loan[key]).toBe(value);
        else moneyEqual(plan.loan[key], value, `${id}.loan.${key}`);
      }
      for (const [key, value] of Object.entries(golden.totals)) moneyEqual(plan.totals[key], value, `${id}.totals.${key}`);
      expect(plan.ledger.every((row) => row.earlyRepayment === 0)).toBe(true);
      expect(plan.ledger.length).toBe(Math.max(plan.loan.lastPaymentRowMonth, plan.moveMonth - 1) + 1);
      for (const row of plan.ledger.filter((row) => row.openingLoanPrincipal > 0)) {
        moneyEqual(row.contractualPayment, Math.min(plan.loan.contractualAnnuity, row.openingLoanPrincipal + row.interest));
      }
      expect(plan.ledger[plan.loan.lastPaymentRowMonth].closingLoanPrincipal).toBeLessThanOrEqual(0.01);
    });
  }
});

const ENTRY_IDS = Object.keys(fixtures);
const PLAN_KEYS = ['earliest', 'interestBelowRent', 'cash'];
const pad = (value) => String(value).padStart(2, '0');
const isoDate = (referenceDate, months) => {
  const date = addMonths(new Date(referenceDate + 'T00:00:00'), months);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const compareRow = (actual, expectedRow, label) => {
  expect(actual, label).not.toBeNull();
  for (const [field, value] of Object.entries(expectedRow)) {
    if (field === 'month') expect(actual[field], `${label}.month`).toBe(value);
    else moneyEqual(actual[field], value, `${label}.${field}`);
  }
};
const comparePlanSummary = (id, key, plan, golden, entry) => {
  expect(plan.kind, `${id}.${key}.kind`).toBe(golden.kind);
  expect(plan.dealMonth, `${id}.${key}.dealMonth`).toBe(golden.dealMonth);
  expect(plan.moveMonth, `${id}.${key}.moveMonth`).toBe(golden.moveMonth);
  expect(plan.workMonths, `${id}.${key}.workMonths`).toBe(golden.workMonths);
  for (const field of ['propertyPriceAtDeal', 'renovationCostAtDeal', 'renovationMonthlyPayment', 'availableSavingsAtDeal', 'indexedRentAtDeal']) {
    moneyEqual(plan[field], golden[field], `${id}.${key}.${field}`);
  }
  for (const [field, value] of Object.entries(golden.savingsGoal)) moneyEqual(plan.savingsGoal[field], value, `${id}.${key}.savingsGoal.${field}`);
  if (golden.loan === null) expect(plan.loan, `${id}.${key}.loan`).toBeNull();
  else {
    expect(plan.loan, `${id}.${key}.loan`).not.toBeNull();
    for (const [field, value] of Object.entries(golden.loan)) {
      if (['repaymentMonths', 'lastPaymentRowMonth', 'lastPaymentBoundaryMonth'].includes(field)) expect(plan.loan[field], `${id}.${key}.loan.${field}`).toBe(value);
      else moneyEqual(plan.loan[field], value, `${id}.${key}.loan.${field}`);
    }
  }
  for (const [field, value] of Object.entries(golden.totals)) moneyEqual(plan.totals[field], value, `${id}.${key}.totals.${field}`);
  expect(plan.calendarDates ?? {
    dealDate: isoDate(entry.referenceDate, plan.dealMonth),
    moveDate: isoDate(entry.referenceDate, plan.moveMonth),
    lastPaymentDate: plan.loan ? isoDate(entry.referenceDate, plan.loan.lastPaymentBoundaryMonth) : null
  }, `${id}.${key}.calendarDates`).toEqual(golden.calendarDates);
  const indices = boundaryIndices(plan);
  for (const [name, expectedRow] of Object.entries(golden.boundaryRows)) {
    const index = indices[name];
    const actual = index === null ? null : plan.ledger[index] ?? null;
    if (expectedRow === null) { expect(actual, `${id}.${key}.boundaryRows.${name}`).toBeNull(); continue; }
    compareRow(actual, expectedRow, `${id}.${key}.boundaryRows.${name}`);
  }
};

describe('full sweep: every golden entry end to end', () => {
  for (const id of ENTRY_IDS) {
    it(`matches statuses, envelope, all three plans and the selected plan: ${id}`, () => {
      const entry = fixtures[id];
      const result = model.calculate(entry.inputs, entry.repaymentMode, entry.renovation, entry.selectedCriterion);
      const golden = entry.expected;
      expect(result.status, `${id}.status`).toBe(golden.statuses.status);
      expect(result.validationErrors, `${id}.validationErrors`).toEqual(golden.statuses.validationErrors);
      expect(result.selectedCriterion, `${id}.selectedCriterion`).toBe(golden.statuses.selectedCriterion);
      expect(result.selectionStatus, `${id}.selectionStatus`).toBe(golden.statuses.selectionStatus);
      if (golden.statuses.selectionReason === null) expect(result.selectionReason, `${id}.selectionReason`).toBeNull();
      else {
        expect(typeof result.selectionReason, `${id}.selectionReason`).toBe('string');
        expect(result.selectionReason.length > 0 && /[А-Яа-я]/.test(result.selectionReason), `${id}.selectionReason`).toBe(true);
      }
      moneyEqual(result.monthlyBudget, golden.monthlyBudget, `${id}.monthlyBudget`);
      moneyEqual(result.forecast.propertyInYear, golden.forecast.propertyInYear, `${id}.propertyInYear`);
      moneyEqual(result.forecast.rentInYear, golden.forecast.rentInYear, `${id}.rentInYear`);
      for (const key of PLAN_KEYS) {
        const planGolden = golden.plans[key];
        if (planGolden === null) { expect(result.plans[key], `${id}.plans.${key}`).toBeNull(); continue; }
        comparePlanSummary(id, key, result.plans[key], planGolden, entry);
      }
      if (golden.selectedPlan === null) expect(result.selectedPlan, `${id}.selectedPlan`).toBeNull();
      else {
        expect(result.selectedPlan, `${id}.selectedPlanEcho`).toEqual(result.plans[result.selectedCriterion]);
        comparePlanSummary(id, 'selected', result.selectedPlan, golden.selectedPlan, entry);
      }
      if (result.selectedPlan) {
        const flow = model.buildCashflow(result.selectedPlan);
        expect(flow.maximum, `${id}.cashflow.maximum`).toBeGreaterThanOrEqual(1);
        expect(flow.rows.length, `${id}.cashflow.rows`).toBe(result.selectedPlan.ledger.length);
      }
    });
  }
});

describe('invariants: every plan of every entry', () => {
  const results = new Map(ENTRY_IDS.map((id) => {
    const entry = fixtures[id];
    return [id, model.calculate(entry.inputs, entry.repaymentMode, entry.renovation, entry.selectedCriterion)];
  }));
  for (const id of ENTRY_IDS) {
    const entry = fixtures[id];
    if (entry.expected.statuses.status !== 'ok') continue;
    for (const key of PLAN_KEYS) {
      if (entry.expected.plans[key] === null) continue;
      it(`${id}/${key} closes every row and conserves every total`, () => {
        const result = results.get(id);
        const plan = result.plans[key];
        const q = 1 + entry.inputs.depositRate / 100 / 12;
        const growth = 1 + entry.inputs.inflation / 100;
        const L = plan.loan ? Math.max(plan.loan.lastPaymentRowMonth, plan.moveMonth - 1) : Math.max(plan.dealMonth, plan.moveMonth - 1);
        expect(plan.ledger.length, `${id}/${key} ledger length`).toBe(L + 1);
        const sums = { rent: 0, renovation: 0, interest: 0, principal: 0, depositYield: 0, budgetIncome: 0, purchaseCapital: 0 };
        for (const [index, row] of plan.ledger.entries()) {
          moneyEqual(row.closingCash, row.openingCash - row.purchaseCapital + row.depositYield + row.budgetIncome - row.rent - row.renovation - row.interest - row.principal, `${id}/${key} row ${index} reconciliation`);
          expect(row.closingCash, `${id}/${key} row ${index} nonnegative cash`).toBeGreaterThanOrEqual(-0.01);
          moneyEqual(row.openingCash, index ? plan.ledger[index - 1].closingCash : entry.inputs.savings, `${id}/${key} row ${index} opening chain`);
          moneyEqual(row.budgetIncome, result.monthlyBudget, `${id}/${key} row ${index} fixed budget`);
          moneyEqual(row.depositYield, (q - 1) * row.cashAfterDeal, `${id}/${key} row ${index} yield`);
          moneyEqual(row.savings, Math.max(0, row.budgetIncome - row.rent - row.renovation - row.interest - row.principal), `${id}/${key} row ${index} savings formula`);
          const onWorkRow = index >= plan.dealMonth && index < plan.moveMonth;
          if (onWorkRow) moneyEqual(row.renovation, plan.renovationMonthlyPayment, `${id}/${key} row ${index} work installment`);
          else moneyEqual(row.renovation, 0, `${id}/${key} row ${index} no renovation off work`);
          if (index < plan.dealMonth) moneyEqual(row.renovation, 0, `${id}/${key} row ${index} no renovation before deal`);
          if (plan.loan && row.openingLoanPrincipal > 0.01) {
            moneyEqual(row.contractualPayment, Math.min(plan.loan.contractualAnnuity, row.openingLoanPrincipal + row.interest), `${id}/${key} row ${index} full contractual payment`);
            expect(row.closingLoanPrincipal, `${id}/${key} row ${index} nonnegative principal`).toBeGreaterThanOrEqual(-0.01);
          }
          if (entry.repaymentMode === 'fast' && plan.loan && row.closingLoanPrincipal > 0.01) {
            expect(row.closingCash, `${id}/${key} row ${index} unprotected surplus`).toBeLessThanOrEqual(row.protectedReserveAfter + 0.01);
          }
          for (const field of Object.keys(sums)) sums[field] += row[field];
        }
        if (plan.loan) expect(plan.loan.repaymentMonths, `${id}/${key} payment opportunities`).toBeLessThanOrEqual(360);
        else expect(sums.principal, `${id}/${key} zero principal`).toBeLessThanOrEqual(0.01);
        for (const [field, value] of Object.entries(sums)) moneyEqual(plan.totals[field], value, `${id}/${key} totals.${field}`);
        moneyEqual(plan.totals.finalCash, plan.ledger.at(-1).closingCash, `${id}/${key} totals.finalCash`);
        moneyEqual(sums.renovation, plan.renovationCostAtDeal, `${id}/${key} renovation conservation`);
        if (plan.loan) moneyEqual(sums.principal, plan.loan.principal, `${id}/${key} principal conservation`);
        let prefix = 0;
        for (let m = 0; m < plan.moveMonth; m += 1) prefix += entry.inputs.rent * Math.pow(growth, m / 12);
        moneyEqual(sums.rent, prefix, `${id}/${key} rent prefix`);
        moneyEqual(sums.rent, model.rentPaidUntilMonth(entry.inputs, plan.moveMonth), `${id}/${key} rentPaidUntilMonth cross-check`);
        moneyEqual(plan.savingsGoal.renovationSavings + plan.savingsGoal.deficitReserve, plan.savingsGoal.totalReserve, `${id}/${key} reserve split`);
        moneyEqual(plan.savingsGoal.totalRequiredSavings, plan.savingsGoal.actualDownPayment + plan.savingsGoal.cashPurchasePrice + plan.savingsGoal.totalReserve, `${id}/${key} goal total`);
      });
    }
  }
});

describe('paymentForTerm and rentPaidUntilMonth units', () => {
  it('paymentForTerm: zero principal is 0, zero rate is L/N', () => {
    expect(model.paymentForTerm(0, 16.9, 360)).toBe(0);
    expect(model.paymentForTerm(1200000, 0, 360)).toBeCloseTo(1200000 / 360, 6);
    expect(model.paymentForTerm(500000, 0, 25)).toBeCloseTo(20000, 6);
  });
  it('paymentForTerm: standard annuity values from independent worked examples', () => {
    moneyEqual(model.paymentForTerm(1000000, 12, 12), 88848.79);
    moneyEqual(model.paymentForTerm(8000000, 16.9, 360), 113404.77);
  });
  it('rentPaidUntilMonth: zero rent, zero horizon, exact and indexed sums, ceiling', () => {
    const zero = { rent: 0, inflation: 5 };
    expect(model.rentPaidUntilMonth(zero, 12)).toBe(0);
    expect(model.rentPaidUntilMonth({ rent: 7, inflation: 0 }, 0)).toBe(0);
    expect(model.rentPaidUntilMonth({ rent: 7, inflation: 0 }, 5)).toBeCloseTo(35, 10);
    moneyEqual(model.rentPaidUntilMonth({ rent: 80000, inflation: 5 }, 13), 1065806.20);
    expect(model.rentPaidUntilMonth({ rent: 80000, inflation: 5 }, 2.5)).toBeCloseTo(model.rentPaidUntilMonth({ rent: 80000, inflation: 5 }, 3), 10);
  });
});

describe('export surface: exactly the contract symbols', () => {
  it('exports the ten contract names and no compatibility aliases', () => {
    expect(Object.keys(model).sort()).toEqual([
      'AFFORDABILITY_HORIZON_MONTHS', 'DEFAULTS', 'MAX_LOAN_MONTHS', 'NO_RENOVATION',
      'RENOVATION_COST_SHARE', 'SIMULATION_HORIZON_MONTHS',
      'buildCashflow', 'calculate', 'paymentForTerm', 'rentPaidUntilMonth'
    ].sort());
  });
  it('keeps the contract constant values', () => {
    expect(model.DEFAULTS).toEqual({ savings: 0, monthlySavings: 50000, mortgageRate: 16.9, propertyPrice: 10000000, downPaymentPercent: 20, inflation: 5, rent: 80000, depositRate: 11.5 });
    expect(model.NO_RENOVATION).toEqual({ needed: false, cost: 0, months: 0 });
    expect(model.RENOVATION_COST_SHARE).toBe(0.15);
    expect(model.SIMULATION_HORIZON_MONTHS).toBe(720);
    expect(model.AFFORDABILITY_HORIZON_MONTHS).toBe(360);
    expect(model.MAX_LOAN_MONTHS).toBe(360);
  });
});
