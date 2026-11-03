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
    {
      generationRef: { current: 1 },
      dispatch,
      setLinkPhase,
      ensureCart,
      bootstrappingRef: { current: false },
      createRequestRef: { current: null },
    },
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

it('fails the import instead of stranding it pending when provisioning returns null past retries', async () => {
  const dispatch = vi.fn();
  const setLinkPhase = vi.fn();
  const scheduled: (() => void)[] = [];
  const ensureCart = vi.fn().mockResolvedValue(null);
  const provision = createInitialCartProvisioner(
    {
      generationRef: { current: 1 },
      dispatch,
      setLinkPhase,
      ensureCart,
      bootstrappingRef: { current: false },
      createRequestRef: { current: null },
    },
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
    scheduled.shift()?.();
    await vi.waitFor(() => expect(ensureCart).toHaveBeenCalledTimes(i + 2));
  }
  await vi.waitFor(() => expect(setLinkPhase).toHaveBeenCalledWith('ready'));
  expect(dispatch).toHaveBeenCalledWith({
    generation: 1,
    type: 'import/failed',
    code: 'temporarily_unavailable',
  });
});

it('keeps waiting when a parallel create owns provisioning past the retry budget', async () => {
  const dispatch = vi.fn();
  const setLinkPhase = vi.fn();
  const scheduled: (() => void)[] = [];
  const ensureCart = vi.fn().mockResolvedValue(null);
  const provision = createInitialCartProvisioner(
    {
      generationRef: { current: 1 },
      dispatch,
      setLinkPhase,
      ensureCart,
      bootstrappingRef: { current: false },
      createRequestRef: { current: { operationId: 'owned' } },
    },
    {
      isLive: () => true,
      whenVisible: vi.fn(),
      schedule: (callback) => {
        scheduled.push(callback);
      },
    }
  );
  await provision(0);
  // Pump scheduled retries/owner-waits until the bounded wait gives up.
  for (let i = 0; i < 300 && !setLinkPhase.mock.calls.length; i++) {
    scheduled.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  // While the owner appears in flight, no failure is dispatched; the
  // bounded owner wait eventually fails the import and readies.
  expect(ensureCart.mock.calls.length).toBeGreaterThan(MAX_AUTO_RETRIES + 1);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'import/failed' })
  );
  expect(setLinkPhase).toHaveBeenCalledWith('ready');
});
