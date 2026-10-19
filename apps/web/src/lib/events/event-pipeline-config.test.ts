import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventPipelineAuthorityCutover } from './event-pipeline-authority-cutover';
import {
  getEventDeliveryConcurrency,
  getEventDeliveryMaxAttempts,
  getEventIngressMaxReads,
  getEventPipelineActiveDestinations,
  getEventPipelineRoutingMode,
  isEventPipelineCanaryMerchant,
  isEventPipelineDeliveryEnabled,
  isEventPipelineEnqueueEnabled,
  isLegacyAnalyticsFanoutDisabled,
  isUnverifiedEventTelemetryEnabled,
} from './event-pipeline-config';

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

describe('event pipeline configuration facade', () => {
  it('preserves fail-closed defaults through the public facade', () => {
    delete process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;
    delete process.env.EVENT_PIPELINE_DELIVERY_ENABLED;
    delete process.env.EVENT_PIPELINE_ROUTING_MODE;
    delete process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT;
    delete process.env.EVENT_PIPELINE_ALLOW_UNVERIFIED_TELEMETRY;
    delete process.env.EVENT_PIPELINE_MAX_DELIVERY_ATTEMPTS;
    delete process.env.EVENT_PIPELINE_DELIVERY_CONCURRENCY;
    delete process.env.EVENT_PIPELINE_INGRESS_MAX_READS;
    delete process.env.EVENT_PIPELINE_ACTIVE_DESTINATIONS;
    delete process.env.EVENT_PIPELINE_CANARY_MERCHANT_IDS;

    expect(isEventPipelineEnqueueEnabled()).toBe(false);
    expect(isEventPipelineDeliveryEnabled()).toBe(false);
    expect(getEventPipelineRoutingMode()).toBe('disabled');
    expect(isLegacyAnalyticsFanoutDisabled()).toBe(false);
    expect(isUnverifiedEventTelemetryEnabled()).toBe(false);
    expect(getEventDeliveryMaxAttempts()).toBe(8);
    expect(getEventDeliveryConcurrency()).toBe(5);
    expect(getEventIngressMaxReads()).toBe(5);
    expect(getEventPipelineActiveDestinations()).toEqual([]);
    expect(isEventPipelineCanaryMerchant('merchant-1')).toBe(false);
  });

  it('preserves the complete active configuration through the public facade', () => {
    process.env.EVENT_PIPELINE_ENQUEUE_ENABLED = 'true';
    process.env.EVENT_PIPELINE_DELIVERY_ENABLED = 'true';
    process.env.EVENT_PIPELINE_ROUTING_MODE = 'active';
    process.env.EVENT_PIPELINE_DISABLE_LEGACY_FANOUT = 'true';
    process.env.EVENT_PIPELINE_ALLOW_UNVERIFIED_TELEMETRY = 'true';
    process.env.EVENT_PIPELINE_MAX_DELIVERY_ATTEMPTS = '12';
    process.env.EVENT_PIPELINE_DELIVERY_CONCURRENCY = '7';
    process.env.EVENT_PIPELINE_INGRESS_MAX_READS = '9';
    process.env.EVENT_PIPELINE_ACTIVE_DESTINATIONS =
      'facebook,ga4,snapchat,tiktok';
    process.env.EVENT_PIPELINE_CANARY_MERCHANT_IDS = '*';

    expect(isEventPipelineEnqueueEnabled()).toBe(true);
    expect(isEventPipelineDeliveryEnabled()).toBe(true);
    expect(getEventPipelineRoutingMode()).toBe('active');
    expect(isLegacyAnalyticsFanoutDisabled()).toBe(false);
    expect(isUnverifiedEventTelemetryEnabled()).toBe(true);
    expect(getEventDeliveryMaxAttempts()).toBe(12);
    expect(getEventDeliveryConcurrency()).toBe(7);
    expect(getEventIngressMaxReads()).toBe(9);
    expect(getEventPipelineActiveDestinations()).toEqual([
      'facebook',
      'ga4',
      'snapchat',
      'tiktok',
    ]);
    expect(isEventPipelineCanaryMerchant()).toBe(true);
  });
});
