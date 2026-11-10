import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OXYGEN_SAVE_ERROR, useOxygenFormError } from './use-oxygen-form-error';

it('clears only the save error after a successful save', () => {
  const { result, rerender } = renderHook(
    ({ status }) => useOxygenFormError(status),
    {
      initialProps: { status: 'error' },
    }
  );
  act(() => result.current.setFormError(OXYGEN_SAVE_ERROR));
  rerender({ status: 'saved' });
  expect(result.current.formError).toBe('');
  act(() => result.current.setFormError('Another error'));
  rerender({ status: 'error' });
  rerender({ status: 'saved' });
  expect(result.current.formError).toBe('Another error');
});
