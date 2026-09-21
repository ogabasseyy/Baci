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
  paystackSubaccount: string;
  platformFeeKobo: number;
  reference: string;
  splitRetainedShippingKobo: number;
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
    typeof row.paystack_subaccount_code !== 'string' ||
    !row.paystack_subaccount_code.trim() ||
    typeof row.platform_fee_kobo !== 'number' ||
    !Number.isSafeInteger(row.platform_fee_kobo) ||
    row.platform_fee_kobo < 0 ||
    row.platform_fee_kobo > row.amount_kobo ||
    (row.state !== 'created' &&
      row.state !== 'initializing' &&
      row.state !== 'initialized' &&
      row.state !== 'indeterminate') ||
    (row.authorization_url !== null &&
      typeof row.authorization_url !== 'string')
  ) {
    return null;
  }

  // Only the claim RPCs carry the frozen split retention; reserve/record
  // rows predate the column and never feed the provider split, so a
  // missing value degrades to zero instead of failing the parse.
  const splitRetained = row.split_retained_shipping_kobo;
  if (
    splitRetained !== undefined &&
    splitRetained !== null &&
    (typeof splitRetained !== 'number' ||
      !Number.isSafeInteger(splitRetained) ||
      splitRetained < 0 ||
      splitRetained > row.amount_kobo)
  ) {
    return null;
  }

  return {
    amountKobo: row.amount_kobo,
    authorizationUrl: row.authorization_url,
    bankCode: row.bank_code,
    id: row.attempt_id,
    paystackSubaccount: row.paystack_subaccount_code,
    platformFeeKobo: row.platform_fee_kobo,
    reference: row.reference,
    splitRetainedShippingKobo:
      typeof splitRetained === 'number' ? splitRetained : 0,
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
        'claim_storefront_redvault_payment_attempt_initialization_v3' as never,
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
        'record_storefront_redvault_payment_attempt_initialization_v2' as never,
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
        'record_storefront_redvault_payment_attempt_initialization_v2' as never,
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
    async reconcileInitialization(
      attemptId: string,
      state: 'indeterminate' | 'void'
    ): Promise<void> {
      // Recovery runs inside the customer's scoped route context: the RPC
      // rebinds the attempt to the JWT customer, so checkout never mints a
      // service-role client to reconcile its own ambiguous claim.
      const { error } = await client.rpc(
        'reconcile_storefront_redvault_payment_attempt_initialization' as never,
        {
          p_attempt_id: attemptId,
          p_authorization_url: null,
          p_state: state,
        } as never
      );
      if (error) throw new Error(error.message);
    },
    async reserve(orderId: string): Promise<RedvaultReservedAttempt> {
      const { data, error } = await client.rpc(
        'reserve_storefront_redvault_payment_attempt_v3' as never,
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
