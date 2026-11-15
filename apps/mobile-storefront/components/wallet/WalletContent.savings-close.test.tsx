import { describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletContent, type WalletContentProps } from './WalletContent';

let mockClose: (() => void) | undefined;
jest.mock('./WalletSavingsProgressModal', () => ({
  WalletSavingsProgressModal: ({ onClose }: { onClose: () => void }) => {
    mockClose = onClose;
    return null;
  },
}));

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: { View },
    FadeIn: {
      duration: () => ({
        delay: () => ({}),
      }),
    },
  };
});

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ isLoading: false, products: [] }),
}));

function createProps(): WalletContentProps {
  return {
    activeSavingsGoal: {
      contribution_amount: 10000,
      contribution_frequency: 'weekly',
      current_amount: 100000,
      id: 'goal-1',
      maturity_date: '2026-09-30',
      product_condition: 'Used',
      product_variant_label: 'Storage: 256GB',
      source_mode: 'manual',
      status: 'completed',
      target_amount: 100000,
      title: 'iPhone 15 Pro',
    },
    canCreateFundingAccount: true,
    colors: Colors.light,
    contentContainerStyle: { paddingBottom: 32, paddingTop: 20 },
    earningsBalance: 125000,
    fundAmount: '',
    fundingAccount: null,
    isAddingSavingsContribution: false,
    isCreatingFundingAccount: false,
    isFundPending: false,
    isRedeemPending: false,
    isRefetching: false,
    loyaltyPoints: 2000,
    needsPhone: false,
    onAddSavingsContribution: jest.fn(),
    onChangeSavingsDevice: jest.fn(async () => true),
    onResolveSavingsVariant: jest.fn(async (): Promise<true | string> => true),
    onChangeFundAmount: jest.fn(),
    onChangeRedeemPoints: jest.fn(),
    onChangeSavingsContributionAmount: jest.fn(),
    onCloseSavingsProgress: jest.fn(),
    onConfirmFund: jest.fn(),
    onConfirmRedeem: jest.fn(),
    onCreateFundingAccount: jest.fn(),
    onFundSavingsWallet: jest.fn(),
    onManageCards: jest.fn(),
    onOpenFundPanel: jest.fn(),
    onOpenRedeemPanel: jest.fn(),
    onQuickSave: jest.fn(),
    onRefresh: jest.fn(),
    onResetFund: jest.fn(),
    onResetRedeem: jest.fn(),
    onStartSavings: jest.fn(),
    onSubmitPhone: jest.fn(async () => ({ success: true })),
    redeemPoints: '',
    savingsBalance: 100000,
    savingsContributionAmount: '',
    showFundPanel: false,
    showQuickSave: true,
    showRedeemPanel: false,
    showSavingsProgress: false,
    totalBalance: 225000,
    transactions: [],
  };
}

describe('closing the savings sheet', () => {
  it('starts the next opening fresh: the picked amount is cleared', () => {
    const props = {
      ...createProps(),
      showSavingsProgress: true,
      savingsContributionAmount: '5000',
    };
    render(<WalletContent {...props} />);
    act(() => mockClose?.());
    expect(props.onChangeSavingsContributionAmount).toHaveBeenCalledWith('');
    expect(props.onCloseSavingsProgress).toHaveBeenCalledTimes(1);
  });

  it('keeps the amount while a contribution is still going out', () => {
    const props = {
      ...createProps(),
      showSavingsProgress: true,
      savingsContributionAmount: '5000',
      hasPendingSavingsContribution: true,
    };
    render(<WalletContent {...props} />);
    act(() => mockClose?.());
    expect(props.onChangeSavingsContributionAmount).not.toHaveBeenCalled();
    expect(props.onCloseSavingsProgress).toHaveBeenCalledTimes(1);
  });
});
