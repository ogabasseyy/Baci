/**
 * Payment Initialization API Route
 *
 * 2025 Best Practices:
 * - Zod schema validation for request body
 * - Structured error responses with error codes
 * - Early returns for cleaner flow
 * - Type-safe gateway selection
 * - Proper separation of concerns
 */

import { customAlphabet } from 'nanoid';
import { type NextRequest, NextResponse } from 'next/server';
import z from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { getRedvaultPaymentAvailability } from '@/lib/checkout/redvault-payment-availability';
import {
  capturePaymentWithCrypto,
  convertNgnKoboToUsdtCents,
  extractCryptoAddress,
  formatPhoneToE164,
  generatePaymentReference as generateJuicywayReference,
  getChainConfirmationTime,
  getPayment,
  getPaymentSession,
  initializePayment as initializeJuicywayPayment,
  isSupportedCurrency as isJuicywayCurrency,
  JUICYWAY_CHAIN_SUPPORT,
  type JuicywayCryptoChain,
  type JuicywayStablecoin,
} from '@/lib/juicyway';
import { toKlumpIntegerAmount } from '@/lib/klump-utils';
import {
  type Currency,
  calculatePlatformFee as calculateKorapayFee,
  initializePayment as initializeKorapayPayment,
} from '@/lib/korapay';
import { merchantFeatureSettingsDefaults } from '@/lib/merchant-feature-settings-defaults';
import { initializeRedvaultPaystackCheckout } from '@/lib/payments/initialize-redvault-paystack-checkout';
import { persistPaystackDvaAssignment } from '@/lib/payments/persist-paystack-dva-assignment';
import { redactPaymentLogValue } from '@/lib/payments/redact-payment-log-value';
import { resolveChargeCurrency } from '@/lib/payments/resolve-charge-currency';
import {
  calculatePlatformFee as calculatePaystackFee,
  initializeTransaction as initializePaystackPayment,
  type PaymentChannel,
} from '@/lib/paystack';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';

// Types & Constants

const PAYMENT_GATEWAYS = [
  'paystack',
  'korapay',
  'juicyway',
  'credit_direct',
  'credpal',
  'klump',
] as const;
type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

type PreferredGateway = 'paystack' | 'korapay';

// 'bank_transfer' is deliberately excluded: Paystack's hosted pay-with-transfer
// channel bills at 1.5% + ₦100 (capped ₦2,000). Bank transfers are only offered
// through the dedicated-virtual-account branch (payment_type === 'dva'), which
// bills at 1% capped ₦300.
const PAYSTACK_NIGERIAN_CHANNELS = [
  'card',
  'bank',
  'ussd',
] as const satisfies readonly PaymentChannel[];
const PAYSTACK_INTERNATIONAL_CHANNELS = [
  'card',
] as const satisfies readonly PaymentChannel[];

type NigerianPaystackChannel = (typeof PAYSTACK_NIGERIAN_CHANNELS)[number];

interface GatewaySettings {
  paystack_enabled: boolean;
  korapay_enabled: boolean;
  wallet_paystack_dva_enabled: boolean;
  klump_enabled: boolean;
  klump_min_amount: number;
  klump_max_amount: number;
  preferred_local_gateway: PreferredGateway;
  preferred_international_gateway: PreferredGateway;
}

const defaultFeatureSettings = merchantFeatureSettingsDefaults.buildFields();
const DEFAULT_GATEWAY_SETTINGS: GatewaySettings = {
  paystack_enabled: defaultFeatureSettings.paystack_enabled,
  korapay_enabled: defaultFeatureSettings.korapay_enabled,
  wallet_paystack_dva_enabled:
    defaultFeatureSettings.wallet_paystack_dva_enabled,
  klump_enabled: defaultFeatureSettings.klump_enabled,
  klump_min_amount: defaultFeatureSettings.klump_min_amount,
  klump_max_amount: defaultFeatureSettings.klump_max_amount,
  preferred_local_gateway: defaultFeatureSettings.preferred_local_gateway,
  preferred_international_gateway:
    defaultFeatureSettings.preferred_international_gateway,
};

// Zod Validation Schema

const BillingAddressSchema = z
  .object({
    line1: z.string().min(1).optional(),
    line2: z.string().optional(),
    city: z.string().min(1).optional(),
    state: z.string().optional(),
    country: z.string().length(2),
    zip_code: z.string().min(1).optional(),
  })
  .optional();

const OrderItemSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['digital', 'physical']),
});

const PaymentInitRequestSchema = z.object({
  merchant_id: z.uuid(),
  order_id: z.uuid(),
  currency: z.string().default('NGN'),
  customer_email: z.email(),
  customer_name: z.string().min(1),
  customer_phone: z.string().min(1, 'Phone number is required'),
  gateway: z.enum(PAYMENT_GATEWAYS).optional(),
  billing_address: BillingAddressSchema,
  items: z.array(OrderItemSchema).optional(),
  channels: z.array(z.string()).optional(),
  // Payment type: 'dva' for Dedicated Virtual Account (bank transfer)
  payment_type: z.enum(['dva']).optional(),
  // Crypto payment options (only for juicyway gateway)
  crypto_chain: z.enum(['TRX', 'ETH', 'MATIC', 'AVAXC']).optional(),
  crypto_currency: z.enum(['USDT', 'USDC']).optional(),
  payment_method: z.literal('uba_redvault').optional(),
});

type PaymentInitRequest = z.infer<typeof PaymentInitRequestSchema>;
type AuthorizedPaymentInitRequest = PaymentInitRequest & { amount: number };

// Helper Functions

function createErrorResponse(
  error: string,
  code: string,
  status: number = 400
) {
  return NextResponse.json({ error, code }, { status });
}

function numberOrDefault(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeJuicywayStablecoin(
  value: string | undefined,
  fallback: JuicywayStablecoin
): JuicywayStablecoin {
  const normalized = value?.trim().toUpperCase();
  return normalized === 'USDT' || normalized === 'USDC' ? normalized : fallback;
}

function normalizeJuicywayCurrency(
  value: string | undefined,
  fallback: string
) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0
    ? normalized.toUpperCase()
    : fallback;
}

function normalizeHostname(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase();
}

function isRootStorefrontHost(hostname: string, rootDomain: string) {
  const normalizedHostname = normalizeHostname(hostname);
  const normalizedRootDomain = normalizeHostname(rootDomain);

  return (
    normalizedHostname === normalizedRootDomain ||
    normalizedHostname === `www.${normalizedRootDomain}`
  );
}

