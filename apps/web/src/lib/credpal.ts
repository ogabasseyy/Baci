/**
 * CredPal BNPL (Buy Now Pay Later) Integration
 *
 * CredPal provides inline checkout via a JavaScript popup.
 * Docs: https://github.com/crednet/credpal-checkout-inline
 */

export interface CredPalCheckoutConfig {
  key: string;
  amount: number;
  product: string;
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  onClose?: () => void;
  onLoad?: () => void;
  onError?: (error: { success: false; message: string }) => void;
  onSuccess?: (data: CredPalSuccessResponse) => void;
}

export interface CredPalSuccessResponse {
  order_no: string;
  item: string;
  amount: number;
  status: 'success' | 'pending';
  channel: string;
  customer: {
    full_name: string;
    email: string;
    phone_no: string;
  };
  created_at: string;
}

/** CredPal checkout is retired. Retain this API for saved checkout flows. */
export function getCredPalKey(): string {
  throw new Error('CredPal is unavailable');
}

export function openCredPalCheckout(
  _config: CredPalCheckoutConfig
): Promise<void> {
  return Promise.reject(new Error('CredPal is unavailable'));
}

/**
 * Check if an order amount is eligible for CredPal BNPL
 * CredPal typically has minimum and maximum limits
 */
export function isCredPalEligible(
  amount: number,
  minAmount: number = 10000, // ₦10,000 minimum
  maxAmount: number = 5000000 // ₦5,000,000 maximum
): boolean {
  return amount >= minAmount && amount <= maxAmount;
}

/**
 * Calculate estimated monthly payment for CredPal BNPL
 * This is an approximation - actual rates depend on CredPal's assessment
 */
export function estimateMonthlyPayment(
  amount: number,
  months: number = 3,
  interestRate: number = 0.05 // 5% monthly interest approximation
): number {
  const totalWithInterest = amount * (1 + interestRate * months);
  return Math.ceil(totalWithInterest / months);
}
