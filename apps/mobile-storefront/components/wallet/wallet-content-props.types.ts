import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { Product } from '@/types/product';
import type { SavingsVariantResolveResult } from './resolve-completed-savings-goal-variant';
import type { WalletFundPhoneSubmitResult } from './WalletFundPhonePrompt';
import type { WalletTransaction } from './WalletTransactionHistory';
import type { WalletDisplayFundingAccount } from './wallet.types';

type WalletColors = (typeof Colors)['light'];

export interface WalletContentProps {
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
  goalAwaitingSettlement?: boolean;
  /** The wallet query's last-updated time: re-reads the goal readiness gate. */
  walletUpdatedAt?: number;
  isCreatingFundingAccount: boolean;
  isFundPending: boolean;
  isRedeemPending: boolean;
  isRefetching: boolean;
  loyaltyPoints: number;
  loyaltyTier?: string | null;
  needsPhone: boolean;
  primaryReady?: boolean;
  walletPrimaryUnsettled?: boolean;
  /** The PiggyVest read failed: balance and account can't be checked. */
  primaryUnreadable?: boolean;
  /** The PiggyVest balance is recalled from moments ago, not a fresh read. */
  primaryStale?: boolean;
  savingsPrimary?: boolean;
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
  onResolveSavingsVariant: (
    variantId: string
  ) => Promise<SavingsVariantResolveResult>;
  onCloseSavingsProgress: () => void;
  onManageCards: () => void;
  onFundSavingsWallet: () => void;
  onOpenFundPanel: () => void;
  onOpenRedeemPanel: () => void;
  onQuickSave: () => void;
  onRefresh: () => void;
  onResetFund: () => void;
  /** The PIN prompt: inside the open savings sheet (iOS can't stack modals). */
  pinPrompt?: ReactNode;
  onResetRedeem: () => void;
  onStartSavings: () => void;
  onSubmitPhone: (phone: string) => Promise<WalletFundPhoneSubmitResult>;
  redeemPoints: string;
  savingsContributionAmount: string;
  savingsBalance: number;
  walletBalance?: number;
  showSavingsProgress: boolean;
  showQuickSave: boolean;
  showFundPanel: boolean;
  showRedeemPanel: boolean;
  /** PiggyVest only: the legacy balance, spendable on purchases. */
  storeCreditBalance?: number;
  totalBalance: number;
  /** Wallet ledger; the credit watch reads bank-transfer top-ups off it. */
  transactions: WalletTransaction[];
}
