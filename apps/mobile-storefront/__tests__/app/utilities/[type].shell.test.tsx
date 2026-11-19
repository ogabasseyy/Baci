import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import UtilityPurchaseScreen from '@/app/utilities/[type]';

interface MockStorefrontScreenShellProps {
  children?: ReactNode;
  edges?: readonly string[];
}

type MockUtilityRouteParams = {
  amount?: string;
  customerIdentifier?: string;
  paymentStatus?: string;
  reference?: string;
  type?: string;
};

type MockInvalidUtilityServiceViewProps = {
  topInset: number;
};

type MockUtilityPurchaseSuccessViewProps = {
  bottomPadding: number;
  headerOffset: number;
};

const mockInsets = { bottom: 32, left: 0, right: 0, top: 48 };
const mockUseLocalSearchParams = jest.fn<() => MockUtilityRouteParams>();
const mockInvalidUtilityServiceView =
  jest.fn<(props: MockInvalidUtilityServiceViewProps) => void>();
const mockUtilityPurchaseSuccessView =
  jest.fn<(props: MockUtilityPurchaseSuccessViewProps) => void>();
const mockStorefrontScreenShell = jest.fn(
  ({ children }: MockStorefrontScreenShellProps) => (
    <View testID="storefront-screen-shell">{children}</View>
  )
);

// The PiggyVest pay host has its own tests; the screen only mounts it.
jest.mock('@/components/utilities/VtuWalletPayHost', () => ({
  VtuWalletPayHost: () => null,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({
    children,
    ...props
  }: MockStorefrontScreenShellProps) =>
    mockStorefrontScreenShell({ children, ...props }),
}));

jest.mock('@/components/ui/AppKeyboardContainer', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');

    return <View>{children}</View>;
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/components/utilities/AirtimeForm', () => ({
  AirtimeForm: () => null,
}));

jest.mock('@/components/utilities/BillForm', () => ({
  BillForm: () => null,
}));

jest.mock('@/components/utilities/DataForm', () => ({
  DataForm: () => null,
}));

jest.mock('@/components/utilities/InvalidUtilityServiceView', () => ({
  InvalidUtilityServiceView: (props: MockInvalidUtilityServiceViewProps) => {
    mockInvalidUtilityServiceView(props);
    return null;
  },
}));

jest.mock('@/components/utilities/UtilityHeader', () => ({
  UtilityHeader: () => null,
}));

jest.mock('@/components/utilities/UtilityPurchaseSuccessView', () => ({
  UtilityPurchaseSuccessView: (props: MockUtilityPurchaseSuccessViewProps) => {
    mockUtilityPurchaseSuccessView(props);
    return null;
  },
}));

jest.mock('@/components/utilities/UtilityTypeTabs', () => ({
  UtilityTypeTabs: () => null,
}));

jest.mock('@/components/utilities/use-quick-repeat', () => ({
  useQuickRepeat: () => ({
    handleRecipientSelect: jest.fn(),
    isRepeatPaymentReady: false,
    recentRecipients: [],
    repeatDefaults: {},
    repeatRevision: 0,
  }),
}));

jest.mock('@/hooks/use-wallet', () => ({
  walletKeys: {
    data: () => ['wallet-data'],
  },
}));

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
      merchantId: 'merchant-1',
      session: { access_token: 'token' },
    }),
}));

describe('UtilityPurchaseScreen shell ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ type: 'power' });
  });

  it('does not add safe-area padding around the utility form flow', () => {
    render(<UtilityPurchaseScreen />);

    expect(mockStorefrontScreenShell.mock.calls[0]?.[0].edges).toEqual([]);
  });

  it('preserves delegated top inset handling for invalid utility services', () => {
    mockUseLocalSearchParams.mockReturnValue({ type: 'missing' });

    render(<UtilityPurchaseScreen />);

    expect(mockStorefrontScreenShell.mock.calls[0]?.[0].edges).toEqual([]);
    expect(mockInvalidUtilityServiceView).toHaveBeenCalledWith(
      expect.objectContaining({
        topInset: mockInsets.top,
      })
    );
  });

  it('preserves delegated inset handling for purchase success', () => {
    mockUseLocalSearchParams.mockReturnValue({
      amount: '1000',
      customerIdentifier: '08031234567',
      paymentStatus: 'successful',
      reference: 'ref-success',
      type: 'airtime',
    });

    render(<UtilityPurchaseScreen />);

    expect(mockStorefrontScreenShell.mock.calls[0]?.[0].edges).toEqual([]);
    expect(mockUtilityPurchaseSuccessView).toHaveBeenCalledWith(
      expect.objectContaining({
        bottomPadding: 20,
        headerOffset: mockInsets.top,
      })
    );
  });
});
