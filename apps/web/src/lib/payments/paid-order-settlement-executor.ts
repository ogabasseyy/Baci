import { z } from 'zod';
import type { StepExecutor } from '@/lib/payments/apply-paid-order-side-effects';
import { calculateJuicywayPlatformFee } from '@/lib/payments/juicyway-platform-fee';
import { loadGiglSettlementRetainedAmount } from '@/lib/payments/load-gigl-settlement-retained-amount';
import type {
  PaidOrderSideEffectTransaction,
  ServiceRoleClient,
} from '@/lib/payments/paid-order-side-effect-types';
import { toNumber } from '@/lib/payments/paid-order-side-effect-utils';
import { extractVerifiedGatewayFeeNgn } from '@/lib/payments/verified-gateway-fee';
import { calculatePlatformFee } from '@/lib/paystack';
import { moneyInputSchema } from '@/schemas/paid-order-side-effects';

const KOBO_PER_NAIRA = 100;

const settlementGrossAmountSchema = z.union([
  z.number().finite().nonnegative(),
  z
    .string()
    .regex(/^\+?\d+(?:\.\d+)?$/, {
      error: 'must be a valid non-negative settlement amount',
    })
    .transform(Number)
    .pipe(z.number().finite().nonnegative()),
]);

const settlementArgsSchema = z.object({
  allocatedGatewayFeeNgn: z.number().finite().min(0).optional(),
  externalGatewayReference: z.string().trim().min(1),
  settlementGateway: z.enum(['juicyway', 'korapay', 'paystack']),
  supabase: z.custom<ServiceRoleClient>(
    (value) =>
      value !== null &&
      typeof value === 'object' &&
      typeof (value as { rpc?: unknown }).rpc === 'function'
  ),
  transaction: z.looseObject({
    amount: settlementGrossAmountSchema,
    gateway_reference: z.string().nullable().optional(),
    merchant_id: z.string().trim().min(1),
    order_id: z.string().trim().min(1),
    platform_fee: moneyInputSchema.nullish(),
  }),
  orderShippingProvider: z.string().trim().nullish().optional(),
  orderShippingFundingSource: z
    .enum(['customer_checkout', 'merchant_wallet'])
    .nullable()
    .optional(),
  orderShippingRetainedAmount: moneyInputSchema.nullish().optional(),
});

function throwSettlementRpcError(error: unknown): never {
  if (error instanceof Error) {
    throw error;
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const wrapped = new Error((error as { message: string }).message);
    Object.assign(wrapped, { cause: error });
    throw wrapped;
  }
  throw new Error(String(error));
}

