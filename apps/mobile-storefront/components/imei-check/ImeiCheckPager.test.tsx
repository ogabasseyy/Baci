import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import type PagerView from 'react-native-pager-view';
import Colors from '@/constants/Colors';
import { ImeiCheckPager } from './ImeiCheckPager';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// PagerView is a native component; render it as a plain View that shows children.
jest.mock('react-native-pager-view', () => {
  const RN = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children: React.ReactNode }) => (
      <RN.View {...props}>{children}</RN.View>
    ),
  };
});

const baseProps = {
  colors: Colors.light,
  error: null as string | null,
  initialPage: 0,
  isLoading: false,
  isWalletError: false,
  isWalletLoading: false,
  pagerRef: createRef<PagerView>(),
  walletBalance: 50_000,
  onPageSelected: jest.fn(),
  onVerify: jest.fn(),
  onTopUpWallet: jest.fn(),
};

describe('ImeiCheckPager', () => {
  it('only mounts device pages that have been visited', () => {
    render(
      <ImeiCheckPager
        {...baseProps}
        visitedDevices={{
          smartphone: true,
          tablet: false,
          laptop: false,
          watch: false,
        }}
      />
    );

    // Phone page is visited → its default "Full Report" check renders.
    expect(screen.getByText('Full Report')).toBeTruthy();
    // Mac page is not visited → its check must not be mounted.
    expect(screen.queryByText('Mac iCloud Lock')).toBeNull();
  });
});

jest.mock('./use-imei-runtime-availability', () => ({
  useImeiRuntimeAvailability: () => ({
    availableTierKeys: null,
    failed: false,
    loading: false,
    retry: () => undefined,
  }),
}));
