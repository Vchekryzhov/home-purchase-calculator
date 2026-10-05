# Issue #14: independent golden-fixture verification

## Resolved decisions

Все восемь решений утверждены в [issue-14-model-contract.md](issue-14-model-contract.md) и включены в правила проверки ниже:

1. `workMonths` — длительность работ.
2. Каждый ненулевой победитель трёх поисков содержит полный ledger и totals.
3. Суммы ограничены последней ledger-строкой; отсутствующие boundary rows не фабрикуются.
4. Нормализация, три invalid-input случая и точные validation messages зафиксированы.
5. `savings` вычисляется из фактических потоков строки, без deposit yield.
6. Проверяется single smallest-admissible allocation, не оптимизация диапазона взносов.
7. Критерии mortgage-only, cash comparison независим; нулевое тело использует cash representation.
8. Cash ledger-end включает строку сделки; противоречие найдено независимой проверкой и разрешено оркестратором.

Финансовая семантика принадлежит model contract; этот документ — единственный источник процедуры проверки. Не выводите утверждённые решения из production output.

## Артефакты и независимость

Создайте статические JSON-фикстуры при последующей реализации. Для ненулевых ставок создайте независимо проверенный расчётный лист: CSV evidence file `docs/issue-14-verification.csv`. Этот протокол не создаёт ни CSV, ни фикстуры заранее. Репозиторий использует Vitest и `src/lib/model.characterization.json`; старые снимки не являются oracle новой модели.

Expected values are NEVER derived from the function under test at test runtime. Независимый лист/скрипт не импортирует `src/lib/model.js`, его helpers, `DEFAULTS` или production outputs. Вычисления ведите от явно записанных входов и формул model contract. Проверка production начинается только после проверки и freezing evidence.

## Fixture entry format (static JSON)

Каждая запись имеет следующую структуру; обозначения типов/комментарии здесь — шаблон, а не готовый JSON:

```js
{
  inputs: {
    savings: Number, monthlySavings: Number, mortgageRate: Number,
    propertyPrice: Number, downPaymentPercent: Number, inflation: Number,
    rent: Number, depositRate: Number
  }, // every number explicit — never depend on DEFAULTS
  repaymentMode: 'fast' | 'long',
  renovation: { needed: Boolean, cost: Number, months: Number },
  selectedCriterion: 'earliest' | 'interestBelowRent',
  referenceDate: '2026-01-15',
  expected: {
    statuses: {
      status, validationErrors, selectedCriterion, selectionStatus, selectionReason
    },
    monthlyBudget: Number,
    forecast: { propertyInYear: Number, rentInYear: Number },
    plans: { earliest: PlanSummary | null,
             interestBelowRent: PlanSummary | null, cash: PlanSummary | null },
    selectedPlan: PlanSummary | null
  },
  verification: {
    method: 'hand-calculation' | 'independent-sheet',
    evidence: String,
    reviewed: true
  }
}
```

`evidence` идентифицирует проверяемый ручной расчёт либо CSV-сценарий/строки, ревьюера и результат ревью. `reviewed: true` ставьте только после ревью; незавершённая запись — не golden. Используйте ключи summary, совпадающие с `Plan`, а не старые `month`, `payment`, `months`, `overpayment`.

Для ожиданий нормализуйте каждое из восьми numeric input fields через `Math.max(0, Number(x) || 0)`, стоимость ремонта тем же преобразованием, `renovation.months` через `Math.max(0, Math.round(months))`. `invalid-input` случаи исчерпывающи; `validationErrors` — массив точных человекочитаемых русских строк:

- `renovation.needed && normalized cost > 0 && normalized months === 0` → `Для ремонта с ненулевой стоимостью укажите срок не менее 1 месяца`.
- Режим не в `{'fast','long'}` → `Неизвестный режим погашения`.
- Критерий не в `{'earliest','interestBelowRent'}` → `Неизвестный критерий выбора плана`.

При `status = 'invalid-input'` фиксируйте `selectionStatus = 'invalid-input'`, `selectedPlan = null`, все `plans = null`. `selectionReason` null if and only if selectionStatus available; иначе проверяйте непустую правдивую русскую строку. Точная формулировка `selectionReason` свободна для реализации и не является обязательной validation message; её смысл не должен противоречить причине.

