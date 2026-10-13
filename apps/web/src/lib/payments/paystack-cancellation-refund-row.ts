export interface RefundRow {
  id: string;
  order_id: string | null;
  merchant_id: string;
  // Only selected by scans that normalize the gateway per row; other
  // producers leave it unset.
  gateway?: string | null;
  gateway_reference: string | null;
  amount: number;
  currency: string;
  metadata: Record<string, unknown> | null;
  status: string;
}
