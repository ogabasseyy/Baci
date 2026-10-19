import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./refund-notification-ledger', () => ({
  refundNotificationLedgerAmount: vi.fn(),
}));
vi.mock('./deliver-merchant-refund-notification', () => ({
  deliverMerchantRefundNotification: vi.fn(),
}));

import { deliverClaimedRefundNotification } from './deliver-claimed-refund-notification';
import { deliverMerchantRefundNotification } from './deliver-merchant-refund-notification';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';

const row = {
  attempts: 0,
  claim_token: 'token',
  created_at: '2026-09-28T12:00:00Z',
  event_type: 'processed_customer_email',
  generation: 1,
  id: 'row-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
} as const;

type CopyRow = {
  gateway: unknown;
  metadata?: Record<string, unknown>;
  status: string;
};

function buildSupabase(refundRows: CopyRow[], paymentRows: CopyRow[] = []) {
  const chains: Record<string, Record<string, unknown>> = {};
  let transactionsCalls = 0;
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    // The first transactions probe lists terminal refund rows; the
    // second (only when no refund row is provider-backed) lists
    // self-terminal refunded payments.
    transactionsCalls += table === 'transactions' ? 1 : 0;
    const probeRows =
      table === 'transactions' && transactionsCalls > 1
        ? paymentRows
        : refundRows;
    // Emulate the terminal-status filter so failed provider rows
    // never reach the worker, exactly like the database query.
    let visible = probeRows;
    chain.in = vi.fn((column: string, values: string[]) => {
      if (column === 'status') {
        visible = visible.filter((refund) => values.includes(refund.status));
      }
      return chain;
    });
    if (table === 'orders') {
      chain.single = vi.fn().mockResolvedValue({
        data: {
          cancelled_at: '2026-09-28T12:00:00Z',
          currency: 'NGN',
          customer_email: 'buyer@example.test',
          customer_id: null,
          customer_name: 'Ada',
          id: 'order-1',
          merchant_id: 'merchant-1',
          order_number: '1001',
          payment_status: 'refunded',
        },
        error: null,
      });
    } else if (table === 'merchants') {
      chain.single = vi.fn().mockResolvedValue({
        data: {
          business_name: 'Shop',
          email: 'shop@example.test',
          email_sender_name: null,
          id: 'merchant-1',
          support_email: null,
        },
        error: null,
      });
    } else {
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
      chain.then = (resolve: (value: unknown) => void) =>
        Promise.resolve({
          data: visible,
          error: null,
        }).then(resolve);
    }
    // The status-filter assertion below targets the refund probe,
    // so the later payment probe must not overwrite it.
    chains[table] ??= chain;
    return chain;
  });
  return { chains, from };
}

function deliver(refundRows: CopyRow[], paymentRows: CopyRow[] = []) {
  const sendEmail = vi
    .fn()
    .mockResolvedValue({ deliveryOutcome: undefined, success: true });
  const client = buildSupabase(refundRows, paymentRows);
  return {
    chains: client.chains,
    promise: deliverClaimedRefundNotification({
      row: { ...row },
      sendEmail,
      supabase: { from: client.from } as never,
    }),
    sendEmail,
  };
}

describe('deliverClaimedRefundNotification manual copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(refundNotificationLedgerAmount).mockResolvedValue('₦100.00');
    vi.mocked(deliverMerchantRefundNotification).mockResolvedValue({
      lastError: null,
      outcome: 'sent',
    });
  });

  it('uses neutral copy when every refund row is manual', async () => {
    const { promise, sendEmail } = deliver([
      { gateway: 'manual', status: 'completed' },
      { gateway: 'manual', status: 'completed' },
    ]);

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.textContent).toContain('If you have any questions');
    expect(message.textContent).not.toContain('business days');
    expect(message.htmlContent).toContain('If you have any questions');
    expect(message.htmlContent).not.toContain('business days');
  });

  it('keeps the provider timeline when any refund row is non-manual', async () => {
    const { promise, sendEmail } = deliver([
      { gateway: 'manual', status: 'completed' },
      { gateway: 'paystack', status: 'completed' },
    ]);

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.textContent).toContain('10 business days');
    expect(message.htmlContent).toContain('10 business days');
  });

  it('fails toward the provider copy on unknown gateways', async () => {
    const { promise, sendEmail } = deliver([
      { gateway: null, status: 'completed' },
      { gateway: '', status: 'completed' },
    ]);

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    expect(vi.mocked(sendEmail).mock.calls[0][0].textContent).toContain(
      '10 business days'
    );
  });

  it('ignores failed provider rows when choosing email copy', async () => {
    // A failed automatic Paystack refund beside a manual cash
    // completion moved no provider money: the probe filters it out
    // and the customer gets the neutral copy.
    const { chains, promise, sendEmail } = deliver([
      { gateway: 'paystack', status: 'failed' },
      { gateway: 'manual', status: 'completed' },
    ]);

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    expect(chains.transactions.in).toHaveBeenCalledWith('status', [
      'completed',
      'refunded',
    ]);
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.textContent).toContain('If you have any questions');
    expect(message.textContent).not.toContain('business days');
  });

  it('treats a verified manual Paystack attestation as provider money', async () => {
    const { promise, sendEmail } = deliver([
      {
        gateway: 'manual',
        metadata: { method: 'paystack', provider_refund_status: 'processed' },
        status: 'completed',
      },
    ]);

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    expect(vi.mocked(sendEmail).mock.calls[0][0].textContent).toContain(
      '10 business days'
    );
  });

  it('keeps neutral copy for unverified manual Paystack claims', async () => {
    const { promise, sendEmail } = deliver(
      [
        {
          gateway: 'manual',
          metadata: { method: 'paystack' },
          status: 'completed',
        },
      ],
      []
    );

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.textContent).toContain('If you have any questions');
    expect(message.textContent).not.toContain('business days');
  });

  it('counts self-terminal provider payments as provider money', async () => {
    const { promise, sendEmail } = deliver(
      [{ gateway: 'manual', status: 'completed' }],
      [{ gateway: 'paypal', status: 'refunded' }]
    );

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    expect(vi.mocked(sendEmail).mock.calls[0][0].textContent).toContain(
      '10 business days'
    );
  });

  it('ignores internal-leg payment flips when choosing email copy', async () => {
    const { promise, sendEmail } = deliver(
      [{ gateway: 'manual', status: 'completed' }],
      [{ gateway: 'wallet', status: 'refunded' }]
    );

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.textContent).toContain('If you have any questions');
    expect(message.textContent).not.toContain('business days');
  });
});
