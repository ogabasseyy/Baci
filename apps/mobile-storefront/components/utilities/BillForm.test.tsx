import { jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { Biller, BillItem } from '@/hooks/use-vtu-billers';
import { BillForm } from './BillForm';

const mockVerifyMutate = jest.fn();
const mockVerifyReset = jest.fn();
const mockUseUtilityPayment = jest.fn();
const mockChargeWalletForVtu =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();

function mockBillItem(overrides: Partial<BillItem>): BillItem {
  return {
    amount: 0,
    isAmountFixed: false,
    itemCode: 'item',
    itemCurrencySymbol: 'NGN',
    itemFee: 0,
    itemName: 'Item',
    ...overrides,
  };
}

function mockBiller(overrides: Partial<Biller>): Biller {
  return {
    billerId: 'biller',
    billerName: 'Biller',
    billerType: 'Utility',
    categoryId: 'utility',
    categoryName: 'Utility',
    billItems: [],
    ...overrides,
  };
}

function mockPowerBillers(): Biller[] {
  return [
    mockBiller({
      billerId: 'ekedc',
      billerName: 'EKEDC NG',
      billerType: 'Electricity',
      categoryId: 'electricity',
      categoryName: 'Electricity',
      billItems: [
        mockBillItem({
          itemCode: 'prepaid',
          itemName: 'Prepaid',
          billItems: [
            mockBillItem({
              itemCode: 'residential',
              itemName: 'Residential',
            }),
            mockBillItem({
              itemCode: 'commercial',
              itemName: 'Commercial',
            }),
          ],
        }),
        mockBillItem({
          itemCode: 'postpaid',
          itemName: 'Postpaid',
        }),
      ],
    }),
  ];
}

let mockBillers = mockPowerBillers();

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: jest.fn(() => 'light'),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: () => ({
    dismissKeyboard: jest.fn(),
    isKeyboardVisible: false,
    keyboardHeight: 0,
  }),
}));

jest.mock('@/hooks/use-utility-payment', () => ({
  useUtilityPayment: () => mockUseUtilityPayment(),
}));

jest.mock('./UtilityPaymentOptions', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    UtilityPaymentOptions: () => <Text>Payment options</Text>,
  };
});

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

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { customer: null }) => unknown) =>
    selector({ customer: null }),
}));

jest.mock('@/hooks/use-vtu-verify', () => ({
  useVTUVerify: () => ({
    mutate: (...args: unknown[]) => mockVerifyMutate(...args),
    reset: () => mockVerifyReset(),
    isPending: false,
    data: undefined,
    error: null,
  }),
}));

