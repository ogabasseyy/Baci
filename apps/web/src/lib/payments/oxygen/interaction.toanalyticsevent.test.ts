import { describe, expect, it } from 'vitest';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import {
  type OxygenInteractionReason,
  toAnalyticsEvent,
  toChatMessageText,
} from './interaction';
import {
  ALL_STATES,
  FIXTURE_EMAIL,
  FIXTURE_ORDER_ID,
  SIX_REASONS,
} from './interaction.test-helpers';

describe('toAnalyticsEvent', () => {
  it('builds the captureClientEvent-shaped payload for known inputs', () => {
    expect(
      toAnalyticsEvent({
        status: 'unavailable',
        reason: 'oxygen_rollout_disabled',
      })
    ).toEqual({
      event: 'oxygen_interaction',
      properties: {
        status: 'unavailable',
        reason: 'oxygen_rollout_disabled',
      },
    });
  });

  it('omits the reason key when no reason is given', () => {
    expect(toAnalyticsEvent({ status: 'ready' })).toEqual({
      event: 'oxygen_interaction',
      properties: { status: 'ready' },
    });
  });

  it.each(ALL_STATES)('accepts the machine state %s', (status) => {
    expect(toAnalyticsEvent({ status })?.properties.status).toBe(status);
  });

  it('returns null for an unknown status (host skips)', () => {
    expect(toAnalyticsEvent({ status: FIXTURE_ORDER_ID })).toBeNull();
    expect(
      toAnalyticsEvent({
        status: FIXTURE_ORDER_ID,
        reason: 'oxygen_rollout_disabled',
      })
    ).toBeNull();
    expect(toAnalyticsEvent({ status: null })).toBeNull();
  });

  it('drops an unknown reason instead of emitting it', () => {
    expect(
      toAnalyticsEvent({ status: 'failed', reason: FIXTURE_ORDER_ID })
    ).toEqual({
      event: 'oxygen_interaction',
      properties: { status: 'failed' },
    });
    expect(
      toAnalyticsEvent({ status: 'failed', reason: FIXTURE_EMAIL })
    ).toEqual({
      event: 'oxygen_interaction',
      properties: { status: 'failed' },
    });
  });

  it('stays passable to the real captureClientEvent sink', () => {
    const built = toAnalyticsEvent({ status: 'ready' });
    expect(built).not.toBeNull();
    if (built === null) return;
    // The call below is the contract: built values must satisfy the real
    // sink signature, so drift on either side fails tsc on this file.
    // (The no-telemetry-import rule constrains the source module, not tests;
    // the sink queues pre-init and never throws, so the call is safe here.)
    captureClientEvent(built.event, built.properties);
    expect(built.event).toBe('oxygen_interaction');
    expect(built.properties.status).toBe('ready');
  });

  it('sweeps every builder output for fixture ids, emails, and free text', () => {
    const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const reasons: Array<OxygenInteractionReason | undefined> = [
      ...SIX_REASONS,
      undefined,
    ];
    for (const status of ALL_STATES) {
      for (const reason of reasons) {
        const built = toAnalyticsEvent({ status, reason });
        expect(built).not.toBeNull();
        const serialized = JSON.stringify(built);
        expect(serialized).not.toContain(FIXTURE_ORDER_ID);
        expect(serialized).not.toContain(FIXTURE_EMAIL);
        expect(serialized).not.toMatch(emailPattern);
        expect(toChatMessageText({ status, reason })).not.toContain(
          FIXTURE_ORDER_ID
        );
      }
    }
  });

  it('uses only telemetry-safe property keys (client-config PII token rules)', () => {
    const sensitiveTokens = new Set([
      'password',
      'passcode',
      'token',
      'secret',
      'authorization',
      'cookie',
      'otp',
      'pin',
      'cvv',
      'card',
      'bvn',
      'nin',
      'email',
      'phone',
      'address',
    ]);
    const tokenize = (key: string): string[] =>
      key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split(/[^a-z0-9]+/);
    for (const status of ALL_STATES) {
      const built = toAnalyticsEvent({
        status,
        reason: 'oxygen_guest_not_allowed',
      });
      expect(built).not.toBeNull();
      for (const key of Object.keys(built?.properties ?? {})) {
        for (const token of tokenize(key)) {
          expect(sensitiveTokens.has(token)).toBe(false);
        }
      }
      const serialized = JSON.stringify(built?.properties);
      expect(serialized).not.toContain('order-fixture');
      expect(serialized).not.toContain('@');
    }
  });
});
