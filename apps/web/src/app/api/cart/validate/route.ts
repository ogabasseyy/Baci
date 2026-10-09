import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { getEffectiveStock } from '@/lib/product-stock';
import { createClient } from '@/lib/supabase/server';
import { cartValidateSchema } from '@/schemas/cart';

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

type CartValidationItem = {
  id: string;
  price: number | null;
  variantId?: string;
  offerId?: string;
};

type CartOfferRow = {
  offer_id: string;
  price: number | string | null;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeVariantId(
  item: { variantId?: string; variant_id?: string } | undefined
) {
  return item?.variantId || item?.variant_id || undefined;
}

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
    const hasCartItems = Array.isArray(cartItems) && cartItems.length > 0;
    const validationItems: CartValidationItem[] = hasCartItems
      ? cartItems.map((item) => ({
          id: item.id,
          price: item.price,
          variantId: normalizeVariantId(item),
          offerId: item.offerId,
        }))
      : (productIds ?? []).map((id) => ({ id, price: null }));
    const idsToValidate = validationItems.map((item) => item.id);

    if (!idsToValidate.length) {
      return NextResponse.json({
        validProducts: [],
        invalidProductIds: [],
        priceChanges: [],
      });
    }

    const validFormatIds: string[] = [];
    const invalidFormatIds: string[] = [];
    const validVariantIds = Array.from(
      new Set(
        validationItems
          .map((item) => item.variantId)
          .filter(
            (variantId): variantId is string =>
              typeof variantId === 'string' && uuidRegex.test(variantId)
          )
      )
    );

    for (const id of idsToValidate) {
      const strId = String(id);
      if (uuidRegex.test(strId)) {
        validFormatIds.push(strId);
      } else {
        const safeId = strId.replace(/[\r\n]/g, '').slice(0, 50);
        console.warn(`Cart contains invalid product ID format: "${safeId}"`);
        invalidFormatIds.push(strId);
      }
    }

    const supabase = await createClient();

    // Products with non-variant offer lines need their live condition
    // offers (the public RPC returns active rows only, so a missing row
    // means the offer is gone). Variant lines price from the variant
    // override, never from an offer.
    const offerProductIds = Array.from(
      new Set(
        validationItems
          .filter(
            (item) =>
              !item.variantId &&
              typeof item.offerId === 'string' &&
              uuidRegex.test(item.offerId) &&
              uuidRegex.test(String(item.id))
          )
          .map((item) => String(item.id))
      )
    );

    const [productsResult, variantsResult, offersResults] = await Promise.all([
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
      Promise.all(
        offerProductIds.map(
          async (
            productId
          ): Promise<{
            productId: string;
            data: CartOfferRow[] | null;
            error: { message: string } | null;
          }> => {
            const result = (await supabase.rpc('get_product_offers', {
              p_product_id: productId,
            })) as unknown as {
              data: CartOfferRow[] | null;
              error: { message: string } | null;
            };
            return { productId, ...result };
          }
        )
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

    const offerError = offersResults.find((result) => result.error)?.error;
    if (offerError) {
      console.error('Cart validation offer query error:', offerError);
      return NextResponse.json(
        { error: `Failed to validate cart: ${offerError.message}` },
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
    const offerMap = new Map(
      offersResults.flatMap((result) =>
        (result.data || []).map(
          (offer) =>
            [`${result.productId}::${String(offer.offer_id)}`, offer] as const
        )
      )
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
        if (uuidRegex.test(strId) && !invalidProductIds.includes(strId)) {
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
