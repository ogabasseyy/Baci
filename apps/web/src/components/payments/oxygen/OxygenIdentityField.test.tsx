import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenIdentityField } from './OxygenIdentityField';

it('masks identifiers by default and lets the customer reveal each independently without changing values', () => {
  render(
    <>
      <OxygenIdentityField name="bvn" label="BVN" />
      <OxygenIdentityField name="nin" label="NIN" />
    </>
  );
  const bvn = screen.getByLabelText('BVN');
  const nin = screen.getByLabelText('NIN');
  expect(bvn).toHaveAttribute('type', 'password');
  expect(nin).toHaveAttribute('type', 'password');
  expect(bvn).toHaveAttribute('inputmode', 'numeric');
  fireEvent.change(bvn, { target: { value: '12345678901' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show BVN' }));
  expect(bvn).toHaveAttribute('type', 'text');
  expect(bvn).toHaveValue('12345678901');
  expect(nin).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Hide BVN' }));
  expect(bvn).toHaveAttribute('type', 'password');
  expect(bvn).toHaveValue('12345678901');
  expect(bvn).toBeRequired();
  expect(bvn).toHaveAttribute('pattern', '[0-9]{11}');
});
