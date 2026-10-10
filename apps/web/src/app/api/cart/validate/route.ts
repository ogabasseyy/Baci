import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { getEffectiveStock } from '@/lib/product-stock';
import { createClient } from '@/lib/supabase/server';
import { cartValidateSchema } from '@/schemas/cart';
import {
  fetchCartOfferPrices,
  type OfferQueryResult,
} from './cart-offer-prices';
import { prepareCartValidationItems } from './prepare-cart-validation-items';
import {
  getCartValidationKey,
  getInvalidOfferLineKey,
  isOfferParentEligible,
} from './resolve-cart-validation-offer-line';

type CartProductRow = {
  id: string;
  name: string;
  price: number | string | null;
  stock: number | null;
  stock_quantity: number | null;
  status: string | null;
  manage_stock: boolean | null;
  has_condition_offers: boolean | null;
  has_variants: boolean | null;
  variant_model: string | null;
};

type CartVariantRow = {
  id: string;
  product_id: string;
  price_override: number | string | null;
};

function toPriceNumber(value: number | string | null | undefined) {
  const price = Number(value ?? 0);
  return Number.isFinite(price) ? price : 0;
}

/**
 * POST /api/cart/validate
 *
 * Body: { productIds?: string[], cartItems?: { id, price, variantId?, offerId? }[] }
 */
