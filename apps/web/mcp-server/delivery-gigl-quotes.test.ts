import { describe, expect, it, vi } from 'vitest';
import { loadDeliveryGiglQuotes } from './delivery-gigl-quotes';

const productId = 'bfab9f45-7c2e-4744-be8e-9540af062406';
const input = { state: 'Lagos', city: 'Ikeja', items: [{ product_id: productId, quantity: 2 }] };
function fixture(overrides = {}) {
  const product = { id: productId, name: 'Camera', price: 66700, weight_value: 500, weight_unit: 'g', has_variants: false, has_condition_offers: false, ...overrides };
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [product], error: null }) };
  const supabase = { from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: { business_name: 'Ogabassey', business_address: '2 Olaide Tomori Street, Ikeja, Lagos', phone: '', state_code: 'LA', country: 'NG' }, error: null }) };
  const getQuotes = vi.fn().mockResolvedValue([{ provider: 'GIGL', price: 4200, serviceTier: 'GoStandard', currency: 'NGN', expiresAt: new Date('2099-01-01'), isStationPickup: false }]);
  return { deps: { supabase: supabase as never, merchantId: 'merchant-1', getQuotes }, getQuotes, query, rpc: supabase.rpc };
}

describe('GIG quote preparation', () => {
  it('prices catalog items with converted stored weight and public merchant origin', async () => {
    const { deps, getQuotes } = fixture();
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'quoted', quotes: [{ fee: 4200 }] });
    expect(getQuotes.mock.calls[0]?.[0]).toMatchObject({ merchantId: 'merchant-1', sender: { city: 'Ikeja', state: 'Lagos' }, receiver: { city: 'Ikeja', state: 'Lagos' }, items: [{ name: 'Camera', value: 66700, weight: 0.5, quantity: 2 }] });
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
  it('uses a buyer supplied packed weight only when catalog weight is missing', async () => {
    const { deps, getQuotes } = fixture({ weight_value: null });
    expect(await loadDeliveryGiglQuotes({ ...input, items: [{ ...input.items[0], weight_kg: 0.8 }] }, deps)).toMatchObject({ status: 'quoted' });
    expect(getQuotes.mock.calls[0]?.[0].items[0].weight).toBe(0.8);
  });
  it.each([NaN, Infinity, -1, null])('does not quote a corrupt catalog value %s', async (price) => {
    const { deps, getQuotes } = fixture({ price });
    expect(await loadDeliveryGiglQuotes(input, deps)).toMatchObject({ status: 'unavailable' });
    expect(getQuotes).not.toHaveBeenCalled();
  });
  it('uses the selected variant override instead of the parent price', async () => {
    const { deps, getQuotes, rpc } = fixture({ has_variants: true });
    const original = rpc.getMockImplementation();
    rpc.mockImplementation((name: string, args: unknown) => name === 'get_storefront_product_variants' ? Promise.resolve({ data: [{ id: 'c985e013-7c2b-4655-a560-4085f27cd168', product_id: productId, price_override: 80000 }], error: null }) as never : original?.(name, args) as never);
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
