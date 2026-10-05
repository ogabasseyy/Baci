import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpDeliveryFeeInfoInputSchema } from '../src/schemas/mcp-delivery-fee-info';
import { loadDeliveryGiglQuotes } from './delivery-gigl-quotes';

vi.mock('../src/lib/public-serialized-variant-summary', () => ({ getPublicSerializedVariantSummariesByProductId: vi.fn().mockResolvedValue([]) }));
import { getPublicSerializedVariantSummariesByProductId } from '../src/lib/public-serialized-variant-summary';
beforeEach(() => { vi.mocked(getPublicSerializedVariantSummariesByProductId).mockReset().mockResolvedValue([]); });

const productId = 'bfab9f45-7c2e-4744-be8e-9540af062406';
const input = { state: 'Lagos', city: 'Ikeja', items: [{ product_id: productId, quantity: 2 }] };
function fixture(overrides = {}) {
  const product = { id: productId, name: 'Camera', price: 66700, weight_value: 500, weight_unit: 'g', has_variants: false, has_condition_offers: false, manage_stock: true, stock_quantity: 5, ...overrides };
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [product], error: null }) };
  const supabase = { from: vi.fn(() => query), rpc: vi.fn().mockImplementation((name: string, _args?: unknown) => Promise.resolve(name === 'resolve_storefront_public_snapshot_v2' ? { data: [{ resolution_status: 'found', merchant_data: { id: 'merchant-1', country: 'NG', payout_currency: 'NGN' }, feature_settings: { shipping_providers: ['gigl'] } }], error: null } : { data: { business_name: 'Ogabassey', business_address: '2 Olaide Tomori Street, Ikeja, Lagos', phone: '', state_code: 'LA', country: 'NG' }, error: null })) };
  const getQuotes = vi.fn().mockResolvedValue([{ provider: 'GIGL', price: 4200, serviceTier: 'GoStandard', currency: 'NGN', expiresAt: new Date('2099-01-01'), isStationPickup: false }]);
  return { deps: { supabase: supabase as never, merchantId: 'merchant-1', getQuotes }, getQuotes, query, rpc: supabase.rpc };
}

