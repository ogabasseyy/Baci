import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCustomerWalletPaymentAccount } from '@/lib/customer-wallet-payment-accounts';
import type {
  OrderWalletFundingIntent,
  OrderWalletFundingIntentRepository,
  OrderWalletFundingIntentStatus,
} from '@/lib/order-wallet-funding-intent-types';
import { INTENT_TTL_MS, roundMoney } from '@/lib/order-wallet-funding-utils';

const INTENT_SELECT =
  'id, merchant_id, customer_id, order_id, wallet_payment_account_id, provider, expected_amount, target_order_amount, wallet_balance_snapshot, funded_amount, debited_amount, excess_amount, currency, status, idempotency_key, last_gateway_reference, last_transaction_id, expires_at, created_at';
const ORDER_SELECT =
  'id, merchant_id, customer_id, total, currency, payment_status';
const RETRYABLE_TERMINAL_STATUSES = ['expired', 'cancelled', 'failed'];
// Supabase .not() passes raw PostgREST values through; in-lists must be strings.
const RETRYABLE_TERMINAL_STATUS_FILTER = `(${RETRYABLE_TERMINAL_STATUSES.map((status) => `"${status}"`).join(',')})`;
const ORDER_WALLET_FUNDING_INTENT_STATUSES: ReadonlySet<OrderWalletFundingIntentStatus> =
  new Set([
    'pending',
    'underfunded',
    'funded',
    'processing',
    'completed',
    'expired',
    'cancelled',
    'review_required',
    'failed',
  ]);

type SupabaseError = { message?: string };

function parseMoney(value: unknown, label: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error(`Invalid ${label}`);
  return roundMoney(amount);
}

function parseIntentStatus(value: unknown) {
  if (
    typeof value === 'string' &&
    ORDER_WALLET_FUNDING_INTENT_STATUSES.has(
      value as OrderWalletFundingIntentStatus
    )
  ) {
    return value as OrderWalletFundingIntentStatus;
  }
  throw new Error(`Unsupported wallet funding status: ${String(value)}`);
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function normalizeIntent(
  row: Record<string, unknown>
): OrderWalletFundingIntent {
  if (typeof row.provider !== 'string' || row.provider.length === 0) {
    throw new Error('Missing wallet funding provider');
  }
  if (row.provider !== 'paystack') {
    throw new Error(`Unsupported wallet funding provider: ${row.provider}`);
  }

  return {
    createdAt: String(row.created_at),
    currency: String(row.currency ?? 'NGN'),
    customerId: String(row.customer_id),
    debitedAmount: parseMoney(row.debited_amount, 'intent debited amount'),
    excessAmount: parseMoney(row.excess_amount, 'intent excess amount'),
    expectedAmount: parseMoney(row.expected_amount, 'intent expected amount'),
    expiresAt: String(row.expires_at),
    fundedAmount: parseMoney(row.funded_amount, 'intent funded amount'),
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    lastGatewayReference: optionalString(row.last_gateway_reference),
    lastTransactionId: optionalString(row.last_transaction_id),
    merchantId: String(row.merchant_id),
    orderId: String(row.order_id),
    provider: row.provider,
    status: parseIntentStatus(row.status),
    targetOrderAmount: parseMoney(
      row.target_order_amount,
      'intent target amount'
    ),
    walletBalanceSnapshot: parseMoney(
      row.wallet_balance_snapshot,
      'intent wallet balance snapshot'
    ),
    walletPaymentAccountId: String(row.wallet_payment_account_id),
  };
}

function getDataRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object'
    ? (row as Record<string, unknown>)
    : null;
}

function throwIfError(error: SupabaseError | null | undefined, label: string) {
  if (error)
    throw new Error(`${label}: ${error.message ?? 'Supabase query failed'}`);
}

function getIntentStartFromExpiresAt(expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return new Date().toISOString();
  return new Date(expiresAtMs - INTENT_TTL_MS).toISOString();
}

