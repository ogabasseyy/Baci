import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import UtilityPurchaseScreen from '@/app/utilities/[type]';
import type {
  UtilityHistoryFilter,
  VTUHistoryTransaction,
} from '@/hooks/use-vtu-history';
import { walletKeys } from '@/hooks/use-wallet';
import type { UtilityRepeatRecipient } from '@/lib/utility-repeat';

// Test constants
const EXPECTED_UTILITY_TAB_COUNT = 5;
const TEST_MERCHANT_ID = 'merchant-1';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn();
const mockInvalidateQueries = jest.fn();
type UtilityRouteParams = {
  amount?: string;
  cashbackAmount?: string;
  cashbackNewBalance?: string;
  customerIdentifier?: string;
  paymentStatus?: string;
  reference?: string;
  repeatAmount?: string;
  repeatBillerName?: string;
  repeatBillItemIdentifier?: string;
  repeatCustomerIdentifier?: string;
  repeatCustomerName?: string;
  repeatDataPlanCode?: string;
  repeatNetworkProvider?: string;
  repeatPhoneNumber?: string;
  repeatVerified?: string;
  type: string;
  voucherPin?: string;
};
const mockUseLocalSearchParams = jest.fn<() => UtilityRouteParams>(() => ({
  type: 'power',
}));
type MockVTUHistoryResult = {
  data: VTUHistoryTransaction[];
  error: Error | null;
  isLoading: boolean;
};
type MockUseVTUHistory = (
  filter: UtilityHistoryFilter,
  limit: number
) => MockVTUHistoryResult;
const mockUseVTUHistory = jest.fn<MockUseVTUHistory>();

type MockAirtimeFormProps = {
  initialPhoneNumber?: string;
  recentRecipients?: UtilityRepeatRecipient[];
  onSelectRecentRecipient?: (recipient: UtilityRepeatRecipient) => void;
};

type MockBillFormProps = {
  initialAmount?: string;
  initialCustomerIdentifier?: string;
  isRepeatPaymentReady?: boolean;
  recentRecipients?: UtilityRepeatRecipient[];
  onSelectRecentRecipient?: (recipient: UtilityRepeatRecipient) => void;
  type: string;
};

type MockDataFormProps = {
  initialPhoneNumber?: string;
  recentRecipients?: UtilityRepeatRecipient[];
  onSelectRecentRecipient?: (recipient: UtilityRepeatRecipient) => void;
};

const mockAirtimeForm = jest.fn<(props: MockAirtimeFormProps) => void>();
const mockBillForm = jest.fn<(props: MockBillFormProps) => void>();
const mockDataForm = jest.fn<(props: MockDataFormProps) => void>();

function createHistoryResult(
  overrides: Partial<MockVTUHistoryResult> = {}
): MockVTUHistoryResult {
  return {
    data: [],
    error: null,
    isLoading: false,
    ...overrides,
  };
}

function createHistoryTransaction(
  overrides: Partial<VTUHistoryTransaction> = {}
): VTUHistoryTransaction {
  return {
    amount: 2500,
    biller_item_code: 'KUD-ELE-EKED-002',
    biller_name: 'EKEDC NG',
    created_at: '2026-04-08T12:00:00.000Z',
    customer_identifier: '43901766923',
    id: 'tx-1',
    request_reference: 'ref-1',
    status: 'successful',
    type: 'electricity',
    ...overrides,
  };
}

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useRouter: () => ({
    back: mockBack,
    canGoBack: mockCanGoBack,
    push: mockPush,
    replace: mockReplace,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: import('react').ReactNode }) =>
    children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/components/utilities/AirtimeForm', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    AirtimeForm: (props: MockAirtimeFormProps) => {
      mockAirtimeForm(props);

      return (
        <View>
          <Text>{`Airtime form ${props.initialPhoneNumber ?? ''}`}</Text>
          {props.recentRecipients?.map((recipient) => (
            <Pressable
              key={recipient.id}
              accessibilityRole="button"
              accessibilityLabel={`Select recent ${recipient.identifier}`}
              onPress={() => props.onSelectRecentRecipient?.(recipient)}
            >
              <Text>{`Recent recipient ${recipient.identifier}`}</Text>
            </Pressable>
          ))}
        </View>
      );
    },
  };
});

