import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenEmploymentAndAddress } from './OxygenEmploymentAndAddress';

it('renders employment fields and visible consent on step 2 without residential address fields', () => {
  render(
    <form>
      <OxygenEmploymentAndAddress defaults={{}} />
    </form>
  );
  expect(screen.getByLabelText('Monthly income (₦)')).toBeVisible();
  expect(screen.getByLabelText('When are you paid?')).toBeVisible();
  expect(screen.getByRole('checkbox')).toBeVisible();
  expect(screen.queryByLabelText('Street address')).toBeNull();
  expect(screen.queryByLabelText('Proof of address')).toBeNull();
});
