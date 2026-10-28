export type SupabaseQuotaFailureReason =
  | 'configuration'
  | 'rpc_error'
  | 'timeout'
  | 'invalid_response'
  | 'invalid_expiry';

export class SupabaseQuotaCounterError extends Error {
  constructor(readonly reason: SupabaseQuotaFailureReason) {
    super('Cart quota counter unavailable');
    this.name = 'SupabaseQuotaCounterError';
  }
}
