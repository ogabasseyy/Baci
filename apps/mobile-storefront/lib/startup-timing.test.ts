import { describe, expect, it, jest } from '@jest/globals';

describe('startup timing', () => {
  it('keeps the initial clock when performance is installed later', () => {
    const originalPerformance = Object.getOwnPropertyDescriptor(
      globalThis,
      'performance'
    );
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(10000);
    try {
      Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: undefined,
      });
      jest.isolateModules(() => {
        const { markStartupTiming } =
          require('./startup-timing') as typeof import('./startup-timing');
        Object.defineProperty(globalThis, 'performance', {
          configurable: true,
          value: { now: () => 12 },
        });
        dateNow.mockReturnValue(10125);
        markStartupTiming('root_mounted');
      });
      expect(log).toHaveBeenCalledWith('[StartupTiming]', 'root_mounted', 125);
    } finally {
      if (originalPerformance)
        Object.defineProperty(globalThis, 'performance', originalPerformance);
      else Reflect.deleteProperty(globalThis, 'performance');
      dateNow.mockRestore();
      log.mockRestore();
    }
  });

  it('records each milestone only once without including user data', () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.isolateModules(() => {
      const { markStartupTiming } =
        require('./startup-timing') as typeof import('./startup-timing');
      markStartupTiming('js_entry');
      markStartupTiming('js_entry');
      markStartupTiming('root_first_layout');
    });
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(
      1,
      '[StartupTiming]',
      'js_entry',
      expect.any(Number)
    );
    expect(log).toHaveBeenNthCalledWith(
      2,
      '[StartupTiming]',
      'root_first_layout',
      expect.any(Number)
    );
    log.mockRestore();
  });
});
