// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import App from './App.vue';

const { fakeChart, initChart } = vi.hoisted(() => {
  const fakeChart = {
    setOption: vi.fn(),
    getOption: vi.fn(() => ({ dataZoom: [{ start: 0, end: 100 }] })),
    convertToPixel: vi.fn(() => 150),
    clear: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    on: vi.fn()
  };
  return { fakeChart, initChart: vi.fn(() => fakeChart) };
});

vi.mock('echarts/core', () => ({ use: vi.fn(), init: initChart }));
vi.mock('echarts/charts', () => ({ BarChart: {} }));
vi.mock('echarts/components', () => ({ DataZoomComponent: {}, GridComponent: {}, MarkLineComponent: {}, TooltipComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

const norm = (text) => text.replace(/[\s\u00A0\u202F\u2009]/g, '');
const labelInput = (wrapper, labelText) =>
  wrapper.findAll('label').find((label) => label.text().startsWith(labelText)).find('input');
const amountInput = (wrapper, labelText) =>
  wrapper.findAll('label.currency-field').find((label) => label.text().startsWith(labelText)).find('input');
const button = (wrapper, text) =>
  wrapper.findAll('button').find((el) => el.text().startsWith(text));
const dd = (wrapper, dtText) =>
  wrapper.findAll('dt').find((el) => el.text().startsWith(dtText))?.element.parentElement.querySelector('dd') ?? null;
const ddText = (wrapper, dtText) => dd(wrapper, dtText)?.textContent ?? '';
const lastOption = () => fakeChart.setOption.mock.calls.at(-1)?.[0];
const settle = async () => { await nextTick(); await nextTick(); };
const setAmount = async (wrapper, labelText, digits) => {
  const input = amountInput(wrapper, labelText);
  await input.trigger('focus');
  await input.setValue(digits);
  await input.trigger('blur');
  await settle();
};

describe('App: public UI through mounted component', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the default mortgage and cash plans with the cashflow chart', async () => {
    const wrapper = mount(App);
    await settle();
    const mortgage = wrapper.find('article.card.mortgage');
    expect(mortgage.find('.kicker').text()).toBe('Ипотека');
    expect(mortgage.find('.big-label').text()).toBe('Дата покупки');
    expect(mortgage.find('.big').text()).toBe('3 года 5 месяцев');
    expect(norm(ddText(wrapper, 'Минимальный первоначальный взнос'))).toBe('2362799₽');
    expect(norm(ddText(wrapper, 'Фактический первоначальный взнос'))).toBe('2362799₽');
    expect(norm(ddText(wrapper, 'Сумма кредита'))).toBe('9451196₽');
    expect(norm(ddText(wrapper, 'Обязательный платёж'))).toBe('133976₽/мес.');
    expect(ddText(wrapper, 'Срок выплаты')).toBe('12 лет 2 месяца');
    expect(norm(ddText(wrapper, 'Переплата'))).toBe('13835985₽');
    expect(ddText(wrapper, 'Последний платёж')).toMatch(/^\d{1,2} [а-яё]+ \d{4} г\.$/);
    expect(dd(wrapper, 'Необязательный излишек')).toBeNull();
    const cash = wrapper.find('article.card.cash');
    expect(cash.find('.big-label').text()).toBe('Сможете купить через');
    expect(cash.find('.big').text()).toBe('16 лет 2 месяца');
    expect(initChart).toHaveBeenCalledTimes(1);
    const option = lastOption();
    expect(option.series.map((series) => series.name)).toEqual(['Тело кредита', 'Проценты', 'Ремонт', 'Накопления', 'Аренда']);
    expect(option.series.every((series) => series.stack === 'month')).toBe(true);
    expect(wrapper.find('.cf-badge').text()).toBe('Сделка');
    wrapper.unmount();
    expect(fakeChart.dispose).toHaveBeenCalled();
  });

  it('switches the repayment scenario between fast payoff and 30 years', async () => {
    const wrapper = mount(App);
    await settle();
    const fast = button(wrapper, 'Максимально быстро');
    const long = button(wrapper, 'Растянуть на 30 лет');
    expect(fast.classes()).toContain('active');
    expect(fast.attributes('aria-pressed')).toBe('true');
    expect(long.attributes('aria-pressed')).toBe('false');
    await long.trigger('click');
    await settle();
    expect(long.classes()).toContain('active');
    expect(fast.classes()).not.toContain('active');
    expect(ddText(wrapper, 'Срок выплаты')).toBe('30 лет');
    expect(norm(ddText(wrapper, 'Переплата'))).toBe('38780286₽');
    await fast.trigger('click');
    await settle();
    expect(fast.classes()).toContain('active');
    expect(ddText(wrapper, 'Срок выплаты')).toBe('12 лет 2 месяца');
  });

  it('enables the renovation scenario with renovation savings, badges and chart marks', async () => {
    const wrapper = mount(App);
    await settle();
    expect(wrapper.find('.renovation-fields').exists()).toBe(false);
    await button(wrapper, 'Без ремонта').trigger('click');
    await settle();
    expect(wrapper.find('.renovation-fields').exists()).toBe(true);
    const cost = amountInput(wrapper, 'Стоимость ремонта');
    expect(norm(cost.element.value)).toBe('1500000');
    expect(norm(cost.attributes('placeholder'))).toBe('1500000');
    expect(wrapper.find('article.card.mortgage .big').text()).toBe('7 лет 9 месяцев');
    expect(norm(ddText(wrapper, 'Накопить на ремонт'))).toBe('2117719₽');
    expect(norm(ddText(wrapper, 'Резерв на временный дефицит'))).toBe('680244₽');
    expect(dd(wrapper, 'Аренда до переезда')).not.toBeNull();
    expect(wrapper.findAll('.cf-badge').map((badge) => badge.text())).toEqual(['Сделка', 'Переезд']);
    expect(lastOption().series[0].markLine.data).toHaveLength(2);
    await cost.trigger('focus');
    await cost.setValue('2000000');
    expect(norm(cost.element.value)).toBe('2000000');
    await button(wrapper, 'С ремонтом').trigger('click');
    await settle();
    expect(wrapper.find('.renovation-fields').exists()).toBe(false);
    expect(dd(wrapper, 'Накопить на ремонт')).toBeNull();
  });

  it('shows the validation message when renovation has cost but zero duration', async () => {
    const wrapper = mount(App);
    await settle();
    await button(wrapper, 'Без ремонта').trigger('click');
    await settle();
    await labelInput(wrapper, 'Срок ремонта').setValue('0');
    await settle();
    expect(wrapper.find('article.card.mortgage p.empty').text()).toBe('Для ремонта с ненулевой стоимостью укажите срок не менее 1 месяца');
  });

  it('edits money inputs, filters non-digits and recalculates the plan', async () => {
    const wrapper = mount(App);
    await settle();
    expect(wrapper.find('article.card.mortgage .big').text()).toBe('3 года 5 месяцев');
    await setAmount(wrapper, 'Текущие накопления', '6000000');
    expect(norm(amountInput(wrapper, 'Текущие накопления').element.value)).toBe('6000000');
    expect(wrapper.find('article.card.mortgage .big').text()).toBe('0 месяцев');
    expect(norm(ddText(wrapper, 'Фактический первоначальный взнос'))).toBe('2000000₽');
    expect(norm(ddText(wrapper, 'Всего необходимых накоплений'))).toBe('2000000₽');
    expect(dd(wrapper, 'Необязательный излишек')).toBeNull();
    const savings = amountInput(wrapper, 'Текущие накопления');
    await savings.trigger('focus');
    await savings.setValue('12abc34');
    expect(norm(savings.element.value)).toBe('1234');
  });

  it('edits the mortgage rate and recalculates the annuity', async () => {
    const wrapper = mount(App);
    await settle();
    await labelInput(wrapper, 'Ставка кредита').setValue('12');
    await settle();
    expect(wrapper.find('article.card.mortgage .big').text()).toBe('3 года 5 месяцев');
    expect(norm(ddText(wrapper, 'Обязательный платёж'))).toBe('97216₽/мес.');
    expect(norm(ddText(wrapper, 'Переплата'))).toBe('5731282₽');
  });

  it('edits the down payment percent and recalculates the goal', async () => {
    const wrapper = mount(App);
    await settle();
    await labelInput(wrapper, 'Первоначальный взнос').setValue('10');
    await settle();
    expect(wrapper.find('article.card.mortgage .big').text()).toBe('2 года 7 месяцев');
    expect(norm(ddText(wrapper, 'Минимальный первоначальный взнос'))).toBe('1134329₽');
    expect(norm(ddText(wrapper, 'Фактический первоначальный взнос'))).toBe('1698796₽');
  });

  it('edits the property price and recalculates the loan', async () => {
    const wrapper = mount(App);
    await settle();
    await setAmount(wrapper, 'Стоимость недвижимости', '1000000');
    expect(wrapper.find('article.card.mortgage .big').text()).toBe('5 месяцев');
    expect(norm(ddText(wrapper, 'Сумма кредита'))).toBe('816430₽');
    expect(norm(ddText(wrapper, 'Переплата'))).toBe('39816₽');
  });

  it('shows empty states when no feasible plan exists', async () => {
    const wrapper = mount(App);
    await settle();
    await setAmount(wrapper, 'Накопления в месяц', '0');
    await setAmount(wrapper, 'Аренда в месяц', '0');
    expect(wrapper.find('article.card.mortgage p.empty').text()).toBe('При этих параметрах выполнимый план покупки не найден в горизонте 30 лет.');
    expect(wrapper.find('article.card.cash p.empty').text()).toBe('При этих параметрах выполнимая покупка за накопления не найдена в горизонте 60 лет.');
    expect(wrapper.find('p.warning').text()).toBe('Нет выполнимого плана для отображения графика.');
    expect(fakeChart.clear).toHaveBeenCalled();
  });

  it('shows the chart failure warning when rendering throws', async () => {
    fakeChart.setOption.mockImplementationOnce(() => { throw new Error('canvas is broken'); });
    const wrapper = mount(App);
    await settle();
    expect(wrapper.text()).toContain('Не удалось построить график — проверьте параметры.');
    expect(wrapper.find('.cashflow-echarts').attributes('style')).toContain('display: none');
  });

  it('shows and hides the badge tooltip on hover', async () => {
    const wrapper = mount(App);
    await settle();
    const badge = wrapper.find('.cf-badge');
    await badge.trigger('mouseenter', { clientX: 200, clientY: 100 });
    const tip = wrapper.find('.chart-tooltip');
    expect(tip.exists()).toBe(true);
    expect(tip.text()).toMatch(/^Сделка: [а-яё]+ \d{4}$/);
    await badge.trigger('mouseleave');
    await settle();
    expect(wrapper.find('.chart-tooltip').exists()).toBe(false);
  });

  it('resets all parameters with the reset button', async () => {
    const wrapper = mount(App);
    await settle();
    await setAmount(wrapper, 'Текущие накопления', '6000000');
    await button(wrapper, 'Растянуть на 30 лет').trigger('click');
    await button(wrapper, 'Без ремонта').trigger('click');
    await settle();
    expect(wrapper.find('.renovation-fields').exists()).toBe(true);
    await wrapper.find('button[aria-label="Сбросить пример"]').trigger('click');
    await settle();
    expect(wrapper.find('.renovation-fields').exists()).toBe(false);
    expect(button(wrapper, 'Максимально быстро').classes()).toContain('active');
    expect(wrapper.find('article.card.mortgage .big').text()).toBe('3 года 5 месяцев');
    expect(norm(amountInput(wrapper, 'Текущие накопления').element.value)).toBe('0');
  });
});
