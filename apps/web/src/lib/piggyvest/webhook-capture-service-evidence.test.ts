import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import { collectPiggyvestWebhookCaptureEvidence } from './webhook-capture-service-evidence';

const NOW = new Date('2026-10-30T12:00:00.000Z');

describe('collectPiggyvestWebhookCaptureEvidence', () => {
  const status = {
    pending: 1,
    claimed: 0,
    needsReview: 0,
    oldestUnprocessedAt: null,
    lastCapturedAt: null,
    lastProcessedAt: null,
  };
  const collect = (rpc: () => Promise<{ data: unknown; error: unknown }>) =>
    collectPiggyvestWebhookCaptureEvidence({
      client: { rpc: vi.fn(rpc) } as unknown as PiggyvestIntakeServiceClient,
      env: { NODE_ENV: 'test' },
      now: NOW,
    });

  it('reads the counters through the status function', async () => {
    await expect(
      collect(async () => ({ data: status, error: null }))
    ).resolves.toMatchObject({ storage: { ok: true, status } });
  });

  it.each([
    ['PGRST202', 'function_missing'],
    ['42883', 'function_missing'],
    ['08006', 'unreachable'],
  ])('classifies database error %s as %s', async (code, reason) => {
    await expect(
      collect(async () => ({ data: null, error: { code, message: 'x' } }))
    ).resolves.toMatchObject({ storage: { ok: false, reason } });
  });

  it('treats a thrown transport error as unreachable and a bad shape as invalid', async () => {
    await expect(
      collect(async () => {
        throw new Error('socket closed');
      })
    ).resolves.toMatchObject({ storage: { ok: false, reason: 'unreachable' } });
    await expect(
      collect(async () => ({ data: { nope: true }, error: null }))
    ).resolves.toMatchObject({
      storage: { ok: false, reason: 'invalid_response' },
    });
  });
});
