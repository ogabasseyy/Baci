import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';

export type WalletColors = (typeof Colors)['light'];

export type WalletSavingsFundingSectionProps = {
  addAmount: string;
  colors: WalletColors;
  goal: WalletActiveSavingsGoal;
  isAdding: boolean;
  isFundPending: boolean;
  onAddAmountChange: (value: string) => void;
  onAddSavings: () => void;
  onFundWallet: () => void;
  onRefreshWallet?: () => Promise<unknown>;
  remainingAmount: number;
  usesPlanFunding: boolean;
  visible: boolean;
  walletBalance: number;
  walletUpdatedAt?: number;
};

export type ManualPrimaryGoalSectionProps = WalletSavingsFundingSectionProps & {
  merchantId: string;
  userId: string;
};
