import type { ReactNode } from 'react';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';

type WalletColors = (typeof Colors)['light'];

export type WalletSavingsProgressModalProps = {
  addAmount: string;
  colors: WalletColors;
  goal: WalletActiveSavingsGoal | null;
  isAdding: boolean;
  hasPendingContribution?: boolean;
  isFundPending?: boolean;
  onAddAmountChange: (value: string) => void;
  onAddSavings: () => void;
  onChangeDevice: () => void;
  onClose: () => void;
  onFundWallet: () => void;
  onRefreshWallet?: () => Promise<unknown>;
  onResolveVariant?: () => void;
  /** Rendered inside the sheet's modal so it can appear above it on iOS. */
  overlay?: ReactNode;
  /** Change phone, shown in this same sheet in place of the savings view. */
  phoneSwapStep?: ReactNode;
  visible: boolean;
  walletBalance: number;
  walletUpdatedAt?: number;
};