Каждый non-null plan в `plans.earliest`, `plans.interestBelowRent`, `plans.cash` имеет FULL ledger и totals; проверяйте все три результата, не только выбранный. Generate full ledgers only for the winners of the three searches — never for trial months; поиск использует prefix/backward reserve passes без per-trial plans.

`PlanSummary` фиксирует:

- `kind`, `dealMonth`, `moveMonth`, `workMonths`: последнее поле — DURATION, normalized renovation.months при needed (иначе 0), никогда не абсолютный месяц; `moveMonth = dealMonth + workMonths`. Только `dealMonth`, `moveMonth`, `lastPaymentRowMonth`, `lastPaymentBoundaryMonth` — абсолютные месяцы плана;
- `propertyPriceAtDeal`, `renovationCostAtDeal`, `renovationMonthlyPayment`, `availableSavingsAtDeal`, `indexedRentAtDeal`;
- ВСЕ `savingsGoal` поля: `minimumDownPayment`, `actualDownPayment`, `cashPurchasePrice`, `renovationSavings`, `deficitReserve`, `totalReserve`, `totalRequiredSavings`, `optionalSurplus`;
- `loan = null` у cash либо все поля кредита: `principal`, `contractualAnnuity`, `firstMonthInterest`, `repaymentMonths`, `lastPaymentRowMonth`, `lastPaymentBoundaryMonth`, `totalInterest`, `totalPrincipal`;
- ВСЕ totals: `rent`, `renovation`, `interest`, `principal`, `depositYield`, `budgetIncome`, `purchaseCapital`, `finalCash`;
- `calendarDates: { dealDate, moveDate, lastPaymentDate }`: ISO `YYYY-MM-DD`, последний платёж по `lastPaymentBoundaryMonth`, у cash `lastPaymentDate = null`;
- `boundaryRows`: полные `MonthlyRow` на назначенных границах (ниже), а не только высота chart-стека; boundary row `d` всегда присутствует у каждого плана. Для индексов `> L` ожидание явно absent/not applicable, без fabricated rows.

Заморозьте selection status + plan kind; deal/move/last-payment boundary months; calendar dates at fixed reference date; ALL savingsGoal fields incl. optionalSurplus; loan principal/annuity/term/totalInterest; rent/renovation/principal/interest totals; boundary rows (before deal, deal, first+last renovation, move-in, last loan payment).

## Procedure (binding order)

1. Choose explicit inputs BEFORE computing expectations. Запишите все восемь чисел, режим, три поля ремонта, критерий и fixed reference date. Не изменяйте входы, чтобы получить желаемую production-дату.
2. Hand-compute zero-rate cases fully: accumulation arithmetic, annuity, installments, reserve prefixes, purchase conversion, payoff. Представьте арифметику, таблицу строк и результаты, достаточные для повторного ручного вычисления.
3. Other cases: independent calculation sheet (`docs/issue-14-verification.csv`) — NO imports from `src/lib/model.js`, NO production outputs as inputs. Record each waiting month and candidate goal; verify chosen boundary AND rejection of every earlier boundary; mandatory + actual repayment schedules; independent forward cash reconciliation.
4. Cross-check reserve BOTH directions: discounted prefix max vs backward recurrence. Проверяйте полный и base-графики, а в fast также защиту при изменении остатка тела.
5. Cross-check search independently: earlier dates fail their prescribed allocation or threshold test; selected date satisfies all. Не ограничивайтесь проверкой `d−1`.
6. Cross-check conservation: Σ renovation = indexed renovation cost; Σ principal = loan principal; Σ rent = rent prefix through move-in; cash reconciliation closes; goal components reconcile exactly.
7. Review evidence BEFORE freezing JSON. Only then compare production output to goldens. Ревью должно подтвердить входы, независимость расчёта, все ранние отказы, обе формы резерва, границы, conservation и fixed-date календарь.

Completion criterion: у каждой frozen записи есть независимо проверенные входы/ожидания и reviewed evidence; production comparison не участвовало в получении ожиданий.

## Evidence sheet: обязательные данные

Используйте один CSV с явными `scenario`, `section`, `month`/`t` и именованными колонками. Формат колонок можно расширять, но evidence обязано содержать:

