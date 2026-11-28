import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  flush: vi.fn(async () => true),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: api.fetch }));

vi.mock('./use-oxygen-draft', () => ({
  useOxygenDraft: () => ({
    initial: null,
    ready: true,
    status: 'saved',
    queue: vi.fn(),
    flush: api.flush,
    retry: vi.fn(),
  }),
}));

import { OxygenCustomerForm } from './OxygenCustomerForm';

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

it('prefills saved details, allows corrections, and never assumes consent or provider KYC', () => {
  render(
    <OxygenCustomerForm
      busy={false}
      phone="08000000001"
      submit={vi.fn()}
      prefill={{
        first_name: 'Ada',
        last_name: 'Okon',
        email: 'ada@example.com',
        date_of_birth: '1990-02-10',
      }}
    />
  );
  expect(screen.getByLabelText('First name')).toHaveValue('Ada');
  expect(screen.getByLabelText('Last name')).toHaveValue('Okon');
  expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
  expect(screen.getByLabelText('Date of birth')).toHaveValue('10/02/1990');
  fireEvent.change(screen.getByLabelText('First name'), {
    target: { value: 'Adanna' },
  });
  expect(screen.getByLabelText('First name')).toHaveValue('Adanna');
  expect(screen.getByLabelText('BVN')).toHaveValue('');
  expect(screen.getByLabelText('NIN')).toHaveValue('');
  expect(screen.getByRole('checkbox', { hidden: true })).not.toBeChecked();
  expect(screen.queryByText(/Checkout phone:/)).toBeNull();
  expect(screen.queryByText(/Saved profile details are filled/)).toBeNull();
  expect(screen.getByText('Edit name and email')).toBeVisible();
  expect(screen.getByLabelText('First name')).not.toBeVisible();
  expect(screen.getByAltText('Oxygen X Finance Company')).toBeVisible();
  expect(
    screen.getByText(
      /A subsidiary of Access Holdings, Access Bank’s parent company/
    )
  ).toBeVisible();
});
it('keeps manual entry available when no saved profile exists', () => {
  render(
    <OxygenCustomerForm busy={false} phone="08000000001" submit={vi.fn()} />
  );
  expect(screen.getByLabelText('Email')).toHaveValue('');
});