function getPublicRequestUrlParts(request: NextRequest) {
  const headerHost =
    request.headers.get('host')?.split(',')[0]?.trim() || request.nextUrl.host;
  const headerProtocol =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    request.nextUrl.protocol.replace(/:$/, '');
  const origin = headerHost
    ? `${headerProtocol || 'https'}://${headerHost}`
    : request.nextUrl.origin;

  return {
    hostname: normalizeHostname(headerHost || request.nextUrl.hostname),
    origin,
  };
}

function shouldPrefixBnplLauncherWithSlug(
  request: NextRequest,
  merchantSlug: string,
  rootDomain: string
) {
  const { hostname, origin } = getPublicRequestUrlParts(request);
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.origin === origin) {
        return (
          refererUrl.pathname === `/${merchantSlug}` ||
          refererUrl.pathname.startsWith(`/${merchantSlug}/`)
        );
      }
    } catch {
      // Fall through to host-based detection.
    }
  }

  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.vercel.app') ||
    isRootStorefrontHost(hostname, rootDomain)
  );
}

function buildBnplLauncherUrl(
  request: NextRequest,
  merchantSlug: string,
  rootDomain: string,
  query: URLSearchParams
) {
  const { origin } = getPublicRequestUrlParts(request);
  const slugPrefix = shouldPrefixBnplLauncherWithSlug(
    request,
    merchantSlug,
    rootDomain
  )
    ? `/${merchantSlug}`
    : '';

  return `${origin}${slugPrefix}/checkout/bnpl?${query.toString()}`;
}

function selectGateway(
  currency: string,
  settings: GatewaySettings,
  hasPaystackSubaccount: boolean
): PaymentGateway {
  const isLocalPayment = currency === 'NGN';

  if (isLocalPayment) {
    const preferred = settings.preferred_local_gateway;

    if (
      preferred === 'paystack' &&
      settings.paystack_enabled &&
      hasPaystackSubaccount
    ) {
      return 'paystack';
    }
    if (preferred === 'korapay' && settings.korapay_enabled) {
      return 'korapay';
    }
    if (settings.paystack_enabled && hasPaystackSubaccount) {
      return 'paystack';
    }
    if (settings.korapay_enabled) {
      return 'korapay';
    }
    return 'paystack';
  }

  // International (non-NGN) payments. Paystack is never auto-selected here:
  // the platform's Paystack integration settles NGN only, so routing a
  // non-NGN order to it would just fail the downstream charge-currency guard
  // with UNSUPPORTED_CURRENCY. Korapay is the only multi-currency rail
  // (whether it is actually enabled is enforced by the route's korapay guard).
  return 'korapay';
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers
    .get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim();
  const realIp = request.headers.get('x-real-ip');
  const ip = forwardedFor || realIp;

  // Check if it's a valid public IPv4 (not localhost/private)
  if (
    ip &&
    !ip.startsWith('127.') &&
    !ip.startsWith('192.168.') &&
    !ip.startsWith('10.') &&
    !ip.startsWith('::') &&
    !ip.startsWith('172.16.') &&
    !ip.startsWith('172.17.') &&
    !ip.startsWith('172.18.') &&
    !ip.startsWith('172.19.') &&
    !ip.startsWith('172.2') &&
    !ip.startsWith('172.30.') &&
    !ip.startsWith('172.31.') &&
    !ip.startsWith('fe80:') &&
    !ip.startsWith('fc00:') &&
    !ip.startsWith('fd')
  ) {
    return ip;
  }
  // Use a placeholder public IP for development/testing
  return '41.217.100.1';
}

function parseCustomerName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = fullName.trim().split(' ');
  return {
    firstName: parts[0] || 'Customer',
    lastName: parts.slice(1).join(' ') || 'User',
  };
}

function isNigerianCheckoutCountry(
  country: string | null | undefined
): boolean {
  const normalizedCountry = country?.trim().toUpperCase();
  return normalizedCountry === 'NG' || normalizedCountry === 'NIGERIA';
}

function isNigerianPaystackCustomer(
  data: PaymentInitRequest,
  formattedCustomerPhone: string
): boolean {
  return (
    isNigerianCheckoutCountry(data.billing_address?.country) &&
    formattedCustomerPhone.startsWith('+234')
  );
}

function getPaystackChannelsForCustomer(
  data: PaymentInitRequest,
  formattedCustomerPhone: string,
  _gatewaySettings: GatewaySettings
): PaymentChannel[] {
  if (!isNigerianPaystackCustomer(data, formattedCustomerPhone)) {
    return [...PAYSTACK_INTERNATIONAL_CHANNELS];
  }

  const allowedNigerianChannels = [...PAYSTACK_NIGERIAN_CHANNELS];

  if (!data.channels?.length) {
    return allowedNigerianChannels;
  }

  const channels = data.channels.filter((channel): channel is PaymentChannel =>
    allowedNigerianChannels.includes(channel as NigerianPaystackChannel)
  );

  return channels.length ? channels : allowedNigerianChannels;
}

function getBillingAddressForGateway(
  billingAddress: PaymentInitRequest['billing_address']
) {
  return {
    line1: billingAddress?.line1 || 'Lagos, Nigeria',
    ...(billingAddress?.line2 ? { line2: billingAddress.line2 } : {}),
    city: billingAddress?.city || 'Lagos',
    ...(billingAddress?.state ? { state: billingAddress.state } : {}),
    country: billingAddress?.country || 'NG',
    zip_code: billingAddress?.zip_code || '100001',
  };
}

// Gateway-Specific Payment Handlers

interface PaymentResult {
  authorization_url: string;
  checkout_url?: string;
  virtual_account?: {
    bank_name: string;
    account_number: string;
    account_name: string;
  };
  dva?: {
    bank_name: string;
    account_number: string;
    account_name: string;
  };
  crypto_payment?: {
    address: string;
    chain: JuicywayCryptoChain;
    currency: JuicywayStablecoin;
    amount: number;
    /** Stablecoin amount for display (e.g. "3.26") */
    crypto_amount?: string;
    /**
     * Expected settlement amount in stablecoin minor units (cents), as charged
     * by Juicyway (our amount + Juicyway fee). Persisted on the transaction so
     * the webhook can reject underpaid/mismatched settlements.
     */
    expected_session_amount?: number;
    /** Currency associated with expected_session_amount (payment/session currency). */
    expected_session_currency?: string;
    /** NGN/USDT rate used for conversion */
    conversion_rate?: number;
    confirmation_time: string;
    qrcode?: string;
    payment_id?: string;
  };
  crypto_address_pending?: boolean;
  reference: string;
  platformFee: number;
  merchantAmount: number;
  sessionId?: string;
}

