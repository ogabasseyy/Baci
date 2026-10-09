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

type CartProductRow = {
  id: string;
  name: string;
  price: number | string | null;
  stock: number | null;
  stock_quantity: number | null;
  status: string | null;
  manage_stock: boolean | null;
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

function getCartValidationKey(
  id: string,
  variantId?: string,
  offerId?: string
) {
  const variantKey = variantId ? `${id}::${variantId}` : id;
  return offerId ? `${variantKey}::offer=${offerId}` : variantKey;
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

    const [productsResult, variantsResult, offerMap] = await Promise.all([
      validFormatIds.length > 0
        ? supabase
            .from('products')
            .select(
              'id, name, price, stock, stock_quantity, status, manage_stock'
            )
            .in('id', validFormatIds)
            .returns<CartProductRow[]>()
        : Promise.resolve({ data: null, error: null }),
      validVariantIds.length > 0 && validFormatIds.length > 0
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
      // replace the advertised offer price on every validation pass. A
      // missing row means the offer is gone (the RPC returns active rows
      // only), so only that line is invalidated.
      const offer =
        !item.variantId && item.offerId
          ? offerMap.get(`${strId}::${item.offerId}`)
          : undefined;
      if (!item.variantId && item.offerId && !offer) {
        const invalidOfferKey = getCartValidationKey(
          strId,
          undefined,
          item.offerId
        );
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
        manage_stock: Boolean(product.manage_stock),
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
