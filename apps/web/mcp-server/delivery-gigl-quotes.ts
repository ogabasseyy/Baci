import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { MCP_DELIVERY_MAX_UNIT_WEIGHT_KG, type mcpDeliveryFeeInfoInputSchema } from '../src/schemas/mcp-delivery-fee-info';
import type { QuoteRequest, ShippingQuote } from '../src/lib/shipping/types';
import { resolveMerchantCurrencyConfig } from '../src/lib/resolve-merchant-currency';
import { randomUUID } from 'node:crypto';
import { resolvePublicMerchantSender } from '../src/app/api/shipping/quotes/resolve-public-merchant-sender';
import { productWeightToKg } from '../src/lib/shipping/product-weight-to-kg';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';

export type DeliveryInput = z.infer<typeof mcpDeliveryFeeInfoInputSchema>;
type DeliveryOutput = z.infer<typeof mcpToolOutputSchemas.get_delivery_fee_info>;
export type DeliveryQuoteResult = Pick<DeliveryOutput, 'status' | 'message' | 'quotes'>;
const unavailable = (): DeliveryQuoteResult => ({ status: 'unavailable', message: 'Live GIG quotes are unavailable for this shipment. Confirm delivery at checkout.', quotes: [] });

export async function loadDeliveryGiglQuotes(input: DeliveryInput, deps: {
  supabase: SupabaseClient;
  merchantId: string;
  getQuotes: (request: QuoteRequest) => Promise<ShippingQuote[]>;
}): Promise<DeliveryQuoteResult> {
  if (!input.items?.length || !input.city) return unavailable();
  const { supabase, merchantId, getQuotes } = deps;
  // Reuse the existing anonymous, published storefront projection. Missing
  // settings inherit the canonical empty carrier allowlist and fail closed.
  const { data: snapshots, error: snapshotError } = await supabase.rpc('resolve_storefront_public_snapshot_v2', { p_identifier: 'ogabassey' });
  const snapshot = !snapshotError && Array.isArray(snapshots) ? snapshots[0] : undefined;
  const merchant = snapshot?.merchant_data;
  const carriers: unknown = snapshot?.feature_settings?.shipping_providers;
  const merchantCountry = typeof merchant?.country === 'string' ? merchant.country.trim().toUpperCase() : '';
  if (snapshot?.resolution_status !== 'found' || merchant?.id !== merchantId || !['NG', 'NGA', 'NIGERIA'].includes(merchantCountry) || !Array.isArray(carriers) || !carriers.some((carrier: unknown) => typeof carrier === 'string' && carrier.trim().toLowerCase() === 'gigl')) return unavailable();
  if (resolveMerchantCurrencyConfig({ country: 'NG', payout_currency: typeof merchant.payout_currency === 'string' ? merchant.payout_currency : null }).code !== 'NGN') return unavailable();
  const origin = await resolvePublicMerchantSender(supabase, merchantId);
  if (!origin.ok || !origin.sender || !['NG', 'NGA', 'NIGERIA'].includes(origin.country?.trim().toUpperCase() ?? '')) return unavailable();
  // The anonymous PDP snapshot resolves anchor/variant policies and public
  // serialized units inside the published merchant boundary. Direct variant
  // table reads can silently return no rows under anonymous RLS.
  const deadline = AbortSignal.timeout(8000);
  const products = await Promise.all([...new Set(input.items.map((item) => item.product_id))].map(async (productId) => {
    const query = supabase.rpc('get_storefront_pdp_core_v2', {
      p_merchant_id: merchantId, p_product_slug: productId,
    });
    const bounded = typeof query.abortSignal === 'function' ? query.abortSignal(deadline).retry(false) : query;
    const { data, error } = await bounded;
    const row: unknown = !error && Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== 'object' || !('resolution_status' in row) || row.resolution_status !== 'found' || !('product_data' in row)) return null;
    const product = row.product_data;
    if (!product || typeof product !== 'object' || Array.isArray(product)) return null;
    const projected = product as Record<string, unknown>;
    if (projected.id !== productId || projected.merchant_id !== merchantId || projected.status !== 'active' || projected.variants_truncated === true || ![true, false, null].includes(projected.manage_stock as boolean | null)) return null;
    return projected;
  })).catch(() => null);
  if (!products || products.some((product) => !product)) return unavailable();
  const items: QuoteRequest['items'] = [];
  for (const item of input.items) {
    const product = products.find((row) => row?.id === item.product_id);
    if (!product || typeof product.name !== 'string' || !product.name.trim()) return unavailable();
    let price: unknown = product.price;
    let stock: unknown = product.stock_quantity;
    const requestedQuantity = input.items.filter((selected) => selected.product_id === item.product_id && selected.variant_id === item.variant_id).reduce((total, selected) => total + selected.quantity, 0);
    if (product.has_condition_offers) return { status: 'needs_selection', message: 'This product has condition offers. Confirm its exact offer and delivery at checkout.', quotes: [] };
    if (product.has_variants) {
      if (!item.variant_id) return { status: 'needs_selection', message: 'Select the exact catalog variant before quoting delivery.', quotes: [] };
      const variant: unknown = Array.isArray(product.product_variants) ? product.product_variants.find((row: unknown) => row !== null && typeof row === 'object' && 'id' in row && row.id === item.variant_id) : undefined;
      if (!variant || typeof variant !== 'object' || !('product_id' in variant) || variant.product_id !== product.id) return unavailable();
      const projected = variant as Record<string, unknown>;
      price = projected.price_override ?? product.price;
      stock = projected.stock_quantity ?? product.stock_quantity;
      const policy = projected.inventory_tracking_policy;
      if (!['off', 'serialized_strict', 'serialized_then_unlimited'].includes(policy as string)) return unavailable();
      // Serialized strict never inherits parent stock; then-unlimited permits
      // quoting even when only some (or no) serialized units remain.
      if (policy === 'serialized_strict') stock = projected.stock_quantity;
      if (policy !== 'serialized_then_unlimited' && (policy === 'serialized_strict' || product.manage_stock !== false) && (typeof stock !== 'number' || !Number.isFinite(stock) || stock < requestedQuantity)) return unavailable();
    } else {
      if (item.variant_id) return unavailable();
      // The PDP hydrates simple anchor policy into manage_stock and stock.
      if (product.manage_stock !== false && (typeof stock !== 'number' || !Number.isFinite(stock) || stock < requestedQuantity)) return unavailable();
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return unavailable();
    const buyerWeight = typeof item.weight_kg === 'number' && Number.isFinite(item.weight_kg) && item.weight_kg > 0 && item.weight_kg <= MCP_DELIVERY_MAX_UNIT_WEIGHT_KG ? item.weight_kg : undefined;
    const catalogWeight = productWeightToKg(product.weight_value, product.weight_unit);
    const weight = catalogWeight !== null && catalogWeight <= MCP_DELIVERY_MAX_UNIT_WEIGHT_KG ? catalogWeight : buyerWeight;
    if (!weight) return { status: 'needs_weight', message: `The catalog has no usable package weight for ${product.name}. Provide the packed weight in kilograms of one unit of this product. GIG multiplies that weight by quantity; do not enter the combined weight of all units. If only a combined weight is known, confirm the per-unit packed weight or delivery at checkout. Do not guess.`, quotes: [] };
    items.push({ name: product.name, value: price, quantity: item.quantity, weight });
  }
  const providerQuotes = await getQuotes({
    sessionId: randomUUID(), merchantId, sender: origin.sender,
    receiver: { name: '', phone: '', address: input.city, city: input.city, state: input.state, country: 'Nigeria', countryCode: 'NG' },
    items, shipmentType: 'domestic', deliveryPreference: input.delivery_preference,
  }).catch(() => []);
  const quotes: DeliveryOutput['quotes'] = [];
  for (const quote of providerQuotes) {
    if (typeof quote.serviceTier !== 'string' || !quote.serviceTier.trim() || quote.provider !== 'GIGL' || quote.currency !== 'NGN' || !(quote.expiresAt instanceof Date) || !Number.isFinite(quote.expiresAt.getTime()) || quote.expiresAt.getTime() <= Date.now() || !Number.isFinite(quote.price) || quote.price < 0) continue;
    if (input.delivery_preference === 'door' && quote.isStationPickup) continue;
    if (input.delivery_preference === 'pickup_station' && !quote.isStationPickup) continue;
    quotes.push({ provider: 'GIGL', service: quote.serviceTier, fee: quote.price, currency: 'NGN', delivery_type: quote.isStationPickup ? 'pickup_station' : 'door', expires_at: quote.expiresAt.toISOString(), station_name: quote.stationName ?? quote.pickupStationName ?? null, station_address: quote.stationAddress ?? quote.pickupStationAddress ?? null });
  }
  if (!quotes.length) return unavailable();
  return { status: 'quoted', message: 'Live GIG estimate for the selected products, quantities and city. Rates may change with the final address or package details. Confirm price, timing and any free-delivery eligibility at checkout. No shipment has been booked.', quotes };
}
