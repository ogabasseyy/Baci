import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { mcpDeliveryFeeInfoInputSchema } from '../src/schemas/mcp-delivery-fee-info';
import type { QuoteRequest, ShippingQuote } from '../src/lib/shipping/types';
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
  const origin = await resolvePublicMerchantSender(supabase, merchantId);
  if (!origin.ok || !origin.sender || !['NG', 'NGA', 'NIGERIA'].includes(origin.country?.trim().toUpperCase() ?? '')) return unavailable();
  const { data: products, error } = await supabase.from('products')
    .select('id, name, price, weight_value, weight_unit, has_variants, has_condition_offers, manage_stock, stock_quantity')
    .eq('merchant_id', merchantId).eq('status', 'active')
    .in('id', input.items.map((item) => item.product_id));
  if (error || !products) return unavailable();
  const items: QuoteRequest['items'] = [];
  for (const item of input.items) {
    const product = products.find((row) => row.id === item.product_id);
    if (!product || typeof product.name !== 'string' || !product.name.trim()) return unavailable();
    let price: unknown = product.price;
    let stock: unknown = product.stock_quantity;
    const requestedQuantity = input.items.filter((selected) => selected.product_id === item.product_id && selected.variant_id === item.variant_id).reduce((total, selected) => total + selected.quantity, 0);
    if (product.has_condition_offers) return { status: 'needs_selection', message: 'This product has condition offers. Confirm its exact offer and delivery at checkout.', quotes: [] };
    if (product.has_variants) {
      if (!item.variant_id) return { status: 'needs_selection', message: 'Select the exact catalog variant before quoting delivery.', quotes: [] };
      const { data: variants, error: variantError } = await supabase.rpc('get_storefront_product_variants', { p_product_ids: [product.id] });
      const variant = !variantError && Array.isArray(variants) ? variants.find((row) => row.product_id === product.id && row.id === item.variant_id) : undefined;
      if (!variant) return unavailable();
      price = variant.price_override ?? product.price;
      stock = variant.stock_quantity;
    } else if (item.variant_id) return unavailable();
    if (product.manage_stock === true && (typeof stock !== 'number' || !Number.isFinite(stock) || stock < requestedQuantity)) return unavailable();
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return unavailable();
    const weight = productWeightToKg(product.weight_value, product.weight_unit) ?? item.weight_kg;
    if (!weight) return { status: 'needs_weight', message: `The catalog has no usable package weight for ${product.name}. Provide the packed weight in kilograms, or confirm delivery at checkout. Do not guess.`, quotes: [] };
    items.push({ name: product.name, value: price, quantity: item.quantity, weight });
  }
  const providerQuotes = await getQuotes({
    sessionId: randomUUID(), merchantId, sender: origin.sender,
    receiver: { name: '', phone: '', address: input.city, city: input.city, state: input.state, country: 'Nigeria', countryCode: 'NG' },
    items, shipmentType: 'domestic', deliveryPreference: input.delivery_preference,
  }).catch(() => []);
  const quotes: DeliveryOutput['quotes'] = [];
  for (const quote of providerQuotes) {
    if (quote.provider !== 'GIGL' || quote.currency !== 'NGN' || !(quote.expiresAt instanceof Date) || !Number.isFinite(quote.expiresAt.getTime()) || quote.expiresAt.getTime() <= Date.now() || !Number.isFinite(quote.price) || quote.price < 0) continue;
    if (input.delivery_preference === 'door' && quote.isStationPickup) continue;
    if (input.delivery_preference === 'pickup_station' && !quote.isStationPickup) continue;
    quotes.push({ provider: 'GIGL', service: quote.serviceTier, fee: quote.price, currency: 'NGN', delivery_type: quote.isStationPickup ? 'pickup_station' : 'door', expires_at: quote.expiresAt.toISOString(), station_name: quote.stationName ?? quote.pickupStationName ?? null, station_address: quote.stationAddress ?? quote.pickupStationAddress ?? null });
  }
  if (!quotes.length) return unavailable();
  return { status: 'quoted', message: 'Live GIG estimate for the selected products, quantities and city. Rates may change with the final address or package details. Confirm price, timing and any free-delivery eligibility at checkout. No shipment has been booked.', quotes };
}
