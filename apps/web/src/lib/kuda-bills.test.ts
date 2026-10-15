import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Biller, PurchaseResult } from './kuda';
import { getBillersByCategory, purchaseBill } from './kuda-bills';
import { KudaApiHttpError } from './kuda-transport-error';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

// Mock the kuda module — keep the pure helpers (vend-status / pin extraction
// / message builder) real, only stub the network and ID-generation entry
// points used by the bill purchase flow.
vi.mock('./kuda', async () => {
  const actual = await vi.importActual<typeof import('./kuda')>('./kuda');
  return {
    ...actual,
    generateRequestRef: vi.fn(() => 'BACI-1234567890-abcd1234'),
    getBillersByType: vi.fn(),
    kudaRequest: vi.fn(),
    verifyBillCustomer: vi.fn(),
  };
});

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
}));

// Import mocked functions after vi.mock
import {
  generateRequestRef,
  getBillersByType,
  KudaServiceType,
  kudaRequest,
} from './kuda';

describe('getBillersByCategory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps "airtime" to Kuda "Airtime" category', async () => {
    // Arrange
    const mockBillers: Biller[] = [
      {
        billerId: '1',
        billerName: 'MTN Airtime',
        billerType: 'Airtime',
        categoryId: 'airtime',
        categoryName: 'Airtime',
      },
    ];
    vi.mocked(getBillersByType).mockResolvedValue(mockBillers);

    // Act
    const result = await getBillersByCategory('airtime');

    // Assert
    expect(getBillersByType).toHaveBeenCalledWith('Airtime');
    expect(result).toEqual(mockBillers);
  });

  it('maps "data" to Kuda "Internet Data" category', async () => {
    // Arrange
    const mockBillers: Biller[] = [
      {
        billerId: '2',
        billerName: 'MTN Data',
        billerType: 'Data',
        categoryId: 'data',
        categoryName: 'Internet Data',
      },
    ];
    vi.mocked(getBillersByType).mockResolvedValue(mockBillers);

    // Act — uses the API string 'data', NOT BillType.DATA ('internet_data')
    const result = await getBillersByCategory('data');

    // Assert
    expect(getBillersByType).toHaveBeenCalledWith('Internet Data');
    expect(result).toEqual(mockBillers);
  });

  it('maps "electricity" to Kuda "Electricity" category and adds Kuda bill item codes', async () => {
    // Arrange
    const mockBillers: Biller[] = [
      {
        billerId: '3',
        billerName: 'EKEDC',
        billerType: 'Electricity',
        categoryId: 'electricity',
        categoryName: 'Electricity',
      },
    ];
    vi.mocked(getBillersByType).mockResolvedValue(mockBillers);

    // Act
    const result = await getBillersByCategory('electricity');

    // Assert
    expect(getBillersByType).toHaveBeenCalledWith('Electricity');
    expect(result).toEqual([
      {
        ...mockBillers[0],
        billItems: [
          expect.objectContaining({
            itemCode: 'KUD-ELE-EKED-002',
            itemName: 'EKEDC PREPAID',
          }),
          expect.objectContaining({
            itemCode: 'KUD-ELE-EKED-001',
            itemName: 'EKEDC POSTPAID',
          }),
        ],
      },
    ]);
  });

  it('maps "cable_tv" to Kuda "CableTv" category', async () => {
    // Arrange
    const mockBillers: Biller[] = [
      {
        billerId: '4',
        billerName: 'DSTV',
        billerType: 'CableTv',
        categoryId: 'cable_tv',
        categoryName: 'CableTv',
      },
    ];
    vi.mocked(getBillersByType).mockResolvedValue(mockBillers);

    // Act
    const result = await getBillersByCategory('cable_tv');

    // Assert
    expect(getBillersByType).toHaveBeenCalledWith('CableTv');
    expect(result).toEqual(mockBillers);
  });

  it('maps "betting" to Kuda "Betting" category', async () => {
    // Arrange
    const mockBillers: Biller[] = [
      {
        billerId: '5',
        billerName: 'Bet9ja',
        billerType: 'Betting',
        categoryId: 'betting',
        categoryName: 'Betting',
      },
    ];
    vi.mocked(getBillersByType).mockResolvedValue(mockBillers);

    // Act
    const result = await getBillersByCategory('betting');

    // Assert
    expect(getBillersByType).toHaveBeenCalledWith('Betting');
    expect(result).toEqual(mockBillers);
  });

  it('throws error for unknown category', async () => {
    // Arrange
    const unknownCategory = 'invalid_category';

    // Act & Assert
    await expect(getBillersByCategory(unknownCategory)).rejects.toThrow(
      'Unknown bill category: invalid_category'
    );
    expect(getBillersByType).not.toHaveBeenCalled();
  });

  it('throws error for empty string category', async () => {
    // Act & Assert
    await expect(getBillersByCategory('')).rejects.toThrow(
      'Unknown bill category: '
    );
    expect(getBillersByType).not.toHaveBeenCalled();
  });
});