export function createOrderWalletFundingIntentRepository(
  supabase: SupabaseClient
): OrderWalletFundingIntentRepository {
  return {
    async expireStaleWalletFundingIntents(args) {
      const { error } = await supabase.rpc(
        'expire_order_wallet_funding_intents',
        {
          p_customer_id: args.customerId ?? null,
          p_merchant_id: args.merchantId ?? null,
          p_now: args.now.toISOString(),
          p_wallet_payment_account_id: args.walletPaymentAccountId ?? null,
        }
      );
      throwIfError(error, 'expire stale wallet funding intents failed');
    },
    async findActiveOrderIntent({ orderId }) {
      const { data, error } = await supabase
        .from('order_wallet_funding_intents')
        .select(INTENT_SELECT)
        .eq('order_id', orderId)
        .not('status', 'in', RETRYABLE_TERMINAL_STATUS_FILTER)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      throwIfError(error, 'active wallet funding intent lookup failed');
      const row = getDataRow(data);
      return row ? normalizeIntent(row) : null;
    },
    async findActiveWalletAccountIntents({ walletPaymentAccountId }) {
      const { data, error } = await supabase
        .from('order_wallet_funding_intents')
        .select(INTENT_SELECT)
        .eq('wallet_payment_account_id', walletPaymentAccountId)
        .in('status', ['pending', 'underfunded'])
        .order('created_at', { ascending: true });
      throwIfError(error, 'wallet funding intent lookup failed');
      return Array.isArray(data)
        ? data.map((row) => normalizeIntent(row as Record<string, unknown>))
        : [];
    },
    async findWalletAccountIntentByTransferReference({
      gatewayReference,
      walletPaymentAccountId,
    }) {
      // The payments ledger is the authoritative transfer→intent binding
      // (unique on (provider, gateway_reference)). A Paystack webhook retry
      // reuses the reference, so if a payment already exists we route the
      // replay back to its owning intent regardless of the intent's status.
      const { data: paymentData, error: paymentError } = await supabase
        .from('order_wallet_funding_intent_payments')
        .select('intent_id')
        .eq('provider', 'paystack')
        .eq('gateway_reference', gatewayReference)
        .limit(1)
        .maybeSingle();
      throwIfError(paymentError, 'wallet funding payment lookup failed');
      const paymentRow = getDataRow(paymentData);
      const intentId = paymentRow?.intent_id;
      if (typeof intentId !== 'string' || intentId.length === 0) {
        return null;
      }
      const { data, error } = await supabase
        .from('order_wallet_funding_intents')
        .select(INTENT_SELECT)
        .eq('id', intentId)
        .eq('wallet_payment_account_id', walletPaymentAccountId)
        .maybeSingle();
      throwIfError(error, 'wallet funding intent lookup failed');
      const row = getDataRow(data);
      return row ? normalizeIntent(row) : null;
    },
    async getOrderForCustomer({ customerId, merchantId, orderId }) {
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('id', orderId)
        .eq('merchant_id', merchantId)
        .eq('customer_id', customerId)
        .maybeSingle();
      throwIfError(error, 'order lookup failed');
      const row = getDataRow(data);
      if (!row) return null;
      return {
        currency: String(row.currency ?? 'NGN'),
        customerId: String(row.customer_id),
        id: String(row.id),
        merchantId: String(row.merchant_id),
        paymentStatus: String(row.payment_status),
        total: parseMoney(row.total, 'order total'),
      };
    },
    async getOrderWalletFundingIntent({ customerId, id, merchantId }) {
      const { data, error } = await supabase
        .from('order_wallet_funding_intents')
        .select(INTENT_SELECT)
        .eq('id', id)
        .eq('merchant_id', merchantId)
        .eq('customer_id', customerId)
        .maybeSingle();
      throwIfError(error, 'wallet funding intent poll lookup failed');
      const row = getDataRow(data);
      return row ? normalizeIntent(row) : null;
    },
    async getPaymentSettings(merchantId) {
      const { data, error } = await supabase
        .rpc('get_storefront_payment_settings', { p_merchant_id: merchantId })
        .maybeSingle();
      throwIfError(error, 'wallet funding settings lookup failed');
      const row = getDataRow(data) ?? {};
      return {
        paystackEnabled: row.paystack_enabled !== false,
        walletOrderAutoDebitEnabled:
          row.wallet_order_auto_debit_enabled === true,
        walletPaystackDvaEnabled: row.wallet_paystack_dva_enabled === true,
      };
    },
    async getSavingsRedeemedAmount(orderId) {
      const { data, error } = await supabase
        .from('customer_savings_redemptions')
        .select('amount')
        .eq('order_id', orderId);
      throwIfError(error, 'savings redemption lookup failed');
      return Array.isArray(data)
        ? data.reduce((sum, row) => {
            const amount =
              row && typeof row === 'object'
                ? (row as Record<string, unknown>).amount
                : 0;
            return sum + parseMoney(amount, 'savings redemption amount');
          }, 0)
        : 0;
    },
    async getWalletBalance({ customerId, merchantId }) {
      const { data, error } = await supabase
        .from('customer_wallets')
        .select('available_balance')
        .eq('customer_id', customerId)
        .eq('merchant_id', merchantId)
        .maybeSingle();
      throwIfError(error, 'customer wallet balance lookup failed');
      const row = getDataRow(data);
      return row ? parseMoney(row.available_balance, 'wallet balance') : 0;
    },
    async hasWalletOrderRedemption({ customerId, merchantId, orderId }) {
      const { data, error } = await supabase
        .from('customer_wallet_transactions')
        .select('id')
        .eq('customer_id', customerId)
        .eq('merchant_id', merchantId)
        .eq('source_type', 'order_redemption')
        .eq('source_id', orderId)
        .limit(1)
        .maybeSingle();
      throwIfError(error, 'wallet order redemption lookup failed');
      return Boolean(data);
    },
    async insertOrderWalletFundingIntent(payload) {
      const { data, error } = await supabase
        .rpc('create_order_wallet_funding_intent_for_customer', {
          p_customer_id: payload.customerId,
          p_merchant_id: payload.merchantId,
          p_now: getIntentStartFromExpiresAt(payload.expiresAt),
          p_order_id: payload.orderId,
          p_wallet_payment_account_id: payload.walletPaymentAccountId,
        })
        .single();
      throwIfError(error, 'wallet funding intent insert failed');
      const row = getDataRow(data);
      if (!row) throw new Error('wallet funding intent insert returned no row');
      return normalizeIntent(row);
    },
    async markWalletFundingIntentReviewRequired(args) {
      if (args.intentIds.length === 0) return;
      const { error } = await supabase.rpc(
        'mark_wallet_funding_intents_review_required',
        {
          p_gateway_reference: args.gatewayReference,
          p_intent_ids: args.intentIds,
          p_reason: args.reason,
        }
      );
      throwIfError(error, 'wallet funding intent review update failed');
    },
    resolveWalletPaymentAccount(args) {
      return resolveCustomerWalletPaymentAccount({ ...args, supabase });
    },
  };
}
