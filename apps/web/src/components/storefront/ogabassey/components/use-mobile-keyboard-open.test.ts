import { fireEvent, renderHook, waitFor } from '@testing-library/react';
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

it('keeps the summary hidden until a tap leaving a text input finishes', async () => {
  const input = document.createElement('input');
  const button = document.createElement('button');
  document.body.append(input, button);
  const { result, unmount } = renderHook(() => useMobileKeyboardOpen());
  fireEvent.focusIn(input);
  expect(result.current).toBe(true);
  fireEvent.pointerDown(button);
  fireEvent.focusOut(input, { relatedTarget: button });
  fireEvent.focusIn(button);
  expect(result.current).toBe(true);
  fireEvent.pointerUp(button);
  await waitFor(() => expect(result.current).toBe(false));
  unmount();
  input.remove();
  button.remove();
});