1. **Inputs:** все входные числа, renovation, mode, criterion, referenceDate; никакие defaults не подразумеваются.
2. **Waiting/search:** каждый достижимый месяц от 0 до выбранной границы; для unavailable — весь применимый горизонт либо доказанную точку недостижимости. `S(m)`, `price(m)`, `rent(m)`, `reno(m)`, `B`, `q`, `minimumDown`, `annuityFloorDown`, `actualDown`, `principal`, annuity, first interest, `R_total`, `R_base`, goal, surplus, `d+w`, feasibility/threshold outcomes и причина отклонения. Mortgage и cash проверяются отдельно; положительное тело выигрывает на одинаковой границе. Учитывайте inclusive 360/720, work-end ≤ 720 и предел ожидания при истощении наличных.
3. **Mandatory schedule:** исходный договорной аннуитет, открывающее/закрывающее тело, проценты, договорной платёж с уменьшенным последним, rent, equal renovation, `E_t`, discounted prefix, prefix maximum, backward `requiredBeforeRow`. Base-график отличается только отсутствием ремонта, не сроками/ипотекой.
4. **Actual schedule:** все поля `MonthlyRow`; fast — каждая итерация освобождения наличных/пересчёта защиты или независимо доказанный эквивалентный результат. Long — early repayment 0. Отмечайте пересечения deal/work/move/payoff.
5. **Checks/totals/calendar:** построчные residuals, суммарные conservation residuals, savingsGoal split, итоговые totals, абсолютные месяцы и ISO-даты. Предел всех сумм — последняя ledger-строка `L = max(lastPaymentRowMonth, moveMonth − 1)` для mortgage (`loan ≠ null`, `n ≥ 1` платежей всегда включают строку `d`), `L = max(dealMonth, moveMonth − 1)` для cash (`loan = null`). Суммируйте только строки `0…L` inclusive; после последней строки ничего не начисляется, включая depositYield и budgetIncome, finalCash относится только к ledger.

Для cash при `w ≥ 1` последняя строка остаётся `d + w − 1`; при `w = 0` ledger включает строки ожидания `0…d−1` плюс строку сделки `d` с операцией покупки. Аренда на строке `d` равна 0, поскольку `month d = moveMonth`. Строк после `d` нет — после неё ничего не начисляется.

Поиски `earliest` и `interestBelowRent` MORTGAGE-ONLY: горизонты соответственно `0…360` и `0…720` inclusive. `plans.cash` — отдельное сравнение `0…720` inclusive и NEVER fills `plans.earliest`/`plans.interestBelowRent`, на любом горизонте. Если предписанное mortgage allocation даёт principal 0 (annuity floor forces full-cash purchase), победитель этого поиска имеет `kind: 'cash'`, `loan: null`; не подставляйте cash comparison. Везде `d + w ≤ 720`.

У unavailable запись доказывает отсутствие кандидата, а не только отсутствие selectedPlan. При threshold unavailable earliest может быть доступен, но fallback запрещён. Для смены входов/режима/критерия составьте отдельные явные записи и проверьте последовательность выбора.

## Independent equations and precision

Повторно вычислите из входов fixed `B`, `g`, `q`, indexed property/rent/renovation и `S(m+1) = q*S(m) + B - rent(m)`. Отрицательная saving capacity списывает cash. На границе сделки проверьте smallest-admissible down и полный reserve; optional surplus не уменьшает тело или first interest при распределении сделки.

Диапазон допустимых взносов из issue реализован единственным smallest-admissible allocation — максимумом процентного и annuity floors. Независимая проверка не оптимизирует диапазон и не добавляет threshold floor.

Две независимые проверки резерва:

```text
requiredInitialReserve = max(0, max over prefixes k of Σ[t=0…k] (E_t − B)/q^(t+1))
requiredBeforeRow(t) = max(0, (E_t − B + requiredBeforeRow(t+1))/q)
```

Конечная backward-защита после всех обязательств равна 0. Начальное значение обоих проходов должно совпасть. `deficitReserve = R_base`, `renovationSavings = R_total − R_base`, `totalReserve = R_total`; не суммируйте изолированные shortfalls для получения начального капитала.

Row reconciliation (MUST hold to documented epsilon):

```text
closingCash = openingCash − purchaseCapital + depositYield + budgetIncome − rent − renovation − interest − principal
```

Суммарная сверка, где initialCash — нормализованные входные savings. Все ledger-суммы ниже берутся только по строкам `0…L` inclusive: `L = max(lastPaymentRowMonth, moveMonth − 1)` для mortgage (`loan ≠ null`, `n ≥ 1` платежей всегда включают строку `d`), `L = max(dealMonth, moveMonth − 1)` для cash (`loan = null`). Никаких начислений после `L` нет.

