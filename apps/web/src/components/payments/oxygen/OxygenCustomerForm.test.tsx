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

it('submits only after identity, account verification, income and explicit consent', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  api.fetch.mockImplementation(async (_url: string, options: RequestInit) =>
    JSON.parse(String(options.body)).action === 'banks'
      ? Response.json({ banks: [{ name: 'Test bank', code: '001' }] })
      : Response.json({ accountName: 'ADA OKON' })
  );
  render(
    <OxygenCustomerForm
      busy={false}
      phone="08000000001"
      workflowId="60000000-0000-4000-8000-000000000001"
      submit={submit}
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
  await waitFor(() => expect(screen.getByLabelText('Bank')).toBeEnabled());
  fireEvent.keyDown(screen.getByLabelText('Bank'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Test bank' }));
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '0123456789' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to income details' })
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Verify your bank account'
  );
  expect(submit).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByLabelText('Account name')).toHaveValue('ADA OKON')
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to income details' })
  );
  await screen.findByRole('button', { name: 'Continue verification' });
  fireEvent.change(screen.getByLabelText('Employer'), {
    target: { value: 'Test employer' },
  });
  fireEvent.change(screen.getByLabelText('Monthly income (₦)'), {
    target: { value: '300000' },
  });
  fireEvent.change(screen.getByLabelText('When are you paid?'), {
    target: { value: '25' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue verification' })
  );
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue verification' })
  );
  await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  expect(submit.mock.calls[0][0].action).toBe('start_application');
  expect(
    submit.mock.calls[0][0].customer.customer_bank_details.account_name
  ).toBe('ADA OKON');
  // A hidden previous step can become invalid after a refresh or input reset.
  const bankSelect = document.querySelector('select[name=bank_code]');
  if (!bankSelect) throw new Error('Expected bank form control');
  fireEvent.change(bankSelect, {
    target: { value: '' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue verification' })
  );
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Verify your bank account' })
    ).toBeVisible()
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Please verify your bank account again before continuing.'
  );
  expect(submit).toHaveBeenCalledOnce();
});

it('shows a continuing state while saving and blocks repeated clicks', async () => {
  let finish: (value: boolean) => void = () => {};
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  api.flush.mockClear();
  api.flush.mockImplementationOnce(() => pending);
  const submit = vi.fn();
  const progress = vi.fn();
  render(
    <OxygenCustomerForm
      busy={false}
      phone="08000000001"
      workflowId="60000000-0000-4000-8000-000000000001"
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
  const form = screen.getByRole('form', { name: 'Oxygen customer details' });
  fireEvent.submit(form);
  expect(screen.getByRole('button', { name: 'Continuing…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Continuing…' })).toHaveAttribute(
    'aria-busy',
    'true'
  );
  fireEvent.submit(form);
  expect(api.flush).toHaveBeenCalledTimes(1);
  finish(true);
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Verify your bank account' })
    ).toBeVisible()
  );
  expect(submit).not.toHaveBeenCalled();
});

it('links the consent text directly to Oxygen terms without a duplicate read link', () => {
  const submit = vi.fn();
  render(
    <OxygenCustomerForm busy={false} phone="08000000001" submit={submit} />
  );
  const terms = screen.getByRole('link', {
    name: 'Oxygen’s terms',
    hidden: true,
  });
  expect(terms).toHaveAttribute(
    'href',
    'https://www.oxygenx.africa/terms-of-service'
  );
  expect(terms).toHaveAttribute('target', '_blank');
  expect(terms).toHaveAttribute('rel', 'noopener noreferrer');
  expect(terms).toHaveClass('underline');
  expect(screen.queryByText('Read Oxygen’s terms')).not.toBeInTheDocument();
  fireEvent.click(terms);
  expect(screen.getByRole('checkbox', { hidden: true })).not.toBeChecked();
  expect(submit).not.toHaveBeenCalled();
});
