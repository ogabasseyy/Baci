import { makeOfferLineKey } from '@baci/shared/lib';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { createOfferAuthorityRpcCall } from '@/lib/supabase/offer-authority-rpc';
import { createClient } from '@/lib/supabase/server';
import { cartValidateSchema } from '@/schemas/cart';
import { fetchCartOfferPrices } from './cart-offer-prices';
import {
  buildCartValidationCatalog,
  fetchAllStorefrontProductVariants,
  fetchStrictPoolUnits,
  resolveCartValidationCatalog,
} from './cart-validation-catalog';
import { prepareCartValidationItems } from './prepare-cart-validation-items';
import {
  buildOfferQuantityTotals,
  buildSimpleProductQuantityTotals,
  getCartValidationKey,
  getInvalidOfferLineKey,
  readOfferQuantityTotal,
  readSimpleProductQuantityTotal,
  resolveReportedLineStock,
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
  inventory_tracking_policy: string | null;
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
 * Body: { productIds?: string[], cartItems?: { id, price, quantity?, variantId?, offerId?, condition? }[] }
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
    // The offer parent gate lives in the SQL authority (each row
    // carries parent_eligible), so the variant list is only needed for
    // variant lines themselves.
    const needsVariantList = validVariantIds.length > 0;
    const [productsResult, variantsResult, offerMap] = await Promise.all([
      validFormatIds.length > 0
        ? supabase
            .from('products')
            .select(
              'id, name, price, stock, stock_quantity, status, manage_stock, has_condition_offers, has_variants, variant_model, inventory_tracking_policy'
            )
            .in('id', validFormatIds)
            .returns<CartProductRow[]>()
        : Promise.resolve({ data: null, error: null }),
      needsVariantList && validFormatIds.length > 0
        ? fetchAllStorefrontProductVariants<CartVariantRow>({
            supabase,
            productIds: Array.from(new Set(validFormatIds)),
          })
        : Promise.resolve({ data: null, error: null }),
      fetchCartOfferPrices(
        createOfferAuthorityRpcCall(supabase),
        validationItems
      ).catch((error: unknown) =>
        error instanceof Error ? error : new Error('Offer query failed')
      ),
    ]);

    const catalog = resolveCartValidationCatalog({
      productsResult,
      variantsResult,
      offerMap,
    });
    if (catalog.catalogError) {
      return catalog.catalogError;
    }
    const validatedOfferMap = catalog.offerMap;

    const products = productsResult.data || [];
    const variants = variantsResult.data || [];

    const { productMap, variantMap } = buildCartValidationCatalog(
      products,
      variants
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

    const offerQuantityTotals = buildOfferQuantityTotals(validationItems);
    const simpleProductTotals =
      buildSimpleProductQuantityTotals(validationItems);
    const strictPoolUnits = await fetchStrictPoolUnits({
      supabase,
      products,
      simpleProductTotals,
    });

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
          ? validatedOfferMap.get(makeOfferLineKey(strId, String(item.offerId)))
          : undefined;
      const invalidOfferKey = getInvalidOfferLineKey({
        strId,
        variantId: item.variantId,
        offerId: item.offerId,
        submittedCondition: item.condition,
        quantity: item.quantity,
        aggregateOfferQuantity:
          !item.variantId && item.offerId
            ? readOfferQuantityTotal(offerQuantityTotals, strId, item.offerId)
            : undefined,
        aggregateSimpleQuantity: !item.variantId
          ? readSimpleProductQuantityTotal(simpleProductTotals, strId)
          : undefined,
        strictPoolUnits: strictPoolUnits.get(strId),
        isQuizVoucherLine: item.isQuizVoucherLine,
        offer,
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
        stock: resolveReportedLineStock(item, offer, product),
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
