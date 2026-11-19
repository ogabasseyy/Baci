/**
 * Database access contract for push delivery. The admin implementation lives
 * in `push-store-admin.ts`; restricted workers supply their own store, so the
 * delivery core never needs a service-role client.
 */
export interface PushStoreError {
  message: string;
}

export interface PushTokenRow {
  token: string;
  platform: string;
}

export interface PushTokenFetchResult {
  data: PushTokenRow[] | null;
  error: PushStoreError | null;
}

export interface PushTicketRow {
  ticket_id: string;
  push_token: string;
  merchant_id: string | null;
  user_id: string | null;
  app_type: string;
  channel: string | null;
  notification_type: string | null;
  status: 'pending';
}

export interface PushAttemptRow {
  merchant_id: string | null;
  user_id: string | null;
  app_type: string;
  channel: string | null;
  notification_type: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  token_count: number;
  sent_count: number;
  failed_count: number;
  status: 'sent' | 'partial_failure' | 'failed' | 'skipped_no_tokens';
  errors: string[];
}

export interface PushStore {
  fetchMerchantTokens(args: {
    merchantId: string;
    recipientUserIds?: string[];
    requiredCapability?: number;
  }): PromiseLike<PushTokenFetchResult>;
  fetchCustomerTokens(args: {
    userId: string;
    merchantId?: string;
    requiredCapability?: number;
  }): PromiseLike<PushTokenFetchResult>;
  deactivateTokens(
    reason: string,
    tokens: string[]
  ): PromiseLike<{ error: PushStoreError | null }>;
  insertTickets(
    rows: PushTicketRow[]
  ): PromiseLike<{ error: PushStoreError | null }>;
  insertAttempt(
    row: PushAttemptRow
  ): PromiseLike<{ error: PushStoreError | null }>;
}
