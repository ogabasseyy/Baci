import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  formatPhoneNumber,
  generateRequestRef,
  isValidPhoneNumber,
  NetworkProvider,
} from '@/lib/kuda';
import { resolveKudaDataPlanForPurchase } from '@/lib/kuda-data-plans';
import { logger } from '@/lib/logger';
import {
  getCachedBillerProducts as getMonnifyBillerProducts,
  getCachedBillers as getMonnifyBillers,
  verifyBillCustomer as verifyMonnifyBillCustomer,
} from '@/lib/monnify-bills';
import { normalizeVtuNetworkProvider } from '@/lib/normalize-vtu-network-provider';
import {
  type CustomerRecord,
  resolveVtuCustomer,
} from './vtu-customer-resolution';

export { resolveVtuCustomer };

import { calculateCommerce } from '@/lib/supabase/client';
import {
  EMPTY_VTU_CHECKOUT_SETTINGS,
  getVtuCheckoutSettings,
  linkCheckoutCustomerByEmail,
  type VtuCheckoutSettings,
} from '@/lib/vtu-checkout-customer-rpcs';
import { MONNIFY_VALIDATION_FAILED_MESSAGE } from '@/lib/vtu-checkout-error-classifier';
import { resolveVtuProvider } from '@/lib/vtu-commission-rates';
import { buildVtuSubmissionMarkerEraMetadata } from '@/lib/vtu-flagged-recovery';
import { resolveVtuMerchant } from '@/lib/vtu-merchant-lookup';
import {
  type InsertedPreparedVtuTransaction,
  insertPreparedVtuTransactionDirect,
  insertPreparedVtuTransactionViaRpc,
  type VtuTransactionInsertPayload,
} from '@/lib/vtu-prepare-insert';
import { throwIfStrictVtuLookupError } from '@/lib/vtu-strict-lookups';
import type { Biller, BillerProduct } from '@/schemas/monnify-bills-schema';
import { COMMISSION_CATEGORY_MAP, type PurchaseInput } from '@/schemas/vtu';

export const VTU_TYPE_LABELS: Record<PurchaseInput['type'], string> = {
  airtime: 'Airtime',
  data: 'Data',
  electricity: 'Electricity',
  cable_tv: 'TV Subscription',
  betting: 'Betting Top-up',
};

type VtuProviderSource = 'kuda' | 'monnify';
type NormalizedVtuNetworkProvider = NonNullable<
  ReturnType<typeof normalizeVtuNetworkProvider>
>;

const MONNIFY_NETWORK_NORMALIZATION_RULES: Array<{
  patterns: RegExp[];
  provider: NormalizedVtuNetworkProvider;
}> = [
  {
    patterns: [/9MOBILE/, /ETISALAT/, /^T2$/],
    provider: NetworkProvider.MOBILE_9,
  },
  { patterns: [/AIRTEL/], provider: NetworkProvider.AIRTEL },
  { patterns: [/GLO/], provider: NetworkProvider.GLO },
  { patterns: [/MTN/], provider: NetworkProvider.MTN },
];

/**
 * Commission rate semantics:
 *   - Values in (0, 1] are treated as fractional percentages
 *     (0.5 -> 50%, 1.0 -> 100%).
 *   - Integer values >1 (and <=100) are treated as direct percentages
 *     (50 -> 50%).
 *   - A literal value of 1 is therefore 100%, NOT 1%. If a merchant intends
 *     "1 = 1%", the row must be migrated to 0.01 before deploy.
 *
 * Audit before deploy (psql):
 *   SELECT id, merchant_id, vtu_merchant_commission_rate
 *   FROM public.merchant_feature_settings
 *   WHERE vtu_merchant_commission_rate = 1;
 *
 * If any merchant intends "1 = 1%", migrate that row to 0.01 before
 * deploying this change.
 */
