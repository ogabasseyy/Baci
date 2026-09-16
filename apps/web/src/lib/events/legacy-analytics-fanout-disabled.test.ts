import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventPipelineAuthorityCutover } from './event-pipeline-authority-cutover';
import { isLegacyAnalyticsFanoutDisabled } from './legacy-analytics-fanout-disabled';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  Object.defineProperty(
    eventPipelineAuthorityCutover,
    'queueOnlyDeliveryActivated',
    { configurable: true, value: false }
  );
  vi.useRealTimers();
});

describe('isLegacyAnalyticsFanoutDisabled', () => {
  it('revokes authority at the fixed expiry', () => {
    delete process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT;
    delete process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;
    delete process.env.EVENT_PIPELINE_DELIVERY_ENABLED;
    delete process.env.EVENT_PIPELINE_ROUTING_MODE;
    vi.setSystemTime(new Date('2026-09-29T23:59:59.999Z'));
    expect(isLegacyAnalyticsFanoutDisabled()).toBe(false);
    vi.setSystemTime(new Date('2026-09-30T00:00:00.000Z'));
    expect(isLegacyAnalyticsFanoutDisabled()).toBe(true);
  });

  it('revokes authority when queue-only delivery is active', () => {
    Object.defineProperty(
      eventPipelineAuthorityCutover,
      'queueOnlyDeliveryActivated',
      { configurable: true, value: true }
    );
    delete process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT;
    delete process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;
    delete process.env.EVENT_PIPELINE_DELIVERY_ENABLED;
    delete process.env.EVENT_PIPELINE_ROUTING_MODE;
    expect(isLegacyAnalyticsFanoutDisabled()).toBe(true);
  });

  it('keeps legacy fan-out unless the complete durable path is active', () => {
    process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT = 'true';
    process.env.EVENT_PIPELINE_ENQUEUE_ENABLED = 'true';
    process.env.EVENT_PIPELINE_DELIVERY_ENABLED = 'true';
    process.env.EVENT_PIPELINE_ROUTING_MODE = 'shadow';

    expect(isLegacyAnalyticsFanoutDisabled()).toBe(false);
  });

  it('keeps legacy fan-out when an active destination is missing', () => {
    process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT = 'true';
    process.env.EVENT_PIPELINE_ENQUEUE_ENABLED = 'true';
    process.env.EVENT_PIPELINE_DELIVERY_ENABLED = 'true';
    process.env.EVENT_PIPELINE_ROUTING_MODE = 'active';
    process.env.EVENT_PIPELINE_ACTIVE_DESTINATIONS = 'facebook,ga4,snapchat';
    process.env.EVENT_PIPELINE_CANARY_MERCHANT_IDS = '*';

    expect(isLegacyAnalyticsFanoutDisabled()).toBe(false);
  });
});
