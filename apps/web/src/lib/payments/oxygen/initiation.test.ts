import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mapAvailabilityDecision,
  mapInitiationDecision,
  type OxygenPolicyDecision,
} from './initiation';

const DENY_TABLE: Array<{
  reason: Extract<OxygenPolicyDecision, { allowed: false }>['reason'];
  message: string;
}> = [
  {
    reason: 'oxygen_identity_mismatch',
    message: 'This order cannot use Oxygen.',
  },
  {
    reason: 'oxygen_environment_mismatch',
    message: 'Oxygen is not available here.',
  },
  {
    reason: 'oxygen_guest_not_allowed',
    message: 'Sign in to continue with Oxygen.',
  },
  {
    reason: 'oxygen_not_configured',
    message: 'Oxygen is not available for this store.',
  },
  {
    reason: 'oxygen_rollout_disabled',
    message: 'Oxygen is not available right now.',
  },
  {
    reason: 'oxygen_provider_unverified',
    message: 'Oxygen is not available for this store.',
  },
];

describe('mapInitiationDecision', () => {
  it.each(DENY_TABLE)('maps $reason to its 403 message', ({
    reason,
    message,
  }) => {
    expect(mapInitiationDecision({ allowed: false, reason })).toEqual({
      status: 403,
      body: { error: message, code: reason },
    });
  });

  it('maps an allow to the constant 503 (no execution stage exists)', () => {
    expect(mapInitiationDecision({ allowed: true })).toEqual({
      status: 503,
      body: {
        error: 'Oxygen provider unavailable',
        code: 'oxygen_provider_unavailable',
      },
    });
  });

  it('maps the guest denial at unit level (route-unreachable on this path)', () => {
    // F4: customer-path guest-403 is pinned here only; routes 404 first.
    expect(
      mapInitiationDecision({
        allowed: false,
        reason: 'oxygen_guest_not_allowed',
      })
    ).toEqual({
      status: 403,
      body: {
        error: 'Sign in to continue with Oxygen.',
        code: 'oxygen_guest_not_allowed',
      },
    });
  });

  it('returns key-exact bodies', () => {
    const deny = mapInitiationDecision({
      allowed: false,
      reason: 'oxygen_rollout_disabled',
    });
    const allow = mapInitiationDecision({ allowed: true });
    expect(Object.keys(deny.body).sort()).toEqual(['code', 'error']);
    expect(Object.keys(allow.body).sort()).toEqual(['code', 'error']);
  });
});

describe('mapAvailabilityDecision', () => {
  it.each(DENY_TABLE)('maps $reason to available:false', ({ reason }) => {
    expect(mapAvailabilityDecision({ allowed: false, reason })).toEqual({
      status: 200,
      body: { available: false, reason },
    });
  });

  it('maps an allow to available:true with no reason key', () => {
    const mapped = mapAvailabilityDecision({ allowed: true });
    expect(mapped).toEqual({ status: 200, body: { available: true } });
    expect(mapped.body).not.toHaveProperty('reason');
  });

  it('returns key-exact bodies', () => {
    const deny = mapAvailabilityDecision({
      allowed: false,
      reason: 'oxygen_rollout_disabled',
    });
    const allow = mapAvailabilityDecision({ allowed: true });
    expect(Object.keys(deny.body).sort()).toEqual(['available', 'reason']);
    expect(Object.keys(allow.body).sort()).toEqual(['available']);
  });
});

describe('shared-decision consistency (mapper level)', () => {
  it.each(DENY_TABLE)('agrees on $reason at both entry points', ({
    reason,
  }) => {
    const initiation = mapInitiationDecision({ allowed: false, reason });
    const availability = mapAvailabilityDecision({ allowed: false, reason });
    expect(initiation.status).toBe(403);
    expect(initiation.body.code).toBe(reason);
    expect(availability.body).toEqual({ available: false, reason });
  });

  it('agrees on allow at both entry points', () => {
    expect(mapInitiationDecision({ allowed: true }).status).toBe(503);
    expect(mapAvailabilityDecision({ allowed: true }).body).toEqual({
      available: true,
    });
  });
});

describe('initiation module shape', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/lib/payments/oxygen/initiation.ts'),
    'utf8'
  );

  it('imports nothing: pure mappers with no provider surface', () => {
    expect(source).not.toMatch(/^import /m);
  });

  it('never touches the provider, env, console, or storage', () => {
    expect(source).not.toContain('transport');
    expect(source).not.toContain('token-cache');
    expect(source).not.toContain('availability');
    expect(source).not.toContain('process.env');
    expect(source).not.toContain('console');
    expect(source).not.toMatch(/\b(insert|upsert|update|delete|rpc)\b/);
  });
});