it('walks through identity, bank and income in checkout without submitting early', () => {
  const submit = vi.fn();
  render(
    <OxygenCustomerForm busy={false} phone="08000000001" submit={submit} />
  );
  expect(
    screen.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible();
  expect(screen.getByLabelText('Monthly income (₦)')).not.toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to bank details' })
  );
  expect(submit).not.toHaveBeenCalled();
  expect(
    screen.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible();
});

it('moves to bank verification and back without losing identity inputs or creating an application', () => {
  const submit = vi.fn();
  const progress = vi.fn();
  render(
    <OxygenCustomerForm
      busy={false}
      phone="08000000001"
      submit={submit}
      onProgress={progress}
      prefill={{
        first_name: 'Ada',
        last_name: 'Okon',
        email: 'ada@example.com',
      }}
    />
  );
  fireEvent.change(screen.getByLabelText('BVN'), {
    target: { value: '12345678901' },
  });
  fireEvent.change(screen.getByLabelText('NIN'), {
    target: { value: '12345678902' },
  });
  fireEvent.change(screen.getByLabelText('Date of birth'), {
    target: { value: '10/02/1990' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to bank details' })
  );
  expect(
    screen.getByRole('heading', { name: 'Verify your bank account' })
  ).toBeVisible();
  expect(screen.getByLabelText('BVN')).not.toBeVisible();
  expect(progress).toHaveBeenCalledWith('bank', 'identity');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(progress).toHaveBeenLastCalledWith('identity');
  expect(screen.getByLabelText('BVN')).toHaveValue('12345678901');
  expect(submit).not.toHaveBeenCalled();
});

it('asks one bank or income question at a time in the chat application', async () => {
  const submit = vi.fn();
  api.fetch.mockImplementation(async (_: string, options: RequestInit) =>
    JSON.parse(String(options.body)).action === 'banks'
      ? Response.json({ banks: [{ name: 'Test bank', code: '001' }] })
      : Response.json({ accountName: 'TEST CUSTOMER' })
  );
  render(
    <OxygenCustomerForm
      busy={false}
      conversational
      phone="08000000001"
      submit={submit}
      workflowId="60000000-0000-4000-8000-000000000001"
      prefill={{
        first_name: 'Ada',
        last_name: 'Obi',
        email: 'ada@example.com',
      }}
    />
  );
  const next = () =>
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  expect(screen.getByLabelText('BVN')).toBeVisible();
  expect(screen.getByLabelText('NIN')).not.toBeVisible();
  fireEvent.change(screen.getByLabelText('BVN'), {
    target: { value: '12345678901' },
  });
  next();
  expect(screen.getByLabelText('NIN')).toBeVisible();
  expect(screen.getByLabelText('Date of birth')).not.toBeVisible();
  fireEvent.change(screen.getByLabelText('NIN'), {
    target: { value: '12345678902' },
  });
  next();
  expect(screen.getByLabelText('Date of birth')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Date of birth'), {
    target: { value: '10/02/1990' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to bank details' })
  );
  expect(screen.getByText('Which bank should we use?')).toBeVisible();
  expect(screen.getByLabelText('Account number')).not.toBeVisible();
  await waitFor(() => expect(screen.getByLabelText('Bank')).toBeEnabled());
  fireEvent.keyDown(screen.getByLabelText('Bank'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Test bank' }));
  expect(screen.getByLabelText('Account number')).not.toBeVisible();
  next();
  expect(screen.getByLabelText('Bank')).not.toBeVisible();
  expect(screen.getByLabelText('Account number')).toBeVisible();
  const verified = screen.getByRole('button', {
    name: 'Yes, that’s my account',
  });
  expect(verified).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '0123456789' },
  });
  await waitFor(() => expect(verified).toBeEnabled());
  fireEvent.click(verified);
  expect(screen.getByLabelText('Employment status')).toBeVisible();
  expect(screen.getByLabelText('Employer')).not.toBeVisible();
  expect(screen.getByLabelText('Monthly income (₦)')).not.toBeVisible();
  fireEvent.change(screen.getByLabelText('Employment status'), {
    target: { value: 'EMPLOYED' },
  });
  next();
  fireEvent.change(screen.getByLabelText('Employer'), {
    target: { value: 'QA Employer' },
  });
  next();
  expect(screen.getByLabelText('Employer')).not.toBeVisible();
  expect(screen.getByLabelText('Monthly income (₦)')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Monthly income (₦)'), {
    target: { value: '200000' },
  });
  next();
  expect(screen.getByLabelText('When are you paid?')).toBeVisible();
  fireEvent.change(screen.getByLabelText('When are you paid?'), {
    target: { value: '25' },
  });
  next();
  expect(screen.queryByLabelText('Proof of address')).toBeNull();
  expect(
    screen.getByRole('checkbox', { name: /agree to share/i })
  ).toBeVisible();
  expect(submit).not.toHaveBeenCalled();
});

it('auto-opens collapsed contact details and highlights the invalid email when Zod validation rejects it', async () => {
  const submit = vi.fn();
  api.fetch.mockImplementation(async (_: string, options: RequestInit) =>
    JSON.parse(String(options.body)).action === 'banks'
      ? Response.json({ banks: [{ name: 'Test bank', code: '001' }] })
      : Response.json({ accountName: 'ADA OKON' })
  );
  render(
    <OxygenCustomerForm
      busy={false}
      phone="08000000001"
      submit={submit}
      workflowId="60000000-0000-4000-8000-000000000001"
      prefill={{
        first_name: 'Ada',
        last_name: 'Okon',
        email: 'ada@invalid',
        date_of_birth: '1990-02-10',
      }}
    />
  );
  expect(screen.getByLabelText('Email')).not.toBeVisible();
  fireEvent.change(screen.getByLabelText('BVN'), {
    target: { value: '12345678901' },
  });
  fireEvent.change(screen.getByLabelText('NIN'), {
    target: { value: '12345678902' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to bank details' })
  );
  await waitFor(() => expect(screen.getByLabelText('Bank')).toBeEnabled());
  fireEvent.keyDown(screen.getByLabelText('Bank'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Test bank' }));
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '0123456789' },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue to income details' })
    ).toBeEnabled()
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to income details' })
  );
  fireEvent.change(screen.getByLabelText('Monthly income (₦)'), {
    target: { value: '200000' },
  });
  fireEvent.change(screen.getByLabelText('When are you paid?'), {
    target: { value: '25' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue verification' })
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please review your identity and contact details before continuing.'
    )
  );
  expect(screen.getByLabelText('Email')).toBeVisible();
  expect(screen.getByLabelText('Email')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  expect(submit).not.toHaveBeenCalled();
});
