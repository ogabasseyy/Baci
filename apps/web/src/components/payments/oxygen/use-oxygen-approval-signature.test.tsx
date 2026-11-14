import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useOxygenApprovalSignature } from './use-oxygen-approval-signature';

it('saves drawn ink on acceptance without requesting OTP and reuses the saved signature', async () => {
  const file = new File(['ink'], 'signature.png', { type: 'image/png' });
  const save = vi.fn(async () => file);
  const { result } = renderHook(() => useOxygenApprovalSignature());
  result.current.capture.current = { save };
  await act(async () => {
    await result.current.accept(true);
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(result.current.signature).toBe(file);
  expect(result.current.accepted).toBe(true);
  await act(async () => {
    await result.current.accept(false);
    await result.current.accept(true);
  });
  expect(save).toHaveBeenCalledTimes(1);
  act(() => result.current.change(undefined));
  expect(result.current.accepted).toBe(false);
  expect(result.current.signature).toBeUndefined();
});

it('keeps acceptance off when signature saving fails', async () => {
  const { result } = renderHook(() => useOxygenApprovalSignature());
  result.current.capture.current = {
    save: vi.fn().mockRejectedValue(new Error('export failed')),
  };
  await act(async () => {
    await result.current.accept(true);
  });
  expect(result.current.accepted).toBe(false);
  expect(result.current.saving).toBe(false);
  expect(result.current.error).toContain('could not save');
});
