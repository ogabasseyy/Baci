export interface RefundSummary {
  currency: string;
  amountPaid: number;
  refunded: number;
  remaining: number;
  pending: number;
  reversedInternal?: number;
  status:
    | 'refunded'
    | 'processing'
    | 'requires_review'
    | 'queued'
    | 'failed'
    | 'not_started';
  // Fixed display label mapped at the API boundary, never raw
  // worker/provider text: the route maps the RPC's strings before
  // responding so provider internals stay server-side.
  error: string | null;
  // The requires-review guidance branches on this instead of sniffing
  // the (now mapped) error text for a provider mention.
  needsPaystackCheck: boolean;
  attempts: number;
  retryRequests: number;
  canRetry: boolean;
  canRecordManual: boolean;
  canManageRefunds: boolean;
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
  // Pin candidates for Paystack attestations: completed external
  // payment legs with money still outstanding, oldest first. The
  // manual form offers them when more than one exists; the RPC
  // resolves a sole leg itself on live data (fresher than polling).
  legs: Array<{
    id: string;
    amount: number;
    outstanding: number;
    gateway: string | null;
    reference: string | null;
  }>;
}