```text
finalCash = initialCash − Σ purchaseCapital + Σ depositYield + Σ budgetIncome
            − Σ rent − Σ renovation − Σ interest − Σ principal
Σ renovation = renovationCostAtDeal
Σ principal = loan.principal // cash: both zero, loan itself null
Σ rent = Σ[m=0…moveMonth−1] rent(m)
totalReserve = renovationSavings + deficitReserve
totalRequiredSavings = actualDownPayment + cashPurchasePrice + totalReserve
optionalSurplus = availableSavingsAtDeal − totalRequiredSavings
```

Покупка — конверсия капитала, не месячный бюджетный расход: взнос не входит в `Σ principal`. `renovationSavings` — initial-capital requirement; `renovation` — nominal monthly spending; `renovationFromCash`/`nonRenovationFromCash` — display source reporting, не прямой oracle изменения общего cash. Доход вклада не увеличивает `B`; фактические cash draws проверяются recurrence.

В графике суммы ремонта только после сделки, равны на work rows; вся аренда индексирована; проценты/тело включены за весь срок, даже после абсолютного месяца 720. Стек может превысить fixed budget при оплате из резерва: старое утверждение «monthly totals never exceed budget» нужно удалить, а не сохранять как invariant.

Проверяйте chart-поле по ACTUAL row flows:

```text
savings = max(0, budgetIncome − rent − renovation − interest − principal)
```

Fast направляет излишек на early repayment внутри `principal`, поэтому такие строки имеют `savings = 0`; long сохраняет излишек и показывает savings. Pre-deal строки показывают `B − indexedRent` или 0 при indexed rent ≥ B; превышение аренды остаётся видимым cash draw. Deposit yield NEVER appears in `savings`; expense stacks never clamp to keep total within B. Это поле не равно stock balance.

Ascending scan ⇒ stop at first qualifying boundary (earliest move-in; fixed work duration). Mortgage and cash qualifying at the same boundary: prefer the prescribed mortgage allocation when principal > 0.

### Tolerances

- Money absolute error ≤ 0.01 ₽ per value (explicit, not decimal-place rounding). Используйте сравнение абсолютной разницы; `roundDeep` и сравнение округлённых чисел не заменяют этот допуск.
- Months and dates EXACT (no month-shift tolerance). `repaymentMonths`, last row/boundary и количество work rows также точны.
- Последний ledger index `L` и отсутствие boundary rows за его пределами проверяются точно. Totals и finalCash не расширяются ради строки переезда или календарной даты выплаты.
- `validationErrors` сравнивайте с точными русскими строками из fixture format notes; для `selectionReason` обязательны null iff available либо непустая правдивая русская строка, без навязывания точной формулировки.
- `firstMonthInterest < indexedRentAtDeal` строго: равенство проваливается; денежный assertion tolerance не смягчает логический тест.
- Вычисления сохраняют полную точность до display formatting. Компоненты цели должны согласовываться exactly по заданным формулам; допустим только floating-point residual в пределах денежного epsilon, не независимое округление компонент.
- Golden changes require a documented semantic explanation + re-review; blanket golden regeneration forbidden. Не исправляйте expected по failing production output без независимо одобренной причины.

## Boundary rows and calendar

Для каждого плана проверяйте строку `d−1`, если `d>0`; строку `d`; первую/последнюю work rows `d`, `d+w−1`, если `w>0`; строку `moveMonth=d+w`; последнюю loan row `d+n−1`, если есть кредит. Последняя ledger-строка `L = max(lastPaymentRowMonth, moveMonth − 1)` для mortgage (`loan ≠ null`, `n ≥ 1` платежей всегда включают строку `d`), `L = max(dealMonth, moveMonth − 1)` для cash (`loan = null`). Boundary row `d` всегда присутствует у каждого плана, в том числе cash с `w = 0`, где `L = d = moveMonth`; аренда в этой строке 0, строк после `d` нет. Boundary indices `> L` фиксируйте явно absent/not applicable, никогда не фабрикуйте строку ради ожидания. Совпадающие границы используют одну и ту же строку, не разные ожидания. Отсутствующие фазы фиксируйте явно как неприменимые, не создавайте строку −1 или фиктивный кредит.

