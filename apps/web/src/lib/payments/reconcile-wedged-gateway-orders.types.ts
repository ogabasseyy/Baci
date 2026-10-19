export interface WedgedOrderSweepSummary {
  checked: number;
  healed: Array<{ orderId: string; orderNumber: string | null }>;
  detectedUnhealable: Array<{ transactionId: string; gateway: string }>;
  reviewsFiled: Array<{ transactionId: string; orderId: string }>;
  skipped: Array<{ transactionId: string; reason: string }>;
  failed: Array<{ transactionId: string; reason: string }>;
}

export interface WedgedCandidate {
  id: string;
  created_at: string;
  order_id: string;
  merchant_id: string;
  amount: number | string | null;
  currency: string | null;
  platform_fee: number | null;
  gateway: string;
  gateway_reference: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
}
