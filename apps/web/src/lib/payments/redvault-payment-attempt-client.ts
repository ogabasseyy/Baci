import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { createScopedClient } from '@/lib/supabase/scoped';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';

const REDVAULT_ATTEMPT_CONTEXT_TTL_SECONDS = 5 * 60;

export type RedvaultReservedAttempt = {
  amountKobo: number;
  authorizationUrl: string | null;
  bankCode: string;
  id: string;
  reference: string;
  state: 'created' | 'initializing' | 'initialized' | 'indeterminate';
};

type RedvaultAttemptRpcClient = Pick<SupabaseClient, 'rpc'>;

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object'
    ? (row as Record<string, unknown>)
    : null;
}

function parseReservedAttempt(value: unknown): RedvaultReservedAttempt | null {
  const row = firstRow(value);
  if (
    !row ||
    typeof row.attempt_id !== 'string' ||
    typeof row.reference !== 'string' ||
    typeof row.amount_kobo !== 'number' ||
    !Number.isSafeInteger(row.amount_kobo) ||
    row.amount_kobo <= 0 ||
    typeof row.bank_code !== 'string' ||
    !/^\d{3}$/.test(row.bank_code) ||
    (row.state !== 'created' &&
      row.state !== 'initializing' &&
      row.state !== 'initialized' &&
      row.state !== 'indeterminate') ||
    (row.authorization_url !== null &&
      typeof row.authorization_url !== 'string')
  ) {
    return null;
  }

  return {
    amountKobo: row.amount_kobo,
    authorizationUrl: row.authorization_url,
    bankCode: row.bank_code,
    id: row.attempt_id,
    reference: row.reference,
    state: row.state,
  };
}

function createRedvaultAttemptContextClient({
  customerEmail,
  fallbackClient,
  merchantId,
  userId,
  now = new Date(),
}: {
  customerEmail: string;
  fallbackClient: RedvaultAttemptRpcClient;
  merchantId: string;
  userId: string | null;
  now?: Date;
}): RedvaultAttemptRpcClient {
  if (merchantId !== OGABASSEY_MERCHANT_ID) {
    throw new Error('REDVAULT is exclusive to Ogabassey');
  }
  try {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const payload: Record<string, unknown> = {
      aud: 'authenticated',
      exp: issuedAt + REDVAULT_ATTEMPT_CONTEXT_TTL_SECONDS,
      iat: issuedAt,
      role: 'authenticated',
      storefront_order_context: 'route',
      storefront_order_merchant_id: merchantId.trim(),
      storefront_redvault_customer_email: customerEmail.trim().toLowerCase(),
    };
    if (userId) payload.sub = userId;
    return createScopedClient(signScopedSupabaseJwt(payload));
  } catch {
    if (process.env.NODE_ENV === 'test') return fallbackClient;
    throw new Error('Unable to establish REDVAULT customer payment context');
  }
}

export function createRedvaultPaymentAttemptClient({
  customerEmail,
  fallbackClient,
  merchantId,
  userId,
}: {
  customerEmail: string;
  fallbackClient: RedvaultAttemptRpcClient;
  merchantId: string;
  userId: string | null;
}) {
  const client = createRedvaultAttemptContextClient({
    customerEmail,
    fallbackClient,
    merchantId,
    userId,
  });

  return {
    async claimInitialization(attemptId: string): Promise<{
      attempt: RedvaultReservedAttempt;
      claimed: boolean;
    }> {
      const { data, error } = await client.rpc(
        'claim_storefront_redvault_payment_attempt_initialization' as never,
        { p_attempt_id: attemptId } as never
      );
      const row = firstRow(data);
      const attempt = parseReservedAttempt(data);
      if (
        error ||
        !attempt ||
        !row ||
        typeof row.initialization_claimed !== 'boolean'
      ) {
        throw new Error(error?.message ?? 'Unable to claim REDVAULT checkout');
      }
      return { attempt, claimed: row.initialization_claimed };
    },
    async markIndeterminate(attemptId: string): Promise<void> {
      const { error } = await client.rpc(
        'record_storefront_redvault_payment_attempt_initialization' as never,
        {
          p_attempt_id: attemptId,
          p_authorization_url: null,
          p_state: 'indeterminate',
        } as never
      );
      if (error) throw new Error(error.message);
    },
    async markInitialized(
      attemptId: string,
      authorizationUrl: string
    ): Promise<RedvaultReservedAttempt> {
      const { data, error } = await client.rpc(
        'record_storefront_redvault_payment_attempt_initialization' as never,
        {
          p_attempt_id: attemptId,
          p_authorization_url: authorizationUrl,
          p_state: 'initialized',
        } as never
      );
      const attempt = parseReservedAttempt(data);
      if (error || !attempt) {
        throw new Error(
          error?.message ?? 'Unable to persist REDVAULT checkout'
        );
      }
      return attempt;
    },
    async reserve(orderId: string): Promise<RedvaultReservedAttempt> {
      const { data, error } = await client.rpc(
        'reserve_storefront_redvault_payment_attempt' as never,
        { p_order_id: orderId } as never
      );
      const attempt = parseReservedAttempt(data);
      if (error || !attempt) {
        throw new Error(
          error?.message ?? 'Unable to reserve REDVAULT checkout'
        );
      }
      return attempt;
    },
  };
}
