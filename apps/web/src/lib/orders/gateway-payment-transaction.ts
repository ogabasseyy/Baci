export interface GatewayPaymentTransaction {
  amount: number;
  currency: string | null;
  gateway: string | null;
  gateway_reference: string | null;
  id: string;
  status?: string;
}