export async function POST(request: NextRequest) {
  try {
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = cartValidateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { productIds, cartItems } = parsed.data;
    const {
      validationItems,
      validFormatIds,
      invalidFormatIds,
      validVariantIds,
    } = prepareCartValidationItems(cartItems, productIds);

    if (!validationItems.length) {
      return NextResponse.json({
        validProducts: [],
        invalidProductIds: [],
        priceChanges: [],
      });
    }

    const supabase = await createClient();

    // Public-catalog intent: this lookup is deliberately unscoped by
    // merchant — prices/stock/status are public data (identical values
    // render on unauthenticated PDPs) and carts carry no merchant session.
    // Merchant-scoped price enforcement lives in the orders route
    // (computeOrderNegotiationDiscount + the order RPC), so validating a
    // foreign active ID here cannot discount or misprice an order.
    // Offer lines need the variant list too: the parent gate rejects
    // stale offers on products that gained live variants.
    const needsVariantList =
      validVariantIds.length > 0 ||
      validationItems.some((item) => !item.variantId && item.offerId);
    const [productsResult, variantsResult, offerMap] = await Promise.all([
      validFormatIds.length > 0
        ? supabase
            .from('products')
            .select(
              'id, name, price, stock, stock_quantity, status, manage_stock, has_condition_offers, has_variants, variant_model'
            )
            .in('id', validFormatIds)
            .returns<CartProductRow[]>()
        : Promise.resolve({ data: null, error: null }),
      needsVariantList && validFormatIds.length > 0
        ? (supabase.rpc('get_storefront_product_variants', {
            p_product_ids: Array.from(new Set(validFormatIds)),
          }) as unknown as Promise<{
            data: CartVariantRow[] | null;
            error: { message: string } | null;
          }>)
        : Promise.resolve({ data: null, error: null }),
      fetchCartOfferPrices(
        (productId) =>
          supabase.rpc('get_product_offers', {
            p_product_id: productId,
          }) as unknown as Promise<OfferQueryResult>,
        validationItems
      ).catch((error: unknown) =>
        error instanceof Error ? error : new Error('Offer query failed')
      ),
    ]);

    if (productsResult.error) {
      console.error('Cart validation query error:', productsResult.error);
      return NextResponse.json(
        { error: `Failed to validate cart: ${productsResult.error.message}` },
        { status: 500 }
      );
    }

    if (variantsResult.error) {
      console.error(
        'Cart validation variant query error:',
        variantsResult.error
      );
      return NextResponse.json(
        { error: `Failed to validate cart: ${variantsResult.error.message}` },
        { status: 500 }
      );
    }

    if (offerMap instanceof Error) {
      console.error('Cart validation offer query error:', offerMap);
      return NextResponse.json(
        { error: `Failed to validate cart: ${offerMap.message}` },
        { status: 500 }
      );
    }

    const products = productsResult.data || [];
    const variants = variantsResult.data || [];

    const productMap = new Map(
      products.map((product) => [String(product.id), product])
    );
    const variantMap = new Map(
      variants.map((variant) => [String(variant.id), variant])
    );
    const productsWithLiveVariants = new Set(
      variants.map((variant) => String(variant.product_id))
    );

    const validProducts: {
      id: string;
      price: number;
      stock: number;
      manage_stock: boolean;
      name: string;
      variantId?: string;
      offerId?: string;
    }[] = [];
    const invalidProductIds: string[] = [...invalidFormatIds];
    const priceChanges: {
      id: string;
      variantId?: string;
      offerId?: string;
      oldPrice: number;
      newPrice: number;
    }[] = [];
    const seenPriceChangeKeys = new Set<string>();

    for (const item of validationItems) {
      const strId = String(item.id);
      const product = productMap.get(strId);

      if (product?.status !== 'active') {
        // Malformed ids arrive pre-seeded from invalidFormatIds, so the
        // includes check alone covers both shapes without re-testing.
        if (!invalidProductIds.includes(strId)) {
          invalidProductIds.push(strId);
        }
        continue;
      }

      const variant = item.variantId ? variantMap.get(item.variantId) : null;
      const variantBelongsToProduct =
        variant && String(variant.product_id) === strId;

      if (item.variantId && !variantBelongsToProduct) {
        const invalidVariantKey = getCartValidationKey(
          strId,
          item.variantId,
          item.offerId
        );
        if (!invalidProductIds.includes(invalidVariantKey)) {
          invalidProductIds.push(invalidVariantKey);
        }
        continue;
      }

      // Non-variant offer lines price from the live condition offer, not
      // the parent: pricing them from products.price would silently
      // replace the advertised offer price on every validation pass.
      const offer =
        !item.variantId && item.offerId
          ? offerMap.get(`${strId}::${item.offerId}`)
          : undefined;
      const invalidOfferKey = getInvalidOfferLineKey({
        strId,
        variantId: item.variantId,
        offerId: item.offerId,
        submittedCondition: item.condition,
        offer,
        parentEligible: isOfferParentEligible(
          product,
          productsWithLiveVariants.has(strId)
        ),
      });
      if (invalidOfferKey) {
        if (!invalidProductIds.includes(invalidOfferKey)) {
          invalidProductIds.push(invalidOfferKey);
        }
        continue;
      }

      const currentPrice = toPriceNumber(
        variantBelongsToProduct
          ? (variant.price_override ?? product.price)
          : (offer?.price ?? product.price)
      );

      validProducts.push({
        id: String(product.id),
        price: currentPrice,
        stock: getEffectiveStock(product),
        name: product.name,
        manage_stock: product.manage_stock ?? true,
        ...(item.variantId ? { variantId: item.variantId } : {}),
        ...(item.offerId ? { offerId: item.offerId } : {}),
      });

      if (item.price !== null && item.price !== currentPrice) {
        const priceChangeKey = getCartValidationKey(
          strId,
          item.variantId,
          item.offerId
        );
        if (!seenPriceChangeKeys.has(priceChangeKey)) {
          seenPriceChangeKeys.add(priceChangeKey);
          priceChanges.push({
            id: strId,
            variantId: item.variantId,
            offerId: item.offerId,
            oldPrice: item.price,
            newPrice: currentPrice,
          });
        }
      }
    }

    return NextResponse.json({
      validProducts,
      invalidProductIds,
      priceChanges,
    });
  } catch (error) {
    console.error('Cart validation error:', error);
    return NextResponse.json(
      { error: 'Failed to validate cart' },
      { status: 500 }
    );
  }
}