async function initializeJuicyway(
  request: NextRequest,
  data: AuthorizedPaymentInitRequest,
  merchant: { business_name: string },
  redirectUrl: string,
  reference: string,
  merchantId: string
): Promise<PaymentResult> {
  const fees = calculateKorapayFee(data.amount);
  const { firstName, lastName } = parseCustomerName(data.customer_name);
  const amountInMinor = Math.round(data.amount * 100);

  // Determine if this is a crypto payment
  // 2026 Resilience: Default to crypto (USDT/TRX) if gateway is juicyway but no details provided
  // to avoid "Card payment checkout not available" errors.
  const isCryptoPayment = (data.crypto_chain && data.crypto_currency) || true;
  const cryptoChain = (data.crypto_chain || 'TRX') as JuicywayCryptoChain;
  const cryptoCurrency = (data.crypto_currency || 'USDT') as JuicywayStablecoin;

  // For crypto payments, the session currency MUST be the stablecoin (USDT/USDC).
  // Juicyway only generates a wallet address when the session currency matches the stablecoin.
  // NGN/USD sessions return "No channel provided for processing" on capture.
  // Juicyway handles the fiat→crypto conversion at its current exchange rate.
  const paymentCurrency = isCryptoPayment
    ? cryptoCurrency
    : isJuicywayCurrency(data.currency)
      ? data.currency
      : 'NGN';

  // Validate chain/currency compatibility for crypto payments
  if (isCryptoPayment) {
    const supportedChains = JUICYWAY_CHAIN_SUPPORT[cryptoCurrency];
    if (!supportedChains.includes(cryptoChain)) {
      throw new Error(
        `${cryptoCurrency} is not supported on ${cryptoChain}. Supported chains: ${supportedChains.join(', ')}`
      );
    }
  }

  // Juicyway treats amounts LITERALLY in the session currency.
  // A USDT session with amount=100000 means $100,000 USDT, NOT ₦1,000.
  // We must convert NGN → USDT/USDC cents before creating the session.
  let sessionAmount = amountInMinor;
  let conversionRate: number | undefined;
  if (isCryptoPayment) {
    const conversion = await convertNgnKoboToUsdtCents(amountInMinor);
    sessionAmount = conversion.usdtCents;
    conversionRate = conversion.rate;
  }

  const juicywayData = await initializeJuicywayPayment({
    amount: sessionAmount,
    currency: paymentCurrency,
    customer: {
      first_name: firstName,
      last_name: lastName,
      email: data.customer_email,
      phone_number: data.customer_phone
        ? formatPhoneToE164(data.customer_phone)
        : '+2340000000000',
      billing_address: getBillingAddressForGateway(data.billing_address),
      ip_address: getClientIp(request),
    },
    description:
      `${isCryptoPayment ? 'Crypto' : 'Card'} payment to ${merchant.business_name}`.substring(
        0,
        200
      ),
    reference,
    payment_method: { type: isCryptoPayment ? 'crypto_address' : 'card' },
    order: {
      identifier: data.order_id,
      items: data.items || [
        {
          name: 'Order Payment',
          type: isCryptoPayment ? 'digital' : 'physical',
        },
      ],
    },
    redirect_url: redirectUrl,
    // direction is required for crypto payments
    ...(isCryptoPayment && { direction: 'incoming' as const }),
    metadata: {
      merchant_id: merchantId,
      order_id: data.order_id,
      platform_fee: fees.platformFee,
      merchant_amount: fees.merchantAmount,
      payment_type: isCryptoPayment ? 'crypto' : 'card',
      original_ngn_amount: amountInMinor, // Store original amount for reference
    },
  });

  // Handle bank transfer response (returns virtual account)
  if (
    juicywayData.payment_method?.type === 'bank_account' &&
    juicywayData.payment_method.account_number
  ) {
    return {
      authorization_url: '',
      virtual_account: {
        bank_name: juicywayData.payment_method.bank_name || 'Bank',
        account_number: juicywayData.payment_method.account_number,
        account_name:
          juicywayData.payment_method.account_name || 'JUICE PAYMENTS',
      },
      reference,
      platformFee: fees.platformFee,
      merchantAmount: fees.merchantAmount,
      sessionId: juicywayData.id,
    };
  }

  // For crypto payments, we need to capture the payment to get the wallet address
  // Two-step process: 1) POST capture with crypto details, 2) Poll with GET if pending
  if (isCryptoPayment) {
    if (!juicywayData.id) {
      throw new Error(
        'Crypto payment session failed: no session ID returned by Juicyway. Please try again.'
      );
    }
    const MAX_POLL_ATTEMPTS = 5; // Quick server-side check (~10s); client polls if still pending
    const POLL_DELAY_MS = 2000;

    try {
      let paymentMethod:
        | {
            address: string;
            chain: JuicywayCryptoChain;
            currency: JuicywayStablecoin;
            qrcode?: string;
          }
        | undefined;
      let cryptoData:
        | {
            payment?: {
              id?: string;
              amount?: number;
              currency?: string;
              status?: string;
              payment_method?: Record<string, unknown>;
            };
          }
        | undefined;
      let expectedSettlementAmount = sessionAmount;
      let expectedSettlementCurrency = normalizeJuicywayCurrency(
        paymentCurrency,
        cryptoCurrency
      );
      const captureExpectedSettlement = (
        payment:
          | {
              amount?: number;
              currency?: string;
            }
          | undefined
      ) => {
        if (
          typeof payment?.amount === 'number' &&
          Number.isFinite(payment.amount) &&
          payment.amount > 0
        ) {
          expectedSettlementAmount = payment.amount;
        }
        expectedSettlementCurrency = normalizeJuicywayCurrency(
          payment?.currency,
          expectedSettlementCurrency
        );
      };

      // Step 1: POST capture once to initiate address generation
      const captureResult = await capturePaymentWithCrypto(
        juicywayData.id,
        cryptoChain,
        cryptoCurrency
      );

      if (!captureResult.success) {
        throw new Error(
          captureResult.error || 'Failed to initiate crypto payment capture'
        );
      }

      cryptoData = captureResult.data;
      captureExpectedSettlement(cryptoData.payment);
      // Juicyway returns address either at payment_method.address (docs) or
      // payment_method.params.address (live API). extractCryptoAddress handles both.
      const extractedAddr = extractCryptoAddress(
        cryptoData.payment?.payment_method
      );
      if (extractedAddr) {
        paymentMethod = {
          address: extractedAddr.address,
          chain: extractedAddr.chain as JuicywayCryptoChain,
          currency: normalizeJuicywayStablecoin(
            extractedAddr.currency,
            cryptoCurrency
          ),
          qrcode: extractedAddr.qrcode,
        };
      }

      const juicywayMode =
        (process.env.JUICYWAY_BASE_URL || '').includes('sandbox') ||
        !process.env.JUICYWAY_BASE_URL
          ? 'sandbox'
          : 'live';

      console.log('Crypto capture response:', {
        status: cryptoData.payment?.status,
        hasAddress: !!paymentMethod?.address,
        paymentId: cryptoData.payment?.id,
        mode: juicywayMode,
        fullCaptureData: JSON.stringify(cryptoData).substring(0, 500),
      });

      // Step 2: If address not ready, poll with GET instead of re-POSTing
      if (!paymentMethod?.address) {
        let pollAttempt = 0;

        while (pollAttempt < MAX_POLL_ATTEMPTS) {
          pollAttempt++;
          await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));

          // Try session endpoint first
          const pollResult = await getPaymentSession(juicywayData.id);

          if (!pollResult.success) {
            console.error(
              'Poll attempt %d failed:',
              pollAttempt,
              pollResult.error
            );
            // Stop polling if it's a terminal client error (4xx)
            if (pollResult.code?.startsWith('HTTP_4')) {
              throw new Error(`Juicyway API Error: ${pollResult.error}`);
            }
            continue;
          }

          const polledSessionData = pollResult.data;
          captureExpectedSettlement(polledSessionData.payment);

          // Update tracking variables — extract address from params or top-level
          cryptoData = polledSessionData;
          const polledAddr = extractCryptoAddress(
            polledSessionData.payment?.payment_method
          );
          if (polledAddr) {
            paymentMethod = {
              address: polledAddr.address,
              chain: polledAddr.chain as JuicywayCryptoChain,
              currency: normalizeJuicywayStablecoin(
                polledAddr.currency,
                cryptoCurrency
              ),
              qrcode: polledAddr.qrcode,
            };
          }

          // LOG SESSION POLLING
          console.log(
            `[Juicyway Poll #${pollAttempt}/${MAX_POLL_ATTEMPTS}] Session`,
            {
              status: polledSessionData.payment?.status,
              message: polledSessionData.message,
              hasAddress: !!paymentMethod?.address,
              raw: `${JSON.stringify(polledSessionData).substring(0, 100)}...`,
            }
          );

          // Fallback: If session endpoint doesn't return address, try the specific PAYMENT endpoint
          // This handles cases where session status lags behind payment status
          if (!paymentMethod?.address && polledSessionData.payment?.id) {
            try {
              const paymentCheck = await getPayment(
                polledSessionData.payment.id
              );
              if (paymentCheck.success) {
                const paymentDetails = paymentCheck.data;
                captureExpectedSettlement(paymentDetails);
                // The payment_method may include crypto fields (address, chain, currency)
                // that aren't in the base JuicywayPaymentMethod schema
                const pm = paymentDetails.payment_method as unknown as
                  | (NonNullable<typeof paymentMethod> & {
                      address?: string;
                      params?: {
                        address: string;
                        chain: string;
                        currency: string;
                      };
                    })
                  | undefined;
                const fallbackAddr = pm?.address || pm?.params?.address;
                console.log(`[Juicyway Poll #${pollAttempt}] Payment Check`, {
                  status: paymentDetails.status,
                  hasAddress: !!fallbackAddr,
                  raw: `${JSON.stringify(paymentDetails).substring(0, 100)}...`,
                });

                if (fallbackAddr) {
                  paymentMethod = {
                    address: fallbackAddr,
                    chain: (pm?.chain ||
                      pm?.params?.chain ||
                      cryptoChain) as JuicywayCryptoChain,
                    currency: normalizeJuicywayStablecoin(
                      pm?.currency || pm?.params?.currency,
                      cryptoCurrency
                    ),
                  };
                }
              }
            } catch (err) {
              console.warn('Secondary payment check failed', err);
            }
          }

          // Check for hard failure in status
          if (
            polledSessionData.status === 'failed' ||
            polledSessionData.payment?.status === 'failed'
          ) {
            const rawFailure = JSON.stringify(polledSessionData);
            throw new Error(
              `Juicyway Failed: ${polledSessionData.message || 'Unknown'}. Raw: ${rawFailure}`
            );
          }

          if (paymentMethod?.address) {
            break;
          }

          if (pollAttempt === MAX_POLL_ATTEMPTS) {
            console.warn(
              '[Juicyway] Address not ready after quick poll — returning pending for client-side polling.',
              { sessionId: juicywayData.id, paymentId: cryptoData?.payment?.id }
            );
          }
        }
      }

      // IMPORTANT: We need BOTH the session ID and the payment ID:
      // - session_id (juicywayData.id): Used for initial tracking
      // - payment_id (cryptoData.payment.id): Used for GET /payments/{id} verification
      const paymentId = cryptoData?.payment?.id;

      // payment.amount is in USDT/USDC cents (what we sent + Juicyway fee).
      // Convert to major units for display (e.g. 326 cents → "3.26").
      const cryptoAmountStr = (expectedSettlementAmount / 100).toFixed(2);

      // If address is available, return it immediately
      if (paymentMethod?.address) {
        return {
          authorization_url: '',
          crypto_payment: {
            address: paymentMethod.address,
            chain: paymentMethod.chain,
            currency: paymentMethod.currency,
            amount: amountInMinor,
            crypto_amount: cryptoAmountStr,
            expected_session_amount: expectedSettlementAmount,
            expected_session_currency: expectedSettlementCurrency,
            conversion_rate: conversionRate,
            confirmation_time: getChainConfirmationTime(paymentMethod.chain),
            qrcode: paymentMethod.qrcode,
            payment_id: paymentId,
          },
          reference,
          platformFee: fees.platformFee,
          merchantAmount: fees.merchantAmount,
          sessionId: juicywayData.id,
        };
      }

      // Address not ready yet — return pending so client can poll
      return {
        authorization_url: '',
        crypto_address_pending: true,
        crypto_payment: {
          address: '', // Not available yet
          chain: cryptoChain,
          currency: cryptoCurrency,
          amount: amountInMinor,
          crypto_amount: cryptoAmountStr,
          expected_session_amount: expectedSettlementAmount,
          expected_session_currency: expectedSettlementCurrency,
          conversion_rate: conversionRate,
          confirmation_time: getChainConfirmationTime(cryptoChain),
          payment_id: paymentId,
        },
        reference,
        platformFee: fees.platformFee,
        merchantAmount: fees.merchantAmount,
        sessionId: juicywayData.id,
      };
    } catch (captureError) {
      console.error('Crypto capture exception:', captureError);
      throw new Error(
        captureError instanceof Error
          ? captureError.message
          : 'Crypto payment address generation failed. Please try again.'
      );
    }
  }

  // If no checkout URL is returned for card payment, throw an error
  if (!juicywayData.checkout_url) {
    console.error('Juicyway did not return a checkout URL for card payment', {
      sessionId: juicywayData.id,
      paymentMethod: juicywayData.payment_method?.type,
      fullResponse: juicywayData,
    });
    throw new Error(
      'Card payment checkout not available. Please try again or use an alternative payment method.'
    );
  }

  return {
    authorization_url: juicywayData.checkout_url,
    checkout_url: juicywayData.checkout_url,
    reference,
    platformFee: fees.platformFee,
    merchantAmount: fees.merchantAmount,
    sessionId: juicywayData.id,
  };
}

