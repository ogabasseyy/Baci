import { describe, expect, it, vi } from 'vitest';
import { quarantinePiggyvestInboxBatch } from './quarantine-inbox';

const configuration = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  batchSize: 10,
  leaseSeconds: 30,
};
const claim = {
  inbox_id: '00000000-0000-4000-8000-000000000002',
  claim_token: '00000000-0000-4000-8000-000000000003',
};

describe('quarantinePiggyvestInboxBatch', () => {
  it('claims and quarantines without reading payloads or applying money', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [claim] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'quarantined' }] });
    expect(
      await quarantinePiggyvestInboxBatch({ configuration, execute })
    ).toEqual({
      status: 'complete',
      claimed: 1,
      quarantined: 1,
      stale: 0,
      failed: 0,
    });
    expect(execute).toHaveBeenNthCalledWith(
      1,
      'SELECT inbox_id, claim_token FROM piggyvest_staging.claim_inbox($1::uuid, $2::integer, $3::integer)',
      [configuration.integrationId, 10, 30]
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      "SELECT piggyvest_staging.finish_inbox($1::uuid, $2::uuid, $3::uuid, 'unsupported', 0) AS outcome",
      [configuration.integrationId, claim.inbox_id, claim.claim_token]
    );
  });

  it.each([
    { ...configuration, environment: 'production' },
    { ...configuration, batchSize: 101 },
    undefined,
  ])('does no SQL for unsafe configuration', async (config) => {
    const execute = vi.fn();
    expect(
      await quarantinePiggyvestInboxBatch({ configuration: config, execute })
    ).toEqual({ status: 'unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not report a stale lease as successful completion', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [claim] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'stale' }] });
    expect(
      await quarantinePiggyvestInboxBatch({ configuration, execute })
    ).toEqual({
      status: 'complete',
      claimed: 1,
      quarantined: 0,
      stale: 1,
      failed: 0,
    });
  });

  it('leaves uncertain completion for lease recovery rather than retrying immediately', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [claim] })
      .mockRejectedValueOnce(new Error('sensitive database detail'));
    expect(
      await quarantinePiggyvestInboxBatch({ configuration, execute })
    ).toEqual({
      status: 'complete',
      claimed: 1,
      quarantined: 0,
      stale: 0,
      failed: 1,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    { rows: [claim, claim] },
    { rows: [{ ...claim, claim_token: '' }] },
  ])('rejects corrupt claim responses without finishing them', async ({
    rows,
  }) => {
    const execute = vi.fn().mockResolvedValueOnce({ rows });
    expect(
      await quarantinePiggyvestInboxBatch({ configuration, execute })
    ).toEqual({ status: 'unavailable' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not claim the queue is drained after an empty batch', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    expect(
      await quarantinePiggyvestInboxBatch({ configuration, execute })
    ).toEqual({
      status: 'complete',
      claimed: 0,
      quarantined: 0,
      stale: 0,
      failed: 0,
    });
  });
});
