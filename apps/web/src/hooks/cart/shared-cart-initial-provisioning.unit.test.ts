import { expect, it, vi } from 'vitest';
import { MAX_AUTO_RETRIES } from './shared-cart-hook-support';
import { createInitialCartProvisioner } from './shared-cart-initial-provisioning';

it('bounds retryable provisioning failures and exposes actionable ready/error state', async () => {
  const dispatch = vi.fn();
  const setLinkPhase = vi.fn();
  const scheduled: (() => void)[] = [];
  const ensureCart = vi.fn().mockResolvedValue({
    ok: false,
    code: 'temporarily_unavailable',
    retryable: true,
  });
  const provision = createInitialCartProvisioner(
    { generationRef: { current: 1 }, dispatch, setLinkPhase, ensureCart },
    {
      isLive: () => true,
      whenVisible: vi.fn(),
      schedule: (callback) => {
        scheduled.push(callback);
      },
    }
  );
  await provision(0);
  for (let i = 0; i < MAX_AUTO_RETRIES; i++) {
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    await vi.waitFor(() => expect(ensureCart).toHaveBeenCalledTimes(i + 2));
  }
  await vi.waitFor(() => expect(setLinkPhase).toHaveBeenCalledWith('ready'));
  expect(scheduled).toEqual([]);
  expect(dispatch).toHaveBeenCalledWith({
    generation: 1,
    type: 'import/failed',
    code: 'temporarily_unavailable',
  });
});
