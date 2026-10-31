import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import {
  type DrainDeps,
  drainPiggyvestWebhookCaptures,
} from './webhook-capture-drain';

/**
 * Replay re-verifies authenticity, but processing authority is the
 * intersection of what replay verification reports and the families
 * durably recorded at admission. A drain must never grant more than
 * ingress recorded, even if the injected verifier reports a wider set.
 */

const body = JSON.stringify({ eventId: 'evt-a', eventType: 'x' });
const key = randomBytes(32).toString('hex');

function row(families: PiggyvestClaimedCapture['key_families']) {
  return {
    capture_id: crypto.randomUUID(),
    claim_token: crypto.randomUUID(),
    raw_hex: Buffer.from(body).toString('hex'),
    signature: createHmac('sha512', key).update(body).digest('hex'),
    key_version: 'k-0123456789abcdef',
    key_families: families,
    attempts: 1,
    event_type: 'x',
    provider_transaction_id: null,
  } satisfies PiggyvestClaimedCapture;
}

function setup(
  recorded: PiggyvestClaimedCapture['key_families'],
  reported: ('legacy' | 'bank' | 'custody' | 'interest')[]
) {
  const resolved: { state: string; error: string | null }[] = [];
  const process = vi.fn(async () => ({ status: 200 }));
  const verify = vi.fn(() => ({
    status: 'verified' as const,
    secret: key,
    families: reported,
    keyVersion: 'k',
    keyStatus: 'replay-only' as const,
  }));
  const deps: DrainDeps = {
    claim: async () => [row(recorded)],
    resolve: async (_id, _token, state, error) => {
      resolved.push({ state, error });
      return true;
    },
    verify,
    process,
  };
  return { deps, resolved, process, verify };
}

describe('drain authority', () => {
  it('passes the recorded families to the verifier and processes with their intersection only', async () => {
    const { deps, process, verify } = setup(
      ['interest'],
      ['interest', 'legacy']
    );
    const alerts = vi.spyOn(console, 'error').mockImplementation(() => {});

    await drainPiggyvestWebhookCaptures(deps);

    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ recordedFamilies: ['interest'] })
    );
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({ families: ['interest'] })
    );
    alerts.mockRestore();
  });

  it('a normal replay within the recorded family still processes with it', async () => {
    const { deps, process, resolved } = setup(
      ['bank', 'legacy'],
      ['legacy', 'bank']
    );

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({ families: ['legacy', 'bank'] })
    );
    expect(summary.processed).toBe(1);
    expect(resolved).toEqual([{ state: 'processed', error: null }]);
  });

  it('never processes when replay holds none of the recorded families, and escalates to review', async () => {
    const { deps, process, resolved } = setup(['bank'], ['legacy']);
    const alerts = vi.spyOn(console, 'error').mockImplementation(() => {});

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(process).not.toHaveBeenCalled();
    expect(resolved).toEqual([
      { state: 'needs_review', error: 'REPLAY_AUTHORITY_NOT_RECORDED' },
    ]);
    expect(summary).toMatchObject({ needsReview: 1, processed: 0 });
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_NEEDS_REVIEW')
    );
    alerts.mockRestore();
  });

  it('treats an authority_lost verdict from the verifier the same way', async () => {
    const { deps, process, resolved } = setup(['bank'], ['bank']);
    deps.verify = () => ({ status: 'authority_lost' as const });
    const alerts = vi.spyOn(console, 'error').mockImplementation(() => {});

    await drainPiggyvestWebhookCaptures(deps);

    expect(process).not.toHaveBeenCalled();
    expect(resolved[0]).toEqual({
      state: 'needs_review',
      error: 'REPLAY_AUTHORITY_NOT_RECORDED',
    });
    alerts.mockRestore();
  });
});
