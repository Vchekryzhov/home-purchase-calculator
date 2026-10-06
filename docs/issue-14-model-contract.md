# Issue #14: binding model contract

> **Ревизия по issue #15 (2026-10-06).** Добавлен независимый вход `salaryIndexPercent` («Процент индексации зарплаты», годовой процент, по умолчанию 5 — при начальной загрузке и при сбросе формы): он индексирует только ежемесячную способность откладывать, `M(m) = M0 × (1 + salaryIndexPercent/100)^(m/12)`. Из решений #14 пересмотрено ровно одно — фиксированность номинального месячного бюджета, и только в части индексируемых накоплений; аренда как расход, цена жилья, стоимость ремонта и доходность вклада сохраняют прежние механизмы, остальные решения #14 действуют без изменений. При `salaryIndexPercent = 0` модель в точности воспроизводит прежнее поведение. MCP-интерфейс (`configure_home_purchase_calculator`) выставляет `salaryIndexPercent` отдельным параметром с тем же смыслом и начальным значением 5. README обновлён синхронно.

## Resolved decisions

Все восемь решений утверждены и включены в нормативные разделы ниже:

1. `workMonths` — длительность, не абсолютный месяц.
2. Каждый ненулевой результат трёх поисков содержит полный ledger и totals.
3. Ledger заканчивается последней строкой обязательств; после неё начислений нет.
4. Нормализация, исчерпывающие invalid-input случаи и формат сообщений зафиксированы.
5. Chart-поле `savings` вычисляется из фактических потоков строки.
6. Диапазон допустимых взносов реализован единственным smallest-admissible allocation, без оптимизации диапазона.
7. Поиски критериев mortgage-only; cash comparison не подставляется вместо них, нулевое тело использует cash representation.
8. Cash ledger-end включает строку сделки; противоречие найдено независимой проверкой и разрешено оркестратором.

## Назначение и источники

Контракт заменяет старую двухрежимную модель ремонта в `src/lib/model.js`, её использование в `src/App.vue` и старые ожидания `src/lib/model.test.js`/`model.characterization.json`. README обновлён синхронно с ревизией issue #15 (см. заметку вверху); нормативным источником семантики остаётся этот контракт. Независимая проверка: [issue-14-verification.md](issue-14-verification.md).

## Public interface

Сохраните экспорты `calculate`, `buildCashflow`, `paymentForTerm`, `rentPaidUntilMonth`, `DEFAULTS`, `NO_RENOVATION`, `RENOVATION_COST_SHARE`, `SIMULATION_HORIZON_MONTHS`, `AFFORDABILITY_HORIZON_MONTHS`, `MAX_LOAN_MONTHS`.

```js
NO_RENOVATION = { needed: false, cost: 0, months: 0 }
RENOVATION_COST_SHARE = 0.15
SIMULATION_HORIZON_MONTHS = 720
AFFORDABILITY_HORIZON_MONTHS = 360
MAX_LOAN_MONTHS = 360

calculate(rawInputs, repaymentMode /* 'fast' | 'long' */,
  renovation = NO_RENOVATION, selectedCriterion = 'earliest')
buildCashflow(plan)
paymentForTerm(principal, annualRate, months = MAX_LOAN_MONTHS)
rentPaidUntilMonth(rawInputs, month)
```

`rawInputs` использует поля `savings`, `monthlySavings`, `mortgageRate`, `propertyPrice`, `downPaymentPercent`, `inflation`, `rent`, `depositRate`, `salaryIndexPercent`. Сохраните `DEFAULTS`: соответственно 0, 50000, 16.9, 10000000, 20, 5, 80000, 11.5, 5. `salaryIndexPercent` — годовой процент индексации способности откладывать (см. Indexing & accumulation); он полностью независим от `inflation` и меняется только явным вводом. MCP-интерфейс (`configure_home_purchase_calculator`) выставляет `salaryIndexPercent` отдельным параметром с тем же смыслом и начальным значением 5.

