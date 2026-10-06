// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

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

describe('main.js entry point', () => {
  it('mounts the application into #app', async () => {
    const host = document.createElement('div');
    host.id = 'app';
    document.body.appendChild(host);
    await import('./main.js');
    expect(host.querySelector('h1').textContent).toBe('Калькулятор покупки недвижимости');
    expect(host.textContent).toContain('Ваши параметры');
    expect(initChart).toHaveBeenCalledTimes(1);
  });
});
