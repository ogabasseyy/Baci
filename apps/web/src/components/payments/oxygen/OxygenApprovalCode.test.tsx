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
it('shows the stored code as expired after reopening without requesting a new code', async () => {
  const request = vi.fn();
  m.fetch.mockImplementation(async () =>
    Response.json(timing(Date.now() - 600000))
  );
  const view = render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={request}
      busy={false}
    />
  );
  await screen.findByText('Code expired');
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(request).not.toHaveBeenCalled();
  view.unmount();
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={request}
      busy={false}
    />
  );
  await screen.findByText('Code expired');
  expect(request).not.toHaveBeenCalled();
});
it('resends only on an explicit click using this exact reference and reloads the confirmed timing', async () => {
  let sentAt = Date.now() - 600000;
  m.fetch.mockImplementation(async () => Response.json(timing(sentAt)));
  const request = vi.fn(async () => {
    sentAt = Date.now();
    return true;
  });
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={request}
      busy={false}
    />
  );
  await screen.findByText('Code expired');
  fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
  await waitFor(() =>
    expect(screen.getByRole('timer')).toHaveTextContent('5:00')
  );
  expect(request).toHaveBeenCalledExactlyOnceWith(ref);
  expect(
    screen.queryByRole('button', { name: 'Verify and approve plan' })
  ).toBeNull();
  expect(
    m.fetch.mock.calls.every(([url]) => url.includes('/approval-code?'))
  ).toBe(true);
});
it('rejects a timing record belonging to another reference', async () => {
  const request = vi.fn();
  m.fetch.mockImplementation(async () => Response.json(timing(Date.now(), id)));
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={request}
      busy={false}
    />
  );
  await screen.findByRole('button', { name: 'Check code status' });
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
  expect(request).not.toHaveBeenCalled();
});

const signature = () =>
  new File(['test-signature'], 'signature.png', { type: 'image/png' });
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
      busy={false}
    />
  );
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  const file = signature();
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.change(screen.getByLabelText('Your signature'), {
    target: { files: [file] },
  });
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I accept this payment plan/ })
  );
  return file;
}
it('automatically submits the final digit once with the exact reference, explicit consent and signature', async () => {
  const approve = vi.fn().mockResolvedValue(true);
  const file = await readyApproval(approve);
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
  expect(
    screen.queryByRole('button', { name: /Verify and approve/ })
  ).toBeNull();
});
it('requires both signature and explicit acceptance before enabling automatic approval', async () => {
  const approve = vi.fn().mockResolvedValue(true);
  m.fetch.mockImplementation(async () => Response.json(timing(Date.now())));
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      approvePlan={approve}
      busy={false}
    />
  );
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.change(screen.getByLabelText('Your signature'), {
    target: { files: [signature()] },
  });
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(approve).not.toHaveBeenCalled();
});
it('does not show success or automatically repeat an unconfirmed approval', async () => {
  const approve = vi.fn().mockResolvedValue(false);
  await readyApproval(approve);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  await screen.findByRole('alert');
  expect(screen.queryByText('Code verified.')).toBeNull();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '12345' } });
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  expect(approve).toHaveBeenCalledTimes(1);
});
it('does not submit an expired or mismatched plan', async () => {
  const approve = vi.fn().mockResolvedValue(true);
  await readyApproval(approve, id);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
  });
  expect(approve).not.toHaveBeenCalled();
});

it('acknowledges the actual first returned due date in red without preselecting consent', async () => {
  m.fetch.mockImplementation(async () => Response.json(timing(Date.now())));
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      busy={false}
    />
  );
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  expect(screen.getByText('27 November 2026')).toBeVisible();
  expect(screen.getByText('27 November 2026').parentElement).toHaveClass(
    'text-red-700'
  );
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.queryByText(/I acknowledge/)).toBeNull();
  expect(screen.getByRole('checkbox').closest('label')).toHaveClass(
    'items-center'
  );
  expect(screen.getByRole('checkbox')).toHaveAccessibleName(
    /I accept this payment plan and understand my next payment is due on 27 November 2026/
  );
});
it('does not invent a due date or permit acceptance without a returned schedule', async () => {
  m.fetch.mockImplementation(async () => Response.json(timing(Date.now())));
  const approve = vi.fn();
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={{ ...state, schedule: [] }}
      approvePlan={approve}
      busy={false}
    />
  );
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(
    screen.getByText(
      'Your next payment date will appear when Oxygen confirms your schedule.'
    )
  ).toBeVisible();
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
  expect(approve).not.toHaveBeenCalled();
});

it('groups signature, acceptance and code together without requesting or submitting on render', async () => {
  m.fetch.mockImplementation(async () => Response.json(timing(Date.now())));
  const approve = vi.fn();
  const request = vi.fn();
  render(
    <OxygenApprovalCode
      workflowId={id}
      reference={ref}
      state={state}
      requestCode={request}
      approvePlan={approve}
      busy={false}
    />
  );
  const confirmation = screen.getByRole('region', {
    name: 'Plan confirmation',
  });
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  expect(confirmation).toContainElement(
    screen.getByRole('group', { name: 'Signature' })
  );
  expect(confirmation).toContainElement(screen.getByRole('checkbox'));
  expect(confirmation).toContainElement(screen.getByRole('textbox'));
  expect(
    screen
      .getByRole('textbox')
      .compareDocumentPosition(screen.getByRole('checkbox')) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(approve).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it('keeps verification pending beyond the old collapse delay until the server replies', async () => {
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
    expect(
      screen.getByRole('status', { name: 'Verification code status' })
    ).toHaveTextContent('Checking your code');
    await act(async () => {
      finish(false);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Approval was not confirmed'
    );
    expect(document.querySelector('[data-state="verified"]')).toBeNull();
    expect(approve).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