Ремонт: только `{ needed, cost, months }`. Остаточное свойство `funding` игнорируйте без ветвления. `buildCashflow(plan)` принимает рассчитанный план: NEVER replans or re-searches. Модель никогда не вызывает `new Date()`; календарные даты — ответственность UI/проверки при явно заданной опорной дате.

### Input normalization & validation

Нормализуйте каждое из девяти числовых полей `rawInputs` через `Math.max(0, Number(x) || 0)`. Стоимость ремонта нормализуйте тем же числовым преобразованием; `renovation.months` — через `Math.max(0, Math.round(months))`.

Случаи `invalid-input` исчерпывающе заданы следующими условиями и точными UI-facing строками в `validationErrors`:

- `renovation.needed && normalized cost > 0 && normalized months === 0`: `Для ремонта с ненулевой стоимостью укажите срок не менее 1 месяца`.
- `repaymentMode` не в `{'fast','long'}`: `Неизвестный режим погашения`.
- `selectedCriterion` не в `{'earliest','interestBelowRent'}`: `Неизвестный критерий выбора плана`.

`validationErrors` — массив этих человекочитаемых русских строк, не объектов или кодов. `status = 'invalid-input'` ⇒ `selectionStatus = 'invalid-input'`, `selectedPlan = null` и все три `plans` равны null. Другие условия невыполнимости кандидата не добавляют invalid-input случаев.

`selectionReason = null` if and only if `selectionStatus === 'available'`; иначе это непустая правдивая русская строка. Её точная формулировка свободна для реализации, но не должна противоречить причине.

## Result shape

```js
{
  status: 'ok' | 'invalid-input',
  validationErrors: [],
  monthlyBudget: Number, // today's monthlySavings + rent
  selectedCriterion: 'earliest' | 'interestBelowRent',
  selectionStatus: 'available' | 'unavailable' | 'invalid-input',
  selectionReason: null | String,
  plans: { earliest: Plan | null, interestBelowRent: Plan | null, cash: Plan | null },
  selectedPlan: Plan | null,
  forecast: { propertyInYear: Number, rentInYear: Number }
}
```

`selectedPlan` выбирается исключительно по `selectedCriterion`, без fallback. Недоступность — не ошибка входов: `status = 'ok'`, `selectionStatus = 'unavailable'`, `selectedPlan = null`, явное объяснение. Некорректный ввод даёт `invalid-input`, а не выдуманный выполнимый план. `forecast.propertyInYear = propertyPrice * g`, `forecast.rentInYear = rent * g`.

```js
Plan = {
  kind: 'mortgage' | 'cash',
  dealMonth: Number, moveMonth: Number, // absolute boundary months
  workMonths: Number, // duration: normalized renovation.months when needed, otherwise 0
  propertyPriceAtDeal: Number,
  renovationCostAtDeal: Number,
  renovationMonthlyPayment: Number,
  availableSavingsAtDeal: Number,
  indexedRentAtDeal: Number,
  savingsGoal: {
    minimumDownPayment: Number,
    actualDownPayment: Number,
    cashPurchasePrice: Number,
    renovationSavings: Number,
    deficitReserve: Number,
    totalReserve: Number,
    totalRequiredSavings: Number,
    optionalSurplus: Number
  },
  loan: null | {
    principal: Number,
    contractualAnnuity: Number,
    firstMonthInterest: Number,
    repaymentMonths: Number,
    lastPaymentRowMonth: Number, // absolute row index
    lastPaymentBoundaryMonth: Number, // absolute boundary month
    totalInterest: Number,
    totalPrincipal: Number
  },
  totals: {
    rent: Number, renovation: Number, interest: Number, principal: Number,
    depositYield: Number, budgetIncome: Number, purchaseCapital: Number,
    finalCash: Number
  },
  ledger: [MonthlyRow]
}
```

