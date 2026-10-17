import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { loadAttemptBody } from './cart-handoff-support';
import { useHandoffRedeem } from './use-handoff-redeem';

afterEach(() => vi.unstubAllGlobals());

it('persists the exact body and locks the first choice', async () => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'temporarily_unavailable' }), {
        status: 503,
      })
    )
  );
  const { result } = renderHook(() =>
    useHandoffRedeem({
      handoffId: 'handoff-wiring',
      merchantSlug: 'shop',
      bootstrapRequired: { current: false },
      setRedeeming: vi.fn(),
      setRedeemError: vi.fn(),
      setConflicts: vi.fn(),
      setResolutions: vi.fn(),
      setLoadError: vi.fn(),
      refreshPreview: vi.fn(async () => null),
    })
  );
  const body = { attemptId: 'a1', choice: 'connect' };
  await act(async () => {
    result.current.lockChoice('connect');
    await result.current.postRedeem(body);
  });
  expect(result.current.lockedChoice).toBe('connect');
  expect(result.current.attemptSent).toBe(true);
  expect(loadAttemptBody('handoff-wiring')).toEqual(body);
});