jest.mock('@/hooks/use-vtu-billers', () => ({
  useVTUBillers: () => ({
    data: mockBillers,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

describe('BillForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBillers = mockPowerBillers();
    mockUseUtilityPayment.mockReturnValue({
      canFundByBankTransfer: false,
      walletBalance: 5000,
      walletError: null,
      walletIsLoading: false,
      getWalletIdempotencyKey: jest.fn(() => 'test-key'),
      resetWalletIdempotencyKey: jest.fn(),
    });
    mockChargeWalletForVtu.mockResolvedValue({
      amount: 2500,
      reference: 'VTU-BILL-123',
      status: 'successful',
    });
  });

  it('waits for the full bill-item path before showing the identifier input', () => {
    render(<BillForm type="power" onSuccess={jest.fn()} />);

    fireEvent.press(screen.getByText('EKEDC NG'));
    expect(screen.queryByPlaceholderText('Enter meter number')).toBeNull();

    fireEvent.press(screen.getByText('Prepaid'));
    expect(screen.queryByPlaceholderText('Enter meter number')).toBeNull();

    fireEvent.press(screen.getByText('Residential'));
    expect(screen.getByPlaceholderText('Enter meter number')).toBeTruthy();
  });

  it('verifies against the selected leaf bill item', () => {
    render(<BillForm type="power" onSuccess={jest.fn()} />);

    fireEvent.press(screen.getByText('EKEDC NG'));
    fireEvent.press(screen.getByText('Prepaid'));
    fireEvent.press(screen.getByText('Commercial'));
    fireEvent.changeText(
      screen.getByPlaceholderText('Enter meter number'),
      '1234567890'
    );
    fireEvent.press(screen.getByText('Verify'));

    expect(mockVerifyMutate).toHaveBeenCalledWith(
      {
        billItemIdentifier: 'commercial',
        billerCode: undefined,
        customerIdentifier: '1234567890',
        productCode: undefined,
        provider: 'kuda',
      },
      { onSuccess: expect.any(Function) }
    );
  });

  it('starts a verified repeat at the payment section for previous bill details', () => {
    render(
      <BillForm
        type="power"
        initialAmount="2500"
        initialBillerName="EKEDC NG"
        initialBillItemIdentifier="commercial"
        initialCustomerIdentifier="1234567890"
        isRepeatPaymentReady
        onSuccess={jest.fn()}
      />
    );

    expect(screen.getByText('Amount (₦)')).toBeOnTheScreen();
    expect(screen.getByText('Payment options')).toBeOnTheScreen();
    expect(mockVerifyMutate).not.toHaveBeenCalled();
  });

  it('infers a repeat bill item from saved biller name when item code is missing', () => {
    render(
      <BillForm
        type="power"
        initialAmount="2500"
        initialBillerName="EKEDC NG - Postpaid"
        initialCustomerIdentifier="1234567890"
        isRepeatPaymentReady
        onSuccess={jest.fn()}
      />
    );

    expect(screen.getByText('Amount (₦)')).toBeOnTheScreen();
    expect(screen.getByText('Payment options')).toBeOnTheScreen();
    expect(mockVerifyMutate).not.toHaveBeenCalled();
  });

  it('matches a saved biller name by exact or token-boundary text before shorter substrings', () => {
    mockBillers = [
      mockBiller({
        billerId: 'generic-tv',
        billerName: 'TV',
        billItems: [],
      }),
      mockBiller({
        billerId: 'dstv',
        billerName: 'DSTV',
        billItems: [
          mockBillItem({
            amount: 0,
            itemCode: 'compact',
            itemName: 'Compact',
          }),
        ],
      }),
    ];

    render(
      <BillForm
        type="tv"
        initialAmount="2500"
        initialBillerName="DSTV Compact"
        initialCustomerIdentifier="1234567890"
        isRepeatPaymentReady
        onSuccess={jest.fn()}
      />
    );

    expect(screen.getByText('DSTV')).toBeOnTheScreen();
    expect(screen.getByText('Compact')).toBeOnTheScreen();
    expect(screen.getByText('Amount (₦)')).toBeOnTheScreen();
  });

  it('prefers a fixed leaf amount over the saved repeat amount', () => {
    mockBillers = [
      mockBiller({
        billerId: 'dstv',
        billerName: 'DSTV',
        billItems: [
          mockBillItem({
            amount: 7000,
            isAmountFixed: true,
            itemCode: 'compact',
            itemName: 'Compact',
          }),
        ],
      }),
    ];

    render(
      <BillForm
        type="tv"
        initialAmount="2500"
        initialBillerName="DSTV"
        initialBillItemIdentifier="compact"
        initialCustomerIdentifier="1234567890"
        isRepeatPaymentReady
        onSuccess={jest.fn()}
      />
    );

    expect(screen.getByDisplayValue('7,000')).toBeOnTheScreen();
  });

  it('carries Monnify validation references from verify into checkout', async () => {
    mockBillers = [
      mockBiller({
        billerCode: 'IKEDC',
        billerId: 'ikedc',
        billerName: 'IKEDC',
        provider: 'monnify',
        billItems: [
          mockBillItem({
            billerCode: 'IKEDC',
            itemCode: 'IKEDC_PREPAID',
            itemName: 'Prepaid',
            productCode: 'IKEDC_PREPAID',
            provider: 'monnify',
          }),
        ],
      }),
    ];

    render(
      <BillForm type="power" initialAmount="2500" onSuccess={jest.fn()} />
    );

    fireEvent.press(screen.getByText('IKEDC'));
    fireEvent.press(screen.getByText('Prepaid'));
    fireEvent.changeText(
      screen.getByPlaceholderText('Enter meter number'),
      '43901766923'
    );
    fireEvent.press(screen.getByText('Verify'));

    const verifyOptions = mockVerifyMutate.mock.calls[0]?.[1] as
      | { onSuccess?: (data: unknown) => void }
      | undefined;
    act(() => {
      verifyOptions?.onSuccess?.({
        verified: true,
        customerName: 'Meter Owner',
        message: 'Customer verified',
        requireValidationRef: true,
        validationReference: 'VAL-123',
      });
    });

    fireEvent.changeText(screen.getByPlaceholderText('Enter amount'), '2500');
    fireEvent.press(screen.getByText('Pay ₦2,500'));

    await waitFor(() => {
      expect(mockChargeWalletForVtu).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 2500,
          billerCode: 'IKEDC',
          customerIdentifier: '43901766923',
          productCode: 'IKEDC_PREPAID',
          provider: 'monnify',
          requireValidationRef: true,
          validationReference: 'VAL-123',
          walletAmount: 2500,
        })
      );
    });
  });

  it('surfaces wallet bill payments that are still processing', async () => {
    const onSuccess = jest.fn();
    mockChargeWalletForVtu.mockResolvedValueOnce({
      amount: 2500,
      reference: 'VTU-BILL-PENDING-123',
      status: 'processing',
    });

    render(
      <BillForm
        type="power"
        initialAmount="2500"
        initialBillerName="EKEDC NG"
        initialBillItemIdentifier="postpaid"
        initialCustomerIdentifier="1234567890"
        isRepeatPaymentReady
        onSuccess={onSuccess}
      />
    );

    fireEvent.press(screen.getByText('Pay ₦2,500'));

    await waitFor(() => {
      expect(mockChargeWalletForVtu).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 2500,
          customerIdentifier: '1234567890',
          type: 'electricity',
          walletAmount: 2500,
        })
      );
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        amount: 2500,
        customerIdentifier: '1234567890',
        reference: 'VTU-BILL-PENDING-123',
        status: 'processing',
      });
    });
  });
});
