import type { IoniconsIconName } from '@react-native-vector-icons/ionicons';
import type { RefObject } from 'react';
import type { ScrollView } from 'react-native';
import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';

export type { SavingsSelection, WalletSelection };

export type PaymentMethodType =
  | 'paystack'
  | 'korapay'
  | 'bank_transfer'
  | 'pay_on_delivery'
  | 'credpal'
  | 'credit_direct'
  | 'klump'
  | 'juicyway'
  | 'invoice'
  | 'payforme'
  | 'uba_redvault';

export type PaymentTab = 'full' | 'installments' | 'pay_later';

export interface PaymentMethod {
  id: PaymentMethodType;
  label: string;
  description: string;
  icon: IoniconsIconName;
  tab: PaymentTab;
  logoUrl?: string | number;
  disabled?: boolean;
  disabledReason?: string;
}

export type WalletMode = 'orders' | 'vtu' | 'off';

export interface PaymentMethodSelectorProps {
  selectedMethod: PaymentMethodType | null;
  onSelectMethod: (method: PaymentMethodType) => void;
  selectedTab: PaymentTab | null;
  onSelectTab: (tab: PaymentTab) => void;
  orderTotal: number;
  showInstallmentCalculator?: boolean;
  enabledMethods?: PaymentMethodType[];
  walletMode?: WalletMode;
  walletBalance?: number;
  walletError?: Error | null;
  walletIsLoading?: boolean;
  walletOrderTotal?: number;
  walletSelection?: WalletSelection;
  onWalletToggle?: (selection: WalletSelection) => void;
  savingsBalance?: number;
  savingsFallbackTitle?: string;
  savingsGoalId?: string | null;
  savingsGoalTitle?: string;
  savingsSelection?: SavingsSelection;
  onSavingsToggle?: (selection: SavingsSelection) => void;
  suppressedSelectedMethods?: PaymentMethodType[];
  hiddenMethods?: PaymentMethodType[];
  methodBadgeOverrides?: Partial<Record<PaymentMethodType, string>>;
  methodDescriptionOverrides?: Partial<Record<PaymentMethodType, string>>;
  methodDisabledReasons?: Partial<Record<PaymentMethodType, string>>;
  methodLabelOverrides?: Partial<Record<PaymentMethodType, string>>;
  walletFundedBankTransferMode?: boolean;
  /**
   * The scrolling ancestor + its live offset, threaded from the checkout payment
   * step so the intent accordion can keep the just-selected card in view when a
   * sibling collapses. Optional — omitted by VTU / tests.
   */
  paymentScrollRef?: RefObject<ScrollView | null>;
  paymentScrollOffsetRef?: RefObject<number>;
  /** Open the intent accordion fully collapsed (all options at a glance). */
  initiallyCollapsed?: boolean;
}

export const BNPL_MIN_AMOUNT = 10000;
export const BNPL_MAX_AMOUNT = 5000000;
export const INFO_PANEL_BACKGROUND_OPACITY = '10';
export const DEFAULT_SAVINGS_FALLBACK_TITLE = 'device savings';
