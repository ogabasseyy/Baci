import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenEmploymentAndAddress } from './OxygenEmploymentAndAddress';

vi.mock('./OxygenResidentialFields', () => ({
  OxygenResidentialFields: () => (
    <input aria-label="Home address" defaultValue="Saved address" />
  ),
}));

it('reveals address and consent after required income details, preserving them when edited', async () => {
  render(
    <form>
      <OxygenEmploymentAndAddress
        defaults={{}}
        collectAddress
        checkoutAddress={{}}
        file={null}
        onFile={vi.fn()}
        onAddressChange={vi.fn()}
      />
    </form>
  );
  expect(screen.getByLabelText('Home address')).not.toBeVisible();
  expect(screen.getByRole('checkbox', { hidden: true })).not.toBeVisible();
  fireEvent.change(screen.getByLabelText('When are you paid?'), {
    target: { value: '25' },
  });
  expect(screen.getByLabelText('Home address')).not.toBeVisible();
  fireEvent.change(screen.getByLabelText('Monthly income (₦)'), {
    target: { value: '50000' },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Home address')).toBeVisible()
  );
  expect(screen.getByRole('checkbox')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Home address'), {
    target: { value: 'My address' },
  });
  fireEvent.change(screen.getByLabelText('Monthly income (₦)'), {
    target: { value: '' },
  });
  expect(screen.getByLabelText('Home address')).toBeVisible();
  expect(screen.getByLabelText('Home address')).toHaveValue('My address');
});