describe('purchaseBill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateRequestRef).mockReturnValue('BACI-1234567890-abcd1234');
  });

  it('returns pending when Kuda accepts a bill purchase without a vend status or token', async () => {
    // Arrange — Kuda's envelope only means the request was accepted; without
    // an inner vend status or token, the biller has not confirmed success.
    const mockResponse = {
      status: true,
      message: 'Request successful',
      data: {
        reference: 'AMZMqDjSafTsobg',
        pin: null,
      },
    };
    vi.mocked(kudaRequest).mockResolvedValue(mockResponse);

    // Act
    const result = await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);

    // Assert
    expect(generateRequestRef).toHaveBeenCalled();
    expect(kudaRequest).toHaveBeenCalledWith(
      KudaServiceType.ADMIN_PURCHASE_BILL,
      {
        CustomerFirstName: 'Customer',
        CustomerIdentifier: '1234567890',
        PhoneNumber: '1234567890',
        BillItemIdentifier: 'EKEDC-PREPAID',
        Amount: '500000', // 5000 Naira = 500000 Kobo
        trackingReference: 'BACI-1234567890-abcd1234',
      },
      'BACI-1234567890-abcd1234'
    );

    expect(result).toEqual<PurchaseResult>({
      success: false,
      reference: 'BACI-1234567890-abcd1234',
      transactionId: 'AMZMqDjSafTsobg',
      message: 'Request successful',
      status: 'pending',
      amount: 5000,
    });
  });

  it('resolves transport throws as pending but 4xx rejections as failed', async () => {
    // Codex R102 P1: a timeout/drop after Kuda accepts still lands
    // the vend (pending + BILL_TSQ requery); only a definitive 4xx
    // rejection fails outright.
    vi.mocked(kudaRequest).mockRejectedValueOnce(
      new Error('Kuda ADMIN_PURCHASE_BILL request timed out')
    );
    const timedOut = await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);
    expect(timedOut).toMatchObject({ success: false, status: 'pending' });

    vi.mocked(kudaRequest).mockRejectedValueOnce(new TypeError('fetch failed'));
    const dropped = await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);
    expect(dropped).toMatchObject({ success: false, status: 'pending' });

    vi.mocked(kudaRequest).mockRejectedValueOnce(
      new KudaApiHttpError(503, 'Service Unavailable')
    );
    const unavailable = await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);
    expect(unavailable).toMatchObject({ success: false, status: 'pending' });

    vi.mocked(kudaRequest).mockRejectedValueOnce(
      new KudaApiHttpError(400, 'Bad Request')
    );
    const rejected = await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);
    expect(rejected).toMatchObject({ success: false, status: 'failed' });
  });

  it('logs accepted pending bill purchases below warning level', async () => {
    // Arrange
    vi.mocked(kudaRequest).mockResolvedValue({
      status: true,
      message: 'Request successful',
      data: {
        billerAggregatorStatus: 'k11',
        reference: 'AMZMqDjSafTsobg',
      },
    });

    // Act
    await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);

    // Assert
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    expect(loggerMocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Kuda bill purchase did not complete',
        envelopeStatus: true,
        hasPin: false,
        hasTransactionId: true,
        vendOutcome: 'pending',
        billerAggregatorStatus: 'k11',
      })
    );
  });

  it('uses the first meaningful pin and transaction reference after normalizing response casing variants', async () => {
    // Arrange
    const mockResponse = {
      status: true,
      message: 'Bill purchase successful',
      data: {
        reference: '   ',
        Reference: 'TXN-UPPER-123',
        pin: '   ',
        Pin: '1234-5678-9012',
      },
    };
    vi.mocked(kudaRequest).mockResolvedValue(mockResponse);

    // Act
    const result = await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);

    // Assert
    expect(result).toMatchObject<Partial<PurchaseResult>>({
      pin: '1234-5678-9012',
      transactionId: 'TXN-UPPER-123',
    });
  });

  it('extracts EKEDC meter tokens from nested purchase pin objects', async () => {
    // Arrange
    vi.mocked(kudaRequest).mockResolvedValue({
      status: true,
      message: 'Bill purchase successful',
      data: {
        reference: 'TXN-EKEDC-123',
        Pin: {
          Number: ' 0283-6213-2450-8322-0153 ',
          Units: '29.4',
        },
      },
    });

    // Act
    const result = await purchaseBill('KUD-ELE-EKED-002', '43901766923', 5000);

    // Assert
    expect(result).toMatchObject<Partial<PurchaseResult>>({
      pin: '0283-6213-2450-8322-0153',
      transactionId: 'TXN-EKEDC-123',
    });
  });

  it('prefers lowercase response fields when both casing variants are populated', async () => {
    // Arrange
    vi.mocked(kudaRequest).mockResolvedValue({
      status: true,
      message: 'Bill purchase successful',
      data: {
        reference: 'TXN-LOWER-123',
        Reference: 'TXN-UPPER-123',
        pin: 'LOWER-PIN-123',
        Pin: 'UPPER-PIN-123',
      },
    });

    // Act
    const result = await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);

    // Assert
    expect(result).toMatchObject<Partial<PurchaseResult>>({
      pin: 'LOWER-PIN-123',
      transactionId: 'TXN-LOWER-123',
    });
  });

  it('uses lowercase response fields when upper-case variants are absent', async () => {
    // Arrange
    vi.mocked(kudaRequest).mockResolvedValue({
      status: true,
      message: 'Bill purchase successful',
      data: {
        reference: 'TXN-LOWER-ONLY',
        Reference: null,
        pin: 'LOWER-PIN-ONLY',
        Pin: null,
      },
    });

    // Act
    const result = await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);

    // Assert
    expect(result).toMatchObject<Partial<PurchaseResult>>({
      pin: 'LOWER-PIN-ONLY',
      transactionId: 'TXN-LOWER-ONLY',
    });
  });

  it('keeps transactionId unset when Kuda omits provider response references', async () => {
    // Arrange
    vi.mocked(kudaRequest).mockResolvedValue({
      status: true,
      message: 'Bill purchase successful',
      data: {
        reference: '   ',
        Reference: null,
        pin: '   ',
        Pin: null,
      },
    });

    // Act
    const result = await purchaseBill('EKEDC-PREPAID', '1234567890', 5000);

    // Assert
    expect(result.transactionId).toBeUndefined();
    expect(result.pin).toBeUndefined();
    expect(result.success).toBe(false);
    expect(result.status).toBe('pending');
  });

  it('returns failed result when Kuda API returns status false', async () => {
    // Arrange
    const mockResponse = {
      status: false,
      message: 'Insufficient balance',
      data: undefined,
    };
    vi.mocked(kudaRequest).mockResolvedValue(mockResponse);

    // Act
    const result = await purchaseBill('DSTV-COMPACT', '9876543210', 3500);

    // Assert
    expect(result).toEqual<PurchaseResult>({
      success: false,
      reference: 'BACI-1234567890-abcd1234',
      message: 'Insufficient balance',
      status: 'failed',
      amount: 3500,
    });
  });

  it('catches and returns pending result when kudaRequest throws an error', async () => {
    // Arrange — Codex R102 P1: the drop may follow Kuda's
    // acceptance, so transport throws resolve pending for BILL_TSQ
    // reconciliation instead of failing + refunding on value.
    vi.mocked(kudaRequest).mockRejectedValue(
      new Error('Network connection failed')
    );

    // Act
    const result = await purchaseBill('BET9JA', '1122334455', 1000);

    // Assert
    expect(result).toEqual<PurchaseResult>({
      success: false,
      reference: 'BACI-1234567890-abcd1234',
      message: 'Network connection failed',
      status: 'pending',
      amount: 1000,
    });
  });

  it('handles non-Error thrown objects gracefully', async () => {
    // Arrange — unknown outcome fails closed to pending (R102 P1).
    vi.mocked(kudaRequest).mockRejectedValue('Unknown error string');

    // Act
    const result = await purchaseBill('EKEDC-POSTPAID', '5555555555', 2000);

    // Assert
    expect(result).toEqual<PurchaseResult>({
      success: false,
      reference: 'BACI-1234567890-abcd1234',
      message: 'Bill purchase failed',
      status: 'pending',
      amount: 2000,
    });
  });

  it('passes amount as string to Kuda API', async () => {
    // Arrange
    const mockResponse = {
      status: true,
      message: 'Success',
      data: { reference: 'TXN-789', pin: null },
    };
    vi.mocked(kudaRequest).mockResolvedValue(mockResponse);

    // Act
    await purchaseBill('GOTV-PLUS', '1111111111', 150000);

    // Assert
    expect(kudaRequest).toHaveBeenCalledWith(
      KudaServiceType.ADMIN_PURCHASE_BILL,
      expect.objectContaining({
        Amount: '15000000', // 150000 Naira = 15000000 Kobo
      }),
      expect.any(String)
    );
  });

  it('includes generated reference in request', async () => {
    // Arrange
    const customRef = 'BACI-9999999999-xyz789';
    vi.mocked(generateRequestRef).mockReturnValue(customRef);
    const mockResponse = {
      status: true,
      message: 'Success',
      data: { reference: 'TXN-999', pin: null },
    };
    vi.mocked(kudaRequest).mockResolvedValue(mockResponse);

    // Act
    const result = await purchaseBill('STARTIMES', '7777777777', 4500);

    // Assert
    expect(kudaRequest).toHaveBeenCalledWith(
      KudaServiceType.ADMIN_PURCHASE_BILL,
      expect.any(Object),
      customRef
    );
    expect(result.reference).toBe(customRef);
  });

  it('falls back to customerIdentification for PhoneNumber when no customerPhone is supplied', async () => {
    // Arrange — legacy callers that don't yet thread phone through
    const mockResponse = {
      status: true,
      message: 'Success',
      data: {
        reference: 'TXN-555',
        finalStatus: 'Successful',
        transactionStatus: 3,
        pin: null,
      },
    };
    vi.mocked(kudaRequest).mockResolvedValue(mockResponse);
    const customerIdentification = '08012345678';

    // Act
    await purchaseBill('IKEJA-ELECTRIC', customerIdentification, 10000);

    // Assert
    expect(kudaRequest).toHaveBeenCalledWith(
      KudaServiceType.ADMIN_PURCHASE_BILL,
      {
        CustomerFirstName: 'Customer',
        CustomerIdentifier: customerIdentification,
        PhoneNumber: customerIdentification,
        BillItemIdentifier: 'IKEJA-ELECTRIC',
        Amount: '1000000', // 10000 Naira = 1000000 Kobo
        trackingReference: expect.any(String),
      },
      expect.any(String)
    );
  });

  it('sends the supplied customerPhone in PhoneNumber while keeping the meter as CustomerIdentifier', async () => {
    // Regression: PR #1457 dropped the customerPhone parameter and started
    // sending the meter number as PhoneNumber. EKEDC SMS token delivery
    // cannot reach a non-phone-shaped value. PhoneNumber must be the
    // customer's real phone when it's supplied.
    const mockResponse = {
      status: true,
      message: 'Success',
      data: {
        reference: 'TXN-9001',
        finalStatus: 'Successful',
        transactionStatus: 3,
        pin: { number: '3373-7728-6877-1154-6184' },
      },
    };
    vi.mocked(kudaRequest).mockResolvedValue(mockResponse);
    const meterNumber = '43901766923';
    const customerPhone = '08146978921';
    const fixedRef = 'BACI-FIXED-REF-001';

    const result = await purchaseBill(
      'KUD-ELE-EKED-002',
      meterNumber,
      1000,
      'OLADIMEJI',
      fixedRef,
      customerPhone
    );

    expect(kudaRequest).toHaveBeenCalledWith(
      KudaServiceType.ADMIN_PURCHASE_BILL,
      {
        CustomerFirstName: 'OLADIMEJI',
        CustomerIdentifier: meterNumber,
        PhoneNumber: customerPhone,
        BillItemIdentifier: 'KUD-ELE-EKED-002',
        Amount: '100000', // 1000 Naira = 100000 Kobo
        trackingReference: fixedRef,
      },
      fixedRef
    );
    expect(result.reference).toBe(fixedRef);
    expect(result.success).toBe(true);
    expect(result.pin).toBe('3373-7728-6877-1154-6184');
    expect(generateRequestRef).not.toHaveBeenCalled();
  });

  it('uses generateRequestRef when no requestRef is supplied', async () => {
    const mockResponse = {
      status: true,
      message: 'Success',
      data: {
        reference: 'TXN-9002',
        finalStatus: 'Successful',
        transactionStatus: 3,
      },
    };
    vi.mocked(kudaRequest).mockResolvedValue(mockResponse);

    const result = await purchaseBill(
      'KUD-ELE-EKED-002',
      '43901766923',
      500,
      'Customer',
      undefined,
      '08146978921'
    );

    expect(generateRequestRef).toHaveBeenCalledTimes(1);
    expect(result.reference).toBe('BACI-1234567890-abcd1234');
    expect(kudaRequest).toHaveBeenCalledWith(
      KudaServiceType.ADMIN_PURCHASE_BILL,
      expect.objectContaining({
        trackingReference: 'BACI-1234567890-abcd1234',
        PhoneNumber: '08146978921',
        CustomerIdentifier: '43901766923',
      }),
      'BACI-1234567890-abcd1234'
    );
  });

  it('preserves amount in result regardless of success', async () => {
    // Arrange - success case
    const successResponse = {
      status: true,
      message: 'Success',
      data: { reference: 'TXN-111', pin: null },
    };
    vi.mocked(kudaRequest).mockResolvedValue(successResponse);

    // Act
    const successResult = await purchaseBill('BILL-1', 'CUST-1', 7500);

    // Assert
    expect(successResult.amount).toBe(7500);

    // Arrange - failure case
    vi.mocked(kudaRequest).mockRejectedValue(new Error('Failed'));

    // Act
    const failureResult = await purchaseBill('BILL-2', 'CUST-2', 8500);

    // Assert
    expect(failureResult.amount).toBe(8500);
  });
});
