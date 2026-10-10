import { jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { HttpError } from '@/lib/fetch-with-timeout';
import { promptUtilityWalletFunding } from '@/lib/utility-wallet-funding-prompt';
import { createBillFormPurchaseHandler } from './create-bill-form-purchase-handler';

type PaymentState = ReturnType<typeof useUtilityPayment>;
type PurchaseHandlerOptions = Parameters<
  typeof createBillFormPurchaseHandler
>[0];
type PurchaseHandlerOverrides = Omit<
  Partial<PurchaseHandlerOptions>,
  'payment'
> & {
  payment?: Partial<PurchaseHandlerOptions['payment']>;
};

const mockChargeWalletForVtu =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@/lib/vtu-checkout', () => {
  const actual =
    jest.requireActual<typeof import('@/lib/vtu-checkout')>(
      '@/lib/vtu-checkout'
    );
  return {
    ...actual,
    chargeWalletForVtu: (...args: unknown[]) => mockChargeWalletForVtu(...args),
  };
});

jest.mock('@/lib/utility-wallet-funding-prompt', () => ({
  promptUtilityWalletFunding: jest.fn(),
}));

const mockPromptUtilityWalletFunding =
  promptUtilityWalletFunding as unknown as jest.Mock;

function createPaymentState(
  overrides: Partial<PaymentState> = {}
): PaymentState {
  return {
    canFundByBankTransfer: false,
    walletBalance: 5000,
    walletError: null,
    walletIsLoading: false,
    getWalletIdempotencyKey: jest.fn(() => 'test-key'),
    resetWalletIdempotencyKey: jest.fn(),
    ...overrides,
  };
}

function createValidHandler(overrides: PurchaseHandlerOverrides = {}) {
  const defaults: PurchaseHandlerOptions = {
    amount: '1000',
    billType: 'electricity',
    canShowPayment: true,
    customer: null,
    customerId: '1234567890',
    dismissKeyboard: jest.fn(),
    getIsSubmitting: () => false,
    numericAmount: 1000,
    onSuccess: jest.fn(),
    payment: createPaymentState(),
    selectedBiller: {
      billerId: 'ekedc',
      billerName: 'EKEDC NG',
      billerType: 'Electricity',
      categoryId: 'electricity',
      categoryName: 'Electricity',
    },
    selectedBillItem: null,
    selectedBillItemIdentifier: 'postpaid',
    selectedBillItemPathLabel: 'Postpaid',
    setIsSubmitting: jest.fn(),
    type: 'power',
    verifiedCustomerName: null,
    verifiedCustomerAddress: null,
  };

  return createBillFormPurchaseHandler({
    ...defaults,
    ...overrides,
    payment: {
      ...defaults.payment,
      ...overrides.payment,
    },
  });
}

