import { describe, expect, it, vi } from 'vitest';

vi.mock('./gigl.tracking-batch', () => ({
  trackGiglShipmentBatch: vi.fn(),
}));

import { GiglProvider, giglProvider } from './gigl';
import { trackGiglShipmentBatch } from './gigl.tracking-batch';

const trackGiglShipmentBatchMock = vi.mocked(trackGiglShipmentBatch);

describe('GiglProvider orchestrator', () => {
  it('uses a supplied tracking token in its isolated API client', async () => {
    const token = {
      token: 'synthetic-token',
      userChannelCode: 'channel',
      customerType: 1,
      expiresAt: Date.now() + 60_000,
    };
    const provider = new GiglProvider(token);
    trackGiglShipmentBatchMock.mockResolvedValueOnce(new Map());
    await provider.trackShipments(['WB-1']);
    expect(provider.currentToken).toEqual(token);
    expect(
      trackGiglShipmentBatchMock.mock.calls.at(-1)?.[0].currentToken
    ).toEqual(token);
  });
  it('exports the singleton and provider metadata', () => {
    expect(giglProvider).toBeInstanceOf(GiglProvider);
    expect(giglProvider).toMatchObject({
      code: 'GIGL',
      displayName: 'GIG Logistics',
      supportsDomestic: true,
      supportsInternational: true,
    });
  });

  it('documents unsupported cancellation through a typed result', async () => {
    await expect(giglProvider.cancelShipment('GIGL-WB-1')).resolves.toEqual({
      success: false,
      message:
        'GIGL shipment cancellation must be done through their customer service',
    });
  });

  it('forwards batch waybills and preserves the batch result', async () => {
    const provider = new GiglProvider();
    const results = new Map();
    trackGiglShipmentBatchMock.mockResolvedValueOnce(results);

    await expect(provider.trackShipments(['WB-1', 'WB-2'])).resolves.toBe(
      results
    );
    expect(trackGiglShipmentBatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ['WB-1', 'WB-2']
    );
  });

  it('preserves batch tracking errors', async () => {
    const provider = new GiglProvider();
    const error = new Error('batch failure');
    trackGiglShipmentBatchMock.mockRejectedValueOnce(error);

    await expect(provider.trackShipments(['WB-1'])).rejects.toBe(error);
  });
});
