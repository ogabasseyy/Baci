import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';
import { WalletContent } from './WalletContent';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ products: [], isLoading: false }),
}));
jest.mock('@/hooks/use-wallet-credit-watch', () => ({
  useWalletCreditWatch: () => ({}),
}));
jest.mock('./WalletHeroSection', () => ({ WalletHeroSection: () => null }));
jest.mock('./WalletSavingsCarousel', () => ({
  WalletSavingsCarousel: () => null,
}));
jest.mock('./WalletActionsRow', () => ({ WalletActionsRow: () => null }));
jest.mock('./WalletTransactionHistory', () => ({
  WalletTransactionHistory: () => null,
}));
jest.mock('./WalletSavingsDeviceSwapModal', () => ({
  WalletSavingsDeviceSwapModal: () => null,
}));
jest.mock('./WalletSavingsVariantResolutionModal', () => ({
  WalletSavingsVariantResolutionModal: () => null,
}));
jest.mock('./WalletSavingsProgressModal', () => {
  const { Text } = require('react-native');
  return {
    WalletSavingsProgressModal: ({ visible }: { visible: boolean }) =>
      visible ? <Text>Savings step</Text> : null,
  };
});
jest.mock('./WalletFundModal', () => {
  const { Text } = require('react-native');
  return {
    WalletFundModal: ({ showFundPanel }: { showFundPanel: boolean }) =>
      showFundPanel ? <Text>Funding step</Text> : null,
  };
});

it('keeps the native modal but resets sheet geometry during savings-to-funding handoff', () => {
  const props = createWalletContentProps();
  const { rerender } = render(
    <WalletContent {...props} showSavingsProgress showFundPanel={false} />
  );
  const modal = screen.UNSAFE_getByType(Modal);
  const sheet = screen.getByTestId('gorhom-sheet');
  expect(screen.getByText('Savings step')).toBeOnTheScreen();
  rerender(
    <WalletContent {...props} showSavingsProgress={false} showFundPanel />
  );
  expect(screen.UNSAFE_getByType(Modal)).toBe(modal);
  const fundingSheet = screen.getByTestId('gorhom-sheet');
  expect(fundingSheet).not.toBe(sheet);
  expect(screen.getByText('Funding step')).toBeOnTheScreen();
  expect(fundingSheet.props.enableDynamicSizing).toBe(true);
  expect(fundingSheet.props.snapPoints).toBeUndefined();
  expect(screen.queryByText('Savings step')).toBeNull();
  fireEvent(fundingSheet, 'change', -1);
  expect(props.onResetFund).toHaveBeenCalled();
});
