import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMailMock = vi.fn();

const getZeptoMailTokenMock = vi.fn<() => string | undefined>();
const getZeptoMailFromDomainMock = vi.fn<() => string>();
const getActiveMerchantSendingDomainMock =
  vi.fn<(merchantId: string | null | undefined) => Promise<string | null>>();

const auditState = {
  inserts: [] as unknown[],
  updates: [] as Array<{ patch: Record<string, unknown>; ids: string[] }>,
  nextId: 1,
};

vi.mock('@/lib/zeptomail-transport', () => ({
  ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE: 'ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN',
  zeptoMailRequest: (
    _endpoint: string,
    payload: Record<string, unknown>,
    _token: string
  ) => sendMailMock(payload),
}));

vi.mock('@/env', () => ({
  getZeptoMailToken: getZeptoMailTokenMock,
  getZeptoMailFromDomain: getZeptoMailFromDomainMock,
}));

vi.mock('@/lib/merchant-sending-domain', () => ({
  getActiveMerchantSendingDomain: getActiveMerchantSendingDomainMock,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn((rows: unknown) => ({
        select: vi.fn(() => {
          const insertedRows = Array.isArray(rows) ? rows : [rows];
          auditState.inserts.push(...insertedRows);
          const data = insertedRows.map(() => ({
            id: `attempt-${auditState.nextId++}`,
          }));
          return Promise.resolve({ data, error: null });
        }),
      })),
      update: vi.fn((patch: Record<string, unknown>) => ({
        in: vi.fn((_column: string, ids: string[]) => {
          auditState.updates.push({ patch, ids });
          return Promise.resolve({ error: null });
        }),
      })),
    })),
  })),
}));

describe('zeptomail dispatch reset', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    auditState.inserts = [];
    auditState.updates = [];
    auditState.nextId = 1;
    getZeptoMailTokenMock.mockReturnValue('test-token');
    getZeptoMailFromDomainMock.mockReturnValue('usebaci.com');
    getActiveMerchantSendingDomainMock.mockResolvedValue(null);
  });

  it('reports the definite rejection when an in-loop marker reset fails', async () => {
    const beforeTransportDispatch = vi.fn().mockResolvedValue(undefined);
    const resetTransportDispatch = vi
      .fn()
      .mockRejectedValue(new Error('marker clear failed'));
    sendMailMock.mockRejectedValue({
      error: { message: 'Server overloaded', code: 'TM_5001', details: null },
    });
    const { sendEmail } = await import('./zeptomail');

    const result = await sendEmail({
      to: 'customer@example.com',
      subject: 'Reset failure test',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
      beforeTransportDispatch,
      resetTransportDispatch,
      auditContext: {
        merchantId: 'merchant-1',
        orderId: 'order-1',
      },
    });

    // The reset throw must not convert the definite provider rejection
    // into an unknown outcome: no retry storm, no throw, no unknown flag.
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TM_5001');
    expect('deliveryOutcome' in result).toBe(false);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(resetTransportDispatch).toHaveBeenCalledTimes(1);
    expect(auditState.updates[0]).toMatchObject({
      patch: {
        status: 'failed',
        attempt_count: 1,
        provider_error_code: 'TM_5001',
      },
    });
  });

  it('skips the platform fallback when the dispatch reset fails after a definite rejection', async () => {
    getActiveMerchantSendingDomainMock.mockResolvedValue('ogabassey.com');
    sendMailMock.mockRejectedValue({
      error: { code: 'TM_3201', message: 'Invalid sender domain' },
    });
    const { sendEmail } = await import('./zeptomail');
    const resetTransportDispatch = vi
      .fn()
      .mockRejectedValue(new Error('supabase unavailable'));

    const result = await sendEmail({
      to: 'customer@example.com',
      subject: 'Order Confirmation',
      htmlContent: '<p>Hello</p>',
      emailType: 'orders',
      auditContext: { merchantId: 'merchant-1', orderId: 'order-1' },
      resetTransportDispatch,
    });

    // The primary rejection stays definite (no deliveryOutcome: unknown)
    // so the caller retries; only the custom sender was attempted.
    expect(result).toMatchObject({
      success: false,
      error: 'Invalid sender domain',
    });
    expect(result).not.toHaveProperty('deliveryOutcome');
    expect(sendMailMock.mock.calls.map((c) => c[0]?.from?.address)).toEqual([
      'orders@ogabassey.com',
    ]);
  });
});