function normalizeCommissionPercentage(value: number | null | undefined) {
  if (value == null) {
    return 50;
  }

  if (value < 0 || value > 100) {
    throw new Error('Invalid VTU merchant commission rate');
  }

  // Values in (0, 1] are fractional (0.5 -> 50%, 1.0 -> 100%); integer
  // values >1 are direct percentages.
  if (value > 0 && value <= 1) {
    return value * 100;
  }

  return value;
}

function firstTrimmed(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean);
}

function normalizeMonnifyNetworkCandidate(value: string | undefined) {
  const normalizedProvider = value ? normalizeVtuNetworkProvider(value) : null;
  if (normalizedProvider) {
    return normalizedProvider;
  }

  const compactValue = value
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!compactValue) {
    return null;
  }

  const matchingRule = MONNIFY_NETWORK_NORMALIZATION_RULES.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(compactValue))
  );
  if (matchingRule) {
    return matchingRule.provider;
  }

  return null;
}

function monnifyCandidateMatchesNetwork(
  normalizedNetworkProvider: string,
  ...values: Array<string | undefined>
) {
  return values.some(
    (value) =>
      normalizeMonnifyNetworkCandidate(value) === normalizedNetworkProvider
  );
}

interface MonnifyTelcoCheckoutFields {
  billerCode: string;
  customerIdentifier: string;
  customerName?: string;
  productCode: string;
  requireValidationRef?: boolean;
  validationReference?: string;
}

interface MonnifyValidationFields {
  customerName?: string;
  address?: string;
  requireValidationRef?: boolean;
  validationReference?: string;
}

function validateMonnifyProductAmount({
  amount,
  billerName,
  product,
}: {
  amount: number;
  billerName?: string;
  product: BillerProduct;
}) {
  const productLabel = billerName || product.name || product.productCode;
  if (product.isAmountFixed === true && product.amount != null) {
    if (amount !== product.amount) {
      throw new Error(
        `Amount for ${productLabel} must be exactly ${product.amount}`
      );
    }
    return;
  }

  if (product.minAmount != null && amount < product.minAmount) {
    throw new Error(
      `Minimum amount for ${productLabel} is ${product.minAmount}`
    );
  }

  if (product.maxAmount != null && amount > product.maxAmount) {
    throw new Error(
      `Maximum amount for ${productLabel} is ${product.maxAmount}`
    );
  }
}

async function validateMonnifyBillPaymentBeforeCharge({
  amount,
  billerCode,
  billerName,
  customerIdentifier,
  productCode,
  validationReference,
}: {
  amount: number;
  billerCode: string;
  billerName?: string;
  customerIdentifier: string;
  productCode: string;
  validationReference?: string;
}): Promise<MonnifyValidationFields | null> {
  const products = await getMonnifyBillerProducts(billerCode);
  const product = products.find(
    (candidate) => candidate.productCode === productCode
  );
  if (!product) {
    throw new Error(`Monnify product not found for ${billerCode}`);
  }

  validateMonnifyProductAmount({ amount, billerName, product });

  if (validationReference) {
    return null;
  }

  const verification = await verifyMonnifyBillCustomer(
    billerCode,
    productCode,
    customerIdentifier
  );

  if (!verification.verified) {
    // Fixed copy only: verification.message is the provider body and
    // must never reach the response (Codex R90 P1).
    throw new Error(MONNIFY_VALIDATION_FAILED_MESSAGE);
  }

  if (verification.requireValidationRef && !verification.validationReference) {
    throw new Error('Monnify validation reference is required but missing');
  }

  return {
    customerName: verification.customerName,
    address: verification.address,
    requireValidationRef: verification.requireValidationRef,
    validationReference: verification.validationReference,
  };
}

function isMatchingMonnifyAirtimeProduct(
  product: BillerProduct,
  normalizedNetworkProvider: string,
  billerCode: string
) {
  const productMatchesBiller =
    !product.billerCode ||
    product.billerCode === billerCode ||
    monnifyCandidateMatchesNetwork(
      normalizedNetworkProvider,
      product.billerCode,
      product.name
    );

  return (
    (!product.categoryCode || product.categoryCode === 'AIRTIME') &&
    productMatchesBiller
  );
}