describe('createBillFormPurchaseHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockChargeWalletForVtu.mockResolvedValue({
      status: 'successful',
      amount: 1000,
      reference: 'WAL-1',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('charges the full bill from the wallet when the balance covers it', async () => {
    const onSuccess = jest.fn();
    const resetWalletIdempotencyKey = jest.fn();
    const handlePurchase = createValidHandler({
      onSuccess,
      payment: createPaymentState({
        walletBalance: 1500,
        getWalletIdempotencyKey: jest.fn(() => 'idem-key-1'),
        resetWalletIdempotencyKey,
      }),
    });

    await handlePurchase();

    expect(mockChargeWalletForVtu).toHaveBeenCalledTimes(1);
    expect(mockChargeWalletForVtu.mock.calls[0]?.[0]).toMatchObject({
      amount: 1000,
      type: 'electricity',
      walletAmount: 1000,
      idempotencyKey: 'idem-key-1',
    });
    expect(resetWalletIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'successful', reference: 'WAL-1' })
    );
  });

  it('prompts wallet funding instead of charging when the balance is short', async () => {
    const handlePurchase = createValidHandler({
      payment: createPaymentState({ walletBalance: 200 }),
      returnToHref: '/utilities/power?repeatAmount=1000' as never,
    });

    await handlePurchase();

    expect(mockChargeWalletForVtu).not.toHaveBeenCalled();
    expect(mockPromptUtilityWalletFunding).toHaveBeenCalledWith({
      amount: 1000,
      balance: 200,
      returnToHref: '/utilities/power?repeatAmount=1000',
    });
  });

  it('uses a generic checkout error message for unsafe exceptions', async () => {
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new Error('Gateway failed\nToken: secret')
    );
    const handlePurchase = createValidHandler();

    await handlePurchase();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Payment Failed',
      'Payment failed. Please try again.'
    );
  });

  it('shows user-facing payment failure messages returned by the server', async () => {
    mockChargeWalletForVtu.mockRejectedValueOnce(
      new HttpError(400, 'Insufficient funds')
    );
    const handlePurchase = createValidHandler();

    await handlePurchase();

    expect(Alert.alert).toHaveBeenCalledWith(
      'Payment Failed',
      'Insufficient funds'
    );
  });

  it('prefers the verified meter/account holder as customerName (bill customer-of-record)', async () => {
    const handlePurchase = createValidHandler({
      customer: {
        first_name: 'Bassey',
        last_name: 'John',
        email: 'bassey@example.com',
      },
      verifiedCustomerName: 'JANE METER-OWNER',
    });

    await handlePurchase();

    expect(mockChargeWalletForVtu).toHaveBeenCalledTimes(1);
    // customerName is the bill customer-of-record persisted on the transaction,
    // so the verified meter/account holder wins over the buyer's profile name.
    expect(mockChargeWalletForVtu.mock.calls[0][0]).toMatchObject({
      customerName: 'JANE METER-OWNER',
    });
  });

  it('falls back to the verified meter-owner name when the buyer has no name', async () => {
    const handlePurchase = createValidHandler({
      customer: {
        first_name: null,
        last_name: null,
        email: 'bassey@example.com',
      },
      verifiedCustomerName: 'JANE METER-OWNER',
    });

    await handlePurchase();

    expect(mockChargeWalletForVtu.mock.calls[0][0]).toMatchObject({
      customerName: 'JANE METER-OWNER',
    });
  });

  it('forwards the verified meter address as customerAddress when present', async () => {
    const onSuccess = jest.fn();
    const handlePurchase = createValidHandler({
      onSuccess,
      verifiedCustomerName: 'JANE METER-OWNER',
      verifiedCustomerAddress: '12 Marina Road, Lagos',
    });

    await handlePurchase();

    // Sent to the API…
    expect(mockChargeWalletForVtu.mock.calls[0]?.[0]).toMatchObject({
      customerAddress: '12 Marina Road, Lagos',
    });
    // …and attached to the success result for the immediate in-app receipt.
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ address: '12 Marina Road, Lagos' })
    );
  });

  it('omits customerAddress when no verified address is available', async () => {
    const handlePurchase = createValidHandler({
      verifiedCustomerName: 'JANE METER-OWNER',
      verifiedCustomerAddress: null,
    });

    await handlePurchase();

    expect(mockChargeWalletForVtu.mock.calls[0][0]).not.toHaveProperty(
      'customerAddress'
    );
  });

  it('passes Monnify provider metadata through wallet checkout', async () => {
    const handlePurchase = createValidHandler({
      selectedBiller: {
        billerId: 'MTN',
        billerName: 'MTN',
        billerType: 'airtime',
        categoryId: 'AIRTIME',
        categoryName: 'airtime',
        provider: 'monnify',
        billerCode: 'MTN',
      },
      selectedBillItem: {
        amount: 100,
        billerCode: 'MTN',
        isAmountFixed: false,
        itemCode: '13',
        itemCurrencySymbol: 'NGN',
        itemFee: 0,
        itemName: 'MTN Mobile Top up',
        productCode: '13',
        provider: 'monnify',
      },
      selectedBillItemIdentifier: '13',
      selectedBillItemPathLabel: 'MTN Mobile Top up',
    });

    await handlePurchase();

    expect(mockChargeWalletForVtu).toHaveBeenCalledWith(
      expect.objectContaining({
        billerCode: 'MTN',
        productCode: '13',
        provider: 'monnify',
      })
    );
  });

  it('routes folded Kuda electricity display items through Monnify checkout codes', async () => {
    const handlePurchase = createValidHandler({
      selectedBiller: {
        billerId: 'IKEDC_KUDA',
        billerName: 'Ikeja Electric',
        billerType: 'Electricity',
        categoryId: 'electricity',
        categoryName: 'Electricity',
        provider: 'kuda',
      },
      selectedBillItem: {
        amount: 0,
        isAmountFixed: false,
        itemCode: 'KUD-ELE-IKEDC-PREPAID',
        itemCurrencySymbol: 'NGN',
        itemFee: 0,
        itemName: 'Prepaid meter',
        monnifyBillerCode: 'IKEDC',
        monnifyProductCode: 'IKEDC_PREPAID',
        provider: 'kuda',
      },
      selectedBillItemIdentifier: 'KUD-ELE-IKEDC-PREPAID',
      selectedBillItemPathLabel: 'Prepaid meter',
      validationReference: 'VAL-FOLDED-123',
      requireValidationRef: true,
    });

    await handlePurchase();

    expect(mockChargeWalletForVtu).toHaveBeenCalledWith(
      expect.objectContaining({
        billItemIdentifier: 'KUD-ELE-IKEDC-PREPAID',
        billerCode: 'IKEDC',
        billerName: 'Ikeja Electric - Prepaid meter',
        productCode: 'IKEDC_PREPAID',
        provider: 'monnify',
        requireValidationRef: true,
        validationReference: 'VAL-FOLDED-123',
      })
    );
  });

  describe('wallet flow', () => {
    it('keeps the idempotency key on a 5xx server error (server may have persisted state)', async () => {
      // Critical: rotating the key here would let the user's retry
      // bypass the route's dedupe table and create a duplicate
      // wallet debit. The same key MUST hit the existing
      // vtu_idempotency_keys row on retry.
      mockChargeWalletForVtu.mockRejectedValueOnce(
        new HttpError(500, 'Internal Server Error')
      );
      const resetWalletIdempotencyKey = jest.fn();
      const handlePurchase = createValidHandler({
        amount: '1000',
        numericAmount: 1000,
        payment: createPaymentState({
          walletBalance: 1000,
          getWalletIdempotencyKey: jest.fn(() => 'idem-key-2'),
          resetWalletIdempotencyKey,
        }),
      });

      await handlePurchase();

      expect(mockChargeWalletForVtu).toHaveBeenCalledTimes(1);
      expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
    });

    it('keeps the idempotency key when the server returns status="processing" (vend still in flight)', async () => {
      // 'processing' is non-terminal — the wallet was debited and the
      // vend was queued, but the biller hasn't confirmed yet. Rotating
      // the key now would let a user-initiated retry bypass the
      // dedupe row and create a SECOND VTU transaction while the
      // first one is still in flight.
      mockChargeWalletForVtu.mockResolvedValueOnce({
        status: 'processing',
        amount: 1000,
        reference: 'WAL-PROC-1',
      });
      const onSuccess = jest.fn();
      const resetWalletIdempotencyKey = jest.fn();
      const handlePurchase = createValidHandler({
        amount: '1000',
        numericAmount: 1000,
        onSuccess,
        payment: createPaymentState({
          walletBalance: 1000,
          getWalletIdempotencyKey: jest.fn(() => 'idem-key-proc'),
          resetWalletIdempotencyKey,
        }),
      });

      await handlePurchase();

      expect(mockChargeWalletForVtu).toHaveBeenCalledTimes(1);
      // Key MUST stay so the next retry hits vtu_idempotency_keys.
      expect(resetWalletIdempotencyKey).not.toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing' })
      );
    });

    it('rotates the idempotency key on a 4xx response (request rejected before any state)', async () => {
      // 4xx means the server validated and rejected the request
      // before any side effects. A retry with the same key would
      // just keep failing — fresh key lets the user correct and
      // resubmit cleanly.
      mockChargeWalletForVtu.mockRejectedValueOnce(
        new HttpError(400, 'Bad Request')
      );
      const resetWalletIdempotencyKey = jest.fn();
      const handlePurchase = createValidHandler({
        amount: '1000',
        numericAmount: 1000,
        payment: createPaymentState({
          walletBalance: 1000,
          getWalletIdempotencyKey: jest.fn(() => 'idem-key-3'),
          resetWalletIdempotencyKey,
        }),
      });

      await handlePurchase();

      expect(mockChargeWalletForVtu).toHaveBeenCalledTimes(1);
      expect(resetWalletIdempotencyKey).toHaveBeenCalledTimes(1);
    });
  });
});
