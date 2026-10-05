import { describe, expect, it, vi } from 'vitest';
import { registerDeliveryFeeInfoTool } from './delivery-fee-info';
import type { DeliveryInput } from './delivery-gigl-quotes';

const input = { state: 'Lagos', city: 'Ikeja', items: [{ product_id: 'bfab9f45-7c2e-4744-be8e-9540af062406', quantity: 1 }] };

function register(loadQuotes: NonNullable<Parameters<typeof registerDeliveryFeeInfoTool>[2]>) {
  let handler: (args: DeliveryInput) => Promise<unknown> = async () => undefined;
  const server = { registerTool: (_name: string, _config: unknown, callback: typeof handler) => { handler = callback; } };
  registerDeliveryFeeInfoTool(server as never, (value) => value.trim(), loadQuotes);
  return handler;
}

describe('ChatGPT delivery quotes', () => {
  it('surfaces real GIG rates for the requested shipment without booking', async () => {
    const handler = register(vi.fn().mockResolvedValue({ status: 'quoted', message: 'Live estimate; confirm at checkout.', quotes: [{ provider: 'GIGL', service: 'GoStandard', fee: 4200, currency: 'NGN', delivery_type: 'door', expires_at: '2099-01-01T00:00:00.000Z', station_name: null, station_address: null }] }));
    const result = await handler({ ...input, delivery_preference: 'door' });
    expect(result).toMatchObject({ structuredContent: { fee: 4200, quote_available: true, status: 'quoted', quotes: [{ fee: 4200, provider: 'GIGL' }] } });
    expect(JSON.stringify(result)).toContain('4200');
  });

  it('keeps mixed door and pickup fees separate until the buyer chooses a type', async () => {
    const quote = { provider: 'GIGL', service: 'GoStandard', currency: 'NGN', expires_at: '2099-01-01T00:00:00.000Z', station_name: null, station_address: null };
    const result = await register(vi.fn().mockResolvedValue({ status: 'quoted', message: 'Choose delivery type.', quotes: [{ ...quote, fee: 4200, delivery_type: 'door' }, { ...quote, fee: 2000, delivery_type: 'pickup_station' }] }))(input);
    expect(result).toMatchObject({ structuredContent: { fee: null, quote_available: true, quotes: [{ fee: 4200, delivery_type: 'door' }, { fee: 2000, delivery_type: 'pickup_station' }] } });
  });

  it('asks for shipment context when only a destination is supplied', async () => {
    const result = await register(vi.fn())({ state: 'Lagos', city: 'Ikeja' } as typeof input);
    expect(result).toMatchObject({ structuredContent: { fee: null, quote_available: false, status: 'needs_items' } });
    expect(JSON.stringify(result)).toContain('product');
  });

  it('returns safe unavailable guidance on a provider outage', async () => {
    const result = await register(vi.fn().mockRejectedValue(new Error('secret provider diagnostic')))(input);
    expect(result).toMatchObject({ structuredContent: { fee: null, quote_available: false, status: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('derives availability from quotes even if a loader returns extra contradictory fields', async () => {
    const result = await register(vi.fn().mockResolvedValue({ status: 'unavailable', message: 'Unavailable', quotes: [], fee: 9000, quote_available: true }))(input);
    expect(result).toMatchObject({ structuredContent: { fee: null, quote_available: false } });
  });
});
