import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenVerificationForms } from './OxygenVerificationForms';
import { installOxygenOtpTestEnvironment } from './oxygen-otp-test-environment.test-support';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(async () =>
    Response.json({
      address: {
        state: 'Lagos',
        city: 'Ikeja',
        lga: 'Ikeja',
        street: 'Old Street',
        house_number: '1',
      },
      source: 'checkout',
    })
  ),
}));

installOxygenOtpTestEnvironment();

it('submits address at booked stage when optional landmark is left blank', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenVerificationForms
      stage="booked"
      address={{}}
      approvalOtpReady={false}
      busy={false}
      submit={submit}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Enter address manually' })
  );
  for (const [label, value] of [
    ['State', 'Lagos'],
    ['City / town', 'Ikeja'],
    ['Local government area (LGA)', 'Ikeja'],
    ['Street address', 'Street'],
    ['House / flat number', '1'],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(
    screen.getByLabelText(
      'This is my home address and matches my proof of address.'
    )
  );
  const bill = new File(['bill'], 'bill.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Proof of address'), {
    target: { files: [bill] },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Verify address' }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith(
      {
        action: 'submit_address',
        state: 'Lagos',
        city: 'Ikeja',
        lga: 'Ikeja',
        street: 'Street',
        landmark: '',
        house_number: '1',
      },
      bill
    )
  );
});

it('blocks submitting the previous address when search text was edited without selecting or switching to manual', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenVerificationForms
      stage="booked"
      workflowId="wf-booked-1"
      address={{}}
      approvalOtpReady={false}
      busy={false}
      submit={submit}
    />
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Change address' })
  );
  fireEvent.change(screen.getByLabelText('Find your home address'), {
    target: { value: '20 Admiralty Way' },
  });
  fireEvent.click(
    screen.getByLabelText(
      'This is my home address and matches my proof of address.'
    )
  );
  const bill = new File(['bill'], 'bill.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Proof of address'), {
    target: { files: [bill] },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Verify address' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Select an address from search or enter your address manually.'
  );
  expect(submit).not.toHaveBeenCalled();
});