describe('GIG quote preparation', () => {
  it.each(['serialized_strict', 'serialized_then_unlimited'] as const)('uses serialized availability for an untracked zero-stock variant %s', async (inventoryTrackingPolicy) => {
    const variantId = 'c985e013-7c2b-4655-a560-4085f27cd168';
    const { deps, getQuotes, rpc } = fixture({ has_variants: true, manage_stock: false });
    const original = rpc.getMockImplementation();
    rpc.mockImplementation((name: string, args: unknown) => name === 'get_storefront_product_variants' ? Promise.resolve({ data: [{ id: variantId, product_id: productId, price_override: 80000, stock_quantity: 0 }], error: null }) as never : original?.(name, args) as never);
    vi.mocked(getPublicSerializedVariantSummariesByProductId).mockResolvedValue([{ productId, variantId, inventoryTrackingPolicy, publicAvailableUnits: 0 }]);
    expect(await loadDeliveryGiglQuotes({ ...input, items: [{ ...input.items[0], variant_id: variantId }] }, deps)).toMatchObject({ status: inventoryTrackingPolicy === 'serialized_strict' ? 'unavailable' : 'quoted' });
    expect(getQuotes).toHaveBeenCalledTimes(inventoryTrackingPolicy === 'serialized_strict' ? 0 : 1);
  });
  it.each([0, 1, NaN, Infinity])('rejects insufficient strict serialized units on an untracked parent %s', async (publicAvailableUnits) => {
    const { deps, getQuotes } = fixture({ manage_stock: false });
    vi.mocked(getPublicSerializedVariantSummariesByProductId).mockResolvedValue([{ productId, variantId: null, inventoryTrackingPolicy: 'serialized_strict', publicAvailableUnits }]);
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it.each(['serialized_strict', 'serialized_then_unlimited'] as const)('preserves purchasable serialized policy %s', async (inventoryTrackingPolicy) => {
    const { deps } = fixture({ manage_stock: false });
    vi.mocked(getPublicSerializedVariantSummariesByProductId).mockResolvedValue([{ productId, variantId: null, inventoryTrackingPolicy, publicAvailableUnits: inventoryTrackingPolicy === 'serialized_strict' ? 2 : 0 }]);
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'quoted' });
  });
  it('fails closed when the public serialized summary cannot be read', async () => {
    const { deps, getQuotes } = fixture();
    vi.mocked(getPublicSerializedVariantSummariesByProductId).mockRejectedValue(new Error('private database detail'));
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it.each([[], null, ['topship']])('does not call GIG when merchant carriers are disabled %s', async (shipping_providers) => {
    const { deps, rpc, getQuotes } = fixture();
    const original = rpc.getMockImplementation();
    rpc.mockImplementation((name: string) => name === 'resolve_storefront_public_snapshot_v2' ? Promise.resolve({ data: [{ resolution_status: 'found', merchant_data: { id: 'merchant-1', country: 'NG', payout_currency: 'NGN' }, feature_settings: { shipping_providers } }], error: null }) as never : original?.(name) as never);
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it.each([
    { data: [], error: null },
    { data: null, error: { message: 'private' } },
    { data: [{ resolution_status: 'not_found', merchant_data: null }], error: null },
    { data: [{ resolution_status: 'found', merchant_data: { id: 'other-merchant', country: 'NG', payout_currency: 'NGN' }, feature_settings: { shipping_providers: ['gigl'] } }], error: null },
    { data: [{ resolution_status: 'found', merchant_data: { id: 'merchant-1', country: 'US', payout_currency: 'NGN' }, feature_settings: { shipping_providers: ['gigl'] } }], error: null },
    { data: [{ resolution_status: 'found', merchant_data: { id: 'merchant-1', country: 'NG', payout_currency: 'NGN' }, feature_settings: null }], error: null },
  ])('fails closed for absent or ineligible public merchant context %#', async (snapshot) => {
    const { deps, rpc, getQuotes } = fixture();
    const original = rpc.getMockImplementation();
    rpc.mockImplementation((name: string) => name === 'resolve_storefront_public_snapshot_v2' ? Promise.resolve(snapshot) as never : original?.(name) as never);
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it.each(['USD', 'GBP'])('does not quote a non-NGN merchant currency %s', async (payout_currency) => {
    const { deps, rpc, getQuotes } = fixture();
    const original = rpc.getMockImplementation();
    rpc.mockImplementation((name: string) => name === 'resolve_storefront_public_snapshot_v2' ? Promise.resolve({ data: [{ resolution_status: 'found', merchant_data: { id: 'merchant-1', country: 'NG', payout_currency }, feature_settings: { shipping_providers: ['gigl'] } }], error: null }) as never : original?.(name) as never);
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it.each([-1, Infinity, NaN, 101, 0])('rejects invalid direct buyer weight %s', async (weight_kg) => {
    const { deps, getQuotes } = fixture({ weight_value: null });
    expect(await loadDeliveryGiglQuotes({ ...input, items: [{ ...input.items[0], weight_kg }] }, deps)).toMatchObject({ status: 'needs_weight' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it.each([{ weight_value: 101, weight_unit: 'kg' }, { weight_value: 101000, weight_unit: 'g' }])('asks for a confirmed weight above the MCP catalog ceiling %#', async (catalogWeight) => {
    const { deps, getQuotes } = fixture(catalogWeight);
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'needs_weight' });
    expect(getQuotes).not.toHaveBeenCalled();
    expect(await loadDeliveryGiglQuotes({ ...input, items: [{ ...input.items[0], weight_kg: 0.8 }] }, deps)).toMatchObject({ status: 'quoted' });
    expect(getQuotes.mock.calls[0]?.[0].items[0].weight).toBe(0.8);
  });
  it('accepts the catalog per-unit ceiling without capping total shipment weight', async () => {
    const { deps, getQuotes } = fixture({ weight_value: 100, weight_unit: 'kg' });
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'quoted' });
    expect(getQuotes.mock.calls[0]?.[0].items[0]).toMatchObject({ weight: 100, quantity: 2 });
  });
  it.each([false, null])('treats variant stock as unconfirmed when the parent is untracked %s', async (manage_stock) => {
    const { deps, getQuotes, rpc } = fixture({ has_variants: true, manage_stock });
    const original = rpc.getMockImplementation();
    rpc.mockImplementation((name: string, args: unknown) => name === 'get_storefront_product_variants' ? Promise.resolve({ data: [{ id: 'c985e013-7c2b-4655-a560-4085f27cd168', product_id: productId, price_override: 80000, stock_quantity: 0 }], error: null }) as never : original?.(name, args) as never);
    expect(await loadDeliveryGiglQuotes({ ...input, items: [{ ...input.items[0], variant_id: 'c985e013-7c2b-4655-a560-4085f27cd168' }] }, deps)).toMatchObject({ status: 'quoted' });
    expect(getQuotes).toHaveBeenCalledOnce();
  });
  it.each(['', '  ', undefined])('filters an unusable service label %s', async (serviceTier) => {
    const { deps, getQuotes } = fixture();
    getQuotes.mockResolvedValue([{ provider: 'GIGL', price: 4200, currency: 'NGN', expiresAt: new Date('2099-01-01'), serviceTier }]);
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable', quotes: [] });
  });

  it.each([0, 1, null, NaN, Infinity, -1])('does not quote insufficient or unconfirmed tracked stock %s', async (stock_quantity) => {
    const { deps, getQuotes } = fixture({ stock_quantity });
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable', quotes: [] });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it('preserves untracked inventory quotes', async () => {
    const { deps } = fixture({ manage_stock: false, stock_quantity: null });
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'quoted' });
  });
  it('checks the combined quantity of repeated selected product lines', async () => {
    const { deps, getQuotes } = fixture({ stock_quantity: 3 });
    expect(await loadDeliveryGiglQuotes({ ...input, items: [input.items[0], input.items[0]] }, deps)).toMatchObject({ status: 'unavailable' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it('does not quote a sold-out selected variant', async () => {
    const { deps, getQuotes, rpc } = fixture({ has_variants: true });
    const original = rpc.getMockImplementation();
    rpc.mockImplementation((name: string, args: unknown) => name === 'get_storefront_product_variants' ? Promise.resolve({ data: [{ id: 'c985e013-7c2b-4655-a560-4085f27cd168', product_id: productId, price_override: 80000, stock_quantity: 0 }], error: null }) as never : original?.(name, args) as never);
    expect(await loadDeliveryGiglQuotes({ ...input, items: [{ ...input.items[0], variant_id: 'c985e013-7c2b-4655-a560-4085f27cd168' }] }, deps)).toMatchObject({ status: 'unavailable' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it.each(['ng', 'nigeria', 'NGA', ' NG '])('accepts equivalent Nigerian country projection %s', async (country) => {
    const { deps, rpc } = fixture();
    const original = rpc.getMockImplementation();
    rpc.mockImplementation((name: string) => name === 'get_storefront_shipping_sender' ? Promise.resolve({ data: { business_name: 'Ogabassey', business_address: '2 Olaide Tomori Street, Ikeja, Lagos', state_code: 'LA', country }, error: null }) : original?.(name) as never);
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'quoted' });
  });

  it('prices catalog items with converted stored weight and public merchant origin', async () => {
    const { deps, getQuotes } = fixture();
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'quoted', quotes: [{ fee: 4200 }] });
    expect(getQuotes.mock.calls[0]?.[0]).toMatchObject({ merchantId: 'merchant-1', sender: { city: 'Ikeja', state: 'Lagos' }, receiver: { city: 'Ikeja', state: 'Lagos' }, items: [{ name: 'Camera', value: 66700, weight: 0.5, quantity: 2 }] });
  });
  it('defines buyer weight per unit and asks for one unit when quantity exceeds one', async () => {
    expect(mcpDeliveryFeeInfoInputSchema.shape.items.unwrap().element.shape.weight_kg.description).toContain('one unit');
    const { deps, getQuotes } = fixture({ weight_value: null });
    const result = await loadDeliveryGiglQuotes(input, deps);
    expect(result.message).toContain('one unit');
    expect(result.message).toContain('combined');
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it('asks for weight instead of substituting an invented kilogram', async () => {
    const { deps, getQuotes } = fixture({ weight_value: null });
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'needs_weight', quotes: [] });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it('does not price an unspecified condition offer', async () => {
    const { deps, getQuotes } = fixture({ has_condition_offers: true });
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'needs_selection', quotes: [] });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it('uses buyer supplied packed weight per unit for multiple units only when catalog weight is missing', async () => {
    const { deps, getQuotes } = fixture({ weight_value: null });
    expect(await loadDeliveryGiglQuotes({ ...input, items: [{ ...input.items[0], weight_kg: 0.8 }] }, deps)).toMatchObject({ status: 'quoted' });
    expect(getQuotes.mock.calls[0]?.[0].items[0]).toMatchObject({ weight: 0.8, quantity: 2 });
    const items = getQuotes.mock.calls[0]?.[0].items;
    expect(items.reduce((total: number, item: { weight: number; quantity: number }) => total + item.weight * item.quantity, 0)).toBe(1.6);
  });
  it.each([NaN, Infinity, -1, null])('does not quote a corrupt catalog value %s', async (price) => {
    const { deps, getQuotes } = fixture({ price });
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it('uses the selected variant override instead of the parent price', async () => {
    const { deps, getQuotes, rpc } = fixture({ has_variants: true });
    const original = rpc.getMockImplementation();
    rpc.mockImplementation((name: string, args: unknown) => name === 'get_storefront_product_variants' ? Promise.resolve({ data: [{ id: 'c985e013-7c2b-4655-a560-4085f27cd168', product_id: productId, price_override: 80000, stock_quantity: 5 }], error: null }) as never : original?.(name, args) as never);
    expect(await loadDeliveryGiglQuotes({ ...input, items: [{ ...input.items[0], variant_id: 'c985e013-7c2b-4655-a560-4085f27cd168' }] }, deps)).toMatchObject({ status: 'quoted' });
    expect(getQuotes.mock.calls[0]?.[0].items[0].value).toBe(80000);
  });
  it.each([new Date('2000-01-01'), new Date('invalid')])('does not expose an expired or malformed estimate', async (expiresAt) => {
    const { deps, getQuotes } = fixture();
    getQuotes.mockResolvedValue([{ provider: 'GIGL', price: 4200, currency: 'NGN', expiresAt }]);
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable', quotes: [] });
  });
  it('does not return a pickup estimate as door delivery', async () => {
    const { deps, getQuotes } = fixture();
    getQuotes.mockResolvedValue([{ provider: 'GIGL', price: 4200, currency: 'NGN', expiresAt: new Date('2099-01-01'), isStationPickup: true }]);
    expect(await loadDeliveryGiglQuotes({ ...input, delivery_preference: 'door' }, deps)).toMatchObject({ status: 'unavailable', quotes: [] });
  });
  it('returns a safe result when the provider rejects', async () => {
    const { deps, getQuotes } = fixture();
    getQuotes.mockRejectedValue(new Error('private diagnostic'));
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable', quotes: [] });
  });
});