async function initializePaystack(
  data: AuthorizedPaymentInitRequest,
  merchant: { paystack_subaccount_code: string | null },
  gatewaySettings: GatewaySettings,
  redirectUrl: string,
  reference: string,
  merchantId: string
): Promise<PaymentResult> {
  const amountInKobo = Math.round(data.amount * 100);
  const fees = calculatePaystackFee(amountInKobo);

  // 2026 Resilience: Ensure phone number is formatted to E.164 for Paystack compatibility
  const customerPhone = data.customer_phone
    ? formatPhoneToE164(data.customer_phone)
    : undefined;

  // Debug log to confirm what we have after formatting
  console.log(
    '[PaymentInit] Paystack Phone Debug:',
    sanitizeForLog(
      redactPaymentLogValue({
        original_phone: data.customer_phone,
        formatted_phone: customerPhone,
        type: typeof customerPhone,
      })
    )
  );

  if (!customerPhone || customerPhone.length < 5) {
    throw new Error(
      'Invalid phone number provided. Please enter a valid mobile number.'
    );
  }

  const paystackData = await initializePaystackPayment({
    email: data.customer_email,
    amount: amountInKobo,
    phone: customerPhone,
    reference,
    callback_url: redirectUrl,
    subaccount: merchant.paystack_subaccount_code as string,
    transaction_charge: fees.platformFee,
    bearer: 'account',
    channels: getPaystackChannelsForCustomer(
      data,
      customerPhone,
      gatewaySettings
    ),
    metadata: {
      merchant_id: merchantId,
      order_id: data.order_id,
      customer_name: data.customer_name,
      customer_phone: customerPhone,
      gateway: data.gateway,
      // 2026 Fix: Redundant phone fields in metadata to satisfy different Paystack requirement settings
      phone: customerPhone,
      phone_number: customerPhone,
      platform_fee: fees.platformFee / 100,
      custom_fields: [
        {
          display_name: 'Phone Number',
          variable_name: 'phone_number',
          value: customerPhone?.replace(/^\+234/, '0') || 'N/A', // Convert E.164 to local format for specific merchant configs
        },
        {
          display_name: 'Mobile Number',
          variable_name: 'mobile_number',
          value: customerPhone?.replace(/^\+234/, '0') || 'N/A',
        },
        {
          display_name: 'Application ID',
          variable_name: 'application_id',
          value: 'baci_storefront',
        },
        {
          display_name: 'Platform',
          variable_name: 'platform',
          value: 'baci_web',
        },
      ],
    },
  });

  return {
    authorization_url: paystackData.authorization_url,
    checkout_url: paystackData.authorization_url,
    reference,
    platformFee: fees.platformFee / 100,
    merchantAmount: fees.merchantAmount / 100,
  };
}