export function buildSettlementExecutor(args: {
  allocatedGatewayFeeNgn?: number;
  externalGatewayReference: string;
  settlementGateway: 'juicyway' | 'korapay' | 'paystack';
  supabase: ServiceRoleClient;
  transaction: PaidOrderSideEffectTransaction;
  orderShippingProvider?: string | null;
  orderShippingFundingSource?: 'customer_checkout' | 'merchant_wallet' | null;
  orderShippingRetainedAmount?: number | string | null;
}): StepExecutor {
  const parsedArgs = settlementArgsSchema.safeParse(args);
  if (!parsedArgs.success) {
    throw new Error(
      `invalid_settlement_executor_args: ${JSON.stringify(z.flattenError(parsedArgs.error))}`
    );
  }
  const validatedArgs = parsedArgs.data;

  return async (ctx) => {
    const grossAmount = toNumber(
      validatedArgs.transaction.amount,
      'transaction amount'
    );
    if (grossAmount <= 0) {
      throw new Error('Settlement amount must be positive');
    }
    const gatewayFee =
      validatedArgs.settlementGateway === 'juicyway'
        ? 0
        : (validatedArgs.allocatedGatewayFeeNgn ??
          extractVerifiedGatewayFeeNgn(
            validatedArgs.settlementGateway,
            ctx.gatewayResponse
          ));
    if (!Number.isFinite(gatewayFee) || gatewayFee < 0) {
      throw new Error('Invalid gateway fee');
    }

    const unroundedGrossAmountKobo = grossAmount * KOBO_PER_NAIRA;
    const grossAmountKobo = Math.round(unroundedGrossAmountKobo);
    const gatewayFeeKobo = Math.round(gatewayFee * KOBO_PER_NAIRA);
    const platformFeeKobo =
      validatedArgs.transaction.platform_fee == null
        ? validatedArgs.settlementGateway === 'juicyway'
          ? Math.round(
              calculateJuicywayPlatformFee(grossAmount) * KOBO_PER_NAIRA
            )
          : Math.round(
              calculatePlatformFee(unroundedGrossAmountKobo).platformFee
            )
        : Math.round(
            toNumber(
              validatedArgs.transaction.platform_fee,
              'transaction platform fee'
            ) * KOBO_PER_NAIRA
          );
    if (!Number.isFinite(platformFeeKobo) || platformFeeKobo < 0) {
      throw new Error('Invalid platform fee');
    }
    if (gatewayFeeKobo + platformFeeKobo > grossAmountKobo) {
      throw new Error(
        `Settlement fees exceed gross amount: gatewayFee=${gatewayFeeKobo / KOBO_PER_NAIRA}, platformFee=${platformFeeKobo / KOBO_PER_NAIRA}, grossAmount=${grossAmountKobo / KOBO_PER_NAIRA}`
      );
    }

    const normalizedGrossAmount = grossAmountKobo / KOBO_PER_NAIRA;
    const normalizedGatewayFee = gatewayFeeKobo / KOBO_PER_NAIRA;
    const platformFee = platformFeeKobo / KOBO_PER_NAIRA;
    const hasEconomicsSnapshot =
      validatedArgs.orderShippingFundingSource != null;
    if (
      !hasEconomicsSnapshot &&
      validatedArgs.orderShippingRetainedAmount != null &&
      toNumber(
        validatedArgs.orderShippingRetainedAmount,
        'retained shipping amount'
      ) > 0
    ) {
      throw new Error(
        'Invalid retained shipping snapshot: funding source is required for a positive retained amount'
      );
    }
    const requestedRetainedShippingAmount =
      validatedArgs.orderShippingFundingSource === 'customer_checkout'
        ? toNumber(
            validatedArgs.orderShippingRetainedAmount ?? 0,
            'retained shipping amount'
          )
        : 0;
    const useGiglSettlementRpc =
      hasEconomicsSnapshot && validatedArgs.orderShippingProvider === 'GIGL';
    // GIGL retention is recomputed inside record_merchant_settlement_gigl_v1 from
    // the order snapshot and may span wallet/store-credit payments beyond this
    // gateway transfer. Legacy providers still validate caller-supplied retention
    // against this transfer's verified gross.
    const retainedShippingAmount = requestedRetainedShippingAmount;
    if (
      !Number.isFinite(retainedShippingAmount) ||
      retainedShippingAmount < 0
    ) {
      throw new Error('Invalid retained shipping amount');
    }
    const totalPlatformFee = platformFee + retainedShippingAmount;
    const validatedPlatformFee = useGiglSettlementRpc
      ? platformFee
      : totalPlatformFee;
    const validatedPlatformFeeKobo = Math.round(
      validatedPlatformFee * KOBO_PER_NAIRA
    );
    if (gatewayFeeKobo + validatedPlatformFeeKobo > grossAmountKobo) {
      throw new Error(
        `Settlement fees exceed gross amount: gatewayFee=${normalizedGatewayFee}, platformFee=${validatedPlatformFee}, grossAmount=${normalizedGrossAmount}`
      );
    }
    const metadata = {
      [`${validatedArgs.settlementGateway}_reference`]:
        validatedArgs.externalGatewayReference,
      verified_gateway_fee: normalizedGatewayFee,
      ...(hasEconomicsSnapshot
        ? {
            commerce_platform_fee: platformFee,
            retained_shipping_amount: retainedShippingAmount,
          }
        : {}),
    };

    const settlementRpc = useGiglSettlementRpc
      ? 'record_merchant_settlement_gigl_v1'
      : 'record_merchant_settlement';
    const { error } = await validatedArgs.supabase.rpc(settlementRpc, {
      p_description: `Order payment via ${validatedArgs.settlementGateway}`,
      p_gateway: validatedArgs.settlementGateway,
      p_gateway_fee: normalizedGatewayFee,
      p_gateway_reference: validatedArgs.externalGatewayReference,
      p_gross_amount: normalizedGrossAmount,
      p_merchant_id: validatedArgs.transaction.merchant_id,
      p_metadata: metadata,
      // The GIGL wrapper recomputes retained shipping from the selected
      // quote inside the settlement boundary; never pass the application
      // snapshot as an authoritative debit amount. Legacy providers keep
      // their existing caller-supplied retention behavior.
      p_platform_fee: useGiglSettlementRpc ? platformFee : totalPlatformFee,
      p_source_id: validatedArgs.transaction.order_id,
      p_source_type: 'order',
    });
    if (error) throwSettlementRpcError(error);
    const reportedRetainedShippingAmount = useGiglSettlementRpc
      ? await loadGiglSettlementRetainedAmount(validatedArgs.supabase, {
          gateway: validatedArgs.settlementGateway,
          gatewayReference: validatedArgs.externalGatewayReference,
          sourceId: validatedArgs.transaction.order_id,
          sourceType: 'order',
        })
      : retainedShippingAmount;
    return {
      gateway_fee: normalizedGatewayFee,
      gross_amount: normalizedGrossAmount,
      platform_fee: platformFee,
      ...(hasEconomicsSnapshot
        ? {
            commerce_platform_fee: platformFee,
            retained_shipping_amount: reportedRetainedShippingAmount,
          }
        : {}),
    };
  };
}
