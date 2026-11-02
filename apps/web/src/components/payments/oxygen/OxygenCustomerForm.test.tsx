import { fireEvent, render, screen } from '@testing-library/react';
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