async function initializeKorapay(
  data: AuthorizedPaymentInitRequest,
  merchant: { business_name: string },
  redirectUrl: string,
  reference: string,
  notificationUrl: string,
  merchantId: string
): Promise<PaymentResult> {
  // Compute the platform fee in the ORDER's currency, not a hardcoded NGN. Korapay
  // is charged in `data.currency` (see the charge below), so the naira ₦2,050 cap
  // must only apply to NGN — every other Lane-0 currency is percentage-only. This
  // persisted fee (p_platform_fee) is what settlement later trusts.
  const fees = calculateKorapayFee(data.amount, data.currency as Currency);

  const korapayData = await initializeKorapayPayment({
    amount: data.amount,
    currency: data.currency as Currency,
    customer: {
      name: data.customer_name,
      email: data.customer_email,
    },
    reference,
    narration: `Payment to ${merchant.business_name}`,
    redirect_url: redirectUrl,
    notification_url: notificationUrl,
    merchant_bears_cost: true,
    metadata: {
      merchant_id: merchantId,
      order_id: data.order_id,
      platform_fee: fees.platformFee,
      merchant_amount: fees.merchantAmount,
    },
  });

  const authorizationUrl =
    korapayData.authorization_url || korapayData.checkout_url;
  const checkoutUrl = korapayData.checkout_url || korapayData.authorization_url;

  if (!authorizationUrl || !checkoutUrl) {
    throw new Error('Korapay checkout URL is missing from initialization');
  }

  return {
    authorization_url: authorizationUrl,
    checkout_url: checkoutUrl,
    reference,
    platformFee: fees.platformFee,
    merchantAmount: fees.merchantAmount,
  };
}

// Main Route Handler