`workMonths` — DURATION: число месяцев работ, равное нормализованному `renovation.months` при включённом ремонте (иначе 0), никогда не абсолютный месяц. `moveMonth = dealMonth + workMonths`; ниже `w = workMonths`. Только `dealMonth`, `moveMonth`, `lastPaymentRowMonth`, `lastPaymentBoundaryMonth` задают абсолютные месяцы плана; `repaymentMonths` также длительность. `minimumDownPayment` — процентный минимум (для cash информационный). `actualDownPayment = 0` у cash; `cashPurchasePrice = 0` у mortgage. `renovationSavings` — начальный капитал, не полная стоимость ремонта и не доля будущего дохода. `totalReserve = renovationSavings + deficitReserve` exactly. `totalRequiredSavings = actualDownPayment + totalReserve` для mortgage, `cashPurchasePrice + totalReserve` для cash. `optionalSurplus = availableSavingsAtDeal - totalRequiredSavings`; показывайте отдельно, не добавляйте к взносу.

EVERY non-null plan в `plans.earliest`, `plans.interestBelowRent`, `plans.cash` содержит FULL ledger и totals, независимо от выбранного критерия.

У cash `loan = null`, `cashPurchasePrice = propertyPriceAtDeal`. Для проверки порога cash используйте `firstMonthInterest = 0`: строго меньше индексированной аренды; нулевая аренда не проходит.

```js
MonthlyRow = {
  month, openingCash, purchaseCapital, cashAfterDeal, depositYield,
  budgetIncome, rent, renovation, openingLoanPrincipal,
  contractualPayment, earlyRepayment, interest, principal,
  closingLoanPrincipal, renovationFromIncome, renovationFromCash,
  nonRenovationFromCash, protectedReserveAfter, closingCash, savings
}
```

Все перечисленные row-поля обязательны минимум; денежные поля — числа. `month` — абсолютный индекс строки. `purchaseCapital` ненулевой только на строке сделки: фактический взнос либо полная cash-цена. `cashAfterDeal = openingCash - purchaseCapital`; `depositYield = (q - 1) * cashAfterDeal`; `budgetIncome = today's rent + M(m)` для месяца строки `m`. `principal` включает договорное и досрочное погашение, но не первоначальный взнос. `contractualPayment = interest + principal - earlyRepayment`. `closingLoanPrincipal = openingLoanPrincipal - principal`. До сделки кредитные поля нулевые; у cash они всегда нулевые.

Row reconciliation (MUST hold to documented epsilon):

```text
closingCash = openingCash − purchaseCapital + depositYield + budgetIncome − rent − renovation − interest − principal
```

Следующая строка открывается с `openingCash = previous.closingCash`; первая — с входных `savings`. Totals суммируют одноимённые ledger-потоки; `finalCash` — последний `closingCash`. Не учитывайте `purchaseCapital` повторно как `principal` или месячную бюджетную трату.

Последняя ledger-строка `L`:

- Mortgage plans (`loan ≠ null`): `L = max(lastPaymentRowMonth, moveMonth − 1)` — без изменений; `n ≥ 1` платежей всегда включают строку `d`.
- Cash plans (`loan = null`): `L = max(dealMonth, moveMonth − 1)`. При `w ≥ 1` это по-прежнему `d + w − 1`; при `w = 0` ledger включает саму строку сделки `d`: строки ожидания `0…d−1` плюс строка `d` с операцией покупки. Аренда на строке `d` равна 0, поскольку `month d = moveMonth`. Строк после `d` нет — после неё ничего не начисляется.

Totals (включая `finalCash`, `depositYield`, `budgetIncome`) относятся только к ledger-строкам; после последней строки ничего не начисляется. Boundary row `d` всегда присутствует у каждого плана. Для индексов `> L` ожидания boundary rows записывайте как явно отсутствующие/not applicable, не создавайте фиктивные строки.

`buildCashflow(plan)` возвращает:

```js
{ rows: [{ month, savings, rent, renovation, interest, principal,
           /* cash/yield/protection fields for tooltips */ }],
  dealMonth, moveMonth, maximum }
```

Проецируйте ledger без новой финансовой симуляции. Для tooltip сохраните поля наличных, доходности, операции сделки, защищённого резерва и источников оплаты. `maximum` учитывает реальный максимальный стек `savings + rent + renovation + interest + principal` (как в существующем графике, нижняя граница 1), а не ограничивается месячным доходом. Отсутствующий `selectedPlan` обрабатывайте в UI как empty state, не передавайте другой план автоматически.

Chart-поле из ACTUAL row flows:

```text
savings = max(0, budgetIncome − rent − renovation − interest − principal)
```

Это удержанная часть дохода месяца, не stock balance. В fast излишек направляется на early repayment (внутри `principal`), поэтому такие строки показывают `savings = 0`; в long излишек накапливается и отображается как savings. До сделки поле показывает `budgetIncome(m) − rent(m)`, либо 0 при `rent(m) ≥ budgetIncome(m)`; превышение аренды в таком месяце — видимое списание наличных. Deposit yield NEVER appears in `savings`. Expense stacks are never clamped to keep the total within `budgetIncome(m)`.

## Indexing & accumulation

```text
B = today's monthlySavings + today's rent (today's-prices base; display, NOT a varying income)
g = 1 + inflation/100
q = 1 + depositRate/100/12
M0 = today's monthlySavings
M(m) = M0 × (1 + salaryIndexPercent/100)^(m/12)
budgetIncome(m) = today's rent + M(m)
price(d) = propertyPrice × g^(d/12)
rent(m) = rent × g^(m/12)
reno(d) = renovationCost × g^(d/12)
S(0) = savings
S(m+1) = q·S(m) + budgetIncome(m) − rent(m)
```

`monthlyBudget` в результате сохраняет прежний смысл: база `B` в сегодняшних ценах — отображаемая величина, а не меняющийся доход. Доход каждой ledger-строки — `budgetIncome(m)`: сегодняшняя аренда (постоянная неиндексируемая часть дохода) плюс `M(m)`. Индексация накоплений плавная помесячная; `m` отсчитывается от начала сценария и НЕ сбрасывается сделкой — после покупки доход продолжает расти по той же формуле. Индексируется только способность откладывать: расход аренды до переезда индексируется коэффициентом `g`, цена жилья, стоимость ремонта и доходность вклада сохраняют собственные механизмы.

Проиндексированная способность проходит через всю цепочку расчёта: накопление до сделки, выполнимость сделки и её месяц, выбор взноса, месячный `budgetIncome`, расчёт и расход резерва, защищённое досрочное погашение, ledger и график. При `salaryIndexPercent = 0` получается `M(m) = M0` и `budgetIncome(m) = B` — точное воспроизведение прежнего фиксированного номинального поведения.

`availableSavingsAtDeal = S(d)`. Проверяйте сделку на границе до дохода/расходов строки `d`. Отрицательная saving capacity при `rent(m) > budgetIncome(m)` — реальное списание наличных; never clamp to zero. Если продолжение аренды исчерпывает наличные и на этой границе нет выполнимой сделки, более поздние месяцы ожидания недостижимы. Ровно нулевой остаток сам по себе не равен отрицательному остатку.

Ремонт выключен: cost 0, work duration 0. Ремонт включён: сохраните введённый срок даже при нулевой стоимости. Положительная стоимость с нормализованным сроком 0 даёт явный `invalid-input`. При `w > 0` платёж равен `reno(d)/w`; без ремонта равен 0.

## Smallest admissible down payment

Для каждой границы `d`, `P = price(d)`:

```text
a = paymentForTerm(1, mortgageRate, 360)
minimumDown = P × downPaymentPercent/100
annuityFloorDown = max(0, P − budgetIncome(d)/a)
actualDown = max(minimumDown, annuityFloorDown)
principal = P − actualDown
require 0 ≤ actualDown ≤ P
availableSavings(d) ≥ actualDown(d) + requiredReserve(d)
```

Нижняя граница взноса от аннуитета использует проиндексированный бюджет ровно границы сделки: `budgetIncome(d) = today's rent + M(d)`. Выполнимость сделки не сводится к сравнению платежа с доходом на дату сделки: полную выполнимость обязательных платежей обеспечивает последовательность месячных доходов плюс резерв.

`paymentForTerm(L, rate, N)` при `r = rate/100/12` равен `L*r/(1-(1+r)^(-N))`, при нулевой ставке `L/N`, при нулевом теле 0. `contractualAnnuity = paymentForTerm(principal, mortgageRate, 360)`; `firstMonthInterest = principal*r` до любых выплат строки сделки.

Используйте полную точность, без валютной сетки и округления вниз, которое сделает аннуитет выше `budgetIncome(d)`. NEVER increase the down merely because more cash is available; extra cash is optionalSurplus. Порог не вводит собственный floor взноса. Излишек не уменьшает проценты первого месяца: fast-mode repayment happens after that row's contractual payment.

Указанный в issue диапазон допустимых взносов реализуется единственным smallest-admissible allocation — максимумом двух floors. Оптимизацию диапазона не реализуйте.

## Monthly ordering

Каждая строка выполняет строго: (1) deal operation if row d; (2) deposit yield on cash after deal op; (3) budget income `budgetIncome(m)` = today's rent + M(m); (4) indexed rent if month < moveMonth; (5) FULL contractual mortgage payment due; (6) equal renovation installment if d ≤ month < d+w; (7) fast-mode protected early repayment; (8) record balances + remaining protected reserve.

Работы: строки `d…d+w−1`. Переезд: граница `d+w`; аренда прекращается после строки `d+w−1`. Первый ипотечный платёж — в конце строки `d`. При `n` платежах:

```text
lastPaymentRowMonth = d+n−1
lastPaymentBoundaryMonth = d+n
```

`repaymentMonths = n` — число фактических платёжных строк, не абсолютный месяц. Проценты строки начисляются на её открывающее тело; обязательный платёж = min(original contractual annuity, outstanding principal + current interest). Последний платёж может быть меньше. Не пропускайте платежи и не капитализируйте недоплату.

## Minimal initial reserve

`t = 0` соответствует строке сделки; доход строки `t` — `I_t = budgetIncome(d + t) = today's rent + M(d + t)`. Постройте обязательный график `E_t`: договорная ипотека (включая уменьшенный последний платёж), индексированная аренда до переезда, равные платежи ремонта; NO discretionary repayment. За пределами обязательного графика будущий необходимый резерв равен 0.

```text
I_t = budgetIncome(d + t) = today's rent + M(d + t)
C(t+1) = q·C(t) + I_t − E_t
requiredInitialReserve = max(0, max over prefixes k of Σ[t=0…k] (E_t − I_t)/q^(t+1))
requiredBeforeRow(t) = max(0, (E_t − I_t + requiredBeforeRow(t+1))/q)
```

Последняя формула — эквивалентный обратный проход для запросов защиты и независимой сверки. Начальные деньги после операции покупки должны покрывать `requiredInitialReserve`. Ранние излишки покрывают поздний дефицит; резерв обеспечен последовательностью месячных доходов, а не константой. Summing isolated monthly shortfalls is WRONG in general.

### Exact reserve split

`R_total` — резерв полного графика. `R_base` — резерв того же графика без платежей ремонта: та же ипотека, аренда, бюджет, временные границы.

```text
deficitReserve = R_base
renovationSavings = R_total − R_base
totalReserve = R_total
renovationSavings + deficitReserve = totalReserve exactly
```

Не получайте `renovationSavings` суммой непокрытых месячных платежей ремонта.