jest.mock('@/components/utilities/BillForm', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    BillForm: (props: MockBillFormProps) => {
      mockBillForm(props);
      const formText = [
        'Bill form',
        props.type,
        props.initialCustomerIdentifier,
        props.initialAmount,
        props.isRepeatPaymentReady ? 'repeat-ready' : undefined,
      ]
        .filter(Boolean)
        .join(' ');

      return (
        <View>
          <Text>{formText}</Text>
          {props.recentRecipients?.map((recipient) => (
            <Pressable
              key={recipient.id}
              accessibilityRole="button"
              accessibilityLabel={`Select recent ${recipient.identifier}`}
              onPress={() => props.onSelectRecentRecipient?.(recipient)}
            >
              <Text>{`Recent recipient ${recipient.identifier}`}</Text>
            </Pressable>
          ))}
        </View>
      );
    },
  };
});

jest.mock('@/components/utilities/DataForm', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    DataForm: (props: MockDataFormProps) => {
      mockDataForm(props);

      return (
        <View>
          <Text>{`Data form ${props.initialPhoneNumber ?? ''}`}</Text>
          {props.recentRecipients?.map((recipient) => (
            <Pressable
              key={recipient.id}
              accessibilityRole="button"
              accessibilityLabel={`Select recent ${recipient.identifier}`}
              onPress={() => props.onSelectRecentRecipient?.(recipient)}
            >
              <Text>{`Recent recipient ${recipient.identifier}`}</Text>
            </Pressable>
          ))}
        </View>
      );
    },
  };
});

jest.mock('@/components/utilities/PurchaseSuccess', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    PurchaseSuccess: ({
      customerIdentifier,
      status,
    }: {
      customerIdentifier?: string;
      status?: string;
    }) => (
      <Text>{`Purchase success ${status ?? 'successful'} ${customerIdentifier ?? ''}`}</Text>
    ),
  };
});

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      customer: { id: string } | null;
      merchantId: string | null;
      session: { access_token: string } | null;
    }) => unknown
  ) =>
    selector({
      customer: { id: 'customer-1' },
      merchantId: TEST_MERCHANT_ID,
      session: { access_token: 'token' },
    }),
}));

jest.mock('@/hooks/use-vtu-history', () => ({
  useVTUHistory: (filter: UtilityHistoryFilter, limit: number) =>
    mockUseVTUHistory(filter, limit),
}));

jest.mock('@/hooks/use-vtu-voucher-pin-backfill', () => ({
  useVtuVoucherPinBackfill: () => null,
}));

