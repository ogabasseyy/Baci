import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenFormError } from './OxygenFormError';

it('announces errors using the supplied identifier and hides when clear', () => {
  const { rerender } = render(
    <OxygenFormError id="form-error" error="Save failed" />
  );
  expect(screen.getByRole('alert')).toHaveAttribute('id', 'form-error');
  expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
  rerender(<OxygenFormError id="form-error" error="" />);
  expect(screen.queryByRole('alert')).toBeNull();
});
