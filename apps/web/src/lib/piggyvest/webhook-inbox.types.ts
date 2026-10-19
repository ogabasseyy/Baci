export type PiggyvestInboxEnqueueResult = 'accepted' | 'duplicate' | 'conflict';

export interface PiggyvestWebhookInbox {
  enqueue(input: {
    integrationId: string;
    eventId: string;
    rawPayload: Uint8Array;
  }): Promise<PiggyvestInboxEnqueueResult>;
}

export type PiggyvestWebhookIntakeOutcome =
  | PiggyvestInboxEnqueueResult
  | 'not_ready'
  | 'invalid_signature'
  | 'invalid_payload'
  | 'payload_too_large'
  | 'request_unavailable'
  | 'storage_unavailable';
