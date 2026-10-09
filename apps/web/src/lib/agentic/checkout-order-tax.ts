import type { SupabaseClient } from '@supabase/supabase-js';

// Codex P1 (PR #1622 round 5): agentic checkout dispatch builds its
// payload from `calculateCheckoutSession`, which currently computes
// `tax: 0` for every line item and emits no `tax` total. Before
// B3.5 that was harmless — the trigger silently recomputed
// `orders.tax_amount` post-insert and the RPC returned the trigger's
// view. With B3.5's `tax_amount_mismatch` guard, a VAT-registered
// merchant gets RAISE → 400 → checkout broken.
//
// Until `calculateCheckoutSession` learns about VAT (deferred —
// changing the agentic session calc shape touches every consumer of
// `GPTLineItem` / `GPTTotal`), the dispatch layer recomputes the
// expected per-item VAT itself and overrides `p_tax_amount`. The
// formula MUST mirror the RPC's `v_expected_tax` block byte-for-byte
// (which in turn mirrors `populate_order_item_tax` +
// `update_order_tax_totals` triggers) or the dispatch and RPC
// disagree and we're back to mismatch land:
//
//   per-line: vat_category 'S' →
//     ROUND(ROUND(quantity * price, 2) * vat_rate / 100, 2)
//   else: 0
//   total: SUM(per-line)
//
// NULL fallbacks match the `order_items` column defaults the
// BEFORE-INSERT trigger inherits:
//   * vat_category_code → 'S'
//   * vat_rate          → 7.5
// (NOT the merchant rate — the trigger doesn't consult merchant
// rate for the per-line vat_amount.)
//
// For VAT-not-registered merchants the helper returns 0 because the
// RPC enforces `p_tax_amount ≤ 1` in that case.
//
// The `supabase` argument is the caller's standard scoped client
// (anon, authed, or agentic-scoped — whatever the calling context
// already uses). All RLS-respecting reads (merchants, products)
// use that client. The single RLS-bypassing path — reading
// `product_variants.price_override` for the items being ordered —
// goes through the `get_order_variant_overrides` SECURITY DEFINER
// RPC. That RPC is GRANTed to anon/authenticated/service_role and
// returns ONLY `(id, product_id, price_override)`, so the trust
// boundary is bounded to exactly the three columns needed for tax
// math — no PII, no cross-tenant inventory.
//
// (Earlier iterations of this helper used a service-role client in
// the Next.js layer for the variant query. That violated the
// project's zero-trust rule — CLAUDE.md: "NEVER use the
// admin/service-role Supabase client for user-facing operations" —
// and CodeRabbit's High finding on PR #1622 round 7 flagged it.
// The RPC encapsulates the bypass at the database layer instead.)

interface AgenticTaxItem {
  // Optional to accept the dispatch's pre-validation payload shape
  // where `product_id` is `string | undefined` (the dispatch guards
  // missing IDs and returns 400 before we get here). The helper
  // itself skips items with missing product_id defensively.
  product_id?: string;
  variant_id?: string | null;
  offer_id?: string | null;
  quantity: number;
}

interface ProductVatRow {
  id: string;
  price: number | string | null;
  vat_category_code: string | null;
  vat_rate: number | string | null;
}

// Codex P2 (PR #1622 round 7): the helper's `.in('id', productIds)` /
// `.in('id', variantIds)` queries hit Postgres's UUID parser with the
// raw client strings. Zod only validates these as `string`, so a
// malformed item id (e.g. a slug, a stale autoincrement int) makes the
// DB return error code `22P02` ("invalid input syntax for type
// uuid"). The previous behavior at /api/orders mapped 22P02 as a
// CLIENT error (see `clientErrorCodes` in the route — '22P02' is in
// the list). The new pre-RPC tax compute was reporting those as
// `TAX_COMPUTE_FAILED` 500, regressing that mapping. Carry the pg
// code on the thrown error so callers can map 22P02 → 4xx and
// everything else → 5xx.
export class TaxComputeError extends Error {
  readonly pgCode: string | undefined;
  constructor(message: string, pgCode?: string | null | undefined) {
    super(message);
    this.name = 'TaxComputeError';
    this.pgCode = typeof pgCode === 'string' ? pgCode : undefined;
  }
}

