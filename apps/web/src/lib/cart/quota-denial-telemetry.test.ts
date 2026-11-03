import { afterEach, expect, it, vi } from 'vitest';
import {
  __resetQuotaDenialTelemetryForTesting,
  recordQuotaDenial,
} from './quota-denial-telemetry';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  __resetQuotaDenialTelemetryForTesting();
});

it('aggregates bursts and reports the pending denials when the next window starts', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const event = {
    operation: 'create',
    identity: 'missing_credential',
    scope: 'merchant',
    degraded: false,
  } as const;
  for (let i = 0; i < 100; i++) recordQuotaDenial(event);
  expect(log.mock.calls.map(([, value]) => value.occurrences)).toEqual([
    1, 2, 4, 8, 16, 32,
  ]);
  vi.advanceTimersByTime(60_000);
  recordQuotaDenial(event);
  expect(log.mock.lastCall?.[1]).toEqual({ ...event, occurrences: 38 });
});