Если move row присутствует в ledger, аренда в ней 0; на last work row аренда ещё есть, а ремонт последний. На всегда присутствующей deal row выполняется purchase operation ДО deposit yield; первый договорной платёж уже в этой строке у mortgage. Последний платёж для календаря привязан к boundary `d+n`, не row `d+n−1`.

Используйте только `referenceDate = '2026-01-15'`: date(boundary M) получается прибавлением M календарных месяцев, с сохранением дня 15, без арифметики «30 дней = месяц», зависимости от времени теста или UTC-сдвига дня. У summary dates — `dealDate=date(d)`, `moveDate=date(d+w)`, `lastPaymentDate=date(d+n)`; cash lastPaymentDate null. Индекс chart row и дата окончания платёжного периода — разные величины.

## Scenario matrix: minimum

Все точные ожидания, кроме приведённой ниже приблизительной иллюстрации, **to be verified at fixture-composition time**. Не придумывайте точные даты, terms, totals или balances в спецификации. Выбирайте явные входы перед вычислением.

| № | Сценарий | Что доказать |
| --- | --- | --- |
| 1 | No-renovation fast | Ранний план, protected early repayment, full ledger |
| 2 | No-renovation long | Original annuity, cash retained with yield |
| 3 | Immediate reserve-financed loan, входы ниже | Аннуитет выше monthlySavings, не выше B; резерв обеспечивает работы; deal immediately |
| 4 | Те же входы, savings 2000000 | Недостаточно резерва; deal waits; все ранние границы отвергнуты |
| 5 | Rich immediate with optional surplus | Down не растёт от богатства; surplus отдельно; fast не меняет first interest |
| 6 | Inflation squeezes saving capacity incl. unavailable outcome | Indexed rent снижает накопление вплоть до cash draw/недостижимости |
| 7 | Zero rates, fully hand-recomputable | Полная ручная арифметика ожидания, резерва, cash conversion и payoff |
| 8 | Cash purchase with renovation partly covered by future income | Цель не требует full renovation up front, loan null |
| 9 | Threshold selection + calculation at that criterion's date + recomputation after input change | Карточка/chart из selectedPlan; criterion сохраняется, дата пересчитывается |

### Worked illustration: приблизительно, не frozen golden

Округлённая иллюстрация ниже не проверена: заявленный аннуитет может не совпасть даже на уровне рублей с `paymentForTerm(8000000, 16.9, 360)`. Это числовое расхождение, а не разрешение менять ставку, формулу или подгонять входы. Пересчитайте независимо и задокументируйте исправленные значения до freezing.

Явные входы: `propertyPrice=10000000`, `savings=3100000`, `monthlySavings=50000`, `rent=80000`, `mortgageRate=16.9`, `downPaymentPercent=20`, `inflation=0`, `depositRate=0`; renovation `{ needed: true, cost: 600000, months: 6 }`. Для составления записи задайте mode и criterion явно.

Предоставленная иллюстрация: annuity on 8000000 ₽ ≈ 113656 ₽/mo ≤ budget 130000 ₽; monthly shortfall 163656 ₽ × 6 ⇒ totalReserve 981936 ₽ = deficit 6 × 63656 = 381936 + renovation 6 × 100000 = 600000; goal 2981936 ≤ 3100000 ⇒ immediate deal, surplus 118064 ₽.

Здесь «shortfall» означает `rent + annuity + renovation installment − B`, а не полный расход месяца. Recompute precisely during verification, do not trust these rounded figures blindly. Используйте точную аннуитетную формулу для 360 месяцев: сначала аннуитет, затем `(80000 + annuity − 130000)*6` для base reserve и ещё 600000 для full reserve при q=1. При fast отдельно проверьте реальный ledger и итеративную защиту — mandatory reserve не является предположением об отсутствии досрочных платежей в actual schedule.

### Targeted cases: обязательны дополнительно

- Interior annuity-floor down: `minimumDown < actualDown < P`, annuity ≤ B без валютной сетки.
- Earlier surplus offsetting later shortfall: prefix reserve отличается от суммы изолированных недостач.
- Deposit yield reducing required reserve: оба reserve passes совпадают; yield не увеличивает B.
- Strict threshold equality failing; cash/zero-interest при zero rent тоже fails.
- Positive renovation cost with normalized zero work duration: invalid-input, не zero-month lump payment.
- Renovation on with zero cost retains duration; renovation off обнуляет cost/duration; leftover funding не меняет результат.
- Qualifying loan with payoff beyond absolute month 720: полный срок/interest/principal/chart, не обрезка.
- Mode/criterion changes preserving selection; unavailable selected criterion возвращает null без earliest fallback.
- Mortgage/cash at same boundary: prescribed mortgage выигрывает при principal > 0; cash representation без фиктивного кредита.
- Inclusive search boundaries и предел `d+w≤720`; отсутствие material unprotected cash в fast, пока loan открыт.
- `paymentForTerm` tests сохраняются; amortization assertions удаляемых helpers переносятся на public Plan; `rentPaidUntilMonth` сверяется с selected-plan rent.

