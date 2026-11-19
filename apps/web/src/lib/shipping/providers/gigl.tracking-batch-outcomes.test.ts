import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackGiglShipmentBatchOutcomes } from './gigl.tracking-batch';
import { setupApi, shipment } from './gigl.tracking-batch.test-fixtures';

describe('trackGiglShipmentBatchOutcomes', () => {
  beforeEach(() => {
    vi.stubEnv('GIGL_BASE_URL', 'https://gigl.test');
    vi.stubEnv('GIGL_TRACKING_BATCH_TIMEOUT_MS', '');
    vi.resetModules();
  });

  it('reports per-waybill schema and normalization failures separately from omitted waybills', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      success: true,
      data: [
        { ...shipment('WB-SCHEMA-BAD'), Amount: undefined },
        {
          ...shipment('WB-EVENT-BAD'),
          MobileShipmentTrackings: [
            {
              Status: 'UNPUBLISHED_CODE',
              DateTimeUtc: 'not-a-date',
            },
          ],
        },
        shipment('WB-GOOD'),
      ],
    });

    const outcomes = await trackGiglShipmentBatchOutcomes(apiClient, io, [
      'WB-SCHEMA-BAD',
      'WB-EVENT-BAD',
      'WB-GOOD',
      'WB-ABSENT',
    ]);

    expect([...outcomes.results.keys()]).toEqual(['WB-GOOD']);
    expect([...outcomes.failures.keys()]).toEqual([
      'WB-SCHEMA-BAD',
      'WB-EVENT-BAD',
    ]);
    expect(outcomes.failures.get('WB-ABSENT')).toBeUndefined();
  });
});
