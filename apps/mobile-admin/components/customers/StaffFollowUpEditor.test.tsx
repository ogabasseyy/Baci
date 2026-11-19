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
  AppDatePickerField: ({ onConfirm }: { onConfirm: (d: Date) => void }) => (
    <button type="button" onClick={() => onConfirm(new Date(2026, 10, 20, 12))}>
      Submit test date
    </button>
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
    busy: false,
    onClose: vi.fn(),
    onClaim: vi.fn().mockResolvedValue(claimed),
    onSave: vi.fn().mockResolvedValue(claimed),
  };
}

it('lets a team member claim an unassigned follow-up', async () => {
  const options = props();
  render(<StaffFollowUpEditor {...options} />);
  fireEvent.click(screen.getByRole('button', { name: 'Claim follow-up' }));
  await waitFor(() => expect(options.onClaim).toHaveBeenCalledOnce());
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