describe('UtilityPurchaseScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(true);
    mockUseLocalSearchParams.mockReturnValue({ type: 'power' });
    mockUseVTUHistory.mockReturnValue(createHistoryResult());
  });

  it('shows utility submenus and switches between utility types locally', () => {
    render(<UtilityPurchaseScreen />);

    expect(
      screen.getByTestId('keyboard-container').props.keyboardVerticalOffset
    ).toBeUndefined();
    expect(screen.getByText('Electricity')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('View utility history'));
    expect(mockPush).toHaveBeenCalledWith('/utilities/history?type=power');

    expect(screen.getByText('Airtime')).toBeOnTheScreen();
    expect(screen.getByText('Data')).toBeOnTheScreen();
    expect(screen.getByText('TV')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Power utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });

    fireEvent.press(screen.getByLabelText('Data utility service'));

    expect(mockReplace).not.toHaveBeenCalledWith('/utilities/data');
    expect(screen.getByText('Data form')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Data utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });
  });

  it('renders utility submenus on the airtime screen', () => {
    mockUseLocalSearchParams.mockReturnValue({ type: 'airtime' });

    render(<UtilityPurchaseScreen />);

    expect(screen.getByText('Airtime form')).toBeOnTheScreen();
    expect(screen.getAllByRole('tab')).toHaveLength(EXPECTED_UTILITY_TAB_COUNT);
    expect(screen.getByLabelText('Data utility service')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Airtime utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });
  });

  it('switches to airtime locally while keeping utility submenus visible', () => {
    render(<UtilityPurchaseScreen />);

    fireEvent.press(screen.getByLabelText('Airtime utility service'));

    expect(mockReplace).not.toHaveBeenCalledWith('/utilities/airtime');
    expect(screen.getAllByRole('tab')).toHaveLength(EXPECTED_UTILITY_TAB_COUNT);
    expect(screen.getByText('Airtime form')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Airtime utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });
  });

  it('updates selected type, active tab and form when PagerView selects another page', () => {
    mockUseLocalSearchParams.mockReturnValue({ type: 'airtime' });

    render(<UtilityPurchaseScreen />);

    expect(screen.getByText('Airtime form')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Airtime utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });

    const pager = screen.getByTestId('pager-view');

    fireEvent(pager, 'onPageSelected', {
      nativeEvent: { position: 1 },
    });

    expect(screen.getByText('Data form')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Data utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });

    fireEvent(pager, 'onPageSelected', {
      nativeEvent: { position: 3 },
    });

    expect(screen.getByText('Bill form power')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Power utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });
  });

  it('keeps state stable when PagerView selects the same or invalid page index', () => {
    mockUseLocalSearchParams.mockReturnValue({ type: 'airtime' });

    render(<UtilityPurchaseScreen />);

    expect(screen.getByText('Airtime form')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Airtime utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });

    const pager = screen.getByTestId('pager-view');

    fireEvent(pager, 'onPageSelected', {
      nativeEvent: { position: 0 },
    });

    expect(screen.getByText('Airtime form')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Airtime utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });

    fireEvent(pager, 'onPageSelected', {
      nativeEvent: { position: 99 },
    });

    expect(screen.getByText('Airtime form')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Airtime utility service')
    ).toHaveAccessibilityState({
      selected: true,
    });
  });

  it('uses the header back button for utility screens', () => {
    render(<UtilityPurchaseScreen />);

    fireEvent.press(screen.getByLabelText('Go back'));

    expect(mockBack).toHaveBeenCalled();
  });

  it('shows the meter number on a processing payment result', () => {
    mockUseLocalSearchParams.mockReturnValue({
      amount: '1000',
      customerIdentifier: '43901766923',
      paymentStatus: 'processing',
      reference: 'ref-123',
      type: 'power',
    });

    render(<UtilityPurchaseScreen />);

    expect(
      screen.getByText('Purchase success processing 43901766923')
    ).toBeOnTheScreen();
  });

  it('refreshes the wallet cache when a utility success includes cashback', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      amount: '1000',
      cashbackAmount: '50',
      cashbackNewBalance: '1200',
      customerIdentifier: '08031234567',
      paymentStatus: 'successful',
      reference: 'ref-cashback',
      type: 'airtime',
    });

    render(<UtilityPurchaseScreen />);

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: walletKeys.data({
          merchantId: TEST_MERCHANT_ID,
          ownerId: 'customer-1',
        }),
      });
    });
  });

  it('refreshes the wallet cache when a utility success has no cashback', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      amount: '1000',
      cashbackAmount: '0',
      cashbackNewBalance: '1200',
      customerIdentifier: '08031234567',
      paymentStatus: 'successful',
      reference: 'ref-no-cashback',
      type: 'airtime',
    });

    render(<UtilityPurchaseScreen />);

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: walletKeys.data({
          merchantId: TEST_MERCHANT_ID,
          ownerId: 'customer-1',
        }),
      });
    });
  });

  it('passes recent recipients to the current form and prefills after selection', () => {
    mockUseVTUHistory.mockReturnValue({
      ...createHistoryResult(),
      data: [createHistoryTransaction()],
    });

    render(<UtilityPurchaseScreen />);

    expect(mockBillForm).toHaveBeenCalledWith(
      expect.objectContaining({
        recentRecipients: [
          expect.objectContaining({
            identifier: '43901766923',
            identifierLabel: 'Meter Number',
          }),
        ],
        onSelectRecentRecipient: expect.any(Function),
      })
    );

    fireEvent.press(screen.getByLabelText('Select recent 43901766923'));

    expect(
      screen.getByText('Bill form power 43901766923 2500 repeat-ready')
    ).toBeOnTheScreen();
  });

  it('does not pass recent recipients for the latest failed transaction', () => {
    mockUseVTUHistory.mockReturnValue(
      createHistoryResult({
        data: [createHistoryTransaction({ status: 'failed' })],
      })
    );

    render(<UtilityPurchaseScreen />);

    expect(screen.queryByLabelText('Select recent 43901766923')).toBeNull();
    expect(mockBillForm).toHaveBeenLastCalledWith(
      expect.objectContaining({ recentRecipients: [] })
    );
  });

  it('does not pass recent recipients when history is empty', () => {
    mockUseVTUHistory.mockReturnValue(createHistoryResult({ data: [] }));

    render(<UtilityPurchaseScreen />);

    expect(screen.queryByLabelText(/Select recent/)).toBeNull();
    expect(mockBillForm).toHaveBeenLastCalledWith(
      expect.objectContaining({ recentRecipients: [] })
    );
  });

  it('does not pass recent recipients for a transaction outside the current utility type', () => {
    mockUseVTUHistory.mockReturnValue(
      createHistoryResult({
        data: [
          createHistoryTransaction({
            biller_name: null,
            customer_identifier: null,
            phone_number: '08031234567',
            type: 'airtime',
          }),
        ],
      })
    );

    render(<UtilityPurchaseScreen />);

    expect(screen.queryByLabelText('Select recent 08031234567')).toBeNull();
    expect(mockBillForm).toHaveBeenLastCalledWith(
      expect.objectContaining({ recentRecipients: [] })
    );
  });

  it('clears inline recipient repeat defaults when switching utility types', async () => {
    mockUseVTUHistory.mockReturnValue(
      createHistoryResult({
        data: [createHistoryTransaction()],
      })
    );

    render(<UtilityPurchaseScreen />);

    fireEvent.press(screen.getByLabelText('Select recent 43901766923'));
    expect(
      screen.getByText('Bill form power 43901766923 2500 repeat-ready')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('TV utility service'));

    await waitFor(() => {
      expect(screen.queryByText(/repeat-ready/)).toBeNull();
    });
  });

  it('does not render floating quick repeat loading notices while history loads', () => {
    mockUseVTUHistory.mockReturnValue(
      createHistoryResult({
        data: [createHistoryTransaction()],
        isLoading: true,
      })
    );

    render(<UtilityPurchaseScreen />);

    expect(
      screen.queryByLabelText('Repeat last Electricity transaction')
    ).toBeNull();
    expect(
      screen.queryByText('Checking recent Electricity transactions...')
    ).toBeNull();
  });

  it('does not render floating quick repeat error notices when history fails', () => {
    mockUseVTUHistory.mockReturnValue(
      createHistoryResult({
        data: [createHistoryTransaction()],
        error: new Error('History failed'),
      })
    );

    render(<UtilityPurchaseScreen />);

    expect(
      screen.queryByLabelText('Repeat last Electricity transaction')
    ).toBeNull();
    expect(
      screen.queryByText('Recent Electricity transactions unavailable.')
    ).toBeNull();
  });

  it('passes verified repeat route params straight into the bill payment step', () => {
    mockUseLocalSearchParams.mockReturnValue({
      repeatAmount: '1000',
      repeatBillerName: 'EKEDC NG',
      repeatBillItemIdentifier: 'KUD-ELE-EKED-002',
      repeatCustomerIdentifier: '43901766923',
      repeatVerified: '1',
      type: 'power',
    });

    render(<UtilityPurchaseScreen />);

    expect(
      screen.getByText('Bill form power 43901766923 1000 repeat-ready')
    ).toBeOnTheScreen();
  });

  it('does not carry route repeat params into another utility tab', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      repeatAmount: '1000',
      repeatBillerName: 'EKEDC NG',
      repeatBillItemIdentifier: 'KUD-ELE-EKED-002',
      repeatCustomerIdentifier: '43901766923',
      repeatVerified: '1',
      type: 'power',
    });

    render(<UtilityPurchaseScreen />);

    expect(
      screen.getByText('Bill form power 43901766923 1000 repeat-ready')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('TV utility service'));

    await waitFor(() => {
      expect(screen.getByText('Bill form tv')).toBeOnTheScreen();
    });
    expect(screen.queryByText(/repeat-ready/)).toBeNull();
  });
});
