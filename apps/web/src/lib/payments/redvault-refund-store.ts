import type { RedvaultRefundRequest } from '@/schemas/redvault-refund-request';

export type RedvaultRefundState =
  | 'pending'
  | 'processing'
  | 'failed'
  | 'processed';

export type RedvaultRefund = {
  amountKobo: number;
  attemptReference: string;
  id: string;
  providerReference: string | null;
  providerStatus: string | null;
  state: RedvaultRefundState;
};

export type RedvaultRefundReconciliationClaim = {
  reconciliationClaimToken: string;
  refund: RedvaultRefund;
};

export interface RedvaultRefundRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

function readRefund(value: unknown): RedvaultRefund {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('REDVAULT refund RPC returned no refund row');
  }
  const row = value as Record<string, unknown>;
  const amountKobo = row.amount_kobo;
  if (
    typeof row.id !== 'string' ||
    typeof row.attempt_reference !== 'string' ||
    typeof amountKobo !== 'number' ||
    !Number.isSafeInteger(amountKobo) ||
    amountKobo <= 0 ||
    !['pending', 'processing', 'failed', 'processed'].includes(
      String(row.state)
    )
  ) {
    throw new Error('REDVAULT refund RPC returned an invalid refund row');
  }
  return {
    amountKobo,
    attemptReference: row.attempt_reference,
    id: row.id,
    providerReference:
      typeof row.provider_reference === 'string'
        ? row.provider_reference
        : null,
    providerStatus:
      typeof row.provider_status === 'string' ? row.provider_status : null,
    state: row.state as RedvaultRefundState,
  };
}

function readSingleRefund(data: unknown): RedvaultRefund {
  return readRefund(Array.isArray(data) ? data[0] : data);
}

export class RedvaultRefundStore {
  constructor(private readonly client: RedvaultRefundRpcClient) {}

  async reserve(request: RedvaultRefundRequest): Promise<RedvaultRefund> {
    const result = await this.client.rpc('reserve_uba_redvault_refund', {
      p_attempt_id: request.attemptId,
      p_idempotency_key: request.idempotencyKey,
      p_merchant_id: request.merchantId,
      p_type: request.type,
      p_units: request.units ?? null,
    });
    if (result.error)
      throw new Error(
        `Unable to reserve REDVAULT refund: ${result.error.message}`
      );
    return readSingleRefund(result.data);
  }

  async claimNext(): Promise<RedvaultRefund | null> {
    const result = await this.client.rpc('claim_next_uba_redvault_refund', {});
    if (result.error)
      throw new Error(
        `Unable to claim REDVAULT refund: ${result.error.message}`
      );
    if (
      result.data === null ||
      (Array.isArray(result.data) && result.data.length === 0)
    )
      return null;
    return readSingleRefund(result.data);
  }

  async finish(input: {
    id: string;
    outcome: 'failed' | 'processed';
    providerReference?: string;
    providerStatus?: string;
  }): Promise<RedvaultRefund> {
    const result = await this.client.rpc('finish_uba_redvault_refund', {
      p_outcome: input.outcome,
      p_provider_reference: input.providerReference ?? null,
      p_provider_status: input.providerStatus ?? null,
      p_refund_id: input.id,
    });
    if (result.error)
      throw new Error(
        `Unable to finish REDVAULT refund: ${result.error.message}`
      );
    return readSingleRefund(result.data);
  }

  async recordProviderSubmission(input: {
    id: string;
    providerReference: string;
    providerStatus: string;
  }): Promise<RedvaultRefund> {
    const result = await this.client.rpc(
      'record_uba_redvault_refund_provider_submission',
      {
        p_provider_reference: input.providerReference,
        p_provider_status: input.providerStatus,
        p_refund_id: input.id,
      }
    );
    if (result.error)
      throw new Error(
        `Unable to persist REDVAULT refund provider submission: ${result.error.message}`
      );
    return readSingleRefund(result.data);
  }

  async claimNextReconciliation(): Promise<RedvaultRefundReconciliationClaim | null> {
    const result = await this.client.rpc(
      'claim_next_uba_redvault_refund_reconciliation',
      {}
    );
    if (result.error)
      throw new Error(
        `Unable to claim REDVAULT refund reconciliation: ${result.error.message}`
      );
    if (
      result.data === null ||
      (Array.isArray(result.data) && result.data.length === 0)
    )
      return null;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    const refund = readRefund(row);
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      typeof (row as Record<string, unknown>).reconciliation_claim_token !==
        'string' ||
      !refund.providerReference
    ) {
      throw new Error('REDVAULT reconciliation RPC returned an invalid claim');
    }
    return {
      reconciliationClaimToken: (row as Record<string, string>)
        .reconciliation_claim_token,
      refund,
    };
  }

  async reconcile(input: {
    id: string;
    providerStatus: string;
    reconciliationClaimToken: string;
  }): Promise<RedvaultRefund> {
    const result = await this.client.rpc('reconcile_uba_redvault_refund', {
      p_provider_status: input.providerStatus,
      p_reconciliation_claim_token: input.reconciliationClaimToken,
      p_refund_id: input.id,
    });
    if (result.error)
      throw new Error(
        `Unable to reconcile REDVAULT refund: ${result.error.message}`
      );
    return readSingleRefund(result.data);
  }
}