/** True if the helper failed due to a Postgres UUID parse error. */
export function isTaxComputeUuidError(err: unknown): boolean {
  return err instanceof TaxComputeError && err.pgCode === '22P02';
}

interface VariantPriceRow {
  id: string;
  // High finding (PR #1622 review): variants must be validated to
  // belong to the same product the order line claims. The RPC's
  // LEFT JOIN enforces `v.product_id = p.id` (so a mismatched
  // variant_id falls through to NULL and price_override defaults to
  // base price). The helper must mirror that or it can apply the
  // wrong override and trip the parity guard for orders containing
  // a spoofed cross-product variant_id.
  product_id: string;
  price_override: number | string | null;
}

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function computeAgenticOrderTax({
  items,
  merchantId,
  offerPrices,
  supabase,
}: {
  items: AgenticTaxItem[];
  merchantId: string;
  // Live offer prices by `${product_id}::${offer_id}`, loaded once by the
  // route alongside offer verification. The RPC taxes the resolved line
  // price (variant override, then live offer, then parent), so this
  // helper must tax the same basis or valid offer orders trip the
  // `tax_amount_mismatch` guard.
  offerPrices?: Map<string, number>;
  supabase: SupabaseClient;
}): Promise<number> {
  if (items.length === 0 || !merchantId) {
    return 0;
  }

  // Codex P2 (PR #1622 round 5): destructuring `{ data: merchant }`
  // alone drops the `error` field, so a transient DB/RLS failure
  // looks identical to "merchant not registered" — helper returned
  // 0, dispatch sent `p_tax_amount: 0`, RPC RAISEd
  // `tax_amount_mismatch`, dispatch reported 400. That made
  // server-side infra failures look like client validation errors
  // and the caller (GPT agent) would not retry. Throw on real
  // errors so the dispatch's catch maps to 500 and the caller
  // retries the call as an infrastructure issue. NULL `data` with
  // no error is still treated as "not registered" — the merchant
  // may have been deleted mid-flow; `create_storefront_order` will
  // RAISE `merchant_not_found` shortly after and the dispatch will
  // map that to 400, which is correct.
  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('vat_registration_status')
    .eq('id', merchantId)
    .maybeSingle();

  if (merchantError) {
    throw new TaxComputeError(
      `Failed to load merchant VAT status: ${merchantError.message}`,
      (merchantError as { code?: string }).code
    );
  }

  if (merchant?.vat_registration_status !== 'registered') {
    return 0;
  }

  const productIds = Array.from(
    new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))
  );
  const variantIds = Array.from(
    new Set(
      items
        .map((i) => i.variant_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  if (productIds.length === 0) return 0;

  // Same Codex P2 reasoning as the merchant lookup: a query error
  // here must not silently degrade to "0 tax" because that pretends
  // to be a successful compute and trips the RPC parity guard with
  // a misleading 4xx. Propagate as a throwable so the dispatch's
  // try/catch returns 500 and the caller retries.
  //
  // High finding (PR #1622 review): the products SELECT MUST be
  // scoped to `merchant_id`. `products_select_policy` (baseline:15317)
  // allows `status = 'active'` reads from any client, including
  // anonymous and agentic-scoped JWTs. Without `.eq('merchant_id',
  // merchantId)`, a caller could pass cross-tenant product IDs and
  // the helper would compute tax against another merchant's prices
  // / VAT categories — the RPC itself scopes
  // `products p ON p.id = r.product_id AND p.merchant_id = p_merchant_id`,
  // so the helper must match.
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, price, vat_category_code, vat_rate')
    .eq('merchant_id', merchantId)
    .in('id', productIds)
    .returns<ProductVatRow[]>();

  if (productsError) {
    throw new TaxComputeError(
      `Failed to load products for VAT computation: ${productsError.message}`,
      (productsError as { code?: string }).code
    );
  }

  // CodeRabbit High (PR #1622 round 7): route through the
  // `get_order_variant_overrides` SECURITY DEFINER RPC instead of
  // a direct `product_variants` SELECT. Every RLS policy on that
  // table keys on `merchants.user_id = auth.uid()`, so anon /
  // agentic-scoped / non-owner-authed JWTs all see zero rows. The
  // earlier service-role-client workaround violated the project's
  // zero-trust rule; the RPC moves the bounded bypass to the
  // database layer where it belongs. The function returns ONLY
  // `(id, product_id, price_override)` for the supplied ids — no
  // PII, no cross-tenant inventory.
  //
  // Distinct from `get_storefront_product_variants`, which filters
  // to `m.is_published = TRUE` and broke the agentic /
  // setup-mode-admin paths (the P2 finding the service-role
  // attempt was trying to fix). This RPC has no publication
  // filter.
  const { data: variantsData, error: variantsError } = variantIds.length
    ? ((await supabase.rpc('get_order_variant_overrides', {
        p_variant_ids: variantIds,
      })) as unknown as {
        data: VariantPriceRow[] | null;
        error: { message: string; code?: string } | null;
      })
    : { data: [] as VariantPriceRow[], error: null };

  if (variantsError) {
    throw new TaxComputeError(
      `Failed to load product variants for VAT computation: ${variantsError.message}`,
      variantsError.code
    );
  }

  const productMap = new Map((products ?? []).map((p) => [p.id, p]));
  const variantMap = new Map((variantsData ?? []).map((v) => [v.id, v]));

  let total = 0;
  for (const item of items) {
    if (!item.product_id) continue;
    const product = productMap.get(item.product_id);
    if (!product) continue;

    const category = product.vat_category_code ?? 'S';
    if (category !== 'S') continue;

    // High finding (PR #1622 review): variant must belong to the
    // SAME product the order line claims. The RPC's LEFT JOIN
    // (`v.product_id = p.id`) enforces this and falls back to base
    // price for mismatched variant_ids; the helper must mirror it
    // or a caller can spoof a variant_id from a different product
    // and trip the parity guard. SDF returns variants for ALL
    // products in `productIds`, so cross-line ambiguity exists when
    // multiple products are in the cart.
    const candidateVariant = item.variant_id
      ? variantMap.get(item.variant_id)
      : null;
    const variant =
      candidateVariant && candidateVariant.product_id === item.product_id
        ? candidateVariant
        : null;
    // Mirror the RPC precedence: the key pins the offer to this line's
    // product, so a cross-product offer_id falls through to the parent
    // price (the route rejects the mismatch before the RPC runs).
    const offerPrice =
      item.offer_id && item.product_id
        ? offerPrices?.get(`${item.product_id}::${item.offer_id}`)
        : undefined;
    const priceRaw =
      variant?.price_override ?? offerPrice ?? product.price ?? 0;
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) continue;

    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const rate = Number(product.vat_rate ?? 7.5);
    if (!Number.isFinite(rate) || rate < 0) {
      // CodeRabbit (PR #1622 round 7): silently skipping a line
      // with a corrupt vat_rate would produce a smaller
      // expected_tax than the trigger's per-line sum, then the
      // RPC would RAISE `tax_amount_mismatch` with no breadcrumb
      // pointing at the bad product. Throw with the product
      // context so ops can find the row immediately. The dispatch
      // / route catch maps `TaxComputeError` (non-22P02) to a
      // 500 with a sanitized log entry — this is genuine bad
      // data, not a client-correctable input.
      throw new TaxComputeError(
        `Invalid vat_rate on product ${product.id}: got ${String(product.vat_rate)}`
      );
    }

    const lineExtension = roundToCents(quantity * price);
    const lineTax = roundToCents((lineExtension * rate) / 100);
    total += lineTax;
  }

  return roundToCents(total);
}