### Monthly source reporting: display only

```text
baseExcess = max(0, rent + contractualPayment − budgetIncome(m))
freeIncome = max(0, budgetIncome(m) − rent − contractualPayment)
renovationFromIncome = min(renovationPayment, freeIncome)
renovationFromCash = renovationPayment − renovationFromIncome
nonRenovationFromCash = baseExcess
```

Это номинальное распределение месячных обязательств для отображения, не разбиение начального резерва. Доход вклада принадлежит учёту наличных и никогда не увеличивает `budgetIncome`. Фактическое изменение cash также учитывает yield, удержанный доход и early repayment; его нельзя заменять суммой этих display-полей. Резерв — запас на старте, расходы — потоки, списание запаса — не новый доход. `purchaseCapital` — конверсия накопленного капитала в жильё, не расход текущего месячного бюджета.

## Fast and long repayment

Цель накоплений всегда определяется обязательным графиком; fast mode never inflates the goal with discretionary repayments.

Fast после обязательных платежей строки:

1. Рассчитайте резерв для оставшихся обязательств при текущем теле под ORIGINAL contractual annuity.
2. Погасите все наличные сверх защиты, не больше остатка тела.
3. Пересчитайте защиту после уменьшения тела.
4. Продолжайте, пока уменьшение тела освобождает ещё незащищённые деньги.
5. Завершите без material unprotected surplus, если кредит не закрыт.

`protectedReserveAfter` показывает защиту оставшегося графика после досрочного погашения. Индексация зарплаты не ослабляет защиту: пересчёт использует ту же последовательность `budgetIncome`, и досрочное погашение не тратит деньги, защищённые под обязательные платежи. Silent iteration cap, оставляющий существенный излишек, запрещён. Исходный аннуитет неизменен до закрытия; последний платёж может быть меньше. Nothing skipped or capitalized; ≤ 360 contractual payment opportunities. Остатки cash/тела неотрицательны в пределах документированного денежного epsilon 0.01 ₽; этот допуск не разрешает изменить месяц выплаты или строгий порог.

Long: досрочных платежей нет; свободные деньги сохраняются и получают месячную доходность.

Cash: тот же резервный алгоритм с нулевой ипотекой. `goal = indexedHomePrice + renovationSavings + deficitReserve`. Не требуйте весь ремонт заранее, если часть покрывает будущий бюджетный доход.

## Search & selection

Предвычислите одну траекторию ожидания, индексированные серии и rent prefixes through 720. `rentPaidUntilMonth(rawInputs, M)` суммирует аренду строк `0…M−1`; сверяйте с `selectedPlan.totals.rent` при `M = selectedPlan.moveMonth`.

| Поиск | Границы d (inclusive) |
| --- | --- |
| earliest mortgage | 0…360 |
| interestBelowRent | 0…720 |
| cash comparison | 0…720 |

Везде требуйте `d + w ≤ 720`. На каждой достижимой границе отдельно оцените предписанный mortgage allocation и cash; примените наличие накоплений и выполнимость полного обязательного графика. Threshold дополнительно требует строго `firstMonthInterest < indexedRentAtDeal`, без допуска превращающего равенство в успех.

Criterion searches (`earliest`, `interestBelowRent`) are MORTGAGE-ONLY searches. `plans.cash` — независимый comparison result и NEVER fills `plans.earliest`/`plans.interestBelowRent`, на любом горизонте. В вырожденном случае, когда предписанный mortgage allocation даёт `principal = 0` (annuity floor forces full-cash purchase), победитель этого поиска использует cash representation (`kind: 'cash'`, `loan: null`); это не fallback на cash comparison.

Ascending scan ⇒ stop at first qualifying boundary (earliest move-in; fixed work duration). Mortgage and cash qualifying at the same boundary: prefer the prescribed mortgage allocation when principal > 0.

