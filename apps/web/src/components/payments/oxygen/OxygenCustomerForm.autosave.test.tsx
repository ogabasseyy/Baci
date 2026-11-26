import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenCustomerForm } from './OxygenCustomerForm';

const mocks = vi.hoisted(() => ({
  status: 'saved',
  queue: vi.fn(),
  flush: vi.fn(async () => true),
}));
vi.mock('./use-oxygen-draft', () => ({
  useOxygenDraft: () => ({
    initial: {
      step: 2,
      fields: {
        first_name: 'Ada',
        last_name: 'Okon',
        email: 'ada@example.com',
        bvn: '12345678901',
        nin: '12345678902',
        birth_date_entry: '10/02/1990',
        date_of_birth: '1990-02-10',
        bank_code: '001',
        account_number: '0123456789',
        name_of_employer: 'Example',
        salary_amount: '500000',
        salary_date: '25',
      },
    },
    ready: true,
    status: mocks.status,
    queue: mocks.queue,
    flush: mocks.flush,
    retry: vi.fn(),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(async (_url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    return body.action === 'resolve'
      ? { ok: true, json: async () => ({ accountName: 'ADA OKON' }) }
      : {
          ok: true,
          json: async () => ({ banks: [{ code: '001', name: 'Test bank' }] }),
        };
  }),
}));

it('restores step 2 directly with masked identity, reconfirms saved bank in background, and never restores consent', async () => {
  const onProgress = vi.fn();
  render(
    <OxygenCustomerForm
      onProgress={onProgress}
      workflowId="108497c7-a91c-4f72-b3cf-410ed6800fb3"
      phone="08000000001"
      busy={false}
      submit={vi.fn()}
    />
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Account name')).toHaveValue('ADA OKON')
  );
  expect(
    screen.getByRole('heading', { name: 'Employment and consent' })
  ).toBeVisible();
  expect(onProgress).toHaveBeenCalledWith('income');
  expect(screen.getByLabelText('BVN')).toHaveValue('12345678901');
  expect(screen.getByLabelText('BVN')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('Date of birth')).toHaveValue('10/02/1990');
  expect(screen.getByLabelText('Account number')).toHaveValue('0123456789');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  const submitButton = screen.getByRole('button', {
    name: 'Continue verification',
  });
  expect(submitButton).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Verify your bank account' })
    ).toBeVisible()
  );
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: '0123456780' },
  });
  await waitFor(() =>
    expect(mocks.queue.mock.calls.at(-1)?.[0].fields.account_number).toBe(
      '0123456780'
    )
  );
  const saved = mocks.queue.mock.calls.at(-1)?.[0];
  expect(saved.fields.account_number).toBe('0123456780');
  expect(saved.fields).not.toHaveProperty('consent');
  expect(saved.fields).not.toHaveProperty('account_name');
  expect(saved.fields).not.toHaveProperty('bank_name');
  expect(saved.fields).not.toHaveProperty('otp');
});

it('flushes the current allowed values on field blur', async () => {
  render(
    <OxygenCustomerForm
      workflowId="108497c7-a91c-4f72-b3cf-410ed6800fb3"
      phone="08000000001"
      busy={false}
      submit={vi.fn()}
    />
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Account name')).toHaveValue('ADA OKON')
  );
  mocks.queue.mockClear();
  mocks.flush.mockClear();
  fireEvent.change(screen.getByLabelText('Employer'), {
    target: { value: 'Updated employer' },
  });
  fireEvent.blur(screen.getByLabelText('Employer'));
  expect(mocks.queue.mock.calls.at(-1)?.[0].fields.name_of_employer).toBe(
    'Updated employer'
  );
  expect(mocks.flush).toHaveBeenCalledOnce();
});

it('remounts fields when the workflow changes instead of retaining another application edits', async () => {
  const props = { phone: '08000000001', busy: false, submit: vi.fn() };
  const view = render(
    <OxygenCustomerForm
      {...props}
      workflowId="108497c7-a91c-4f72-b3cf-410ed6800fb3"
    />
  );
  fireEvent.change(screen.getByLabelText('BVN'), {
    target: { value: '99999999999' },
  });
  view.rerender(
    <OxygenCustomerForm
      {...props}
      workflowId="208497c7-a91c-4f72-b3cf-410ed6800fb3"
    />
  );
  expect(screen.getByLabelText('BVN')).toHaveValue('12345678901');
});

it('offers an explicit reload action on conflict and blocks continuation', () => {
  mocks.status = 'conflict';
  try {
    render(
      <OxygenCustomerForm
        workflowId="108497c7-a91c-4f72-b3cf-410ed6800fb3"
        phone="08000000001"
        busy={false}
        submit={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Reload saved progress' })
    ).toBeVisible();
    expect(
      screen.getByText(/Your latest edits have not been saved/)
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Continue verification' })
    ).toBeDisabled();
  } finally {
    mocks.status = 'saved';
  }
});

it.each([
  'saved',
  'saving',
])('keeps routine autosave silent while %s', (status) => {
  mocks.status = status;
  try {
    render(
      <OxygenCustomerForm
        phone="08000000001"
        busy={false}
        submit={vi.fn()}
        workflowId="108497c7-a91c-4f72-b3cf-410ed6800fb3"
      />
    );
    expect(screen.queryByText(/^(Saved|Saving…)$/)).toBeNull();
  } finally {
    mocks.status = 'saved';
  }
});
