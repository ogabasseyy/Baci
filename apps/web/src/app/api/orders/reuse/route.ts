import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { scheduleReusedOrderInventoryPurge } from '@/lib/schedule-reused-order-inventory-purge';
import {
  enrichShippingAddressWithQuoteDestination,
  OrderQuoteDestinationMismatchError,
  type OrderShippingAddressForQuote,
} from '@/lib/shipping/order-quote-destination';
import { createClient } from '@/lib/supabase/server';
import {
  type ReuseCheckoutOrderInput,
  reuseCheckoutOrderSchema,
} from '@/schemas/orders';
import {
  readOptionalShippingFee,
  readReuseQuoteValidationContext,
} from './quote-validation-context';
import { restampMerchantRateOnReuse } from './restamp-merchant-rate';
import { shippingProviderResolution } from './shipping-provider-resolution';

function mapReuseOrderError(
  error: { message?: string; code?: string } | null | undefined
) {
  const message = error?.message || 'order_not_found';

  if (message === 'order_not_found') {
    return { status: 404, error: 'Order not found' };
  }

  if (
    message === 'unauthorized' ||
    message === 'email_mismatch' ||
    message === 'merchant_mismatch'
  ) {
    return { status: 403, error: 'Unauthorized' };
  }

  if (message === 'serialized_inventory_unavailable') {
    return {
      status: 409,
      error: 'Some items in your order are out of stock',
      code: 'serialized_inventory_unavailable',
    };
  }

  if (message === 'order_already_paid' || message === 'order_not_reusable') {
    return { status: 409, error: 'Order is no longer reusable' };
  }

  return { status: 409, error: 'Order is no longer reusable' };
}

function isExpectedReuseOrderError(
  error: { message?: string; code?: string } | null | undefined
) {
  return (
    !error ||
    [
      'order_not_found',
      'unauthorized',
      'email_mismatch',
      'merchant_mismatch',
      'order_already_paid',
      'order_not_reusable',
      'serialized_inventory_unavailable',
    ].includes(error.message || '')
  );
}

function getSafeReuseOrderErrorMessage(
  error: { message?: string; code?: string } | null | undefined
) {
  return (error?.message || 'unknown')
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 300);
}

type ReuseQuoteValidationResult =
  | { response: NextResponse }
  | {
      selectedQuoteId: string | null;
      shippingAddress: OrderShippingAddressForQuote | undefined;
      shippingProvider: string | null;
    };

