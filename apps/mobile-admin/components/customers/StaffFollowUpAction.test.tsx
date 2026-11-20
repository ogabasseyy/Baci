import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StaffFollowUp } from '@/schemas/staff-follow-up';

const VIEWER = 'staff-1';

import { StaffFollowUpAction } from './StaffFollowUpAction';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      card: '#ffffff',
      text: '#111111',
      textSecondary: '#777777',
      gold: '#886600',
    },
  }),
}));

describe('StaffFollowUpAction', () => {
  it('opens the claim flow for an unassigned follow-up', () => {
    const onPress = vi.fn();
    render(
      <StaffFollowUpAction viewerId={VIEWER} canWrite onPress={onPress} />
    );
    expect(screen.getByText('Needs follow-up · Unassigned')).toBeVisible();
    fireEvent.click(screen.getByText('Claim follow-up'));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('shows shared details and offers editing only to the assignee', () => {
    const row: StaffFollowUp = {
      order_id: 'order-1',
      merchant_id: 'store-1',
      assignee_id: VIEWER,
      assignee_name: 'Amina',
      stage: 'waiting',
      outcome: 'Call back',
      follow_up_on: '2026-11-24',
      revision: 2,
      updated_at: '2026-11-20T12:00:00Z',
    };
    const onPress = vi.fn();
    const { rerender } = render(
      <StaffFollowUpAction
        followUp={row}
        viewerId="teammate"
        canWrite
        onPress={onPress}
      />
    );
    expect(screen.getByText('Waiting · Amina')).toBeVisible();
    expect(screen.getByText('Call back')).toBeVisible();
    expect(screen.getByText('Follow up on 2026-11-24')).toBeVisible();
    expect(screen.getByText('View follow-up')).toBeVisible();
    rerender(
      <StaffFollowUpAction
        followUp={row}
        viewerId={VIEWER}
        canWrite
        onPress={onPress}
      />
    );
    expect(screen.getByText('Update follow-up')).toBeVisible();
  });
});
