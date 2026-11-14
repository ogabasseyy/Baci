import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useOxygenHostedSelfieRenewal } from './use-oxygen-hosted-selfie-renewal';

it('reports renewal failures and confirms a successful explicit retry', async () => {
  const renew = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce('confirmed');
  const confirmed = vi.fn();
  const { result, unmount } = renderHook(() =>
    useOxygenHostedSelfieRenewal(
      'https://selfie.example/session',
      true,
      renew,
      confirmed
    )
  );
  await act(async () => {
    result.current.retry();
  });
  expect(result.current.error).toContain('could not renew');
  await act(async () => {
    result.current.retry();
  });
  expect(confirmed).toHaveBeenCalledOnce();
  unmount();
  expect(renew.mock.calls[1][1].aborted).toBe(true);
});
