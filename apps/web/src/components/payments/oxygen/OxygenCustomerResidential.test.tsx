import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
afterEach(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

import { CustomerFormFields } from './OxygenCustomerFormFields';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(async (_url: string, options: RequestInit) =>
    JSON.parse(String(options.body)).action === 'banks'
      ? Response.json({ banks: [{ code: '058', name: 'Test bank' }] })
      : Response.json({ accountName: 'Test Customer' })
  ),
}));
vi.mock('@/components/address-autocomplete', () => ({
  AddressAutocomplete: () => <input aria-label="Address search" />,
}));
vi.mock('./OxygenVerificationTrust', () => ({
  OxygenVerificationTrust: () => null,
}));
it('submits start_application from step 2 without requiring address or proof upfront', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  const save = vi.fn();
  const flush = vi.fn().mockResolvedValue(true);
  render(
    <CustomerFormFields
      busy={false}
      phone="08000000001"
      workflowId="60000000-0000-4000-8000-000000000001"
      submit={submit}
      initialDraft={{
        step: 2,
        fields: {
          first_name: 'Test',
          last_name: 'Customer',
          email: 'test@example.com',
          bvn: '12345678901',
          nin: '12345678901',
          date_of_birth: '1990-01-01',
          birth_date_entry: '01/01/1990',
          bank_code: '058',
          account_number: '0000000000',
          salary_amount: '500000',
          salary_date: '25',
          name_of_employer: 'Example',
          employment_status: 'EMPLOYED',
        },
      }}
      saveDraft={save}
      flushDraft={flush}
      saveBlocked={false}
    />
  );
  await screen.findByRole('heading', { name: 'Employment and consent' });
  await waitFor(() =>
    expect(screen.getByLabelText('Account name')).toHaveValue('Test Customer')
  );
  expect(screen.queryByLabelText('Street address')).toBeNull();
  expect(screen.queryByLabelText('Proof of address')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /I agree to share/ }));
  flush.mockResolvedValueOnce(false);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue verification' })
    ).toBeEnabled()
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue verification' })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'We could not save your details. Check the message above before continuing.'
  );
  expect(submit).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue verification' })
    ).toBeEnabled()
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue verification' })
  );
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit.mock.calls[0][0].action).toBe('start_application');
});

it('focuses and highlights the missing payday instead of the error banner', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  render(
    <CustomerFormFields
      busy={false}
      phone="08000000001"
      workflowId="60000000-0000-4000-8000-000000000001"
      submit={vi.fn()}
      initialDraft={{
        step: 2,
        fields: {
          bank_code: '058',
          account_number: '0000000000',
          salary_amount: '500000',
          salary_date: '',
        },
      }}
      saveDraft={vi.fn()}
      flushDraft={async () => true}
      saveBlocked={false}
    />
  );
  await screen.findByRole('heading', { name: 'Employment and consent' });
  const payday = screen.getByLabelText('When are you paid?');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue verification' })
    ).toBeEnabled()
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue verification' })
  );
  await waitFor(() => expect(payday).toHaveFocus());
  expect(payday).toHaveAttribute('aria-invalid', 'true');
  expect(payday.scrollIntoView).toHaveBeenCalled();
  fireEvent.change(payday, { target: { value: '25' } });
  expect(payday).not.toHaveAttribute('aria-invalid');
});
