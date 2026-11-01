import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';

const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));

import { continueWithSignature } from './approval-test-helpers';
import { OxygenApprovalCode } from './OxygenApprovalCode';

beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => vi.clearAllMocks());
const id = '60000000-0000-4000-8000-000000000001';
const ref = '70000000-0000-4000-8000-000000000025';
const state: OxygenProviderState = {
  bookingReference: ref,
  booking: {
    loan_reference: ref,
    status: 'BOOKED',
    product_amount: 400000,
    equity_percentage: 25,
    equity_amount: 100000,
    loan_amount: 300000,
    loan_tenure: 1,
  },
  quotedCharges: 5000,
  schedule: [
    {
      period: 1,
      dueDate: [2026, 11, 27],
      amount: 310000,
      principal: 300000,
      interest: 10000,
    },
  ],
};
const timing = (sentAt: number, reference = ref) => ({
  window: {
    bookingReference: reference,
    sentAt: new Date(sentAt).toISOString(),
    expiresAt: new Date(sentAt + 300000).toISOString(),
  },
});
async function readyApproval(
  approvePlan: (reference: string, otp: string, file: File) => Promise<boolean>,
  reference = ref
) {
  m.fetch.mockImplementation(async () =>
    Response.json(timing(Date.now(), reference))
  );
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={reference}
      state={state}
      approvePlan={approvePlan}
      requestCode={vi.fn().mockResolvedValue(true)}
      busy={false}
    />
  );
  const file = continueWithSignature();
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  return file;
}
it('keeps signature and acceptance on the first screen without requesting or approving anything', () => {
  m.fetch.mockResolvedValue(Response.json(timing(Date.now())));
  const approve = vi.fn();
  const request = vi.fn();
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      approvePlan={approve}
      requestCode={request}
      busy={false}
    />
  );
  expect(
    screen.queryByRole('textbox', { name: 'Verification code' })
  ).toBeNull();
  expect(screen.getByRole('group', { name: 'Signature' })).toBeVisible();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: /^Continue$/ })).toBeDisabled();
  expect(approve).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
it('submits the final digit once with the exact reference and saved signature after explicit acceptance', async () => {
  const approve = vi.fn().mockResolvedValue(true);
  const file = await readyApproval(approve);
  expect(screen.queryByRole('group', { name: 'Signature' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText(/The final digit submits/)).toBeNull();
  expect(approve).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '12345' } });
  expect(approve).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  await screen.findByText('Code verified.');
  expect(approve).toHaveBeenCalledExactlyOnceWith(
    ref,
    '123456',
    file,
    expect.any(Function)
  );
  expect(screen.getByRole('textbox')).toBeDisabled();
});
it('does not show success or repeat an unconfirmed approval', async () => {
  const approve = vi.fn().mockResolvedValue(false);
  await readyApproval(approve);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  await screen.findByRole('alert');
  expect(screen.queryByText('Code verified.')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Back to signature' })
  ).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '12345' } });
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  expect(approve).toHaveBeenCalledTimes(1);
});
it('refuses sending or approval for a different canonical reference', () => {
  m.fetch.mockImplementation(async () => Response.json(timing(Date.now(), id)));
  const approve = vi.fn();
  const request = vi.fn().mockResolvedValue(true);
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={id}
      state={state}
      approvePlan={approve}
      requestCode={request}
      busy={false}
    />
  );
  continueWithSignature();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(approve).not.toHaveBeenCalled();
});
it('keeps the actual first returned payment date in the acceptance copy', () => {
  m.fetch.mockResolvedValue(Response.json(timing(Date.now())));
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={vi.fn().mockResolvedValue(true)}
      busy={false}
    />
  );
  expect(screen.getByText('27 November 2026').parentElement).toHaveClass(
    'text-red-700'
  );
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('does not permit continuing without a returned schedule', () => {
  m.fetch.mockResolvedValue(Response.json(timing(Date.now())));
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={{ ...state, schedule: [] }}
      requestCode={vi.fn().mockResolvedValue(true)}
      busy={false}
    />
  );
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: /^Continue$/ })).toBeDisabled();
});
it('preserves the signature and acceptance when returning, while changing the signature clears acceptance', async () => {
  const approve = vi.fn();
  await readyApproval(approve);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Back to signature' }));
  expect(screen.getByText('Signature ready')).toBeVisible();
  expect(screen.getByRole('checkbox')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  expect(await screen.findByRole('textbox')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Back to signature' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change signature' }));
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(approve).not.toHaveBeenCalled();
});
it('keeps the red pending animation until the server responds', async () => {
  let finish: (confirmed: boolean) => void = () => {};
  const approve = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
  );
  await readyApproval(approve);
  vi.useFakeTimers();
  try {
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '123456' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(document.querySelector('[data-state="pending"]')).not.toBeNull();
    expect(document.querySelector('[data-state="verified"]')).toBeNull();
    await act(async () => {
      finish(false);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Approval was not confirmed'
    );
    expect(approve).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
