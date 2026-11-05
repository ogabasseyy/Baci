import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CustomerFormFields } from './OxygenCustomerFormFields';

vi.mock('./OxygenBankFields', () => ({
  OxygenBankFields: () => (
    <>
      <input name="account_name" value="Test Customer" readOnly />
      <input name="bank_name" value="Test bank" readOnly />
      <input name="bank_code" value="058" readOnly />
      <input name="account_number" value="0000000000" readOnly />
    </>
  ),
}));
vi.mock('@/components/address-autocomplete', () => ({
  AddressAutocomplete: () => <input aria-label="Address search" />,
}));
vi.mock('./OxygenVerificationTrust', () => ({
  OxygenVerificationTrust: () => null,
}));
it('collects the checkout address and proof beside income, without sending them in the create-account payload or draft document', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  const prepare = vi.fn();
  const save = vi.fn();
  render(
    <CustomerFormFields
      busy={false}
      phone="08000000001"
      submit={submit}
      checkoutAddress={{
        street: 'Example Road',
        house_number: '4',
        city: 'Ikeja',
        state: 'Lagos',
        lga: 'Ikeja',
        landmark: 'Example Mall',
      }}
      onResidentialReady={prepare}
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
          salary_amount: '500000',
          salary_date: '25',
          name_of_employer: 'Example',
          employment_status: 'EMPLOYED',
        },
      }}
      saveDraft={save}
      flushDraft={async () => true}
      saveBlocked={false}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to income details' })
  );
  await screen.findByRole('heading', { name: 'Employment and consent' });
  expect(screen.getByText('From your checkout')).toBeVisible();
  expect(screen.getByLabelText('Street address')).toHaveValue('Example Road');
  const file = new File(['bill'], 'bill.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Proof of address'), {
    target: { files: [file] },
  });
  fireEvent.click(
    screen.getByLabelText(
      'This is my home address and matches my proof of address.'
    )
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /I agree to share/ }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue verification' })
  );
  await waitFor(() =>
    expect(prepare).toHaveBeenCalledWith({
      file,
      address: {
        street: 'Example Road',
        house_number: '4',
        city: 'Ikeja',
        state: 'Lagos',
        lga: 'Ikeja',
        landmark: 'Example Mall',
      },
    })
  );
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0][0].action).toBe('start_application');
  expect(JSON.stringify(submit.mock.calls)).not.toContain('Example Road');
  expect(save.mock.calls.at(-1)?.[0].fields.home_street).toBe('Example Road');
  expect(JSON.stringify(save.mock.calls)).not.toContain('bill.pdf');
});
