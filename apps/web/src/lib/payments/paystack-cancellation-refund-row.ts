export interface RefundRow {
  id: string;
  order_id: string | null;
  merchant_id: string;
  gateway_reference: string | null;
  amount: number;
  currency: string;
  metadata: Record<string, unknown> | null;
  status: string;
}
