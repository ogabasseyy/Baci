import { describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { getMobileAdUnitId } from '@/config/mobile-ad-placements';
import { useMobileAdsReadiness } from '@/hooks/use-mobile-ads-readiness';
import { AdSlot } from './AdSlot';

jest.mock('@/hooks/use-mobile-ads-readiness', () => ({
  useMobileAdsReadiness: jest.fn(() => ({
    canRequestAds: true,
    initialized: true,
  })),
}));

const mockUseMobileAdsReadiness = jest.mocked(useMobileAdsReadiness);

jest.mock('@/config/mobile-ad-placements', () => {
  const actual = jest.requireActual('@/config/mobile-ad-placements') as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    getMobileAdUnitId: jest.fn(actual.getMobileAdUnitId as () => unknown),
  };
});

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    ANCHORED_ADAPTIVE_BANNER: 'anchored-adaptive-banner',
  },
}));
jest.mock('@/services/analytics-core', () => ({
  trackEvent: jest.fn(),
}));

let mockDrawerOpen = false;
jest.mock('@/stores/drawer-store', () => ({
  useDrawerStore: (selector: (state: { isOpen: boolean }) => boolean) =>
    selector({ isOpen: mockDrawerOpen }),
}));

let mockIsFocused = true;
jest.mock('expo-router', () => ({
  useIsFocused: () => mockIsFocused,
}));

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;

function setAdsEnabled(value: string | undefined) {
  if (value === undefined) {
    delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = value;
  }
}

describe('AdSlot', () => {
  it('renders nothing while ads are disabled', () => {
    setAdsEnabled(undefined);
    const { toJSON } = render(<AdSlot placement="CART_MPU" />);
    expect(toJSON()).toBeNull();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('renders the sponsored banner slot for a placement', () => {
    setAdsEnabled('true');
    render(<AdSlot placement="CART_MPU" />);
    expect(screen.getByLabelText('Sponsored advertisement')).toBeTruthy();
    expect(screen.getByText('Sponsored')).toBeTruthy();
    expect(screen.getByTestId('ad-slot-cart-mpu')).toBeTruthy();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('renders nothing until consent is ready', () => {
    mockUseMobileAdsReadiness.mockReturnValueOnce({
      canRequestAds: false,
      initialized: false,
    });
    setAdsEnabled('true');
    const { toJSON } = render(<AdSlot placement="CART_MPU" />);
    expect(toJSON()).toBeNull();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('renders nothing instead of crashing when the registry rejects the placement', () => {
    jest.mocked(getMobileAdUnitId).mockImplementationOnce(() => {
      throw new Error('[mobile-ads] missing unit ID');
    });
    setAdsEnabled('true');
    const { toJSON } = render(<AdSlot placement="CART_MPU" />);
    expect(toJSON()).toBeNull();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('unmounts the slot when the banner fails to load instead of keeping a blank frame', () => {
    // Regression: a no-fill or load error must remove the whole slot
    // (label and reserved frame), not just record telemetry.
    setAdsEnabled('true');
    render(<AdSlot placement="CART_MPU" />);

    expect(screen.getByTestId('ad-slot-cart-mpu')).toBeTruthy();
    const banner = screen.UNSAFE_getByType('BannerAd' as never);
    act(() => {
      (
        banner.props as {
          onAdFailedToLoad: (error: Error) => void;
        }
      ).onAdFailedToLoad(new Error('no-fill'));
    });

    expect(screen.queryByTestId('ad-slot-cart-mpu')).toBeNull();
    expect(screen.queryByText('Sponsored')).toBeNull();
    setAdsEnabled(ORIGINAL_ENV);
  });

  it('suspends page slots while the drawer is open so only the drawer slot requests', () => {
    // Regression: the drawer owns FOOTER_ANCHOR while open, so page-level
    // slots must unmount (no parallel requests, no hidden-slot impressions).
    setAdsEnabled('true');
    mockDrawerOpen = true;
    try {
      const { toJSON } = render(<AdSlot placement="FOOTER_ANCHOR" />);
      expect(toJSON()).toBeNull();
    } finally {
      mockDrawerOpen = false;
      setAdsEnabled(ORIGINAL_ENV);
    }
  });

  it('keeps the drawer-owned slot mounted while the drawer is open', () => {
    setAdsEnabled('true');
    mockDrawerOpen = true;
    try {
      render(<AdSlot placement="FOOTER_ANCHOR" visibleWhileDrawerOpen />);
      expect(screen.getByTestId('ad-slot-footer-anchor')).toBeTruthy();
    } finally {
      mockDrawerOpen = false;
      setAdsEnabled(ORIGINAL_ENV);
    }
  });

  it('renders nothing when the route is not focused so hidden screens cannot request', () => {
    // Regression: a pushed route keeps the previous screen mounted, so a
    // consent/SDK initialization resolving after navigation must not mount
    // a banner on the hidden screen.
    setAdsEnabled('true');
    mockIsFocused = false;
    try {
      const { toJSON } = render(<AdSlot placement="CART_MPU" />);
      expect(toJSON()).toBeNull();
    } finally {
      mockIsFocused = true;
      setAdsEnabled(ORIGINAL_ENV);
    }
  });
});