function isMatchingMonnifyAirtimeBiller(
  biller: Biller,
  normalizedNetworkProvider: string
) {
  return (
    biller.categoryCodes.includes('AIRTIME') &&
    monnifyCandidateMatchesNetwork(
      normalizedNetworkProvider,
      biller.billerCode,
      biller.name,
      biller.description
    )
  );
}

async function resolveMonnifyAirtimeCheckoutFields({
  amount,
  formattedPhone,
  normalizedNetworkProvider,
}: {
  amount: number;
  formattedPhone: string;
  normalizedNetworkProvider: string;
}): Promise<MonnifyTelcoCheckoutFields> {
  const billers = await getMonnifyBillers('AIRTIME');
  const biller = billers.find((candidate) =>
    isMatchingMonnifyAirtimeBiller(candidate, normalizedNetworkProvider)
  );

  if (!biller) {
    throw new Error(
      `Monnify airtime biller not found for ${normalizedNetworkProvider}`
    );
  }

  const products = await getMonnifyBillerProducts(biller.billerCode);
  const product = products.find((candidate) =>
    isMatchingMonnifyAirtimeProduct(
      candidate,
      normalizedNetworkProvider,
      biller.billerCode
    )
  );

  if (!product) {
    throw new Error(
      `Monnify airtime product not found for ${normalizedNetworkProvider}`
    );
  }

  validateMonnifyProductAmount({
    amount,
    billerName: normalizedNetworkProvider,
    product,
  });

  const verification = await verifyMonnifyBillCustomer(
    biller.billerCode,
    product.productCode,
    formattedPhone
  );

  if (!verification.verified) {
    // Fixed copy only: verification.message is the provider body and
    // must never reach the response (Codex R90 P1).
    throw new Error(MONNIFY_VALIDATION_FAILED_MESSAGE);
  }

  if (verification.requireValidationRef && !verification.validationReference) {
    throw new Error('Monnify validation reference is required but missing');
  }

  return {
    billerCode: biller.billerCode,
    customerIdentifier: formattedPhone,
    customerName: verification.customerName,
    productCode: product.productCode,
    requireValidationRef: verification.requireValidationRef,
    validationReference: verification.validationReference,
  };
}

function resolveRoutingProviderKey({
  billerCode,
  billerName,
  billItemIdentifier,
  isTelco,
  normalizedNetworkProvider,
  productCode,
}: {
  billerCode?: string;
  billerName?: string;
  billItemIdentifier?: string;
  isTelco: boolean;
  normalizedNetworkProvider?: string;
  productCode?: string;
}) {
  if (isTelco) {
    return normalizedNetworkProvider;
  }

  const key = firstTrimmed(
    billerName,
    billerCode,
    billItemIdentifier,
    productCode
  );

  if (!key) {
    throw new Error('Biller name or provider key is required for bill payment');
  }

  return key;
}

function resolveCommissionProviderKey({
  billerCode,
  billerName,
  billItemIdentifier,
  isTelco,
  normalizedNetworkProvider,
  productCode,
  providerSource,
}: {
  billerCode?: string;
  billerName?: string;
  billItemIdentifier?: string;
  isTelco: boolean;
  normalizedNetworkProvider?: string;
  productCode?: string;
  providerSource: VtuProviderSource;
}) {
  if (isTelco) {
    return normalizedNetworkProvider;
  }

  const key =
    providerSource === 'monnify'
      ? firstTrimmed(billerCode, productCode, billerName, billItemIdentifier)
      : firstTrimmed(billItemIdentifier, productCode, billerName, billerCode);

  if (!key) {
    throw new Error('Biller name or provider key is required for bill payment');
  }

  return key;
}

