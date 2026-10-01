type BuilderAiEvent =
  | 'builder_ai_candidate_created'
  | 'builder_ai_candidate_rejected'
  | 'builder_ai_edit_requested'
  | 'legacy_contract_used'
  | 'builder_ai_provider_fallback'
  | 'builder_ai_timeout';

interface BuilderAiEventMetadata {
  errorClass?: string;
  merchantId: string;
  operationCount?: number;
  provider?: string;
  requestId: string;
  userId: string;
  warningCount?: number;
}

export function logBuilderAiEvent(
  event: BuilderAiEvent,
  metadata: BuilderAiEventMetadata
): void {
  console.info('builder_ai_event', { event, ...metadata });
}
