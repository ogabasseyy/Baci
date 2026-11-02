import { describe, expect, it, vi } from 'vitest';

vi.mock('./gigl.tracking-batch', () => ({
  trackGiglShipmentBatch: vi.fn(),
}));
vi.mock('./gigl.preshipment-ownership', () => ({
  attestGiglWaybillOwnership: vi.fn(),
}));

import { GiglProvider, giglProvider } from './gigl';
import { attestGiglWaybillOwnership } from './gigl.preshipment-ownership';
import { trackGiglShipmentBatch } from './gigl.tracking-batch';

const trackGiglShipmentBatchMock = vi.mocked(trackGiglShipmentBatch);
const attestGiglWaybillOwnershipMock = vi.mocked(attestGiglWaybillOwnership);

describe('GiglProvider orchestrator', () => {
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

  it('forwards waybill ownership checks to the preshipment attestor', async () => {
    const provider = new GiglProvider();
    attestGiglWaybillOwnershipMock.mockResolvedValueOnce('owned');

    await expect(provider.attestWaybillOwnership('WB-1')).resolves.toBe(
      'owned'
    );
    expect(attestGiglWaybillOwnershipMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'WB-1'
    );
  });

  it('preserves batch tracking errors', async () => {
    const provider = new GiglProvider();
    const error = new Error('batch failure');
    trackGiglShipmentBatchMock.mockRejectedValueOnce(error);

    await expect(provider.trackShipments(['WB-1'])).rejects.toBe(error);
  });
});
