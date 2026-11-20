import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { StaffFollowUp } from '@/schemas/staff-follow-up';
import { StaffFollowUpEditor } from './StaffFollowUpEditor';

vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/ui/AppDatePickerField', () => ({
  AppDatePickerField: ({
    onConfirm,
    value,
  }: {
    onConfirm: (d: Date) => void;
    value: Date;
  }) => (
    <>
      <button
        type="button"
        onClick={() => onConfirm(new Date(2026, 10, 20, 12))}
      >
        Submit test date
      </button>
      <button type="button" onClick={() => onConfirm(value)}>
        Keep picker date
      </button>
    </>
  ),
}));

const claimed: StaffFollowUp = {
  order_id: 'order',
  merchant_id: 'merchant',
  assignee_id: 'staff',
  assignee_name: 'Ada',
  stage: 'needs_follow_up',
  outcome: '',
  follow_up_on: null,
  revision: 1,
  updated_at: '2026-11-19T10:00:00Z',
};

function props() {
  return {
    orderId: 'order',
    customerName: 'Customer',
    viewerId: 'staff',
    canWrite: true,
    busy: false,
    onClose: vi.fn(),
    onClaim: vi.fn().mockResolvedValue(claimed),
    onSave: vi.fn().mockResolvedValue(claimed),
  };
}

it.each([
  undefined,
  claimed,
])('lets view-only staff read a follow-up without mutation controls', (followUp) => {
  const options = props();
  render(
    <StaffFollowUpEditor {...options} followUp={followUp} canWrite={false} />
  );
  expect(
    screen.getByText(followUp ? 'Handled by Ada' : 'Unassigned')
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Claim follow-up' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save follow-up' })).toBeNull();
  expect(screen.queryByLabelText('What happened')).toBeNull();
});

it('lets a team member claim an unassigned follow-up', async () => {
  const options = props();
  render(<StaffFollowUpEditor {...options} />);
  fireEvent.click(screen.getByRole('button', { name: 'Claim follow-up' }));
  await waitFor(() => expect(options.onClaim).toHaveBeenCalledOnce());
});

it('keeps up to 1,000 Unicode characters in the outcome', () => {
  render(<StaffFollowUpEditor {...props()} followUp={claimed} />);
  const note = screen.getByLabelText('What happened');
  const accepted = `${'😀'.repeat(999)}a`;
  fireEvent.change(note, { target: { value: `${accepted}😀` } });
  expect(note).toHaveValue(accepted);
  expect(note).not.toHaveAttribute('maxlength', '1000');
});

it('saves the stage, outcome and local calendar date for the assigned team member', async () => {
  const options = props();
  render(<StaffFollowUpEditor {...options} followUp={claimed} />);
  fireEvent.click(screen.getByRole('button', { name: 'Waiting' }));
  fireEvent.change(screen.getByLabelText('What happened'), {
    target: { value: 'Customer will try again.' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Set next follow-up date' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Submit test date' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }));
  await waitFor(() =>
    expect(options.onSave).toHaveBeenCalledWith({
      order_id: 'order',
      revision: 1,
      stage: 'waiting',
      outcome: 'Customer will try again.',
      follow_up_on: '2026-11-20',
    })
  );
});

it.each([
  '2026-03-08', // US spring clock change
  '2026-03-29', // European spring clock change
  '2026-11-01', // US fall clock change
])('reopens and saves the same calendar date on %s', async (date) => {
  const options = props();
  render(
    <StaffFollowUpEditor
      {...options}
      followUp={{ ...claimed, follow_up_on: date }}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: `Follow up on ${date}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep picker date' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }));
  await waitFor(() =>
    expect(options.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ follow_up_on: date })
    )
  );
});

it('lets other staff see the handler and outcome without editing them', () => {
  render(
    <StaffFollowUpEditor
      {...props()}
      viewerId="another-staff-member"
      followUp={{
        ...claimed,
        outcome: 'Left a message.',
        follow_up_on: '2026-11-20',
      }}
    />
  );
  expect(screen.getByText('Handled by Ada')).toBeVisible();
  expect(screen.getByText('Left a message.')).toBeVisible();
  expect(screen.getByText('Follow up on 2026-11-20')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Save follow-up' })).toBeNull();
});

it('explains that an unassigned follow-up must be claimed before it can be filled in', () => {
  render(<StaffFollowUpEditor {...props()} />);
  expect(
    screen.getByText(/Claim this follow-up first\. Then you can record/)
  ).toBeVisible();
  expect(screen.queryByLabelText('What happened')).toBeNull();
});

it('confirms a fresh claim and points to the next step', () => {
  render(<StaffFollowUpEditor {...props()} followUp={claimed} justClaimed />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'You are now handling this follow-up. Add what happened, then save.'
  );
  expect(screen.getByRole('button', { name: 'Save follow-up' })).toBeVisible();
  expect(screen.queryByText(/Claim this follow-up first/)).toBeNull();
});

it('does not show the claim confirmation when an assigned follow-up is reopened', () => {
  render(<StaffFollowUpEditor {...props()} followUp={claimed} />);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps the sheet open and shows the error when a claim is lost to a teammate', async () => {
  const options = props();
  options.onClaim.mockRejectedValue(
    new Error('Someone else has already claimed this follow-up.')
  );
  render(<StaffFollowUpEditor {...options} />);
  fireEvent.click(screen.getByRole('button', { name: 'Claim follow-up' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Someone else has already claimed this follow-up.'
  );
  expect(options.onClose).not.toHaveBeenCalled();
});

it.each([
  claimed.assignee_id,
  null,
])('keeps a freshly closed follow-up read-only for assignee %s', (assigneeId) => {
  const options = props();
  const { rerender } = render(
    <StaffFollowUpEditor {...options} followUp={claimed} />
  );
  rerender(
    <StaffFollowUpEditor
      key="closed"
      {...options}
      followUp={{
        ...claimed,
        assignee_id: assigneeId,
        stage: 'closed',
        revision: 2,
      }}
    />
  );
  expect(screen.getByText('Closed')).toBeVisible();
  expect(screen.queryByText('Save follow-up')).toBeNull();
  expect(screen.queryByText('Claim follow-up')).toBeNull();
});

it('keeps an unsaved note after a revision change and requires loading the saved record before editing again', () => {
  const options = props();
  const { rerender } = render(
    <StaffFollowUpEditor {...options} followUp={claimed} />
  );
  fireEvent.change(screen.getByLabelText('What happened'), {
    target: { value: 'Unsaved callback details' },
  });
  rerender(
    <StaffFollowUpEditor
      {...options}
      followUp={{
        ...claimed,
        revision: 2,
        outcome: 'Saved by another session',
      }}
    />
  );

  expect(screen.getByDisplayValue('Unsaved callback details')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save follow-up' })).toBeDisabled();
  expect(options.onSave).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole('button', { name: 'Discard draft and load saved details' })
  );
  expect(screen.getByDisplayValue('Saved by another session')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save follow-up' })).toBeEnabled();
});
