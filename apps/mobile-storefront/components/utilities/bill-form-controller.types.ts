import type { RefObject } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';
import type { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { Biller, BillItem, useVTUBillers } from '@/hooks/use-vtu-billers';
import type { useVTUVerify } from '@/hooks/use-vtu-verify';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { UtilityBeneficiary } from '@/lib/utility-beneficiaries';
import type { resolveBillItemSelection } from './bill-item-selection';

export interface BillFormController {
  amount: string;
  beneficiaries: UtilityBeneficiary[];
  billersQuery: ReturnType<typeof useVTUBillers>;
  billItemSelection: ReturnType<typeof resolveBillItemSelection>;
  canShowPayment: boolean;
  customerId: string;
  footerBottomOffset: number;
  footerSpacerHeight: number;
  formattedAmount: string;
  handleBillItemSelect: (depth: number, billItem: BillItem) => void;
  handleBillerSelect: (biller: Biller) => void;
  handlePaymentLayout: (event: LayoutChangeEvent) => void;
  handlePurchase: () => Promise<void>;
  handleSelectBeneficiary: (beneficiary: UtilityBeneficiary) => void;
  handleVerify: () => void;
  insets: ReturnType<typeof useSafeAreaInsets>;
  isBillItemSelectionComplete: boolean;
  isBusy: boolean;
  isFixedAmount: boolean;
  isKeyboardVisible: boolean;
  isProviderPickerExpanded: boolean;
  isRepeatPaymentActive: boolean;
  numericAmount: number;
  /**
   * Bill customer-of-record name (meter owner / account holder), populated
   * either from the last successful purchase ("Repeat last") or from the live
   * verify response. Used to render the verified name and to send through to
   * the API so future repeats keep working.
   */
  verifiedCustomerName: string | null;
  payment: ReturnType<typeof useUtilityPayment>;
  resetVerification: () => void;
  scheduleNextStepScroll: (nextStepY: number) => void;
  scrollViewRef: RefObject<ScrollViewInstance | null>;
  selectedBiller: Biller | null;
  selectedBillItemIdentifier: string | null;
  setProviderPickerExpanded: (isExpanded: boolean) => void;
  setRepeatPaymentActive: (isActive: boolean) => void;
  shouldScrollToNextStep: boolean;
  updateAmount: (value: string) => void;
  updateCustomerId: (value: string) => void;
  verify: ReturnType<typeof useVTUVerify>;
  /** Prefilled bill deep-link the wallet returns to after a bank transfer. */
  walletReturnToHref: WalletReturnHref;
}
