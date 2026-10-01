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

  it('ignores a virtual account without an account number and uses an existing terminal', async () => {
    authenticate();
    mocks.fetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(
      okJson({
        terminals: [
          {
            active: true,
            account_name: 'Generated Account',
            account_number: '1234567890',
            bank_name: 'Generated Bank',
          },
        ],
      })
    );

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: null,
      order: makeOrder({
        virtual_account: {
          account_name: 'Broken',
          account_number: '',
          bank_name: 'Broken Bank',
        },
      }),
    });

    expect(account).toEqual({
      account_name: 'Generated Account',
      account_number: '1234567890',
      bank_name: 'Generated Bank',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a staff terminal without an account number and falls back to the merchant account', async () => {
    authenticate();
    mocks.fetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(okJson({ account_name: 'Baci Ltd' }));

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: {
        bank_account_name: '',
        bank_account_number: '0123456789',
        bank_code: '044',
        business_name: 'Baci',
      },
      order: makeOrder({
        staff_terminal: {
          account_name: 'Broken Terminal',
          account_number: '',
          bank_name: 'Broken Bank',
        },
      }),
    });

    expect(account).toMatchObject({
      account_name: 'Baci Ltd',
      account_number: '0123456789',
    });
  });

  it('skips active terminals without account numbers when selecting a receipt fallback', async () => {
    authenticate();
    mocks.fetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(
      okJson({
        terminals: [
          { active: true, account_name: 'Placeholder' },
          {
            active: true,
            account_name: 'Paystack Terminal',
            account_number: '1234567890',
            bank: 'Test Bank',
          },
        ],
      })
    );

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: null,
      order: makeOrder(),
    });

    expect(account).toEqual({
      account_name: 'Paystack Terminal',
      account_number: '1234567890',
      bank_name: 'Test Bank',
    });
  });

  it('ignores malformed API payloads and falls back to the merchant account', async () => {
    authenticate();
    mocks.fetch
      .mockResolvedValueOnce(okJson({ virtualAccount: [] }))
      .mockResolvedValueOnce(okJson({ terminals: {} }))
      .mockResolvedValueOnce(okJson({ account_name: 'Baci Ltd' }));

    const account = await resolveOrderReceiptVirtualAccount({
      merchant: {
        bank_account_name: '',
        bank_account_number: '0123456789',
        bank_code: '044',
        business_name: 'Baci',
      },
      order: makeOrder(),
    });

    expect(account).toMatchObject({
      account_name: 'Baci Ltd',
      account_number: '0123456789',
    });
  });
});
