import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PurchaseSuccess } from '@/components/utilities/PurchaseSuccess';

const mockSetClipboardString = jest.fn<(text: string) => Promise<boolean>>();
const mockShareUtilityReceipt = jest.fn<(input: unknown) => Promise<void>>();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const FadeIn = {
    delay: jest.fn(() => FadeIn),
    duration: jest.fn(() => FadeIn),
  };

  return {
    __esModule: true,
    default: { View },
    FadeIn,
  };
});

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: (text: string) => mockSetClipboardString(text),
}));

jest.mock('@/hooks/use-receipts', () => ({
  useMerchantReceiptInfo: () => ({
    data: { business_name: 'Ogabassey', logo_url: 'https://cdn.test/logo.png' },
  }),
}));

jest.mock('@/lib/utility-receipt', () => ({
  shareUtilityReceipt: (input: unknown) => mockShareUtilityReceipt(input),
  buildUtilityReceiptHtml: (input: unknown) =>
    `RECEIPT:${JSON.stringify(input)}`,
  buildReceiptMessage: (input: unknown) =>
    `RECEIPT_TEXT:${JSON.stringify(input)}`,
}));

jest.mock('@/components/receipts/ReceiptPreviewModal', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ReceiptPreviewModal: ({
      visible,
      html,
    }: {
      visible: boolean;
      html: string;
    }) => (visible ? <Text testID="receipt-preview">{html}</Text> : null),
  };
});

jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
}));

