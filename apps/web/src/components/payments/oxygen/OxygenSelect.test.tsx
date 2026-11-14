import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenSelect } from './OxygenSelect';

it('forwards selection and disabled state to the native control', () => {
  const change = vi.fn();
  const view = render(
    <OxygenSelect aria-label="Bank" onChange={change}>
      <option value="a">A</option>
      <option value="b">B</option>
    </OxygenSelect>
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Bank' }), {
    target: { value: 'b' },
  });
  expect(change).toHaveBeenCalledOnce();
  view.rerender(
    <OxygenSelect aria-label="Bank" disabled>
      <option>A</option>
    </OxygenSelect>
  );
  expect(screen.getByRole('combobox', { name: 'Bank' })).toBeDisabled();
});
