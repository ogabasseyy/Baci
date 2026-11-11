import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authenticate,
  makeOrder,
  receiptResolverTestMocks as mocks,
  okJson,
  resolveReceiptVirtualAccount as resolveOrderReceiptVirtualAccount,
  setupReceiptResolverTest,
  teardownReceiptResolverTest,
} from './resolveOrderReceiptVirtualAccount.test-support';

describe('resolveOrderReceiptVirtualAccount fallbacks', () => {
  beforeEach(setupReceiptResolverTest);
  afterEach(teardownReceiptResolverTest);

  it('returns null when there is no session or fallback account available', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    expect(
      await resolveOrderReceiptVirtualAccount({
        merchant: null,
        order: makeOrder(),
      })
    ).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.getSession.mockRejectedValue(new Error('session failed'));
    expect(
      await resolveOrderReceiptVirtualAccount({
        merchant: null,
        order: makeOrder(),
      })
    ).toBeNull();
  });

  it('returns null when generation fails and no merchant fallback exists', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue({ ok: false });

    expect(
      await resolveOrderReceiptVirtualAccount({
        merchant: null,
        order: makeOrder(),
      })
    ).toBeNull();

    mocks.fetch.mockRejectedValue(new Error('network failed'));
    expect(
      await resolveOrderReceiptVirtualAccount({
        merchant: null,
        order: makeOrder(),
      })
    ).toBeNull();
  });

  it('does not promote a staff terminal or merchant bank to automatic confirmation', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue({ ok: false });
    const account = await resolveOrderReceiptVirtualAccount({
      merchant: {
        bank_account_name: 'Manual Merchant',
        bank_account_number: '2222222222',
        bank_code: '058',
        business_name: 'Merchant',
      },
      order: makeOrder({
        staff_terminal: {
          account_name: 'Staff',
          account_number: '1111111111',
          bank_name: 'Terminal bank',
        },
      }),
    });
    expect(account).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toContain('/generate-dva');
  });
  it('leaves malformed or rejected provider responses out of the automatic slot', async () => {
    authenticate();
    mocks.fetch.mockResolvedValue(okJson({ virtualAccount: [] }));
    expect(
      await resolveOrderReceiptVirtualAccount({
        merchant: null,
        order: makeOrder(),
      })
    ).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
