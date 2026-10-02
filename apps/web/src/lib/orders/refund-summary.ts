export interface RefundSummary {
  currency: string;
  amountPaid: number;
  refunded: number;
  remaining: number;
  pending: number;
  status:
    | 'refunded'
    | 'processing'
    | 'requires_review'
    | 'queued'
    | 'failed'
    | 'not_started';
  error: string | null;
  attempts: number;
  retryRequests: number;
  canRetry: boolean;
  canRecordManual: boolean;
  events?: Array<{
    id: string;
    action: string;
    date: string;
    actor: string | null;
    details: {
      error?: string | null;
      previousError?: string | null;
      attempts?: number;
      amount?: number;
      reference?: string;
    };
  }>;
  history: Array<{
    id: string;
    amount: number;
    status: string;
    method: string;
    reference: string;
    date: string;
    recorded_by: string | null;
  }>;
}
