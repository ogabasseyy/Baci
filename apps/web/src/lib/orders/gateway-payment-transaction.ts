export interface GatewayPaymentTransaction {
  amount: number;
  currency: string | null;
  gateway: string | null;
  gateway_response?: unknown;
  gateway_reference: string | null;
  id: string;
  status?: string;
  refundAmountMinor?: number;
}