## Migrate all nine inherited no-renovation scenarios

Здесь зафиксированы явные старые входы из test setup, не старые выходы. Для каждой строки задайте renovation `{ needed: false, cost: 0, months: 0 }`, `selectedCriterion='earliest'`, `referenceDate='2026-01-15'`. Дополнительные threshold-записи могут использовать тот же входной набор. Все expectations newly verified; old snapshots are NOT auto-preserved.

| name | savings | monthlySavings | mortgageRate | propertyPrice | downPaymentPercent | inflation | rent | depositRate | mode |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| defaults-fast | 0 | 50000 | 16.9 | 10000000 | 20 | 5 | 80000 | 11.5 | fast |
| defaults-long | 0 | 50000 | 16.9 | 10000000 | 20 | 5 | 80000 | 11.5 | long |
| rich-fast | 3000000 | 50000 | 16.9 | 10000000 | 20 | 5 | 80000 | 11.5 | fast |
| rich-long | 3000000 | 50000 | 16.9 | 10000000 | 20 | 5 | 80000 | 11.5 | long |
| saver-fast | 0 | 300000 | 16.9 | 10000000 | 20 | 5 | 80000 | 11.5 | fast |
| lowrent-fast | 0 | 50000 | 16.9 | 10000000 | 20 | 5 | 10000 | 11.5 | fast |
| midrent-fast | 0 | 50000 | 16.9 | 10000000 | 20 | 5 | 60000 | 11.5 | fast |
| poor-fast | 0 | 1000 | 16.9 | 10000000 | 20 | 5 | 0 | 11.5 | fast |
| poor-long | 0 | 1000 | 16.9 | 10000000 | 20 | 5 | 0 | 11.5 | long |

Не используйте `{ ...DEFAULTS, ...overrides }` при заморозке/исполнении этих фикстур. Для всех девяти: **to be verified at fixture-composition time**.

## Implementation/integration gates after fixtures

После одобрения evidence сравните публичные `calculate` и `buildCashflow(plan)` со static goldens и проверяйте conservation/invariants на полном ledger, не только boundary snapshots. Убедитесь, что chart projection не вызывает planning и получает ровно выбранный план.

После model/UI integration выполните `npm test`, `npm run build`, browser smoke (threshold selection/return, изменение входов/режима, unavailable, reserve-funded months, cash, dates и chart beyond 720) и code review. UI должен явно показывать invalid/unavailable, реальные reserve-financed расходы и требуемую подпись о включённом резерве. Эти gates не разрешают автоматическую перегенерацию goldens. Коммит — отдельный этап по явному запросу, не часть создания этих документов.

## Evidence status

34 reviewed entries / 64 complete winner plans are frozen. Inputs were chosen before calculation; the independent sheet and separate review never imported production code or used production outputs. The seven previously withheld entries now apply binding resolution #8: cash L=max(dealMonth,moveMonth−1), so w=0 includes row d with purchaseCapital, rent=0, reserve=0 and closingCash=optionalSurplus×q+B; there are no rows after d. Their complete three-plan expectations were reconciled and reviewed before freezing.

CSV compaction: **27116006 → 4918756 bytes** (under 5000000 bytes). Numeric evidence is formatted to at most 6 decimal places only after full-precision calculation/review; frozen money uses 2 decimals with absolute 0.01 ₽ tolerance, months/dates exact. Transcript dumps and duplicate tables/columns were removed without losing protocol evidence. All 5181 previously checked expected numeric values still reconcile; exhaustive search rows, mandatory/actual schedules, both reserve passes, fast iterations, hand checks, review records and conservation residuals passed the compacted-evidence audit.

