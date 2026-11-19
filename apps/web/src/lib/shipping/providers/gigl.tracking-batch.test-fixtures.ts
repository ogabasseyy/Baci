import { vi } from 'vitest';
import { GiglApiClient } from './gigl.auth';
import type { GiglProviderIo } from './gigl.constants';

export const token = {
  token: 'token',
  userChannelCode: 'channel',
  customerType: 1,
  expiresAt: Date.now() + 60_000,
};

export function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function setupApi(envelope: unknown, status = 200) {
  const safeFetch = vi.fn().mockResolvedValue(response(envelope, status));
  const io: GiglProviderIo = {
    safeFetch,
    log: vi.fn(),
  };
  const apiClient = new GiglApiClient(io);
  vi.spyOn(apiClient, 'getApiToken').mockResolvedValue(token);
  return { apiClient, io, safeFetch };
}

export function shipment(waybill: string, eventCount = 1) {
  return {
    Amount: 1_200,
    Waybill: waybill,
    WaybillLabel: 'https://example.invalid/label',
    MobileShipmentTrackings: Array.from({ length: eventCount }, (_, index) => ({
      Status: 'Shipment delivered',
      ScanStatusReason: 'Delivered',
      DateTimeUtc: `2026-07-30T09:${String(index % 60).padStart(2, '0')}:00.000Z`,
      ShipmentTrackingId: index + 1,
    })),
  };
}
