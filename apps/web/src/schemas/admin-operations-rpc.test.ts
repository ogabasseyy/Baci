import { describe, expect, it } from 'vitest';
import type { AdminOperations } from './admin-operations-rpc';
import {
  adminOperationsApiSchema,
  adminOperationsRpcSchema,
} from './admin-operations-rpc';

function payload(): AdminOperations {
  return {
    financial: {
      paymentSideEffects: [],
      payouts: [],
      reconciliationReview: [],
      settlements: [],
    },
    generatedAt: '2026-08-05T15:02:00.000Z',
    notifications: { email: [], orderOutbox: [], push: [], trackingOutbox: [] },
    shipping: { shipments: [], webhooks: [] },
    summary: {
      notifications: 0,
      paymentSideEffects: 0,
      payouts: 0,
      reconciliationReview: 0,
      settlements: 0,
      shipping: 0,
      workers: 0,
    },
    workers: [],
  };
}

function emailIncident(
  overrides: Partial<AdminOperations['notifications']['email'][number]> = {}
): AdminOperations['notifications']['email'][number] {
  return {
    attemptCount: 1,
    createdAt: '2026-08-05T15:02:00.000Z',
    emailType: 'order_confirmation',
    id: 'email-1',
    merchantId: 'merchant-1',
    merchantName: 'Merchant',
    provider: 'zeptomail',
    providerErrorCode: null,
    status: 'failed',
    ...overrides,
  };
}

describe('adminOperationsRpcSchema', () => {
  it('accepts the redacted empty operations envelope', () => {
    expect(adminOperationsRpcSchema.safeParse(payload()).success).toBe(true);
  });

  it('requires explicit privileged capabilities on API responses', () => {
    expect(
      adminOperationsApiSchema.safeParse({
        ...payload(),
        capabilities: { canReadFinancials: false, canReplay: false },
      }).success
    ).toBe(true);
    expect(adminOperationsApiSchema.safeParse(payload()).success).toBe(false);
  });

  it('accepts currencyless settlement exceptions with null amount and currency', () => {
    const result = payload();
    result.financial.settlements.push({
      createdAt: null,
      currency: null,
      expectedSettlementDate: '2026-08-05',
      gateway: 'korapay',
      id: 'settlement-without-currency',
      merchantId: 'merchant-1',
      merchantName: 'Merchant',
      netAmount: null,
      status: 'failed',
    });

    expect(adminOperationsRpcSchema.safeParse(result).success).toBe(true);
  });

  it('rejects a raw error field instead of treating it as an operational item', () => {
    const result: unknown = {
      ...payload(),
      shipping: {
        ...payload().shipping,
        webhooks: [
          {
            createdAt: null,
            error: 'customer@example.com',
            eventType: null,
            id: 'webhook-1',
            processed: false,
            provider: 'gigl',
            shipmentId: null,
          },
        ],
      },
    };

    expect(adminOperationsRpcSchema.safeParse(result).success).toBe(false);
  });

  it('rejects a hostile provider error code in the browser DTO', () => {
    const result: unknown = {
      ...payload(),
      notifications: {
        ...payload().notifications,
        email: [
          {
            ...emailIncident(),
            providerErrorCode: 'recipient@example.com: request failed',
          },
        ],
      },
    };

    expect(adminOperationsRpcSchema.safeParse(result).success).toBe(false);
  });

  it('accepts failed and stale email incidents but rejects other states', () => {
    const result = payload();
    result.notifications.email.push(
      emailIncident({ id: 'email-failed' }),
      emailIncident({
        attemptCount: 0,
        createdAt: '2026-08-05T15:03:00.000Z',
        emailType: 'password_reset',
        id: 'email-stale',
        status: 'stale',
      })
    );

    expect(adminOperationsRpcSchema.safeParse(result).success).toBe(true);

    const invalidResult: unknown = {
      ...payload(),
      notifications: {
        ...payload().notifications,
        email: [
          {
            ...emailIncident({ id: 'email-processing' }),
            status: 'processing',
          },
        ],
      },
    };

    expect(adminOperationsRpcSchema.safeParse(invalidResult).success).toBe(
      false
    );
  });
});
