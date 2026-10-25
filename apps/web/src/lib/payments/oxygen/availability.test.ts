import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decideOxygenNewInitiation,
  decideOxygenRecovery,
  type OxygenAvailabilityInput,
} from './availability';

// Synthetic fixtures only; no real provider material.
const MERCHANT_ID = 'syn-merchant-9f1a';
const CUSTOMER_ID = 'syn-customer-3c7e';
const ORDER_ID = 'syn-order-51b2';
const ATTEMPT_ID = 'syn-attempt-77d0';
const ENV = 'syn-test';

const BASE_INPUT: OxygenAvailabilityInput = {
  merchant: { id: MERCHANT_ID },
  customer: { id: CUSTOMER_ID },
  order: { id: ORDER_ID, merchantId: MERCHANT_ID },
  environment: ENV,
  expectedEnvironment: ENV,
  policy: { guestInitiationsAllowed: false },
  rollout: { newInitiationsEnabled: true },
  providerReadiness: { verified: true },
};

const BASE_RECOVERY = {
  merchant: { id: MERCHANT_ID },
  attempt: { id: ATTEMPT_ID, merchantId: MERCHANT_ID, environment: ENV },
  environment: ENV,
  expectedEnvironment: ENV,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('availability module shape', () => {
  it('imports nothing: pure policy with no provider surface', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/payments/oxygen/availability.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/^import /m);
  });

  it('never logs while deciding', () => {
    const spies = (['log', 'error', 'warn', 'debug', 'info'] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {})
    );

    decideOxygenNewInitiation(BASE_INPUT);
    decideOxygenNewInitiation({ ...BASE_INPUT, rollout: null });
    decideOxygenRecovery(BASE_RECOVERY);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('decideOxygenNewInitiation', () => {
  it('allows a fully valid initiation request', () => {
    expect(decideOxygenNewInitiation(BASE_INPUT)).toEqual({ allowed: true });
  });

  it.each([
    ['empty merchant id', { merchant: { id: '' } }],
    ['whitespace merchant id', { merchant: { id: '   ' } }],
    ['empty order id', { order: { id: '', merchantId: MERCHANT_ID } }],
    [
      'cross-merchant order',
      { order: { id: ORDER_ID, merchantId: 'syn-merchant-other' } },
    ],
    ['empty customer id', { customer: { id: '' } }],
    ['whitespace customer id', { customer: { id: '  ' } }],
  ])('denies binding faults (%s) with identity_mismatch', (_label, patch) => {
    expect(decideOxygenNewInitiation({ ...BASE_INPUT, ...patch })).toEqual({
      allowed: false,
      reason: 'oxygen_identity_mismatch',
    });
  });

  it.each([
    ['different environment', 'syn-other'],
    ['empty environment', ''],
  ])('denies %s with environment_mismatch', (_label, environment) => {
    expect(decideOxygenNewInitiation({ ...BASE_INPUT, environment })).toEqual({
      allowed: false,
      reason: 'oxygen_environment_mismatch',
    });
  });

  it('denies guests while the injected policy disallows them', () => {
    expect(
      decideOxygenNewInitiation({ ...BASE_INPUT, customer: null })
    ).toEqual({ allowed: false, reason: 'oxygen_guest_not_allowed' });
  });

  it('honors an injected guest allowance without inventing the decision', () => {
    expect(
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        customer: null,
        policy: { guestInitiationsAllowed: true },
      })
    ).toEqual({ allowed: true });
  });

  it.each([
    [null],
    ['yes'],
    [42],
  ])('denies missing or malformed rollout (%s) with not_configured', (rollout) => {
    expect(
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        rollout: rollout as unknown as { newInitiationsEnabled: boolean },
      })
    ).toEqual({ allowed: false, reason: 'oxygen_not_configured' });
  });

  it.each([
    [false],
    ['yes'],
    [1],
  ])('denies unaffirming rollout (%s) with rollout_disabled', (newInitiationsEnabled) => {
    expect(
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        rollout: {
          newInitiationsEnabled: newInitiationsEnabled as unknown as boolean,
        },
      })
    ).toEqual({ allowed: false, reason: 'oxygen_rollout_disabled' });
  });

  it.each([
    [null],
    ['yes'],
  ])('denies missing or malformed readiness (%s) with not_configured', (providerReadiness) => {
    expect(
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        providerReadiness: providerReadiness as unknown as {
          verified: boolean;
        },
      })
    ).toEqual({ allowed: false, reason: 'oxygen_not_configured' });
  });

  it.each([
    [false],
    ['yes'],
    [0],
  ])('denies unverified provider (%s) with provider_unverified', (verified) => {
    expect(
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        providerReadiness: { verified: verified as unknown as boolean },
      })
    ).toEqual({ allowed: false, reason: 'oxygen_provider_unverified' });
  });

  it('prioritizes binding faults over readiness state', () => {
    expect(
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        merchant: { id: '' },
        environment: 'syn-other',
        rollout: null,
        providerReadiness: null,
      })
    ).toEqual({ allowed: false, reason: 'oxygen_identity_mismatch' });
  });

  it('prioritizes environment faults over rollout state', () => {
    expect(
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        environment: 'syn-other',
        rollout: { newInitiationsEnabled: false },
        providerReadiness: { verified: false },
      })
    ).toEqual({ allowed: false, reason: 'oxygen_environment_mismatch' });
  });

  it('prioritizes missing config over disabled rollout and unverified provider', () => {
    expect(
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        rollout: null,
        providerReadiness: { verified: false },
      })
    ).toEqual({ allowed: false, reason: 'oxygen_not_configured' });
  });

  it('prioritizes disabled rollout over unverified provider', () => {
    expect(
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        rollout: { newInitiationsEnabled: false },
        providerReadiness: { verified: false },
      })
    ).toEqual({ allowed: false, reason: 'oxygen_rollout_disabled' });
  });

  it('echoes no identities in decisions', () => {
    const decisions = [
      decideOxygenNewInitiation(BASE_INPUT),
      decideOxygenNewInitiation({ ...BASE_INPUT, rollout: null }),
      decideOxygenNewInitiation({
        ...BASE_INPUT,
        order: { id: ORDER_ID, merchantId: 'syn-merchant-other' },
      }),
    ];

    for (const decision of decisions) {
      const serialized = JSON.stringify(decision);
      expect(serialized).not.toContain(MERCHANT_ID);
      expect(serialized).not.toContain(CUSTOMER_ID);
      expect(serialized).not.toContain(ORDER_ID);
    }
  });
});