Если положительного тела нет, используйте cash representation с `loan = null`, не фиктивную ипотеку. Cash comparison остаётся самостоятельным результатом `plans.cash`. Сохраняйте разные горизонты mortgage earliest и cash; не расширяйте ипотечный поиск earliest до 720.

Generate full ledgers only for the winners of the three searches — never for trial months (search uses prefix/backward reserve passes without materializing per-trial plans). Каждый ненулевой победитель содержит полный ledger и totals. Once selected, the full repayment ledger is generated even beyond absolute month 720 — never clip interest/principal totals or the chart.

`selectedCriterion ∈ {'earliest','interestBelowRent'}` — состояние выбора критерия, не замороженная дата/план. Изменение входов или `repaymentMode` пересчитывает выбранный критерий. Unavailable selected criterion ⇒ selectedPlan null + explicit empty state, no silent fallback to earliest.

## UI contract and consequences

- Удалите выбор «Накопить до / После покупки» и его availability-gating. Остаются needed, cost, months и режим погашения.
- Новый независимый вход формы `salaryIndexPercent` («Процент индексации зарплаты», годовой процент): 5 при начальной загрузке и при сбросе формы, после этого полностью независим от коэффициента удорожания. `inflation` отображается как «Коэффициент удорожания недвижимости» и остаётся тем же ключом с прежним смыслом.
- Карточка, график, отметки сделки/переезда и tooltip используют один `selectedPlan`. UI всегда передаёт `selectedCriterion = 'earliest'`; карточка порога «Когда покупать» удалена (ревизия UI, 2026-10-06). Переключение критерия остаётся доступным на уровне расчётного контракта.
- Показывайте минимум/фактический взнос, `renovationSavings`, `deficitReserve`, `totalRequiredSavings`, отдельный `optionalSurplus`, даты, кредит и totals. У cash показывайте цену покупки вместо фактического взноса.
- Покажите: «Необходимые накопления на ремонт и резерв учтены в датах покупки и переезда».
- Threshold search uses the same smallest-admissible down (no extra floor). Optional surplus never reduces first-month interest.
- Chart may exceed the month's income in reserve-funded months and must not hide it. Не масштабируйте/обрезайте реальные платежи до месячного дохода; объясняйте резерв и cash movements в tooltip. Ремонт не отображается до сделки и не превращается в lump sum на сделке.
- Календарь получает внешнюю опорную дату. Месяцы сделки, переезда и последнего платёжного boundary абсолютны. Не объявляйте выплату после 720 «недостижимой» только из-за горизонта поиска.

## Delete/migrate table

| Действие | Символ | Требование |
| --- | --- | --- |
| Retain | DEFAULTS, horizon constants, NO_RENOVATION, RENOVATION_COST_SHARE | Сохранить экспорты и значения |
| Retain | paymentForTerm | Сохранить + tests |
| Retain | rentPaidUntilMonth | Сохранить + tests; add reconciliation with selected-plan rent |
| Replace | calculate | Новый контракт этого документа |
| Replace | buildCashflow | Consumes plan, не ищет заново |
| Delete | loanPlan | Fold amortization assertions into public plan tests |
| Delete | selectedLoanPlan | Без compatibility alias |
| Delete | loanPlanStepped | Allows sub-interest payments — violates contract |
| Delete | selectedRenovationLoanPlan | Включая annuity-within-monthly-savings gate |
| Delete | loanScheduleStepped | Ledger becomes authoritative |
| Delete | allocateAfterPurchase | Единственное предписанное распределение |
| Delete | isMortgagePaymentTooLow | Статусы нового результата |
| Delete | isPostPurchaseAvailable | Удалить гейтинг |

No compatibility aliases. Мигрируйте вызывающий код и тесты, не сохраняйте старые поля/снимки ради совместимости. Вне scope: прочий рост бюджета кроме индексации накопительной части (issue #15), минимизация суммарных затрат, рефинансирование, налоги, persistence.
