import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletContent, type WalletContentProps } from './WalletContent';

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
    onResolveSavingsVariant: jest.fn(async () => true),
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

describe('WalletContent completed savings goals', () => {
  it('keeps variant resolution instead of device replacement when options exist', () => {
    const props = createProps();
    if (!props.activeSavingsGoal) throw new Error('Missing synthetic goal');
    props.activeSavingsGoal.selection_unresolved = true;
    props.activeSavingsGoal.variant_resolution_options = [
      { id: 'variant-1', label: '256GB Black' },
    ];
    render(<WalletContent {...props} showSavingsProgress />);

    expect(
      screen.queryByRole('button', { name: 'Change savings device' })
    ).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Resolve savings device variant' })
    );

    expect(
      screen.getByRole('button', {
        name: 'Resolve savings variant 256GB Black',
      })
    ).toBeOnTheScreen();
    expect(
      screen.queryByLabelText('Savings replacement device search')
    ).toBeNull();
    expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();
  });

  it.each([
    undefined,
    [],
  ])('opens device recovery for unresolved completed goals with options %j', (options) => {
    const props = createProps();
    if (!props.activeSavingsGoal) throw new Error('Missing synthetic goal');
    props.activeSavingsGoal.selection_unresolved = true;
    props.activeSavingsGoal.variant_resolution_options = options;
    render(<WalletContent {...props} showSavingsProgress />);

    fireEvent.press(
      screen.getByRole('button', { name: 'Change savings device' })
    );

    expect(
      screen.getByLabelText('Savings replacement device search')
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Savings top-up amount')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick Save' })).toBeNull();
  });

  it('exposes recovery from the wallet for a completed unresolved goal', () => {
    const props = createProps();
    if (!props.activeSavingsGoal) throw new Error('Missing synthetic goal');
    props.activeSavingsGoal.selection_unresolved = true;
    render(<WalletContent {...props} />);

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Choose exact variant for iPhone 15 Pro',
      })
    );

    expect(props.onStartSavings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Quick Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to Savings' })).toBeNull();
  });

  it('keeps completed goals displayable without enabling top-up actions', () => {
    render(<WalletContent {...createProps()} showSavingsProgress />);

    expect(
      screen.getByRole('button', {
        name: 'Start another plan for iPhone 15 Pro',
      })
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Quick Save' })).toBeNull();
    expect(
      screen.getByText('This savings goal is complete.')
    ).toBeOnTheScreen();
  });
});
