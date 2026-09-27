import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionInvoiceMethodDva } from '@/lib/provision-invoice-method-dva';
import {
  provisionPayformeRetryDva,
  provisionPreResponsePayformeDva,
} from './payforme-dva';

type ProvisionContext = Parameters<typeof provisionPreResponsePayformeDva>[0];

vi.mock('@/lib/provision-invoice-method-dva', () => ({
  provisionInvoiceMethodDva: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockedProvision = vi.mocked(provisionInvoiceMethodDva);

function baseContext(): ProvisionContext {
  return {
    supabase: {},
    order: { id: 'order-1', amount_paid: 0 },
    merchant: { business_name: 'Test Store', slug: 't' },
    merchantId: 'merchant-1',
    customerEmail: 'buyer@example.com',
    customerName: 'Ada Buyer',
    effectivePaymentMethod: 'payforme',
    orderTotal: 5000,
    orderSubtotal: 4500,
    orderShippingFee: 500,
    orderCurrency: 'NGN',
    amountDueToGateway: 5000,
    savingsAmountUsed: 0,
    walletAmountUsed: 0,
    isWalletFullyPaid: false,
    isQuizVoucherFullyPaid: false,
    idempotencyReplayed: false,
  } as never;
}

describe('provisionPreResponsePayformeDva', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips non-payforme methods and replays without attempting', async () => {
    await expect(
      provisionPreResponsePayformeDva({
        ...baseContext(),
        effectivePaymentMethod: 'paystack',
      })
    ).resolves.toEqual({ virtualAccount: null, attempted: false });
    await expect(
      provisionPreResponsePayformeDva({
        ...baseContext(),
        idempotencyReplayed: true,
      })
    ).resolves.toEqual({ virtualAccount: null, attempted: false });
    expect(mockedProvision).not.toHaveBeenCalled();
  });

  it('skips fully covered orders without attempting', async () => {
    await expect(
      provisionPreResponsePayformeDva({
        ...baseContext(),
        order: { id: 'order-1', amount_paid: 5000 },
      })
    ).resolves.toEqual({ virtualAccount: null, attempted: false });
    expect(mockedProvision).not.toHaveBeenCalled();
  });

  it('returns the provisioned account on success', async () => {
    const virtualAccount = { account_number: '0199999999' };
    mockedProvision.mockResolvedValue({
      outcome: 'provisioned',
      virtualAccount,
    } as never);
    await expect(
      provisionPreResponsePayformeDva(baseContext())
    ).resolves.toEqual({ virtualAccount, attempted: true });
  });

  it('allows a retry after a failed outcome or a throw', async () => {
    mockedProvision.mockResolvedValue({ outcome: 'failed' } as never);
    await expect(
      provisionPreResponsePayformeDva(baseContext())
    ).resolves.toEqual({ virtualAccount: null, attempted: false });

    mockedProvision.mockRejectedValue(new Error('boom'));
    await expect(
      provisionPreResponsePayformeDva(baseContext())
    ).resolves.toEqual({ virtualAccount: null, attempted: false });
  });
});

describe('provisionPayformeRetryDva', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the pre-response account instead of provisioning again', async () => {
    const virtualAccount = { account_number: '0199999999' };
    await expect(
      provisionPayformeRetryDva(baseContext(), {
        virtualAccount: virtualAccount as never,
        attempted: true,
      })
    ).resolves.toBe(virtualAccount);
    expect(mockedProvision).not.toHaveBeenCalled();
  });

  it('does not retry an attempted-but-empty pre-response', async () => {
    await expect(
      provisionPayformeRetryDva(baseContext(), {
        virtualAccount: null,
        attempted: true,
      })
    ).resolves.toBeNull();
    expect(mockedProvision).not.toHaveBeenCalled();
  });
});
