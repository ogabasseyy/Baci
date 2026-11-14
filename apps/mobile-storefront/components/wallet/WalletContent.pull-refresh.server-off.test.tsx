import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { WalletContent } from './WalletContent';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
  };
});
jest.mock('@/hooks/use-debounce', () => ({ useDebounce: (v: string) => v }));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ isLoading: false, products: [] }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));

describe('bugfix: Wallet tab left low under a stuck refresh spinner', () => {
  it('does not show the pull spinner for a background wallet refetch', () => {
    // Arrange: the wallet refetches in the background on return to the tab.
    render(<WalletContent {...createWalletContentProps()} isRefetching />);

    // Act
    const refreshControl = screen.getByTestId('wallet-scroll').props
      .refreshControl as { props: { refreshing: boolean } };

    // Assert: only the customer's own pull drives the spinner.
    expect(refreshControl.props.refreshing).toBe(false);
  });
});
