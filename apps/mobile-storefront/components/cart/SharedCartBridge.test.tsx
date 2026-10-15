import { render } from '@testing-library/react-native';

const mockUseSharedCart = jest.fn();
const mockSetBridgeState = jest.fn();
let mockMerchant: unknown;
let mockIsPlaceholderData = false;
let mockUserId: string | null = null;

jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://api.usebaci.com',
}));

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: 'merchant-1',
    MERCHANT_SLUG: 'ogabassey',
    MERCHANT_DOMAIN: 'shop.example.com',
  },
}));

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: () => ({
    data: mockMerchant,
    isPlaceholderData: mockIsPlaceholderData,
  }),
}));

jest.mock('@/hooks/use-shared-cart', () => ({
  useSharedCart: (options: unknown) => mockUseSharedCart(options),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { user: { id: string } | null }) => unknown
  ) => selector({ user: mockUserId ? { id: mockUserId } : null }),
}));

jest.mock('@/stores/native-shared-cart-store', () => ({
  useNativeSharedCartStore: {
    setState: (state: unknown) => mockSetBridgeState(state),
  },
}));

import { SharedCartBridge } from './SharedCartBridge';

const enrolledMerchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  premium_features: ['shared_cart', 'shared_cart_native'],
};

describe('SharedCartBridge', () => {
  beforeEach(() => {
    mockUseSharedCart.mockClear();
    mockSetBridgeState.mockClear();
    mockMerchant = enrolledMerchant;
    mockIsPlaceholderData = false;
    mockUserId = null;
  });

  it('renders nothing', () => {
    const { toJSON } = render(<SharedCartBridge />);
    expect(toJSON()).toBeNull();
  });

  it('enables the shared cart for an enrolled merchant and guest subject', () => {
    render(<SharedCartBridge />);

    expect(mockUseSharedCart).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        accountsEnabled: false,
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        apiOrigin: 'https://api.usebaci.com',
        subjectKey: 'guest',
      })
    );
    expect(mockSetBridgeState).toHaveBeenCalledWith({ accountUserId: null });
  });

  it('stays disabled on placeholder merchant data', () => {
    mockIsPlaceholderData = true;
    render(<SharedCartBridge />);

    expect(mockUseSharedCart).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, accountsEnabled: false })
    );
  });

  it('publishes the signed-in account id and subject key', () => {
    mockMerchant = {
      ...enrolledMerchant,
      premium_features: [
        'shared_cart',
        'shared_cart_native',
        'shared_cart_accounts',
      ],
    };
    mockUserId = 'user-7';
    render(<SharedCartBridge />);

    expect(mockSetBridgeState).toHaveBeenCalledWith({
      accountUserId: 'user-7',
    });
    expect(mockUseSharedCart).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        accountsEnabled: true,
        subjectKey: 'user-7',
      })
    );
  });
});