describe('PurchaseSuccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetClipboardString.mockResolvedValue(true);
    mockShareUtilityReceipt.mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows token-generation guidance when an electricity payment is still processing', () => {
    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        status="processing"
      />
    );

    expect(screen.getByText('Payment Received')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Your electricity payment for 43901766923 was received. We are generating your token now.'
      )
    ).toBeOnTheScreen();
    expect(screen.getByText('Generating your token')).toBeOnTheScreen();
    expect(
      screen.getByText(
        "This usually takes 30-60 seconds. You can leave this screen; we'll notify you when the token is ready."
      )
    ).toBeOnTheScreen();
  });

  it('shows a returned utility voucher token', () => {
    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        voucherPin="1234-5678-9012-3456"
      />
    );

    expect(screen.getByText('Voucher / Token')).toBeOnTheScreen();
    expect(screen.getByText('1234-5678-9012-3456')).toBeOnTheScreen();
  });

  it('copies a returned electricity token', async () => {
    render(
      <PurchaseSuccess
        type="power"
        amount={1000}
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        voucherPin="1234-5678-9012-3456"
      />
    );

    fireEvent.press(screen.getByLabelText('Copy voucher token'));

    await waitFor(() => {
      expect(mockSetClipboardString).toHaveBeenCalledWith(
        '1234-5678-9012-3456'
      );
    });
  });

  it('opens the receipt preview with the purchase details and token', () => {
    render(
      <PurchaseSuccess
        type="power"
        amount={1000}
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        voucherPin="1234-5678-9012-3456"
      />
    );

    fireEvent.press(screen.getByLabelText('View utility receipt'));

    const html = String(screen.getByTestId('receipt-preview').props.children);
    expect(html).toContain('43901766923');
    expect(html).toContain('1234-5678-9012-3456');
    expect(html).toContain('"type":"power"');
  });

  it('alerts when copying a returned electricity token fails', async () => {
    mockSetClipboardString.mockRejectedValueOnce(new Error('Clipboard denied'));

    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        voucherPin="1234-5678-9012-3456"
      />
    );

    fireEvent.press(screen.getByLabelText('Copy voucher token'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Copy Failed',
        'Could not copy this token.'
      );
    });
    expect(console.error).toHaveBeenCalledWith(
      'Failed to copy utility voucher token:',
      expect.any(Error)
    );
  });

  it('alerts when copying a returned electricity token is declined', async () => {
    mockSetClipboardString.mockResolvedValueOnce(false);

    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        voucherPin="1234-5678-9012-3456"
      />
    );

    fireEvent.press(screen.getByLabelText('Copy voucher token'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Copy Failed',
        'Could not copy this token.'
      );
    });
  });

  it('shows account creation CTA for unauthenticated users', () => {
    const onCreateAccount = jest.fn();

    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={false}
        onCreateAccount={onCreateAccount}
      />
    );

    fireEvent.press(screen.getByText('Create Account'));

    expect(onCreateAccount).toHaveBeenCalledTimes(1);
  });

  it('shows cashback details when cashback is returned', () => {
    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={{ amount: 50, newBalance: 1200 }}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
      />
    );

    expect(screen.getByText('+₦50.00 cashback')).toBeOnTheScreen();
    expect(screen.getByText('Wallet balance: ₦1,200.00')).toBeOnTheScreen();
  });

  it('shows the celebratory slogan on a successful purchase, not the reference', () => {
    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        status="successful"
      />
    );

    expect(screen.getByText('Ogabassey Never Disappoints!')).toBeOnTheScreen();
    expect(screen.queryByText('Ref: ref-123')).not.toBeOnTheScreen();
  });

  it('shows the transaction reference (not the slogan) when a purchase fails', () => {
    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        status="failed"
      />
    );

    expect(screen.getByText('Ref: ref-123')).toBeOnTheScreen();
    expect(
      screen.queryByText('Ogabassey Never Disappoints!')
    ).not.toBeOnTheScreen();
  });

  it('tells a failed wallet-only purchase the wallet was refunded', () => {
    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        refundConfirmed={true}
        status="failed"
      />
    );

    // No "another payment method": wallet-only, refund confirmed.
    expect(
      screen.getByText(
        'Your electricity purchase for 43901766923 failed. Your wallet has been refunded — please try again.'
      )
    ).toBeOnTheScreen();
  });

  it('keeps the failed copy soft without refund proof', () => {
    // A failed status WITHOUT refundConfirmed (e.g. a future caller
    // passing failed from route params) must not assert a refund.
    const { rerender } = render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        status="failed"
      />
    );

    expect(
      screen.getByText(
        'Your electricity purchase for 43901766923 failed. Please check your wallet balance and try again.'
      )
    ).toBeOnTheScreen();
    expect(screen.queryByText(/has been refunded/)).not.toBeOnTheScreen();

    rerender(
      <PurchaseSuccess
        type="airtime"
        txReference="ref-456"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        refundConfirmed={false}
        status="failed"
      />
    );

    expect(
      screen.getByText(
        'Your airtime purchase failed. Please check your wallet balance and try again.'
      )
    ).toBeOnTheScreen();
  });

  it('says no charge was made for a skipped refund, never that it refunded', () => {
    // Codex R110 P2: skipped rows were never charged.
    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        refundSkipped={true}
        status="failed"
      />
    );

    expect(
      screen.getByText(
        'Your electricity purchase for 43901766923 failed. No charge was made to your wallet — please try again.'
      )
    ).toBeOnTheScreen();
    expect(screen.queryByText(/has been refunded/)).not.toBeOnTheScreen();
  });

  it('shows the reference (not the slogan) while a purchase is still processing', () => {
    render(
      <PurchaseSuccess
        type="power"
        customerIdentifier="43901766923"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
        status="processing"
      />
    );

    expect(screen.getByText('Ref: ref-123')).toBeOnTheScreen();
    expect(
      screen.queryByText('Ogabassey Never Disappoints!')
    ).not.toBeOnTheScreen();
  });

  it('uses the provided utility type when no label mapping exists', () => {
    render(
      <PurchaseSuccess
        type="water"
        customerIdentifier="WATER-123"
        txReference="ref-123"
        cashback={null}
        isAuthenticated={true}
        onCreateAccount={jest.fn()}
      />
    );

    expect(
      screen.getByText('Your water purchase for WATER-123 was successful.')
    ).toBeOnTheScreen();
  });
});
