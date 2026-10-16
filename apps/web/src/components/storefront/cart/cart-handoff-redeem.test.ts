import { afterEach, expect, it, vi } from 'vitest';
import {
  type HandoffRedeemDeps,
  postHandoffRedeem,
} from './cart-handoff-redeem';

afterEach(() => vi.unstubAllGlobals());

function deps(overrides: Partial<HandoffRedeemDeps> = {}): HandoffRedeemDeps {
  return {
    handoffId: 'public-id',
    merchantSlug: 'shop',
    bootstrapRequired: { current: false },
    setRedeeming: vi.fn(),
    setRedeemError: vi.fn(),
    setConflicts: vi.fn(),
    setResolutions: vi.fn(),
    setLoadError: vi.fn(),
    onAttemptConsumed: vi.fn(),
    onMergeConflict: vi.fn(),
    refreshPreview: vi.fn(async () => null),
    ...overrides,
  };
}

it('releases the attempt and refreshes previews after a version conflict', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'version_conflict' }), {
        status: 409,
      })
    )
  );
  const redeemDeps = deps();
  await expect(postHandoffRedeem(redeemDeps, {})).resolves.toBe(false);
  expect(redeemDeps.onAttemptConsumed).toHaveBeenCalledTimes(1);
  expect(redeemDeps.refreshPreview).toHaveBeenCalledTimes(1);
  expect(redeemDeps.setConflicts).toHaveBeenCalledWith([]);
  expect(redeemDeps.setResolutions).toHaveBeenCalledWith({});
});

it('keeps the attempt after an indeterminate server failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'temporarily_unavailable' }), {
        status: 503,
      })
    )
  );
  const redeemDeps = deps();
  await expect(postHandoffRedeem(redeemDeps, {})).resolves.toBe(false);
  expect(redeemDeps.onAttemptConsumed).not.toHaveBeenCalled();
  expect(redeemDeps.refreshPreview).not.toHaveBeenCalled();
});

it('releases the attempt and requires bootstrap after a proof rejection', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'expired_proof' }), {
        status: 401,
      })
    )
  );
  const redeemDeps = deps();
  await expect(postHandoffRedeem(redeemDeps, {})).resolves.toBe(false);
  expect(redeemDeps.onAttemptConsumed).toHaveBeenCalledTimes(1);
  expect(redeemDeps.bootstrapRequired.current).toBe(true);
  expect(redeemDeps.refreshPreview).toHaveBeenCalledTimes(1);
});

it('consumes the attempt after a consumed-handoff reply', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'handoff_consumed' }), {
        status: 410,
      })
    )
  );
  const redeemDeps = deps();
  await expect(postHandoffRedeem(redeemDeps, {})).resolves.toBe(false);
  expect(redeemDeps.onAttemptConsumed).toHaveBeenCalledTimes(1);
  expect(redeemDeps.setLoadError).toHaveBeenCalledWith(
    expect.stringMatching(/already used/)
  );
});
