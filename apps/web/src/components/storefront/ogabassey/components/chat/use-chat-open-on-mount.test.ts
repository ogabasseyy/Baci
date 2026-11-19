import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useChatOpenOnMount } from './use-chat-open-on-mount';

it('does not reopen when closing chat replaces the setter on rerender', () => {
  const first = vi.fn();
  const closed = vi.fn();
  const { rerender } = renderHook(
    ({ setter }) => useChatOpenOnMount(true, setter),
    { initialProps: { setter: first } }
  );
  expect(first).toHaveBeenCalledWith(true);
  rerender({ setter: closed });
  expect(closed).not.toHaveBeenCalled();
});

it('leaves an unrequested launcher closed', () => {
  const setter = vi.fn();
  renderHook(() => useChatOpenOnMount(false, setter));
  expect(setter).not.toHaveBeenCalled();
});