interface MerchantRecord {
  id: string;
  slug: string;
  business_name: string;
}

interface FeatureSettingsRecord {
  vtu_enabled: boolean | null;
  vtu_airtime_enabled: boolean | null;
  vtu_data_enabled: boolean | null;
  vtu_electricity_enabled: boolean | null;
  vtu_tv_enabled: boolean | null;
  vtu_betting_enabled: boolean | null;
  vtu_merchant_commission_rate: number | null;
  vtu_customer_cashback_enabled: boolean | null;
  vtu_customer_cashback_rate: number | null;
  paystack_enabled: boolean | null;
  korapay_enabled: boolean | null;
}

export interface PreparedVtuTransaction {
  customer: CustomerRecord | null;
  customerCashback: number;
  effectiveMerchantEarning: number;
  merchant: MerchantRecord;
  platformEarning: number;
  requestReference: string;
  transaction: {
    id: string;
    amount: number;
    customer_identifier: string | null;
    metadata: Record<string, unknown> | null;
    request_reference: string;
    status: string;
    type: PurchaseInput['type'];
  };
}

export async function preparePendingVtuTransaction({
  supabase,
  insertSupabase,
  user,
  input,
  source,
  requireCustomer = false,
  strictLookups = false,
  linkCustomerViaRpc = false,
  insertViaRpc = false,
}: {
  supabase: SupabaseClient;
  /**
   * Write client for the prepare insert (Codex P1, PR #3741): the
   * settlement payload is server-computed money, so the insert RPC
   * is service-role-only and RLS-bound callers pass their
   * privileged client here. Reads stay on `supabase`. Defaults to
   * `supabase` for privileged callers (direct insert ignores it).
   */
  insertSupabase?: SupabaseClient;
  user: User;
  /**
   * `customerName` here is the **bill customer-of-record** (e.g. meter owner
   * returned by Kuda verify), not the buyer. It is persisted on
   * `vtu_transactions.customer_name` so receipts and "Repeat last" can
   * surface the verified name.
   */
  input: PurchaseInput & { customerName?: string };
  source: PurchaseInput['source'];
  requireCustomer?: boolean;
  /** Fail 5xx (not 400/404) on transient lookup errors; see resolver. */
  strictLookups?: boolean;
  /**
   * Resolve + link the customer through the ownership-verifying RPC
   * (RLS-bound callers). False keeps the client-side resolver for
   * privileged callers. Phase 2, epic #3694.
   */
  linkCustomerViaRpc?: boolean;
  /**
   * Insert the prepared row through the service-role-only RPC
   * (Codex P1: the settlement payload is server-computed money).
   * False keeps the direct insert for privileged callers.
   */
  insertViaRpc?: boolean;
}): Promise<PreparedVtuTransaction> {
  const isTelco = input.type === 'airtime' || input.type === 'data';
  const formattedPhone =
    isTelco && input.phoneNumber ? formatPhoneNumber(input.phoneNumber) : '';

  if (isTelco && (!formattedPhone || !isValidPhoneNumber(formattedPhone))) {
    throw new Error('Invalid phone number');
  }

  // Normalize buyer phone for non-telco (electricity / cable / betting) so Kuda
  // can deliver tokens / confirmations to their real number.
  const rawCustomerPhone = input.customerPhone
    ? formatPhoneNumber(input.customerPhone)
    : '';
  const normalizedCustomerPhone = rawCustomerPhone || undefined;
  if (normalizedCustomerPhone && !isValidPhoneNumber(normalizedCustomerPhone)) {
    throw new Error('Invalid customer phone number');
  }

  const merchant = await resolveVtuMerchant({
    merchantSlug: input.merchantSlug,
    strictLookups,
    supabase,
  });

  // Settings via the membership-gated projection RPC (Phase 2):
  // the base table is secret-bearing with no buyer policy. Zero
  // rows (null) = not-a-member OR no settings row — NOT an error.
  // Transport errors throw and take strict policy below.
  let settings: VtuCheckoutSettings | null;
  try {
    settings = await getVtuCheckoutSettings(supabase, merchant.id, user.id);
  } catch (error) {
    throwIfStrictVtuLookupError({
      context: 'load VTU merchant settings',
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
      strictLookups,
    });
    // Non-strict parity: today's ignored error falls through to the
    // disabled check via the all-null settings — never to customer
    // resolution.
    settings = EMPTY_VTU_CHECKOUT_SETTINGS;
  }

  const resolveCustomerForPrepare = (): Promise<CustomerRecord | null> =>
    linkCustomerViaRpc
      ? linkCheckoutCustomerByEmail(supabase, merchant.id, user.id)
      : resolveVtuCustomer({
          supabase,
          merchantId: merchant.id,
          strictLookups,
          user,
        });

  let customer: CustomerRecord | null | undefined;
  if (settings === null) {
    // Zero rows: resolve identity FIRST so strangers get the
    // customer 404 (parity), not a misleading disabled error. A
    // resolved customer with zero rows means the merchant genuinely
    // has no settings row → disabled either way.
    customer = await resolveCustomerForPrepare();
    if (!customer && requireCustomer) {
      throw new Error('Customer account not found for this storefront');
    }
    throw new Error('VTU is not enabled for this merchant');
  }
  const featureSettings: FeatureSettingsRecord = settings;
  if (!featureSettings.vtu_enabled) {
    throw new Error('VTU is not enabled for this merchant');
  }

  const typeFlags: Record<PurchaseInput['type'], boolean | null | undefined> = {
    airtime: featureSettings.vtu_airtime_enabled,
    data: featureSettings.vtu_data_enabled,
    electricity: featureSettings.vtu_electricity_enabled,
    cable_tv: featureSettings.vtu_tv_enabled,
    betting: featureSettings.vtu_betting_enabled,
  };

  if (typeFlags[input.type] === false) {
    throw new Error(`${VTU_TYPE_LABELS[input.type]} purchases are not enabled`);
  }

  customer ??= await resolveCustomerForPrepare();

  if (requireCustomer && !customer) {
    throw new Error('Customer account not found for this storefront');
  }

  const merchantSplitPercentage = normalizeCommissionPercentage(
    featureSettings.vtu_merchant_commission_rate
  );
  const purchaseType = input.type as keyof typeof COMMISSION_CATEGORY_MAP;
  const normalizedNetworkProvider =
    isTelco && input.networkProvider
      ? normalizeVtuNetworkProvider(input.networkProvider)
      : undefined;
  if (isTelco && !normalizedNetworkProvider) {
    throw new Error(`Invalid network provider: ${input.networkProvider ?? ''}`);
  }
  let resolvedDataPlan: Awaited<
    ReturnType<typeof resolveKudaDataPlanForPurchase>
  > | null = null;
  if (input.type === 'data') {
    if (!normalizedNetworkProvider) {
      throw new Error(
        `Invalid network provider: ${input.networkProvider ?? ''}`
      );
    }
    resolvedDataPlan = await resolveKudaDataPlanForPurchase({
      amount: input.amount,
      dataPlanCode: input.dataPlanCode,
      networkProvider: normalizedNetworkProvider,
    });
  }
  const purchaseAmount = resolvedDataPlan?.amount ?? input.amount;

  let resolvedProvider: 'kuda' | 'monnify';
  let commissionProvider: string | undefined;
  let monnifyTelcoFields: MonnifyTelcoCheckoutFields | null = null;
  let monnifyBillPaymentValidation: MonnifyValidationFields | null = null;

  if (isTelco) {
    const routingPreference = resolveVtuProvider(
      normalizedNetworkProvider,
      COMMISSION_CATEGORY_MAP[purchaseType]
    );
    const shouldTryMonnifyAirtime =
      input.type === 'airtime' &&
      (input.provider === 'monnify' ||
        (!input.provider && routingPreference === 'monnify'));
    let monnifyAirtimeError: Error | null = null;

    if (shouldTryMonnifyAirtime) {
      try {
        monnifyTelcoFields = await resolveMonnifyAirtimeCheckoutFields({
          amount: purchaseAmount,
          formattedPhone,
          normalizedNetworkProvider: normalizedNetworkProvider ?? '',
        });
      } catch (error) {
        monnifyAirtimeError =
          error instanceof Error ? error : new Error(String(error));
        if (input.provider !== 'monnify') {
          logger.warn({
            message: 'Monnify airtime resolution failed; falling back Kuda',
            error: monnifyAirtimeError.message,
            networkProvider: normalizedNetworkProvider,
          });
        }
      }
    }

    if (input.provider === 'monnify') {
      if (input.type !== 'airtime') {
        throw new Error('Monnify data purchases require product metadata');
      }
      if (!monnifyTelcoFields) {
        throw (
          monnifyAirtimeError ??
          new Error('Required Monnify fields are missing')
        );
      }
      resolvedProvider = 'monnify';
    } else if (routingPreference === 'monnify' && monnifyTelcoFields) {
      resolvedProvider = 'monnify';
    } else {
      resolvedProvider = 'kuda';
    }
    commissionProvider = resolveCommissionProviderKey({
      isTelco,
      normalizedNetworkProvider: normalizedNetworkProvider ?? undefined,
      providerSource: resolvedProvider,
    });
  } else {
    const kudaAvailable = !!(
      input.billItemIdentifier && input.customerIdentifier
    );
    const monnifyAvailable = !!(
      input.billerCode &&
      input.productCode &&
      input.customerIdentifier &&
      (!input.requireValidationRef || input.validationReference)
    );

    if (input.provider === 'monnify') {
      if (!monnifyAvailable) {
        throw new Error('Required Monnify fields are missing');
      }
      resolvedProvider = 'monnify';
      commissionProvider = resolveCommissionProviderKey({
        billerCode: input.billerCode,
        billerName: input.billerName,
        billItemIdentifier: input.billItemIdentifier,
        isTelco,
        productCode: input.productCode,
        providerSource: resolvedProvider,
      });
    } else if (input.provider === 'kuda') {
      if (!kudaAvailable) {
        throw new Error('Required Kuda fields are missing');
      }
      resolvedProvider = 'kuda';
      commissionProvider = resolveCommissionProviderKey({
        billerCode: input.billerCode,
        billerName: input.billerName,
        billItemIdentifier: input.billItemIdentifier,
        isTelco,
        productCode: input.productCode,
        providerSource: resolvedProvider,
      });
    } else {
      // Auto mode
      if (!monnifyAvailable && !kudaAvailable) {
        throw new Error('No provider available based on submitted fields');
      }
      const routingProvider = resolveRoutingProviderKey({
        billerCode: input.billerCode,
        billerName: input.billerName,
        billItemIdentifier: input.billItemIdentifier,
        isTelco,
        productCode: input.productCode,
      });
      const preference = resolveVtuProvider(
        routingProvider,
        COMMISSION_CATEGORY_MAP[purchaseType]
      );

      if (preference === 'monnify' && monnifyAvailable) {
        resolvedProvider = 'monnify';
      } else if (preference === 'kuda' && kudaAvailable) {
        resolvedProvider = 'kuda';
      } else if (monnifyAvailable) {
        resolvedProvider = 'monnify';
      } else if (kudaAvailable) {
        resolvedProvider = 'kuda';
      } else {
        throw new Error('No provider available based on submitted fields');
      }
      commissionProvider = resolveCommissionProviderKey({
        billerCode: input.billerCode,
        billerName: input.billerName,
        billItemIdentifier: input.billItemIdentifier,
        isTelco,
        productCode: input.productCode,
        providerSource: resolvedProvider,
      });
    }
  }

  if (!commissionProvider) {
    throw new Error('Biller name or provider key is required for bill payment');
  }

  if (!isTelco && resolvedProvider === 'monnify') {
    if (!(input.billerCode && input.productCode && input.customerIdentifier)) {
      throw new Error('Required Monnify fields are missing');
    }
    monnifyBillPaymentValidation = await validateMonnifyBillPaymentBeforeCharge(
      {
        amount: purchaseAmount,
        billerCode: input.billerCode,
        billerName: input.billerName,
        customerIdentifier: input.customerIdentifier,
        productCode: input.productCode,
        validationReference: input.validationReference,
      }
    );
  }

  const commissions = await calculateCommerce('calculate_vtu', {
    amount: purchaseAmount,
    provider: commissionProvider,
    providerSource: resolvedProvider,
    category: COMMISSION_CATEGORY_MAP[purchaseType],
    merchantSplit: merchantSplitPercentage,
  });

  const customerCashbackEnabled =
    featureSettings.vtu_customer_cashback_enabled ?? false;
  const customerCashbackRate = featureSettings.vtu_customer_cashback_rate ?? 50;
  const customerCashback =
    customerCashbackEnabled && customer?.id
      ? Math.round(
          ((commissions.merchantEarning * customerCashbackRate) / 100) * 100
        ) / 100
      : 0;
  const effectiveMerchantEarning =
    commissions.merchantEarning - customerCashback;
  const requestReference = generateRequestRef();
  const monnifyBillerCode = monnifyTelcoFields?.billerCode ?? input.billerCode;
  const monnifyProductCode =
    monnifyTelcoFields?.productCode ?? input.productCode;
  const monnifyCustomerIdentifier =
    monnifyTelcoFields?.customerIdentifier ?? input.customerIdentifier;
  // The server-side validate-customer result is the authoritative customer-of-
  // record (meter/account holder), so it wins over a client-supplied name. This
  // keeps the persisted name aligned with the persisted address and prevents web
  // checkout (which sends the buyer's profile name) from mislabelling the bill.
  const monnifyCustomerName =
    monnifyBillPaymentValidation?.customerName?.trim() ||
    input.customerName?.trim() ||
    monnifyTelcoFields?.customerName ||
    null;
  // Same authoritative-validation precedence as the name, evaluated once.
  const resolvedCustomerAddress =
    monnifyBillPaymentValidation?.address?.trim() ||
    input.customerAddress?.trim() ||
    null;
  const monnifyValidationReference =
    monnifyTelcoFields?.validationReference ??
    input.validationReference ??
    monnifyBillPaymentValidation?.validationReference;
  const monnifyRequireValidationRef =
    typeof monnifyTelcoFields?.requireValidationRef === 'boolean'
      ? monnifyTelcoFields.requireValidationRef
      : typeof input.requireValidationRef === 'boolean'
        ? input.requireValidationRef
        : monnifyBillPaymentValidation?.requireValidationRef;

  const insertPayload: VtuTransactionInsertPayload = {
    merchant_id: merchant.id,
    customer_id: customer?.id ?? input.customerId ?? null,
    order_id: input.orderId ?? null,
    type: input.type,
    network_provider: isTelco
      ? (normalizedNetworkProvider ?? '')
      : (input.billerName ?? ''),
    phone_number: isTelco
      ? formattedPhone
      : (normalizedCustomerPhone ?? input.customerIdentifier ?? ''),
    amount: purchaseAmount,
    request_reference: requestReference,
    status: 'pending',
    source,
    platform_commission: commissions.platformEarning,
    merchant_commission: effectiveMerchantEarning,
    customer_cashback: customerCashback,
    biller_name: input.billerName ?? null,
    biller_item_code: input.billItemIdentifier ?? null,
    customer_identifier:
      resolvedProvider === 'monnify'
        ? (monnifyCustomerIdentifier ?? null)
        : (input.customerIdentifier ?? null),
    customer_name: monnifyCustomerName,
    metadata: {
      provider: resolvedProvider,
      ...buildVtuSubmissionMarkerEraMetadata(),
      ...(resolvedProvider === 'monnify'
        ? {
            billerCode: monnifyBillerCode,
            productCode: monnifyProductCode,
            validationReference: monnifyValidationReference || undefined,
            requireValidationRef:
              typeof monnifyRequireValidationRef === 'boolean'
                ? monnifyRequireValidationRef
                : undefined,
          }
        : {}),
      dataPlanCode: resolvedDataPlan?.itemCode ?? input.dataPlanCode,
      ...(resolvedDataPlan &&
      resolvedDataPlan.originalDataPlanCode !== resolvedDataPlan.itemCode
        ? { originalDataPlanCode: resolvedDataPlan.originalDataPlanCode }
        : {}),
      ...(resolvedDataPlan
        ? {
            dataPlanAmount: resolvedDataPlan.amount,
            dataPlanIsAmountFixed: resolvedDataPlan.isAmountFixed,
            dataPlanName: resolvedDataPlan.itemName,
            dataPlanProvider: resolvedDataPlan.providerName,
            dataPlanResolvedFrom: resolvedDataPlan.resolvedFrom,
          }
        : {}),
      originalPhoneNumber: input.phoneNumber,
      customerPhone: normalizedCustomerPhone ?? null,
      // Meter/customer address shown on the receipt — server-validated value
      // preferred, client field as fallback; only set when one is present.
      ...(resolvedCustomerAddress ? { address: resolvedCustomerAddress } : {}),
      originalMerchantCommission: commissions.merchantEarning,
      customerCashbackEnabled,
      customerCashbackRate,
      paystackEnabled: featureSettings.paystack_enabled ?? true,
      korapayEnabled: featureSettings.korapay_enabled ?? true,
      paymentPending: true,
      // Wallet payment split. Written ONLY for checkout-sourced
      // rows whenever walletAmount > 0 (including the wallet-only
      // case where wallet === amount and card === 0). Phase B.5's
      // debit hook in fulfillPendingVtuTransaction reads
      // `paymentSplit.wallet > 0` as the signal to call
      // redeem_vtu_wallet_payment.
      //
      // Source gate: non-checkout flows (loyalty_reward / gift /
      // direct / storefront_modal) settle via different paths and
      // the refund helper would skip a non-checkout row, leaving
      // any debit stranded. The schema enforces this at the API
      // boundary (`walletAmount is only valid for checkout-sourced
      // purchases`) and the fulfillment debit gate enforces it at
      // the money-movement layer; this guard keeps the persisted
      // metadata coherent with both.
      ...(source === 'checkout' && input.walletAmount && input.walletAmount > 0
        ? {
            paymentSplit: {
              wallet: input.walletAmount,
              card: purchaseAmount - input.walletAmount,
            },
          }
        : {}),
    },
  };

  // Direct insert for privileged callers; service-role-only RPC
  // for the wallet-only checkout (no buyer INSERT policy and no
  // authenticated EXECUTE exist by design — server-computed
  // money). Same payload, same prepared shape, same error.
  let transaction: InsertedPreparedVtuTransaction;
  if (insertViaRpc) {
    if (!customer?.id) {
      throw new Error('Customer account not found for this storefront');
    }
    transaction = await insertPreparedVtuTransactionViaRpc(
      insertSupabase ?? supabase,
      { ...insertPayload, customer_id: customer.id },
      user.id
    );
  } else {
    transaction = await insertPreparedVtuTransactionDirect(
      supabase,
      insertPayload
    );
  }

  return {
    customer,
    customerCashback,
    effectiveMerchantEarning,
    merchant: merchant as MerchantRecord,
    platformEarning: commissions.platformEarning,
    requestReference,
    transaction: transaction as PreparedVtuTransaction['transaction'],
  };
}
