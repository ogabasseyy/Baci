import type { StyleProp, ViewStyle } from 'react-native';
import type Colors from '@/constants/Colors';
import type { usePiggyvestWalletSetup } from '@/hooks/use-piggyvest-wallet-setup';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { Product } from '@/types/product';
import type { WalletFundPhoneSubmitResult } from './WalletFundPhonePrompt';
import type { WalletRefreshState } from './WalletRefreshNotice';
import type { WalletTransaction } from './WalletTransactionHistory';
import type { WalletDisplayFundingAccount } from './wallet.types';

type WalletColors = (typeof Colors)['light'];

export interface WalletContentProps {
  savingsGoals?: WalletActiveSavingsGoal[];
  primarySetup?: ReturnType<typeof usePiggyvestWalletSetup>;
  primaryCapabilityPending?: boolean;
  merchantId?: string;
  hasSavedCards?: boolean;
  activeSavingsGoal: WalletActiveSavingsGoal | null;
  canCreateFundingAccount: boolean;
  /** False while the route's persisted funding session is still being written. */
  canResolveCreditBaseline?: boolean;
  colors: WalletColors;
  contentContainerStyle: StyleProp<ViewStyle>;
  createFundingAccountUnavailableMessage?: string;
  /** Scopes the persisted bank-transfer funding session the credit watch reads. */
  customerId?: string;
  earningsAvailable?: boolean;
  earningsBalance: number | null;
  fundAmount: string;
  fundingAccount: WalletDisplayFundingAccount | null;
  /** Sanitized deep-link for the post-credit "Return to your purchase" CTA. */
  fundReturnTo?: WalletReturnHref;
  isAddingSavingsContribution: boolean;
  hasPendingSavingsContribution?: boolean;
  isCreatingFundingAccount: boolean;
  isFundPending: boolean;
  isRedeemPending: boolean;
  isRefetching: boolean;
  refreshState?: WalletRefreshState;
  loyaltyPoints: number;
  loyaltyTier?: string | null;
  needsPhone: boolean;
  onCreateFundingAccount: () => void;
  onChangeFundAmount: (value: string) => void;
  onChangeRedeemPoints: (value: string) => void;
  onConfirmFund: () => void;
  onConfirmRedeem: () => void;
  onAddSavingsContribution: () => void;
  onChangeSavingsDevice: (
    product: Product,
    variantId?: string | null
  ) => Promise<boolean>;
  onChangeSavingsContributionAmount: (value: string) => void;
  onResolveSavingsVariant: (variantId: string) => Promise<boolean>;
  onCloseSavingsProgress: () => void;
  onManageCards: () => void;
  onFundSavingsWallet: () => void;
  onOpenFundPanel: () => void;
  onOpenRedeemPanel: () => void;
  onQuickSave: () => void;
  onRefresh: () => void;
  onResetFund: () => void;
  onResetRedeem: () => void;
  onStartSavings: () => void;
  onSubmitPhone: (phone: string) => Promise<WalletFundPhoneSubmitResult>;
  redeemPoints: string;
  savingsContributionAmount: string;
  savingsBalance: number;
  spendableBalance?: number;
  showSavingsProgress: boolean;
  showQuickSave: boolean;
  showFundPanel: boolean;
  showRedeemPanel: boolean;
  totalBalance: number;
  /** Wallet ledger; the credit watch reads bank-transfer top-ups off it. */
  transactions: WalletTransaction[];
}
