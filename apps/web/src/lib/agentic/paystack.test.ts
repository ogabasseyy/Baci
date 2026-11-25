import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helper: build a mock Response
function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    json: vi.fn().mockResolvedValue(body),
  };
}

describe('agentic/paystack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe('isValidPaystackSubaccountCode', () => {
    it('requires ACCT_ followed by exactly 15 alphanumeric characters', async () => {
      vi.resetModules();
      const { isValidPaystackSubaccountCode } = await import('./paystack');

      expect(isValidPaystackSubaccountCode('ACCT_TESTMOCK1234567')).toBe(true);
      expect(isValidPaystackSubaccountCode('ACCT_abc')).toBe(false);
      expect(isValidPaystackSubaccountCode('ACCT_1234567890123456')).toBe(
        false
      );
      expect(isValidPaystackSubaccountCode('ACCT_TESTMOCK123456!')).toBe(false);
      expect(isValidPaystackSubaccountCode('ACCT_TESTMOCKABCDEFG')).toBe(true);
      expect(isValidPaystackSubaccountCode('SUB_6uujpqtzmnufzkw')).toBe(false);
    });
  });

  describe('createDedicatedVirtualAccount', () => {
    it('fails closed when PAYSTACK_SECRET_KEY is not set', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', '');

      // Re-import to pick up the env change
      vi.resetModules();
      const { createDedicatedVirtualAccount } = await import('./paystack');

      await expect(
        createDedicatedVirtualAccount(
          {
            email: 'test@example.com',
            first_name: 'John',
            last_name: 'Doe',
            phone: '+2348012345678',
          },
          { subaccount: 'ACCT_TESTMOCK1234567' }
        )
      ).rejects.toThrow('PAYSTACK_SECRET_KEY is not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('creates customer then DVA with wema-bank as primary bank', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
      vi.resetModules();
      const { createDedicatedVirtualAccount } = await import('./paystack');

      mockFetch
        // 1. Create customer
        .mockResolvedValueOnce(
          mockResponse(200, {
            status: true,
            data: { customer_code: 'CUS_test123' },
          })
        )
        // 2. Create DVA (wema-bank)
        .mockResolvedValueOnce(
          mockResponse(200, {
            status: true,
            data: {
              account_number: '1234567890',
              account_name: 'MERCHANT/JOHN DOE',
              bank: { name: 'Wema Bank' },
              currency: 'NGN',
            },
          })
        );

      const result = await createDedicatedVirtualAccount(
        {
          email: 'john@test.com',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+2348012345678',
        },
        { subaccount: 'ACCT_TESTMOCK1234567' }
      );

      expect(result.account_number).toBe('1234567890');
      expect(result.bank_name).toBe('Wema Bank');
      expect(result.account_name).toBe('MERCHANT/JOHN DOE');

      // Verify wema-bank was used (second fetch call)
      const dvaCall = mockFetch.mock.calls[1];
      const dvaBody = JSON.parse(dvaCall[1].body);
      expect(dvaBody.preferred_bank).toBe('wema-bank');
      expect(dvaBody.subaccount).toBe('ACCT_TESTMOCK1234567');
    });

    it('uses assignment.bank_name when bank.name is missing', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
      vi.resetModules();
      const { createDedicatedVirtualAccount } = await import('./paystack');

      mockFetch
        .mockResolvedValueOnce(
          mockResponse(200, {
            status: true,
            data: { customer_code: 'CUS_alt' },
          })
        )
        .mockResolvedValueOnce(
          mockResponse(200, {
            status: true,
            data: {
              account_number: '5555555555',
              account_name: 'ALT/CUSTOMER',
              assignment: { bank_name: 'Titan Trust' },
              currency: 'NGN',
            },
          })
        );

      const result = await createDedicatedVirtualAccount(
        {
          email: 'alt@test.com',
          first_name: 'Alt',
          last_name: 'Customer',
          phone: '',
        },
        { subaccount: 'ACCT_TESTMOCK1234567' }
      );

      expect(result.bank_name).toBe('Titan Trust');
    });

    it('fails closed when the merchant Paystack subaccount is invalid', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
      vi.resetModules();
      const { createDedicatedVirtualAccount } = await import('./paystack');

      await expect(
        createDedicatedVirtualAccount(
          {
            email: 'john@test.com',
            first_name: 'John',
            last_name: 'Doe',
            phone: '+2348012345678',
          },
          { subaccount: '' }
        )
      ).rejects.toThrow('Paystack subaccount is not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreatePaystackCustomer', () => {
    it('fetches existing customer when create returns duplicate', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
      vi.resetModules();
      const { getOrCreatePaystackCustomer } = await import('./paystack');

      mockFetch
        // Create returns non-ok but parseable (duplicate scenario via 200 with status: false)
        .mockResolvedValueOnce(
          mockResponse(200, {
            status: false,
            message: 'Duplicate entry for email',
          })
        )
        // Fetch by email succeeds
        .mockResolvedValueOnce(
          mockResponse(200, {
            status: true,
            data: { customer_code: 'CUS_existing' },
          })
        );

      const code = await getOrCreatePaystackCustomer({
        email: 'existing@test.com',
        first_name: 'Test',
        last_name: 'User',
        phone: '',
      });

      expect(code).toBe('CUS_existing');
    });

    it('rejects invalid email formats', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
      vi.resetModules();
      const { getOrCreatePaystackCustomer } = await import('./paystack');

      await expect(
        getOrCreatePaystackCustomer({
          email: 'not-an-email',
          first_name: 'Bad',
          last_name: 'Email',
          phone: '',
        })
      ).rejects.toThrow('Invalid email format');
    });

    it('rejects emails with path traversal characters', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
      vi.resetModules();
      const { getOrCreatePaystackCustomer } = await import('./paystack');

      await expect(
        getOrCreatePaystackCustomer({
          email: 'user/../admin@test.com',
          first_name: 'Bad',
          last_name: 'Path',
          phone: '',
        })
      ).rejects.toThrow('Email contains invalid characters');
    });
  });

  describe('createPaystackBankTransferCharge', () => {
    const validInput = {
      email: 'ada@example.com',
      amountKobo: 38500000,
      reference: 'ref_bt_123',
      subaccount: 'ACCT_TESTMOCK1234567',
      transactionChargeKobo: 120000,
      metadata: { order_id: 'ord-1' },
    };

    it('fails closed when PAYSTACK_SECRET_KEY is not set', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', '');
      vi.resetModules();
      const { createPaystackBankTransferCharge } = await import('./paystack');

      await expect(
        createPaystackBankTransferCharge(validInput)
      ).rejects.toThrow('PAYSTACK_SECRET_KEY is not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fails closed when subaccount code is invalid', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
      vi.resetModules();
      const { createPaystackBankTransferCharge } = await import('./paystack');

      await expect(
        createPaystackBankTransferCharge({
          ...validInput,
          subaccount: 'BAD_SUBACCOUNT',
        })
      ).rejects.toThrow('Paystack subaccount is not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('posts the bank_transfer charge payload and returns account details and expiry', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
      vi.resetModules();
      const { createPaystackBankTransferCharge } = await import('./paystack');

      mockFetch.mockResolvedValueOnce(
        mockResponse(200, {
          status: true,
          data: {
            reference: 'ref_bt_123',
            account_number: '9988776655',
            account_name: 'Ogabassey Checkout',
            bank: { name: 'Test Bank' },
            account_expires_at: '2026-11-23T12:00:00Z',
          },
        })
      );

      const result = await createPaystackBankTransferCharge(validInput);
      expect(result).toEqual({
        account_number: '9988776655',
        account_name: 'Ogabassey Checkout',
        bank_name: 'Test Bank',
        account_expires_at: '2026-11-23T12:00:00Z',
        reference: 'ref_bt_123',
      });
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.paystack.co/charge');
      expect(JSON.parse(String(init.body))).toMatchObject({
        email: 'ada@example.com',
        amount: '38500000',
        reference: 'ref_bt_123',
        subaccount: 'ACCT_TESTMOCK1234567',
        transaction_charge: 120000,
        bearer: 'account',
        bank_transfer: { account_expires_at: null },
        metadata: { order_id: 'ord-1' },
      });
    });

    it('throws when provider rejects or omits required bank account fields', async () => {
      vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
      vi.resetModules();
      const { createPaystackBankTransferCharge } = await import('./paystack');

      mockFetch.mockResolvedValueOnce(
        mockResponse(200, {
          status: false,
          message: 'Charge rejected',
        })
      );
      await expect(
        createPaystackBankTransferCharge(validInput)
      ).rejects.toThrow('Failed to initialize Paystack bank transfer');

      mockFetch.mockResolvedValueOnce(
        mockResponse(200, {
          status: true,
          data: { reference: 'ref_bt_123', account_number: '' },
        })
      );
      await expect(
        createPaystackBankTransferCharge(validInput)
      ).rejects.toThrow('Failed to initialize Paystack bank transfer');
    });
  });
});
