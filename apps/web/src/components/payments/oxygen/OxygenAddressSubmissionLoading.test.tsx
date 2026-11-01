import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenResidentialForm } from './OxygenResidentialForm';
import { residentialAddress } from './oxygen-residential-address';

vi.mock('./use-oxygen-residential-context', () => ({
  useOxygenResidentialContext: () => ({
    ready: true,
    address: {},
    fromCheckout: false,
  }),
}));
it('shows the full activity immediately while the server response is pending and preserves input on failure', async () => {
  let resolve!: (success: boolean) => void;
  const submit = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      })
  );
  const address = residentialAddress({
    street: 'Example Road',
    state: 'Lagos',
    city: 'Lagos',
    lga: 'Ikeja',
    landmark: 'Example Mall',
    house_number: '2',
  });
  const file = new File(['proof'], 'bill.pdf', { type: 'application/pdf' });
  render(
    <OxygenResidentialForm
      busy={false}
      submit={submit}
      prepared={{ address, file }}
    />
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: /This is my home address/ })
  );
  fireEvent.submit(screen.getByRole('form', { name: 'Verify address' }));
  expect(
    screen.getByRole('heading', { name: 'Sending your address securely' })
  ).toBeVisible();
  expect(screen.queryByRole('form', { name: 'Verify address' })).toBeNull();
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => resolve(false));
  await waitFor(() =>
    expect(screen.getByRole('form', { name: 'Verify address' })).toBeVisible()
  );
  expect(screen.getByLabelText('Street address')).toHaveValue('Example Road');
  expect(screen.getByText('bill.pdf')).toBeVisible();
  expect(submit).toHaveBeenCalledTimes(1);
});