export async function POST(request: NextRequest) {
  try {
    // CSRF exemption: This is a public storefront endpoint for checkout payment.
    // Guest users do not have CSRF tokens. The route validates order ownership
    // via get_order_payment_snapshot RPC (order_id + email match).

    // Parse and validate request body
    const body = await request.clone().json();
    console.log(
      '[PaymentInit] Raw Request Body:',
      sanitizeForLog(redactPaymentLogValue(body))
    );

    const parseResult = PaymentInitRequestSchema.safeParse(body);

    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0];
      return createErrorResponse(
        `Validation error: ${firstError.path.join('.')} - ${firstError.message}`,
        'VALIDATION_ERROR'
      );
    }

    const data = parseResult.data;
    const redvaultRequested = data.payment_method === 'uba_redvault';
    if (redvaultRequested) {
      if (data.gateway && data.gateway !== 'paystack') {
        return createErrorResponse(
          'REDVAULT requires Paystack hosted card checkout',
          'REDVAULT_GATEWAY_UNSUPPORTED',
          400
        );
      }
      if (data.payment_type) {
        return createErrorResponse(
          'REDVAULT does not support bank-transfer payment types',
          'REDVAULT_PAYMENT_TYPE_UNSUPPORTED',
          400
        );
      }
      const availability = getRedvaultPaymentAvailability();
      if (!availability.available) {
        return createErrorResponse(
          'REDVAULT payment is not available',
          'REDVAULT_UNAVAILABLE',
          409
        );
      }
    }

    // The client never dictates the charge currency (see resolveChargeCurrency).
    // Capture whether the request EXPLICITLY carried a currency: the Zod schema
    // defaults `currency` to 'NGN', so `data.currency` cannot distinguish an
    // omitted field from a client that genuinely sent NGN.
    const rawBodyCurrency =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as { currency?: unknown }).currency
        : undefined;
    const clientRequestedCurrency =
      typeof rawBodyCurrency === 'string' ? rawBodyCurrency : undefined;

    // Use the admin client for the bearer-authenticated mobile storefront's
    // order, merchant, and gateway-setting reads. The proof-bound DVA
    // reservation below deliberately uses the request-scoped server client so
    // the reservation itself never crosses a service-role boundary.
    const adminSupabase = createAdminClient();

    // Validate order context (order + email) before initiating payment
    const { data: snapshotRows, error: snapshotError } =
      await adminSupabase.rpc('get_order_payment_snapshot', {
        p_order_id: data.order_id,
        p_email: data.customer_email,
      });

    const orderSnapshot = Array.isArray(snapshotRows) ? snapshotRows[0] : null;

    if (snapshotError || !orderSnapshot) {
      return createErrorResponse(
        'Order not found or email mismatch',
        'ORDER_NOT_FOUND',
        404
      );
    }

    if (orderSnapshot.merchant_id !== data.merchant_id) {
      return createErrorResponse(
        'Merchant mismatch for this order',
        'MERCHANT_MISMATCH',
        403
      );
    }

    const orderRequiresRedvault =
      orderSnapshot.payment_method === 'uba_redvault';
    if (orderRequiresRedvault && !redvaultRequested) {
      return createErrorResponse(
        'This order requires REDVAULT payment initialization',
        'REDVAULT_PAYMENT_METHOD_REQUIRED',
        409
      );
    }
    if (redvaultRequested && !orderRequiresRedvault) {
      return createErrorResponse(
        'REDVAULT payment requires a REDVAULT order',
        'REDVAULT_ORDER_REQUIRED',
        409
      );
    }

    // A cancelled order must never be payable. The reopen-backstop trigger keeps
    // the order cancelled even if a payment later lands, but reject here so a
    // customer cannot start a new payment for an order they cancelled.
    if (orderSnapshot.shipping_status === 'cancelled') {
      return createErrorResponse(
        'This order has been cancelled and can no longer be paid',
        'ORDER_NOT_PAYABLE',
        409
      );
    }

    // Validate order total: Number(null) => 0, Number(undefined) => NaN
    const snapshotTotal = Number(orderSnapshot.total);
    if (
      orderSnapshot.total == null ||
      Number.isNaN(snapshotTotal) ||
      snapshotTotal <= 0
    ) {
      return createErrorResponse(
        'Invalid order total',
        'INVALID_ORDER_TOTAL',
        400
      );
    }
    const merchantId = orderSnapshot.merchant_id;

    // The charge currency is the order's currency (server-authoritative from the
    // snapshot, stamped from the merchant payout currency at order creation).
    // Legacy rows without a stamped currency are all genuinely NGN, so an empty
    // value falls back to NGN rather than failing a Nigerian checkout.
    const orderCurrency =
      typeof orderSnapshot.currency === 'string' &&
      orderSnapshot.currency.trim().length > 0
        ? orderSnapshot.currency.trim().toUpperCase()
        : 'NGN';

    const { data: orderPaymentRow, error: orderPaymentError } =
      await adminSupabase
        .from('orders')
        .select('wallet_amount_used')
        .eq('id', data.order_id)
        .eq('merchant_id', merchantId)
        .single();

    if (orderPaymentError || !orderPaymentRow) {
      return createErrorResponse(
        'Unable to verify order payment amount',
        'ORDER_AMOUNT_LOOKUP_FAILED',
        500
      );
    }

    const walletAmountUsed = Math.max(
      numberOrDefault(
        (orderPaymentRow as { wallet_amount_used?: unknown })
          .wallet_amount_used,
        0
      ),
      0
    );

    const { data: savingsRows, error: savingsError } = await adminSupabase
      .from('customer_savings_redemptions')
      .select('amount')
      .eq('order_id', data.order_id)
      .eq('merchant_id', merchantId);

    if (savingsError) {
      return createErrorResponse(
        'Unable to verify order savings amount',
        'ORDER_SAVINGS_LOOKUP_FAILED',
        500
      );
    }

    const savingsAmountUsed = Array.isArray(savingsRows)
      ? savingsRows.reduce((sum, row) => {
          const amount =
            row && typeof row === 'object'
              ? (row as { amount?: unknown }).amount
              : 0;
          return sum + Math.max(numberOrDefault(amount, 0), 0);
        }, 0)
      : 0;

    // Fetch merchant
    const { data: merchant, error: merchantError } = await adminSupabase
      .from('merchants')
      .select('id, business_name, slug, paystack_subaccount_code')
      .eq('id', merchantId)
      .single();

    if (merchantError || !merchant) {
      return createErrorResponse(
        'Merchant not found',
        'MERCHANT_NOT_FOUND',
        404
      );
    }

    const trackingToken =
      typeof orderSnapshot.tracking_token === 'string'
        ? orderSnapshot.tracking_token
        : undefined;

    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';

    if (orderRequiresRedvault) {
      if (!merchant.paystack_subaccount_code) {
        return createErrorResponse(
          'Paystack is not configured for this merchant',
          'GATEWAY_NOT_CONFIGURED',
          400
        );
      }

      const customerAuth = await authenticateApiRequest(request);
      const fallbackClient = await createServerSupabaseClient();
      const checkout = await initializeRedvaultPaystackCheckout({
        customerEmail: data.customer_email,
        fallbackClient,
        merchantId,
        orderId: data.order_id,
        redirectUrl: `${protocol}://${merchant.slug}.${rootDomain}/checkout/success`,
        subaccount: merchant.paystack_subaccount_code,
        userId: customerAuth.user?.id ?? null,
      });

      if (checkout.status === 'pending_reconciliation') {
        return NextResponse.json(
          {
            code: 'REDVAULT_RECONCILIATION_REQUIRED',
            error: 'REDVAULT checkout needs reconciliation before retrying',
          },
          { status: 202 }
        );
      }

      return NextResponse.json({
        authorization_url: checkout.authorizationUrl,
        checkout_url: checkout.authorizationUrl,
        gateway: 'paystack',
        payment_method: 'uba_redvault',
        reference: checkout.reference,
        success: true,
      });
    }

    // Fetch gateway settings
    const { data: featureSettings } = await adminSupabase
      .from('merchant_feature_settings')
      .select(
        'paystack_enabled, korapay_enabled, wallet_paystack_dva_enabled, klump_enabled, klump_min_amount, klump_max_amount, preferred_local_gateway, preferred_international_gateway'
      )
      .eq('merchant_id', merchantId)
      .single();

    const gatewaySettings: GatewaySettings = featureSettings
      ? {
          paystack_enabled: featureSettings.paystack_enabled ?? true,
          korapay_enabled: featureSettings.korapay_enabled === true,
          wallet_paystack_dva_enabled:
            featureSettings.wallet_paystack_dva_enabled === true,
          klump_enabled: featureSettings.klump_enabled ?? false,
          klump_min_amount: numberOrDefault(
            featureSettings.klump_min_amount,
            DEFAULT_GATEWAY_SETTINGS.klump_min_amount
          ),
          klump_max_amount: numberOrDefault(
            featureSettings.klump_max_amount,
            DEFAULT_GATEWAY_SETTINGS.klump_max_amount
          ),
          preferred_local_gateway:
            (featureSettings.preferred_local_gateway as PreferredGateway) ||
            'paystack',
          preferred_international_gateway:
            (featureSettings.preferred_international_gateway as PreferredGateway) ||
            'korapay',
        }
      : DEFAULT_GATEWAY_SETTINGS;

    const notificationUrl = `${protocol}://${rootDomain}/api/payments/webhook`;

    // Select gateway
    const hasPaystackSubaccount = !!merchant.paystack_subaccount_code;
    const gateway: PaymentGateway =
      data.payment_type === 'dva'
        ? 'paystack'
        : data.gateway && PAYMENT_GATEWAYS.includes(data.gateway)
          ? data.gateway
          : selectGateway(
              orderCurrency,
              gatewaySettings,
              hasPaystackSubaccount
            );

    // Resolve the charge currency against the selected gateway. This replaces the
    // old silent NGN coercion: an order whose currency the gateway cannot charge
    // now fails closed (UNSUPPORTED_CURRENCY) instead of being charged in NGN, and
    // a client that explicitly disagrees with the order fails closed
    // (CURRENCY_MISMATCH). NGN orders are supported by every gateway, so the
    // entire existing Nigerian flow is unchanged.
    const currencyResolution = resolveChargeCurrency({
      orderCurrency,
      clientCurrency: clientRequestedCurrency,
      gateway,
    });

    if (!currencyResolution.ok) {
      return createErrorResponse(
        currencyResolution.error,
        currencyResolution.code,
        400
      );
    }

    const chargeCurrency = currencyResolution.currency;

    const payableAmount =
      gateway === 'klump'
        ? snapshotTotal
        : Math.max(snapshotTotal - walletAmountUsed - savingsAmountUsed, 0);

    if (payableAmount <= 0) {
      return createErrorResponse(
        'No payable amount remains for this order',
        'NO_PAYABLE_AMOUNT',
        400
      );
    }

    const paymentData: AuthorizedPaymentInitRequest = {
      ...data,
      amount: payableAmount,
      currency: chargeCurrency,
    };

    if (gateway === 'korapay' && !gatewaySettings.korapay_enabled) {
      return createErrorResponse(
        'Korapay is not enabled for this merchant',
        'GATEWAY_DISABLED',
        400
      );
    }

    if (gateway === 'paystack' && !gatewaySettings.paystack_enabled) {
      return createErrorResponse(
        'Paystack is not enabled for this merchant',
        'GATEWAY_DISABLED',
        400
      );
    }

    const klumpChargeAmount = toKlumpIntegerAmount(snapshotTotal);

    if (gateway === 'klump') {
      if (!gatewaySettings.klump_enabled) {
        return createErrorResponse(
          'Klump is not enabled for this merchant',
          'GATEWAY_DISABLED',
          400
        );
      }

      // Defense-in-depth: resolveChargeCurrency already rejects a non-NGN order
      // routed to Klump (NGN-only) with UNSUPPORTED_CURRENCY before this point.
      if (chargeCurrency !== 'NGN') {
        return createErrorResponse(
          'Klump only supports NGN payments',
          'UNSUPPORTED_CURRENCY',
          400
        );
      }

      if (walletAmountUsed > 0 || savingsAmountUsed > 0) {
        return createErrorResponse(
          'Klump requires the full order total; wallet-composed Klump payments are not supported',
          'AMOUNT_COMPOSITION_UNSUPPORTED',
          400
        );
      }

      if (
        klumpChargeAmount < gatewaySettings.klump_min_amount ||
        klumpChargeAmount > gatewaySettings.klump_max_amount
      ) {
        return createErrorResponse(
          'Order total is outside the merchant Klump amount range',
          'AMOUNT_OUT_OF_RANGE',
          400
        );
      }
    }

    // Generate reference and URLs
    // Use customAlphabet with uppercase-safe alphabet for consistent uppercase references
    const nanoidUppercase = customAlphabet(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      12
    );
    const reference =
      gateway === 'juicyway'
        ? generateJuicywayReference('baci')
        : `BAC-${nanoidUppercase()}`;
    const redirectUrl = `${protocol}://${merchant.slug}.${rootDomain}/checkout/success?reference=${reference}`;

    // Initialize payment based on gateway
    let paymentResult: PaymentResult;

    try {
      switch (gateway) {
        case 'juicyway':
          if (!process.env.JUICYWAY_SECRET_KEY) {
            return createErrorResponse(
              'Crypto payments (Juicyway) are not configured. Please contact support or use another payment method.',
              'GATEWAY_NOT_CONFIGURED',
              400
            );
          }
          paymentResult = await initializeJuicyway(
            request,
            paymentData,
            merchant,
            redirectUrl,
            reference,
            merchantId
          );
          break;

        case 'paystack':
          if (!merchant.paystack_subaccount_code) {
            return createErrorResponse(
              'Paystack is not configured for this merchant',
              'GATEWAY_NOT_CONFIGURED',
              400
            );
          }

          // DVA (Dedicated Virtual Account) for bank transfer payments
          if (data.payment_type === 'dva') {
            if (!gatewaySettings.wallet_paystack_dva_enabled) {
              return createErrorResponse(
                'Bank transfer is not enabled for this merchant.',
                'GATEWAY_DISABLED',
                400
              );
            }

            if (
              !isNigerianPaystackCustomer(
                data,
                formatPhoneToE164(paymentData.customer_phone)
              )
            ) {
              return createErrorResponse(
                'Bank transfer is only available for Nigerian checkout details. Please choose card payment or another available method.',
                'PAYMENT_METHOD_COUNTRY_UNSUPPORTED',
                400
              );
            }

            const { createDedicatedVirtualAccount } = await import(
              '@/lib/agentic/paystack'
            );
            const { firstName, lastName } = parseCustomerName(
              paymentData.customer_name
            );

            const dvaResult = await createDedicatedVirtualAccount(
              {
                email: paymentData.customer_email,
                first_name: firstName,
                last_name: lastName,
                phone: paymentData.customer_phone || '',
              },
              { subaccount: merchant.paystack_subaccount_code }
            );

            const fees = calculatePaystackFee(
              Math.round(paymentData.amount * 100)
            );

            // B1 (Δ-10): persist the DVA assignment so the webhook can
            // look up the order by `account_number` when Paystack sends
            // `charge.success` for this DVA. Paystack DVAs don't carry
            // an explicit expires_at — we default to assigned_at + 90min
            // (1h customer-facing countdown + 30min inter-bank
            // settlement grace). The matcher in `paystack-dva-multi-
            // key-match.ts` further clamps at LEAST(expires_at,
            // assigned_at + 90min) so this default is also the ceiling.
            // Upsert keyed on (order_id, provider) via the existing
            // `unique_order_account` constraint (baseline.sql:11659).
            // `assigned_at` is refreshed on retries so the webhook
            // window follows the current account assignment rather
            // than the row's first insert time.
            const reservationSupabase = await createServerSupabaseClient();
            const persistenceFailure = await persistPaystackDvaAssignment(
              reservationSupabase,
              {
                accountName: dvaResult.account_name,
                accountNumber: dvaResult.account_number,
                bankName: dvaResult.bank_name,
                customerEmail: paymentData.customer_email,
                orderId: paymentData.order_id,
              }
            );
            if (persistenceFailure) return persistenceFailure;

            paymentResult = {
              authorization_url: '',
              dva: {
                bank_name: dvaResult.bank_name,
                account_number: dvaResult.account_number,
                account_name: dvaResult.account_name,
              },
              reference,
              platformFee: fees.platformFee / 100,
              merchantAmount: fees.merchantAmount / 100,
            };
          } else {
            paymentResult = await initializePaystack(
              paymentData,
              merchant,
              gatewaySettings,
              redirectUrl,
              reference,
              merchantId
            );
          }
          break;
        case 'credit_direct':
        case 'credpal': {
          // For client-side BNPL gateways, we redirect to the specialized launcher page
          // This page handles the client-side SDK loading and prevents checkout crashes
          const bnplQuery = new URLSearchParams({
            orderId: paymentData.order_id,
            gateway,
          });
          if (trackingToken) {
            bnplQuery.set('trackingToken', trackingToken);
          }
          const launcherUrl = buildBnplLauncherUrl(
            request,
            merchant.slug,
            rootDomain,
            bnplQuery
          );
          paymentResult = {
            authorization_url: launcherUrl,
            checkout_url: launcherUrl,
            reference, // Use the generated reference
            platformFee: 0, // Fees calculated client-side or by gateway
            merchantAmount: paymentData.amount, // Full amount (fees handled separately)
          };
          break;
        }
        case 'klump': {
          // Klump still uses the Baci BNPL launcher, but it needs the BAC
          // reference in the URL so the launcher can record Klump's provider id
          // before any success page is shown.
          const bnplQuery = new URLSearchParams({
            gateway,
            orderId: paymentData.order_id,
            reference,
          });
          if (trackingToken) {
            bnplQuery.set('trackingToken', trackingToken);
          }
          const launcherUrl = buildBnplLauncherUrl(
            request,
            merchant.slug,
            rootDomain,
            bnplQuery
          );
          paymentResult = {
            authorization_url: launcherUrl,
            checkout_url: launcherUrl,
            reference,
            platformFee: 0,
            merchantAmount: klumpChargeAmount,
          };
          break;
        }

        default:
          paymentResult = await initializeKorapay(
            paymentData,
            merchant,
            redirectUrl,
            reference,
            notificationUrl,
            merchantId
          );
          break;
      }
    } catch (gatewayError) {
      const message =
        gatewayError instanceof Error ? gatewayError.message : 'Unknown error';
      console.error(
        'Gateway initialization failed [%s]:',
        gateway,
        gatewayError
      );
      return createErrorResponse(
        `Payment gateway (${gateway}) initialization failed: ${message}`,
        'GATEWAY_INIT_ERROR',
        502
      );
    }

    // Juicyway is a stablecoin rail: the webhook reports the settled amount in
    // the session currency (USDT/USDC cents), which is NOT comparable to the
    // NGN order total. Persist the expected settlement amount + locked FX rate
    // inside the initial transaction insert so a fast webhook can never observe
    // a transaction row without the strict validation metadata.
    const juicywayCrypto = paymentResult.crypto_payment;
    const transactionMetadata =
      gateway === 'juicyway' && juicywayCrypto?.expected_session_amount != null
        ? {
            // Stablecoin minor units (cents), incl. Juicyway fee.
            juicyway_expected_amount: juicywayCrypto.expected_session_amount,
            juicyway_expected_currency:
              juicywayCrypto.expected_session_currency ??
              juicywayCrypto.currency,
            juicyway_fx_rate: juicywayCrypto.conversion_rate ?? null,
          }
        : {};

    // Create transaction record (via RPC) and update order status
    const { error: transactionError } = await adminSupabase.rpc(
      'create_payment_transaction',
      {
        p_merchant_id: merchantId,
        p_order_id: paymentData.order_id,
        p_amount: gateway === 'klump' ? snapshotTotal : paymentData.amount, // Klump keeps decimal total; p_merchant_amount stores rounded integer.
        p_currency: paymentData.currency,
        p_gateway: gateway,
        p_reference: paymentResult.reference,
        p_platform_fee: paymentResult.platformFee,
        p_merchant_amount: paymentResult.merchantAmount,
        p_customer_email: paymentData.customer_email,
        p_customer_name: paymentData.customer_name,
        p_session_id: paymentResult.sessionId || null,
        p_metadata: transactionMetadata,
      }
    );

    if (transactionError) {
      console.error('Error creating transaction record:', transactionError);
      return createErrorResponse(
        'Failed to create transaction',
        'TRANSACTION_CREATE_FAILED',
        500
      );
    }

    // Return success response
    return NextResponse.json({
      success: true,
      reference: paymentResult.reference,
      gateway,
      checkout_url: paymentResult.checkout_url,
      authorization_url: paymentResult.authorization_url,
      ...(paymentResult.virtual_account && {
        virtual_account: paymentResult.virtual_account,
      }),
      ...(paymentResult.dva && {
        dva: paymentResult.dva,
      }),
      ...(paymentResult.crypto_payment && {
        crypto_payment: paymentResult.crypto_payment,
      }),
      ...(paymentResult.crypto_address_pending && {
        crypto_address_pending: true,
      }),
      ...(paymentResult.sessionId && {
        session_id: paymentResult.sessionId,
      }),
    });
  } catch (error) {
    console.error('Payment initialization error:', error);
    return NextResponse.json(
      {
        error: 'Failed to initialize payment',
        code: 'PAYMENT_INIT_ERROR',
      },
      { status: 500 }
    );
  }
}
