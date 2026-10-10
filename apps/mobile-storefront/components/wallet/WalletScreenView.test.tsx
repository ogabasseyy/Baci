import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import Colors from '@/constants/Colors';
import type { WalletContentProps } from './WalletContent';
import { WalletScreenView } from './WalletScreenView';

type ShellProps = {
  children?: ReactNode;
  edges?: readonly string[];
};

const mockStackScreen = jest.fn();
const mockScreenShell = jest.fn();

jest.mock('expo-router', () => ({
  Stack: {
    Screen: (props: unknown) => {
      mockStackScreen(props);
      return null;
    },
  },
}));

jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({ children, ...props }: ShellProps) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    mockScreenShell(props);
    return <View testID="wallet-shell">{children}</View>;
  },
}));

jest.mock('./WalletContent', () => ({
  WalletContent: ({ totalBalance }: WalletContentProps) => {
    const { Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>{`wallet-balance:${totalBalance}`}</Text>;
  },
}));

describe('WalletScreenView', () => {
  const walletContentProps: Omit<WalletContentProps, 'colors'> = {
    activeSavingsGoal: null,
    canCreateFundingAccount: true,
    contentContainerStyle: { paddingBottom: 32 },
    earningsBalance: 90000,
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
    onChangeSavingsContributionAmount: jest.fn(),
    onChangeFundAmount: jest.fn(),
    onCreateFundingAccount: jest.fn(),
    onChangeRedeemPoints: jest.fn(),
    onCloseSavingsProgress: jest.fn(),
    onConfirmFund: jest.fn(),
    onConfirmRedeem: jest.fn(),
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
    savingsContributionAmount: '',
    savingsBalance: 35000,
    showSavingsProgress: false,
    showQuickSave: true,
    showFundPanel: false,
    showRedeemPanel: false,
    totalBalance: 125000,
    transactions: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loaded stack wallet content with the wallet title', () => {
    render(
      <WalletScreenView
        colors={Colors.light}
        presentation="stack"
        walletContentProps={walletContentProps}
      />
    );

    expect(screen.getByText('wallet-balance:125000')).toBeOnTheScreen();
    expect(mockStackScreen).toHaveBeenCalledWith({
      options: { title: 'Wallet & Loyalty' },
    });
    expect(mockScreenShell).toHaveBeenCalledWith(
      expect.objectContaining({ edges: ['bottom'] })
    );
  });

  it('renders a tab loading state with a provided status message', () => {
    render(
      <WalletScreenView
        colors={Colors.light}
        loadingMessage="Unable to load wallet."
        presentation="tab"
      />
    );

    expect(screen.getByText('Wallet & Loyalty')).toBeOnTheScreen();
    expect(screen.getByLabelText('Preparing wallet')).toBeOnTheScreen();
    expect(screen.getByText('Unable to load wallet.')).toBeOnTheScreen();
    expect(mockStackScreen).not.toHaveBeenCalled();
    expect(mockScreenShell).toHaveBeenCalledWith(
      expect.objectContaining({ edges: ['top'] })
    );
  });

  it('renders a stack loading state with the existing short title', () => {
    render(
      <WalletScreenView
        colors={Colors.light}
        loadingMessage="Preparing your wallet..."
        presentation="stack"
      />
    );

    expect(screen.getByLabelText('Preparing wallet')).toBeOnTheScreen();
    expect(screen.getByText('Preparing your wallet...')).toBeOnTheScreen();
    expect(mockStackScreen).toHaveBeenCalledWith({
      options: { title: 'Wallet' },
    });
    expect(mockScreenShell).toHaveBeenCalledWith(
      expect.objectContaining({ edges: ['bottom'] })
    );
  });

  it('renders loaded wallet content without a stack header in tab presentation', () => {
    render(
      <WalletScreenView
        colors={Colors.light}
        presentation="tab"
        walletContentProps={walletContentProps}
      />
    );

    expect(screen.getByText('wallet-balance:125000')).toBeOnTheScreen();
    expect(mockStackScreen).not.toHaveBeenCalled();
    expect(mockScreenShell).toHaveBeenCalledWith(
      expect.objectContaining({ edges: ['top'] })
    );
  });
});