async function validateSelectedQuoteForReuse(
  supabase: ReturnType<typeof createClient>,
  data: ReuseCheckoutOrderInput
): Promise<ReuseQuoteValidationResult> {
  const { data: validationData, error } = await supabase.rpc(
    'get_storefront_order_quote_validation_context',
    {
      p_customer_email: data.customer_email,
      p_has_selected_quote_id:
        shippingProviderResolution.hasSelectedQuoteInput(data),
      p_merchant_id: data.merchant_id,
      p_order_id: data.order_id,
      p_selected_quote_id: data.selected_quote_id,
      p_tracking_token: data.tracking_token,
    }
  );

  if (error) {
    const mappedError = mapReuseOrderError(error);
    return {
      response: NextResponse.json(
        {
          error: mappedError.error,
          ...(mappedError.code ? { code: mappedError.code } : {}),
        },
        { status: mappedError.status }
      ),
    };
  }

  const context = readReuseQuoteValidationContext(validationData);
  if (!context) {
    return {
      response: NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      ),
    };
  }

  const shippingFee = readOptionalShippingFee(context.shipping_fee);
  const requestedShippingProvider =
    shippingProviderResolution.normalizeShippingProvider(
      data.shipping_provider
    );
  if (!context.selected_quote_id) {
    return {
      selectedQuoteId: null,
      shippingAddress: undefined,
      shippingProvider: requestedShippingProvider,
    };
  }

  try {
    const suppliedQuoteProvider = requestedShippingProvider
      ? null
      : await shippingProviderResolution.resolveSuppliedQuoteProvider(
          supabase,
          data
        );
    const effectiveShippingProvider =
      requestedShippingProvider ??
      suppliedQuoteProvider ??
      shippingProviderResolution.normalizeShippingProvider(
        context.shipping_provider
      );
    const shippingAddress = await enrichShippingAddressWithQuoteDestination(
      supabase,
      context.selected_quote_id,
      context.shipping_address,
      {
        items: context.order_items,
        merchantId: data.merchant_id,
        shippingFee: Number.isFinite(shippingFee) ? shippingFee : undefined,
        shippingProvider: effectiveShippingProvider,
      }
    );
    return {
      selectedQuoteId: context.selected_quote_id,
      shippingAddress,
      shippingProvider: effectiveShippingProvider,
    };
  } catch (error) {
    if (error instanceof OrderQuoteDestinationMismatchError) {
      return {
        response: NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status }
        ),
      };
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = reuseCheckoutOrderSchema.safeParse(body);

    if (!parsed.success) {
      console.warn('POST /api/orders/reuse validation failed', {
        errors: parsed.error.flatten(),
      });
      return NextResponse.json(
        { error: 'Invalid request data', code: 'validation_error' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const selectedQuoteValidationResponse = await validateSelectedQuoteForReuse(
      supabase,
      parsed.data
    );
    if ('response' in selectedQuoteValidationResponse) {
      return selectedQuoteValidationResponse.response;
    }

    const { data, error } = await supabase.rpc(
      'prepare_storefront_order_for_checkout',
      {
        p_order_id: parsed.data.order_id,
        p_merchant_id: parsed.data.merchant_id,
        p_tracking_token: parsed.data.tracking_token,
        p_customer_email: parsed.data.customer_email,
        p_payment_method: parsed.data.payment_method,
        p_has_selected_quote_id:
          shippingProviderResolution.hasSelectedQuoteInput(parsed.data),
        p_shipping_provider:
          shippingProviderResolution.normalizeShippingProvider(
            parsed.data.shipping_provider
          ) ?? selectedQuoteValidationResponse.shippingProvider,
        p_selected_quote_id: selectedQuoteValidationResponse.selectedQuoteId,
        p_shipping_address:
          selectedQuoteValidationResponse.shippingAddress ?? null,
      }
    );

    const order = Array.isArray(data) ? data[0] : data;

    if (error || !order) {
      const mappedError = mapReuseOrderError(error);
      if (!isExpectedReuseOrderError(error)) {
        console.warn('POST /api/orders/reuse RPC failed', {
          code: error?.code || null,
          message: getSafeReuseOrderErrorMessage(error),
          mappedStatus: mappedError.status,
        });
      }
      return NextResponse.json(
        {
          error: mappedError.error,
          ...(mappedError.code ? { code: mappedError.code } : {}),
        },
        { status: mappedError.status }
      );
    }

    scheduleReusedOrderInventoryPurge({
      merchantId: parsed.data.merchant_id,
      supabase,
    });

    // R14-3: if the checkout forwarded a merchant rate id (a reopened
    // merchant-rate order whose original post-create stamp may have failed),
    // best-effort re-stamp the fulfillment provider + rate name. Never rejects
    // the reuse — the order is prepared regardless of the stamp outcome.
    if (parsed.data.shipping_rate_id) {
      await restampMerchantRateOnReuse({
        orderId: parsed.data.order_id,
        merchantId: parsed.data.merchant_id,
        shippingRateId: parsed.data.shipping_rate_id,
      });
    }

    return NextResponse.json({ order });
  } catch (error) {
    console.warn('POST /api/orders/reuse failed', {
      message: getSafeReuseOrderErrorMessage(
        error instanceof Error ? error : undefined
      ),
    });
    return NextResponse.json(
      {
        error: 'Failed to prepare reusable order',
        code: 'reuse_order_failed',
      },
      { status: 500 }
    );
  }
}