CSV reading: row 1 is the generic scenario/section/month header. `@section` maps short section codes to names; `@schema` names that section’s data columns. Every line has 26 columns. Inputs map short scenario codes to full scenario IDs. The `__format__` row documents precision, booleans, zero/copy aliases, reason codes, shared-plan aliases, hand residuals and fast iteration tuples. Physical row numbers below include the header and schema rows. The tuple (scenario,section,month) is unique. Search mortgage rows combine earliest/threshold checks with separate active/qualification/rejection columns; cash search remains independent. Identical complete ledgers share an explicitly reviewed alias, never an implicit fallback.

| Frozen scenario ID | Method / resolution | CSV rows |
| --- | --- | --- |
| matrix-no-renovation-fast | hand-calculation; PASS; resolution #8 | 113–794 |
| matrix-no-renovation-long | hand-calculation; PASS; resolution #8 | 795–1782 |
| matrix-immediate-reserve | independent-sheet; PASS | 1783–4050 |
| matrix-wait-reserve | independent-sheet; PASS | 4051–6408 |
| matrix-rich-surplus | independent-sheet; PASS | 6409–8534 |
| matrix-inflation-unreachable | independent-sheet; PASS | 8535–8553 |
| matrix-zero-rates | hand-calculation; PASS | 8554–9097 |
| matrix-cash-future-income | hand-calculation; PASS | 9098–9120 |
| matrix-threshold-base | independent-sheet; PASS | 9121–11024 |
| matrix-threshold-selected | independent-sheet; PASS | 11025–12928 |
| matrix-threshold-changed | independent-sheet; PASS | 12929–14905 |
| defaults-fast | independent-sheet; PASS | 14906–16330 |
| defaults-long | independent-sheet; PASS | 16331–17755 |
| rich-fast | independent-sheet; PASS; resolution #8 | 17756–19200 |
| rich-long | independent-sheet; PASS; resolution #8 | 19201–21262 |
| saver-fast | independent-sheet; PASS; resolution #8 | 21263–23262 |
| lowrent-fast | independent-sheet; PASS; resolution #8 | 23263–26153 |
| midrent-fast | independent-sheet; PASS; resolution #8 | 26154–28758 |
| poor-fast | independent-sheet; PASS | 28759–30930 |
| poor-long | independent-sheet; PASS | 30931–33102 |
| target-interior-floor | hand-calculation; PASS | 33103–35770 |
| target-prefix-offset | independent-sheet; PASS | 35771–36517 |
| target-yield-reserve-nominal | independent-sheet; PASS | 36518–38625 |
| target-strict-equality | independent-sheet; PASS | 38626–40812 |
| target-zero-work-invalid | hand-calculation; PASS | 40813–40818 |
| target-zero-cost-duration | hand-calculation; PASS | 40819–41238 |
| target-zero-rent-horizon | hand-calculation; PASS | 41239–43410 |
| target-payoff-beyond720 | hand-calculation; PASS | 43411–46454 |
| target-work-end720 | hand-calculation; PASS | 46455–49360 |
| target-work-end721-unavailable | hand-calculation; PASS | 49361–51532 |
| target-same-boundary | hand-calculation; PASS | 51533–51921 |
| target-inclusive360 | hand-calculation; PASS | 51922–55670 |
| target-mode-invalid | hand-calculation; PASS | 55671–55676 |
| target-criterion-invalid | hand-calculation; PASS | 55677–55682 |

Review covers all earlier boundary rejections (not just d−1), prefix/backward reserve equality plus independently seeded forward cash paths, mandatory amortization closed forms, actual cash/source reporting, full L-limited conservation, reserve splits, fast protection release iterations, explicit boundary absence, and independent day-15 calendar arithmetic. All-zero-rate cases have closed-form hand arithmetic and independent hand-versus-actual residuals on every row.

Worked illustration: annuity 113404.77 ₽; base reserve 380428.64 ₽; renovation savings 600000.00 ₽; total reserve 980428.64 ₽; goal 2980428.64 ₽; surplus 119571.36 ₽. With savings 2000000 ₽, every boundary 0–19 fails and boundary 20 succeeds. Threshold sequence remains earliest d=0 → interestBelowRent d=144 → changed monthlySavings with criterion retained, d=168. Unclipped long payoff remains last row 791 / payment boundary 792.

No fixture remains withheld on the resolved cash-ledger discrepancy. The exploratory 1200% deposit-yield case is intentionally not a golden or part of this compact sheet; its explicitly chosen nominal 12% replacement is frozen. Production comparison and the test-loader migration belong to Ticket 3; no production tests or commits were used in this verification.
