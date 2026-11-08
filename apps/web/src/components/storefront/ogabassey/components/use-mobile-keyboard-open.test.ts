import { fireEvent, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useMobileKeyboardOpen } from './use-mobile-keyboard-open';

it('tracks text entry focus without treating a checkbox as a keyboard', () => {
  const input = document.createElement('input');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  document.body.append(input, checkbox);
  const { result, unmount } = renderHook(() => useMobileKeyboardOpen());
  fireEvent.focusIn(input);
  expect(result.current).toBe(true);
  fireEvent.focusOut(input, { relatedTarget: checkbox });
  expect(result.current).toBe(false);
  unmount();
  input.remove();
  checkbox.remove();
});
