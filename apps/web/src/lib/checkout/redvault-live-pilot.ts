import 'server-only';

export const REDVAULT_PILOT_USER_ID = '70261bce-d358-45a4-9ede-8b9d71fb3bd9';
const OGABASSEY_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const PILOT_PRICE_KOBO = 10_000;
const PILOT_DISCOUNT_KOBO = 500;

type PilotLine = {
  productId: string;
  quantity: number;
  variantId: string | null;
  unitPriceKobo: number;
  discountKobo: number;
  vatRateBp: number;
  vatCategoryCode: string;
};

export type RedvaultLivePilotPolicy = {
  enabled: boolean;
  merchantId: string;
  productId: string;
} & (
  | { audience: 'private_user'; expiresAt: number; maxAttempts: number }
  | { audience: 'public_product_test'; expiresAt: null; maxAttempts: null }
);

export function getRedvaultLivePilotPolicy(
  now = Date.now()
): RedvaultLivePilotPolicy | null {
  if (process.env.REDVAULT_LIVE_PILOT_ENABLED !== 'true') return null;
  const configuredDatabase = process.env.REDVAULT_LIVE_PILOT_SUPABASE_URL;
  if (
    process.env.BACI_RUNTIME_ENV !== 'production' ||
    process.env.VERCEL_ENV !== 'production' ||
    !configuredDatabase ||
    configuredDatabase !== process.env.NEXT_PUBLIC_SUPABASE_URL
  )
    return null;
  try {
    const database = new URL(configuredDatabase);
    if (
      database.protocol !== 'https:' ||
      database.username ||
      database.password ||
      database.search ||
      database.hash ||
      database.pathname !== '/' ||
      !database.hostname.endsWith('.supabase.co')
    )
      return null;
  } catch {
    return null;
  }
  const merchantId = process.env.REDVAULT_LIVE_PILOT_MERCHANT_ID ?? '';
  const productId = process.env.REDVAULT_LIVE_PILOT_PRODUCT_ID ?? '';
  const audience = process.env.REDVAULT_LIVE_PILOT_AUDIENCE || 'private_user';
  if (audience !== 'private_user' && audience !== 'public_product_test')
    return null;
  const expiresAt = Date.parse(
    process.env.REDVAULT_LIVE_PILOT_EXPIRES_AT ?? ''
  );
  const maxAttempts = Number(
    process.env.REDVAULT_LIVE_PILOT_MAX_ATTEMPTS ?? ''
  );
  const livePaymentEvidence =
    process.env.REDVAULT_LIVE_PROVIDER_EVIDENCE === 'confirmed';
  if (
    merchantId !== OGABASSEY_MERCHANT_ID ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      productId
    ) ||
    !livePaymentEvidence ||
    process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') !== true
  )
    return null;
  if (audience === 'public_product_test') {
    return {
      enabled: true,
      audience,
      merchantId,
      productId,
      expiresAt: null,
      maxAttempts: null,
    };
  }
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts !== 1
  )
    return null;
  return {
    enabled: true,
    audience,
    merchantId,
    productId,
    expiresAt,
    maxAttempts,
  };
}

/**
 * Validates the exact controlled-test basket. The payable total is derived
 * from the normal tax calculation, never hard-coded: the server-computed
 * order tax must equal the quote's VAT rate applied to the pinned
 * merchandise subtotal (mirroring computeAgenticOrderTax, which taxes the
 * gross line extension for category 'S' lines and zero otherwise).
 */
export function validateRedvaultLivePilotOrder(input: {
  userId: string | null;
  merchantId: string;
  currency: string;
  items: PilotLine[];
  subtotalKobo: number;
  discountKobo: number;
  shippingFee: number;
  assuranceAmount: number;
  wrappingFee: number;
  walletAmount: number;
  savingsAmount: number;
  taxAmountKobo: number;
  now?: number;
}): boolean {
  const policy = getRedvaultLivePilotPolicy(input.now);
  const line = input.items[0];
  const expectedTaxKobo =
    line?.vatCategoryCode === 'S'
      ? Math.round((input.subtotalKobo * (line?.vatRateBp ?? 0)) / 10000)
      : 0;
  return Boolean(
    policy &&
      (policy.audience === 'public_product_test' ||
        input.userId === REDVAULT_PILOT_USER_ID) &&
      input.merchantId === policy.merchantId &&
      input.currency.toUpperCase() === 'NGN' &&
      input.items.length === 1 &&
      line?.productId === policy.productId &&
      line?.quantity === 1 &&
      line?.variantId === null &&
      line?.unitPriceKobo === PILOT_PRICE_KOBO &&
      input.subtotalKobo === PILOT_PRICE_KOBO &&
      input.discountKobo === PILOT_DISCOUNT_KOBO &&
      line?.discountKobo === PILOT_DISCOUNT_KOBO &&
      input.taxAmountKobo === expectedTaxKobo &&
      input.shippingFee === 0 &&
      input.assuranceAmount === 0 &&
      input.wrappingFee === 0 &&
      input.walletAmount === 0 &&
      input.savingsAmount === 0
  );
}
