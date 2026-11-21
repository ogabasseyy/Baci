import { getMoneyCurrencyExponent } from '@baci/shared/money';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadPublicMerchantRates } from '@/app/api/shipping/quotes/load-public-merchant-rates';
import { readCartJsonBody } from '@/lib/cart/request-context';
import { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import {
  ChatwootCommerceContextError,
  verifyChatwootSessionCapability,
} from '@/lib/chatwoot/commerce-context';
import {
  haveSameChatwootDeliveryOptionLines,
  isChatwootDeliveryOptionsCartValid,
} from '@/lib/chatwoot/delivery-options-cart';
import { projectChatwootDeliveryOptions } from '@/lib/chatwoot/delivery-options-projection';
import { loadChatwootMerchantCurrency } from '@/lib/chatwoot/merchant-currency';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getSubdivisions,
  resolveSubdivisionCode,
} from '@/lib/shipping/merchant-rates/subdivisions';
import { chatwootDeliveryOptionsRequestSchema } from '@/schemas/chatwoot-delivery-options';

// This pilot endpoint serves Nigerian destinations and NGN merchants only.

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function unavailable(status: number, code: string) {
  return NextResponse.json(
    { error: 'Delivery options unavailable', code },
    { status, headers: NO_STORE_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return unavailable(403, 'forbidden');
  }

  const rawBody = await readCartJsonBody(request);
  if (!rawBody.ok) return unavailable(400, 'invalid_request');
  const parsed = chatwootDeliveryOptionsRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) return unavailable(400, 'invalid_request');

  let cartContext: Awaited<ReturnType<typeof loadChatwootCartContext>>;
  try {
    cartContext = await loadChatwootCartContext(request);
  } catch {
    return unavailable(503, 'cart_context_unavailable');
  }
  if (!cartContext.ok) {
    return unavailable(cartContext.status, cartContext.code);
  }

  try {
    const verifiedSession = await verifyChatwootSessionCapability({
      binding: cartContext.binding,
      sessionToken: parsed.data.sessionToken,
      state: cartContext.state,
    });
    if (verifiedSession.conversationId !== parsed.data.conversationId) {
      return unavailable(403, 'invalid_session');
    }
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) {
      return unavailable(
        error.code === 'invalid_config' ? 503 : 403,
        error.code
      );
    }
    return unavailable(503, 'temporarily_unavailable');
  }

  const cart = cartContext.cart;
  if (cart.version !== parsed.data.expectedCartVersion) {
    return unavailable(409, 'cart_changed');
  }
  if (cart.estimatedTotals) {
    return unavailable(409, 'cart_requires_review');
  }
  if (!isChatwootDeliveryOptionsCartValid(cart)) {
    return unavailable(409, 'cart_changed');
  }

  const merchantCurrency = await loadChatwootMerchantCurrency(cart.merchantId);
  if (!merchantCurrency) {
    return unavailable(503, 'merchant_context_unavailable');
  }
  if (
    merchantCurrency.currency !== 'NGN' ||
    (merchantCurrency.country && merchantCurrency.country !== 'NG')
  ) {
    return unavailable(409, 'merchant_rate_context_unavailable');
  }

  const subdivisionCode = resolveSubdivisionCode('NG', parsed.data.state);
  const subdivision = getSubdivisions('NG').find(
    (candidate) => candidate.code === subdivisionCode
  );
  if (!subdivision) return unavailable(400, 'invalid_state');

  let merchantRates: Awaited<ReturnType<typeof loadPublicMerchantRates>>;
  try {
    merchantRates = await loadPublicMerchantRates(cart.merchantId, {
      receiverCountryCode: 'NG',
      receiverState: subdivision.name,
      merchantCurrency: merchantCurrency.currency,
      cartSubtotal: Number(
        (
          cart.subtotalMinor /
          10 ** getMoneyCurrencyExponent(cart.currency)
        ).toFixed(getMoneyCurrencyExponent(cart.currency))
      ),
    });
  } catch {
    return unavailable(503, 'rate_lookup_unavailable');
  }
  if (merchantRates.loadFailed) {
    return unavailable(503, 'rate_lookup_unavailable');
  }
  if (
    (merchantRates.resolvedCurrency &&
      merchantRates.resolvedCurrency !== merchantCurrency.currency) ||
    (merchantRates.resolvedCountry && merchantRates.resolvedCountry !== 'NG')
  ) {
    return unavailable(409, 'merchant_rate_context_unavailable');
  }

  const latestMerchantCurrency = await loadChatwootMerchantCurrency(
    cart.merchantId
  );
  if (
    !latestMerchantCurrency ||
    latestMerchantCurrency.currency !== merchantCurrency.currency ||
    latestMerchantCurrency.country !== merchantCurrency.country
  ) {
    return unavailable(409, 'merchant_rate_context_unavailable');
  }

  let latestCartContext: Awaited<ReturnType<typeof loadChatwootCartContext>>;
  try {
    latestCartContext = await loadChatwootCartContext(request);
    if (!latestCartContext.ok) {
      return unavailable(409, 'cart_changed');
    }
    const verifiedSession = await verifyChatwootSessionCapability({
      binding: latestCartContext.binding,
      sessionToken: parsed.data.sessionToken,
      state: latestCartContext.state,
    });
    if (verifiedSession.conversationId !== parsed.data.conversationId) {
      return unavailable(403, 'invalid_session');
    }
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) {
      return unavailable(
        error.code === 'invalid_config' ? 503 : 403,
        error.code
      );
    }
    return unavailable(409, 'cart_changed');
  }
  if (
    !isChatwootDeliveryOptionsCartValid(latestCartContext.cart) ||
    latestCartContext.cart.cartId !== cart.cartId ||
    latestCartContext.cart.merchantId !== cart.merchantId ||
    latestCartContext.cart.version !== cart.version ||
    latestCartContext.cart.currency !== cart.currency ||
    latestCartContext.cart.subtotalMinor !== cart.subtotalMinor ||
    latestCartContext.cart.estimatedTotals ||
    !haveSameChatwootDeliveryOptionLines(
      latestCartContext.cart.lines,
      cart.lines
    )
  ) {
    return unavailable(409, 'cart_changed');
  }

  const response = projectChatwootDeliveryOptions({
    state: subdivision.name,
    cartVersion: cart.version,
    currency: 'NGN',
    subtotalMinor: cart.subtotalMinor,
    quotes: merchantRates.quotes,
  });
  if (!response) return unavailable(503, 'rate_projection_unavailable');
  if (response.options.length === 0) {
    return unavailable(409, 'no_delivery_options');
  }

  return NextResponse.json(response, { headers: NO_STORE_HEADERS });
}
