import BaciPerformanceTrace from './BaciPerformanceTraceModule.web';

describe('BaciPerformanceTraceModule.web', () => {
  it('exports the unsupported-platform fallback', () => {
    expect(BaciPerformanceTrace).toBeNull();
  });
});
