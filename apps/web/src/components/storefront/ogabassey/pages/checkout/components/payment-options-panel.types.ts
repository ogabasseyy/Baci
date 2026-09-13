import type { PaymentMethod, PaymentTab } from '../types';
import type { FeatureSettings } from './payment-step-availability';
import type { RedvaultPaymentStatus, RedvaultQuoteSummary } from './redvault/RedvaultPaymentOption';

export interface PaymentOptionsPanelProps {
  paymentTab: PaymentTab;
  setPaymentTab: (v: PaymentTab) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (v: PaymentMethod) => void;
  paystackCheckoutAvailable: boolean;
  korapayCheckoutAvailable: boolean;
  bankTransferCheckoutAvailable: boolean;
  featureSettings?: FeatureSettings | null;
  klumpEligible: boolean;
  hasInstallmentOptions: boolean;
  currency?: string | null;
  redvaultAvailable: boolean;
  redvaultStatus: RedvaultPaymentStatus;
  redvaultSummary: RedvaultQuoteSummary | null;
}