describe('decideOxygenRecovery', () => {
  it('allows recovery for a bound attempt regardless of initiation flags', () => {
    // The recovery decision takes no rollout/readiness inputs by
    // construction: disabling new initiations cannot block recovery.
    expect(decideOxygenRecovery(BASE_RECOVERY)).toEqual({ allowed: true });
  });

  it.each([
    [
      'cross-merchant attempt',
      BASE_RECOVERY.merchant,
      { ...BASE_RECOVERY.attempt, merchantId: 'syn-merchant-other' },
    ],
    [
      'empty attempt id',
      BASE_RECOVERY.merchant,
      { ...BASE_RECOVERY.attempt, id: '' },
    ],
    ['empty merchant id', { id: '' }, BASE_RECOVERY.attempt],
  ])('denies binding faults (%s) with identity_mismatch', (_label, merchant, attempt) => {
    expect(
      decideOxygenRecovery({ ...BASE_RECOVERY, merchant, attempt })
    ).toEqual({ allowed: false, reason: 'oxygen_identity_mismatch' });
  });

  it('denies environment mismatch between caller and attempt', () => {
    expect(
      decideOxygenRecovery({ ...BASE_RECOVERY, environment: 'syn-other' })
    ).toEqual({ allowed: false, reason: 'oxygen_environment_mismatch' });
  });

  it('denies an attempt bound to a different environment', () => {
    expect(
      decideOxygenRecovery({
        ...BASE_RECOVERY,
        attempt: { ...BASE_RECOVERY.attempt, environment: 'syn-other' },
      })
    ).toEqual({ allowed: false, reason: 'oxygen_environment_mismatch' });
  });
});
