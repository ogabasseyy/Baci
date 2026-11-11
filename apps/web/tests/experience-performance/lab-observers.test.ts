import { afterEach, expect, it, vi } from 'vitest';
import { installLabObservers, readLabMetrics } from './lab-observers';

afterEach(() => vi.unstubAllGlobals());
it('records frame LCP, max CLS session windows, recent-input exclusion and event duration independently', () => {
  const callbacks = new Map<string, (entries: unknown[]) => void>();
  vi.stubGlobal('window', {});
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      static supportedEntryTypes = [
        'largest-contentful-paint',
        'layout-shift',
        'event',
      ];
      constructor(
        private callback: (list: { getEntries: () => unknown[] }) => void
      ) {}
      observe({ type }: { type: string }) {
        callbacks.set(type, (entries) =>
          this.callback({ getEntries: () => entries })
        );
      }
    }
  );
  installLabObservers();
  callbacks.get('largest-contentful-paint')?.([
    { entryType: 'largest-contentful-paint', startTime: 123 },
  ]);
  const shifts = [
    [100, 0.03, false],
    [400, 0.04, false],
    [500, 0.9, true],
    [1600, 0.02, false],
    [2000, 0.02, false],
    [7100, 0.08, false],
  ];
  callbacks.get('layout-shift')?.(
    shifts.map(([startTime, value, hadRecentInput]) => ({
      entryType: 'layout-shift',
      startTime,
      value,
      hadRecentInput,
    }))
  );
  callbacks.get('event')?.([
    { entryType: 'event', duration: 32 },
    { entryType: 'event', duration: 16 },
  ]);
  expect(readLabMetrics()).toMatchObject({
    lcpMs: 123,
    cls: 0.08,
    interactionDurationMs: 32,
  });
});
it('does not turn unsupported or absent measurements into passing zeroes', () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('PerformanceObserver', { supportedEntryTypes: [] });
  installLabObservers();
  expect(readLabMetrics()).toMatchObject({
    lcpMs: null,
    cls: null,
    interactionDurationMs: null,
    observed: [],
  });
});
