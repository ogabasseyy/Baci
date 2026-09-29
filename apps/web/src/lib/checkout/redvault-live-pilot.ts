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
};

export type RedvaultLivePilotPolicy = {
  enabled: boolean;
  merchantId: string;
  productId: string;
  expiresAt: number;
  maxAttempts: number;
};

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
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 1 ||
    !livePaymentEvidence ||
    process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') !== true
  )
    return null;
  return { enabled: true, merchantId, productId, expiresAt, maxAttempts };
}

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
  now?: number;
}): boolean {
  const policy = getRedvaultLivePilotPolicy(input.now);
  return Boolean(
    policy &&
      input.userId === REDVAULT_PILOT_USER_ID &&
      input.merchantId === policy.merchantId &&
      input.currency.toUpperCase() === 'NGN' &&
      input.items.length === 1 &&
      input.items[0]?.productId === policy.productId &&
      input.items[0]?.quantity === 1 &&
      input.items[0]?.variantId === null &&
      input.items[0]?.unitPriceKobo === PILOT_PRICE_KOBO &&
      input.subtotalKobo === PILOT_PRICE_KOBO &&
      input.discountKobo === PILOT_DISCOUNT_KOBO &&
      input.items[0]?.discountKobo === PILOT_DISCOUNT_KOBO &&
      input.shippingFee === 0 &&
      input.assuranceAmount === 0 &&
      input.wrappingFee === 0 &&
      input.walletAmount === 0 &&
      input.savingsAmount === 0
  );
}
