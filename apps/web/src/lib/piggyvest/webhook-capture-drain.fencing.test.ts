import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: vi.fn() }));

import { emitPiggyvestWebhookAlert } from './webhook-alerts';
import { drainPiggyvestWebhookCaptures } from './webhook-capture-drain';
import {
  drainDeps,
  row,
  schemaValidInflow,
} from './webhook-capture-drain.test-support';
import { runCaptureDrainPass } from './webhook-capture-drain-pass';
import { createStatefulCaptureExecutor } from './webhook-capture-pg-executor.test-support';
import { createPgCaptureQueue } from './webhook-capture-queue';

function fixture() {
  const body = schemaValidInflow('lease-fence', 'bank-transfer.inflow.success');
  const stored = row(body, 'ab'.repeat(64));
  const process = vi.fn(async () => ({ status: 200 }));
  const deps = drainDeps(
    () => ({ env: { NODE_ENV: 'test' }, resolved: [] }),
    [[stored], [stored]],
    process
  );
  deps.verify = () => ({
    status: 'verified',
    secret: 'fixture',
    families: ['legacy'],
    keyVersion: 'v1',
    keyStatus: 'current',
  });
  return { deps, process, stored };
}

describe('capture replay lease fence', () => {
  it.each([
    'lost',
    'failed',
    'late',
  ] as const)('does not dispatch with a %s renewal', async (mode) => {
    const { deps, process } = fixture();
    let now = 0;
    deps.nowMs = () => now;
    deps.renew = vi.fn(async () => {
      if (mode === 'failed') throw new Error('unavailable');
      if (mode === 'late') now = 30_001;
      return mode !== 'lost';
    });
    expect(await drainPiggyvestWebhookCaptures(deps)).toMatchObject({
      retried: 1,
      processed: 0,
    });
    expect(process).not.toHaveBeenCalled();
  });

  it('replays after an on-time renewal without widening authority', async () => {
    const { deps, process, stored } = fixture();
    deps.renew = vi.fn(async () => true);
    expect(await drainPiggyvestWebhookCaptures(deps)).toMatchObject({
      processed: 1,
    });
    expect(deps.renew).toHaveBeenCalledWith(
      stored.capture_id,
      stored.claim_token
    );
    expect(process).toHaveBeenCalledOnce();
  });

  it('admits one row at a time and leaves later work unclaimed at the deadline', async () => {
    const { deps, process } = fixture();
    let now = 0;
    process.mockImplementation(async () => {
      now = 11_000;
      return { status: 200 };
    });
    const claim = vi.spyOn(deps, 'claim');
    expect(
      await runCaptureDrainPass(deps, { limit: 10, nowMs: () => now })
    ).toMatchObject({ claimed: 1, processed: 1 });
    expect(claim).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('does not park or alert after an inline completion wins a claimed row', async () => {
    vi.clearAllMocks();
    let now = 0;
    const model = createStatefulCaptureExecutor(() => now);
    const { deps, stored, process } = fixture();
    const capture = model.insert({
      raw_hex: stored.raw_hex,
      signature: stored.signature,
      key_version: 'v1',
      key_families: ['legacy'],
      event_type: 'bank-transfer.inflow.success',
    });
    now = 121_000;
    const queue = createPgCaptureQueue(model.executor);
    deps.claim = (limit) => queue.claim(limit);
    deps.resolve = (...args) => queue.resolve(...args);
    deps.outOfScope = () => {
      expect(model.completeInline(capture.id)).toBe(true);
      return 'LEGACY_FAMILY';
    };
    expect(await drainPiggyvestWebhookCaptures(deps)).toMatchObject({
      retried: 1,
      needsReview: 0,
    });
    expect(capture.processing_state).toBe('processed');
    expect(process).not.toHaveBeenCalled();
    expect(emitPiggyvestWebhookAlert).not.toHaveBeenCalled();
  });
});
